/**
 * ============================================================
 * Embedding Generation Pipeline — Tarea 7.08
 * ============================================================
 * Genera embeddings con text-embedding-004 de Google para
 * búsqueda semántica RAG por causa.
 *
 * Usa buildEmbeddingInput() de 7.07d para generar input
 * contextualizado: [tipo_doc | sección | procedimiento | folio]
 * + chunk_text. El vector resultante captura tanto el contenido
 * como el contexto procesal del chunk.
 *
 * Flujo:
 *   1. Recibe chunks con metadata enriquecida
 *   2. Genera embedding input con buildEmbeddingInput()
 *   3. Llama a text-embedding-004 en batches de 100
 *   4. Upsert en document_embeddings (idempotente por chunk_id)
 *
 * Costo: ~$0.00625 / 1M tokens → ~$0.0005 por causa de 500 págs.
 * ============================================================
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import { createAdminClient } from '@/lib/supabase/server'
import {
  enrichChunkMetadata,
  buildEmbeddingInput,
  type DocumentParentMetadata,
  type CaseMetadata,
  type EnrichedChunkMetadata,
} from '@/lib/pipeline/chunking/metadata-enricher'
import type { Chunk } from '@/lib/pipeline/chunking/token-chunker'
import type { DocumentEmbeddingInsert } from '@/types/database'

// ─────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────

const EMBEDDING_MODEL = 'gemini-embedding-001'
const EMBEDDING_DIMENSION = 768
const BATCH_SIZE = 100
const MAX_RETRIES = 3
const BASE_RETRY_DELAY_MS = 1_000

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface EmbeddingInput {
  chunkId: string
  caseId: string
  userId: string
  text: string
}

export interface EmbeddingGenerationResult {
  success: boolean
  totalChunks: number
  embeddingsGenerated: number
  embeddingsSkipped: number
  errors: string[]
  stats: {
    totalTokensEstimated: number
    batchesProcessed: number
    retriesNeeded: number
    durationMs: number
  }
}

export interface GenerateEmbeddingsForDocumentOptions {
  documentId: string
  caseId: string
  userId: string
  chunks: Chunk[]
  parentMetadata?: DocumentParentMetadata
  caseMetadata?: CaseMetadata
}

// ─────────────────────────────────────────────────────────────
// Google AI client (lazy init)
// ─────────────────────────────────────────────────────────────

let _genAI: GoogleGenerativeAI | null = null

function getGenAI(): GoogleGenerativeAI {
  if (!_genAI) {
    const apiKey = process.env.GOOGLE_API_KEY
    if (!apiKey) {
      throw new Error('GOOGLE_API_KEY no configurada en variables de entorno')
    }
    _genAI = new GoogleGenerativeAI(apiKey)
  }
  return _genAI
}

// ─────────────────────────────────────────────────────────────
// Core embedding function
// ─────────────────────────────────────────────────────────────

/**
 * Trunca un vector a la dimensión objetivo.
 * Google recomienda truncación (tomar los primeros N valores)
 * como forma oficial de reducir dimensionalidad en sus modelos.
 */
function truncateVector(vector: number[], targetDim: number): number[] {
  if (vector.length <= targetDim) return vector
  return vector.slice(0, targetDim)
}

/**
 * Genera embeddings en batch usando batchEmbedContents.
 * Trunca cada vector a EMBEDDING_DIMENSION (768) para compatibilidad
 * con pgvector schema.
 */
async function generateEmbeddingsBatch(
  texts: string[]
): Promise<number[][]> {
  const genAI = getGenAI()
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL })

  const requests = texts.map(text => ({
    content: { parts: [{ text }], role: 'user' as const },
  }))

  const result = await model.batchEmbedContents({
    requests,
  })

  if (!result.embeddings || result.embeddings.length !== texts.length) {
    throw new Error(
      `Batch embedding: esperados ${texts.length} embeddings, recibidos ${result.embeddings?.length ?? 0}`
    )
  }

  return result.embeddings.map(e => truncateVector(e.values, EMBEDDING_DIMENSION))
}

/**
 * Wrapper con retry y exponential backoff.
 */
async function generateEmbeddingsBatchWithRetry(
  texts: string[],
  retryCount = 0
): Promise<{ vectors: number[][]; retries: number }> {
  try {
    const vectors = await generateEmbeddingsBatch(texts)
    return { vectors, retries: retryCount }
  } catch (error) {
    if (retryCount >= MAX_RETRIES) {
      throw error
    }

    const delay = BASE_RETRY_DELAY_MS * Math.pow(2, retryCount)
    const errorMsg = error instanceof Error ? error.message : String(error)
    const isRateLimit = errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED')

    if (isRateLimit || errorMsg.includes('503') || errorMsg.includes('UNAVAILABLE')) {
      console.warn(
        `[embeddings] Retry ${retryCount + 1}/${MAX_RETRIES} después de ${delay}ms: ${errorMsg}`
      )
      await new Promise(resolve => setTimeout(resolve, delay))
      return generateEmbeddingsBatchWithRetry(texts, retryCount + 1)
    }

    throw error
  }
}

// ─────────────────────────────────────────────────────────────
// Main: generar embeddings para un documento completo
// ─────────────────────────────────────────────────────────────

