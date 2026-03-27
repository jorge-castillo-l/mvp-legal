/**
 * Rate Limiter in-memory — Tarea 4.04
 *
 * Sliding window por IP. Sin dependencias externas (Redis/Upstash).
 * Suficiente para MVP pre-lanzamiento. Si se necesita distribución
 * multi-instancia, reemplazar internals por @upstash/ratelimit.
 *
 * Efímero: se resetea con cada deploy/restart de Node.js.
 */

import { NextRequest } from 'next/server'

interface WindowEntry {
  timestamps: number[]
}

const store = new Map<string, WindowEntry>()

const CLEANUP_INTERVAL_MS = 60_000
let lastCleanup = Date.now()

function cleanup(windowMs: number) {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return
  lastCleanup = now

  const cutoff = now - windowMs
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff)
    if (entry.timestamps.length === 0) store.delete(key)
  }
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  limit: number
  retryAfterMs?: number
}

/**
 * Verifica rate limit por IP con sliding window.
 *
 * @param request - NextRequest (para extraer IP)
 * @param options - maxRequests y windowMs (default: 20 req / 60s)
 * @param prefix - Namespace para separar endpoints (e.g. 'chat', 'upload')
 */
export function checkRateLimit(
  request: NextRequest,
  options: { maxRequests?: number; windowMs?: number } = {},
  prefix = 'global',
): RateLimitResult {
  const { maxRequests = 20, windowMs = 60_000 } = options

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'

  const key = `${prefix}:${ip}`
  const now = Date.now()
  const cutoff = now - windowMs

  cleanup(windowMs)

  let entry = store.get(key)
  if (!entry) {
    entry = { timestamps: [] }
    store.set(key, entry)
  }

  entry.timestamps = entry.timestamps.filter((t) => t > cutoff)

  if (entry.timestamps.length >= maxRequests) {
    const oldestInWindow = entry.timestamps[0]
    const retryAfterMs = oldestInWindow + windowMs - now

    return {
      allowed: false,
      remaining: 0,
      limit: maxRequests,
      retryAfterMs: Math.max(retryAfterMs, 1000),
    }
  }

  entry.timestamps.push(now)
  return {
    allowed: true,
    remaining: maxRequests - entry.timestamps.length,
    limit: maxRequests,
  }
}

/**
 * Genera headers estándar de rate limit para la respuesta.
 */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
  }
  if (result.retryAfterMs) {
    headers['Retry-After'] = String(Math.ceil(result.retryAfterMs / 1000))
  }
  return headers
}
