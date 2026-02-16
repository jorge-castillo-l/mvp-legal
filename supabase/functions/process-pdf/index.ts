/**
 * ============================================================
 * SUPABASE EDGE FUNCTION: process-pdf
 * ============================================================
 * Tarea 7.05 — Capa trigger del PDF Processing Orchestrator.
 *
 * Esta Edge Function actúa como puente entre Supabase (Database
 * Webhook) y la API de Next.js donde vive la lógica pesada de
 * extracción (pdf-parse + Document AI corren en Node.js).
 *
 * Modos de invocación:
 *   1) Database Webhook: Supabase envía payload con record
 *      al insertar en processing_queue.
 *   2) Invocación directa: supabase.functions.invoke('process-pdf',
 *      { body: { document_id } })
 *   3) Invocación manual para retry: { action: 'retry' }
 *
 * Configuración (Supabase Dashboard → Edge Functions → Secrets):
 *   - APP_URL: URL de la app Next.js (ej: https://mvp-legal.vercel.app)
 *   - PIPELINE_SECRET_KEY: Clave compartida para auth interna
 *
 * Deploy: supabase functions deploy process-pdf --no-verify-jwt
 * ============================================================
 */

// Tipos para el payload del Database Webhook
interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  schema: string
  record: Record<string, unknown> | null
  old_record: Record<string, unknown> | null
}

interface DirectPayload {
  document_id?: string
  action?: 'retry' | 'process'
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const appUrl = Deno.env.get('APP_URL')
    const pipelineKey = Deno.env.get('PIPELINE_SECRET_KEY')

    if (!appUrl || !pipelineKey) {
      throw new Error(
        'Configuración incompleta. Secrets requeridos: APP_URL, PIPELINE_SECRET_KEY. ' +
        'Configurar en Supabase Dashboard → Edge Functions → Secrets.'
      )
    }

    const body = await req.json()

    // ── Detectar tipo de invocación ──────────────────────────
    let documentId: string | undefined
    let isRetry = false

    if (body.type && body.record) {
      // Database Webhook payload
      const webhook = body as WebhookPayload
      documentId = webhook.record?.document_id as string | undefined
    } else {
      // Invocación directa
      const direct = body as DirectPayload
      documentId = direct.document_id
      isRetry = direct.action === 'retry'
    }

    // ── Modo retry: reprocesar documentos fallidos ───────────
    if (isRetry) {
      const response = await fetch(`${appUrl}/api/pipeline/retry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Pipeline-Key': pipelineKey,
        },
        body: JSON.stringify(documentId ? { document_id: documentId } : {}),
      })

      const result = await response.json()
      return new Response(JSON.stringify(result), {
        status: response.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Modo process: procesar documento específico ──────────
    if (!documentId) {
      return new Response(
        JSON.stringify({ error: 'document_id requerido (o action: "retry" para reprocesar fallidos)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const response = await fetch(`${appUrl}/api/pipeline/process-document`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Pipeline-Key': pipelineKey,
      },
      body: JSON.stringify({ document_id: documentId }),
    })

    const result = await response.json()
    return new Response(JSON.stringify(result), {
      status: response.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error en Edge Function process-pdf'
    console.error('[edge/process-pdf]', message)

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
