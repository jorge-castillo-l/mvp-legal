/**
 * ============================================================
 * Key Document Fetcher — Zero Hallucination Architecture
 * ============================================================
 * Recupera documentos clave de una causa con selección query-aware
 * y genera un inventario explícito de TODOS los documentos para
 * que el LLM sepa exactamente qué tiene y qué no.
 *
 * Principios:
 *   1. Sin caps fijos por tipo — si el usuario pide "los anexos",
 *      recibe TODOS los anexos, no un máximo arbitrario.
 *   2. Presupuesto de tokens en vez de conteo de docs.
 *   3. Inventario explícito: el LLM recibe una lista de TODOS
 *      los documentos de la causa clasificados como [incluido],
 *      [no incluido], o [sin texto extraído].
 *
 * Context windows: Claude Opus/Sonnet 4.6 = 1M, Gemini 3 Flash = 1M.
 * Budget: ~500K tokens para docs (~50% del window), dejando amplio
 * margen para system prompt, RAG, historial y output.
 * ============================================================
 */

import { createAdminClient } from '@/lib/supabase/server'
import type { AIContextChunk } from '../types'
import type { SyncChange } from '@/lib/pjud/types'

// ─────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────

const MAX_DOC_CHARS = 80_000
const TOKEN_BUDGET = 500_000
const RECENT_RESOLUTIONS_COUNT = 5

// ─────────────────────────────────────────────────────────────
// Query → origin mapping (which document types the query wants)
// ─────────────────────────────────────────────────────────────

interface QueryOriginRule {
  keywords: string[]
  origins: string[] // ['*'] = all types
}

const QUERY_ORIGIN_RULES: QueryOriginRule[] = [
  { keywords: ['anexo', 'adjunto', 'pagaré', 'pagare', 'mandato', 'poder', 'personería', 'personeria', 'título ejecutivo', 'titulo ejecutivo'], origins: ['anexo_causa', 'anexo_solicitud'] },
  { keywords: ['exhorto', 'tribunal exhortado', 'exhortado'], origins: ['exhorto', 'pieza_exhorto'] },
  { keywords: ['apelación', 'apelacion', 'recurso', 'remisión', 'remision', 'corte de apelaciones', 'casación', 'casacion', 'alzada', 'segunda instancia', 'ebook'], origins: ['remision_directo', 'remision_movimiento', 'remision_mov_anexo'] },
  { keywords: ['certificado'], origins: ['folio_certificado'] },
  { keywords: ['pieza'], origins: ['pieza_exhorto'] },
  { keywords: ['documento', 'documentos', 'resúmeme', 'resumeme', 'resumen de todos', 'todos los', 'cada uno'], origins: ['*'] },
]

// SyncChange category → document origins mapping
const SYNC_CATEGORY_TO_ORIGINS: Record<string, string[]> = {
  folio: ['folio', 'folio_certificado'],
  folio_anexo: ['anexo_solicitud'],
  anexo_causa: ['anexo_causa'],
  exhorto: ['exhorto'],
  exhorto_doc: ['exhorto'],
  pieza_exhorto: ['pieza_exhorto'],
  remision: ['remision_directo'],
  remision_movimiento: ['remision_movimiento'],
  remision_mov_anexo: ['remision_mov_anexo'],
}

const PROCEDURE_KEY_TYPES: Record<string, string[]> = {
  ejecutivo: ['demanda', 'mandamiento', 'acta_embargo', 'excepciones'],
  ordinario: ['demanda', 'contestacion', 'auto_prueba'],
  sumario: ['demanda', 'acta_audiencia'],
  monitorio: ['demanda', 'resolucion'],
  voluntario: ['solicitud', 'informe'],
}

const DOC_TYPE_KEYWORDS: Record<string, string[]> = {
  demanda: ['demanda', 'libelo'],
  contestacion: ['contestación', 'contestacion', 'contesta la demanda'],
  mandamiento: ['mandamiento', 'ejecución y embargo'],
  acta_embargo: ['embargo', 'acta de embargo', 'traba'],
  excepciones: ['excepciones', 'opone excepciones', 'oposición'],
  acta_audiencia: ['audiencia', 'comparendo', 'acta de audiencia'],
  auto_prueba: ['auto de prueba', 'recibe la causa a prueba'],
  solicitud: ['solicitud', 'solicita'],
  informe: ['informe', 'informa'],
  resolucion: ['resolución', 'resolucion', 'resuelve', 'proveído'],
}

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface CaseDocument {
  id: string
  documentType: string | null
  origen: string | null
  filename: string | null
  metadata: Record<string, unknown>
  createdAt: string
  fullText: string | null
  extractionStatus: 'completed' | 'pending' | 'failed' | 'none'
}

