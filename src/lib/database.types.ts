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

/**
 * Plan Limits Constants
 * 
 * ACTUALIZACIÓN Feb 2026 — Rediseño "Prueba Profesional" + Fair Use:
 * 
 * FREE ("Prueba Profesional" - 7 días):
 *   - 1 causa, 20 chats (lifetime), 3 deep thinking (lifetime)
 *   - 7 días de retención, luego The Reaper borra datos
 *   - Ghost card: se conserva metadata de causa (ROL, tribunal, carátula)
 *   - Device fingerprint impide re-crear cuenta free
 * 
 * PRO ($50.00/mes):
 *   - 500 causas, chat con Fair Use (soft cap 3,000/mes)
 *   - 100 deep thinking por mes, editor ilimitado
 *   - Fair Use: al superar 3,000 chats/mes se aplica throttle
 *     de 30s entre queries (no se bloquea, se ralentiza)
 *   - Retención permanente de datos
 */
export const PLAN_LIMITS = {
  free: {
    cases: 1,
    chats: 20,
    deep_thinking: 3,
    retention_days: 7,
    price_usd: 0,
  },
  pro: {
    cases: 500,
    chats: Infinity,
    deep_thinking: 100,  // por mes
    retention_days: Infinity,
    price_usd: 50,
    fair_use: {
      chat_soft_cap_monthly: 3_000,
      throttle_ms: 30_000,  // 30 segundos entre queries al superar soft cap
    },
  },
} as const

export type PlanType = 'free' | 'pro'
export type ActionType = 'chat' | 'deep_thinking' | 'case'
