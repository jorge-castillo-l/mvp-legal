/**
 * ============================================================
 * Case Structured Context — Complemento RAG (Todas las tablas, condicional)
 * ============================================================
 * Inyecta datos estructurados de la causa como contexto para el chat.
 * Todas las tablas se consultan en paralelo; las secciones sin datos
 * se omiten del texto final (costo en tokens = 0 para tablas vacías).
 *
 * Tablas siempre presentes:
 *   cases, case_cuadernos, case_folios, case_litigantes,
 *   case_escritos, case_notificaciones
 *
 * Tablas condicionales (solo si tienen datos):
 *   case_folio_anexos, case_anexos_causa, case_receptor_retiros,
 *   case_exhortos, case_exhorto_docs, case_piezas_exhorto,
 *   case_remisiones, case_remision_movimientos, case_remision_mov_anexos,
 *   case_remision_litigantes, case_remision_exhortos,
 *   case_remision_incompetencias
 *
 * ChunkId prefijado 'case-structured-' para evitar dedup en enhanced-pipeline.
 * ============================================================
 */

import { createAdminClient } from '@/lib/supabase/server'
import type { AIContextChunk } from '../types'

// ── Interfaces DB ────────────────────────────────────────────

interface DbCase {
  rol: string
  caratula: string | null
  tribunal: string | null
  materia: string | null
  procedimiento: string | null
  fecha_ingreso: string | null
  estado: string | null
  estado_procesal: string | null
  etapa: string | null
  ubicacion: string | null
  libro_tipo: string | null
  causa_origen_rol: string | null
  causa_origen_tribunal: string | null
}

interface DbCuaderno {
  id: string
  nombre: string
  procedimiento: string | null
  etapa: string | null
  posicion: number
}

interface DbFolio {
  id: string
  cuaderno_id: string
  numero_folio: number
  etapa: string | null
  tramite: string | null
  desc_tramite: string | null
  fecha_tramite: string | null
  foja: number
  tiene_doc_principal: boolean
  tiene_certificado_escrito: boolean
  tiene_anexo_solicitud: boolean
}

interface DbLitigante {
  cuaderno_id: string
  participante: string | null
  rut: string | null
  nombre_razon_social: string | null
}

interface DbEscrito {
  cuaderno_id: string
  tipo_escrito: string | null
  fecha_ingreso: string | null
  solicitante: string | null
  tiene_doc: boolean | null
  tiene_anexo: boolean | null
}

interface DbNotificacion {
  cuaderno_id: string
  tramite: string | null
  fecha_tramite: string | null
  tipo_notif: string | null
  tipo_participante: string | null
  nombre: string | null
  estado_notif: string | null
  obs_fallida: string | null
}

interface DbFolioAnexo {
  folio_id: string
  referencia: string | null
  fecha: string | null
}

interface DbAnexoCausa {
  referencia: string | null
  fecha: string | null
}

interface DbReceptorRetiro {
  cuaderno: string | null
  datos_retiro: string | null
  estado: string | null
  fecha_retiro: string | null
}

interface DbExhorto {
  id: string
  tipo_exhorto: string | null
  estado_exhorto: string | null
  fecha_ordena: string | null
  fecha_ingreso: string | null
  rol_origen: string | null
  rol_destino: string | null
  tribunal_destino: string | null
}

interface DbExhortoDoc {
  exhorto_id: string
  tramite: string | null
  referencia: string | null
  fecha: string | null
}

interface DbPiezaExhorto {
  cuaderno_id: string
  cuaderno_pieza: string | null
  numero_folio: number
  tramite: string | null
  desc_tramite: string | null
  fecha_tramite: string | null
  foja: number | null
  tiene_doc: boolean | null
}

interface DbRemision {
  id: string
  corte: string | null
  recurso: string | null
  libro: string | null
  fecha: string | null
  estado_recurso: string | null
  estado_procesal: string | null
  ubicacion: string | null
  exp_caratulado: string | null
  exp_materia: string | null
  exp_tribunal: string | null
}

interface DbRemisionMov {
  id: string
  remision_id: string
  numero_folio: number
  tramite: string | null
  descripcion: string | null
  fecha: string | null
  estado: string | null
  sala: string | null
}

interface DbRemisionMovAnexo {
  movimiento_id: string
  tipo_documento: string | null
  codigo: string | null
  cantidad: string | null
  observacion: string | null
}

