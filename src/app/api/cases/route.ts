/**
 * ============================================================
 * API ROUTE: /api/cases
 * ============================================================
 * GET  → Lista causas del usuario con conteo de documentos.
 * DELETE → Elimina una causa y todos sus datos asociados (cascade).
 *
 * Respuesta GET:
 *   { cases: [ { id, rol, tribunal, caratula, ..., document_count } ] }
 *
 * Respuesta DELETE:
 *   { deleted: { case_id, rol, documents_removed, storage_removed } }
 * ============================================================
 */

export const maxDuration = 120

import { createClient, createClientWithToken, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getCorsHeaders, handleCorsOptions } from '@/lib/cors'
import { checkRateLimit, rateLimitHeaders } from '@/lib/rate-limit'

const ALLOWED_METHODS = 'GET, DELETE, OPTIONS'

export async function GET(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request, { methods: ALLOWED_METHODS })

  try {
    // === Rate limit (30 req/min — lecturas) ===
    const rl = checkRateLimit(request, { maxRequests: 30, windowMs: 60_000 }, 'cases')
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Demasiadas solicitudes. Intenta en unos segundos.', code: 'RATE_LIMITED' },
        { status: 429, headers: { ...corsHeaders, ...rateLimitHeaders(rl) } },
      )
    }

    // === Auth === (Bearer para extensión, cookies para Dashboard)
    const authHeader = request.headers.get('Authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined
    const supabaseAuth = await createClient()
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token)

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Sesión inválida o expirada' },
        { status: 401, headers: corsHeaders }
      )
    }

    const supabase = token ? createClientWithToken(token) : supabaseAuth

    // === Query con conteo embebido (1 sola ida a DB) ===
    // PostgREST traduce esto a:
    //   SELECT cases.*, COUNT(documents.id) AS document_count
    //   FROM cases LEFT JOIN documents ON ...
    //   WHERE cases.user_id = $1
    //   GROUP BY cases.id
    //   ORDER BY cases.updated_at DESC
    const { data: cases, error: queryError } = await supabase
      .from('cases')
      .select('*, documents(count)')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })

    if (queryError) {
      console.error('Error consultando causas:', queryError)
      return NextResponse.json(
        { error: `Error al consultar causas: ${queryError.message}` },
        { status: 500, headers: corsHeaders }
      )
    }

    // Transformar la respuesta de PostgREST a un formato limpio.
    // PostgREST devuelve: { ..., documents: [{ count: N }] }
    // Nosotros devolvemos: { ..., document_count: N }
    const cleanCases = (cases || []).map(c => {
      const { documents, ...caseData } = c as Record<string, unknown>
      const docArray = documents as Array<{ count: number }> | null
      return {
        ...caseData,
        document_count: docArray?.[0]?.count ?? 0,
      }
    })

    return NextResponse.json(
      { cases: cleanCases },
      { status: 200, headers: corsHeaders }
    )
  } catch (error) {
    console.error('Error en /api/cases:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500, headers: corsHeaders }
    )
  }
}

// ════════════════════════════════════════════════════════════
// DELETE — Elimina una causa y TODOS sus datos asociados
// ════════════════════════════════════════════════════════════

