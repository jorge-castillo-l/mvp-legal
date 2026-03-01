/**
 * ============================================================
 * PJUD HTML Parser — Tarea 4.17 + 4.20
 * ============================================================
 * Parsea las respuestas HTML de endpoints PJUD server-side:
 *   - causaCivil.php  → folios con JWTs (4.17)
 *   - receptorCivil.php → datos del receptor (4.20)
 *
 * Utiliza node-html-parser para parsing robusto del DOM server-side.
 *
 * NOTA RECEPTOR (4.20): El parser es best-effort basado en los
 * patrones generales de tablas PJUD. Validar contra HTML real
 * de #modalReceptorCivil al probar con causa que tenga actuaciones
 * de receptor. Ajustar selectores según el HTML capturado.
 * ============================================================
 */

import { parse as parseHtml, HTMLElement } from 'node-html-parser'
import type { AnexoFile, Folio, JwtRef, ReceptorData } from './types'

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

// ════════════════════════════════════════════════════════
// ANEXOS PARSER
// ════════════════════════════════════════════════════════

/**
 * Parse the HTML response of anexoCausaCivil.php.
 * Each row has: Doc (form → anexoDocCivil.php with JWT) | Fecha | Referencia
 */
export function parseAnexosFromHtml(html: string): AnexoFile[] {
  const root = parseHtml(html, {
    lowerCaseTagName: true,
    comment: false,
    voidTag: { closingSlash: true },
  })

  const anexos: AnexoFile[] = []
  const rows = root.querySelectorAll('tbody tr')

  for (const row of rows) {
    const cells = row.querySelectorAll('td')
    if (cells.length < 2) continue

    const docCell = cells[0]
    const jwt = extractFormJwt(docCell, 'anexoDocCivil.php', 'docuS.php', 'docuN.php', 'docu.php')
    if (!jwt) continue

    anexos.push({
      jwt,
      fecha: cleanText(cells[1]?.text),
      referencia: cleanText(cells[2]?.text),
    })
  }

  return anexos
}

// ════════════════════════════════════════════════════════
// RECEPTOR PARSER — Tarea 4.20
// ════════════════════════════════════════════════════════

/**
 * Parsea la respuesta HTML de receptorCivil.php.
 *
 * El parser identifica tablas por sus encabezados (th) y clasifica
 * las filas como certificaciones o diligencias según el contenido.
 * Diseñado para los patrones generales de tablas PJUD; validar y
 * ajustar selectores contra HTML real (#modalReceptorCivil).
 *
 * Estrategia defensiva: si no se reconoce ninguna tabla conocida,
 * retorna arrays vacíos sin lanzar error (graceful degradation).
 */
export function parseReceptorData(html: string): ReceptorData {
  const root = parseHtml(html, {
    lowerCaseTagName: true,
    comment: false,
    voidTag: { closingSlash: true },
  })

  let receptor_nombre: string | null = null
  let tipo_receptor: string | null = null
  const certificaciones: ReceptorData['certificaciones'] = []
  const diligencias: ReceptorData['diligencias'] = []

  // ── Nombre del receptor: buscar en encabezados / celdas destacadas
  const nameSelectors = [
    '.nombre-receptor',
    '.receptor-nombre',
    'h4',
    'h3',
    'strong',
    'b',
  ]
  for (const sel of nameSelectors) {
    const el = root.querySelector(sel)
    if (el) {
      const txt = cleanText(el.text)
      if (txt.length > 3 && txt.length < 120) {
        receptor_nombre = txt
        break
      }
    }
  }

  // ── Tipo de receptor: buscar en celdas con la etiqueta "Tipo"
  const allCells = root.querySelectorAll('td, th')
  for (let i = 0; i < allCells.length - 1; i++) {
    const label = cleanText(allCells[i].text).toLowerCase()
    if (label === 'tipo' || label === 'tipo receptor') {
      tipo_receptor = cleanText(allCells[i + 1].text) || null
      break
    }
  }

  // ── Tablas: identificar por encabezados (th)
  const tables = root.querySelectorAll('table')
  for (const table of tables) {
    const ths = table.querySelectorAll('th').map((th) => cleanText(th.text).toLowerCase())
    const rows = table.querySelectorAll('tbody tr')

    const isCertTable =
      ths.some((h) => h.includes('certificaci') || h.includes('resultado') || h.includes('certif'))

    const isDiligTable =
      ths.some((h) => h.includes('diligencia') || h.includes('actuaci') || h.includes('servicio'))

    if (isCertTable) {
      // Mapeo por posición: fecha | tipo | resultado | obs
      for (const row of rows) {
        const cells = row.querySelectorAll('td')
        if (cells.length < 2) continue
        certificaciones.push({
          fecha:     cleanText(cells[0]?.text),
          tipo:      cleanText(cells[1]?.text),
          resultado: cleanText(cells[2]?.text) || '',
          obs:       cleanText(cells[3]?.text) || '',
        })
      }
    } else if (isDiligTable) {
      // Mapeo por posición: fecha | tipo | descripcion
      for (const row of rows) {
        const cells = row.querySelectorAll('td')
        if (cells.length < 2) continue
        diligencias.push({
          fecha:       cleanText(cells[0]?.text),
          tipo:        cleanText(cells[1]?.text),
          descripcion: cleanText(cells[2]?.text) || '',
        })
      }
    } else if (ths.length >= 2 && rows.length > 0) {
      // Tabla genérica con datos: tratar como diligencias (fallback)
      for (const row of rows) {
        const cells = row.querySelectorAll('td')
        if (cells.length < 2) continue
        diligencias.push({
          fecha:       cleanText(cells[0]?.text),
          tipo:        cleanText(cells[1]?.text),
          descripcion: cells.slice(2).map((c) => cleanText(c.text)).filter(Boolean).join(' | '),
        })
      }
    }
  }

  return { receptor_nombre, tipo_receptor, certificaciones, diligencias }
}
