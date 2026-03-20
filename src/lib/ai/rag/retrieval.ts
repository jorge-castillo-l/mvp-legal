/**
 * ============================================================
 * RAG Retrieval Module — Tarea 3.02
 * ============================================================
 * Búsqueda híbrida: vector similarity + full-text search.
 *
 * Flujo:
 *   1. Embedding de la query (via generateQueryEmbedding)
 *   2. Vector search (RPC match_case_chunks_vector)
 *   3. Full-text search (RPC match_case_chunks_text)
 *   4. Hybrid merge: fusiona resultados deduplicando por chunk_id
 *   5. Reranking: score combinado + boost temporal
 *   6. Top-K selection → AIContextChunk[] listo para el router
 *
 * Score híbrido = 0.7 × vector_score + 0.3 × text_score
 * Boost temporal: +0.1 si query contiene keywords de estado
 * procesal y el documento es reciente.
 * ============================================================
 */

import { createAdminClient } from '@/lib/supabase/server'
import { generateQueryEmbedding } from '@/lib/embeddings'
import type { AIContextChunk } from '../types'

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface RetrievalOptions {
  caseId: string
  query: string
  topK?: number
  documentType?: string
  sectionType?: string
}

export interface RetrievalResult {
  chunks: AIContextChunk[]
  stats: {
    vectorResults: number
    textResults: number
    mergedTotal: number
    finalCount: number
    durationMs: number
  }
}

interface RawChunk {
  chunk_id: string
  chunk_text: string
  chunk_index: number
  section_type: string
  page_number: number | null
  metadata: Record<string, unknown>
  document_id: string
  document_type: string | null
  filename: string | null
  created_at: string
}

interface ScoredChunk extends RawChunk {
  vectorScore: number
  textScore: number
  hybridScore: number
}

// ─────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────

const VECTOR_WEIGHT = 0.7
const TEXT_WEIGHT = 0.3
const TEMPORAL_BOOST = 0.1
const DEFAULT_TOP_K = 5

function getFetchCount(topK: number): number {
  return Math.max(topK * 2, 10)
}

const RECENCY_KEYWORDS = [
  'último', 'última', 'actual', 'vigente', 'reciente',
  'estado', 'hoy', 'pendiente', 'próximo', 'vence',
]

// ─────────────────────────────────────────────────────────────
// Main retrieval function
// ─────────────────────────────────────────────────────────────

export async function retrieveChunks(
  options: RetrievalOptions,
): Promise<RetrievalResult> {
  const startTime = Date.now()
  const topK = options.topK ?? DEFAULT_TOP_K
  const fetchCount = getFetchCount(topK)
  const db = createAdminClient()

  const [queryEmbedding, textResults] = await Promise.all([
    generateQueryEmbedding(options.query),
    searchFullText(db, options, fetchCount),
  ])

  const vectorResults = await searchVector(db, queryEmbedding, options, fetchCount)

  const merged = hybridMerge(vectorResults, textResults)
  const reranked = rerank(merged, options.query)
  const topChunks = reranked.slice(0, topK)

  return {
    chunks: topChunks.map(toContextChunk),
    stats: {
      vectorResults: vectorResults.length,
      textResults: textResults.length,
      mergedTotal: merged.length,
      finalCount: topChunks.length,
      durationMs: Date.now() - startTime,
    },
  }
}

// ─────────────────────────────────────────────────────────────
// Vector search (cosine similarity via RPC)
// ─────────────────────────────────────────────────────────────

async function searchVector(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  embedding: number[],
  options: RetrievalOptions,
  fetchCount: number,
): Promise<Array<RawChunk & { similarity: number }>> {
  const { data, error } = await db.rpc('match_case_chunks_vector', {
    query_embedding: JSON.stringify(embedding),
    p_case_id: options.caseId,
    match_count: fetchCount,
    p_document_type: options.documentType ?? null,
    p_section_type: options.sectionType ?? null,
  })

  if (error) {
    console.error('[rag-retrieval] Vector search error:', error.message)
    return []
  }

  return (data ?? []) as Array<RawChunk & { similarity: number }>
}

