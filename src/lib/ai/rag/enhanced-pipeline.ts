/**
 * ============================================================
 * Unified Analysis Pipeline — Zero Hallucination Architecture
 * ============================================================
 * Pipeline único para TODOS los modos (fast_chat, full_analysis,
 * deep_thinking). Cada modo recibe el mismo contexto completo:
 *   - Datos estructurados de la causa
 *   - Documentos clave (query-aware, sin caps fijos por tipo)
 *   - Inventario explícito de documentos (incluidos/no incluidos/pendientes)
 *   - RAG chunks (15, búsqueda híbrida)
 *
 * La diferencia entre modos es únicamente el modelo que responde:
 *   fast_chat      → Gemini 3 Flash  (rápido, sin citas precisas)
 *   full_analysis  → Claude Sonnet   (citas, análisis detallado)
 *   deep_thinking  → Claude Opus     (extended thinking, razonamiento profundo)
 *
 * El router (3.01) maneja la selección del provider automáticamente.
 * ============================================================
 */

import { createAdminClient } from '@/lib/supabase/server'
import type { Json } from '@/lib/database.types'
import { MODEL_IDS } from '../config'
import { getAIResponse, getAIResponseStream } from '../router'
import { buildSystemPrompt, isDeadlineAnalysisQuery, getDeadlineAnalysisPrompt } from '../prompts'
import { isSyncUpdatesQuery, fetchLastSyncChanges, getSyncUpdatesPrompt } from '../prompts/sync-updates-analysis'
import { shouldEnableWebSearch, isExplicitWebSearchRequest } from '../config'
import { retrieveChunks } from './retrieval'
import { fetchKeyDocuments } from './key-documents'
import { fetchCaseStructuredContext, getFilteredContextChunk, type CaseMetadataFromContext } from './case-context'
import type {
  AIMode,
  AIResponse,
  AIResponseStream,
  AIContextChunk,
  AIMessage,
} from '../types'

// ─────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────

const ENHANCED_TOP_K = 15

// Model persistence mapping
const MODE_MODEL_MAP: Record<AIMode, { model: string; provider: 'google' | 'anthropic' }> = {
  fast_chat: { model: MODEL_IDS.GEMINI_FLASH, provider: 'google' },
  full_analysis: { model: MODEL_IDS.CLAUDE_SONNET, provider: 'anthropic' },
  deep_thinking: { model: MODEL_IDS.CLAUDE_OPUS, provider: 'anthropic' },
}

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface EnhancedAnalysisOptions {
  caseId: string
  conversationId: string
  userId: string
  query: string
  mode: AIMode
  conversationHistory?: AIMessage[]
  enableWebSearch?: boolean
}

export interface EnhancedAnalysisResult {
  response: AIResponse
  retrieval: {
    ragChunks: number
    keyDocuments: number
    totalContext: number
    retrievalDurationMs: number
  }
}

type CaseMetadata = CaseMetadataFromContext

// ─────────────────────────────────────────────────────────────
// Persistence
// ─────────────────────────────────────────────────────────────

async function persistUserMessage(
  conversationId: string,
  userId: string,
  content: string,
): Promise<void> {
  const db = createAdminClient()
  await db.from('chat_messages').insert({
    conversation_id: conversationId,
    user_id: userId,
    role: 'user',
    content,
  })
}

async function persistAssistantMessage(
  conversationId: string,
  userId: string,
  response: AIResponse,
): Promise<void> {
  const db = createAdminClient()
  await db.from('chat_messages').insert({
    conversation_id: conversationId,
    user_id: userId,
    role: 'assistant',
    content: response.text,
    sources_cited: (response.citations.length > 0 ? response.citations : []) as unknown as Json,
    web_sources_cited: (response.webSources.length > 0 ? response.webSources : []) as unknown as Json,
    thinking_content: response.thinkingContent ?? null,
    tokens_input: response.usage.inputTokens,
    tokens_output: response.usage.outputTokens,
    cache_read_tokens: response.usage.cacheReadTokens ?? 0,
    cache_write_tokens: response.usage.cacheWriteTokens ?? 0,
    model_used: response.model,
    provider: response.provider,
    latency_ms: response.latencyMs,
  })
}

async function updateConversationTimestamp(conversationId: string): Promise<void> {
  const db = createAdminClient()
  await db
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId)
}

// ─────────────────────────────────────────────────────────────
// Context merging: key docs first, then RAG chunks (deduped)
// ─────────────────────────────────────────────────────────────

function mergeContext(
  keyDocs: AIContextChunk[],
  ragChunks: AIContextChunk[],
  inventoryChunk: AIContextChunk | null,
): AIContextChunk[] {
  const keyDocIds = new Set(keyDocs.map(d => d.metadata.documentId))

  const uniqueRagChunks = ragChunks.filter(chunk => {
    if (chunk.chunkId.startsWith('keydoc-')) return false
    if (keyDocIds.has(chunk.metadata.documentId)) return false
    return true
  })

  const parts: AIContextChunk[] = []
  if (inventoryChunk) parts.push(inventoryChunk)
  parts.push(...keyDocs, ...uniqueRagChunks)
  return parts
}

// ─────────────────────────────────────────────────────────────
// Shared retrieval logic
// ─────────────────────────────────────────────────────────────