interface DbRemisionLitigante {
  remision_id: string
  sujeto: string | null
  nombre_razon_social: string | null
  rut: string | null
  persona: string | null
}

interface DbRemisionExhorto {
  remision_id: string
  exhorto: string | null
}

interface DbRemisionIncompetencia {
  remision_id: string
  incompetencia: string | null
}

// ── All fetched data in a single bag ─────────────────────────

interface CaseData {
  caso: DbCase | null
  cuadernos: DbCuaderno[]
  folios: DbFolio[]
  litigantes: DbLitigante[]
  escritos: DbEscrito[]
  notificaciones: DbNotificacion[]
  folioAnexos: DbFolioAnexo[]
  anexosCausa: DbAnexoCausa[]
  receptorRetiros: DbReceptorRetiro[]
  exhortos: DbExhorto[]
  exhortoDocs: DbExhortoDoc[]
  piezasExhorto: DbPiezaExhorto[]
  remisiones: DbRemision[]
  remMovs: DbRemisionMov[]
  remMovAnexos: DbRemisionMovAnexo[]
  remLitigantes: DbRemisionLitigante[]
  remExhortos: DbRemisionExhorto[]
  remIncompetencias: DbRemisionIncompetencia[]
}

// ── Public types ─────────────────────────────────────────────

export interface CaseMetadataFromContext {
  procedimiento: string | null
  rol: string
  tribunal: string | null
}

export interface StructuredContextResult {
  chunk: AIContextChunk
  caseMeta: CaseMetadataFromContext
}

// ── Query-based section filtering ────────────────────────────
// Core sections (DATOS GENERALES, LITIGANTES, CUADERNO) are always included.
// Secondary sections are only included if the query matches relevant keywords.

interface SectionFilter {
  header: string
  keywords: string[]
}

const SECONDARY_SECTIONS: SectionFilter[] = [
  { header: 'ESCRITOS PRESENTADOS:', keywords: ['escrito', 'presentación', 'presentacion', 'solicitud', 'demanda', 'contestación', 'contestacion', 'réplica', 'replica', 'dúplica', 'duplica', 'ingreso'] },
  { header: 'NOTIFICACIONES:', keywords: ['notific', 'notif', 'cédula', 'cedula', 'estado diario', 'personal', 'plazo', 'vencimiento', 'rebeldía', 'rebeldia'] },
  { header: 'ANEXOS DE LA CAUSA:', keywords: ['anexo', 'adjunto', 'documento adjunt'] },
  { header: 'RETIROS DE RECEPTOR:', keywords: ['receptor', 'retiro', 'ministro de fe', 'requerimiento', 'embargo', 'lanzamiento'] },
  { header: 'EXHORTOS:', keywords: ['exhorto', 'tribunal exhortado', 'jurisdicción', 'jurisdiccion'] },
  { header: 'PIEZAS DE EXHORTO:', keywords: ['exhorto', 'pieza'] },
  { header: 'RECURSOS EN CORTE (REMISIONES):', keywords: ['apelación', 'apelacion', 'recurso', 'remisión', 'remision', 'corte', 'casación', 'casacion', 'alzada', 'segunda instancia'] },
]

function filterContextByQuery(fullText: string, query: string): string {
  const lowerQuery = query.toLowerCase()

  const allRelevant = SECONDARY_SECTIONS.every(
    s => s.keywords.some(kw => lowerQuery.includes(kw)),
  )
  if (allRelevant) return fullText

  const lines = fullText.split('\n')
  const result: string[] = []
  let currentSection: string | null = null
  let includeCurrent = true

  for (const line of lines) {
    const matchedSection = SECONDARY_SECTIONS.find(s => line.startsWith(s.header))
    if (matchedSection) {
      currentSection = matchedSection.header
      includeCurrent = matchedSection.keywords.some(kw => lowerQuery.includes(kw))
      if (includeCurrent) result.push(line)
      continue
    }

    const isCoreHeader = line.startsWith('===') || line.startsWith('DATOS GENERALES:') ||
      line.startsWith('LITIGANTES:') || line.startsWith('CUADERNO:') || line.startsWith('NOTA:')
    if (isCoreHeader) {
      currentSection = null
      includeCurrent = true
    }

    if (includeCurrent) result.push(line)
  }

  return result.join('\n')
}

/**
 * Returns a context chunk filtered by query relevance.
 * Core sections always included; secondary sections only if query matches.
 */
