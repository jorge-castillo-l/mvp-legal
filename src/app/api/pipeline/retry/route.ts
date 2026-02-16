/**
 * ============================================================
 * API ROUTE: /api/pipeline/retry
 * ============================================================
 * Reprocesa documentos fallidos que ya cumplieron su período
 * de backoff. También permite reprocesar un documento específico.
 *
 * GET  → estadísticas de la cola
 * POST → reintentar fallidos (body opcional: { document_id })
 *
 * Autenticación: PIPELINE_SECRET_KEY en header X-Pipeline-Key
 * ============================================================
 */

import { NextRequest, NextResponse } from 'next/server'
import { processDocument, retryFailedDocuments, getQueueStats } from '@/lib/pipeline/orchestrator'

function validatePipelineKey(request: NextRequest): boolean {
  const key = process.env.PIPELINE_SECRET_KEY
  if (!key) {
    console.error('[pipeline] PIPELINE_SECRET_KEY no configurada en .env.local')
    return false
  }

  const provided = request.headers.get('X-Pipeline-Key')
  return provided === key
}

export async function GET(request: NextRequest) {
  if (!validatePipelineKey(request)) {
    return NextResponse.json(
      { error: 'No autorizado. Se requiere X-Pipeline-Key válida.' },
      { status: 401 }
    )
  }

  try {
    const stats = await getQueueStats()
    return NextResponse.json({ stats })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error obteniendo estadísticas'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  if (!validatePipelineKey(request)) {
    return NextResponse.json(
      { error: 'No autorizado. Se requiere X-Pipeline-Key válida.' },
      { status: 401 }
    )
  }

  try {
    const body = await request.json().catch(() => ({}))
    const documentId = (body as Record<string, unknown>)?.document_id as string | undefined

    if (documentId) {
      const result = await processDocument(documentId)
      return NextResponse.json(result, { status: result.success ? 200 : 422 })
    }

    const results = await retryFailedDocuments()
    return NextResponse.json({
      retried: results.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error en retry pipeline'
    console.error('[pipeline/retry] Error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
