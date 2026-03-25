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

// ── Fetch & Build ────────────────────────────────────────────

export async function fetchCaseStructuredContext(
  caseId: string,
): Promise<AIContextChunk | null> {
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

  if (!data.caso && data.cuadernos.length === 0) return null

  return {
    chunkId: 'case-structured-context',
    text: formatStructuredContext(data),
    metadata: {
      documentType: 'structured_context',
      sectionType: 'case_overview',
    },
  }
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

// ── Section formatters (cada una agrega líneas solo si hay datos) ──

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
    const parts = [l.participante, l.nombre_razon_social, l.rut].filter(Boolean)
    lines.push(`  - ${parts.join(' | ')}`)
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
    lines.push('')
    lines.push('  N° | Trámite              | Descripción                                      | Fecha       | Foja | Doc')
    lines.push('  ---|----------------------|--------------------------------------------------|-------------|------|----')

    for (const f of cuadernoFolios) {
      const num = String(f.numero_folio).padStart(2, ' ')
      const tramite = (f.tramite || '—').substring(0, 20).padEnd(20, ' ')
      const desc = (f.desc_tramite || '—').substring(0, 48).padEnd(48, ' ')
      const fecha = (f.fecha_tramite || '—').substring(0, 11).padEnd(11, ' ')
      const foja = String(f.foja).padStart(4, ' ')
      const doc = f.tiene_doc_principal ? 'Sí' : 'No'
      lines.push(`  ${num} | ${tramite} | ${desc} | ${fecha} | ${foja} | ${doc}`)

      const anexos = folioAnexos.filter(a => a.folio_id === f.id)
      for (const a of anexos) {
        const ref = a.referencia || '—'
        const af = a.fecha || ''
        lines.push(`       ↳ Anexo: ${ref}${af ? ` (${af})` : ''}`)
      }
    }
    lines.push('')
  }
}

function fmtEscritos(lines: string[], escritos: DbEscrito[]) {
  if (escritos.length === 0) return
  lines.push('ESCRITOS PRESENTADOS:')
  lines.push('  Fecha       | Tipo                           | Solicitante                    | Doc | Anexo')
  lines.push('  ------------|--------------------------------|--------------------------------|-----|------')
  for (const e of escritos) {
    const fecha = (e.fecha_ingreso || '—').substring(0, 11).padEnd(11, ' ')
    const tipo = (e.tipo_escrito || '—').substring(0, 30).padEnd(30, ' ')
    const solic = (e.solicitante || '—').substring(0, 30).padEnd(30, ' ')
    const doc = e.tiene_doc ? 'Sí' : 'No'
    const anexo = e.tiene_anexo ? 'Sí' : 'No'
    lines.push(`  ${fecha} | ${tipo} | ${solic} | ${doc.padEnd(3)} | ${anexo}`)
  }
  lines.push('')
}

function fmtNotificaciones(lines: string[], notificaciones: DbNotificacion[]) {
  if (notificaciones.length === 0) return
  lines.push('NOTIFICACIONES:')
  lines.push('  Fecha       | Trámite              | Tipo         | Destinatario                   | Estado')
  lines.push('  ------------|----------------------|--------------|--------------------------------|--------')
  for (const n of notificaciones) {
    const fecha = (n.fecha_tramite || '—').substring(0, 11).padEnd(11, ' ')
    const tramite = (n.tramite || '—').substring(0, 20).padEnd(20, ' ')
    const tipo = (n.tipo_notif || '—').substring(0, 12).padEnd(12, ' ')
    const dest = (n.nombre || n.tipo_participante || '—').substring(0, 30).padEnd(30, ' ')
    const estado = n.estado_notif || '—'
    let line = `  ${fecha} | ${tramite} | ${tipo} | ${dest} | ${estado}`
    if (n.obs_fallida) line += ` (${n.obs_fallida})`
    lines.push(line)
  }
  lines.push('')
}

function fmtAnexosCausa(lines: string[], anexos: DbAnexoCausa[]) {
  if (anexos.length === 0) return
  lines.push('ANEXOS DE LA CAUSA:')
  for (const a of anexos) {
    const ref = a.referencia || '—'
    const fecha = a.fecha || ''
    lines.push(`  - ${ref}${fecha ? ` (${fecha})` : ''}`)
  }
  lines.push('')
}

function fmtReceptorRetiros(lines: string[], retiros: DbReceptorRetiro[]) {
  if (retiros.length === 0) return
  lines.push('RETIROS DE RECEPTOR:')
  for (const r of retiros) {
    const parts = [
      r.fecha_retiro ? `Fecha: ${r.fecha_retiro}` : null,
      r.cuaderno ? `Cuaderno: ${r.cuaderno}` : null,
      r.estado ? `Estado: ${r.estado}` : null,
      r.datos_retiro ? `Datos: ${r.datos_retiro}` : null,
    ].filter(Boolean)
    lines.push(`  - ${parts.join(' | ')}`)
  }
  lines.push('')
}