export function getFilteredContextChunk(
  structuredResult: StructuredContextResult,
  query: string,
): AIContextChunk {
  const filtered = filterContextByQuery(structuredResult.chunk.text, query)
  if (filtered === structuredResult.chunk.text) return structuredResult.chunk
  return {
    ...structuredResult.chunk,
    text: filtered,
  }
}

// ── In-memory cache (TTL-based, invalidated per caseId) ─────

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

interface CacheEntry {
  result: StructuredContextResult | null
  expiresAt: number
}

const _cache = new Map<string, CacheEntry>()

export function invalidateCaseContextCache(caseId: string): void {
  _cache.delete(caseId)
}

// ── Fetch & Build ────────────────────────────────────────────

export async function fetchCaseStructuredContext(
  caseId: string,
): Promise<StructuredContextResult | null> {
  const cached = _cache.get(caseId)
  if (cached && Date.now() < cached.expiresAt) {
    console.log(`[case-context] CACHE HIT caseId=${caseId}`)
    return cached.result
  }

  const db = createAdminClient()
  const q = db as any

  const [
    caseRes, cuadernosRes, foliosRes, litigantesRes,
    escritosRes, notifsRes,
    folioAnexosRes, anexosCausaRes, receptorRetirosRes,
    exhortosRes, exhortoDocsRes, piezasExhortoRes,
    remisionesRes, remMovsRes, remMovAnexosRes,
    remLitigantesRes, remExhortosRes, remIncompetenciasRes,
  ] = await Promise.all([
    q.from('cases')
      .select('rol, caratula, tribunal, materia, procedimiento, fecha_ingreso, estado, estado_procesal, etapa, ubicacion, libro_tipo, causa_origen_rol, causa_origen_tribunal')
      .eq('id', caseId).single() as Promise<{ data: DbCase | null }>,
    q.from('case_cuadernos')
      .select('id, nombre, procedimiento, etapa, posicion')
      .eq('case_id', caseId).order('posicion') as Promise<{ data: DbCuaderno[] | null }>,
    q.from('case_folios')
      .select('id, cuaderno_id, numero_folio, etapa, tramite, desc_tramite, fecha_tramite, foja, tiene_doc_principal, tiene_certificado_escrito, tiene_anexo_solicitud')
      .eq('case_id', caseId) as Promise<{ data: DbFolio[] | null }>,
    q.from('case_litigantes')
      .select('cuaderno_id, participante, rut, nombre_razon_social')
      .eq('case_id', caseId) as Promise<{ data: DbLitigante[] | null }>,
    q.from('case_escritos')
      .select('cuaderno_id, tipo_escrito, fecha_ingreso, solicitante, tiene_doc, tiene_anexo')
      .eq('case_id', caseId).order('fecha_ingreso', { ascending: true }) as Promise<{ data: DbEscrito[] | null }>,
    q.from('case_notificaciones')
      .select('cuaderno_id, tramite, fecha_tramite, tipo_notif, tipo_participante, nombre, estado_notif, obs_fallida')
      .eq('case_id', caseId).order('fecha_tramite', { ascending: true }) as Promise<{ data: DbNotificacion[] | null }>,
    q.from('case_folio_anexos')
      .select('folio_id, referencia, fecha')
      .eq('case_id', caseId) as Promise<{ data: DbFolioAnexo[] | null }>,
    q.from('case_anexos_causa')
      .select('referencia, fecha')
      .eq('case_id', caseId) as Promise<{ data: DbAnexoCausa[] | null }>,
    q.from('case_receptor_retiros')
      .select('cuaderno, datos_retiro, estado, fecha_retiro')
      .eq('case_id', caseId) as Promise<{ data: DbReceptorRetiro[] | null }>,
    q.from('case_exhortos')
      .select('id, tipo_exhorto, estado_exhorto, fecha_ordena, fecha_ingreso, rol_origen, rol_destino, tribunal_destino')
      .eq('case_id', caseId) as Promise<{ data: DbExhorto[] | null }>,
    q.from('case_exhorto_docs')
      .select('exhorto_id, tramite, referencia, fecha')
      .eq('case_id', caseId) as Promise<{ data: DbExhortoDoc[] | null }>,
    q.from('case_piezas_exhorto')
      .select('cuaderno_id, cuaderno_pieza, numero_folio, tramite, desc_tramite, fecha_tramite, foja, tiene_doc')
      .eq('case_id', caseId) as Promise<{ data: DbPiezaExhorto[] | null }>,
    q.from('case_remisiones')
      .select('id, corte, recurso, libro, fecha, estado_recurso, estado_procesal, ubicacion, exp_caratulado, exp_materia, exp_tribunal')
      .eq('case_id', caseId) as Promise<{ data: DbRemision[] | null }>,
    q.from('case_remision_movimientos')
      .select('id, remision_id, numero_folio, tramite, descripcion, fecha, estado, sala')
      .eq('case_id', caseId).order('numero_folio', { ascending: true }) as Promise<{ data: DbRemisionMov[] | null }>,
    q.from('case_remision_mov_anexos')
      .select('movimiento_id, tipo_documento, codigo, cantidad, observacion')
      .eq('case_id', caseId) as Promise<{ data: DbRemisionMovAnexo[] | null }>,
    q.from('case_remision_litigantes')
      .select('remision_id, sujeto, nombre_razon_social, rut, persona')
      .eq('case_id', caseId) as Promise<{ data: DbRemisionLitigante[] | null }>,
    q.from('case_remision_exhortos')
      .select('remision_id, exhorto')
      .eq('case_id', caseId) as Promise<{ data: DbRemisionExhorto[] | null }>,
    q.from('case_remision_incompetencias')
      .select('remision_id, incompetencia')
      .eq('case_id', caseId) as Promise<{ data: DbRemisionIncompetencia[] | null }>,
  ])

  const data: CaseData = {
    caso: caseRes.data,
    cuadernos: cuadernosRes.data ?? [],
    folios: foliosRes.data ?? [],
    litigantes: litigantesRes.data ?? [],
    escritos: escritosRes.data ?? [],
    notificaciones: notifsRes.data ?? [],
    folioAnexos: folioAnexosRes.data ?? [],
    anexosCausa: anexosCausaRes.data ?? [],
    receptorRetiros: receptorRetirosRes.data ?? [],
    exhortos: exhortosRes.data ?? [],
    exhortoDocs: exhortoDocsRes.data ?? [],
    piezasExhorto: piezasExhortoRes.data ?? [],
    remisiones: remisionesRes.data ?? [],
    remMovs: remMovsRes.data ?? [],
    remMovAnexos: remMovAnexosRes.data ?? [],
    remLitigantes: remLitigantesRes.data ?? [],
    remExhortos: remExhortosRes.data ?? [],
    remIncompetencias: remIncompetenciasRes.data ?? [],
  }

  if (!data.caso && data.cuadernos.length === 0) {
    _cache.set(caseId, { result: null, expiresAt: Date.now() + CACHE_TTL_MS })
    return null
  }

  const text = formatStructuredContext(data)
  const approxTokens = Math.ceil(text.length / 4)
  console.log(
    `[case-context] caseId=${caseId} chars=${text.length} ~tokens=${approxTokens} ` +
    `folios=${data.folios.length} escritos=${data.escritos.length} notifs=${data.notificaciones.length} ` +
    `exhortos=${data.exhortos.length} remisiones=${data.remisiones.length}`,
  )

  const result: StructuredContextResult = {
    chunk: {
      chunkId: 'case-structured-context',
      text,
      metadata: {
        documentType: 'structured_context',
        sectionType: 'case_overview',
      },
    },
    caseMeta: {
      procedimiento: data.caso?.procedimiento ?? null,
      rol: data.caso?.rol ?? '',
      tribunal: data.caso?.tribunal ?? null,
    },
  }

  _cache.set(caseId, { result, expiresAt: Date.now() + CACHE_TTL_MS })
  return result
}

