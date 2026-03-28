/**
 * ============================================================
 * API Route: /api/chat — Tarea 3.08
 * ============================================================
 * SSE endpoint para el chat. Recibe query + caseId + mode,
 * resuelve/crea conversación, y retorna stream SSE.
 *
 * Auth: Supabase session cookie (Next.js app) o Bearer token (extensión).
 * ============================================================
 */

export const maxDuration = 120

import { NextRequest } from 'next/server'
import { GoogleGenAI } from '@google/genai'
import { createClient, createAdminClient, createClientWithToken } from '@/lib/supabase/server'
import { getCorsHeaders, handleCorsOptions } from '@/lib/cors'
import { checkRateLimit, rateLimitHeaders } from '@/lib/rate-limit'
import { checkPlanLimits, incrementPlanCounter, modeToActionType, planLimitErrorBody } from '@/lib/plan-guard'
import { askCaseStream } from '@/lib/ai/rag/pipeline'
import { getEnhancedAnalysisStream } from '@/lib/ai/rag/enhanced-pipeline'
import { aiStreamToResilientSSE } from '@/lib/ai/router'
import { MODEL_IDS } from '@/lib/ai/config'
import type { AIMode } from '@/lib/ai/types'

export async function OPTIONS(request: NextRequest) {
  return handleCorsOptions(request)
}

export async function POST(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request)

  try {
    // ── Rate limit anti-bot (20 req/min por IP) ──
    const rl = checkRateLimit(request, { maxRequests: 20, windowMs: 60_000 }, 'chat')
    if (!rl.allowed) {
      return Response.json(
        { error: 'Demasiadas solicitudes. Intenta en unos segundos.', code: 'RATE_LIMITED' },
        { status: 429, headers: { ...corsHeaders, ...rateLimitHeaders(rl) } },
      )
    }

    // ── Auth ──
    const authHeader = request.headers.get('Authorization')
    let userId: string

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      const client = createClientWithToken(token)
      const { data: { user }, error } = await client.auth.getUser()
      if (error || !user) {
        return Response.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders })
      }
      userId = user.id
    } else {
      const client = await createClient()
      const { data: { user }, error } = await client.auth.getUser()
      if (error || !user) {
        return Response.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders })
      }
      userId = user.id
    }

    const body = await request.json()
    const { caseId, query, mode, conversationId: providedConvId, enableWebSearch } = body as {
      caseId: string
      query: string
      mode: AIMode
      conversationId?: string
      enableWebSearch?: boolean
    }

    if (!caseId || !query || !mode) {
      return Response.json(
        { error: 'Faltan campos: caseId, query, mode' },
        { status: 400, headers: corsHeaders },
      )
    }

    // ── Plan limits (check ANTES de procesar) ──
    const actionType = modeToActionType(mode)
    const planCheck = await checkPlanLimits(userId, actionType)

    if (!planCheck.allowed) {
      return Response.json(planLimitErrorBody(planCheck), {
        status: 429,
        headers: corsHeaders,
      })
    }

    // ── Fair use throttle (PRO/ULTRA fast_chat soft cap) ──
    if (planCheck.fair_use_throttle && planCheck.throttle_ms) {
      await new Promise((resolve) => setTimeout(resolve, planCheck.throttle_ms))
    }

    // ── Increment counter (optimista: antes del stream para evitar race conditions) ──
    const incResult = await incrementPlanCounter(userId, actionType)
    if (!incResult.success) {
      return Response.json(
        { error: incResult.error ?? 'Error al registrar uso', code: 'PLAN_LIMIT_EXCEEDED' },
        { status: 429, headers: corsHeaders },
      )
    }

    const conversationId = providedConvId ?? await resolveConversation(userId, caseId, mode)

    autoTitleIfNeeded(conversationId, query)

    let stream
    if (mode === 'fast_chat') {
      stream = askCaseStream({
        caseId,
        conversationId,
        userId,
        query,
        mode,
        enableWebSearch: enableWebSearch ?? false,
      })
    } else {
      stream = getEnhancedAnalysisStream({
        caseId,
        conversationId,
        userId,
        query,
        mode: mode as 'full_analysis' | 'deep_thinking',
        enableWebSearch: enableWebSearch ?? false,
      })
    }

    const sseStream = aiStreamToResilientSSE(stream)

    return new Response(sseStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        ...corsHeaders,
        ...rateLimitHeaders(rl),
      },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error interno'
    console.error('[api/chat] Error:', msg)
    return Response.json({ error: msg }, { status: 500, headers: corsHeaders })
  }
}

