/**
 * ============================================================
 * API ROUTE: /api/pipeline/process-document
 * ============================================================
 * Endpoint interno que procesa un documento encolado.
 *
 * Invocado por:
 *   1) Edge Function (trigger de Database Webhook)
 *   2) Upload route (fire-and-forget tras registrar documento)
 *   3) Retry API (reprocesar documentos fallidos)
 *
 * Autenticación: PIPELINE_SECRET_KEY en header X-Pipeline-Key
 * (shared secret entre Edge Function y API routes internas).
 *
 * Body: { document_id: string }
 * ============================================================
 */

import { NextRequest, NextResponse } from 'next/server'
import { processDocument } from '@/lib/pipeline/orchestrator'

function validatePipelineKey(request: NextRequest): boolean {
  const key = process.env.PIPELINE_SECRET_KEY
  if (!key) {
    console.error('[pipeline] PIPELINE_SECRET_KEY no configurada en .env.local')
    return false
  }

  const provided = request.headers.get('X-Pipeline-Key')
  return provided === key
}

export async function POST(request: NextRequest) {
  // ── Auth: validar clave interna ────────────────────────────
  if (!validatePipelineKey(request)) {
    return NextResponse.json(
      { error: 'No autorizado. Se requiere X-Pipeline-Key válida.' },
      { status: 401 }
    )
  }

  try {
    const body = await request.json()
    const documentId = body?.document_id as string | undefined

    if (!documentId) {
      return NextResponse.json(
        { error: 'Se requiere document_id en el body.' },
        { status: 400 }
      )
    }

    // ── Procesar documento ─────────────────────────────────────
    const result = await processDocument(documentId)

    return NextResponse.json(result, {
      status: result.success ? 200 : 422,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error interno del pipeline'
    console.error('[pipeline/process-document] Error:', message)

    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}
