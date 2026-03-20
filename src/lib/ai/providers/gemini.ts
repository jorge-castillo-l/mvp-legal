/**
 * ============================================================
 * Gemini Provider — Tarea 3.01
 * ============================================================
 * Implementa AIProviderInterface para Google Gemini (Capa 1).
 *
 * Features:
 *   - generateContent / generateContentStream
 *   - Google Search Grounding (googleSearch tool)
 *   - groundingMetadata → AIWebCitation normalization
 *
 * Modelo: gemini-3-flash-preview ($0.50/$3.00 /MTok)
 * ============================================================
 */

import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai'
import type { Content, Part, GenerateContentResult } from '@google/generative-ai'
import { MODEL_CONFIGS, getTimeout, shouldEnableWebSearch } from '../config'
import { getOrCreateGeminiCache } from '../cache'
import {
  AIProviderError,
  AIRateLimitError,
  AITimeoutError,
  type AIProviderInterface,
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
// Client (lazy init — same pattern as embeddings.ts)
// ─────────────────────────────────────────────────────────────

let _client: GoogleGenerativeAI | null = null

function getClient(): GoogleGenerativeAI {
  if (!_client) {
    const apiKey = process.env.GOOGLE_API_KEY
    if (!apiKey) {
      throw new AIProviderError(
        'GOOGLE_API_KEY no configurada en variables de entorno',
        'google',
      )
    }
    _client = new GoogleGenerativeAI(apiKey)
  }
  return _client
}

// ─────────────────────────────────────────────────────────────
// Message formatting
// ─────────────────────────────────────────────────────────────

function buildContextBlock(chunks: AIContextChunk[]): string {
  if (chunks.length === 0) return ''

  const lines = chunks.map((chunk, i) => {
    const m = chunk.metadata
    const header = [
      m.documentType && `Tipo: ${m.documentType}`,
      m.sectionType && `Sección: ${m.sectionType}`,
      m.folioNumero != null && `Folio: ${m.folioNumero}`,
      m.cuaderno && `Cuaderno: ${m.cuaderno}`,
      m.fechaTramite && `Fecha: ${m.fechaTramite}`,
      m.foja != null && `Foja: ${m.foja}`,
      m.pageNumber != null && `Pág: ${m.pageNumber}`,
    ].filter(Boolean).join(' | ')

    return `[Documento ${i + 1}${header ? ` — ${header}` : ''}]\n${chunk.text}`
  })

  return `CONTEXTO DEL EXPEDIENTE:\n\n${lines.join('\n\n---\n\n')}`
}

function buildContents(
  options: AIRequestOptions,
): Content[] {
  const contents: Content[] = []

  if (options.conversationHistory?.length) {
    for (const msg of options.conversationHistory) {
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      })
    }
  }

  const userParts: Part[] = []

  if (options.context?.length) {
    userParts.push({ text: buildContextBlock(options.context) })
  }

  userParts.push({ text: options.query })

  contents.push({ role: 'user', parts: userParts })

  return contents
}

// ─────────────────────────────────────────────────────────────
// Response parsing
// ─────────────────────────────────────────────────────────────

interface GroundingChunk {
  web?: { uri?: string; title?: string }
}

interface GroundingSupport {
  segment?: { startIndex?: number; endIndex?: number; text?: string }
  groundingChunkIndices?: number[]
}

interface GroundingMetadata {
  groundingChunks?: GroundingChunk[]
  groundingSupports?: GroundingSupport[]
  webSearchQueries?: string[]
}

function extractWebCitations(result: GenerateContentResult): AIWebCitation[] {
  const candidate = result.response.candidates?.[0]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const metadata = (candidate as any)?.groundingMetadata as GroundingMetadata | undefined
  if (!metadata?.groundingChunks?.length) return []

  return metadata.groundingChunks
    .filter(chunk => chunk.web?.uri)
    .map(chunk => ({
      title: chunk.web!.title ?? 'Fuente web',
      url: chunk.web!.uri!,
      snippet: undefined,
    }))
}

function extractExpedienteCitations(
  text: string,
  context: AIContextChunk[] | undefined,
): AIExpedienteCitation[] {
  if (!context?.length) return []

  const citations: AIExpedienteCitation[] = []
  for (const chunk of context) {
    const snippet = chunk.text.slice(0, 80)
    if (text.toLowerCase().includes(snippet.toLowerCase().slice(0, 40))) {
      citations.push({
        citedText: snippet,
        documentId: chunk.metadata.documentId ?? '',
        documentType: chunk.metadata.documentType,
        sectionType: chunk.metadata.sectionType,
        folioNumero: chunk.metadata.folioNumero,
        cuaderno: chunk.metadata.cuaderno,
        fechaTramite: chunk.metadata.fechaTramite,
        foja: chunk.metadata.foja,
        pageNumber: chunk.metadata.pageNumber,
      })
    }
  }
  return citations
}

function extractUsage(result: GenerateContentResult): AIUsage {
  const meta = result.response.usageMetadata
  return {
    inputTokens: meta?.promptTokenCount ?? 0,
    outputTokens: meta?.candidatesTokenCount ?? 0,
  }
}

