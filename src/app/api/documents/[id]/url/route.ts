/**
 * ============================================================
 * API Route: /api/documents/[id]/url — Tarea 3.11
 * ============================================================
 * Genera una signed URL temporal para acceder a un PDF desde
 * Supabase Storage. Verifica que el usuario sea dueño del
 * documento via RLS.
 *
 * Response: { url: string, expiresIn: number }
 * ============================================================
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createClientWithToken, createAdminClient } from '@/lib/supabase/server'
import { getCorsHeaders, handleCorsOptions } from '@/lib/cors'

const SIGNED_URL_EXPIRY_SECONDS = 3600 // 1 hour

export async function OPTIONS(request: NextRequest) {
  return handleCorsOptions(request)
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const corsHeaders = getCorsHeaders(request)
  const { id: documentId } = await params

  try {
    const authHeader = request.headers.get('Authorization')
    let userId: string

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      const client = createClientWithToken(token)
      const { data: { user }, error } = await client.auth.getUser()
      if (error || !user) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders })
      }
      userId = user.id
    } else {
      const client = await createClient()
      const { data: { user }, error } = await client.auth.getUser()
      if (error || !user) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders })
      }
      userId = user.id
    }

    const db = createAdminClient()

    const { data: doc, error: docError } = await db
      .from('documents')
      .select('storage_path, user_id')
      .eq('id', documentId)
      .single()

    if (docError || !doc) {
      return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404, headers: corsHeaders })
    }

    if (doc.user_id !== userId) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403, headers: corsHeaders })
    }

    const { data: signedData, error: storageError } = await db.storage
      .from('case-files')
      .createSignedUrl(doc.storage_path, SIGNED_URL_EXPIRY_SECONDS)

    if (storageError || !signedData?.signedUrl) {
      return NextResponse.json(
        { error: 'Error generando URL de acceso' },
        { status: 500, headers: corsHeaders },
      )
    }

    return NextResponse.json(
      { url: signedData.signedUrl, expiresIn: SIGNED_URL_EXPIRY_SECONDS },
      { headers: corsHeaders },
    )
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error interno'
    return NextResponse.json({ error: msg }, { status: 500, headers: corsHeaders })
  }
}
