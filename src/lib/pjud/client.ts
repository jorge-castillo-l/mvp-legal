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
const DOC_MAGIC_BYTES = Buffer.from([0xD0, 0xCF, 0x11, 0xE0]) // OLE2 (.doc)
const ZIP_MAGIC_BYTES = Buffer.from([0x50, 0x4B, 0x03, 0x04]) // PK (.docx, .xlsx, .zip)

export type DownloadResult =
  | { ok: true; buffer: Buffer; contentType: string }
  | { ok: false; reason: 'unsupported_format'; detectedFormat: string; size: number }
  | { ok: false; reason: 'download_failed' }

const THROTTLE_MIN_MS = 500
const THROTTLE_MAX_MS = 1000
const REQUEST_TIMEOUT_MS = 30_000

const DOWNLOAD_MAX_RETRIES = 4
const DOWNLOAD_RETRY_BASE_MS = 2_000

const TRANSIENT_CODES = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE',
  'UND_ERR_SOCKET', 'EAI_AGAIN', 'EHOSTUNREACH',
])

export class PjudClient {
  private lastRequestTime = 0
  private requestCount = 0
  private cookies: PjudCookies | null = null

  /**
   * Store session cookies for endpoints that require them (e.g. anexoDocCivil.php).
   * Safe to call for all syncs — endpoints that don't need cookies simply ignore them.
   */
  setCookies(cookies: PjudCookies | null): void {
    this.cookies = cookies
  }

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
   * Retries up to DOWNLOAD_MAX_RETRIES times with exponential backoff
   * on transient network errors (ECONNRESET, ETIMEDOUT, etc.).
   */
  async downloadPdf(
    endpoint: string,
    param: string,
    jwt: string
  ): Promise<DownloadResult> {
    const url = this.resolveUrl(endpoint, param, jwt)
    const headers: Record<string, string> = { ...this.baseHeaders() }
    const cookie = this.cookieHeader(this.cookies)
    if (cookie) headers['Cookie'] = cookie

    for (let attempt = 1; attempt <= DOWNLOAD_MAX_RETRIES; attempt++) {
      await this.throttle()

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

      try {
        const response = await fetch(url, {
          method: 'GET',
          headers,
          signal: controller.signal,
          redirect: 'follow',
        })

        if (!response.ok) {
          const isServerError = response.status >= 500
          if (isServerError && attempt < DOWNLOAD_MAX_RETRIES) {
            console.warn(
              `[PjudClient] PDF ${response.status} on attempt ${attempt}/${DOWNLOAD_MAX_RETRIES}, retrying…`
            )
            clearTimeout(timeout)
            await this.backoff(attempt)
            continue
          }
          console.error(
            `[PjudClient] PDF download failed: ${response.status} ${response.statusText} — ${url.substring(0, 100)}`
          )
          return { ok: false, reason: 'download_failed' }
        }

        const arrayBuffer = await response.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)

        if (!this.isValidPdf(buffer)) {
          const detected = this.detectFormat(buffer)
          if (detected) {
            console.warn(
              `[PjudClient] Downloaded file is ${detected}, not PDF. Size: ${buffer.length} — skipping (not retryable)`
            )
            return { ok: false, reason: 'unsupported_format', detectedFormat: detected, size: buffer.length }
          }
          console.warn(
            `[PjudClient] Downloaded file is not a valid PDF (magic bytes mismatch). Size: ${buffer.length}`
          )
          return { ok: false, reason: 'download_failed' }
        }

        if (attempt > 1) {
          console.log(`[PjudClient] PDF downloaded successfully on attempt ${attempt}`)
        }

        return {
          ok: true,
          buffer,
          contentType: response.headers.get('content-type') || 'application/pdf',
        }
      } catch (error) {
        clearTimeout(timeout)

        const isTransient = this.isTransientError(error)

        if (isTransient && attempt < DOWNLOAD_MAX_RETRIES) {
          const code = (error as { cause?: { code?: string } })?.cause?.code || 'unknown'
          const delay = DOWNLOAD_RETRY_BASE_MS * Math.pow(2, attempt - 1)
          console.warn(
            `[PjudClient] Attempt ${attempt}/${DOWNLOAD_MAX_RETRIES} failed (${code}), retrying in ${delay}ms…`
          )
          await this.backoff(attempt)
          continue
        }

        if (error instanceof DOMException && error.name === 'AbortError') {
          console.error(
            `[PjudClient] PDF download timeout after ${attempt} attempt(s): ${url.substring(0, 100)}`
          )
        } else {
          console.error(
            `[PjudClient] PDF download failed after ${attempt} attempt(s):`, error
          )
        }
        return { ok: false, reason: 'download_failed' }
      } finally {
        clearTimeout(timeout)
      }
    }

