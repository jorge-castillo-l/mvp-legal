/**
 * ============================================================
 * Anthropic Provider — Tarea 3.01
 * ============================================================
 * Implementa AIProviderInterface para Claude (Capas 2–3).
 *
 * Features:
 *   - Citations API nativa (document blocks con citations.enabled)
 *   - Web Search Tool (web_search_20260209 con dynamic filtering)
 *   - Extended Thinking (Capa 3 — Claude Opus)
 *   - Streaming via MessageStream
 *
 * Capa 2: claude-sonnet-4-6  ($3/$15 /MTok)
 * Capa 3: claude-opus-4-6    ($5/$25 /MTok)
 * ============================================================
 */

import Anthropic from '@anthropic-ai/sdk'
import { MODEL_CONFIGS, getTimeout, shouldEnableWebSearch } from '../config'
import { logAnthropicCacheUsage } from '../cache'
import {
  AIProviderError,
  AIRateLimitError,
  AITimeoutError,
  type AIProviderInterface,
  type AIMode,
  type AIRequestOptions,
  type AIResponse,
  type AIResponseStream,
  type AIStreamEvent,
  type AIExpedienteCitation,
  type AIWebCitation,
  type AIUsage,
  type AIContextChunk,
} from '../types'

// ─────────────────────────────────────────────────────────────
// Client (lazy init)
// ─────────────────────────────────────────────────────────────

let _client: Anthropic | null = null

function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new AIProviderError(
        'ANTHROPIC_API_KEY no configurada en variables de entorno',
        'anthropic',
      )
    }
    _client = new Anthropic({ apiKey })
  }
  return _client
}

// ─────────────────────────────────────────────────────────────
// Message formatting — Citations API
//
// Each RAG chunk becomes a `document` content block with
// citations enabled. Claude automatically produces grounded
// citations referencing these documents by index.
// ─────────────────────────────────────────────────────────────

type DocumentBlock = {
  type: 'document'
  source: { type: 'text'; media_type: 'text/plain'; data: string }
  title?: string
  context?: string
  citations: { enabled: true }
  cache_control?: { type: 'ephemeral' }
}

type TextBlock = { type: 'text'; text: string }

type ContentBlock = DocumentBlock | TextBlock

function buildDocumentTitle(chunk: AIContextChunk, index: number): string {
  const m = chunk.metadata
  const parts = [
    `Doc ${index + 1}`,
    m.documentType,
    m.sectionType,
    m.folioNumero != null ? `Folio ${m.folioNumero}` : null,
    m.cuaderno ? `Cuaderno: ${m.cuaderno}` : null,
    m.fechaTramite,
    m.foja != null ? `Foja ${m.foja}` : null,
  ].filter(Boolean)
  return parts.join(' | ')
}

function buildDocumentContext(chunk: AIContextChunk): string {
  const m = chunk.metadata
  return JSON.stringify({
    documentId: m.documentId,
    documentType: m.documentType,
    sectionType: m.sectionType,
    folioNumero: m.folioNumero,
    cuaderno: m.cuaderno,
    fechaTramite: m.fechaTramite,
    foja: m.foja,
    pageNumber: m.pageNumber,
    procedimiento: m.procedimiento,
    libroTipo: m.libroTipo,
    rol: m.rol,
    tribunal: m.tribunal,
  })
}

function buildUserContent(options: AIRequestOptions): ContentBlock[] {
  const blocks: ContentBlock[] = []

  if (options.context?.length) {
    for (let i = 0; i < options.context.length; i++) {
      const chunk = options.context[i]
      const docBlock: DocumentBlock = {
        type: 'document',
        source: {
          type: 'text',
          media_type: 'text/plain',
          data: chunk.text,
        },
        title: buildDocumentTitle(chunk, i),
        context: buildDocumentContext(chunk),
        citations: { enabled: true },
      }

      if (i === options.context.length - 1) {
        docBlock.cache_control = { type: 'ephemeral' }
      }

      blocks.push(docBlock)
    }
  }

  blocks.push({ type: 'text', text: options.query })
  return blocks
}

