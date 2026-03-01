/**
 * ============================================================
 * PJUD HTML Parser — Tarea 4.17
 * ============================================================
 * Parsea las respuestas HTML de causaCivil.php para extraer
 * folios y sus JWTs asociados.
 *
 * Se usa cuando el API Sync necesita obtener folios de cuadernos
 * distintos al visible en el momento del scraping.
 *
 * Utiliza node-html-parser para parsing robusto del DOM server-side.
 * ============================================================
 */

import { parse as parseHtml, HTMLElement } from 'node-html-parser'
import type { Folio, JwtRef } from './types'

/**
 * Extract folios from the HTML response of causaCivil.php.
 * Mirrors the logic of JwtExtractor._extractFolios() (extension, tarea 4.16).
 */
export function parseFoliosFromHtml(html: string): Folio[] {
  const root = parseHtml(html, {
    lowerCaseTagName: true,
    comment: false,
    voidTag: { closingSlash: true },
  })

  const folios: Folio[] = []

  const historiaTab = root.querySelector('#historiaCiv')
  if (historiaTab) {
    folios.push(...extractFoliosFromTable(historiaTab))
  }

  const piezasTab = root.querySelector('#piezasExhortoCiv')
  if (piezasTab) {
    const piezasFolios = extractFoliosFromTable(piezasTab)
    for (const f of piezasFolios) {
      f._source = 'piezas_exhorto'
    }
    folios.push(...piezasFolios)
  }

  return folios
}

function extractFoliosFromTable(container: HTMLElement): Folio[] {
  const folios: Folio[] = []
  const rows = container.querySelectorAll('tbody tr')

  for (const row of rows) {
    const cells = row.querySelectorAll('td')
    if (cells.length < 7) continue

    const folio = parseFolioRow(cells)
    if (folio) folios.push(folio)
  }

  return folios
}

function parseFolioRow(cells: HTMLElement[]): Folio | null {
  const folioNum = parseInt(cleanText(cells[0]?.text), 10)
  if (isNaN(folioNum)) return null

  const docCell = cells[1]
  const jwtDocPrincipal = extractFormJwt(docCell, 'docuS.php', 'docuN.php')
  const jwtCertEscrito = extractFormJwt(docCell, 'docCertificadoEscrito.php')

  const geoCell = cells[cells.length - 1]
  let jwtGeoref: string | null = null
  if (geoCell) {
    const geoLink = geoCell.querySelector('a[onclick*="geoReferencia"]')
    if (geoLink) {
      jwtGeoref = extractJwtFromOnclick(
        geoLink.getAttribute('onclick') || '',
        'geoReferencia'
      )
    }
  }

  return {
    numero: folioNum,
    etapa: cleanText(cells[3]?.text),
    tramite: cleanText(cells[4]?.text),
    desc_tramite: cleanText(cells[5]?.text),
    fecha_tramite: cleanText(cells[6]?.text),
    foja: parseInt(cleanText(cells[7]?.text), 10) || 0,
    jwt_doc_principal: jwtDocPrincipal,
    jwt_certificado_escrito: jwtCertEscrito,
    jwt_georef: jwtGeoref,
  }
}

function extractFormJwt(cell: HTMLElement | undefined, ...endpoints: string[]): JwtRef | null {
  if (!cell) return null

  const forms = cell.querySelectorAll('form')
  for (const form of forms) {
    const action = form.getAttribute('action') || ''
    const matchesEndpoint = endpoints.some((ep) => action.includes(ep))
    if (!matchesEndpoint) continue

    const input = form.querySelector('input[type="hidden"]')
      || form.querySelector('input')
    if (input) {
      const value = input.getAttribute('value') || ''
      const name = input.getAttribute('name') || ''
      if (value.length > 20) {
        return { jwt: value, action, param: name }
      }
    }
  }
  return null
}

function extractJwtFromOnclick(onclick: string, fnName: string): string | null {
  if (!onclick) return null

  const pattern = new RegExp(
    fnName + "\\s*\\(\\s*['\"]([^'\"]+)['\"]\\s*\\)",
    'i'
  )
  const match = onclick.match(pattern)
  if (match && match[1].length > 20) return match[1]

  const jwtMatch = onclick.match(/(eyJ[A-Za-z0-9_-]+\.[\w_-]+\.[\w_-]+)/)
  if (jwtMatch) return jwtMatch[1]

  return null
}

function cleanText(text: string | undefined): string {
  if (!text) return ''
  return text
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
