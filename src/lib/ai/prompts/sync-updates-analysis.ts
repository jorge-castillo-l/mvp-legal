/**
 * ============================================================
 * Sync Updates Analysis — Prompt especializado
 * ============================================================
 * Se inyecta como addendum al system prompt cuando la query
 * trata sobre los cambios detectados en la última sincronización.
 *
 * Patrón idéntico a deadline-analysis.ts:
 *   - Detector de queries por keywords
 *   - Prompt especializado con formato de salida
 *   - Función para obtener cambios de la BD
 * ============================================================
 */

import { createAdminClient } from '@/lib/supabase/server'
import type { SyncChange } from '@/lib/pjud/types'

// ─────────────────────────────────────────────────────────────
// Detector — keywords de queries sobre cambios de sincronización
// ─────────────────────────────────────────────────────────────

const SYNC_UPDATE_KEYWORDS = [
  'cambios de la última sincronización',
  'cambios de la ultima sincronización',
  'cambios de la última sincronizacion',
  'cambios de la ultima sincronizacion',
  'cambios de sincronización',
  'cambios de sincronizacion',
  'actualizaciones de la causa',
  'actualizaciones de sincronización',
  'actualizaciones de sincronizacion',
  'qué cambió en la causa',
  'que cambió en la causa',
  'que cambio en la causa',
  'qué cambio en la causa',
  'novedades de la causa',
  'novedades de sincronización',
  'novedades de sincronizacion',
  'cambios detectados',
  'últimos cambios',
  'ultimos cambios',
  'cambios recientes',
  'diferencias de sincronización',
  'diferencias de sincronizacion',
]

const SYNC_UPDATE_PATTERN = new RegExp(
  SYNC_UPDATE_KEYWORDS.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'i',
)

export function isSyncUpdatesQuery(query: string): boolean {
  return SYNC_UPDATE_PATTERN.test(query)
}

// ─────────────────────────────────────────────────────────────
// Fetch last sync changes from DB
// ─────────────────────────────────────────────────────────────

export async function fetchLastSyncChanges(caseId: string): Promise<SyncChange[] | null> {
  const db = createAdminClient() as any
  const { data, error } = await db
    .from('cases')
    .select('last_sync_changes')
    .eq('id', caseId)
    .single()

  if (error || !data?.last_sync_changes) return null
  return data.last_sync_changes as SyncChange[]
}

// ─────────────────────────────────────────────────────────────
// Format changes for injection into system prompt
// ─────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  metadata: 'Datos generales de la causa',
  cuaderno: 'Cuadernos',
  folio: 'Folios / Actuaciones',
  folio_anexo: 'Anexos de folios',
  litigante: 'Litigantes',
  notificacion: 'Notificaciones',
  escrito: 'Escritos presentados',
  pieza_exhorto: 'Piezas de exhorto',
  anexo_causa: 'Anexos de la causa',
  receptor: 'Retiros de receptor',
  exhorto: 'Exhortos',
  exhorto_doc: 'Documentos de exhorto',
  remision: 'Remisiones / Recursos en Corte',
  remision_movimiento: 'Movimientos de remisión',
  remision_mov_anexo: 'Anexos de movimiento de remisión',
  remision_litigante: 'Litigantes de remisión',
  remision_exhorto: 'Exhortos de remisión',
  remision_incompetencia: 'Incompetencias de remisión',
}

function formatChangesForPrompt(changes: SyncChange[]): string {
  const grouped = new Map<string, SyncChange[]>()
  for (const c of changes) {
    const key = c.category
    const arr = grouped.get(key) ?? []
    arr.push(c)
    grouped.set(key, arr)
  }

  const lines: string[] = []
  for (const [category, items] of grouped) {
    const label = CATEGORY_LABELS[category] ?? category
    lines.push(`\n### ${label}`)
    for (const item of items) {
      const typeIcon = item.type === 'added' ? '[+NUEVO]'
        : item.type === 'removed' ? '[-ELIMINADO]'
        : '[~MODIFICADO]'
      lines.push(`${typeIcon} ${item.description}`)
    }
  }
  return lines.join('\n')
}

// ─────────────────────────────────────────────────────────────
// Build specialized prompt
// ─────────────────────────────────────────────────────────────

export function getSyncUpdatesPrompt(changes: SyncChange[]): string {
  const added = changes.filter(c => c.type === 'added').length
  const changed = changes.filter(c => c.type === 'changed').length
  const removed = changes.filter(c => c.type === 'removed').length

  return `
MODO ESPECIAL: ANÁLISIS DE ACTUALIZACIONES DE LA CAUSA
=======================================================
Se detectaron ${changes.length} cambio(s) en la última sincronización (${added} nuevos, ${changed} modificados, ${removed} eliminados).

A continuación se listan los cambios detectados comparando el estado anterior con el actual:
${formatChangesForPrompt(changes)}

INSTRUCCIONES:
1. Resume los cambios más importantes primero, en lenguaje claro para abogados.
2. Agrupa los cambios por relevancia procesal (no por categoría técnica).
3. Para cada cambio relevante, explica brevemente qué significa procesalmente:
   - Si hay nuevos folios/trámites, indica qué actuación representan.
   - Si cambió el estado procesal o la etapa, explica las consecuencias.
   - Si hay nuevas notificaciones, indica si gatillan plazos.
   - Si hay nuevos escritos, indica su naturaleza.
4. Omite cambios triviales o puramente técnicos (ej: disponibilidad de documentos PDF).
5. Al final, si los cambios implican acciones urgentes o plazos que empiezan a correr, destácalos con ⚠️.

FORMATO DE RESPUESTA:
- Usa un tono profesional y conciso.
- Usa encabezados markdown para organizar la respuesta.
- Si no hay cambios relevantes procesalmente, indícalo brevemente.`
}
