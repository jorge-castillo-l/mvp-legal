/**
 * ============================================================
 * Unified AI Types — Tarea 3.01
 * ============================================================
 * Tipos compartidos por todos los providers y consumidos por
 * el router, el RAG pipeline (3.02), el chat UI (3.08) y el
 * sistema de citas (3.09).
 *
 * Principio: el código consumidor nunca sabe si habla con
 * Gemini o Claude — todo pasa por estas interfaces.
 * ============================================================
 */

// ─────────────────────────────────────────────────────────────
// AI Modes (mapean 1:1 con las capas del producto)
// ─────────────────────────────────────────────────────────────

export type AIMode = 'fast_chat' | 'full_analysis' | 'deep_thinking'

export type AIProvider = 'google' | 'anthropic'

// ─────────────────────────────────────────────────────────────
// Request
// ─────────────────────────────────────────────────────────────

export interface AIRequestOptions {
  mode: AIMode
  query: string

  /** Chunks RAG ya recuperados, listos para inyectar como contexto */
  context?: AIContextChunk[]

  /** System prompt completo (construido por 3.04 según procedimiento) */
  systemPrompt?: string

  /** ID de causa — requerido para RAG */
  caseId?: string

  /** Historial de conversación para multi-turn */
  conversationHistory?: AIMessage[]

  /**
   * Forzar búsqueda web (Google Search Grounding / Claude Web Search).
   * Si no se pasa, el router decide basándose en heurísticas de la query.
   */
  enableWebSearch?: boolean

  /** Señal de abort para cancelación por el usuario */
  signal?: AbortSignal
}

export interface AIContextChunk {
  chunkId: string
  text: string
  metadata: {
    documentId?: string
    documentType?: string
    sectionType?: string
    folioNumero?: number
    cuaderno?: string
    fechaTramite?: string
    descTramite?: string
    foja?: number
    pageNumber?: number
    procedimiento?: string
    libroTipo?: string
    rol?: string
    tribunal?: string
  }
}

export interface AIMessage {
  role: 'user' | 'assistant'
  content: string
}

// ─────────────────────────────────────────────────────────────
// Response (unificada — ambos providers normalizan a esto)
// ─────────────────────────────────────────────────────────────

export interface AIResponse {
  text: string

  /** Citas a documentos del expediente (del RAG) */
  citations: AIExpedienteCitation[]

  /** Citas a jurisprudencia encontrada via web search */
  webSources: AIWebCitation[]

  /** Contenido de Extended Thinking (solo Capa 3 / Claude Opus) */
  thinkingContent?: string

  usage: AIUsage

  /** Modelo exacto usado (e.g. 'gemini-3-flash-preview') */
  model: string
  provider: AIProvider
  latencyMs: number
}

/** Cita a documento del expediente sincronizado */
export interface AIExpedienteCitation {
  /** Texto citado (extracto breve del chunk) */
  citedText: string
  documentId: string
  documentType?: string
  sectionType?: string
  folioNumero?: number
  cuaderno?: string
  fechaTramite?: string
  foja?: number
  pageNumber?: number
}

/** Cita a jurisprudencia o fuente web */
export interface AIWebCitation {
  title: string
  url: string
  snippet?: string
}

export interface AIUsage {
  inputTokens: number
  outputTokens: number
  /** Tokens de pensamiento (Extended Thinking — Claude Opus) */
  thinkingTokens?: number
  /** Tokens leídos desde cache (Gemini context caching / Claude prompt caching) */
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

// ─────────────────────────────────────────────────────────────
// Streaming
// ─────────────────────────────────────────────────────────────

export type AIStreamEventType =
  | 'text_delta'
  | 'thinking_delta'
  | 'citation'
  | 'web_source'
  | 'usage'
  | 'error'
  | 'done'

export interface AIStreamEvent {
  type: AIStreamEventType

  /** Fragmento de texto (para text_delta / thinking_delta) */
  delta?: string

  /** Cita al expediente (emitida cuando el provider la detecta) */
  citation?: AIExpedienteCitation

  /** Fuente web (emitida cuando el provider la detecta) */
  webSource?: AIWebCitation

  /** Tokens acumulados (emitido con 'done') */
  usage?: AIUsage

  /** Mensaje de error (emitido con 'error') */
  error?: string
}

/**
 * Stream de respuesta AI. Compatible con for-await-of y
 * transformable a SSE en API Routes.
 */
export type AIResponseStream = AsyncIterable<AIStreamEvent>

// ─────────────────────────────────────────────────────────────
// Provider interface (implementada por gemini.ts y anthropic.ts)
// ─────────────────────────────────────────────────────────────

export interface AIProviderInterface {
  readonly provider: AIProvider

  generate(options: AIRequestOptions): Promise<AIResponse>

  stream(options: AIRequestOptions): AIResponseStream
}

// ─────────────────────────────────────────────────────────────
// Model Configuration
// ─────────────────────────────────────────────────────────────

export interface ModelConfig {
  provider: AIProvider
  modelId: string
  displayName: string
  maxInputTokens: number
  maxOutputTokens: number
  temperature: number
  costPerMInputTokens: number
  costPerMOutputTokens: number
  features: {
    webSearch: boolean
    citations: boolean
    extendedThinking: boolean
    contextCaching: boolean
  }
}

// ─────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────

export class AIProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: AIProvider,
    public readonly statusCode?: number,
    public readonly isRetryable: boolean = false,
  ) {
    super(message)
    this.name = 'AIProviderError'
  }
}

export class AIRateLimitError extends AIProviderError {
  constructor(
    provider: AIProvider,
    public readonly retryAfterMs?: number,
  ) {
    super(
      `Rate limit alcanzado en ${provider}${retryAfterMs ? ` — reintentar en ${retryAfterMs}ms` : ''}`,
      provider,
      429,
      true,
    )
    this.name = 'AIRateLimitError'
  }
}

export class AITimeoutError extends AIProviderError {
  constructor(provider: AIProvider, timeoutMs: number) {
    super(
      `Timeout de ${timeoutMs}ms alcanzado en ${provider}`,
      provider,
      408,
      true,
    )
    this.name = 'AITimeoutError'
  }
}
