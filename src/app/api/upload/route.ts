/**
 * ============================================================
 * API ROUTE: /api/upload
 * ============================================================
 * Pipeline full-stack: Scraper → API → Storage + DB
 *
 * Flujo secuencial:
 *   1. Auth: Verificar JWT
 *   2. Validar: Tipo, tamaño, campos requeridos
 *   3. Dedup: Verificar hash en document_hashes → si existe, skip
 *   4. Upsert Case: Crear/actualizar causa en tabla cases
 *   5. Upload Storage: Subir PDF al bucket case-files
 *   6. Insert Document: Registrar en tabla documents
 *   7. Extract Text: Extraer texto (pdf-parse + fallback OCR Document AI) y guardar en extracted_texts
 *   8. Insert Hash: Registrar en tabla document_hashes
 *   9. Response: Devolver metadata + estado de extracción
 *
 * Contrato FormData (campos que envía la extensión):
 *   - file          (File)   REQUERIDO
 *   - case_rol      (string) REQUERIDO para scraper, opcional para manual
 *   - tribunal      (string) opcional
 *   - caratula      (string) opcional
 *   - materia       (string) opcional
 *   - document_type (string) 'resolucion'|'escrito'|'actuacion'|'notificacion'|'otro'
 *   - file_hash     (string) SHA-256 del archivo
 *   - source        (string) 'scraper'|'manual_upload'
 *   - source_url    (string) URL original del PDF
 *   - captured_at   (string) ISO timestamp de captura
 * ============================================================
 */

import { createAdminClient, createClient, createClientWithToken } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getCorsHeaders, handleCorsOptions } from '@/lib/cors'
import { createHash } from 'crypto'
import { extractPdfTextWithFallback } from '@/lib/pdf-processing'
import type { CaseInsert, DocumentInsert, DocumentHashInsert, ExtractedTextInsert } from '@/types/supabase'

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB
const ALLOWED_TYPES = ['application/pdf', 'application/octet-stream']
const BUCKET_NAME = 'case-files'

