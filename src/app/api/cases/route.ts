/**
 * ============================================================
 * API ROUTE: /api/cases
 * ============================================================
 * Devuelve las causas del usuario autenticado con conteo
 * de documentos incluido. UNA SOLA QUERY — sin N+1.
 *
 * Supabase PostgREST permite contar relaciones embebidas:
 *   .select('*, documents(count)')
 * Esto genera un LEFT JOIN + COUNT en una sola ida al DB.
 *
 * Respuesta:
 *   { cases: [ { id, rol, tribunal, caratula, ..., document_count } ] }
 * ============================================================
 */

import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getCorsHeaders, handleCorsOptions } from '@/lib/cors'

export async function GET(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request, { methods: 'GET, OPTIONS' })

  try {
    // === Auth ===
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Sesión inválida o expirada' },
        { status: 401, headers: corsHeaders }
      )
    }

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

export async function OPTIONS(request: NextRequest) {
  return handleCorsOptions(request)
}
