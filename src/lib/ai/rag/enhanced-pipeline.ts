/**
 * ============================================================
 * Enhanced Analysis Pipeline — Tarea 3.06
 * ============================================================
 * Pipeline para Capas 2-3 (Claude Sonnet / Claude Opus).
 *
 * Diferencias vs pipeline base (3.02):
 *   - topK ampliado (15 chunks vs 5)
 *   - Documentos clave completos según procedimiento
 *   - Contexto combinado: key docs + RAG chunks (deduplicados)
 *   - Persistencia idéntica (chat_messages)
 *
 * El router (3.01) ya maneja:
 *   - Citations API para Claude (document blocks)
 *   - Web Search Tool (jurisprudencia)
 *   - Extended Thinking (deep_thinking)
 *   - Prompt caching (3.05)
 *
 * Uso:
 *   const result = await getEnhancedAnalysis({
 *     caseId, conversationId, userId,
 *     query: '¿Procede recurso de casación?',
 *     mode: 'full_analysis',
 *   })
 * ============================================================
 */

import { createAdminClient } from '@/lib/supabase/server'
import type { Json } from '@/lib/database.types'
import { getAIResponse, getAIResponseStream } from '../router'
import { buildSystemPrompt } from '../prompts'
import { retrieveChunks } from './retrieval'
import { fetchKeyDocuments } from './key-documents'
import { fetchCaseStructuredContext } from './case-context'
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

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface EnhancedAnalysisOptions {
  caseId: string
  conversationId: string
  userId: string
  query: string
  mode: 'full_analysis' | 'deep_thinking'
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

// ─────────────────────────────────────────────────────────────
// Case metadata
// ─────────────────────────────────────────────────────────────

interface CaseMetadata {
  procedimiento: string | null
  rol: string
  tribunal: string | null
}

async function getCaseMetadata(caseId: string): Promise<CaseMetadata | null> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('cases')
    .select('procedimiento, rol, tribunal')
    .eq('id', caseId)
    .single()

  if (error || !data) return null
  return data as CaseMetadata
}

// ─────────────────────────────────────────────────────────────
// Persistence (reuses same chat_messages table as 3.02)
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
): AIContextChunk[] {
  const keyDocIds = new Set(keyDocs.map(d => d.metadata.documentId))

  const uniqueRagChunks = ragChunks.filter(chunk => {
    if (chunk.chunkId.startsWith('keydoc-')) return false
    if (keyDocIds.has(chunk.metadata.documentId)) return false
    return true
  })

  return [...keyDocs, ...uniqueRagChunks]
}

// ─────────────────────────────────────────────────────────────
// getEnhancedAnalysis — Non-streaming
// ─────────────────────────────────────────────────────────────

export async function getEnhancedAnalysis(
  options: EnhancedAnalysisOptions,
): Promise<EnhancedAnalysisResult> {
  const retrievalStart = Date.now()
  const caseMeta = await getCaseMetadata(options.caseId)

  const [retrieval, keyDocsResult, structuredContext] = await Promise.all([
    retrieveChunks({
      caseId: options.caseId,
      query: options.query,
      topK: ENHANCED_TOP_K,
    }),
    fetchKeyDocuments(options.caseId, caseMeta?.procedimiento ?? null),
    fetchCaseStructuredContext(options.caseId),
  ])

  const merged = mergeContext(keyDocsResult.documents, retrieval.chunks)
  const context = structuredContext ? [structuredContext, ...merged] : merged
  const retrievalDurationMs = Date.now() - retrievalStart

  const systemPrompt = buildSystemPrompt({
    procedimiento: caseMeta?.procedimiento,
    mode: options.mode,
    rol: caseMeta?.rol,
    tribunal: caseMeta?.tribunal,
  })

  await persistUserMessage(options.conversationId, options.userId, options.query)

  const response = await getAIResponse({
    mode: options.mode,
    query: options.query,
    context,
    systemPrompt,
    caseId: options.caseId,
    conversationHistory: options.conversationHistory,
    enableWebSearch: options.enableWebSearch,
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
  const caseMeta = await getCaseMetadata(options.caseId)

  const [retrieval, keyDocsResult, structuredContext] = await Promise.all([
    retrieveChunks({
      caseId: options.caseId,
      query: options.query,
      topK: ENHANCED_TOP_K,
    }),
    fetchKeyDocuments(options.caseId, caseMeta?.procedimiento ?? null),
    fetchCaseStructuredContext(options.caseId),
  ])

  const merged = mergeContext(keyDocsResult.documents, retrieval.chunks)
  const context = structuredContext ? [structuredContext, ...merged] : merged

  const systemPrompt = buildSystemPrompt({
    procedimiento: caseMeta?.procedimiento,
    mode: options.mode,
    rol: caseMeta?.rol,
    tribunal: caseMeta?.tribunal,
  })

  await persistUserMessage(options.conversationId, options.userId, options.query)

  const stream = getAIResponseStream({
    mode: options.mode,
    query: options.query,
    context,
    systemPrompt,
    caseId: options.caseId,
    conversationHistory: options.conversationHistory,
    enableWebSearch: options.enableWebSearch,
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

  const modeConfig = options.mode === 'deep_thinking'
    ? { model: 'claude-opus-4-6', provider: 'anthropic' as const }
    : { model: 'claude-sonnet-4-6', provider: 'anthropic' as const }

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