export interface KeyDocumentsResult {
  documents: AIContextChunk[]
  inventory: string
  count: number
}

// ─────────────────────────────────────────────────────────────
// Main function
// ─────────────────────────────────────────────────────────────

export interface FetchKeyDocumentsOptions {
  caseId: string
  procedimiento: string | null
  query: string
  syncChanges?: SyncChange[]
  deadlineMode?: boolean
}

export async function fetchKeyDocuments(
  caseId: string,
  procedimiento: string | null,
  query: string,
  syncChanges?: SyncChange[],
  deadlineMode?: boolean,
): Promise<KeyDocumentsResult> {
  const db = createAdminClient()

  const { data: rawDocs, error } = await db
    .from('documents')
    .select(`
      id,
      document_type,
      origen,
      original_filename,
      metadata,
      created_at,
      extracted_texts (
        full_text,
        status
      )
    `)
    .eq('case_id', caseId)
    .order('created_at', { ascending: true })

  if (error || !rawDocs?.length) {
    return { documents: [], inventory: buildEmptyInventory(), count: 0 }
  }

  const allDocs = normalizeDocs(rawDocs)
  const completedDocs = allDocs.filter(d => d.extractionStatus === 'completed' && d.fullText)
  const priorityOrigins = detectPriorityOrigins(query)
  const syncOrigins = syncChanges ? detectOriginsFromSyncChanges(syncChanges) : new Set<string>()
  const selected = selectDocuments(completedDocs, priorityOrigins, procedimiento, syncOrigins, deadlineMode ?? false)
  const selectedIds = new Set(selected.map(d => d.id))
  const hasPendingDocs = allDocs.some(d => d.extractionStatus === 'pending')
  const inventory = buildInventory(allDocs, selectedIds, hasPendingDocs)
  const contextChunks = selected.map(toContextChunk)

  return { documents: contextChunks, inventory, count: contextChunks.length }
}

// ─────────────────────────────────────────────────────────────
// Query analysis
// ─────────────────────────────────────────────────────────────

function detectPriorityOrigins(query: string): Set<string> | 'all' {
  const lower = query.toLowerCase()
  const matched = new Set<string>()

  for (const rule of QUERY_ORIGIN_RULES) {
    if (rule.keywords.some(kw => lower.includes(kw))) {
      if (rule.origins.includes('*')) return 'all'
      for (const o of rule.origins) matched.add(o)
    }
  }

  return matched
}

function detectOriginsFromSyncChanges(changes: SyncChange[]): Set<string> {
  const origins = new Set<string>()
  for (const change of changes) {
    if (change.type === 'removed') continue
    const mapped = SYNC_CATEGORY_TO_ORIGINS[change.category]
    if (mapped) {
      for (const o of mapped) origins.add(o)
    }
  }
  return origins
}

// ─────────────────────────────────────────────────────────────
// Document selection (token budget based)
// ─────────────────────────────────────────────────────────────

