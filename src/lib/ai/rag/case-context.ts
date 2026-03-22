/**
 * ============================================================
 * Case Structured Context — Complemento RAG (Opción 2: "Abogado Civil")
 * ============================================================
 * Inyecta datos estructurados de la causa como contexto para el chat.
 *
 * Tablas incluidas (8 total):
 *   - cases              → datos generales (carátula, tribunal, materia, estado)
 *   - case_cuadernos     → estructura de cuadernos
 *   - case_folios        → lista completa de folios (fix ebook PJUD)
 *   - case_litigantes    → partes de la causa
 *   - case_escritos      → escritos presentados
 *   - case_notificaciones→ estado de notificaciones
 *   - case_remisiones    → recursos en Corte (condicional: solo si existen)
 *   - case_remision_movimientos → detalle de movimientos en Corte
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
  remision_id: string
  numero_folio: number
  tramite: string | null
  descripcion: string | null
  fecha: string | null
  estado: string | null
  sala: string | null
}

// ── Fetch & Build ────────────────────────────────────────────

export async function fetchCaseStructuredContext(
  caseId: string,
): Promise<AIContextChunk | null> {
  const db = createAdminClient()

  const [
    caseRes,
    cuadernosRes,
    foliosRes,
    litigantesRes,
    escritosRes,
    notifsRes,
    remisionesRes,
    remMovsRes,
  ] = await Promise.all([
    (db as any).from('cases')
      .select('rol, caratula, tribunal, materia, procedimiento, fecha_ingreso, estado, estado_procesal, etapa, ubicacion, libro_tipo, causa_origen_rol, causa_origen_tribunal')
      .eq('id', caseId)
      .single() as Promise<{ data: DbCase | null }>,
    (db as any).from('case_cuadernos')
      .select('id, nombre, procedimiento, etapa, posicion')
      .eq('case_id', caseId)
      .order('posicion') as Promise<{ data: DbCuaderno[] | null }>,
    (db as any).from('case_folios')
      .select('cuaderno_id, numero_folio, etapa, tramite, desc_tramite, fecha_tramite, foja, tiene_doc_principal, tiene_certificado_escrito, tiene_anexo_solicitud')
      .eq('case_id', caseId) as Promise<{ data: DbFolio[] | null }>,
    (db as any).from('case_litigantes')
      .select('cuaderno_id, participante, rut, nombre_razon_social')
      .eq('case_id', caseId) as Promise<{ data: DbLitigante[] | null }>,
    (db as any).from('case_escritos')
      .select('cuaderno_id, tipo_escrito, fecha_ingreso, solicitante, tiene_doc, tiene_anexo')
      .eq('case_id', caseId)
      .order('fecha_ingreso', { ascending: true }) as Promise<{ data: DbEscrito[] | null }>,
    (db as any).from('case_notificaciones')
      .select('cuaderno_id, tramite, fecha_tramite, tipo_notif, tipo_participante, nombre, estado_notif, obs_fallida')
      .eq('case_id', caseId)
      .order('fecha_tramite', { ascending: true }) as Promise<{ data: DbNotificacion[] | null }>,
    (db as any).from('case_remisiones')
      .select('id, corte, recurso, libro, fecha, estado_recurso, estado_procesal, ubicacion, exp_caratulado, exp_materia, exp_tribunal')
      .eq('case_id', caseId) as Promise<{ data: DbRemision[] | null }>,
    (db as any).from('case_remision_movimientos')
      .select('remision_id, numero_folio, tramite, descripcion, fecha, estado, sala')
      .eq('case_id', caseId)
      .order('numero_folio', { ascending: true }) as Promise<{ data: DbRemisionMov[] | null }>,
  ])

  const caso = caseRes.data
  const cuadernos = cuadernosRes.data ?? []
  const folios = foliosRes.data ?? []
  const litigantes = litigantesRes.data ?? []
  const escritos = escritosRes.data ?? []
  const notificaciones = notifsRes.data ?? []
  const remisiones = remisionesRes.data ?? []
  const remMovs = remMovsRes.data ?? []

  if (!caso && cuadernos.length === 0) return null

  const text = formatStructuredContext(
    caso, cuadernos, folios, litigantes, escritos, notificaciones, remisiones, remMovs,
  )

  return {
    chunkId: 'case-structured-context',
    text,
    metadata: {
      documentType: 'structured_context',
      sectionType: 'case_overview',
    },
  }
}

// ── Formatters ───────────────────────────────────────────────

function formatStructuredContext(
  caso: DbCase | null,
  cuadernos: DbCuaderno[],
  folios: DbFolio[],
  litigantes: DbLitigante[],
  escritos: DbEscrito[],
  notificaciones: DbNotificacion[],
  remisiones: DbRemision[],
  remMovs: DbRemisionMov[],
): string {
  const lines: string[] = [
    '=== DATOS COMPLETOS DE LA CAUSA (fuente de verdad del expediente) ===',
    '',
  ]

  // ── Datos generales ──
  if (caso) {
    lines.push('DATOS GENERALES:')
    const fields: [string, string | null][] = [
      ['ROL', caso.rol],
      ['Carátula', caso.caratula],
      ['Tribunal', caso.tribunal],
      ['Materia', caso.materia],
      ['Procedimiento', caso.procedimiento],
      ['Fecha ingreso', caso.fecha_ingreso],
      ['Estado', caso.estado],
      ['Estado procesal', caso.estado_procesal],
      ['Etapa', caso.etapa],
      ['Ubicación', caso.ubicacion],
      ['Libro', caso.libro_tipo],
    ]
    for (const [label, val] of fields) {
      if (val) lines.push(`  ${label}: ${val}`)
    }
    if (caso.causa_origen_rol) {
      lines.push(`  Causa origen: ${caso.causa_origen_rol} (${caso.causa_origen_tribunal || '—'})`)
    }
    lines.push('')
  }

  // ── Litigantes ──
  const firstCuaderno = cuadernos[0]
  const allLitigantes = litigantes.filter(l => l.cuaderno_id === firstCuaderno?.id)
  if (allLitigantes.length > 0) {
    lines.push('LITIGANTES:')
    for (const l of allLitigantes) {
      const parts = [l.participante, l.nombre_razon_social, l.rut].filter(Boolean)
      lines.push(`  - ${parts.join(' | ')}`)
    }
    lines.push('')
  }

  // ── Cuadernos + Folios ──
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
    }
    lines.push('')
  }

  // ── Escritos ──
  if (escritos.length > 0) {
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

  // ── Notificaciones ──
  if (notificaciones.length > 0) {
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

  // ── Remisiones (condicional) ──
  if (remisiones.length > 0) {
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

      const movs = remMovs
        .filter(m => m.remision_id === r.id)
        .sort((a, b) => a.numero_folio - b.numero_folio)

      if (movs.length > 0) {
        lines.push('    Movimientos:')
        lines.push('    N° | Trámite              | Descripción                              | Fecha       | Estado    | Sala')
        lines.push('    ---|----------------------|------------------------------------------|-------------|-----------|-----')
        for (const m of movs) {
          const num = String(m.numero_folio).padStart(2, ' ')
          const tr = (m.tramite || '—').substring(0, 20).padEnd(20, ' ')
          const desc = (m.descripcion || '—').substring(0, 40).padEnd(40, ' ')
          const f = (m.fecha || '—').substring(0, 11).padEnd(11, ' ')
          const est = (m.estado || '—').substring(0, 9).padEnd(9, ' ')
          const sala = m.sala || '—'
          lines.push(`    ${num} | ${tr} | ${desc} | ${f} | ${est} | ${sala}`)
        }
      }
      lines.push('')
    }
  }

  lines.push('=== FIN DATOS DE LA CAUSA ===')
  lines.push('NOTA: Esta información es la fuente de verdad del expediente. El ebook de PJUD puede omitir Actuaciones de Receptor en su tabla de contenidos.')

  return lines.join('\n')
}