function buildMessages(
  options: AIRequestOptions,
): Anthropic.MessageCreateParamsNonStreaming['messages'] {
  const messages: Anthropic.MessageCreateParamsNonStreaming['messages'] = []

  if (options.conversationHistory?.length) {
    for (const msg of options.conversationHistory) {
      messages.push({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content,
      })
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages.push({ role: 'user', content: buildUserContent(options) as any })
  return messages
}

// ─────────────────────────────────────────────────────────────
// Tools
// ─────────────────────────────────────────────────────────────

function buildTools(
  enableWebSearch: boolean,
): Anthropic.MessageCreateParamsNonStreaming['tools'] | undefined {
  if (!enableWebSearch) return undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return [{ type: 'web_search_20260209', name: 'web_search' } as any]
}

// ─────────────────────────────────────────────────────────────
// System prompt with cache_control (Tarea 3.05)
//
// Claude prompt caching: mark the system prompt block with
// cache_control to cache the entire prefix (system + docs).
// TTL 5min, auto-refreshed on each cache hit.
// Cache read: $0.30/MTok (Sonnet) / $0.50/MTok (Opus) — 90% off.
// ─────────────────────────────────────────────────────────────

function buildSystemParam(
  systemPrompt: string | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  if (!systemPrompt) return undefined

  return [
    {
      type: 'text',
      text: systemPrompt,
      cache_control: { type: 'ephemeral' },
    },
  ]
}

// ─────────────────────────────────────────────────────────────
// Response parsing
// ─────────────────────────────────────────────────────────────

interface ClaudeCitation {
  type: string
  cited_text?: string
  document_index?: number
  document_title?: string
  start_char_index?: number
  end_char_index?: number
  start_page_number?: number
  end_page_number?: number
  url?: string
  title?: string
}

function mapClaudeCitationToExpediente(
  citation: ClaudeCitation,
  context: AIContextChunk[] | undefined,
): AIExpedienteCitation | null {
  if (!context?.length || citation.document_index == null) return null
  const chunk = context[citation.document_index]
  if (!chunk) return null

  return {
    citedText: citation.cited_text ?? '',
    documentId: chunk.metadata.documentId ?? '',
    documentType: chunk.metadata.documentType,
    sectionType: chunk.metadata.sectionType,
    folioNumero: chunk.metadata.folioNumero,
    cuaderno: chunk.metadata.cuaderno,
    fechaTramite: chunk.metadata.fechaTramite,
    foja: chunk.metadata.foja,
    pageNumber: chunk.metadata.pageNumber,
  }
}

function parseResponse(
  message: Anthropic.Message,
  context: AIContextChunk[] | undefined,
): { text: string; citations: AIExpedienteCitation[]; webSources: AIWebCitation[]; thinkingContent?: string } {
  let text = ''
  let thinkingContent: string | undefined
  const citations: AIExpedienteCitation[] = []
  const webSources: AIWebCitation[] = []

  for (const block of message.content) {
    if (block.type === 'thinking') {
      thinkingContent = (thinkingContent ?? '') + block.thinking
      continue
    }

    if (block.type === 'text') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blockCitations = (block as any).citations as ClaudeCitation[] | undefined
      const hasExpedienteCite = blockCitations?.some(c => c.type !== 'web_search_result_location')

      text += block.text

      if (blockCitations?.length) {
        let insertedFootnote = false
        for (const c of blockCitations) {
          if (c.type === 'web_search_result_location') {
            webSources.push({
              title: c.title ?? c.document_title ?? 'Fuente web',
              url: c.url ?? '',
              snippet: c.cited_text,
            })
          } else {
            const mapped = mapClaudeCitationToExpediente(c, context)
            if (mapped) {
              citations.push(mapped)
              if (!insertedFootnote && hasExpedienteCite) {
                text += ` [${citations.length}]`
                insertedFootnote = true
              }
            }
          }
        }
      }
      continue
    }

    // web_search_tool_result blocks contain search results
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyBlock = block as any
    if (anyBlock.type === 'web_search_tool_result') {
      const results = anyBlock.content as Array<{
        type: string; url?: string; title?: string; page_snippet?: string
      }> | undefined
      if (results) {
        for (const r of results) {
          if (r.type === 'web_search_result' && r.url) {
            webSources.push({
              title: r.title ?? 'Fuente web',
              url: r.url,
              snippet: r.page_snippet,
            })
          }
        }
      }
    }
  }

  return { text, citations, webSources, thinkingContent }
}

function extractUsage(message: Anthropic.Message): AIUsage {
  const u = message.usage
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cacheReadTokens: (u as any).cache_read_input_tokens ?? 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cacheWriteTokens: (u as any).cache_creation_input_tokens ?? 0,
  }
}

// ─────────────────────────────────────────────────────────────
// Provider implementation
// ─────────────────────────────────────────────────────────────

export class AnthropicProvider implements AIProviderInterface {
  readonly provider = 'anthropic' as const

