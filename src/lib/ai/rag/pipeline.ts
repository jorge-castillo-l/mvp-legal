/**
 * ============================================================
 * RAG Pipeline — Tarea 3.02
 * ============================================================
 * Pipeline completo de punta a punta:
 *
 *   1. Recuperar metadata de la causa (procedimiento, ROL, tribunal)
 *   2. Retrieval híbrido (vector + full-text + reranking)
 *   3. Construir system prompt según procedimiento
 *   4. Llamar al AI router (Gemini/Claude según modo)
 *   5. Persistir pregunta + respuesta en chat_messages
 *   6. Retornar respuesta con citas
 *
 * Expone dos funciones:
 *   - askCase(): non-streaming (retorna AIResponse completo)
 *   - askCaseStream(): streaming (retorna AIResponseStream)
 *
 * Ambas manejan la persistencia de mensajes automáticamente.
 * ============================================================
 */

import { createAdminClient } from '@/lib/supabase/server'
import type { Json } from '@/lib/database.types'
import { getAIResponse, getAIResponseStream, aiStreamToSSE } from '../router'
import { buildSystemPrompt } from '../prompts'
import { retrieveChunks, type RetrievalOptions } from './retrieval'
import { fetchCaseStructuredContext } from './case-context'
import type {
  AIMode,
  AIResponse,
  AIResponseStream,
  AIStreamEvent,
  AIMessage,
} from '../types'

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface AskCaseOptions {
  caseId: string
  conversationId: string
  userId: string
  query: string
  mode: AIMode
  conversationHistory?: AIMessage[]
  documentType?: string
  sectionType?: string
  enableWebSearch?: boolean
}

export interface AskCaseResult {
  response: AIResponse
  retrieval: {
    vectorResults: number
    textResults: number
    chunksUsed: number
    durationMs: number
  }
}

// ─────────────────────────────────────────────────────────────
// Case metadata fetcher
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
  return {
    procedimiento: data.procedimiento,
    rol: data.rol,
    tribunal: data.tribunal,
  }
}

// ─────────────────────────────────────────────────────────────
// Persist messages to chat_messages
// ─────────────────────────────────────────────────────────────

async function persistUserMessage(
  conversationId: string,
  userId: string,
  content: string,
): Promise<string | null> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('chat_messages')
    .insert({
      conversation_id: conversationId,
      user_id: userId,
      role: 'user',
      content,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[rag-pipeline] Error persisting user message:', error.message)
    return null
  }
  return data.id
}

async function persistAssistantMessage(
  conversationId: string,
  userId: string,
  response: AIResponse,
): Promise<string | null> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('chat_messages')
    .insert({
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
    .select('id')
    .single()

  if (error) {
    console.error('[rag-pipeline] Error persisting assistant message:', error.message)
    return null
  }
  return data.id
}

async function updateConversationTimestamp(conversationId: string): Promise<void> {
  const db = createAdminClient()
  await db
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId)
}

// ─────────────────────────────────────────────────────────────
// askCase — Non-streaming
// ─────────────────────────────────────────────────────────────

export async function askCase(options: AskCaseOptions): Promise<AskCaseResult> {
  const caseMeta = await getCaseMetadata(options.caseId)

  const systemPrompt = buildSystemPrompt({
    procedimiento: caseMeta?.procedimiento,
    mode: options.mode,
    rol: caseMeta?.rol,
    tribunal: caseMeta?.tribunal,
  })

  const [retrieval, structuredContext] = await Promise.all([
    retrieveChunks({
      caseId: options.caseId,
      query: options.query,
      documentType: options.documentType,
      sectionType: options.sectionType,
    }),
    fetchCaseStructuredContext(options.caseId),
  ])

  const context = structuredContext
    ? [structuredContext, ...retrieval.chunks]
    : retrieval.chunks

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
      vectorResults: retrieval.stats.vectorResults,
      textResults: retrieval.stats.textResults,
      chunksUsed: retrieval.stats.finalCount,
      durationMs: retrieval.stats.durationMs,
    },
  }
}

// ─────────────────────────────────────────────────────────────
// askCaseStream — Streaming
//
// Streams the AI response while collecting it for persistence.
// Returns an AIResponseStream that the caller can pass to
// aiStreamToSSE() for API Route responses.
// ─────────────────────────────────────────────────────────────

export async function* askCaseStream(
  options: AskCaseOptions,
): AIResponseStream {
  const caseMeta = await getCaseMetadata(options.caseId)

  const systemPrompt = buildSystemPrompt({
    procedimiento: caseMeta?.procedimiento,
    mode: options.mode,
    rol: caseMeta?.rol,
    tribunal: caseMeta?.tribunal,
  })

  const [retrieval, structuredContext] = await Promise.all([
    retrieveChunks({
      caseId: options.caseId,
      query: options.query,
      documentType: options.documentType,
      sectionType: options.sectionType,
    }),
    fetchCaseStructuredContext(options.caseId),
  ])

  const context = structuredContext
    ? [structuredContext, ...retrieval.chunks]
    : retrieval.chunks

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
  let model = ''
  let provider: 'google' | 'anthropic' = 'google'
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

  const caseModeConfig = options.mode === 'fast_chat'
    ? { model: 'gemini-3-flash-preview', provider: 'google' as const }
    : options.mode === 'deep_thinking'
      ? { model: 'claude-opus-4-6', provider: 'anthropic' as const }
      : { model: 'claude-sonnet-4-6', provider: 'anthropic' as const }

  model = caseModeConfig.model
  provider = caseModeConfig.provider

  const responseForPersistence: AIResponse = {
    text: fullText,
    citations: allCitations,
    webSources: allWebSources,
    thinkingContent,
    usage: finalUsage,
    model,
    provider,
    latencyMs: Date.now() - startTime,
  }

  await Promise.all([
    persistAssistantMessage(options.conversationId, options.userId, responseForPersistence),
    updateConversationTimestamp(options.conversationId),
  ])
}
