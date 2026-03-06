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
import type { AnexoFile, ExhortoDetalleDoc, Folio, JwtRef, ReceptorData, TabsData } from './types'

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

  let jwtAnexoSolicitud: string | null = null
  if (cells[2]) {
    const anexoLink = cells[2].querySelector('a[onclick*="anexoSolicitudCivil"]')
    if (anexoLink) {
      jwtAnexoSolicitud = extractJwtFromOnclick(
        anexoLink.getAttribute('onclick') || '',
        'anexoSolicitudCivil'
      )
    }
  }

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
    jwt_anexo_solicitud: jwtAnexoSolicitud,
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
// TABS PARSER (server-side equivalent of JwtExtractor._extractTabsData)
// ════════════════════════════════════════════════════════

export function parseTabsFromHtml(html: string): TabsData {
  const root = parseHtml(html, {
    lowerCaseTagName: true,
    comment: false,
    voidTag: { closingSlash: true },
  })

  const litigantes: TabsData['litigantes'] = []
  const litTab = root.querySelector('#litigantesCiv')
  if (litTab) {
    for (const row of litTab.querySelectorAll('tbody tr')) {
      const cells = row.querySelectorAll('td')
      const entry = {
        participante: cleanText(cells[0]?.text),
        rut: cleanText(cells[1]?.text),
        persona: cleanText(cells[2]?.text),
        nombre: cleanText(cells[3]?.text),
      }
      if (entry.participante || entry.nombre) litigantes.push(entry)
    }
  }

  const notificaciones: TabsData['notificaciones'] = []
  const notifTab = root.querySelector('#notificacionesCiv')
  if (notifTab) {
    for (const row of notifTab.querySelectorAll('tbody tr')) {
      const cells = row.querySelectorAll('td')
      const entry = {
        rol: cleanText(cells[0]?.text),
        estado_notif: cleanText(cells[1]?.text),
        tipo_notif: cleanText(cells[2]?.text),
        fecha_tramite: cleanText(cells[3]?.text),
        tipo_participante: cleanText(cells[4]?.text),
        nombre: cleanText(cells[5]?.text),
        tramite: cleanText(cells[6]?.text),
        obs_fallida: cleanText(cells[7]?.text),
      }
      if (entry.rol || entry.tipo_notif) notificaciones.push(entry)
    }
  }

  const escritos_por_resolver: TabsData['escritos_por_resolver'] = []
  const escritosTab = root.querySelector('#escritosCiv')
  if (escritosTab) {
    for (const row of escritosTab.querySelectorAll('tbody tr')) {
      const cells = row.querySelectorAll('td')
      const jwt_doc = cells[0] ? extractFormJwt(cells[0], 'docuS.php', 'docuN.php') : null
      const entry = {
        doc: cleanText(cells[0]?.text),
        anexo: cleanText(cells[1]?.text),
        fecha_ingreso: cleanText(cells[2]?.text),
        tipo_escrito: cleanText(cells[3]?.text),
        solicitante: cleanText(cells[4]?.text),
        jwt_doc,
      }
      if (entry.tipo_escrito || entry.fecha_ingreso) escritos_por_resolver.push(entry)
    }
  }

  const exhortos: TabsData['exhortos'] = []
  const exhTab = root.querySelector('#exhortosCiv')
  if (exhTab) {
    for (const row of exhTab.querySelectorAll('tbody tr')) {
      const cells = row.querySelectorAll('td')
      let jwt_detalle: string | null = null
      if (cells[2]) {
        const label = cells[2].querySelector('label[onclick*="detalleExhortosCivil"]')
        if (label) {
          jwt_detalle = extractJwtFromOnclick(
            label.getAttribute('onclick') || '', 'detalleExhortosCivil'
          )
        }
      }
      const entry = {
        rol_origen: cleanText(cells[0]?.text),
        tipo_exhorto: cleanText(cells[1]?.text),
        rol_destino: cleanText(cells[2]?.text),
        fecha_ordena: cleanText(cells[3]?.text),
        fecha_ingreso: cleanText(cells[4]?.text),
        tribunal_destino: cleanText(cells[5]?.text),
        estado_exhorto: cleanText(cells[6]?.text),
        jwt_detalle,
      }
      if (entry.rol_origen || entry.tipo_exhorto) exhortos.push(entry)
    }
  }

  return { litigantes, notificaciones, escritos_por_resolver, exhortos }
}