export async function generateEmbeddingsForDocument(
  options: GenerateEmbeddingsForDocumentOptions
): Promise<EmbeddingGenerationResult> {
  const { documentId, caseId, userId, chunks, parentMetadata, caseMetadata } = options
  const startTime = Date.now()
  const errors: string[] = []
  let embeddingsGenerated = 0
  let embeddingsSkipped = 0
  let totalRetries = 0
  let batchesProcessed = 0

  if (chunks.length === 0) {
    return {
      success: true,
      totalChunks: 0,
      embeddingsGenerated: 0,
      embeddingsSkipped: 0,
      errors: [],
      stats: { totalTokensEstimated: 0, batchesProcessed: 0, retriesNeeded: 0, durationMs: 0 },
    }
  }

  const admin = createAdminClient()
  const enrichmentContext = { parentMetadata: parentMetadata ?? {}, caseMetadata: caseMetadata ?? {} }

  // Obtener chunk_ids desde DB (los chunks en memoria no tienen el UUID de DB)
  const { data: dbChunks, error: fetchError } = await admin
    .from('document_chunks')
    .select('id, chunk_index')
    .eq('document_id', documentId)
    .order('chunk_index', { ascending: true })

  if (fetchError || !dbChunks) {
    return {
      success: false,
      totalChunks: chunks.length,
      embeddingsGenerated: 0,
      embeddingsSkipped: 0,
      errors: [`Error obteniendo chunks de DB: ${fetchError?.message ?? 'sin datos'}`],
      stats: { totalTokensEstimated: 0, batchesProcessed: 0, retriesNeeded: 0, durationMs: Date.now() - startTime },
    }
  }

  // Verificar embeddings existentes (idempotencia)
  const chunkIds = dbChunks.map(c => c.id)
  const { data: existingEmbeddings } = await admin
    .from('document_embeddings')
    .select('chunk_id')
    .in('chunk_id', chunkIds)

  const existingChunkIds = new Set((existingEmbeddings ?? []).map(e => e.chunk_id))

  // Preparar inputs: enriquecer cada chunk y generar embedding input
  const inputs: Array<{
    chunkId: string
    chunkIndex: number
    embeddingText: string
    tokenEstimate: number
  }> = []

  for (const dbChunk of dbChunks) {
    if (existingChunkIds.has(dbChunk.id)) {
      embeddingsSkipped++
      continue
    }

    const memChunk = chunks.find(c => c.chunkIndex === dbChunk.chunk_index)
    if (!memChunk) continue

    const enriched = enrichChunkMetadata(memChunk, enrichmentContext)
    const embeddingText = buildEmbeddingInput(memChunk, enriched)

    inputs.push({
      chunkId: dbChunk.id,
      chunkIndex: dbChunk.chunk_index,
      embeddingText,
      tokenEstimate: memChunk.tokenEstimate,
    })
  }

  if (inputs.length === 0) {
    return {
      success: true,
      totalChunks: chunks.length,
      embeddingsGenerated: 0,
      embeddingsSkipped: embeddingsSkipped,
      errors: [],
      stats: {
        totalTokensEstimated: 0,
        batchesProcessed: 0,
        retriesNeeded: 0,
        durationMs: Date.now() - startTime,
      },
    }
  }

  // Procesar en batches
  let totalTokens = 0

  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    const batch = inputs.slice(i, i + BATCH_SIZE)
    const texts = batch.map(b => b.embeddingText)

    try {
      const { vectors, retries } = await generateEmbeddingsBatchWithRetry(texts)
      totalRetries += retries

      if (vectors.length !== batch.length) {
        errors.push(`Batch ${batchesProcessed}: esperados ${batch.length} vectores, recibidos ${vectors.length}`)
        continue
      }

      // Insertar embeddings en DB
      const rows: DocumentEmbeddingInsert[] = batch.map((input, idx) => ({
        chunk_id: input.chunkId,
        case_id: caseId,
        user_id: userId,
        embedding: JSON.stringify(vectors[idx]),
      }))

      const { error: insertError } = await admin
        .from('document_embeddings')
        .upsert(rows, { onConflict: 'chunk_id' })

      if (insertError) {
        errors.push(`Batch ${batchesProcessed}: error insertando: ${insertError.message}`)
      } else {
        embeddingsGenerated += batch.length
        totalTokens += batch.reduce((sum, b) => sum + b.tokenEstimate, 0)
      }

      batchesProcessed++
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      errors.push(`Batch ${batchesProcessed}: error tras ${MAX_RETRIES} reintentos: ${msg}`)
      batchesProcessed++
    }
  }

  return {
    success: errors.length === 0,
    totalChunks: chunks.length,
    embeddingsGenerated,
    embeddingsSkipped,
    errors,
    stats: {
      totalTokensEstimated: totalTokens,
      batchesProcessed,
      retriesNeeded: totalRetries,
      durationMs: Date.now() - startTime,
    },
  }
}

// ─────────────────────────────────────────────────────────────
// Utilidad: generar embedding de una query (para RAG search)
// ─────────────────────────────────────────────────────────────

/**
 * Genera el embedding de una query del usuario para búsqueda RAG.
 * Usado en el pipeline de chat (3.02) para encontrar chunks relevantes.
 */
export async function generateQueryEmbedding(query: string): Promise<number[]> {
  const genAI = getGenAI()
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL })

  const result = await model.embedContent({
    content: { parts: [{ text: query }], role: 'user' },
  })

  if (!result.embedding?.values) {
    throw new Error('Embedding de query vacío')
  }

  return truncateVector(result.embedding.values, EMBEDDING_DIMENSION)
}
