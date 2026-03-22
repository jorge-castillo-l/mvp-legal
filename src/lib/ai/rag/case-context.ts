/**
 * ============================================================
 * Case Structured Context — Complemento RAG
 * ============================================================
 * Inyecta datos estructurados de la causa (folios, cuadernos,
 * litigantes) como contexto adicional para el chat.
 *
 * Problema que resuelve:
 *   El ebook de PJUD excluye "Actuaciones de Receptor" de su
 *   tabla de contenidos, haciendo que el modelo crea que esos
 *   folios no existen. Al inyectar case_folios como contexto,
 *   el modelo siempre tiene la estructura completa de la causa.
 *
 * Se agrega como AIContextChunk con chunkId prefijado
 * 'case-structured-' para que el merge de enhanced-pipeline
 * no lo deduplique accidentalmente.
 * ============================================================
 */

import { createAdminClient } from '@/lib/supabase/server'
import type { AIContextChunk } from '../types'

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

/**
 * Fetch structured case data and format as an AIContextChunk.
 * Returns null if no cuadernos exist for the case.
 */
export async function fetchCaseStructuredContext(
  caseId: string,
): Promise<AIContextChunk | null> {
  const db = createAdminClient()

  const [cuadernosRes, foliosRes, litigantesRes] = await Promise.all([
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
  ])

  const cuadernos = cuadernosRes.data ?? []
  const folios = foliosRes.data ?? []
  const litigantes = litigantesRes.data ?? []

  if (cuadernos.length === 0) return null

  const text = formatStructuredContext(cuadernos, folios, litigantes)

  return {
    chunkId: 'case-structured-context',
    text,
    metadata: {
      documentType: 'structured_context',
      sectionType: 'case_overview',
    },
  }
}

function formatStructuredContext(
  cuadernos: DbCuaderno[],
  folios: DbFolio[],
  litigantes: DbLitigante[],
): string {
  const lines: string[] = [
    '=== ESTRUCTURA COMPLETA DE LA CAUSA (datos oficiales del expediente) ===',
    '',
  ]

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

  lines.push('=== FIN ESTRUCTURA DE LA CAUSA ===')
  lines.push('NOTA: Esta tabla es la fuente de verdad para los folios de la causa. El ebook de PJUD puede omitir Actuaciones de Receptor.')

  return lines.join('\n')
}
