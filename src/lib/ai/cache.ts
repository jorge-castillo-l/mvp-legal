/**
 * ============================================================
 * AI Cache Management — Tarea 3.05
 * ============================================================
 * Gestiona caches por proveedor para reducir costos ~90%.
 *
 * GEMINI (Capa 1):
 *   Explicit caching via GoogleAICacheManager. Crea un
 *   CachedContent server-side con system prompt. TTL 30min.
 *   Cache read: $0.05/MTok (90% descuento sobre $0.50).
 *   Cache storage: $1.00/MTok/hr.
 *   Mínimo 1024 tokens para crear cache.
 *
 * CLAUDE (Capas 2-3):
 *   Prompt caching via cache_control breakpoints. TTL 5min
 *   auto-refresh en cada cache hit. No requiere gestión
 *   server-side — se implementa directamente en anthropic.ts
 *   marcando system prompt y documentos con cache_control.
 *   Cache read: $0.30/MTok (Sonnet) / $0.50/MTok (Opus).
 *
 * Estrategia: cachear system prompt como prefijo estable.
 * Los chunks del expediente van después (cacheados por
 * Claude automáticamente, no cacheados en Gemini por ser
 * query-specific).
 * ============================================================
 */

import { GoogleAICacheManager, type CachedContent } from '@google/generative-ai/server'
import type { Content } from '@google/generative-ai'
import { AIProviderError } from './types'

// ─────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────

const GEMINI_CACHE_TTL_SECONDS = 30 * 60  // 30 minutes
const MIN_TOKENS_FOR_CACHE = 1024
const APPROX_CHARS_PER_TOKEN = 4
const CACHE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000  // 5 minutes

// ─────────────────────────────────────────────────────────────
// Gemini cache store (in-memory, per-process)
// ─────────────────────────────────────────────────────────────

interface GeminiCacheEntry {
  cachedContent: CachedContent
  promptHash: string
  expiresAt: number
}

const geminiCacheStore = new Map<string, GeminiCacheEntry>()

let _cacheManager: GoogleAICacheManager | null = null
let _cleanupTimer: ReturnType<typeof setInterval> | null = null

function getCacheManager(): GoogleAICacheManager {
  if (!_cacheManager) {
    const apiKey = process.env.GOOGLE_API_KEY
    if (!apiKey) {
      throw new AIProviderError('GOOGLE_API_KEY no configurada', 'google')
    }
    _cacheManager = new GoogleAICacheManager(apiKey)
  }
  return _cacheManager
}

// ─────────────────────────────────────────────────────────────
// Hash utility (fast, non-cryptographic)
// ─────────────────────────────────────────────────────────────

function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return hash.toString(36)
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN)
}

// ─────────────────────────────────────────────────────────────
// Gemini Cache — Public API
// ─────────────────────────────────────────────────────────────

/**
 * Returns a valid CachedContent for the given system prompt, or
 * null if caching is not possible (prompt too short, API error).
 *
 * Cache key = model + promptHash. If a matching cache exists and
 * hasn't expired, it's reused. Otherwise a new one is created.
 */
export async function getOrCreateGeminiCache(
  modelId: string,
  systemPrompt: string,
): Promise<CachedContent | null> {
  if (!systemPrompt || estimateTokens(systemPrompt) < MIN_TOKENS_FOR_CACHE) {
    return null
  }

  const promptHash = simpleHash(systemPrompt)
  const cacheKey = `${modelId}:${promptHash}`

  const existing = geminiCacheStore.get(cacheKey)
  if (existing && existing.expiresAt > Date.now()) {
    logCacheEvent('gemini', 'hit', cacheKey)
    return existing.cachedContent
  }

  if (existing) {
    geminiCacheStore.delete(cacheKey)
  }

  try {
    const manager = getCacheManager()

    const systemContent: Content = {
      role: 'user',
      parts: [{ text: systemPrompt }],
    }

    const cached = await manager.create({
      model: modelId,
      systemInstruction: systemContent,
      contents: [],
      ttlSeconds: GEMINI_CACHE_TTL_SECONDS,
      displayName: `mvp-legal:${cacheKey.slice(0, 30)}`,
    })

    const entry: GeminiCacheEntry = {
      cachedContent: cached,
      promptHash,
      expiresAt: Date.now() + (GEMINI_CACHE_TTL_SECONDS * 1000),
    }

    geminiCacheStore.set(cacheKey, entry)
    logCacheEvent('gemini', 'create', cacheKey)
    ensureCleanupTimer()

    return cached
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.warn(`[ai-cache] Gemini cache creation failed (fallback to uncached): ${msg}`)
    logCacheEvent('gemini', 'create_failed', cacheKey)
    return null
  }
}

