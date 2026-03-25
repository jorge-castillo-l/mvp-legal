/**
 * ============================================================
 * AI Model Configuration — Tarea 3.01
 * ============================================================
 * Configuración centralizada por capa (modo).
 *
 * Capa 1 (fast_chat):     Gemini 3 Flash  — $0.50/$3.00 /MTok
 * Capa 2 (full_analysis): Claude Sonnet   — $3/$15 /MTok
 * Capa 3 (deep_thinking): Claude Opus     — $5/$25 /MTok
 *
 * Cada config define: modelo, tokens, temperatura, features.
 * El router (router.ts) usa esto para instanciar el provider
 * correcto sin que el consumidor sepa qué SDK se usa.
 * ============================================================
 */

import type { AIMode, ModelConfig } from './types'

// ─────────────────────────────────────────────────────────────
// Model IDs (fuente de verdad — cambiar aquí para upgrade)
// ─────────────────────────────────────────────────────────────

export const MODEL_IDS = {
  GEMINI_FLASH: 'gemini-3-flash-preview',
  CLAUDE_SONNET: 'claude-sonnet-4-6',
  CLAUDE_OPUS: 'claude-opus-4-6',
} as const

// ─────────────────────────────────────────────────────────────
// Per-layer configuration
// ─────────────────────────────────────────────────────────────

export const MODEL_CONFIGS: Record<AIMode, ModelConfig> = {
  fast_chat: {
    provider: 'google',
    modelId: MODEL_IDS.GEMINI_FLASH,
    displayName: 'Chat Rápido',
    maxInputTokens: 1_000_000,
    maxOutputTokens: 8_192,
    temperature: 0.3,
    costPerMInputTokens: 0.50,
    costPerMOutputTokens: 3.00,
    features: {
      webSearch: true,
      citations: false,
      extendedThinking: false,
      contextCaching: true,
    },
  },

  full_analysis: {
    provider: 'anthropic',
    modelId: MODEL_IDS.CLAUDE_SONNET,
    displayName: 'Análisis Completo',
    maxInputTokens: 200_000,
    maxOutputTokens: 8_192,
    temperature: 0.4,
    costPerMInputTokens: 3.00,
    costPerMOutputTokens: 15.00,
    features: {
      webSearch: true,
      citations: true,
      extendedThinking: false,
      contextCaching: true,
    },
  },

  deep_thinking: {
    provider: 'anthropic',
    modelId: MODEL_IDS.CLAUDE_OPUS,
    displayName: 'Pensamiento Profundo',
    maxInputTokens: 200_000,
    maxOutputTokens: 16_384,
    temperature: 1,  // Required by Anthropic when extended thinking is enabled
    costPerMInputTokens: 5.00,
    costPerMOutputTokens: 25.00,
    features: {
      webSearch: true,
      citations: true,
      extendedThinking: true,
      contextCaching: true,
    },
  },
} as const

// ─────────────────────────────────────────────────────────────
// Retry & timeout configuration
// ─────────────────────────────────────────────────────────────

export const RETRY_CONFIG = {
  maxRetries: 2,
  baseDelayMs: 1_000,
  maxDelayMs: 10_000,
} as const

export const TIMEOUT_CONFIG: Record<AIMode, number> = {
  fast_chat: 30_000,
  full_analysis: 60_000,
  deep_thinking: 120_000,
} as const

// ─────────────────────────────────────────────────────────────
// Web search heuristics
// ─────────────────────────────────────────────────────────────

/**
 * Keywords que activan Google Search Grounding (Gemini) o
 * Claude Web Search Tool automáticamente.
 */
export const WEB_SEARCH_TRIGGER_KEYWORDS = [
  'jurisprudencia',
  'sentencia de',
  'corte suprema',
  'corte de apelaciones',
  'fallos sobre',
  'criterio jurisprudencial',
  'precedente',
  'doctrina',
  'recurso de casación',
  'recurso de protección',
  'recurso de nulidad',
  'unificación de jurisprudencia',
  'busca en internet',
  'buscar en internet',
  'busca en la web',
  'buscar en la web',
  'googlea',
  'investiga en internet',
  'busca online',
  'buscar online',
] as const

/**
 * Determina si una query debería activar búsqueda web.
 * Se usa cuando enableWebSearch no fue pasado explícitamente.
 */
export function shouldEnableWebSearch(query: string): boolean {
  const lower = query.toLowerCase()
  return WEB_SEARCH_TRIGGER_KEYWORDS.some(kw => lower.includes(kw))
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

export function getModelConfig(mode: AIMode): ModelConfig {
  return MODEL_CONFIGS[mode]
}

export function getTimeout(mode: AIMode): number {
  return TIMEOUT_CONFIG[mode]
}