// ── Formatters ───────────────────────────────────────────────

function formatStructuredContext(d: CaseData): string {
  const lines: string[] = [
    '=== DATOS COMPLETOS DE LA CAUSA (fuente de verdad del expediente) ===',
    '',
  ]

  fmtDatosGenerales(lines, d.caso)
  fmtLitigantes(lines, d.litigantes, d.cuadernos[0]?.id)
  fmtCuadernosFolios(lines, d.cuadernos, d.folios, d.folioAnexos)
  fmtEscritos(lines, d.escritos)
  fmtNotificaciones(lines, d.notificaciones)
  fmtAnexosCausa(lines, d.anexosCausa)
  fmtReceptorRetiros(lines, d.receptorRetiros)
  fmtExhortos(lines, d.exhortos, d.exhortoDocs, d.piezasExhorto)
  fmtRemisiones(lines, d.remisiones, d.remMovs, d.remMovAnexos, d.remLitigantes, d.remExhortos, d.remIncompetencias)

  lines.push('=== FIN DATOS DE LA CAUSA ===')
  lines.push('NOTA: Esta información es la fuente de verdad del expediente. El ebook de PJUD puede omitir Actuaciones de Receptor en su tabla de contenidos.')
  return lines.join('\n')
}

// ── Compact formatters (sin padding — optimizado para tokens) ──

