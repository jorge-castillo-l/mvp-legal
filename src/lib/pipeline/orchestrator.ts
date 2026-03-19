/**
 * ============================================================
 * PDF Processing Orchestrator — Tarea 7.05
 * ============================================================
 * Orquesta la extracción de texto de PDFs de forma asíncrona.
 *
 * Flujo por documento:
 *   1) Descargar PDF desde Supabase Storage
 *   2) Intentar extracción nativa (pdf-parse) — gratis
 *   3) Si falla/necesita OCR → Document AI — de pago
 *   4) Guardar resultado en extracted_texts
 *   5) Normalizar texto (7.07a) → limpiar artefactos PJUD
 *   6) Chunkear texto (7.07b) → INSERT document_chunks
 *   7) Actualizar estado en processing_queue
 *
 * Reintentos: máximo 3 con backoff exponencial (10s, 60s, 5min).
 * PDFs grandes (>15 páginas): Document AI ya los divide en lotes
 * de 15 páginas (ver document-ai.ts DOCUMENT_AI_BATCH_PAGE_SIZE).
 *
 * Usa admin client (service role) para bypasear RLS — las
 * validaciones de usuario ya ocurrieron en el upload.
 * ============================================================
 */

import { createAdminClient } from '@/lib/supabase/server'
import { extractPdfTextWithFallback } from '@/lib/pdf-processing'
import { normalizePjudText, type NormalizerResult, type ExtractionMethod } from '@/lib/pipeline/chunking/normalizer'
import { detectSections } from '@/lib/pipeline/chunking/section-detector'
import { chunkText } from '@/lib/pipeline/chunking/token-chunker'
import { enrichChunkMetadata, type DocumentParentMetadata, type CaseMetadata } from '@/lib/pipeline/chunking/metadata-enricher'
import { generateEmbeddingsForDocument } from '@/lib/embeddings'
import type { ExtractedTextInsert, DocumentChunkInsert } from '@/types/database'

const BUCKET_NAME = 'case-files'
const RETRY_DELAYS_MS = [10_000, 60_000, 300_000] as const // 10s, 1min, 5min

export type QueueStatus = 'queued' | 'processing' | 'completed' | 'failed'

export interface DocMetadata {
  folio_numero?: number | null
  etapa?: string | null
  tramite?: string | null
  desc_tramite?: string | null
  fecha_tramite?: string | null
  foja?: number | null
  cuaderno?: string | null
  source_tab?: 'historia' | 'piezas_exhorto'
  fecha_documento?: string | null
  referencia?: string | null
  [key: string]: unknown
}

export interface QueueEntryMetadata {
  storage_path: string
  filename: string
  document_type: string
  file_size: number
  source: string
  rol: string
  doc_metadata?: DocMetadata
}

export interface QueueEntry {
  id: string
  document_id: string
  case_id: string
  user_id: string
  status: QueueStatus
  attempts: number
  max_attempts: number
  last_error: string | null
  started_at: string | null
  completed_at: string | null
  next_retry_at: string | null
  metadata: QueueEntryMetadata
  created_at: string
  updated_at: string
}

export interface ProcessingResult {
  success: boolean
  queueId: string
  documentId: string
  status: QueueStatus
  attempts: number
  extraction?: {
    method: string
    status: string
    pageCount: number
    charsPerPage: number
    ocrAttempted: boolean
    ocrBatchCount: number
  }
  error?: string
}

// ─────────────────────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────────────────────