function selectDocuments(
  docs: CaseDocument[],
  priorityOrigins: Set<string> | 'all',
  procedimiento: string | null,
  syncOrigins: Set<string>,
  deadlineMode: boolean,
): CaseDocument[] {
  const selected: CaseDocument[] = []
  const usedIds = new Set<string>()
  let tokenBudget = TOKEN_BUDGET

  function tryAdd(doc: CaseDocument): boolean {
    if (usedIds.has(doc.id) || !doc.fullText) return false
    const text = truncateText(doc.fullText)
    const tokens = estimateTokens(text)
    if (tokens > tokenBudget) return false
    doc.fullText = text
    selected.push(doc)
    usedIds.add(doc.id)
    tokenBudget -= tokens
    return true
  }

  // Phase 0a: Documents linked to sync changes (highest priority, no cap)
  if (syncOrigins.size > 0) {
    const recentFirst = [...docs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    for (const doc of recentFirst) {
      const origen = (doc.origen ?? doc.documentType ?? '').toLowerCase()
      if (syncOrigins.has(origen)) tryAdd(doc)
    }
  }

  // Phase 0b: Deadline mode — prioritize ALL recent resolutions (no 5-doc limit)
  // Plazos depend on notificaciones (metadata, no PDFs) + resoluciones (PDFs with content).
  // Include all resolutions so the LLM can verify which ones were notified and compute deadlines.
  if (deadlineMode) {
    const deadlineKeywords = ['sentencia', 'resolución', 'resolucion', 'auto', 'decreto',
      'mandamiento', 'requerimiento', 'notificación', 'notificacion']
    const recentFirst = [...docs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    for (const doc of recentFirst) {
      const docType = (doc.documentType ?? '').toLowerCase()
      const meta = doc.metadata ?? {}
      const tramite = ((meta.desc_tramite ?? meta.tramite_pjud) as string ?? '').toLowerCase()
      if (deadlineKeywords.some(kw => docType.includes(kw) || tramite.includes(kw))) {
        tryAdd(doc)
      }
    }
  }

  // Phase 1: ALL documents of query-priority types (no cap)
  if (priorityOrigins === 'all') {
    for (const doc of docs) tryAdd(doc)
  } else if (priorityOrigins.size > 0) {
    for (const doc of docs) {
      const origen = (doc.origen ?? doc.documentType ?? '').toLowerCase()
      if (priorityOrigins.has(origen)) tryAdd(doc)
    }
  }

  // Phase 2: Procedure-matched essential documents
  const targetTypes = PROCEDURE_KEY_TYPES[procedimiento ?? ''] ?? PROCEDURE_KEY_TYPES.ordinario ?? []
  for (const targetType of targetTypes) {
    const keywords = DOC_TYPE_KEYWORDS[targetType] ?? [targetType]
    const doc = docs.find(d => {
      if (usedIds.has(d.id)) return false
      const docType = (d.documentType ?? '').toLowerCase()
      const filename = (d.filename ?? '').toLowerCase()
      const meta = d.metadata ?? {}
      const tramite = ((meta.desc_tramite ?? meta.tramite_pjud) as string ?? '').toLowerCase()
      const referencia = ((meta.referencia) as string ?? '').toLowerCase()
      return keywords.some(kw =>
        docType.includes(kw) || filename.includes(kw) || tramite.includes(kw) || referencia.includes(kw),
      )
    })
    if (doc) tryAdd(doc)
  }

  // Phase 3: Recent resolutions/sentencias (skip if deadlineMode already loaded them)
  if (!deadlineMode) {
    const resolutionKeywords = ['sentencia', 'resolución', 'resolucion', 'auto', 'decreto']
    const resolutions = docs
      .filter(d => {
        if (usedIds.has(d.id)) return false
        const docType = (d.documentType ?? '').toLowerCase()
        const meta = d.metadata ?? {}
        const tramite = ((meta.desc_tramite ?? meta.tramite_pjud) as string ?? '').toLowerCase()
        return resolutionKeywords.some(kw => docType.includes(kw) || tramite.includes(kw))
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, RECENT_RESOLUTIONS_COUNT)
    for (const doc of resolutions) tryAdd(doc)
  }

  // Phase 4: Fill remaining budget with most recent documents
  const remaining = docs
    .filter(d => !usedIds.has(d.id))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  for (const doc of remaining) {
    if (tokenBudget <= 0) break
    tryAdd(doc)
  }

  return selected
}

// ─────────────────────────────────────────────────────────────
// Document inventory builder
// ─────────────────────────────────────────────────────────────

function buildInventory(allDocs: CaseDocument[], selectedIds: Set<string>, hasPendingDocs: boolean): string {
  const included: string[] = []
  const notIncluded: string[] = []
  const pending: string[] = []

  for (const doc of allDocs) {
    const label = buildDocLabel(doc)
    if (selectedIds.has(doc.id)) {
      included.push(`  - ${label} [INCLUIDO]`)
    } else if (doc.extractionStatus === 'completed') {
      notIncluded.push(`  - ${label} [NO INCLUIDO por presupuesto de contexto]`)
    } else {
      pending.push(`  - ${label} [SIN TEXTO EXTRAÍDO — PDF pendiente de procesamiento]`)
    }
  }

  const lines: string[] = [
    '=== INVENTARIO DE DOCUMENTOS DE LA CAUSA ===',
  ]

  if (included.length > 0) {
    lines.push(`INCLUIDOS EN CONTEXTO (${included.length} docs — puedes analizar su contenido):`)
    lines.push(...included)
  }

  if (notIncluded.length > 0) {
    lines.push(`NO INCLUIDOS (${notIncluded.length} docs — texto extraído pero fuera de presupuesto):`)
    lines.push(...notIncluded)
  }

  if (pending.length > 0) {
    lines.push(`PENDIENTES DE EXTRACCIÓN (${pending.length} docs — NO disponibles):`)
    lines.push(...pending)
  }

  if (hasPendingDocs) {
    lines.push('')
    lines.push('⚠️ NOTA: Hay documentos recién sincronizados cuyo texto aún se está extrayendo.')
    lines.push('Si el usuario pregunta por su contenido, informa que los documentos se están procesando')
    lines.push('y que el análisis completo estará disponible en unos momentos al consultar nuevamente.')
  }

  lines.push('')
  lines.push('REGLA: Solo puedes afirmar sobre el contenido de documentos [INCLUIDO].')
  lines.push('Para documentos [NO INCLUIDO] o [SIN TEXTO EXTRAÍDO], declara explícitamente que no tienes acceso a su contenido.')
  lines.push('=== FIN INVENTARIO ===')

  return lines.join('\n')
}

function buildDocLabel(doc: CaseDocument): string {
  const meta = doc.metadata ?? {}
  const referencia = (meta.referencia as string) ?? null
  const tramite = (meta.desc_tramite ?? meta.tramite_pjud) as string ?? null
  const folioNum = meta.folio_numero as number ?? null
  const cuaderno = (meta.cuaderno_nombre as string) ?? null
  const fecha = (meta.fecha as string) ?? null
  const origen = doc.origen ?? doc.documentType ?? 'documento'

  const parts: string[] = []
  if (referencia) parts.push(referencia)
  else if (tramite) parts.push(tramite)
  else if (doc.filename) parts.push(doc.filename)
  else parts.push(origen)

  parts.push(`(${origen}`)
  if (folioNum != null) parts[parts.length - 1] += `, F${folioNum}`
  if (cuaderno) parts[parts.length - 1] += `, ${cuaderno}`
  parts[parts.length - 1] += ')'

  if (fecha) parts.push(fecha)

  return parts.join(' — ')
}

function buildEmptyInventory(): string {
  return '=== INVENTARIO DE DOCUMENTOS DE LA CAUSA ===\nNo hay documentos registrados para esta causa.\n=== FIN INVENTARIO ==='
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeDocs(rawDocs: any[]): CaseDocument[] {
  return rawDocs.map(d => {
    const extracted = Array.isArray(d.extracted_texts)
      ? d.extracted_texts[0]
      : d.extracted_texts

    let status: CaseDocument['extractionStatus'] = 'none'
    if (extracted?.status === 'completed') status = 'completed'
    else if (extracted?.status === 'pending') status = 'pending'
    else if (extracted?.status === 'failed') status = 'failed'

    return {
      id: d.id,
      documentType: d.document_type,
      origen: d.origen,
      filename: d.original_filename,
      metadata: d.metadata ?? {},
      createdAt: d.created_at,
      fullText: status === 'completed' ? (extracted?.full_text ?? null) : null,
      extractionStatus: status,
    }
  })
}

function truncateText(text: string): string {
  if (text.length <= MAX_DOC_CHARS) return text
  return text.slice(0, MAX_DOC_CHARS) + '\n\n[... documento truncado por longitud ...]'
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function toContextChunk(doc: CaseDocument): AIContextChunk {
  const m = doc.metadata
  return {
    chunkId: `keydoc-${doc.id}`,
    text: doc.fullText!,
    metadata: {
      documentId: doc.id,
      documentType: doc.origen ?? doc.documentType ?? undefined,
      folioNumero: (m.folio_numero as number) ?? undefined,
      cuaderno: ((m.cuaderno_nombre || m.cuaderno) as string) ?? undefined,
      fechaTramite: ((m.fecha_tramite || m.fecha) as string) ?? undefined,
      descTramite: (m.desc_tramite as string) ?? undefined,
      referencia: (m.referencia as string) ?? undefined,
      foja: (m.foja as number) ?? undefined,
      rol: (m.rol as string) ?? undefined,
      tribunal: (m.tribunal as string) ?? undefined,
    },
  }
}
