/**
 * ============================================================
 * PJUD HTTP Client — Tarea 4.17
 * ============================================================
 * Cliente HTTP para interactuar con los endpoints de PJUD
 * (Oficina Judicial Virtual) desde el servidor.
 *
 * Maneja:
 *   - Headers obligatorios para bypass del F5 WAF (User-Agent + Referer)
 *   - Throttle server-side (500ms–1s entre requests)
 *   - Descarga de PDFs vía GET con JWT
 *   - POST a causaCivil.php con JWT + CSRF + cookies
 *   - Validación de magic bytes para PDFs
 *   - Timeout por request
 * ============================================================
 */

import type { PjudCookies } from './types'

const PJUD_BASE_URL = 'https://oficinajudicialvirtual.pjud.cl'
const PJUD_REFERER = `${PJUD_BASE_URL}/indexN.php`
const PJUD_ORIGIN = PJUD_BASE_URL

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const PDF_MAGIC_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46]) // %PDF

const THROTTLE_MIN_MS = 500
const THROTTLE_MAX_MS = 1000
const REQUEST_TIMEOUT_MS = 30_000

export class PjudClient {
  private lastRequestTime = 0
  private requestCount = 0

  private baseHeaders(): Record<string, string> {
    return {
      'User-Agent': USER_AGENT,
      Referer: PJUD_REFERER,
      Accept: '*/*',
      'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8',
    }
  }

  private cookieHeader(cookies: PjudCookies | null): string | null {
    if (!cookies?.PHPSESSID) return null
    const parts = [`PHPSESSID=${cookies.PHPSESSID}`]
    if (cookies.TS01262d1d) parts.push(`TS01262d1d=${cookies.TS01262d1d}`)
    return parts.join('; ')
  }

  /**
   * Wait to respect PJUD throttle (500ms–1s between requests).
   */
  private async throttle(): Promise<void> {
    const now = Date.now()
    const elapsed = now - this.lastRequestTime
    const delay =
      THROTTLE_MIN_MS + Math.random() * (THROTTLE_MAX_MS - THROTTLE_MIN_MS)

    if (elapsed < delay) {
      await new Promise((r) => setTimeout(r, delay - elapsed))
    }
    this.lastRequestTime = Date.now()
    this.requestCount++
  }

  /**
   * Download a PDF from PJUD via GET with JWT.
   * No cookies needed (confirmed by Prueba B — JWT is self-sufficient).
   */
  async downloadPdf(
    endpoint: string,
    param: string,
    jwt: string
  ): Promise<{ buffer: Buffer; contentType: string } | null> {
    await this.throttle()

    const url = this.resolveUrl(endpoint, param, jwt)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: this.baseHeaders(),
        signal: controller.signal,
        redirect: 'follow',
      })

      if (!response.ok) {
        console.error(
          `[PjudClient] PDF download failed: ${response.status} ${response.statusText} — ${url.substring(0, 100)}`
        )
        return null
      }

      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      if (!this.isValidPdf(buffer)) {
        console.warn(
          `[PjudClient] Downloaded file is not a valid PDF (magic bytes mismatch). Size: ${buffer.length}`
        )
        return null
      }

      return {
        buffer,
        contentType: response.headers.get('content-type') || 'application/pdf',
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        console.error(`[PjudClient] PDF download timeout: ${url.substring(0, 100)}`)
      } else {
        console.error(`[PjudClient] PDF download error:`, error)
      }
      return null
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * POST to causaCivil.php to get the HTML for a cuaderno.
   * Requires cookies (PHPSESSID + TS01262d1d) + JWT + CSRF token.
   */
  async fetchCuadernoHtml(
    cuadernoJwt: string,
    csrfToken: string,
    cookies: PjudCookies | null
  ): Promise<string | null> {
    await this.throttle()

    const url = `${PJUD_BASE_URL}/ADIR_871/civil/modal/causaCivil.php`

    const headers: Record<string, string> = {
      ...this.baseHeaders(),
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      Origin: PJUD_ORIGIN,
    }

    const cookie = this.cookieHeader(cookies)
    if (cookie) headers['Cookie'] = cookie

    const body = new URLSearchParams({
      dtaCausa: cuadernoJwt,
      token: csrfToken,
    }).toString()

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
        redirect: 'follow',
      })

      if (!response.ok) {
        console.error(
          `[PjudClient] causaCivil.php failed: ${response.status} ${response.statusText}`
        )
        return null
      }

      const html = await response.text()

      if (html.length < 200 || !html.includes('table')) {
        console.warn(
          `[PjudClient] causaCivil.php response too small or invalid (${html.length} chars)`
        )
        return null
      }

      return html
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        console.error('[PjudClient] causaCivil.php request timeout')
      } else {
        console.error('[PjudClient] causaCivil.php error:', error)
      }
      return null
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * Build the full URL for a PJUD document download.
   */
  private resolveUrl(action: string, param: string, jwt: string): string {
    const cleanAction = action.startsWith('http')
      ? action
      : `${PJUD_BASE_URL}/${action.replace(/^\//, '')}`

    const url = new URL(cleanAction)
    url.searchParams.set(param || 'dtaDoc', jwt)
    return url.toString()
  }

  /**
   * Validate PDF magic bytes (%PDF at offset 0).
   */
  private isValidPdf(buffer: Buffer): boolean {
    if (buffer.length < 4) return false
    return buffer.subarray(0, 4).equals(PDF_MAGIC_BYTES)
  }

  getStats() {
    return { requestCount: this.requestCount }
  }
}
