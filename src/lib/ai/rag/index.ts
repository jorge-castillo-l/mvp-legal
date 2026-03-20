/**
 * ============================================================
 * RAG Module — Public API (Tareas 3.02 + 3.06)
 * ============================================================
 * Capa 1 (fast_chat):
 *   import { askCase, askCaseStream } from '@/lib/ai/rag'
 *
 * Capas 2-3 (full_analysis / deep_thinking):
 *   import { getEnhancedAnalysis, getEnhancedAnalysisStream } from '@/lib/ai/rag'
 * ============================================================
 */

// Capa 1 — Fast Chat (Gemini)
export { askCase, askCaseStream } from './pipeline'
export type { AskCaseOptions, AskCaseResult } from './pipeline'

// Capas 2-3 — Enhanced Analysis (Claude Sonnet / Opus)
export { getEnhancedAnalysis, getEnhancedAnalysisStream } from './enhanced-pipeline'
export type { EnhancedAnalysisOptions, EnhancedAnalysisResult } from './enhanced-pipeline'

// Retrieval (shared)
export { retrieveChunks } from './retrieval'
export type { RetrievalOptions, RetrievalResult } from './retrieval'

// Key documents
export { fetchKeyDocuments } from './key-documents'
export type { KeyDocumentsResult } from './key-documents'
