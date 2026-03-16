/**
 * ============================================================
 * PJUD HTML Parser — Server-side
 * ============================================================
 * Parsea las respuestas HTML de endpoints PJUD:
 *   - causaCivil.php       → CuadernoData completo (folios, tabs, proc, etapa)
 *   - receptorCivil.php    → ReceptorRetiro[]
 *   - anexoCausaCivil.php  → AnexoFile[]
 *   - detalleExhortos.php  → ExhortoDetalleDoc[]
 *   - causaApelaciones.php → ApelacionDetail
 *   - anexoEscritoApelaciones.php → AnexoEscritoApelacion[]
 *
 * Utiliza node-html-parser para parsing robusto del DOM server-side.
 * ============================================================
 */

import { parse as parseHtml, HTMLElement } from 'node-html-parser'
import type {
  AnexoFile,
  AnexoEscritoApelacion,
  ApelacionDetail, ApelacionDirectJwts, ApelacionExpediente,
  ApelacionFolio, ApelacionLitigante, ApelacionMetadata, ApelacionTabsData,
  CuadernoData,
  ExhortoDetalleDoc, ExhortoEntry,
  Escrito, Folio, JwtRef,
  Litigante, Notificacion, PiezaExhorto,
  ReceptorRetiro,
} from './types'

// ════════════════════════════════════════════════════════
// CUADERNO COMPLETO — parsea el HTML de causaCivil.php
// ════════════════════════════════════════════════════════

/**
 * Parsea la respuesta HTML de causaCivil.php para un cuaderno.
 * Extrae: proc, etapa, folios, litigantes, notificaciones, escritos, piezas exhorto, exhortos.
 */
export function parseCuadernoFromHtml(html: string, cuadernoNombre: string): {
  cuaderno: CuadernoData
  exhortos: ExhortoEntry[]
} {
  const root = parseHtml(html, {
    lowerCaseTagName: true,
    comment: false,
    voidTag: { closingSlash: true },
  })

  const { procedimiento, etapa } = parseProcEtapa(root)

  return {
    cuaderno: {
      nombre: cuadernoNombre,
      procedimiento,
      etapa,
      folios: parseFoliosFromRoot(root),
      litigantes: parseLitigantesFromRoot(root),
      notificaciones: parseNotificacionesFromRoot(root),
      escritos: parseEscritosFromRoot(root),
      piezas_exhorto: parsePiezasExhortoFromRoot(root),
    },
    exhortos: parseExhortosFromRoot(root),
  }
}

function parseProcEtapa(root: HTMLElement): { procedimiento: string | null; etapa: string | null } {
  let procedimiento: string | null = null
  let etapa: string | null = null

  const tables = root.querySelectorAll('table.table-titulos')
  if (tables.length === 0) return { procedimiento, etapa }

  const metaTable = tables[0]
  const rows = metaTable.querySelectorAll('tbody > tr')

  if (rows[1]) {
    for (const cell of rows[1].querySelectorAll('td')) {
      const text = cleanText(cell.text)
      const procMatch = text.match(/Proc\.\s*:?\s*(.+)/i)
      if (procMatch) procedimiento = procMatch[1].trim()
    }
  }

  if (rows[2]) {
    for (const cell of rows[2].querySelectorAll('td')) {
      const text = cleanText(cell.text)
      const etapaMatch = text.match(/Etapa\s*:?\s*(.+)/i)
      if (etapaMatch) etapa = etapaMatch[1].trim()
    }
  }

  return { procedimiento, etapa }
}

// ════════════════════════════════════════════════════════
// FOLIOS — T10b: tabla Historia
// ════════════════════════════════════════════════════════

export function parseFoliosFromHtml(html: string): Folio[] {
  const root = parseHtml(html, {
    lowerCaseTagName: true,
    comment: false,
    voidTag: { closingSlash: true },
  })
  return parseFoliosFromRoot(root)
}