function fmtExhortos(lines: string[], exhortos: DbExhorto[], docs: DbExhortoDoc[], piezas: DbPiezaExhorto[]) {
  if (exhortos.length === 0) return
  lines.push('EXHORTOS:')
  for (const ex of exhortos) {
    const header = [ex.tipo_exhorto, ex.estado_exhorto].filter(Boolean).join(' — ')
    lines.push(`  Exhorto: ${header || '—'}`)
    if (ex.tribunal_destino) lines.push(`    Tribunal destino: ${ex.tribunal_destino}`)
    if (ex.rol_origen) lines.push(`    ROL origen: ${ex.rol_origen}`)
    if (ex.rol_destino) lines.push(`    ROL destino: ${ex.rol_destino}`)
    if (ex.fecha_ordena) lines.push(`    Fecha ordena: ${ex.fecha_ordena}`)
    if (ex.fecha_ingreso) lines.push(`    Fecha ingreso: ${ex.fecha_ingreso}`)

    const exDocs = docs.filter(d => d.exhorto_id === ex.id)
    if (exDocs.length > 0) {
      lines.push('    Documentos:')
      for (const d of exDocs) {
        const parts = [d.tramite, d.referencia, d.fecha].filter(Boolean)
        lines.push(`      - ${parts.join(' | ')}`)
      }
    }
    lines.push('')
  }

  if (piezas.length > 0) {
    lines.push('  PIEZAS DE EXHORTO:')
    lines.push('    N° | Trámite              | Descripción                              | Fecha       | Foja | Doc')
    lines.push('    ---|----------------------|------------------------------------------|-------------|------|----')
    for (const p of piezas) {
      const num = String(p.numero_folio).padStart(2, ' ')
      const tr = (p.tramite || '—').substring(0, 20).padEnd(20, ' ')
      const desc = (p.desc_tramite || '—').substring(0, 40).padEnd(40, ' ')
      const fecha = (p.fecha_tramite || '—').substring(0, 11).padEnd(11, ' ')
      const foja = p.foja != null ? String(p.foja).padStart(4, ' ') : '   —'
      const doc = p.tiene_doc ? 'Sí' : 'No'
      lines.push(`    ${num} | ${tr} | ${desc} | ${fecha} | ${foja} | ${doc}`)
    }
    lines.push('')
  }
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
    const header = [r.recurso, r.corte, r.libro].filter(Boolean).join(' | ')
    lines.push(`  Recurso: ${header || '—'}`)
    if (r.fecha) lines.push(`    Fecha: ${r.fecha}`)
    if (r.estado_recurso) lines.push(`    Estado recurso: ${r.estado_recurso}`)
    if (r.estado_procesal) lines.push(`    Estado procesal: ${r.estado_procesal}`)
    if (r.ubicacion) lines.push(`    Ubicación: ${r.ubicacion}`)
    if (r.exp_caratulado) lines.push(`    Caratulado: ${r.exp_caratulado}`)
    if (r.exp_materia) lines.push(`    Materia: ${r.exp_materia}`)
    if (r.exp_tribunal) lines.push(`    Tribunal: ${r.exp_tribunal}`)

    const rLitigs = litigs.filter(l => l.remision_id === r.id)
    if (rLitigs.length > 0) {
      lines.push('    Litigantes remisión:')
      for (const l of rLitigs) {
        const parts = [l.sujeto, l.nombre_razon_social, l.rut].filter(Boolean)
        lines.push(`      - ${parts.join(' | ')}`)
      }
    }

    const rExh = exhortos.filter(e => e.remision_id === r.id)
    if (rExh.length > 0) {
      lines.push('    Exhortos remisión:')
      for (const e of rExh) lines.push(`      - ${e.exhorto || '—'}`)
    }

    const rInc = incomp.filter(i => i.remision_id === r.id)
    if (rInc.length > 0) {
      lines.push('    Incompetencias:')
      for (const i of rInc) lines.push(`      - ${i.incompetencia || '—'}`)
    }

    const rMovs = movs
      .filter(m => m.remision_id === r.id)
      .sort((a, b) => a.numero_folio - b.numero_folio)

    if (rMovs.length > 0) {
      lines.push('    Movimientos:')
      lines.push('    N° | Trámite              | Descripción                              | Fecha       | Estado    | Sala')
      lines.push('    ---|----------------------|------------------------------------------|-------------|-----------|-----')
      for (const m of rMovs) {
        const num = String(m.numero_folio).padStart(2, ' ')
        const tr = (m.tramite || '—').substring(0, 20).padEnd(20, ' ')
        const desc = (m.descripcion || '—').substring(0, 40).padEnd(40, ' ')
        const f = (m.fecha || '—').substring(0, 11).padEnd(11, ' ')
        const est = (m.estado || '—').substring(0, 9).padEnd(9, ' ')
        const sala = m.sala || '—'
        lines.push(`    ${num} | ${tr} | ${desc} | ${f} | ${est} | ${sala}`)

        const mAnexos = movAnexos.filter(a => a.movimiento_id === m.id)
        for (const a of mAnexos) {
          const parts = [a.tipo_documento, a.codigo, a.cantidad ? `cant: ${a.cantidad}` : null, a.observacion].filter(Boolean)
          lines.push(`         ↳ Anexo: ${parts.join(' | ')}`)
        }
      }
    }
    lines.push('')
  }
}