async function downloadPdf(storagePath: string): Promise<Buffer> {
  const admin = createAdminClient()
  const { data, error } = await admin.storage
    .from(BUCKET_NAME)
    .download(storagePath)

  if (error || !data) {
    throw new Error(`Error descargando PDF desde Storage: ${error?.message || 'blob vacío'}`)
  }

  const arrayBuffer = await data.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

function calculateNextRetryAt(currentAttempt: number): string {
  const index = Math.min(currentAttempt, RETRY_DELAYS_MS.length - 1)
  const delayMs = RETRY_DELAYS_MS[index]
  return new Date(Date.now() + delayMs).toISOString()
}

// ─────────────────────────────────────────────────────────────
// Función principal: procesar un documento
// ─────────────────────────────────────────────────────────────

export async function processDocument(documentId: string): Promise<ProcessingResult> {
  const admin = createAdminClient()

  // ── 1. Obtener entrada de la cola ──────────────────────────
  const { data: raw, error: queueError } = await admin
    .from('processing_queue')
    .select('*')
    .eq('document_id', documentId)
    .single()

  if (queueError || !raw) {
    return {
      success: false,
      queueId: '',
      documentId,
      status: 'failed',
      attempts: 0,
      error: `Cola no encontrada para document_id=${documentId}: ${queueError?.message || 'no existe'}`,
    }
  }

  const entry = raw as unknown as QueueEntry

  // ── 2. Guardas de idempotencia ─────────────────────────────
  if (entry.status === 'completed') {
    return {
      success: true,
      queueId: entry.id,
      documentId,
      status: 'completed',
      attempts: entry.attempts,
    }
  }

  if (entry.status === 'processing') {
    return {
      success: false,
      queueId: entry.id,
      documentId,
      status: 'processing',
      attempts: entry.attempts,
      error: 'El documento ya está siendo procesado por otro worker',
    }
  }

  if (entry.attempts >= entry.max_attempts) {
    return {
      success: false,
      queueId: entry.id,
      documentId,
      status: 'failed',
      attempts: entry.attempts,
      error: `Máximo de reintentos alcanzado (${entry.max_attempts})`,
    }
  }

  // ── 3. Marcar como "processing" ────────────────────────────
  const newAttempts = entry.attempts + 1
  await admin
    .from('processing_queue')
    .update({
      status: 'processing' as string,
      attempts: newAttempts,
      started_at: new Date().toISOString(),
      last_error: null,
    })
    .eq('id', entry.id)

  try {
    // ── 4. Descargar PDF desde Storage ─────────────────────────
    const storagePath = entry.metadata?.storage_path
    if (!storagePath) {
      throw new Error('storage_path no encontrado en metadata de la cola')
    }

    const buffer = await downloadPdf(storagePath)

    // ── 5. Extraer texto (pdf-parse → fallback Document AI) ────
    const extraction = await extractPdfTextWithFallback(buffer)

    // ── 6. Guardar en extracted_texts (upsert idempotente) ─────
    const payload: ExtractedTextInsert = {
      document_id: documentId,
      case_id: entry.case_id,
      user_id: entry.user_id,
      full_text: extraction.fullText,
      extraction_method: extraction.extractionMethod,
      page_count: extraction.pageCount,
      status: extraction.status,
    }

    const { error: upsertError } = await admin
      .from('extracted_texts')
      .upsert(payload, { onConflict: 'document_id' })

    if (upsertError) {
      throw new Error(`Error guardando en extracted_texts: ${upsertError.message}`)
    }

    // ── 7. Normalizar + Chunkear (7.07a + 7.07b) ───────────────
    // Solo si la extracción fue exitosa y hay texto útil.
    // El texto original queda intacto en extracted_texts.full_text.
    if (extraction.status === 'completed' && extraction.fullText.length > 0) {
      try {
        const extractionMethod: ExtractionMethod = extraction.extractionMethod as ExtractionMethod

        const normalized = normalizePjudText(extraction.fullText, {
          extractionMethod,
          mode: 'conservative',
        }) as NormalizerResult

        const sectionResult = detectSections(normalized.cleanText)

        const chunked = chunkText(normalized.cleanText, {
          normalizerMetadata: normalized.extractedMetadata,
          documentType: entry.metadata?.document_type,
          detectedSections: sectionResult.sections,
        })

        if (chunked.chunks.length > 0) {
          // Idempotencia: eliminar chunks previos del documento
          await admin
            .from('document_chunks')
            .delete()
            .eq('document_id', documentId)

          // ── 7.07d: Enriquecer metadata de cada chunk ──────────
          const docMeta = entry.metadata?.doc_metadata
          const parentMetadata: DocumentParentMetadata = {
            document_type: entry.metadata?.document_type,
            folio_numero: docMeta?.folio_numero,
            cuaderno: docMeta?.cuaderno,
            fecha_tramite: docMeta?.fecha_tramite,
            desc_tramite: docMeta?.desc_tramite,
            foja: docMeta?.foja,
            etapa: docMeta?.etapa,
            tramite: docMeta?.tramite,
          }

          // Obtener metadata de la causa (procedimiento, libro_tipo)
          let caseMetadata: CaseMetadata = {}
          const { data: caseRow } = await admin
            .from('cases')
            .select('procedimiento, libro_tipo, tribunal, rol')
            .eq('id', entry.case_id)
            .single()

          if (caseRow) {
            caseMetadata = {
              procedimiento: caseRow.procedimiento,
              libro_tipo: caseRow.libro_tipo,
              tribunal: caseRow.tribunal,
              rol: caseRow.rol,
            }
          }

          const enrichmentContext = { parentMetadata, caseMetadata }

          const chunkRows: DocumentChunkInsert[] = chunked.chunks.map((chunk) => {
            const enriched = enrichChunkMetadata(chunk, enrichmentContext)
            return {
              document_id: documentId,
              case_id: entry.case_id,
              user_id: entry.user_id,
              extracted_text_id: undefined as unknown as string,
              chunk_index: chunk.chunkIndex,
              chunk_text: chunk.chunkText,
              page_number: chunk.pageNumber,
              section_type: chunk.sectionType,
              metadata: {
                ...enriched,
                pipeline_stats: {
                  normalizer: {
                    artifacts_removed: normalized.stats.artifactsRemoved,
                    encoding_fixes: normalized.stats.encodingFixes,
                    reduction_percent: normalized.stats.reductionPercent,
                  },
                  section_detector: {
                    document_structure: sectionResult.documentStructure,
                    sections_detected: sectionResult.stats.sectionsDetected,
                  },
                  chunker: {
                    total_chunks: chunked.stats.totalChunks,
                    avg_tokens: chunked.stats.avgChunkTokens,
                  },
                },
              },
            }
          })

          // Obtener extracted_text_id para los chunks
          const { data: etRow } = await admin
            .from('extracted_texts')
            .select('id')
            .eq('document_id', documentId)
            .single()

          if (etRow?.id) {
            for (const row of chunkRows) {
              row.extracted_text_id = etRow.id
            }
          }

          const { error: chunkError } = await admin
            .from('document_chunks')
            .insert(chunkRows)

          if (chunkError) {
            console.error(`[orchestrator] Error insertando chunks para doc ${documentId}: ${chunkError.message}`)
          } else {
            // ── 8. Generar embeddings (7.08) — best-effort ────────
            // Si falla, los chunks quedan en DB y se pueden embedar después.
            try {
              const embeddingResult = await generateEmbeddingsForDocument({
                documentId,
                caseId: entry.case_id,
                userId: entry.user_id,
                chunks: chunked.chunks,
                parentMetadata,
                caseMetadata,
              })

              if (embeddingResult.errors.length > 0) {
                console.warn(
                  `[orchestrator] Embeddings parcial para doc ${documentId}: ${embeddingResult.embeddingsGenerated}/${embeddingResult.totalChunks} generados, ${embeddingResult.errors.length} errores`
                )
              }
            } catch (embeddingError) {
              console.error(
                `[orchestrator] Error generando embeddings para doc ${documentId}:`,
                embeddingError instanceof Error ? embeddingError.message : embeddingError
              )
            }
          }
        }
      } catch (chunkingError) {
        // El chunking es best-effort: si falla, el documento queda en
        // extracted_texts sin chunks. Se puede reprocesar después.
        console.error(
          `[orchestrator] Error en normalización/chunking para doc ${documentId}:`,
          chunkingError instanceof Error ? chunkingError.message : chunkingError
        )
      }
    }

    // ── 8. Actualizar cola según resultado ─────────────────────
    // 'completed' y 'needs_ocr' son estados terminales válidos.
    // Solo 'failed' dispara reintentos (error real de extracción).
    const extractionFailed = extraction.status === 'failed'

    if (!extractionFailed) {
      await admin
        .from('processing_queue')
        .update({
          status: 'completed' as string,
          completed_at: new Date().toISOString(),
          last_error: null,
        })
        .eq('id', entry.id)
    } else {
      const shouldRetry = newAttempts < entry.max_attempts
      await admin
        .from('processing_queue')
        .update({
          status: 'failed' as string,
          last_error: extraction.errorMessage || 'Todos los métodos de extracción fallaron (pdf-parse, Document AI, Tesseract)',
          next_retry_at: shouldRetry ? calculateNextRetryAt(newAttempts) : null,
        })
        .eq('id', entry.id)
    }

    return {
      success: !extractionFailed,
      queueId: entry.id,
      documentId,
      status: extractionFailed ? 'failed' : 'completed',
      attempts: newAttempts,
      extraction: {
        method: extraction.extractionMethod,
        status: extraction.status,
        pageCount: extraction.pageCount,
        charsPerPage: extraction.charsPerPage,
        ocrAttempted: extraction.ocrAttempted,
        ocrBatchCount: extraction.ocrBatchCount,
      },
    }
  } catch (error) {
    // ── Error inesperado — registrar y decidir reintento ───────
    const errorMessage = error instanceof Error ? error.message : 'Error desconocido en procesamiento'
    const shouldRetry = newAttempts < entry.max_attempts

    await admin
      .from('processing_queue')
      .update({
        status: 'failed' as string,
        last_error: errorMessage,
        next_retry_at: shouldRetry ? calculateNextRetryAt(newAttempts) : null,
      })
      .eq('id', entry.id)

    // Marcar extracted_texts como failed si existe
    await admin
      .from('extracted_texts')
      .upsert(
        {
          document_id: documentId,
          case_id: entry.case_id,
          user_id: entry.user_id,
          status: 'failed',
        } as ExtractedTextInsert,
        { onConflict: 'document_id' }
      )
      .then(() => undefined)
      .catch(() => undefined)

    return {
      success: false,
      queueId: entry.id,
      documentId,
      status: 'failed',
      attempts: newAttempts,
      error: errorMessage,
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Reintentar documentos fallidos que ya cumplieron su backoff
// ─────────────────────────────────────────────────────────────

export async function retryFailedDocuments(limit = 10): Promise<ProcessingResult[]> {
  const admin = createAdminClient()
  const now = new Date().toISOString()

  const { data: entries, error } = await admin
    .from('processing_queue')
    .select('document_id, attempts, max_attempts')
    .eq('status', 'failed')
    .or(`next_retry_at.is.null,next_retry_at.lte.${now}`)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error || !entries?.length) {
    return []
  }

  // Filtrar los que aún tienen reintentos disponibles
  const retryable = entries.filter((e) => e.attempts < e.max_attempts)
  const results: ProcessingResult[] = []

  for (const entry of retryable) {
    const result = await processDocument(entry.document_id)
    results.push(result)
  }

  return results
}

// ─────────────────────────────────────────────────────────────
// Consultas de estado
// ─────────────────────────────────────────────────────────────

export async function getQueueStats(): Promise<{
  queued: number
  processing: number
  completed: number
  failed: number
  retryable: number
}> {
  const admin = createAdminClient()

  const [queued, processing, completed, failed] = await Promise.all([
    admin.from('processing_queue').select('*', { count: 'exact', head: true }).eq('status', 'queued'),
    admin.from('processing_queue').select('*', { count: 'exact', head: true }).eq('status', 'processing'),
    admin.from('processing_queue').select('*', { count: 'exact', head: true }).eq('status', 'completed'),
    admin.from('processing_queue').select('*', { count: 'exact', head: true }).eq('status', 'failed'),
  ])

  const { count: retryableCount } = await admin
    .from('processing_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'failed')
    .or(`next_retry_at.is.null,next_retry_at.lte.${new Date().toISOString()}`)

  return {
    queued: queued.count || 0,
    processing: processing.count || 0,
    completed: completed.count || 0,
    failed: failed.count || 0,
    retryable: retryableCount || 0,
  }
}
