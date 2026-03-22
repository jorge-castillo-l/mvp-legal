/**
 * ============================================================
 * Multi-Provider AI Router — Tarea 3.01
 * ============================================================
 * Punto de entrada unificado. El resto del código (RAG 3.02,
 * Chat UI 3.08, Citation System 3.09) llama a getAIResponse()
 * o getAIResponseStream() sin saber qué SDK se usa.
 *
 * Routing:
 *   fast_chat      → Gemini 3 Flash  (Google)
 *   full_analysis  → Claude Sonnet   (Anthropic)
 *   deep_thinking  → Claude Opus     (Anthropic)
 *
 * Incluye retry con exponential backoff para errores
 * retryable (rate limit, server errors).
 * ============================================================
 */

import { GeminiProvider } from './providers/gemini'
import { AnthropicProvider } from './providers/anthropic'
import { MODEL_CONFIGS, RETRY_CONFIG, getModelConfig } from './config'
import {
  AIProviderError,
  AIRateLimitError,
  type AIProviderInterface,
  type AIMode,
  type AIRequestOptions,
  type AIResponse,
  type AIResponseStream,
  type AIStreamEvent,
  type ModelConfig,
} from './types'

// ─────────────────────────────────────────────────────────────
// Provider singletons
// ─────────────────────────────────────────────────────────────

let _gemini: GeminiProvider | null = null
let _anthropic: AnthropicProvider | null = null

function getGemini(): GeminiProvider {
  if (!_gemini) _gemini = new GeminiProvider()
  return _gemini
}

function getAnthropic(): AnthropicProvider {
  if (!_anthropic) _anthropic = new AnthropicProvider()
  return _anthropic
}

// ─────────────────────────────────────────────────────────────
// Provider resolution
// ─────────────────────────────────────────────────────────────

export function getProvider(mode: AIMode): AIProviderInterface {
  const config = MODEL_CONFIGS[mode]
  switch (config.provider) {
    case 'google':
      return getGemini()
    case 'anthropic':
      return getAnthropic()
    default:
      throw new AIProviderError(
        `Provider desconocido para modo ${mode}`,
        'google',
      )
  }
}

// ─────────────────────────────────────────────────────────────
// Main API — Non-streaming (with retry)
// ─────────────────────────────────────────────────────────────

export async function getAIResponse(
  options: AIRequestOptions,
): Promise<AIResponse> {
  const provider = getProvider(options.mode)
  return executeWithRetry(() => provider.generate(options))
}

// ─────────────────────────────────────────────────────────────
// Main API — Streaming
//
// Streaming no tiene retry automático: si falla mid-stream
// se emite un evento 'error' y el consumidor decide.
// ─────────────────────────────────────────────────────────────

export function getAIResponseStream(
  options: AIRequestOptions,
): AIResponseStream {
  const provider = getProvider(options.mode)
  return provider.stream(options)
}

// ─────────────────────────────────────────────────────────────
// SSE helper — convierte AIResponseStream a un ReadableStream
// de Server-Sent Events, listo para retornar desde API Routes.
// ─────────────────────────────────────────────────────────────

export function aiStreamToSSE(stream: AIResponseStream): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          const data = JSON.stringify(event)
          controller.enqueue(encoder.encode(`data: ${data}\n\n`))
        }
      } catch (error) {
        const errorEvent: AIStreamEvent = {
          type: 'error',
          error: error instanceof Error ? error.message : String(error),
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`))
      } finally {
        controller.close()
      }
    },
  })
}

// ─────────────────────────────────────────────────────────────
// Retry logic
// ─────────────────────────────────────────────────────────────

async function executeWithRetry<T>(
  fn: () => Promise<T>,
  attempt = 0,
): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (!(error instanceof AIProviderError) || !error.isRetryable) {
      throw error
    }

    if (attempt >= RETRY_CONFIG.maxRetries) {
      throw error
    }

    let delay = RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt)

    if (error instanceof AIRateLimitError && error.retryAfterMs) {
      delay = Math.max(delay, error.retryAfterMs)
    }

    delay = Math.min(delay, RETRY_CONFIG.maxDelayMs)

    console.warn(
      `[ai-router] Retry ${attempt + 1}/${RETRY_CONFIG.maxRetries} en ${delay}ms — ${error.message}`,
    )

    await new Promise(resolve => setTimeout(resolve, delay))
    return executeWithRetry(fn, attempt + 1)
  }
}

// ─────────────────────────────────────────────────────────────
// Cost estimation
// ─────────────────────────────────────────────────────────────

export function estimateCost(
  mode: AIMode,
  inputTokens: number,
  outputTokens: number,
): number {
  const config = getModelConfig(mode)
  return (
    (inputTokens / 1_000_000) * config.costPerMInputTokens +
    (outputTokens / 1_000_000) * config.costPerMOutputTokens
  )
}

export function getModelInfo(mode: AIMode): ModelConfig {
  return getModelConfig(mode)
}
