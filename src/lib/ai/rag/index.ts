/**
 * ============================================================
 * RAG Module — Public API
 * ============================================================
 * Pipeline unificado para todos los modos (fast_chat, full_analysis,
 * deep_thinking). Todos usan el enhanced pipeline con key docs,
 * inventario de documentos y selección query-aware.
 *
 *   import { getEnhancedAnalysis, getEnhancedAnalysisStream } from '@/lib/ai/rag'
 * ============================================================
 */

// Unified pipeline (all modes)
export { getEnhancedAnalysis, getEnhancedAnalysisStream } from './enhanced-pipeline'
export type { EnhancedAnalysisOptions, EnhancedAnalysisResult } from './enhanced-pipeline'

// Retrieval (shared)
export { retrieveChunks } from './retrieval'
export type { RetrievalOptions, RetrievalResult } from './retrieval'

// Key documents
export { fetchKeyDocuments } from './key-documents'
export type { KeyDocumentsResult } from './key-documents'
