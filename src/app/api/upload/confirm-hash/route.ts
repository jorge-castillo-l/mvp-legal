/**
 * ============================================================
 * API ROUTE: /api/upload/confirm-hash
 * ============================================================
 * Calcula el hash SHA-256 COMPLETO de un archivo ya subido en
 * Supabase Storage y confirma/reemplaza el hash parcial que
 * el PdfValidator (4.09) calculó client-side.
 *
 * Seguridad:
 *   - Requiere JWT válido
 *   - Solo accede a archivos del usuario autenticado (RLS path)
 *   - CORS restringido a la extensión de Chrome
 * ============================================================
 */

import { createClient, createClientWithToken } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { getCorsHeaders, handleCorsOptions } from '@/lib/cors'

const BUCKET_NAME = 'case-files'

export async function POST(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request, { methods: 'POST, OPTIONS' })

  try {
    // === 1. Verificar autenticación ===
    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Token de autenticación requerido' },
        { status: 401, headers: corsHeaders }
      )
    }

    const token = authHeader.slice(7)
    const supabaseAuth = await createClient()
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token)

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Sesión inválida o expirada' },
        { status: 401, headers: corsHeaders }
      )
    }

    const supabase = createClientWithToken(token)

    // === 2. Obtener path del archivo ===
    const body = await request.json()
    const { storagePath, partialHash, rol } = body

    if (!storagePath) {
      return NextResponse.json(
        { error: 'storagePath es requerido' },
        { status: 400, headers: corsHeaders }
      )
    }

    // Seguridad: verificar que el path pertenece al usuario
    if (!storagePath.startsWith(user.id + '/')) {
      return NextResponse.json(
        { error: 'No tiene permiso para acceder a este archivo' },
        { status: 403, headers: corsHeaders }
      )
    }

    // === 3. Descargar el archivo desde Supabase Storage ===
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(BUCKET_NAME)
      .download(storagePath)

    if (downloadError || !fileData) {
      return NextResponse.json(
        { error: `Error descargando archivo: ${downloadError?.message || 'no encontrado'}` },
        { status: 404, headers: corsHeaders }
      )
    }

    // === 4. Calcular hash SHA-256 completo ===
    const arrayBuffer = await fileData.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const hash = createHash('sha256').update(buffer).digest('hex')

    // === 5. Responder con el hash completo ===
    return NextResponse.json(
      {
        success: true,
        hash,
        storagePath,
        fileSize: buffer.length,
        partialHash: partialHash || null,
        hashType: 'full',
        rol: rol || null,
        message: partialHash?.startsWith('p:')
          ? 'Hash parcial reemplazado por hash completo'
          : 'Hash completo calculado',
      },
      { status: 200, headers: corsHeaders }
    )
  } catch (error) {
    console.error('Error en /api/upload/confirm-hash:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500, headers: corsHeaders }
    )
  }
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsOptions(request)
}
