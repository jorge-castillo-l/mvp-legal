/**
 * ============================================================
 * Key Document Fetcher — Tarea 3.06
 * ============================================================
 * Recupera documentos clave COMPLETOS (texto íntegro) de una
 * causa según su procedimiento. Estos se agregan al contexto
 * de Capas 2-3 (Claude) como document blocks con Citations API.
 *
 * Documentos clave por procedimiento:
 *   Ejecutivo: demanda + mandamiento + acta embargo + excepciones + últimas resoluciones
 *   Ordinario: demanda + contestación + últimas resoluciones
 *   Sumario:   demanda + acta audiencia + últimas resoluciones
 *   Monitorio: demanda + resolución requerimiento + últimas resoluciones
 *   Voluntario: solicitud + informes + últimas resoluciones
 *
 * El texto viene de extracted_texts (ya extraído por el pipeline 7.05).
 * Se trunca a MAX_DOC_TOKENS para no saturar el context window de Claude.
 * ============================================================
 */

import { createAdminClient } from '@/lib/supabase/server'
import type { AIContextChunk } from '../types'

// ─────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────

const MAX_DOC_CHARS = 30_000  // ~7,500 tokens — fits well within Claude's 200K
const MAX_KEY_DOCS = 5
const RECENT_RESOLUTIONS_COUNT = 3

// ─────────────────────────────────────────────────────────────
// Procedure → document type mapping
// ─────────────────────────────────────────────────────────────

const KEY_DOC_TYPES: Record<string, string[]> = {
  ejecutivo: ['demanda', 'mandamiento', 'acta_embargo', 'excepciones', 'sentencia'],
  ordinario: ['demanda', 'contestacion', 'sentencia', 'auto_prueba'],
  sumario: ['demanda', 'acta_audiencia', 'sentencia'],
  monitorio: ['demanda', 'resolucion', 'sentencia'],
  voluntario: ['solicitud', 'informe', 'resolucion'],
}

// Fallback keywords for matching when document_type is generic
const DOC_TYPE_KEYWORDS: Record<string, string[]> = {
  demanda: ['demanda', 'libelo'],
  contestacion: ['contestación', 'contestacion', 'contesta la demanda'],
  mandamiento: ['mandamiento', 'ejecución y embargo'],
  acta_embargo: ['embargo', 'acta de embargo', 'traba'],
  excepciones: ['excepciones', 'opone excepciones', 'oposición'],
  sentencia: ['sentencia', 'fallo', 'se resuelve'],
  acta_audiencia: ['audiencia', 'comparendo', 'acta de audiencia'],
  auto_prueba: ['auto de prueba', 'recibe la causa a prueba'],
  solicitud: ['solicitud', 'solicita'],
  informe: ['informe', 'informa'],
  resolucion: ['resolución', 'resolucion', 'resuelve', 'proveído'],
}

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface KeyDocument {
  documentId: string
  documentType: string
  filename: string | null
  fullText: string
  metadata: Record<string, unknown>
  createdAt: string
}

export interface KeyDocumentsResult {
  documents: AIContextChunk[]
  count: number
}

// ─────────────────────────────────────────────────────────────
// Main function
// ─────────────────────────────────────────────────────────────

export async function fetchKeyDocuments(
  caseId: string,
  procedimiento: string | null,
): Promise<KeyDocumentsResult> {
  const targetTypes = KEY_DOC_TYPES[procedimiento ?? ''] ?? KEY_DOC_TYPES.ordinario
  const db = createAdminClient()

  const { data: docs, error } = await db
    .from('documents')
    .select(`
      id,
      document_type,
      original_filename,
      metadata,
      created_at,
      extracted_texts!inner (
        full_text,
        status
      )
    `)
    .eq('case_id', caseId)
    .eq('extracted_texts.status', 'completed')
    .order('created_at', { ascending: true })

  if (error || !docs?.length) {
    return { documents: [], count: 0 }
  }

  const matched = matchKeyDocuments(docs, targetTypes)

  const recentResolutions = getRecentResolutions(docs, matched)
  const allKeyDocs = [...matched, ...recentResolutions].slice(0, MAX_KEY_DOCS)

  const contextChunks = allKeyDocs.map(toKeyDocContextChunk)
  return { documents: contextChunks, count: contextChunks.length }
}