export async function DELETE(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request, { methods: ALLOWED_METHODS })

  try {
    // === Rate limit (10 req/min — deletes son costosos) ===
    const rl = checkRateLimit(request, { maxRequests: 10, windowMs: 60_000 }, 'cases-delete')
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Demasiadas solicitudes. Intenta en unos segundos.', code: 'RATE_LIMITED' },
        { status: 429, headers: { ...corsHeaders, ...rateLimitHeaders(rl) } },
      )
    }

    const authHeader = request.headers.get('Authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined
    const supabaseAuth = await createClient()
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token)

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Sesión inválida o expirada' },
        { status: 401, headers: corsHeaders }
      )
    }

    const body = await request.json().catch(() => ({}))
    const caseId = body.case_id as string | undefined

    if (!caseId) {
      return NextResponse.json(
        { error: 'Falta case_id en el body' },
        { status: 400, headers: corsHeaders }
      )
    }

    const supabaseAdmin = createAdminClient()

    // 1. Verificar que la causa pertenece al usuario
    const { data: targetCase, error: caseError } = await supabaseAdmin
      .from('cases')
      .select('id, rol, tribunal, user_id')
      .eq('id', caseId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (caseError || !targetCase) {
      return NextResponse.json(
        { error: 'Causa no encontrada o no pertenece al usuario' },
        { status: 404, headers: corsHeaders }
      )
    }

    // 2. Obtener storage paths ANTES de borrar filas (necesitamos las rutas)
    const { data: docs } = await supabaseAdmin
      .from('documents')
      .select('storage_path')
      .eq('case_id', caseId)

    const storagePaths = (docs || []).map(d => d.storage_path).filter(Boolean) as string[]
    const docCount = docs?.length ?? 0

    // 3. Eliminar archivos PDF del Storage ANTES de borrar filas.
    //    Si falla parcialmente, registramos los paths huérfanos pero NO abortamos:
    //    es preferible que el usuario pueda borrar la causa a que quede bloqueado.
    let storageRemoved = 0
    const orphanedPaths: string[] = []

    if (storagePaths.length > 0) {
      console.log(`[DELETE /api/cases] Storage paths a eliminar (${storagePaths.length}):`, storagePaths.slice(0, 3))

      const BATCH_SIZE = 100
      for (let i = 0; i < storagePaths.length; i += BATCH_SIZE) {
        const batch = storagePaths.slice(i, i + BATCH_SIZE)
        const { data: removed, error: removeError } = await supabaseAdmin.storage
          .from('case-files')
          .remove(batch)

        if (removeError) {
          console.error(`[DELETE /api/cases] Storage batch error (${i / BATCH_SIZE + 1}):`, removeError)

          for (const path of batch) {
            const { error: singleErr } = await supabaseAdmin.storage
              .from('case-files')
              .remove([path])
            if (singleErr) {
              orphanedPaths.push(path)
            } else {
              storageRemoved++
            }
          }
        } else {
          storageRemoved += removed?.length ?? 0
        }
      }

      if (orphanedPaths.length > 0) {
        console.error(
          `[DELETE /api/cases] ⚠ ${orphanedPaths.length} PDF(s) huérfanos en Storage (sin referencia en DB tras el CASCADE):`,
          orphanedPaths
        )
      }

      console.log(`[DELETE /api/cases] Storage: ${storageRemoved}/${storagePaths.length} archivos eliminados`)
    }

    // 4. Eliminar la causa — CASCADE limpia TODAS las tablas dependientes:
    //    documents, extracted_texts, document_chunks, document_embeddings,
    //    document_hashes (con case_id), processing_queue, conversations,
    //    chat_messages, y todas las tablas case_* (PJUD estructuradas).
    const { error: deleteError } = await supabaseAdmin
      .from('cases')
      .delete()
      .eq('id', caseId)
      .eq('user_id', user.id)

    if (deleteError) {
      console.error(`[DELETE /api/cases] Error eliminando causa ${caseId}:`, deleteError)
      return NextResponse.json(
        { error: `Error al eliminar causa: ${deleteError.message}` },
        { status: 500, headers: corsHeaders }
      )
    }

    console.log(`[DELETE /api/cases] Causa eliminada: ${targetCase.rol} (${caseId}) — ${docCount} docs, ${storageRemoved} PDFs del storage`)

    return NextResponse.json(
      {
        deleted: {
          case_id: caseId,
          rol: targetCase.rol,
          tribunal: targetCase.tribunal,
          documents_removed: docCount,
          storage_removed: storageRemoved,
          storage_orphaned: orphanedPaths.length > 0 ? orphanedPaths.length : undefined,
        }
      },
      { status: 200, headers: corsHeaders }
    )
  } catch (error) {
    console.error('Error en DELETE /api/cases:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500, headers: corsHeaders }
    )
  }
}

export async function OPTIONS(request: NextRequest) {
  return NextResponse.json({}, {
    status: 200,
    headers: getCorsHeaders(request, { methods: ALLOWED_METHODS }),
  })
}