function parseFoliosFromRoot(root: HTMLElement): Folio[] {
  const folios: Folio[] = []
  const historiaTab = root.querySelector('#historiaCiv')
  if (!historiaTab) return folios

  const rows = historiaTab.querySelectorAll('tbody tr')
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

  return {
    numero: folioNum,
    etapa: cleanText(cells[3]?.text),
    tramite: cleanText(cells[4]?.text),
    desc_tramite: cleanText(cells[5]?.text),
    fecha_tramite: cleanText(cells[6]?.text),
    foja: parseInt(cleanText(cells[7]?.text), 10) || 0,
    tiene_doc_principal: !!jwtDocPrincipal,
    tiene_certificado_escrito: !!jwtCertEscrito,
    tiene_anexo_solicitud: !!jwtAnexoSolicitud,
    jwt_doc_principal: jwtDocPrincipal,
    jwt_certificado_escrito: jwtCertEscrito,
    jwt_anexo_solicitud: jwtAnexoSolicitud,
  }
}

// ════════════════════════════════════════════════════════
// LITIGANTES — T10c
// ════════════════════════════════════════════════════════

function parseLitigantesFromRoot(root: HTMLElement): Litigante[] {
  const litigantes: Litigante[] = []
  const litTab = root.querySelector('#litigantesCiv')
  if (!litTab) return litigantes

  for (const row of litTab.querySelectorAll('tbody tr')) {
    const cells = row.querySelectorAll('td')
    const entry: Litigante = {
      participante: cleanText(cells[0]?.text),
      rut: cleanText(cells[1]?.text),
      persona: cleanText(cells[2]?.text),
      nombre_razon_social: cleanText(cells[3]?.text),
    }
    if (entry.participante || entry.nombre_razon_social) litigantes.push(entry)
  }

  return litigantes
}

// ════════════════════════════════════════════════════════
// NOTIFICACIONES — T10d
// ════════════════════════════════════════════════════════