    return { ok: false, reason: 'download_failed' }
  }

  private isTransientError(error: unknown): boolean {
    if (error instanceof DOMException && error.name === 'AbortError') return true
    const code = (error as { cause?: { code?: string } })?.cause?.code
    if (code && TRANSIENT_CODES.has(code)) return true
    const msg = error instanceof Error ? error.message : ''
    return msg.includes('fetch failed') || msg.includes('network')
  }

  private async backoff(attempt: number): Promise<void> {
    const jitter = Math.random() * 500
    const delay = DOWNLOAD_RETRY_BASE_MS * Math.pow(2, attempt - 1) + jitter
    await new Promise((r) => setTimeout(r, delay))
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
   * POST to anexoCausaCivil.php to get the HTML for the Anexos modal.
   * The response contains a table with individual document JWTs
   * downloadable via anexoDocCivil.php.
   */
  async fetchAnexosHtml(
    jwt: string,
    cookies: PjudCookies | null
  ): Promise<string | null> {
    await this.throttle()

    const url = `${PJUD_BASE_URL}/ADIR_871/civil/modal/anexoCausaCivil.php`

    const headers: Record<string, string> = {
      ...this.baseHeaders(),
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      Origin: PJUD_ORIGIN,
    }

    const cookie = this.cookieHeader(cookies)
    if (cookie) headers['Cookie'] = cookie

    const body = new URLSearchParams({ dtaAnexCau: jwt }).toString()

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
        console.warn(
          `[PjudClient] anexoCausaCivil.php failed: ${response.status} ${response.statusText}`
        )
        return null
      }

      const html = await response.text()

      if (html.length < 50 || !html.includes('table')) {
        console.warn(
          `[PjudClient] anexoCausaCivil.php response too small or invalid (${html.length} chars)`
        )
        return null
      }

      console.log(
        `[PjudClient] anexoCausaCivil.php: ${html.length} chars recibidos`
      )
      return html
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        console.error('[PjudClient] anexoCausaCivil.php request timeout')
      } else {
        console.error('[PjudClient] anexoCausaCivil.php error:', error)
      }
      return null
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * POST to receptorCivil.php to get the HTML for the Receptor modal (4.20).
   * Uses the jwt_receptor JWT extracted from the cause page by JwtExtractor.
   *
   * NOTE: The exact endpoint URL and parameter name are inferred from PJUD patterns.
   * Validate against real PJUD HTML after first test with a cause that has receptor data.
   */
  async fetchReceptorHtml(
    jwt: string,
    csrfToken: string | null,
    cookies: PjudCookies | null
  ): Promise<string | null> {
    await this.throttle()

    const url = `${PJUD_BASE_URL}/ADIR_871/civil/modal/receptorCivil.php`

    const headers: Record<string, string> = {
      ...this.baseHeaders(),
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      Origin: PJUD_ORIGIN,
    }

    const cookie = this.cookieHeader(cookies)
    if (cookie) headers['Cookie'] = cookie

    const body = new URLSearchParams({ valReceptor: jwt }).toString()

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
        console.warn(
          `[PjudClient] receptorCivil.php failed: ${response.status} ${response.statusText}`
        )
        return null
      }

      const html = await response.text()

      if (html.length < 50) {
        console.warn(
          `[PjudClient] receptorCivil.php response too small (${html.length} chars)`
        )
        return null
      }

      console.log(
        `[PjudClient] receptorCivil.php: ${html.length} chars recibidos`
      )
      return html
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        console.error('[PjudClient] receptorCivil.php request timeout')
      } else {
        console.error('[PjudClient] receptorCivil.php error:', error)
      }
      return null
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * POST to anexoSolicitudCivil.php to get the HTML for the per-folio anexo modal.
   * Contains documents attached to a specific filing (escrito).
   *
   * Confirmed via DevTools Network capture (2026-03-04).
   */
  async fetchAnexoSolicitudHtml(
    jwt: string,
    cookies: PjudCookies | null
  ): Promise<string | null> {
    await this.throttle()

    const url = `${PJUD_BASE_URL}/ADIR_871/civil/modal/anexoCausaSolicitudCivil.php`

    const headers: Record<string, string> = {
      ...this.baseHeaders(),
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      Origin: PJUD_ORIGIN,
    }

    const cookie = this.cookieHeader(cookies)
    if (cookie) headers['Cookie'] = cookie

    const body = new URLSearchParams({ dtaCausaAnex: jwt }).toString()

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
        console.warn(
          `[PjudClient] anexoCausaSolicitudCivil.php failed: ${response.status} ${response.statusText}`
        )
        return null
      }

      const html = await response.text()

      if (html.length < 50 || !html.includes('table')) {
        console.warn(
          `[PjudClient] anexoCausaSolicitudCivil.php response too small or invalid (${html.length} chars)`
        )
        return null
      }

      console.log(
        `[PjudClient] anexoCausaSolicitudCivil.php: ${html.length} chars recibidos`
      )
      return html
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        console.error('[PjudClient] anexoCausaSolicitudCivil.php request timeout')
      } else {
        console.error('[PjudClient] anexoCausaSolicitudCivil.php error:', error)
      }
      return null
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * POST to causaApelaciones.php to get the HTML for a remision detail modal.
   * PJUD does not validate the reCAPTCHA token server-side, so a dummy value works.
   */
  async fetchApelacionHtml(
    jwt: string,
    cookies: PjudCookies | null
  ): Promise<string | null> {
    await this.throttle()

    const url = `${PJUD_BASE_URL}/ADIR_871/apelaciones/modal/causaApelaciones.php`

    const headers: Record<string, string> = {
      ...this.baseHeaders(),
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      Origin: PJUD_ORIGIN,
    }

    const cookie = this.cookieHeader(cookies)
    if (cookie) headers['Cookie'] = cookie

    const body = new URLSearchParams({
      dtaCausa: jwt,
      tokenCaptcha: 'SYNC_SERVER',
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
        console.warn(
          `[PjudClient] causaApelaciones.php failed: ${response.status} ${response.statusText}`
        )
        return null
      }

      const html = await response.text()

      if (html.length < 200 || !html.includes('table')) {
        console.warn(
          `[PjudClient] causaApelaciones.php response too small or invalid (${html.length} chars)`
        )
        return null
      }

      console.log(
        `[PjudClient] causaApelaciones.php: ${html.length} chars recibidos`
      )
      return html
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        console.error('[PjudClient] causaApelaciones.php request timeout')
      } else {
        console.error('[PjudClient] causaApelaciones.php error:', error)
      }
      return null
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * POST to detalleExhortos.php to get the HTML for the exhorto detail modal.
   * Returns a table with documents downloadable via docDetalleExhorto.php.
   * Confirmed via DevTools Network capture (2026-03-04).
   */
  async fetchExhortoDetalleHtml(
    jwtDetalle: string,
    cookies: PjudCookies | null
  ): Promise<string | null> {
    await this.throttle()

    const url = `${PJUD_BASE_URL}/ADIR_871/civil/modal/detalleExhortos.php`

    const headers: Record<string, string> = {
      ...this.baseHeaders(),
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      Origin: PJUD_ORIGIN,
    }

    const cookie = this.cookieHeader(cookies)
    if (cookie) headers['Cookie'] = cookie

    const body = new URLSearchParams({ valExhorto: jwtDetalle }).toString()

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
        console.warn(
          `[PjudClient] detalleExhortos.php failed: ${response.status} ${response.statusText}`
        )
        return null
      }

      const html = await response.text()

      if (html.length < 50) {
        console.warn(
          `[PjudClient] detalleExhortos.php response too small (${html.length} chars)`
        )
        return null
      }

      console.log(
        `[PjudClient] detalleExhortos.php: ${html.length} chars recibidos`
      )
      return html
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        console.error('[PjudClient] detalleExhortos.php request timeout')
      } else {
        console.error('[PjudClient] detalleExhortos.php error:', error)
      }
      return null
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * POST to anexoEscritoApelaciones.php to get the HTML for the
   * anexo escrito modal within a remision/apelación.
   * Confirmed via console.log(anexoEscritoApelaciones.toString()) on 2026-03-15.
   */
  async fetchAnexoEscritoApelacionesHtml(
    jwt: string,
    cookies: PjudCookies | null
  ): Promise<string | null> {
    await this.throttle()

    const url = `${PJUD_BASE_URL}/ADIR_871/apelaciones/modal/anexoEscritoApelaciones.php`

    const headers: Record<string, string> = {
      ...this.baseHeaders(),
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      Origin: PJUD_ORIGIN,
    }

    const cookie = this.cookieHeader(cookies)
    if (cookie) headers['Cookie'] = cookie

    const body = new URLSearchParams({ dtaAnexEsc: jwt }).toString()

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
        console.warn(
          `[PjudClient] anexoEscritoApelaciones.php failed: ${response.status} ${response.statusText}`
        )
        return null
      }

      const html = await response.text()

      if (html.length < 50 || !html.includes('table')) {
        console.warn(
          `[PjudClient] anexoEscritoApelaciones.php response too small or invalid (${html.length} chars)`
        )
        return null
      }

      console.log(
        `[PjudClient] anexoEscritoApelaciones.php: ${html.length} chars recibidos`
      )
      return html
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        console.error('[PjudClient] anexoEscritoApelaciones.php request timeout')
      } else {
        console.error('[PjudClient] anexoEscritoApelaciones.php error:', error)
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

  /**
   * Detect known non-PDF formats from magic bytes.
   * Returns format label (e.g. '.doc', '.docx/.zip') or null if unknown.
   */
  private detectFormat(buffer: Buffer): string | null {
    if (buffer.length < 4) return null
    const head = buffer.subarray(0, 4)
    if (head.equals(DOC_MAGIC_BYTES)) return '.doc'
    if (head.equals(ZIP_MAGIC_BYTES)) return '.docx/.zip'
    return null
  }

  getStats() {
    return { requestCount: this.requestCount }
  }
}
