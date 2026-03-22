/**
 * ============================================================
 * TEST END-TO-END: Pipeline completo contra Supabase + Google AI
 * ============================================================
 * Ejecuta el pipeline real sobre un documento que ya tiene texto
 * extraído en extracted_texts:
 *
 *   extracted_texts → normalizer → section-detector → chunker
 *   → metadata-enricher → INSERT document_chunks
 *   → embedding generation → INSERT document_embeddings
 *   → VERIFICACIÓN en DB
 *
 * Ejecutar: npx tsx src/lib/pipeline/test-e2e-pipeline.ts
 *
 * Requiere .env.local con:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   GOOGLE_API_KEY
 * ============================================================
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'
import { GoogleGenAI } from '@google/genai'
import { normalizePjudText, type NormalizerResult, type ExtractionMethod } from './chunking/normalizer'
import { detectSections } from './chunking/section-detector'
import { chunkText, type Chunk } from './chunking/token-chunker'
import {
  enrichChunkMetadata,
  buildEmbeddingInput,
  buildCitationLabel,
  type DocumentParentMetadata,
  type CaseMetadata,
} from './chunking/metadata-enricher'

// ─────────────────────────────────────────────────────────────
// Configuración
// ─────────────────────────────────────────────────────────────

const EMBEDDING_MODEL = 'gemini-embedding-001'
const EMBEDDING_DIMENSION = 768
const BATCH_SIZE = 100

function createAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

function getGenAI(): GoogleGenAI {
  const apiKey = process.env.GOOGLE_API_KEY
  if (!apiKey) throw new Error('Falta GOOGLE_API_KEY en .env.local')
  return new GoogleGenAI({ apiKey })
}

function truncateVector(vector: number[], dim: number): number[] {
  return vector.length <= dim ? vector : vector.slice(0, dim)
}

// ─────────────────────────────────────────────────────────────
// Helpers de verificación
// ─────────────────────────────────────────────────────────────

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${msg}`)
}

function printSection(title: string) {
  console.log(`\n${'─'.repeat(70)}`)
  console.log(`  ${title}`)
  console.log('─'.repeat(70))
}

function printOk(msg: string) { console.log(`  ✓ ${msg}`) }
function printWarn(msg: string) { console.log(`  ⚠ ${msg}`) }
function printFail(msg: string) { console.log(`  ✗ ${msg}`) }
function printInfo(msg: string) { console.log(`    ${msg}`) }

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now()
  let passed = 0
  let failed = 0
  let warnings = 0

  console.log('\n' + '═'.repeat(70))
  console.log('  TEST E2E — Pipeline Completo: Supabase + Google Embeddings')
  console.log('═'.repeat(70))

  const admin = createAdmin()
  const genAI = getGenAI()

  // ── PASO 1: Buscar un documento de prueba ─────────────────
  printSection('PASO 1: Selección de documento de prueba')

  const { data: candidates, error: fetchErr } = await admin
    .from('extracted_texts')
    .select('id, document_id, case_id, user_id, extraction_method, page_count, status, full_text')
    .eq('status', 'completed')
    .gt('page_count', 1)
    .order('page_count', { ascending: true })
    .limit(20)

  if (fetchErr || !candidates || candidates.length === 0) {
    printFail(`No se encontraron documentos con texto extraído: ${fetchErr?.message || 'tabla vacía'}`)
    printInfo('Asegúrate de haber sincronizado causas y procesado al menos un PDF.')
    process.exit(1)
  }

  const target = candidates.find(c =>
    c.full_text && c.full_text.length > 1000 && c.full_text.length < 60000
  ) ?? candidates[0]

  const textLength = target.full_text?.length ?? 0

  printOk(`Documento seleccionado: ${target.document_id}`)
  printInfo(`extracted_text_id: ${target.id}`)
  printInfo(`case_id:           ${target.case_id}`)
  printInfo(`extraction_method: ${target.extraction_method}`)
  printInfo(`page_count:        ${target.page_count}`)
  printInfo(`chars:             ${textLength}`)
  passed++

  if (textLength === 0) {
    printFail('El documento no tiene texto — abortando')
    process.exit(1)
  }

  // Obtener metadata del documento (de la tabla documents)
  const { data: docRow } = await admin
    .from('documents')
    .select('document_type, metadata')
    .eq('id', target.document_id)
    .single()

  const documentType = docRow?.document_type ?? 'desconocido'
  printInfo(`document_type:     ${documentType}`)

  // Obtener metadata de la causa
  const { data: caseRow } = await admin
    .from('cases')
    .select('procedimiento, libro_tipo, tribunal, rol')
    .eq('id', target.case_id)
    .single()

  if (caseRow) {
    printInfo(`causa:             ${caseRow.rol} — ${caseRow.tribunal ?? '?'}`)
    printInfo(`procedimiento:     ${caseRow.procedimiento ?? '(sin dato)'}`)
  }

  // ── PASO 2: Normalizer (7.07a) ────────────────────────────
  printSection('PASO 2: Normalizer (7.07a)')

  const extractionMethod: ExtractionMethod = (target.extraction_method as ExtractionMethod) || 'pdf-parse'
  const normalized = normalizePjudText(target.full_text!, { extractionMethod, mode: 'conservative' }) as NormalizerResult

  assert(normalized.cleanText.length > 0, 'Normalizer produjo texto vacío')
  printOk(`Texto normalizado: ${normalized.cleanText.length} chars (de ${textLength})`)
  printInfo(`Reducción:         ${normalized.stats.reductionPercent}%`)
  printInfo(`Artefactos:        ${normalized.stats.artifactsRemoved} removidos`)
  printInfo(`Encoding fixes:    ${normalized.stats.encodingFixes}`)
  printInfo(`Page boundaries:   ${normalized.stats.pageBoundariesDetected}`)
  passed++

  if (normalized.stats.reductionPercent > 50) {
    printWarn(`Reducción alta (${normalized.stats.reductionPercent}%) — revisar si se perdió contenido`)
    warnings++
  }

  // ── PASO 3: Section Detector (7.07c) ──────────────────────
  printSection('PASO 3: Section Detector (7.07c)')

  const sections = detectSections(normalized.cleanText)

  printOk(`Estructura:        ${sections.documentStructure}`)
  printInfo(`Secciones:         ${sections.stats.sectionsDetected} (${sections.stats.highConfidence} alta confianza)`)

  if (sections.sections.length > 0) {
    const types = [...new Set(sections.sections.map(s => s.type))]
    printInfo(`Tipos detectados:  ${types.join(', ')}`)
  }

  if (sections.documentStructure === 'indeterminado' && textLength > 2000) {
    printWarn('Estructura indeterminada en documento largo')
    warnings++
  }
  passed++

  // ── PASO 4: Token Chunker (7.07b) ─────────────────────────
  printSection('PASO 4: Token Chunker (7.07b)')

  const chunked = chunkText(normalized.cleanText, {
    normalizerMetadata: normalized.extractedMetadata,
    documentType,
    detectedSections: sections.sections,
  })

  assert(chunked.chunks.length > 0, 'Chunker no produjo chunks')
  printOk(`Chunks generados:  ${chunked.stats.totalChunks}`)
  printInfo(`Avg tokens:        ${chunked.stats.avgChunkTokens}`)
  printInfo(`Min tokens:        ${chunked.stats.minChunkTokens}`)
  printInfo(`Max tokens:        ${chunked.stats.maxChunkTokens}`)
  printInfo(`Short doc:         ${chunked.stats.shortDocSingleChunk ? 'sí' : 'no'}`)

  for (const chunk of chunked.chunks) {
    if (chunk.tokenEstimate > 1500) {
      printWarn(`Chunk ${chunk.chunkIndex} excede 1500 tokens (${chunk.tokenEstimate})`)
      warnings++
    }
  }
  passed++

  // ── PASO 5: Metadata Enricher (7.07d) ─────────────────────
  printSection('PASO 5: Metadata Enricher (7.07d)')

  const parentMetadata: DocumentParentMetadata = {
    document_type: documentType,
    folio_numero: (docRow?.metadata as Record<string, unknown>)?.folio_numero as number | undefined,
    cuaderno: (docRow?.metadata as Record<string, unknown>)?.cuaderno as string | undefined,
    fecha_tramite: (docRow?.metadata as Record<string, unknown>)?.fecha_tramite as string | undefined,
    desc_tramite: (docRow?.metadata as Record<string, unknown>)?.desc_tramite as string | undefined,
  }

  const caseMetadata: CaseMetadata = caseRow ? {
    procedimiento: caseRow.procedimiento,
    libro_tipo: caseRow.libro_tipo,
    tribunal: caseRow.tribunal,
    rol: caseRow.rol,
  } : {}

  const enrichmentCtx = { parentMetadata, caseMetadata }
  const firstChunk = chunked.chunks[0]
  const enrichedSample = enrichChunkMetadata(firstChunk, enrichmentCtx)
  const embeddingInputSample = buildEmbeddingInput(firstChunk, enrichedSample)
  const citationSample = buildCitationLabel(enrichedSample)

  assert(embeddingInputSample.length > 0, 'buildEmbeddingInput devolvió string vacío')
  assert(citationSample.length > 0, 'buildCitationLabel devolvió string vacío')

  const bracketEnd = embeddingInputSample.indexOf(']')
  const prefix = bracketEnd > 0 ? embeddingInputSample.slice(0, bracketEnd + 1) : embeddingInputSample.slice(0, 80)

  printOk(`Embedding prefix:  ${prefix}`)
  printInfo(`Citation label:    ${citationSample}`)
  printInfo(`Chunks con sección: ${chunked.chunks.filter(c => c.sectionType !== 'general').length}/${chunked.chunks.length}`)
  passed++

  // ── PASO 6: INSERT document_chunks en Supabase ────────────
  printSection('PASO 6: INSERT document_chunks en Supabase')

  // Idempotencia: eliminar chunks previos
  const { error: delChunkErr } = await admin
    .from('document_chunks')
    .delete()
    .eq('document_id', target.document_id)

  if (delChunkErr) {
    printWarn(`Error borrando chunks previos (puede ser primera vez): ${delChunkErr.message}`)
  }

  const chunkRows = chunked.chunks.map((chunk) => {
    const enriched = enrichChunkMetadata(chunk, enrichmentCtx)
    return {
      document_id: target.document_id,
      case_id: target.case_id,
      user_id: target.user_id,
      extracted_text_id: target.id,
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
            document_structure: sections.documentStructure,
            sections_detected: sections.stats.sectionsDetected,
          },
          chunker: {
            total_chunks: chunked.stats.totalChunks,
            avg_tokens: chunked.stats.avgChunkTokens,
          },
        },
      },
    }
  })

  const { error: insertChunkErr } = await admin
    .from('document_chunks')
    .insert(chunkRows)

  if (insertChunkErr) {
    printFail(`Error insertando chunks: ${insertChunkErr.message}`)
    failed++
  } else {
    printOk(`${chunkRows.length} chunks insertados correctamente`)
    passed++
  }

  // Verificar lectura
  const { data: dbChunks, error: readChunkErr } = await admin
    .from('document_chunks')
    .select('id, chunk_index, section_type, page_number, metadata')
    .eq('document_id', target.document_id)
    .order('chunk_index', { ascending: true })

  if (readChunkErr || !dbChunks) {
    printFail(`Error leyendo chunks de DB: ${readChunkErr?.message}`)
    failed++
  } else {
    assert(dbChunks.length === chunked.chunks.length, `Chunks en DB (${dbChunks.length}) ≠ chunks generados (${chunked.chunks.length})`)
    printOk(`Verificación: ${dbChunks.length} chunks en DB = ${chunked.chunks.length} generados`)

    const withMetadata = dbChunks.filter(c => c.metadata && Object.keys(c.metadata as object).length > 0).length
    printInfo(`Con metadata:      ${withMetadata}/${dbChunks.length}`)
    passed++
  }

  // ── PASO 7: Generar embeddings con Google AI ──────────────
  printSection('PASO 7: Generar embeddings (7.08) con Google AI')

  if (!dbChunks || dbChunks.length === 0) {
    printFail('Sin chunks en DB — no se pueden generar embeddings')
    failed++
  } else {
    // Eliminar embeddings previos (idempotencia)
    const chunkIds = dbChunks.map(c => c.id)
    await admin
      .from('document_embeddings')
      .delete()
      .in('chunk_id', chunkIds)

    // Preparar inputs
    const embeddingInputs: Array<{ chunkId: string; text: string }> = []
    for (const dbChunk of dbChunks) {
      const memChunk = chunked.chunks.find(c => c.chunkIndex === dbChunk.chunk_index)
      if (!memChunk) continue
      const enriched = enrichChunkMetadata(memChunk, enrichmentCtx)
      const text = buildEmbeddingInput(memChunk, enriched)
      embeddingInputs.push({ chunkId: dbChunk.id, text })
    }

    printInfo(`Inputs preparados:  ${embeddingInputs.length}`)

    let embeddingsGenerated = 0

    for (let i = 0; i < embeddingInputs.length; i += BATCH_SIZE) {
      const batch = embeddingInputs.slice(i, i + BATCH_SIZE)
      const texts = batch.map(b => b.text)

      const embedResults = await Promise.all(
        texts.map(text =>
          genAI.models.embedContent({
            model: EMBEDDING_MODEL,
            contents: text,
          })
        )
      )

      const vectors = embedResults.map(r => {
        const values = r.embeddings?.[0]?.values
        if (!values) throw new Error('Embedding vacío')
        return truncateVector(values, EMBEDDING_DIMENSION)
      })

      if (vectors.length !== batch.length) {
        printFail(`Batch ${Math.floor(i / BATCH_SIZE)}: esperados ${batch.length} vectores, recibidos ${vectors.length}`)
        failed++
        continue
      }

      const rows = batch.map((input, idx) => ({
        chunk_id: input.chunkId,
        case_id: target.case_id,
        user_id: target.user_id,
        embedding: JSON.stringify(vectors[idx]),
      }))

      const { error: embInsertErr } = await admin
        .from('document_embeddings')
        .upsert(rows, { onConflict: 'chunk_id' })

      if (embInsertErr) {
        printFail(`Error insertando embeddings: ${embInsertErr.message}`)
        failed++
      } else {
        embeddingsGenerated += batch.length
      }
    }

    printOk(`${embeddingsGenerated} embeddings generados e insertados`)
    passed++
  }

  // ── PASO 8: Verificación final en DB ──────────────────────
  printSection('PASO 8: Verificación final en DB')

  // Verificar document_chunks
  const { count: chunkCount } = await admin
    .from('document_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('document_id', target.document_id)

  // Verificar document_embeddings
  const chunkIdsForVerification = dbChunks?.map(c => c.id) ?? []
  const { data: embRows, error: embReadErr } = await admin
    .from('document_embeddings')
    .select('id, chunk_id, embedding')
    .in('chunk_id', chunkIdsForVerification.length > 0 ? chunkIdsForVerification : ['__none__'])

  if (embReadErr) {
    printFail(`Error leyendo embeddings: ${embReadErr.message}`)
    failed++
  } else {
    const embCount = embRows?.length ?? 0

    printOk(`document_chunks:     ${chunkCount ?? 0} filas`)
    printOk(`document_embeddings: ${embCount} filas`)

    if ((chunkCount ?? 0) > 0 && embCount === (chunkCount ?? 0)) {
      printOk(`Paridad: chunks (${chunkCount}) = embeddings (${embCount})`)
      passed++
    } else if ((chunkCount ?? 0) > 0) {
      printWarn(`Discrepancia: chunks=${chunkCount}, embeddings=${embCount}`)
      warnings++
    }

    // Verificar dimensión de un embedding
    if (embRows && embRows.length > 0) {
      const sampleVector: number[] = JSON.parse(embRows[0].embedding)
      if (sampleVector.length === EMBEDDING_DIMENSION) {
        printOk(`Dimensión embedding: ${sampleVector.length} (correcto)`)
        passed++
      } else {
        printFail(`Dimensión embedding: ${sampleVector.length} (esperado ${EMBEDDING_DIMENSION})`)
        failed++
      }

      const isNonZero = sampleVector.some(v => v !== 0)
      if (isNonZero) {
        printOk('Vector no es todo-ceros')
        passed++
      } else {
        printFail('Vector es todo ceros — embedding inválido')
        failed++
      }

      const norm = Math.sqrt(sampleVector.reduce((s, v) => s + v * v, 0))
      printInfo(`Norma L2 sample:    ${norm.toFixed(4)}`)
    }
  }

  // ── RESUMEN ───────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

  console.log('\n' + '═'.repeat(70))
  console.log('  RESUMEN DEL TEST E2E')
  console.log('═'.repeat(70))
  console.log(`\n  Documento:       ${target.document_id}`)
  console.log(`  Causa:           ${caseRow?.rol ?? '?'} — ${caseRow?.tribunal ?? '?'}`)
  console.log(`  Tipo:            ${documentType}`)
  console.log(`  Extracción:      ${target.extraction_method}`)
  console.log(`  Chars orig:      ${textLength} → ${normalized.cleanText.length} (norm)`)
  console.log(`  Chunks:          ${chunked.stats.totalChunks}`)
  console.log(`  Embeddings:      ${embRows?.length ?? 0}`)
  console.log(`  Duración:        ${elapsed}s`)
  console.log()
  console.log(`  Passed:    ${passed}`)
  console.log(`  Warnings:  ${warnings}`)
  console.log(`  Failed:    ${failed}`)
  console.log()

  if (failed === 0) {
    console.log('  ══════════════════════════════════════════════')
    console.log('  ✓ PIPELINE E2E FUNCIONA CORRECTAMENTE')
    console.log('  ══════════════════════════════════════════════')
  } else {
    console.log('  ══════════════════════════════════════════════')
    console.log('  ✗ HAY FALLOS — REVISAR ARRIBA')
    console.log('  ══════════════════════════════════════════════')
  }

  console.log()
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('\n  ✗ ERROR FATAL:', err instanceof Error ? err.message : err)
  process.exit(1)
})
