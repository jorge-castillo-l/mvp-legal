/**
 * ============================================================
 * API ROUTE: /api/upload
 * ============================================================
 * Recibe PDFs desde la extensión de Chrome y los sube a
 * Supabase Storage (bucket 'case-files').
 * 
 * Corresponde a la Tarea 4.03 del Kanban:
 * "Direct Upload API - Next.js route to receive PDF blobs
 *  from Chrome Extension and stream to Supabase Storage"
 * 
 * Flujo:
 *   Extension captura PDF → POST /api/upload → Supabase Storage
 * 
 * Seguridad:
 *   - Requiere JWT válido en header Authorization
 *   - Valida tipo de archivo (solo PDF)
 *   - Limita tamaño (50MB max para esta ruta estándar)
 *   - Archivos >50MB usan TUS protocol (resumable-upload.js)
 *   - Archivos se guardan bajo el path del user_id (RLS)
 * ============================================================
 */

import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB
const ALLOWED_TYPES = ['application/pdf', 'application/octet-stream']
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

    // === 2. Extraer archivo del FormData ===
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json(
        { error: 'No se proporcionó archivo' },
        { status: 400 }
      )
    }

    // === 3. Validaciones ===
    // Tipo de archivo
    if (!ALLOWED_TYPES.includes(file.type) && !file.name.endsWith('.pdf')) {
      return NextResponse.json(
        { error: 'Solo se aceptan archivos PDF' },
        { status: 400 }
      )
    }

    // Tamaño
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `Archivo demasiado grande. Máximo: ${MAX_FILE_SIZE / (1024 * 1024)}MB` },
        { status: 400 }
      )
    }

    if (file.size === 0) {
      return NextResponse.json(
        { error: 'El archivo está vacío' },
        { status: 400 }
      )
    }

    // === 4. Preparar metadata (incluye ROL tagging de Tarea 4.09) ===
    const sourceUrl = formData.get('source_url') as string || ''
    const source = formData.get('source') as string || 'unknown'
    const rol = formData.get('rol') as string || ''
    const tribunal = formData.get('tribunal') as string || ''
    const caratula = formData.get('caratula') as string || ''
    const documentType = formData.get('document_type') as string || 'otro'
    const confidence = formData.get('confidence') as string || '0'
    const capturedAt = formData.get('captured_at') as string || new Date().toISOString()

    // Generar path único: user_id/YYYY-MM/filename
    const now = new Date()
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const uniqueId = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
    const storagePath = `${user.id}/${yearMonth}/${uniqueId}_${sanitizedName}`

    // === 5. Convertir File a Buffer para upload ===
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // === 6. Subir a Supabase Storage ===
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(storagePath, buffer, {
        contentType: 'application/pdf',
        cacheControl: '3600',
        upsert: false,
        // Metadata personalizada
        duplex: 'half',
      })

    if (uploadError) {
      console.error('Error subiendo a Supabase Storage:', uploadError)
      return NextResponse.json(
        { error: `Error al guardar archivo: ${uploadError.message}` },
        { status: 500 }
      )
    }

    // === 7. Respuesta exitosa ===
    return NextResponse.json(
      {
        success: true,
        path: uploadData.path,
        filename: sanitizedName,
        size: file.size,
        metadata: {
          source,
          sourceUrl,
          rol,
          tribunal,
          caratula,
          documentType,
          confidence: parseFloat(confidence),
          capturedAt,
          uploadedAt: now.toISOString(),
        },
      },
      {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': 'chrome-extension://*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Credentials': 'true',
        },
      }
    )
  } catch (error) {
    console.error('Error en /api/upload:', error)
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
      'Access-Control-Allow-Credentials': 'true',
    },
  })
}
