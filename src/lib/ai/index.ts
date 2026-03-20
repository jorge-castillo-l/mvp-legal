/**
 * ============================================================
 * AI Module — Public API (Tarea 3.01)
 * ============================================================
 * Barrel export. El resto del código importa desde '@/lib/ai'.
 *
 * Ejemplo de uso:
 *
 *   import { getAIResponse, getAIResponseStream, aiStreamToSSE } from '@/lib/ai'
 *
 *   // Non-streaming
 *   const response = await getAIResponse({
 *     mode: 'fast_chat',
 *     query: '¿Se notificó correctamente al demandado?',
 *     context: ragChunks,
 *     systemPrompt: promptForProcedimiento,
 *   })
 *
 *   // Streaming (API Route → SSE)
 *   const stream = getAIResponseStream({ mode: 'full_analysis', ... })
 *   return new Response(aiStreamToSSE(stream), {
 *     headers: { 'Content-Type': 'text/event-stream' },
 *   })
 * ============================================================
 */

export {
  getAIResponse,
  getAIResponseStream,
  getProvider,
  aiStreamToSSE,
  estimateCost,
  getModelInfo,
} from './router'

export {
  MODEL_IDS,
  MODEL_CONFIGS,
  getModelConfig,
  getTimeout,
  shouldEnableWebSearch,
  WEB_SEARCH_TRIGGER_KEYWORDS,
} from './config'

export type {
  AIMode,
  AIProvider,
  AIRequestOptions,
  AIContextChunk,
  AIMessage,
  AIResponse,
  AIExpedienteCitation,
  AIWebCitation,
  AIUsage,
  AIStreamEvent,
  AIStreamEventType,
  AIResponseStream,
  AIProviderInterface,
  ModelConfig,
} from './types'

export {
  AIProviderError,
  AIRateLimitError,
  AITimeoutError,
} from './types'

export {
  getCacheStats,
  invalidateAllGeminiCaches,
} from './cache'

export { buildSystemPrompt } from './prompts'
export type { Procedimiento, BuildSystemPromptOptions } from './prompts'

export { askCase, askCaseStream, retrieveChunks } from './rag'
export type { AskCaseOptions, AskCaseResult, RetrievalOptions, RetrievalResult } from './rag'

export { getEnhancedAnalysis, getEnhancedAnalysisStream } from './rag'
export type { EnhancedAnalysisOptions, EnhancedAnalysisResult } from './rag'