// ─────────────────────────────────────────────────────────────
// Full-text search (ts_rank via RPC)
// ─────────────────────────────────────────────────────────────

async function searchFullText(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  options: RetrievalOptions,
  fetchCount: number,
): Promise<Array<RawChunk & { rank: number }>> {
  const { data, error } = await db.rpc('match_case_chunks_text', {
    query_text: options.query,
    p_case_id: options.caseId,
    match_count: fetchCount,
    p_document_type: options.documentType ?? null,
    p_section_type: options.sectionType ?? null,
  })

  if (error) {
    console.error('[rag-retrieval] Full-text search error:', error.message)
    return []
  }

  return (data ?? []) as Array<RawChunk & { rank: number }>
}

// ─────────────────────────────────────────────────────────────
// Hybrid merge: deduplicate + normalize scores
// ─────────────────────────────────────────────────────────────

function hybridMerge(
  vectorResults: Array<RawChunk & { similarity: number }>,
  textResults: Array<RawChunk & { rank: number }>,
): ScoredChunk[] {
  const chunkMap = new Map<string, ScoredChunk>()

  const maxVectorScore = Math.max(...vectorResults.map(r => r.similarity), 0.001)
  const maxTextRank = Math.max(...textResults.map(r => r.rank), 0.001)

  for (const r of vectorResults) {
    const normalized = r.similarity / maxVectorScore
    chunkMap.set(r.chunk_id, {
      ...r,
      vectorScore: normalized,
      textScore: 0,
      hybridScore: 0,
    })
  }

  for (const r of textResults) {
    const normalized = r.rank / maxTextRank
    const existing = chunkMap.get(r.chunk_id)
    if (existing) {
      existing.textScore = normalized
    } else {
      chunkMap.set(r.chunk_id, {
        ...r,
        vectorScore: 0,
        textScore: normalized,
        hybridScore: 0,
      })
    }
  }

  for (const chunk of chunkMap.values()) {
    chunk.hybridScore =
      VECTOR_WEIGHT * chunk.vectorScore +
      TEXT_WEIGHT * chunk.textScore
  }

  return Array.from(chunkMap.values())
}

// ─────────────────────────────────────────────────────────────
// Reranking: hybrid score + temporal boost
// ─────────────────────────────────────────────────────────────

function rerank(chunks: ScoredChunk[], query: string): ScoredChunk[] {
  const queryLower = query.toLowerCase()
  const wantsRecent = RECENCY_KEYWORDS.some(kw => queryLower.includes(kw))

  if (wantsRecent) {
    const now = Date.now()
    for (const chunk of chunks) {
      const docAge = now - new Date(chunk.created_at).getTime()
      const daysOld = docAge / (1000 * 60 * 60 * 24)
      if (daysOld < 30) {
        chunk.hybridScore += TEMPORAL_BOOST
      } else if (daysOld < 90) {
        chunk.hybridScore += TEMPORAL_BOOST * 0.5
      }
    }
  }

  return chunks.sort((a, b) => b.hybridScore - a.hybridScore)
}

// ─────────────────────────────────────────────────────────────
// Map to AIContextChunk
// ─────────────────────────────────────────────────────────────

function toContextChunk(chunk: ScoredChunk): AIContextChunk {
  const m = chunk.metadata as Record<string, unknown>
  return {
    chunkId: chunk.chunk_id,
    text: chunk.chunk_text,
    metadata: {
      documentId: chunk.document_id,
      documentType: chunk.document_type ?? (m.document_type as string) ?? undefined,
      sectionType: chunk.section_type ?? undefined,
      folioNumero: (m.folio_numero as number) ?? undefined,
      cuaderno: (m.cuaderno as string) ?? undefined,
      fechaTramite: (m.fecha_tramite as string) ?? undefined,
      descTramite: (m.desc_tramite as string) ?? undefined,
      foja: (m.foja as number) ?? undefined,
      pageNumber: chunk.page_number ?? undefined,
      procedimiento: (m.procedimiento as string) ?? undefined,
      libroTipo: (m.libro_tipo as string) ?? undefined,
      rol: (m.rol as string) ?? undefined,
      tribunal: (m.tribunal as string) ?? undefined,
    },
  }
}