async function autoTitleIfNeeded(conversationId: string, query: string) {
  try {
    const db = createAdminClient()
    const { data, error } = await db
      .from('conversations')
      .select('title')
      .eq('id', conversationId)
      .single()

    if (error) {
      console.error('[autoTitle] Select error:', error.message)
      return
    }
    if (!data || data.title) return

    const title = await generateTitle(query)
    console.log(`[autoTitle] Generated: "${title}" for conv ${conversationId.slice(0, 8)}`)

    const { error: updateError } = await db
      .from('conversations')
      .update({ title })
      .eq('id', conversationId)

    if (updateError) {
      console.error('[autoTitle] Update error:', updateError.message)
    }
  } catch (err) {
    console.error('[autoTitle] Unexpected error:', err instanceof Error ? err.message : err)
  }
}

function truncateAtWordBoundary(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  const truncated = text.slice(0, maxLen)
  const lastSpace = truncated.lastIndexOf(' ')
  if (lastSpace <= 0) return truncated + '...'
  return truncated.slice(0, lastSpace) + '...'
}

async function generateTitle(query: string): Promise<string> {
  const fallback = truncateAtWordBoundary(query, 60)
  const apiKey = process.env.GOOGLE_API_KEY
  if (!apiKey) {
    console.warn('[autoTitle] GOOGLE_API_KEY not set, using fallback')
    return fallback
  }

  try {
    const ai = new GoogleGenAI({ apiKey })
    const response = await Promise.race([
      ai.models.generateContent({
        model: MODEL_IDS.GEMINI_FLASH,
        contents: [
          {
            role: 'user',
            parts: [{
              text: [
                'Genera un título breve para esta consulta legal.',
                'Reglas estrictas:',
                '- Máximo 8 palabras completas',
                '- NUNCA cortes ni trunces una palabra a la mitad',
                '- NUNCA omitas letras del inicio o final',
                '- Sin comillas, sin puntos finales, sin explicaciones',
                '- Responde ÚNICAMENTE con el título',
                '',
                `Consulta: "${query}"`,
              ].join('\n'),
            }],
          },
        ],
        config: { temperature: 0.3, maxOutputTokens: 60 },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 5_000),
      ),
    ])

    let title = (response.text ?? '').trim()
    title = title.replace(/^["'"""''`]+|["'"""''`]+$/g, '')
    title = title.replace(/[.…]+$/, '')
    title = title.split('\n')[0].trim()

    if (!title || title.length < 3 || title.length > 80) return fallback
    return title
  } catch (err) {
    console.warn('[autoTitle] AI generation failed, using fallback:', err instanceof Error ? err.message : err)
    return fallback
  }
}

async function resolveConversation(
  userId: string,
  caseId: string,
  mode: AIMode,
): Promise<string> {
  const db = createAdminClient()

  const { data: existing } = await db
    .from('conversations')
    .select('id')
    .eq('user_id', userId)
    .eq('case_id', caseId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .single()

  if (existing) return existing.id

  const { data: created, error } = await db
    .from('conversations')
    .insert({ user_id: userId, case_id: caseId, mode })
    .select('id')
    .single()

  if (error || !created) {
    throw new Error(`No se pudo crear conversación: ${error?.message}`)
  }

  return created.id
}