  async generate(options: AIRequestOptions): Promise<AIResponse> {
    const startTime = Date.now()
    const config = this.resolveConfig(options.mode)
    const useWebSearch = options.enableWebSearch ?? shouldEnableWebSearch(options.query)
    const timeout = getTimeout(options.mode)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: any = {
      model: config.modelId,
      max_tokens: config.maxOutputTokens,
      temperature: config.temperature,
      system: buildSystemParam(options.systemPrompt),
      messages: buildMessages(options),
      tools: buildTools(useWebSearch),
    }

    if (config.features.extendedThinking) {
      params.thinking = {
        type: 'enabled',
        budget_tokens: Math.min(10_000, config.maxOutputTokens),
      }
      params.temperature = 1
    }

    let message: Anthropic.Message
    try {
      message = await Promise.race([
        getClient().messages.create(params),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new AITimeoutError('anthropic', timeout)), timeout),
        ),
      ])
    } catch (error) {
      throw classifyAnthropicError(error)
    }

    const parsed = parseResponse(message, options.context)
    const usage = extractUsage(message)
    logAnthropicCacheUsage(usage.cacheReadTokens ?? 0, usage.cacheWriteTokens ?? 0)

    return {
      text: parsed.text,
      citations: parsed.citations,
      webSources: parsed.webSources,
      thinkingContent: parsed.thinkingContent,
      usage,
      model: config.modelId,
      provider: 'anthropic',
      latencyMs: Date.now() - startTime,
    }
  }

  async *stream(options: AIRequestOptions): AIResponseStream {
    const startTime = Date.now()
    const config = this.resolveConfig(options.mode)
    const useWebSearch = options.enableWebSearch ?? shouldEnableWebSearch(options.query)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: any = {
      model: config.modelId,
      max_tokens: config.maxOutputTokens,
      temperature: config.temperature,
      system: buildSystemParam(options.systemPrompt),
      messages: buildMessages(options),
      tools: buildTools(useWebSearch),
    }

    if (config.features.extendedThinking) {
      params.thinking = {
        type: 'enabled',
        budget_tokens: Math.min(10_000, config.maxOutputTokens),
      }
      params.temperature = 1
    }

    let messageStream
    try {
      messageStream = getClient().messages.stream(params)
    } catch (error) {
      yield { type: 'error', error: classifyAnthropicError(error).message }
      return
    }

    const webSources: AIWebCitation[] = []
    const expedienteCitations: AIExpedienteCitation[] = []
    let lastUsage: AIUsage = { inputTokens: 0, outputTokens: 0 }

    try {
      for await (const event of messageStream) {
        if (event.type === 'content_block_delta') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const delta = event.delta as any

          if (delta.type === 'text_delta') {
            yield { type: 'text_delta', delta: delta.text }
          }

          if (delta.type === 'thinking_delta') {
            yield { type: 'thinking_delta', delta: delta.thinking }
          }

          if (delta.type === 'citations_delta' && delta.citation) {
            const c = delta.citation as ClaudeCitation
            if (c.type === 'web_search_result_location') {
              const ws: AIWebCitation = {
                title: c.title ?? c.document_title ?? 'Fuente web',
                url: c.url ?? '',
                snippet: c.cited_text,
              }
              webSources.push(ws)
              yield { type: 'web_source', webSource: ws }
            } else {
              const mapped = mapClaudeCitationToExpediente(c, options.context)
              if (mapped) {
                expedienteCitations.push(mapped)
                yield { type: 'text_delta', delta: ` [${expedienteCitations.length}]` }
                yield { type: 'citation', citation: mapped }
              }
            }
          }
        }

        if (event.type === 'message_delta') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const usage = (event as any).usage
          if (usage) {
            lastUsage = {
              inputTokens: usage.input_tokens ?? lastUsage.inputTokens,
              outputTokens: usage.output_tokens ?? lastUsage.outputTokens,
            }
          }
        }
      }

      const finalMessage = await messageStream.finalMessage()
      lastUsage = extractUsage(finalMessage)
      logAnthropicCacheUsage(lastUsage.cacheReadTokens ?? 0, lastUsage.cacheWriteTokens ?? 0)
    } catch (error) {
      yield { type: 'error', error: classifyAnthropicError(error).message }
      return
    }

    yield { type: 'done', usage: lastUsage }
  }

  private resolveConfig(mode: AIMode) {
    if (mode === 'deep_thinking') return MODEL_CONFIGS.deep_thinking
    return MODEL_CONFIGS.full_analysis
  }
}

// ─────────────────────────────────────────────────────────────
// Error classification
// ─────────────────────────────────────────────────────────────

function classifyAnthropicError(error: unknown): AIProviderError {
  if (error instanceof AIProviderError) return error

  if (error instanceof Anthropic.RateLimitError) {
    return new AIRateLimitError('anthropic')
  }

  if (error instanceof Anthropic.AuthenticationError) {
    return new AIProviderError(
      'Autenticación fallida — verifica ANTHROPIC_API_KEY',
      'anthropic',
      401,
    )
  }

  if (error instanceof Anthropic.APIError) {
    return new AIProviderError(
      error.message,
      'anthropic',
      error.status,
      error.status === 529 || error.status === 500,
    )
  }

  const message = error instanceof Error ? error.message : String(error)
  return new AIProviderError(message, 'anthropic', undefined, true)
}
