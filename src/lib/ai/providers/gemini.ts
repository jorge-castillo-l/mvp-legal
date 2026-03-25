/**
 * ============================================================
 * Gemini Provider — Tarea 3.01 (migrado a @google/genai SDK)
 * ============================================================
 * Implementa AIProviderInterface para Google Gemini (Capa 1).
 *
 * Features:
 *   - generateContent / generateContentStream
 *   - Google Search Grounding (googleSearch tool)
 *   - groundingMetadata → AIWebCitation normalization
 *   - Context caching via ai.caches (Tarea 3.05)
 *
 * Modelo: gemini-3-flash-preview ($0.50/$3.00 /MTok)
 * ============================================================
 */

import { GoogleGenAI, type GenerateContentResponse } from '@google/genai'
import { MODEL_CONFIGS, getTimeout } from '../config'
import { getOrCreateGeminiCache } from '../cache'
import {
  AIProviderError,
  AIRateLimitError,
  AITimeoutError,
  type AIProviderInterface,
  type AIRequestOptions,
  type AIResponse,
  type AIResponseStream,
  type AIExpedienteCitation,
  type AIWebCitation,
  type AIUsage,
  type AIContextChunk,
} from '../types'

// ─────────────────────────────────────────────────────────────
// Client (lazy init)
// ─────────────────────────────────────────────────────────────

let _client: GoogleGenAI | null = null

function getClient(): GoogleGenAI {
  if (!_client) {
    const apiKey = process.env.GOOGLE_API_KEY
    if (!apiKey) {
      throw new AIProviderError(
        'GOOGLE_API_KEY no configurada en variables de entorno',
        'google',
      )
    }
    _client = new GoogleGenAI({ apiKey })
  }
  return _client
}

// ─────────────────────────────────────────────────────────────
// Message formatting
// ─────────────────────────────────────────────────────────────

const DOC_TYPE_LABELS: Record<string, string> = {
  folio_principal: 'Documento principal',
  folio_certificado: 'Certificado de envío',
  folio_anexo: 'Anexo de solicitud',
  sentencia: 'Sentencia',
  resolucion: 'Resolución',
  escrito: 'Escrito',
  actuacion: 'Actuación',
  demanda: 'Demanda',
  contestacion: 'Contestación',
  mandamiento: 'Mandamiento',
  auto_prueba: 'Auto de prueba',
  acta_embargo: 'Acta de embargo',
  acta_audiencia: 'Acta de audiencia',
  receptor: 'Diligencia de receptor',
}

const SECTION_LABELS: Record<string, string> = {
  vistos: 'Vistos',
  considerando: 'Considerando',
  considerando_n: 'Considerando',
  resolutivo: 'Resolutivo',
  cierre_sentencia: 'Cierre',
  individualizacion: 'Individualización',
  en_lo_principal: 'Petición principal',
  hechos: 'Hechos',
  derecho: 'Fundamentos de derecho',
  petitorio: 'Petitorio',
  otrosi: 'Otrosí',
  receptor_certificacion: 'Certificación del receptor',
  receptor_diligencia: 'Diligencia del receptor',
  resolucion_proveyendo: 'Proveído',
  resolucion_dispositivo: 'Parte dispositiva',
  general: '',
}

function humanizeLabel(value: string, map: Record<string, string>): string {
  if (map[value]) return map[value]
  return value.replace(/_/g, ' ')
}