// ─────────────────────────────────────────────────────────────
// Model resolution with caching (Tarea 3.05)
//
// If a system prompt is provided and meets the minimum token
// threshold, we create an explicit Gemini cache (TTL 30min).
// Subsequent requests with the same prompt reuse the cache.
// Cache read: $0.05/MTok (90% off the $0.50 input rate).
// ─────────────────────────────────────────────────────────────

async function resolveModel(
  options: AIRequestOptions,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: any[] | undefined,
): Promise<GenerativeModel> {
  const config = MODEL_CONFIGS.fast_chat
  const client = getClient()

  if (options.systemPrompt) {
    const cached = await getOrCreateGeminiCache(config.modelId, options.systemPrompt)
    if (cached) {
      return client.getGenerativeModelFromCachedContent(cached, {
        generationConfig: {
          temperature: config.temperature,
          maxOutputTokens: config.maxOutputTokens,
        },
        tools,
      })
    }
  }

  return client.getGenerativeModel({
    model: config.modelId,
    systemInstruction: options.systemPrompt
      ? { parts: [{ text: options.systemPrompt }], role: 'user' }
      : undefined,
    generationConfig: {
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
    },
    tools,
  })
}

// ─────────────────────────────────────────────────────────────
// Provider implementation
// ─────────────────────────────────────────────────────────────

export class GeminiProvider implements AIProviderInterface {
  readonly provider = 'google' as const

  async generate(options: AIRequestOptions): Promise<AIResponse> {
    const startTime = Date.now()
    const config = MODEL_CONFIGS.fast_chat
    const useWebSearch = options.enableWebSearch ?? shouldEnableWebSearch(options.query)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: any[] | undefined = useWebSearch
      ? [{ googleSearch: {} }]
      : undefined

    const model = await resolveModel(options, tools)
    const contents = buildContents(options)
    const timeout = getTimeout(options.mode)

    let result: GenerateContentResult
    try {
      result = await Promise.race([
        model.generateContent({ contents }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new AITimeoutError('google', timeout)), timeout),
        ),
      ])
    } catch (error) {
      throw classifyGeminiError(error)
    }

    const text = result.response.text()
    const usage = extractUsage(result)

    if (result.response.usageMetadata) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const meta = result.response.usageMetadata as any
      if (meta.cachedContentTokenCount) {
        usage.cacheReadTokens = meta.cachedContentTokenCount
      }
    }

    return {
      text,
      citations: extractExpedienteCitations(text, options.context),
      webSources: extractWebCitations(result),
      usage,
      model: config.modelId,
      provider: 'google',
      latencyMs: Date.now() - startTime,
    }
  }

  async *stream(options: AIRequestOptions): AIResponseStream {
    const config = MODEL_CONFIGS.fast_chat
    const useWebSearch = options.enableWebSearch ?? shouldEnableWebSearch(options.query)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: any[] | undefined = useWebSearch
      ? [{ googleSearch: {} }]
      : undefined

    const model = await resolveModel(options, tools)
    const contents = buildContents(options)

    let streamResult
    try {
      streamResult = await model.generateContentStream({ contents })
    } catch (error) {
      yield { type: 'error', error: classifyGeminiError(error).message }
      return
    }

    let fullText = ''
    let lastUsage: AIUsage = { inputTokens: 0, outputTokens: 0 }

    try {
      for await (const chunk of streamResult.stream) {
        const delta = chunk.text()
        if (delta) {
          fullText += delta
          yield { type: 'text_delta', delta }
        }

        if (chunk.usageMetadata) {
          lastUsage = {
            inputTokens: chunk.usageMetadata.promptTokenCount ?? 0,
            outputTokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const meta = chunk.usageMetadata as any
          if (meta.cachedContentTokenCount) {
            lastUsage.cacheReadTokens = meta.cachedContentTokenCount
          }
        }
      }

      const aggregated = await streamResult.response
      const webSources = extractWebCitations({ response: aggregated } as GenerateContentResult)
      for (const ws of webSources) {
        yield { type: 'web_source', webSource: ws }
      }

      const expedienteCitations = extractExpedienteCitations(fullText, options.context)
      for (const c of expedienteCitations) {
        yield { type: 'citation', citation: c }
      }
    } catch (error) {
      yield { type: 'error', error: classifyGeminiError(error).message }
      return
    }

    yield {
      type: 'done',
      usage: lastUsage,
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Error classification
// ─────────────────────────────────────────────────────────────

function classifyGeminiError(error: unknown): AIProviderError {
  if (error instanceof AIProviderError) return error

  const message = error instanceof Error ? error.message : String(error)

  if (message.includes('429') || message.includes('RESOURCE_EXHAUSTED')) {
    return new AIRateLimitError('google')
  }

  if (message.includes('403') || message.includes('PERMISSION_DENIED')) {
    return new AIProviderError(
      'Acceso denegado a la API de Gemini — verifica GOOGLE_API_KEY',
      'google',
      403,
    )
  }

  if (message.includes('404') || message.includes('NOT_FOUND')) {
    return new AIProviderError(
      `Modelo no encontrado — verifica que el modelo esté disponible`,
      'google',
      404,
    )
  }

  return new AIProviderError(message, 'google', undefined, true)
}