async function retrieveFullContext(options: EnhancedAnalysisOptions) {
  const structuredResult = await fetchCaseStructuredContext(options.caseId)
  const caseMeta: CaseMetadata | null = structuredResult?.caseMeta ?? null

  const webSearch = options.enableWebSearch || shouldEnableWebSearch(options.query)
  const explicitWeb = isExplicitWebSearchRequest(options.query)
  const deadlineMode = isDeadlineAnalysisQuery(options.query)
  const syncUpdatesMode = !deadlineMode && isSyncUpdatesQuery(options.query)

  // Detect sync changes BEFORE key doc selection so we can prioritize changed docs
  let syncChanges: import('@/lib/pjud/types').SyncChange[] | undefined
  let specializedPrompt: string | undefined
  if (deadlineMode) {
    specializedPrompt = getDeadlineAnalysisPrompt()
  } else if (syncUpdatesMode) {
    const changes = await fetchLastSyncChanges(options.caseId)
    if (changes && changes.length > 0) {
      syncChanges = changes
      specializedPrompt = getSyncUpdatesPrompt(changes)
    }
  }

  const [retrieval, keyDocsResult] = await Promise.all([
    retrieveChunks({
      caseId: options.caseId,
      query: options.query,
      topK: ENHANCED_TOP_K,
    }),
    fetchKeyDocuments(options.caseId, caseMeta?.procedimiento ?? null, options.query, syncChanges, deadlineMode),
  ])

  const inventoryChunk: AIContextChunk = {
    chunkId: 'doc-inventory',
    text: keyDocsResult.inventory,
    metadata: { documentType: 'inventory', sectionType: 'doc_inventory' },
  }

  const merged = mergeContext(keyDocsResult.documents, retrieval.chunks, inventoryChunk)

  const fullContext = deadlineMode || syncUpdatesMode
  const structuredChunk = structuredResult
    ? (fullContext ? structuredResult.chunk : getFilteredContextChunk(structuredResult, options.query))
    : null
  const context = structuredChunk ? [structuredChunk, ...merged] : merged

  const systemPrompt = buildSystemPrompt({
    procedimiento: caseMeta?.procedimiento,
    mode: options.mode,
    rol: caseMeta?.rol,
    tribunal: caseMeta?.tribunal,
    isExplicitWebSearch: webSearch && explicitWeb,
    specializedPrompt,
  })

  return { context, systemPrompt, webSearch, explicitWeb, retrieval, keyDocsResult }
}

// ─────────────────────────────────────────────────────────────
// getEnhancedAnalysis — Non-streaming
// ─────────────────────────────────────────────────────────────

export async function getEnhancedAnalysis(
  options: EnhancedAnalysisOptions,
): Promise<EnhancedAnalysisResult> {
  const retrievalStart = Date.now()
  const { context, systemPrompt, webSearch, explicitWeb, retrieval, keyDocsResult } =
    await retrieveFullContext(options)
  const retrievalDurationMs = Date.now() - retrievalStart

  await persistUserMessage(options.conversationId, options.userId, options.query)

  const response = await getAIResponse({
    mode: options.mode,
    query: options.query,
    context,
    systemPrompt,
    caseId: options.caseId,
    conversationHistory: options.conversationHistory,
    enableWebSearch: webSearch,
    isExplicitWebSearch: webSearch && explicitWeb,
  })

  await Promise.all([
    persistAssistantMessage(options.conversationId, options.userId, response),
    updateConversationTimestamp(options.conversationId),
  ])

  return {
    response,
    retrieval: {
      ragChunks: retrieval.stats.finalCount,
      keyDocuments: keyDocsResult.count,
      totalContext: context.length,
      retrievalDurationMs,
    },
  }
}

// ─────────────────────────────────────────────────────────────
// getEnhancedAnalysisStream — Streaming
// ─────────────────────────────────────────────────────────────

export async function* getEnhancedAnalysisStream(
  options: EnhancedAnalysisOptions,
): AIResponseStream {
  const { context, systemPrompt, webSearch, explicitWeb } =
    await retrieveFullContext(options)

  await persistUserMessage(options.conversationId, options.userId, options.query)

  const stream = getAIResponseStream({
    mode: options.mode,
    query: options.query,
    context,
    systemPrompt,
    caseId: options.caseId,
    conversationHistory: options.conversationHistory,
    enableWebSearch: webSearch,
    isExplicitWebSearch: webSearch && explicitWeb,
  })

  let fullText = ''
  const allCitations: AIResponse['citations'] = []
  const allWebSources: AIResponse['webSources'] = []
  let thinkingContent: string | undefined
  let finalUsage = { inputTokens: 0, outputTokens: 0 }
  const startTime = Date.now()

  for await (const event of stream) {
    yield event

    switch (event.type) {
      case 'text_delta':
        fullText += event.delta ?? ''
        break
      case 'thinking_delta':
        thinkingContent = (thinkingContent ?? '') + (event.delta ?? '')
        break
      case 'citation':
        if (event.citation) allCitations.push(event.citation)
        break
      case 'web_source':
        if (event.webSource) allWebSources.push(event.webSource)
        break
      case 'done':
        if (event.usage) finalUsage = event.usage
        break
    }
  }

  const modeConfig = MODE_MODEL_MAP[options.mode]

  const responseForPersistence: AIResponse = {
    text: fullText,
    citations: allCitations,
    webSources: allWebSources,
    thinkingContent,
    usage: finalUsage,
    model: modeConfig.model,
    provider: modeConfig.provider,
    latencyMs: Date.now() - startTime,
  }

  await Promise.all([
    persistAssistantMessage(options.conversationId, options.userId, responseForPersistence),
    updateConversationTimestamp(options.conversationId),
  ])
}
