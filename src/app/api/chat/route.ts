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

export const runtime = 'nodejs'
export const maxDuration = 120

import { NextRequest } from 'next/server'
import { GoogleGenAI } from '@google/genai'
import { createClient, createAdminClient, createClientWithToken } from '@/lib/supabase/server'
import { getCorsHeaders, handleCorsOptions } from '@/lib/cors'
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
      },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error interno'
    console.error('[api/chat] Error:', msg)
    return Response.json({ error: msg }, { status: 500, headers: corsHeaders })
  }
}

function autoTitleIfNeeded(conversationId: string, query: string) {
  const db = createAdminClient()
  db.from('conversations')
    .select('title')
    .eq('id', conversationId)
    .single()
    .then(async ({ data, error }) => {
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
    })
    .catch((err) => {
      console.error('[autoTitle] Unexpected error:', err instanceof Error ? err.message : err)
    })
}

async function generateTitle(query: string): Promise<string> {
  const fallback = query.length > 60 ? query.slice(0, 57) + '...' : query
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
              text: `Genera un título corto y descriptivo (máximo 8 palabras) para una conversación de chat legal cuya primera consulta es:\n\n"${query}"\n\nResponde SOLO con el título, sin comillas, sin puntos finales, sin explicaciones. Nunca trunces palabras.`,
            }],
          },
        ],
        config: { temperature: 0.4, maxOutputTokens: 150 },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 5_000),
      ),
    ])

    const title = (response.text ?? '').trim().replace(/^["'"""'']+|["'"""'']+$/g, '').replace(/\.$/, '')
    if (!title || title.length > 80) return fallback
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
