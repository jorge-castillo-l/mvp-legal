/**
 * Tipos de base de datos (fuente de verdad: Supabase CLI).
 *
 * Este archivo mantiene compatibilidad de imports en el proyecto y
 * concentra constantes de negocio (PLAN_LIMITS), mientras delega el
 * esquema SQL tipado a `src/types/supabase.ts`.
 */
export type {
  Json,
  Database,
  Tables,
  TablesInsert,
  TablesUpdate,
  Enums,
  CompositeTypes,
} from '@/types/supabase'

import type { Tables, TablesInsert } from '@/types/supabase'

// Alias de conveniencia / compatibilidad
export type Profile = Tables<'profiles'>
export type CaseInsert = TablesInsert<'cases'>
export type DocumentInsert = TablesInsert<'documents'>
export type DocumentHashInsert = TablesInsert<'document_hashes'>
export type ExtractedTextInsert = TablesInsert<'extracted_texts'>
export type DocumentChunkInsert = TablesInsert<'document_chunks'>
export type DocumentEmbeddingInsert = TablesInsert<'document_embeddings'>
export type DocumentEmbeddingRow = Tables<'document_embeddings'>
export type ProcessingQueueInsert = TablesInsert<'processing_queue'>
export type ProcessingQueueRow = Tables<'processing_queue'>
export type OcrUsageInsert = TablesInsert<'ocr_usage'>
export type OcrUsageRow = Tables<'ocr_usage'>

export type {
  ConversationInsert,
  ConversationRow,
  ChatMessageInsert,
  ChatMessageRow,
} from '@/types/database'

/**
 * Plan Limits Constants — Zero Hallucination Architecture
 *
 * 4 planes con 3 capas de IA. Pipeline unificado (todos los modos
 * reciben key docs completos + inventario), lo que incrementa el
 * costo de fast_chat vs arquitectura anterior.
 *
 * Costos IA estimados por plan (margen mínimo 40%):
 *   FREE:   ~$1.50 lifetime (loss leader)
 *   BÁSICO: ~$11/mes → precio $24 → margen 54%
 *   PRO:    ~$42/mes → precio $80 → margen 47%
 *   ULTRA:  ~$95/mes → precio $170 → margen 44%
 *
 * FREE (Prueba Profesional — 7 días):
 *   1 causa | 20 fast_chat | 5 full_analysis | 2 deep_thinking (lifetime)
 *
 * BÁSICO ($19.990 CLP/mes ≈ $24 USD):
 *   10 causas | 200 fast_chat | 15 full_analysis | 5 deep_thinking (mensual)
 *
 * PRO ($69.990 CLP/mes ≈ $80 USD):
 *   30 causas | 500 fast_chat (soft cap) | 50 full_analysis | 12 deep_thinking
 *
 * ULTRA ($149.990 CLP/mes ≈ $170 USD):
 *   100 causas | 800 fast_chat (soft cap) | 100 full_analysis | 25 deep_thinking
 */
export const PLAN_LIMITS = {
  free: {
    cases: 1,
    fast_chat: 20,
    full_analysis: 5,
    deep_thinking: 2,
    retention_days: 7,
    price_clp: 0,
    price_usd: 0,
  },
  basico: {
    cases: 10,
    fast_chat: 200,
    full_analysis: 15,
    deep_thinking: 5,
    retention_days: Infinity,
    price_clp: 19_990,
    price_usd: 24,
  },
  pro: {
    cases: 30,
    fast_chat: 500,
    full_analysis: 50,
    deep_thinking: 12,
    retention_days: Infinity,
    price_clp: 69_990,
    price_usd: 80,
    fair_use: {
      fast_chat_soft_cap_monthly: 500,
      throttle_ms: 30_000,
    },
  },
  ultra: {
    cases: 100,
    fast_chat: 800,
    full_analysis: 100,
    deep_thinking: 25,
    retention_days: Infinity,
    price_clp: 149_990,
    price_usd: 170,
    fair_use: {
      fast_chat_soft_cap_monthly: 800,
      throttle_ms: 30_000,
    },
  },
} as const

export type PlanType = 'free' | 'basico' | 'pro' | 'ultra'
export type ActionType = 'fast_chat' | 'full_analysis' | 'deep_thinking' | 'case'