export async function POST(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request, { methods: 'POST, OPTIONS' })

  try {
    // ══════════════════════════════════════════════════════
    // PASO 1: AUTENTICACIÓN
    // ══════════════════════════════════════════════════════
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

    // Cliente con token para que RLS (auth.uid()) funcione en inserts/updates
    const supabase = createClientWithToken(token)

    // ══════════════════════════════════════════════════════
    // PASO 2: EXTRAER Y VALIDAR FORMDATA
    // ══════════════════════════════════════════════════════
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json(
        { error: 'No se proporcionó archivo' },
        { status: 400, headers: corsHeaders }
      )
    }

    if (!ALLOWED_TYPES.includes(file.type) && !file.name.endsWith('.pdf')) {
      return NextResponse.json(
        { error: 'Solo se aceptan archivos PDF' },
        { status: 400, headers: corsHeaders }
      )
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `Archivo demasiado grande. Máximo: ${MAX_FILE_SIZE / (1024 * 1024)}MB. Use upload resumable para archivos mayores.` },
        { status: 400, headers: corsHeaders }
      )
    }

    if (file.size === 0) {
      return NextResponse.json(
        { error: 'El archivo está vacío' },
        { status: 400, headers: corsHeaders }
      )
    }

    // Extraer metadata del FormData
    const caseRol = (formData.get('case_rol') as string || '').trim()
    const tribunal = (formData.get('tribunal') as string || '').trim() || null
    const caratula = (formData.get('caratula') as string || '').trim() || null
    const materia = (formData.get('materia') as string || '').trim() || null
    const documentType = (formData.get('document_type') as string || 'otro').trim()
    const fileHashFromClient = (formData.get('file_hash') as string || '').trim()
    const source = (formData.get('source') as string || 'unknown').trim()
    const sourceUrl = (formData.get('source_url') as string || '').trim() || null
    const capturedAt = (formData.get('captured_at') as string || '').trim() || null

    // ══════════════════════════════════════════════════════
    // PASO 3: CALCULAR HASH Y VERIFICAR DUPLICADOS
    // ══════════════════════════════════════════════════════
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Hash server-side (fuente de verdad, el del cliente puede ser parcial)
    const serverHash = createHash('sha256').update(buffer).digest('hex')
    // Usar hash del cliente si es completo (sin prefijo 'p:'), sino el del servidor
    const fileHash = (fileHashFromClient && !fileHashFromClient.startsWith('p:'))
      ? fileHashFromClient
      : serverHash

    // Verificar duplicado en document_hashes
    const { data: existingHash } = await supabase
      .from('document_hashes')
      .select('id, filename')
      .eq('user_id', user.id)
      .eq('hash', fileHash)
      .maybeSingle()

    if (existingHash) {
      return NextResponse.json(
        {
          success: false,
          duplicate: true,
          message: `Documento duplicado. Ya existe como "${existingHash.filename || 'documento previo'}".`,
          existing_hash_id: existingHash.id,
        },
        { status: 200, headers: corsHeaders }
      )
    }

    // ══════════════════════════════════════════════════════
    // PASO 4: UPSERT CASE (Crear o actualizar causa)
    // ══════════════════════════════════════════════════════
    let caseId: string | null = null

    if (caseRol) {
      // Buscar causa por user + rol + tribunal + carátula (mismo ROL puede existir en distintos tribunales)
      const tribunalNorm = tribunal || ''
      const caratulaNorm = caratula || ''
      const { data: candidates } = await supabase
        .from('cases')
        .select('id, tribunal, caratula')
        .eq('user_id', user.id)
        .eq('rol', caseRol)
      const existingCase = candidates?.find(
        (c) => (c.tribunal || '') === tribunalNorm && (c.caratula || '') === caratulaNorm
      )

      if (existingCase) {
        caseId = existingCase.id
        // Actualizar metadata si viene nueva info (no sobreescribir con vacío)
        const updateData: Record<string, string | null> = {
          last_synced_at: new Date().toISOString(),
        }
        if (tribunal) updateData.tribunal = tribunal
        if (caratula) updateData.caratula = caratula
        if (materia) updateData.materia = materia

        await supabase
          .from('cases')
          .update(updateData)
          .eq('id', caseId)
      } else {
        // Crear nueva causa
        const newCase: CaseInsert = {
          user_id: user.id,
          rol: caseRol,
          tribunal,
          caratula,
          materia,
          last_synced_at: new Date().toISOString(),
        }

        const { data: createdCase, error: caseError } = await supabase
          .from('cases')
          .insert(newCase)
          .select('id')
          .single()

        if (caseError) {
          // Race condition: otro request del scraper creó la misma causa simultáneamente.
          // El UNIQUE INDEX (user_id, rol, COALESCE(tribunal,''), COALESCE(caratula,''))
          // protege contra duplicados. Recuperamos la causa existente.
          if (caseError.message.includes('unique') || caseError.message.includes('duplicate')) {
            const tribunalNormRetry = tribunal || ''
            const caratulaNormRetry = caratula || ''
            const { data: retryCandidate } = await supabase
              .from('cases')
              .select('id, tribunal, caratula')
              .eq('user_id', user.id)
              .eq('rol', caseRol)
            const raceCase = retryCandidate?.find(
              (c) => (c.tribunal || '') === tribunalNormRetry && (c.caratula || '') === caratulaNormRetry
            )
            if (raceCase) {
              caseId = raceCase.id
            } else {
              console.error('Error creando caso (constraint violation pero no se encontró duplicado):', caseError)
              return NextResponse.json(
                { error: `Error al registrar causa: ${caseError.message}` },
                { status: 500, headers: corsHeaders }
              )
            }
          } else {
            console.error('Error creando caso:', caseError)
            return NextResponse.json(
              { error: `Error al registrar causa: ${caseError.message}` },
              { status: 500, headers: corsHeaders }
            )
          }
        } else {
          caseId = createdCase.id
        }
      }
    }

    // ══════════════════════════════════════════════════════
    // PASO 5: SUBIR A SUPABASE STORAGE
    // ══════════════════════════════════════════════════════
    const now = new Date()
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const uniqueId = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
    const storagePath = `${user.id}/${yearMonth}/${uniqueId}_${sanitizedName}`

    // Storage: usar admin client (bypassa RLS). El usuario ya fue validado arriba.
    const supabaseAdmin = createAdminClient()
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET_NAME)
      .upload(storagePath, buffer, {
        contentType: 'application/pdf',
        cacheControl: '3600',
        upsert: false,
        duplex: 'half',
        metadata: {
          owner: user.id,
          plan_type: 'free',
          uploaded_at: new Date().toISOString(),
        },
      })

    if (uploadError) {
      console.error('Error subiendo a Supabase Storage:', uploadError)
      return NextResponse.json(
        { error: `Error al guardar archivo: ${uploadError.message}` },
        { status: 500, headers: corsHeaders }
      )
    }

    // ══════════════════════════════════════════════════════
    // PASO 6: REGISTRAR DOCUMENTO EN DB
    // ══════════════════════════════════════════════════════
    let documentId: string | null = null
    let textExtraction: {
      status: 'completed' | 'needs_ocr' | 'failed'
      method: 'pdf-parse' | 'document-ai'
      chars_per_page: number
      page_count: number
      persisted: boolean
      ocr_attempted: boolean
      ocr_batches: number
      native_status: 'completed' | 'needs_ocr' | 'failed'
    } | null = null

    if (caseId) {
      const newDocument: DocumentInsert = {
        case_id: caseId,
        user_id: user.id,
        filename: sanitizedName,
        original_filename: file.name,
        storage_path: uploadData.path,
        document_type: documentType,
        file_size: file.size,
        file_hash: fileHash,
        source,
        source_url: sourceUrl,
        captured_at: capturedAt,
      }

      const { data: createdDoc, error: docError } = await supabase
        .from('documents')
        .insert(newDocument)
        .select('id')
        .single()

      if (docError) {
        console.error('Error registrando documento:', docError)
        // No fallamos aquí — el archivo ya está en Storage.
        // Lo logueamos para investigar, pero respondemos con warning.
      } else {
        documentId = createdDoc.id
      }

      // PASO 7: Extracción de texto con fallback (pdf-parse -> Document AI OCR)
      if (documentId) {
        const extraction = await extractPdfTextWithFallback(buffer)
        const extractedTextPayload: ExtractedTextInsert = {
          document_id: documentId,
          case_id: caseId,
          user_id: user.id,
          full_text: extraction.fullText,
          extraction_method: extraction.extractionMethod,
          page_count: extraction.pageCount,
          status: extraction.status,
        }

        const { error: extractedTextError } = await supabase
          .from('extracted_texts')
          .upsert(extractedTextPayload, { onConflict: 'document_id' })

        if (extractedTextError) {
          console.error('Error guardando extracted_texts:', extractedTextError)
        }

        if (extraction.errorMessage) {
          console.error('Extracción PDF con fallback reportó incidencia:', extraction.errorMessage)
        }

        textExtraction = {
          status: extractedTextError ? 'failed' : extraction.status,
          method: extraction.extractionMethod,
          chars_per_page: extraction.charsPerPage,
          page_count: extraction.pageCount,
          persisted: !extractedTextError,
          ocr_attempted: extraction.ocrAttempted,
          ocr_batches: extraction.ocrBatchCount,
          native_status: extraction.nativeStatus,
        }
      }

      // Actualizar document_count en la causa (no crítico si falla)
      try {
        await supabase.rpc('increment_counter', {
          user_id: user.id,
          counter_type: 'case',
        })
      } catch {
        // Ignorar — puede fallar si la función no existe
      }
    }

    // ══════════════════════════════════════════════════════
    // PASO 8: REGISTRAR HASH PARA DEDUPLICACIÓN
    // Solo si el documento se registró — evita hashes huérfanos.
    // ══════════════════════════════════════════════════════
    if (documentId) {
      const newHash: DocumentHashInsert = {
        user_id: user.id,
        rol: caseRol || 'sin_rol',
        case_id: caseId || null,
        tribunal: tribunal || null,
        caratula: caratula || null,
        hash: fileHash,
        filename: sanitizedName,
        document_type: documentType,
      }

      const { error: hashError } = await supabase
        .from('document_hashes')
        .insert(newHash)

      if (hashError && !hashError.message.includes('unique') && !hashError.message.includes('duplicate')) {
        console.error('Error registrando hash:', hashError)
      }
    }

    // ══════════════════════════════════════════════════════
    // PASO 9: RESPUESTA EXITOSA
    // ══════════════════════════════════════════════════════
    return NextResponse.json(
      {
        success: true,
        duplicate: false,
        path: uploadData.path,
        filename: sanitizedName,
        size: file.size,
        hash: fileHash,
        case_id: caseId,
        document_id: documentId,
        case_rol: caseRol || null,
        metadata: {
          tribunal,
          caratula,
          materia,
          documentType,
          source,
          capturedAt,
          uploadedAt: now.toISOString(),
          textExtraction,
        },
      },
      { status: 200, headers: corsHeaders }
    )
  } catch (error) {
    console.error('Error en /api/upload:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500, headers: corsHeaders }
    )
  }
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsOptions(request)
}
