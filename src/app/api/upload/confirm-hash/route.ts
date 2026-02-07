/**
 * ============================================================
 * API ROUTE: /api/upload/confirm-hash
 * ============================================================
 * Calcula el hash SHA-256 COMPLETO de un archivo ya subido en
 * Supabase Storage y confirma/reemplaza el hash parcial que
 * el PdfValidator (4.09) calculó client-side.
 *
 * CONTEXTO:
 *   - Archivos ≤50MB: el validador calcula hash completo client-side.
 *   - Archivos >50MB: el validador calcula hash PARCIAL (primeros 1MB +
 *     últimos 1MB + tamaño) para no crashear el navegador.
 *     Los hashes parciales tienen prefijo "p:" en la BD.
 *
 * Este endpoint:
 *   1. Lee el archivo desde Supabase Storage
 *   2. Calcula hash SHA-256 completo en streaming
 *   3. Retorna el hash para que el cliente lo registre
 *
 * Se invoca después de un upload resumable exitoso.
 * En producción, esto se moverá a una Edge Function de Supabase
 * que se dispara automáticamente al crear un nuevo objeto en
 * el bucket 'case-files' (Tarea 4.02).
 *
 * Seguridad:
 *   - Requiere JWT válido
 *   - Solo accede a archivos del usuario autenticado (RLS path)
 * ============================================================
 */

import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'

const BUCKET_NAME = 'case-files'

export async function POST(request: NextRequest) {
  try {
    // === 1. Verificar autenticación ===
    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Token de autenticación requerido' },
        { status: 401 }
      )
    }

    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Sesión inválida o expirada' },
        { status: 401 }
      )
    }

    // === 2. Obtener path del archivo ===
    const body = await request.json()
    const { storagePath, partialHash, rol } = body

    if (!storagePath) {
      return NextResponse.json(
        { error: 'storagePath es requerido' },
        { status: 400 }
      )
    }

    // Seguridad: verificar que el path pertenece al usuario
    if (!storagePath.startsWith(user.id + '/')) {
      return NextResponse.json(
        { error: 'No tiene permiso para acceder a este archivo' },
        { status: 403 }
      )
    }

    // === 3. Descargar el archivo desde Supabase Storage ===
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(BUCKET_NAME)
      .download(storagePath)

    if (downloadError || !fileData) {
      return NextResponse.json(
        { error: `Error descargando archivo: ${downloadError?.message || 'no encontrado'}` },
        { status: 404 }
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
      {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': 'chrome-extension://*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      }
    )
  } catch (error) {
    console.error('Error en /api/upload/confirm-hash:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}

export async function OPTIONS() {
  return NextResponse.json({}, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': 'chrome-extension://*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