function kv(parts: (string | null | false | undefined)[]): string {
  return parts.filter(Boolean).join(' | ')
}

function fmtDatosGenerales(lines: string[], caso: DbCase | null) {
  if (!caso) return
  lines.push('DATOS GENERALES:')
  const fields: [string, string | null][] = [
    ['ROL', caso.rol], ['Carátula', caso.caratula], ['Tribunal', caso.tribunal],
    ['Materia', caso.materia], ['Procedimiento', caso.procedimiento],
    ['Fecha ingreso', caso.fecha_ingreso], ['Estado', caso.estado],
    ['Estado procesal', caso.estado_procesal], ['Etapa', caso.etapa],
    ['Ubicación', caso.ubicacion], ['Libro', caso.libro_tipo],
  ]
  for (const [label, val] of fields) {
    if (val) lines.push(`  ${label}: ${val}`)
  }
  if (caso.causa_origen_rol) {
    lines.push(`  Causa origen: ${caso.causa_origen_rol} (${caso.causa_origen_tribunal || '—'})`)
  }
  lines.push('')
}

function fmtLitigantes(lines: string[], litigantes: DbLitigante[], firstCuadernoId?: string) {
  const filtered = firstCuadernoId ? litigantes.filter(l => l.cuaderno_id === firstCuadernoId) : litigantes
  if (filtered.length === 0) return
  lines.push('LITIGANTES:')
  for (const l of filtered) {
    lines.push(`- ${kv([l.participante, l.nombre_razon_social, l.rut])}`)
  }
  lines.push('')
}

function fmtCuadernosFolios(lines: string[], cuadernos: DbCuaderno[], folios: DbFolio[], folioAnexos: DbFolioAnexo[]) {
  for (const cuaderno of cuadernos) {
    const cuadernoFolios = folios
      .filter(f => f.cuaderno_id === cuaderno.id)
      .sort((a, b) => a.numero_folio - b.numero_folio)

    lines.push(`CUADERNO: ${cuaderno.nombre}`)
    if (cuaderno.procedimiento) lines.push(`  Procedimiento: ${cuaderno.procedimiento}`)
    if (cuaderno.etapa) lines.push(`  Etapa actual: ${cuaderno.etapa}`)
    lines.push(`  Total folios: ${cuadernoFolios.length}`)

    for (const f of cuadernoFolios) {
      lines.push(`  F${f.numero_folio}: ${kv([f.tramite, f.desc_tramite, f.fecha_tramite, f.foja != null && `foja ${f.foja}`, f.tiene_doc_principal && 'con doc'])}`)

      const anexos = folioAnexos.filter(a => a.folio_id === f.id)
      for (const a of anexos) {
        lines.push(`    -> Anexo: ${kv([a.referencia, a.fecha])}`)
      }
    }
    lines.push('')
  }
}

function fmtEscritos(lines: string[], escritos: DbEscrito[]) {
  if (escritos.length === 0) return
  lines.push('ESCRITOS PRESENTADOS:')
  for (const e of escritos) {
    lines.push(`- ${kv([e.fecha_ingreso, e.tipo_escrito, e.solicitante, e.tiene_doc && 'con doc', e.tiene_anexo && 'con anexo'])}`)
  }
  lines.push('')
}

function fmtNotificaciones(lines: string[], notificaciones: DbNotificacion[]) {
  if (notificaciones.length === 0) return
  lines.push('NOTIFICACIONES:')
  for (const n of notificaciones) {
    const base = kv([n.fecha_tramite, n.tramite, n.tipo_notif, n.nombre || n.tipo_participante, n.estado_notif])
    lines.push(`- ${base}${n.obs_fallida ? ` (${n.obs_fallida})` : ''}`)
  }
  lines.push('')
}