/**
 * Merge tabs from a secondary cuaderno into the primary tabs.
 * Adds rows that don't already exist (dedup by stringified comparison).
 */
export function mergeTabsData(primary: TabsData, secondary: TabsData): TabsData {
  const dedup = <T>(existing: T[], incoming: T[]): T[] => {
    const seen = new Set(existing.map(r => JSON.stringify(r)))
    const newRows = incoming.filter(r => !seen.has(JSON.stringify(r)))
    return [...existing, ...newRows]
  }

  return {
    litigantes: dedup(primary.litigantes, secondary.litigantes),
    notificaciones: dedup(primary.notificaciones, secondary.notificaciones),
    escritos_por_resolver: dedup(primary.escritos_por_resolver, secondary.escritos_por_resolver),
    exhortos: dedup(primary.exhortos, secondary.exhortos),
  }
}

// ════════════════════════════════════════════════════════
// EXHORTO DETALLE PARSER
// ════════════════════════════════════════════════════════

/**
 * Parse the HTML response of detalleExhortosCivil.php.
 * The modal contains a table with columns: Doc | Fecha | Referencia | Trámite
 * where Doc has forms with action="docDetalleExhorto.php" and input[name="dtaDoc"].
 */
export function parseExhortoDetalleFromHtml(html: string): ExhortoDetalleDoc[] {
  const root = parseHtml(html, {
    lowerCaseTagName: true,
    comment: false,
    voidTag: { closingSlash: true },
  })

  const docs: ExhortoDetalleDoc[] = []
  const rows = root.querySelectorAll('tbody tr')

  for (const row of rows) {
    const cells = row.querySelectorAll('td')
    if (cells.length < 3) continue

    const docCell = cells[0]
    const jwt = extractFormJwt(docCell, 'docDetalleExhorto.php')
    if (!jwt) continue

    docs.push({
      jwt,
      fecha: cleanText(cells[1]?.text),
      referencia: cleanText(cells[2]?.text),
      tramite: cleanText(cells[3]?.text),
    })
  }

  return docs
}

// ════════════════════════════════════════════════════════
// RECEPTOR PARSER — Tarea 4.20
// ════════════════════════════════════════════════════════

/**
 * Parsea la respuesta HTML de receptorCivil.php (#modalReceptorCivil).
 *
 * HTML real PJUD — tabla única con headers:
 *   Cuaderno | Datos del Retiro | Fecha Retiro | Estado
 *
 * "Datos del Retiro" contiene el nombre del receptor (idéntico en todas
 * las filas de una misma causa). receptor_nombre se infiere del valor
 * más frecuente en esa columna.
 */
export function parseReceptorData(html: string): ReceptorData {
  const root = parseHtml(html, {
    lowerCaseTagName: true,
    comment: false,
    voidTag: { closingSlash: true },
  })

  const retiros: ReceptorData['retiros'] = []

  const rows = root.querySelectorAll('tbody tr')
  for (const row of rows) {
    const cells = row.querySelectorAll('td')
    if (cells.length < 4) continue

    const cuaderno = cleanText(cells[0]?.text)
    const datos_retiro = cleanText(cells[1]?.text)
    const fecha_retiro = cleanText(cells[2]?.text)
    const estado = cleanText(cells[3]?.text)

    if (!cuaderno && !datos_retiro) continue

    retiros.push({ cuaderno, datos_retiro, fecha_retiro, estado })
  }

  // Inferir receptor_nombre del valor más frecuente en "Datos del Retiro"
  let receptor_nombre: string | null = null
  if (retiros.length > 0) {
    const freq = new Map<string, number>()
    for (const r of retiros) {
      if (r.datos_retiro) {
        freq.set(r.datos_retiro, (freq.get(r.datos_retiro) || 0) + 1)
      }
    }
    let maxCount = 0
    for (const [name, count] of freq) {
      if (count > maxCount) {
        maxCount = count
        receptor_nombre = name
      }
    }
  }

  return { receptor_nombre, retiros }
}