function buildContextBlock(chunks: AIContextChunk[]): string {
  if (chunks.length === 0) return ''

  const lines = chunks.map((chunk, i) => {
    const m = chunk.metadata
    const docType = m.documentType ? humanizeLabel(m.documentType, DOC_TYPE_LABELS) : null
    const section = m.sectionType && m.sectionType !== 'general'
      ? humanizeLabel(m.sectionType, SECTION_LABELS)
      : null

    const header = [
      docType && `Tipo: ${docType}`,
      section && `Sección: ${section}`,
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

interface ContentPart {
  text: string
}

interface ContentEntry {
  role: 'user' | 'model'
  parts: ContentPart[]
}

function buildContents(options: AIRequestOptions): ContentEntry[] {
  const contents: ContentEntry[] = []

  if (options.conversationHistory?.length) {
    for (const msg of options.conversationHistory) {
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      })
    }
  }

  const userParts: ContentPart[] = []

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

interface GroundingMetadata {
  groundingChunks?: GroundingChunk[]
  webSearchQueries?: string[]
}

function extractWebCitations(response: GenerateContentResponse): AIWebCitation[] {
  const candidate = response.candidates?.[0]
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

function extractUsage(response: GenerateContentResponse): AIUsage {
  const meta = response.usageMetadata
  return {
    inputTokens: meta?.promptTokenCount ?? 0,
    outputTokens: meta?.candidatesTokenCount ?? 0,
  }
}

// ─────────────────────────────────────────────────────────────
// Provider implementation
// ─────────────────────────────────────────────────────────────

export class GeminiProvider implements AIProviderInterface {
  readonly provider = 'google' as const

  async generate(options: AIRequestOptions): Promise<AIResponse> {
    const startTime = Date.now()
    const config = MODEL_CONFIGS.fast_chat
    const useWebSearch = options.enableWebSearch === true
    const ai = getClient()
    const contents = buildContents(options)
    const timeout = getTimeout(options.mode)

    const cachedContentName = options.systemPrompt
      ? await getOrCreateGeminiCache(config.modelId, options.systemPrompt)
      : null

    const requestConfig: Record<string, unknown> = {
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
    }

    if (options.systemPrompt && !cachedContentName) {
      requestConfig.systemInstruction = options.systemPrompt
    }

    if (cachedContentName) {
      requestConfig.cachedContent = cachedContentName
    }

    if (useWebSearch) {
      requestConfig.tools = [{ googleSearch: {} }]
    }

    let response: GenerateContentResponse
    try {
      response = await Promise.race([
        ai.models.generateContent({
          model: config.modelId,
          contents,
          config: requestConfig,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new AITimeoutError('google', timeout)), timeout),
        ),
      ])
    } catch (error) {
      throw classifyGeminiError(error)
    }

    const text = response.text ?? ''
    const usage = extractUsage(response)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta = response.usageMetadata as any
    if (meta?.cachedContentTokenCount) {
      usage.cacheReadTokens = meta.cachedContentTokenCount
    }

    return {
      text,
      citations: extractExpedienteCitations(text, options.context),
      webSources: extractWebCitations(response),
      usage,
      model: config.modelId,
      provider: 'google',
      latencyMs: Date.now() - startTime,
    }
  }

  async *stream(options: AIRequestOptions): AIResponseStream {
    const config = MODEL_CONFIGS.fast_chat
    const useWebSearch = options.enableWebSearch === true
    const ai = getClient()
    const contents = buildContents(options)

    const cachedContentName = options.systemPrompt
      ? await getOrCreateGeminiCache(config.modelId, options.systemPrompt)
      : null

    const requestConfig: Record<string, unknown> = {
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
    }

    if (options.systemPrompt && !cachedContentName) {
      requestConfig.systemInstruction = options.systemPrompt
    }

    if (cachedContentName) {
      requestConfig.cachedContent = cachedContentName
    }

    if (useWebSearch) {
      requestConfig.tools = [{ googleSearch: {} }]
    }

    let streamResult
    try {
      streamResult = await ai.models.generateContentStream({
        model: config.modelId,
        contents,
        config: requestConfig,
      })
    } catch (error) {
      yield { type: 'error', error: classifyGeminiError(error).message }
      return
    }

    let fullText = ''
    let lastUsage: AIUsage = { inputTokens: 0, outputTokens: 0 }
    let lastResponse: GenerateContentResponse | null = null

    try {
      for await (const chunk of streamResult) {
        const delta = chunk.text ?? ''
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

        lastResponse = chunk
      }

      if (lastResponse) {
        const webSources = extractWebCitations(lastResponse)
        for (const ws of webSources) {
          yield { type: 'web_source', webSource: ws }
        }
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