function fmtAnexosCausa(lines: string[], anexos: DbAnexoCausa[]) {
  if (anexos.length === 0) return
  lines.push('ANEXOS DE LA CAUSA:')
  for (const a of anexos) {
    lines.push(`- ${kv([a.referencia, a.fecha])}`)
  }
  lines.push('')
}

function fmtReceptorRetiros(lines: string[], retiros: DbReceptorRetiro[]) {
  if (retiros.length === 0) return
  lines.push('RETIROS DE RECEPTOR:')
  for (const r of retiros) {
    lines.push(`- ${kv([r.fecha_retiro, r.cuaderno, r.estado, r.datos_retiro])}`)
  }
  lines.push('')
}

function fmtExhortos(lines: string[], exhortos: DbExhorto[], docs: DbExhortoDoc[], piezas: DbPiezaExhorto[]) {
  if (exhortos.length === 0) return
  lines.push('EXHORTOS:')
  for (const ex of exhortos) {
    lines.push(`- ${kv([ex.tipo_exhorto, ex.estado_exhorto, ex.tribunal_destino])}`)
    const detail = kv([
      ex.rol_origen && `ROL origen: ${ex.rol_origen}`,
      ex.rol_destino && `ROL destino: ${ex.rol_destino}`,
      ex.fecha_ordena && `ordena: ${ex.fecha_ordena}`,
      ex.fecha_ingreso && `ingreso: ${ex.fecha_ingreso}`,
    ])
    if (detail) lines.push(`  ${detail}`)

    const exDocs = docs.filter(d => d.exhorto_id === ex.id)
    for (const d of exDocs) {
      lines.push(`  Doc: ${kv([d.tramite, d.referencia, d.fecha])}`)
    }
  }

  if (piezas.length > 0) {
    lines.push('PIEZAS DE EXHORTO:')
    for (const p of piezas) {
      lines.push(`  P${p.numero_folio}: ${kv([p.tramite, p.desc_tramite, p.fecha_tramite, p.foja != null && `foja ${p.foja}`, p.tiene_doc && 'con doc'])}`)
    }
  }
  lines.push('')
}

function fmtRemisiones(
  lines: string[],
  remisiones: DbRemision[],
  movs: DbRemisionMov[],
  movAnexos: DbRemisionMovAnexo[],
  litigs: DbRemisionLitigante[],
  exhortos: DbRemisionExhorto[],
  incomp: DbRemisionIncompetencia[],
) {
  if (remisiones.length === 0) return
  lines.push('RECURSOS EN CORTE (REMISIONES):')

  for (const r of remisiones) {
    lines.push(`- ${kv([r.recurso, r.corte, r.libro, r.fecha])}`)
    const detail = kv([
      r.estado_recurso && `estado recurso: ${r.estado_recurso}`,
      r.estado_procesal && `estado procesal: ${r.estado_procesal}`,
      r.ubicacion && `ubicación: ${r.ubicacion}`,
    ])
    if (detail) lines.push(`  ${detail}`)
    if (r.exp_caratulado) lines.push(`  Exp: ${kv([r.exp_caratulado, r.exp_materia, r.exp_tribunal])}`)

    const rLitigs = litigs.filter(l => l.remision_id === r.id)
    for (const l of rLitigs) {
      lines.push(`  Parte: ${kv([l.sujeto, l.nombre_razon_social, l.rut])}`)
    }

    const rExh = exhortos.filter(e => e.remision_id === r.id)
    for (const e of rExh) { if (e.exhorto) lines.push(`  Exhorto: ${e.exhorto}`) }

    const rInc = incomp.filter(i => i.remision_id === r.id)
    for (const i of rInc) { if (i.incompetencia) lines.push(`  Incompetencia: ${i.incompetencia}`) }

    const rMovs = movs
      .filter(m => m.remision_id === r.id)
      .sort((a, b) => a.numero_folio - b.numero_folio)

    if (rMovs.length > 0) {
      lines.push('  Movimientos:')
      for (const m of rMovs) {
        lines.push(`  M${m.numero_folio}: ${kv([m.tramite, m.descripcion, m.fecha, m.estado, m.sala && `sala ${m.sala}`])}`)
        const mAnexos = movAnexos.filter(a => a.movimiento_id === m.id)
        for (const a of mAnexos) {
          lines.push(`    -> Anexo: ${kv([a.tipo_documento, a.codigo, a.cantidad && `cant: ${a.cantidad}`, a.observacion])}`)
        }
      }
    }
  }
  lines.push('')
}