function parseNotificacionesFromRoot(root: HTMLElement): Notificacion[] {
  const notificaciones: Notificacion[] = []
  const notifTab = root.querySelector('#notificacionesCiv')
  if (!notifTab) return notificaciones

  for (const row of notifTab.querySelectorAll('tbody tr')) {
    const cells = row.querySelectorAll('td')
    const entry: Notificacion = {
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

  return notificaciones
}

// ════════════════════════════════════════════════════════
// ESCRITOS POR RESOLVER — T10e
// ════════════════════════════════════════════════════════

function parseEscritosFromRoot(root: HTMLElement): Escrito[] {
  const escritos: Escrito[] = []
  const escritosTab = root.querySelector('#escritosCiv')
  if (!escritosTab) return escritos

  for (const row of escritosTab.querySelectorAll('tbody tr')) {
    const cells = row.querySelectorAll('td')
    const jwtDoc = cells[0] ? extractFormJwt(cells[0], 'docuS.php', 'docuN.php') : null

    const entry: Escrito = {
      fecha_ingreso: cleanText(cells[2]?.text),
      tipo_escrito: cleanText(cells[3]?.text),
      solicitante: cleanText(cells[4]?.text),
      tiene_doc: !!jwtDoc,
      tiene_anexo: !!(cells[1] && cells[1].querySelector('a')),
      jwt_doc: jwtDoc,
    }
    if (entry.tipo_escrito || entry.fecha_ingreso) escritos.push(entry)
  }

  return escritos
}

// ════════════════════════════════════════════════════════
// EXHORTOS — T6 (del tab #exhortosCiv)
// ════════════════════════════════════════════════════════

function parseExhortosFromRoot(root: HTMLElement): ExhortoEntry[] {
  const exhortos: ExhortoEntry[] = []
  const exhTab = root.querySelector('#exhortosCiv')
  if (!exhTab) return exhortos

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
    const entry: ExhortoEntry = {
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

  return exhortos
}

// ════════════════════════════════════════════════════════
// PIEZAS EXHORTO — T12 (solo causas tipo E)
// Columnas: Folio, Doc, Cuaderno, Anexo, Etapa, Trámite, Desc.Trámite, Fec.Trámite, Foja
// ════════════════════════════════════════════════════════

function parsePiezasExhortoFromRoot(root: HTMLElement): PiezaExhorto[] {
  const piezas: PiezaExhorto[] = []
  const tab = root.querySelector('#piezasExhortoCiv')
  if (!tab) return piezas

  const rows = tab.querySelectorAll('tbody tr')
  for (const row of rows) {
    const cells = row.querySelectorAll('td')
    if (cells.length < 8) continue

    const folioNum = parseInt(cleanText(cells[0]?.text), 10)
    if (isNaN(folioNum)) continue

    const jwtDoc = extractFormJwt(cells[1], 'docuS.php', 'docuN.php')

    piezas.push({
      numero_folio: folioNum,
      cuaderno_pieza: cleanText(cells[2]?.text),
      etapa: cleanText(cells[4]?.text),
      tramite: cleanText(cells[5]?.text),
      desc_tramite: cleanText(cells[6]?.text),
      fecha_tramite: cleanText(cells[7]?.text),
      foja: parseInt(cleanText(cells[8]?.text), 10) || 0,
      tiene_doc: !!jwtDoc,
      tiene_anexo: !!(cells[3] && cells[3].querySelector('a')),
      jwt_doc: jwtDoc,
    })
  }

  return piezas
}

// ════════════════════════════════════════════════════════
// ANEXOS DE LA CAUSA — T3 (anexoCausaCivil.php)
// ════════════════════════════════════════════════════════

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
// EXHORTO DETALLE — T7 (detalleExhortosCivil.php)
// ════════════════════════════════════════════════════════

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
// RECEPTOR — T4 (receptorCivil.php)
// ════════════════════════════════════════════════════════

export function parseReceptorRetiros(html: string): ReceptorRetiro[] {
  const root = parseHtml(html, {
    lowerCaseTagName: true,
    comment: false,
    voidTag: { closingSlash: true },
  })

  const retiros: ReceptorRetiro[] = []

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

  return retiros
}

// ════════════════════════════════════════════════════════
// APELACIONES — T8 (causaApelaciones.php)
// ════════════════════════════════════════════════════════

export function parseApelacionFromHtml(html: string): ApelacionDetail {
  const root = parseHtml(html, {
    lowerCaseTagName: true,
    comment: false,
    voidTag: { closingSlash: true },
  })

  return {
    metadata: parseApelacionMetadata(root),
    direct_jwts: parseApelacionDirectJwts(root),
    folios: parseApelacionFolios(root),
    tabs: parseApelacionTabs(root),
    expediente: parseApelacionExpediente(root),
  }
}

function parseApelacionMetadata(root: HTMLElement): ApelacionMetadata {
  const result: ApelacionMetadata = {
    libro: null, fecha: null, estado_recurso: null,
    estado_procesal: null, ubicacion: null, recurso: null, corte: null,
  }

  const tables = root.querySelectorAll('table.table-titulos')
  if (tables.length === 0) return result

  const metaTable = tables[0]
  const rows = metaTable.querySelectorAll('tbody > tr')

  if (rows[0]) {
    for (const cell of rows[0].querySelectorAll('td')) {
      const text = cleanText(cell.text)
      const libroMatch = text.match(/Libro\s*:?\s*(.+)/i)
      if (libroMatch) result.libro = libroMatch[1].trim()
      const fechaMatch = text.match(/Fecha\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i)
      if (fechaMatch) result.fecha = fechaMatch[1]
      const estadoRecMatch = text.match(/Estado\s+Recurso\s*:?\s*(.+)/i)
      if (estadoRecMatch) result.estado_recurso = estadoRecMatch[1].trim()
    }
  }

  if (rows[1]) {
    for (const cell of rows[1].querySelectorAll('td')) {
      const text = cleanText(cell.text)
      const epMatch = text.match(/Estado\s+Procesal\s*:?\s*(.+)/i)
      if (epMatch) result.estado_procesal = epMatch[1].trim()
      const ubiMatch = text.match(/Ubicaci[oó]n\s*:?\s*(.+)/i)
      if (ubiMatch) result.ubicacion = ubiMatch[1].trim()
      const recMatch = text.match(/Recurso\s*:?\s*(.+)/i)
      if (recMatch) result.recurso = recMatch[1].trim()
    }
  }

  if (rows[2]) {
    for (const cell of rows[2].querySelectorAll('td')) {
      const text = cleanText(cell.text)
      const corteMatch = text.match(/Corte\s*:?\s*(.+)/i)
      if (corteMatch) result.corte = corteMatch[1].trim()
    }
  }

  return result
}

function parseApelacionDirectJwts(root: HTMLElement): ApelacionDirectJwts {
  const result: ApelacionDirectJwts = {
    certificado_envio: null, ebook: null, texto: null, anexo_recurso: null,
  }

  const ebookForm = root.querySelector('form[action*="newebookapelaciones"]')
  if (ebookForm) {
    const input = ebookForm.querySelector('input[name="dtaEbook"]')
    const val = input?.getAttribute('value') || ''
    if (val.length > 20) {
      result.ebook = { jwt: val, action: ebookForm.getAttribute('action') || '', param: 'dtaEbook' }
    }
  }

  const tables = root.querySelectorAll('table.table-titulos')
  if (tables.length >= 2) {
    const docsTable = tables[1]

    const certForm = docsTable.querySelector('form[action*="docCertificado"]')
    if (certForm) {
      const input = certForm.querySelector('input[name="dtaCert"]')
      const val = input?.getAttribute('value') || ''
      if (val.length > 20) {
        result.certificado_envio = { jwt: val, action: certForm.getAttribute('action') || '', param: 'dtaCert' }
      }
    }

    const textoForm = docsTable.querySelector('form[action*="docTexto"], form[action*="docu"]')
    if (textoForm && textoForm !== ebookForm && textoForm !== certForm) {
      const input = textoForm.querySelector('input[type="hidden"]')
      const val = input?.getAttribute('value') || ''
      const name = input?.getAttribute('name') || ''
      if (val.length > 20) {
        result.texto = { jwt: val, action: textoForm.getAttribute('action') || '', param: name }
      }
    }

    const anexoLink = docsTable.querySelector('a[onclick*="anexo"]')
    if (anexoLink) {
      const onclick = anexoLink.getAttribute('onclick') || ''
      const jwtMatch = onclick.match(/(eyJ[A-Za-z0-9_-]+\.[\w_-]+\.[\w_-]+)/)
      if (jwtMatch) result.anexo_recurso = jwtMatch[1]
    }
  }

  return result
}

function parseApelacionFolios(root: HTMLElement): ApelacionFolio[] {
  const folios: ApelacionFolio[] = []

  const movTab = root.querySelector('#movimientosApe')
  if (!movTab) return folios

  const rows = movTab.querySelectorAll('tbody tr')
  for (const row of rows) {
    const cells = row.querySelectorAll('td')
    if (cells.length < 8) continue

    const num = parseInt(cleanText(cells[0]?.text), 10)
    if (isNaN(num)) continue

    const docCell = cells[1]
    const jwtDoc = extractFormJwt(docCell, 'docCausaApelaciones.php')
    const jwtCert = extractFormJwt(docCell, 'docCertificadoEscrito.php')

    let jwtAnexoEscrito: string | null = null
    if (cells[2]) {
      const anexoLink = cells[2].querySelector('a[onclick*="anexoEscritoApelaciones"]')
      if (anexoLink) {
        jwtAnexoEscrito = extractJwtFromOnclick(
          anexoLink.getAttribute('onclick') || '', 'anexoEscritoApelaciones'
        )
      }
    }

    const tramiteRaw = cleanText(cells[3]?.text)
    const descSpan = cells[4]?.querySelector('.topToolNom, span[title]')
    const descripcion = cleanText(descSpan?.text || cells[4]?.text)
    const nomenclaturas = descSpan?.getAttribute('title')?.trim() || null

    folios.push({
      numero: num,
      jwt_doc: jwtDoc,
      jwt_certificado_escrito: jwtCert,
      jwt_anexo_escrito: jwtAnexoEscrito,
      tramite: tramiteRaw,
      descripcion,
      nomenclaturas,
      fecha: cleanText(cells[5]?.text),
      sala: cleanText(cells[6]?.text),
      estado: cleanText(cells[7]?.text),
    })
  }

  return folios
}

function parseApelacionTabs(root: HTMLElement): ApelacionTabsData {
  const litigantes: ApelacionLitigante[] = []
  const litTab = root.querySelector('#litigantesApe')
  if (litTab) {
    for (const row of litTab.querySelectorAll('tbody tr')) {
      const cells = row.querySelectorAll('td')
      const entry: ApelacionLitigante = {
        sujeto: cleanText(cells[0]?.text),
        rut: cleanText(cells[1]?.text),
        persona: cleanText(cells[2]?.text),
        nombre_razon_social: cleanText(cells[3]?.text),
      }
      if (entry.sujeto || entry.nombre_razon_social) litigantes.push(entry)
    }
  }

  const exhortos: ApelacionTabsData['exhortos'] = []
  const exhTab = root.querySelector('#ExhortosApe')
  if (exhTab) {
    for (const row of exhTab.querySelectorAll('tbody tr')) {
      const cells = row.querySelectorAll('td')
      const text = cleanText(cells[1]?.text || cells[0]?.text)
      if (text) exhortos.push({ exhorto: text })
    }
  }

  const incompetencia: ApelacionTabsData['incompetencia'] = []
  const incTab = root.querySelector('#IncompetenciaApe')
  if (incTab) {
    for (const row of incTab.querySelectorAll('tbody tr')) {
      const cells = row.querySelectorAll('td')
      const text = cleanText(cells[1]?.text || cells[0]?.text)
      if (text) incompetencia.push({ incompetencia: text })
    }
  }

  return { litigantes, exhortos, incompetencia }
}

function parseApelacionExpediente(root: HTMLElement): ApelacionExpediente | null {
  const expTab = root.querySelector('#expedienteApe')
  if (!expTab) return null

  const table = expTab.querySelector('table.table-titulos')
  if (!table) return null

  const result: ApelacionExpediente = {
    causa_origen: null, tribunal: null, caratulado: null,
    materia: null, ruc: null, fecha_ingreso: null, jwt_detalle_civil: null,
  }

  const fullText = cleanText(table.text)

  const origenMatch = fullText.match(/Causa\s+Origen\s*:?\s*([A-Z]\s*-\s*\d{1,8}\s*-\s*\d{4})/i)
  if (origenMatch) result.causa_origen = origenMatch[1].replace(/\s+/g, '')

  const tribMatch = fullText.match(/Tribunal\s*:?\s*(.+?)(?:$|Caratulado|Materia|Ruc|Fecha)/i)
  if (tribMatch) result.tribunal = tribMatch[1].trim()

  const caratMatch = fullText.match(/Caratulado\s*:?\s*(.+?)(?:$|Materia|Ruc|Fecha)/i)
  if (caratMatch) result.caratulado = caratMatch[1].trim()

  const matMatch = fullText.match(/Materia\s*:?\s*(.+?)(?:$|Ruc|Fecha)/i)
  if (matMatch) result.materia = matMatch[1].trim()

  const rucMatch = fullText.match(/Ruc\s*:?\s*(\S+)/i)
  if (rucMatch) result.ruc = rucMatch[1].trim()

  const fechaMatch = fullText.match(/Fecha\s+Ingreso\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i)
  if (fechaMatch) result.fecha_ingreso = fechaMatch[1]

  const civilLink = table.querySelector('a[onclick*="detalleCausaCivil"]')
  if (civilLink) {
    result.jwt_detalle_civil = extractJwtFromOnclick(
      civilLink.getAttribute('onclick') || '', 'detalleCausaCivil'
    )
  }

  return result
}

// ════════════════════════════════════════════════════════
// ANEXO ESCRITO APELACIONES — T9 (anexoEscritoApelaciones.php)
// ════════════════════════════════════════════════════════

export function parseAnexoEscritoApelacionesFromHtml(html: string): AnexoEscritoApelacion[] {
  const root = parseHtml(html, {
    lowerCaseTagName: true,
    comment: false,
    voidTag: { closingSlash: true },
  })

  const anexos: AnexoEscritoApelacion[] = []
  const rows = root.querySelectorAll('tbody tr')

  for (const row of rows) {
    const cells = row.querySelectorAll('td')
    if (cells.length < 4) continue

    const docCell = cells[0]
    const jwt = extractFormJwt(docCell, 'anexoDocEscritoApelaciones.php')
    if (!jwt) continue

    anexos.push({
      jwt,
      codigo: cleanText(cells[1]?.text),
      tipo_documento: cleanText(cells[2]?.text),
      cantidad: cleanText(cells[3]?.text),
      observacion: cleanText(cells[4]?.text),
    })
  }

  return anexos
}

// ════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════

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