// ─────────────────────────────────────────────────────────────
// Matching logic
// ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function matchKeyDocuments(docs: any[], targetTypes: string[]): KeyDocument[] {
  const matched: KeyDocument[] = []
  const usedIds = new Set<string>()

  for (const targetType of targetTypes) {
    if (targetType === 'sentencia') continue // handled by getRecentResolutions

    const keywords = DOC_TYPE_KEYWORDS[targetType] ?? [targetType]
    const doc = docs.find(d => {
      if (usedIds.has(d.id)) return false

      const docType = (d.document_type ?? '').toLowerCase()
      const filename = (d.original_filename ?? '').toLowerCase()
      const tramite = ((d.metadata?.desc_tramite ?? d.metadata?.tramite_pjud) as string ?? '').toLowerCase()

      return keywords.some(kw =>
        docType.includes(kw) || filename.includes(kw) || tramite.includes(kw),
      )
    })

    if (doc) {
      usedIds.add(doc.id)
      const extracted = Array.isArray(doc.extracted_texts)
        ? doc.extracted_texts[0]
        : doc.extracted_texts
      if (extracted?.full_text) {
        matched.push({
          documentId: doc.id,
          documentType: doc.document_type ?? targetType,
          filename: doc.original_filename,
          fullText: truncateText(extracted.full_text),
          metadata: doc.metadata ?? {},
          createdAt: doc.created_at,
        })
      }
    }
  }

  return matched
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRecentResolutions(docs: any[], alreadyMatched: KeyDocument[]): KeyDocument[] {
  const matchedIds = new Set(alreadyMatched.map(d => d.documentId))

  const resolutionKeywords = ['sentencia', 'resolución', 'resolucion', 'auto', 'decreto']

  const resolutions = docs
    .filter(d => {
      if (matchedIds.has(d.id)) return false
      const docType = (d.document_type ?? '').toLowerCase()
      const tramite = ((d.metadata?.desc_tramite ?? d.metadata?.tramite_pjud) as string ?? '').toLowerCase()
      return resolutionKeywords.some(kw => docType.includes(kw) || tramite.includes(kw))
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, RECENT_RESOLUTIONS_COUNT)

  return resolutions
    .map(doc => {
      const extracted = Array.isArray(doc.extracted_texts)
        ? doc.extracted_texts[0]
        : doc.extracted_texts
      if (!extracted?.full_text) return null
      return {
        documentId: doc.id,
        documentType: doc.document_type ?? 'resolución',
        filename: doc.original_filename,
        fullText: truncateText(extracted.full_text),
        metadata: doc.metadata ?? {},
        createdAt: doc.created_at,
      }
    })
    .filter((d): d is KeyDocument => d !== null)
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function truncateText(text: string): string {
  if (text.length <= MAX_DOC_CHARS) return text
  return text.slice(0, MAX_DOC_CHARS) + '\n\n[... documento truncado por longitud ...]'
}

function toKeyDocContextChunk(doc: KeyDocument): AIContextChunk {
  const m = doc.metadata
  return {
    chunkId: `keydoc-${doc.documentId}`,
    text: doc.fullText,
    metadata: {
      documentId: doc.documentId,
      documentType: doc.documentType,
      folioNumero: (m.folio_numero as number) ?? undefined,
      cuaderno: (m.cuaderno as string) ?? undefined,
      fechaTramite: (m.fecha_tramite as string) ?? undefined,
      descTramite: (m.desc_tramite as string) ?? undefined,
      foja: (m.foja as number) ?? undefined,
      rol: (m.rol as string) ?? undefined,
      tribunal: (m.tribunal as string) ?? undefined,
    },
  }
}
