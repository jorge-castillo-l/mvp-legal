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
 * Plan Limits Constants — Tareas 6.04 + 6.01
 *
 * 4 planes con 3 capas de IA (fast_chat / full_analysis / deep_thinking).
 * Margen ~70% por plan para usuario típico (40% de límites).
 * Precios en CLP (Flow.cl) — equivalente USD como referencia.
 *
 * FREE (Prueba Profesional — 7 días):
 *   1 causa | 20 fast_chat | 5 full_analysis | 3 deep_thinking (lifetime)
 *
 * BÁSICO ($16.990 CLP/mes ≈ $20 USD):
 *   10 causas | 200 fast_chat | 15 full_analysis | 5 deep_thinking (mensual)
 *
 * PRO ($49.990 CLP/mes ≈ $60 USD):
 *   30 causas | 600 fast_chat (soft cap) | 60 full_analysis | 15 deep_thinking
 *
 * ULTRA ($89.990 CLP/mes ≈ $99 USD):
 *   100 causas | 1000 fast_chat (soft cap) | 150 full_analysis | 30 deep_thinking
 */
export const PLAN_LIMITS = {
  free: {
    cases: 1,
    fast_chat: 20,
    full_analysis: 5,
    deep_thinking: 3,
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
    price_clp: 16_990,
    price_usd: 20,
  },
  pro: {
    cases: 30,
    fast_chat: 600,
    full_analysis: 60,
    deep_thinking: 15,
    retention_days: Infinity,
    price_clp: 49_990,
    price_usd: 60,
    fair_use: {
      fast_chat_soft_cap_monthly: 600,
      throttle_ms: 30_000,
    },
  },
  ultra: {
    cases: 100,
    fast_chat: 1_000,
    full_analysis: 150,
    deep_thinking: 30,
    retention_days: Infinity,
    price_clp: 89_990,
    price_usd: 99,
    fair_use: {
      fast_chat_soft_cap_monthly: 1_000,
      throttle_ms: 30_000,
    },
  },
} as const

export type PlanType = 'free' | 'basico' | 'pro' | 'ultra'
export type ActionType = 'fast_chat' | 'full_analysis' | 'deep_thinking' | 'case'