/**
 * Invalidate all Gemini caches. Call when system prompts change
 * (e.g. during prompt engineering iteration).
 */
export async function invalidateAllGeminiCaches(): Promise<void> {
  const manager = getCacheManager()
  for (const [key, entry] of geminiCacheStore) {
    try {
      if (entry.cachedContent.name) {
        await manager.delete(entry.cachedContent.name)
      }
    } catch {
      // Ignore — cache may have already expired server-side
    }
    geminiCacheStore.delete(key)
  }
  logCacheEvent('gemini', 'invalidate_all', `${geminiCacheStore.size} entries`)
}

// ─────────────────────────────────────────────────────────────
// Cache stats & monitoring
// ─────────────────────────────────────────────────────────────

interface CacheEvent {
  provider: 'gemini' | 'anthropic'
  action: string
  key: string
  timestamp: number
}

const cacheEvents: CacheEvent[] = []
const MAX_EVENTS = 500

function logCacheEvent(provider: 'gemini' | 'anthropic', action: string, key: string) {
  if (cacheEvents.length >= MAX_EVENTS) {
    cacheEvents.splice(0, cacheEvents.length - MAX_EVENTS + 50)
  }
  cacheEvents.push({ provider, action, key, timestamp: Date.now() })
  console.log(`[ai-cache] ${provider} ${action}: ${key}`)
}

/**
 * Returns cache statistics for monitoring.
 * Call from a /api/admin/cache-stats route for observability.
 */
export function getCacheStats(): {
  gemini: { activeCaches: number; events: CacheEvent[] }
  anthropic: { events: CacheEvent[] }
} {
  return {
    gemini: {
      activeCaches: geminiCacheStore.size,
      events: cacheEvents.filter(e => e.provider === 'gemini'),
    },
    anthropic: {
      events: cacheEvents.filter(e => e.provider === 'anthropic'),
    },
  }
}

/**
 * Log an Anthropic cache event (called from anthropic.ts
 * after each response to track cache_read vs cache_write tokens).
 */
export function logAnthropicCacheUsage(
  cacheReadTokens: number,
  cacheWriteTokens: number,
) {
  if (cacheReadTokens > 0) {
    logCacheEvent('anthropic', 'cache_read', `${cacheReadTokens} tokens`)
  }
  if (cacheWriteTokens > 0) {
    logCacheEvent('anthropic', 'cache_write', `${cacheWriteTokens} tokens`)
  }
}

// ─────────────────────────────────────────────────────────────
// Periodic cleanup of expired entries
// ─────────────────────────────────────────────────────────────

function cleanupExpired() {
  const now = Date.now()
  for (const [key, entry] of geminiCacheStore) {
    if (entry.expiresAt <= now) {
      geminiCacheStore.delete(key)
    }
  }
}

function ensureCleanupTimer() {
  if (_cleanupTimer) return
  _cleanupTimer = setInterval(cleanupExpired, CACHE_CLEANUP_INTERVAL_MS)
  if (typeof _cleanupTimer === 'object' && 'unref' in _cleanupTimer) {
    _cleanupTimer.unref()
  }
}
