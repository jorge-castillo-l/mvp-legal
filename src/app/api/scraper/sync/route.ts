/**
 * ============================================================
 * API ROUTE: /api/scraper/sync — Tarea 4.17 + 4.18
 * ============================================================
 * Pipeline de sincronización server-side. Recibe CausaPackage
 * (JWTs + metadata) desde la extensión y ejecuta:
 *
 *   1) Auth: Verificar Bearer token
 *   2) Validar CausaPackage (rol, al menos un JWT)
 *   3) Upsert causa en DB (con procedimiento, libro_tipo, fuente_sync)
 *   4) Descargar PDFs directos (Texto Demanda, Certificado, Ebook)
 *   5) Descargar PDFs del cuaderno visible (folios con JWTs)
 *   6) Para cada cuaderno adicional: POST causaCivil.php → parse HTML
 *      → extraer JWTs de folios → descargar PDFs
 *   7) Dedup SHA-256 + Upload a Storage + Insert documents/hashes
 *   8) Crear placeholders extracted_texts + trigger processing
 *   9) Actualizar cases.document_count + last_synced_at
 *  10) Retornar resumen con documentos nuevos/existentes/errores via SSE
 *
 * Respuesta: SSE stream (text/event-stream).
 *   event: progress  → { message, current, total, cuaderno_current?, cuaderno_total? }
 *   event: complete  → SyncResult
 *   event: error     → { message }
 *
 * Throttle: 500ms–1s entre requests a PJUD.
 * Timeout: 5 min máx por sync.
 * Dedup: skip si hash ya existe en document_hashes.
 *
 * Node.js runtime (pdf-parse, crypto, Buffer, streaming).
 * ============================================================
 */

export const runtime = 'nodejs'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { createAdminClient, createClient, createClientWithToken } from '@/lib/supabase/server'
import { getCorsHeaders, handleCorsOptions } from '@/lib/cors'
import { PjudClient } from '@/lib/pjud/client'
import { parseFoliosFromHtml, parseReceptorData } from '@/lib/pjud/parser'
import type {
  CausaPackage,
  PdfDownloadTask,
  SyncResult,
  SyncedDocument,
  Folio,
  JwtRef,
  ReceptorData,
} from '@/lib/pjud/types'
import type {
  CaseInsert,
  DocumentInsert,
  DocumentHashInsert,
  ExtractedTextInsert,
} from '@/types/supabase'

// ════════════════════════════════════════════════════════
// SSE HELPERS (4.18)
// ════════════════════════════════════════════════════════

type SseEmitter = (event: string, data: object) => void

function createSseEmitter(controller: ReadableStreamDefaultController<Uint8Array>): SseEmitter {
  const encoder = new TextEncoder()
  return (event: string, data: object) => {
    try {
      controller.enqueue(
        encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      )
    } catch {
      // Client disconnected — server continues processing silently
    }
  }
}

const BUCKET_NAME = 'case-files'
const SYNC_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

// ════════════════════════════════════════════════════════
// POST /api/scraper/sync — SSE stream (4.18)
// ════════════════════════════════════════════════════════

export async function POST(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request, { methods: 'POST, OPTIONS' })

  // ──────────────────────────────────────────────────
  // PASO 1: AUTENTICACIÓN (antes del stream)
  // ──────────────────────────────────────────────────
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

  // ──────────────────────────────────────────────────
  // PASO 2: PARSEAR Y VALIDAR CausaPackage
  // ──────────────────────────────────────────────────
  let pkg: CausaPackage
  try {
    pkg = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Body JSON inválido' },
      { status: 400, headers: corsHeaders }
    )
  }

  if (!pkg.rol || typeof pkg.rol !== 'string') {
    return NextResponse.json(
      { error: 'Campo "rol" es requerido' },
      { status: 400, headers: corsHeaders }
    )
  }

  const hasJwts =
    pkg.jwt_texto_demanda ||
    pkg.jwt_certificado_envio ||
    pkg.jwt_ebook ||
    (pkg.folios && pkg.folios.length > 0) ||
    (pkg.cuadernos && pkg.cuadernos.length > 0)

  if (!hasJwts) {
    return NextResponse.json(
      { error: 'El paquete no contiene JWTs ni folios para sincronizar' },
      { status: 400, headers: corsHeaders }
    )
  }

  // ──────────────────────────────────────────────────
  // SSE STREAM: Todo el pipeline se ejecuta aquí
  // El cliente puede desconectarse sin interrumpir el servidor
  // ──────────────────────────────────────────────────
  const sseHeaders = {
    ...corsHeaders,
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = createSseEmitter(controller)
      const startTime = Date.now()

      try {
        const supabase = createClientWithToken(token)
        const supabaseAdmin = createAdminClient()

        // ────────────────────────────────────────────
        // PASO 3: UPSERT CAUSA EN DB
        // ────────────────────────────────────────────
        emit('progress', { message: 'Registrando causa…', current: 0, total: 0 })

        const caseId = await upsertCase(supabase, user.id, pkg)
        if (!caseId) {
          emit('error', { message: 'Error al registrar/actualizar la causa en la base de datos' })
          controller.close()
          return
        }

        // ────────────────────────────────────────────
        // PASO 4–5: CONSTRUIR TAREAS DE DESCARGA
        // ────────────────────────────────────────────
        emit('progress', { message: 'Calculando documentos a descargar…', current: 0, total: 0 })

        const pjud = new PjudClient()
        const downloadTasks = buildDownloadTasks(pkg)

        // ────────────────────────────────────────────
        // PASO 6: FETCH CUADERNOS ADICIONALES
        // ────────────────────────────────────────────
        const nonSelectedCount = (pkg.cuadernos?.filter(c => !c.selected) || []).length
        if (nonSelectedCount > 0) {
          emit('progress', {
            message: `Obteniendo ${nonSelectedCount} cuaderno(s) adicional(es)…`,
            current: 0,
            total: 0,
            cuaderno_current: 0,
            cuaderno_total: nonSelectedCount,
          })
        }

        const extraFolioTasks = await fetchOtherCuadernos(pjud, pkg, emit, nonSelectedCount)
        downloadTasks.push(...extraFolioTasks)

        const totalTasks = downloadTasks.length
        console.log(
          `[sync] ${pkg.rol} — ${totalTasks} PDFs a descargar ` +
          `(${pkg.folios?.length || 0} folios visibles + ` +
          `${extraFolioTasks.length} de otros cuadernos)`
        )

        if (totalTasks === 0) {
          emit('progress', { message: 'No se encontraron documentos para descargar.', current: 0, total: 0 })
        } else {
          emit('progress', { message: `${totalTasks} documento(s) a descargar`, current: 0, total: totalTasks })
        }

        // ────────────────────────────────────────────
        // PASO 7: DESCARGAR, DEDUP, UPLOAD, REGISTRAR
        // ────────────────────────────────────────────
        const results: SyncedDocument[] = []
        const errors: string[] = []
        let existingCount = 0
        let failedCount = 0

        for (let i = 0; i < downloadTasks.length; i++) {
          const task = downloadTasks[i]

          if (Date.now() - startTime > SYNC_TIMEOUT_MS) {
            errors.push('Timeout de sync alcanzado (5 min). Algunos documentos no se descargaron.')
            emit('progress', {
              message: 'Timeout alcanzado. Deteniendo sync.',
              current: i,
              total: totalTasks,
            })
            break
          }

          emit('progress', {
            message: `Descargando documento ${i + 1}/${totalTasks}: ${task.document_type || 'doc'}${task.folio ? ` folio ${task.folio}` : ''}${task.cuaderno ? ` (${task.cuaderno})` : ''}…`,
            current: i + 1,
            total: totalTasks,
          })

          try {
            const result = await processOneDocument(
              pjud, supabase, supabaseAdmin, user.id, caseId, task
            )
            if (result === 'duplicate') {
              existingCount++
            } else if (result === 'failed') {
              failedCount++
            } else {
              results.push(result)
            }
          } catch (err) {
            failedCount++
            const msg = err instanceof Error ? err.message : String(err)
            errors.push(`Folio ${task.folio ?? '?'}: ${msg}`)
            console.error(`[sync] Error procesando ${task.filename}:`, err)
          }
        }

        // ────────────────────────────────────────────
        // PASO 8: DATOS ADICIONALES (4.20)
        //   8a) Tabs data (notificaciones, escritos, exhortos, litigantes)
        //   8b) Receptor data (si jwt_receptor presente)
        // ────────────────────────────────────────────
        let tabsStored = false
        let receptorStored = false

        // 8a: Guardar tabs_data (ya extraído por JwtExtractor, sin request extra a PJUD)
        if (pkg.tabs && Object.keys(pkg.tabs).length > 0) {
          emit('progress', { message: 'Guardando datos tabulares (notificaciones, escritos, exhortos)…', current: totalTasks, total: totalTasks })

          const { error: tabsError } = await supabase
            .from('cases')
            .update({ tabs_data: pkg.tabs })
            .eq('id', caseId)

          if (tabsError) {
            console.warn('[sync] tabs_data update error:', tabsError.message)
          } else {
            tabsStored = true
            const nNotif = pkg.tabs.notificaciones?.length ?? 0
            const nEscr  = pkg.tabs.escritos_por_resolver?.length ?? 0
            const nExh   = pkg.tabs.exhortos?.length ?? 0
            console.log(
              `[sync] tabs_data guardados: ${nNotif} notif, ${nEscr} escritos, ${nExh} exhortos`
            )
          }
        }

        // 8b: Receptor — fetch HTML + parse + guardar
        if (pkg.jwt_receptor) {
          emit('progress', { message: 'Obteniendo datos del receptor…', current: totalTasks, total: totalTasks })

          try {
            const receptorHtml = await pjud.fetchReceptorHtml(
              pkg.jwt_receptor,
              pkg.csrf_token,
              pkg.cookies
            )

            if (receptorHtml) {
              const receptorData: ReceptorData = parseReceptorData(receptorHtml)

              const { error: receptorError } = await supabase
                .from('cases')
                .update({ receptor_data: receptorData })
                .eq('id', caseId)

              if (receptorError) {
                console.warn('[sync] receptor_data update error:', receptorError.message)
              } else {
                receptorStored = true
                console.log(
                  `[sync] receptor_data: ${receptorData.receptor_nombre ?? 'sin nombre'} — ` +
                  `${receptorData.certificaciones.length} cert, ${receptorData.diligencias.length} dilig`
                )
              }
            } else {
              console.warn('[sync] receptorCivil.php no retornó HTML útil')
            }
          } catch (receptorErr) {
            console.error('[sync] Error procesando receptor:', receptorErr)
          }
        }

        // ────────────────────────────────────────────
        // PASO 9: ACTUALIZAR CASE STATS
        // ────────────────────────────────────────────
        emit('progress', { message: 'Actualizando estadísticas de la causa…', current: totalTasks, total: totalTasks })

        const { count: docCount } = await supabase
          .from('documents')
          .select('id', { count: 'exact', head: true })
          .eq('case_id', caseId)

        await supabase
          .from('cases')
          .update({
            document_count: docCount ?? 0,
            last_synced_at: new Date().toISOString(),
          })
          .eq('id', caseId)

        // ────────────────────────────────────────────
        // PASO 10: TRIGGER PROCESAMIENTO ASYNC
        // ────────────────────────────────────────────
        const pipelineKey = process.env.PIPELINE_SECRET_KEY
        const appUrl =
          process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

        if (pipelineKey && results.length > 0) {
          for (const doc of results) {
            fetch(`${appUrl}/api/pipeline/process-document`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Pipeline-Key': pipelineKey,
              },
              body: JSON.stringify({ document_id: doc.document_id }),
            }).catch((err) => {
              console.warn(
                `[sync] Trigger async falló para doc ${doc.document_id}:`,
                err instanceof Error ? err.message : err
              )
            })
          }
        }

        // ────────────────────────────────────────────
        // PASO 11: EVENTO COMPLETE
        // ────────────────────────────────────────────
        const syncResult: SyncResult = {
          success: true,
          case_id: caseId,
          rol: pkg.rol,
          tribunal: pkg.tribunal,
          procedimiento: pkg.procedimiento,
          documents_new: results,
          documents_existing: existingCount,
          documents_failed: failedCount,
          total_downloaded: results.length,
          errors,
          duration_ms: Date.now() - startTime,
          tabs_stored: tabsStored,
          receptor_stored: receptorStored,
        }

        console.log(
          `[sync] ${pkg.rol} — Completado en ${syncResult.duration_ms}ms: ` +
          `${results.length} nuevos, ${existingCount} existentes, ${failedCount} fallidos`
        )

        emit('complete', syncResult)
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Error interno del servidor'
        console.error('[sync] Error fatal en stream:', error)
        emit('error', { message: msg })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, { status: 200, headers: sseHeaders })
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsOptions(request)
}

// ════════════════════════════════════════════════════════
// UPSERT CASE
// ════════════════════════════════════════════════════════

async function upsertCase(
  supabase: ReturnType<typeof createClientWithToken>,
  userId: string,
  pkg: CausaPackage
): Promise<string | null> {
  const tribunalNorm = pkg.tribunal || ''

  const { data: candidates } = await supabase
    .from('cases')
    .select('id, tribunal')
    .eq('user_id', userId)
    .eq('rol', pkg.rol)

  const existingCase = candidates?.find(
    (c) => (c.tribunal || '') === tribunalNorm
  )

  if (existingCase) {
    const updateData: Record<string, string | null | number> = {
      last_synced_at: new Date().toISOString(),
    }
    if (pkg.tribunal) updateData.tribunal = pkg.tribunal
    if (pkg.caratula) updateData.caratula = pkg.caratula
    if (pkg.materia) updateData.materia = pkg.materia
    if (pkg.procedimiento) updateData.procedimiento = pkg.procedimiento
    if (pkg.libro_tipo) updateData.libro_tipo = pkg.libro_tipo
    if (pkg.fuente) updateData.fuente_sync = pkg.fuente
    if (pkg.estado_adm) updateData.estado = pkg.estado_adm

    await supabase.from('cases').update(updateData).eq('id', existingCase.id)
    return existingCase.id
  }

  const newCase: CaseInsert = {
    user_id: userId,
    rol: pkg.rol,
    tribunal: pkg.tribunal,
    caratula: pkg.caratula,
    materia: pkg.materia,
    estado: pkg.estado_adm,
    last_synced_at: new Date().toISOString(),
  }

  const { data: created, error: caseError } = await supabase
    .from('cases')
    .insert(newCase)
    .select('id')
    .single()

  if (caseError) {
    if (
      caseError.message.includes('unique') ||
      caseError.message.includes('duplicate')
    ) {
      const { data: retry } = await supabase
        .from('cases')
        .select('id, tribunal')
        .eq('user_id', userId)
        .eq('rol', pkg.rol)

      const raceCase = retry?.find((c) => (c.tribunal || '') === tribunalNorm)
      if (raceCase) return raceCase.id
    }
    console.error('[sync] Error creando causa:', caseError)
    return null
  }

  // Update with the new columns (might not be in CaseInsert types yet)
  if (pkg.procedimiento || pkg.libro_tipo || pkg.fuente) {
    const extra: Record<string, string> = {}
    if (pkg.procedimiento) extra.procedimiento = pkg.procedimiento
    if (pkg.libro_tipo) extra.libro_tipo = pkg.libro_tipo
    if (pkg.fuente) extra.fuente_sync = pkg.fuente
    await supabase.from('cases').update(extra).eq('id', created.id)
  }

  return created.id
}

// ════════════════════════════════════════════════════════
// BUILD DOWNLOAD TASKS
// ════════════════════════════════════════════════════════

function buildDownloadTasks(pkg: CausaPackage): PdfDownloadTask[] {
  const tasks: PdfDownloadTask[] = []
  const selectedCuaderno =
    pkg.cuadernos?.find((c) => c.selected)?.nombre || 'Principal'

  // Direct documents
  if (pkg.jwt_texto_demanda) {
    tasks.push(jwtRefToTask(
      pkg.jwt_texto_demanda,
      `${pkg.rol}_texto_demanda.pdf`,
      'escrito',
      null,
      null,
      pkg.fecha_ingreso
    ))
  }

  if (pkg.jwt_certificado_envio) {
    tasks.push(jwtRefToTask(
      pkg.jwt_certificado_envio,
      `${pkg.rol}_certificado_envio.pdf`,
      'actuacion',
      null,
      null,
      pkg.fecha_ingreso
    ))
  }

  if (pkg.jwt_ebook) {
    tasks.push(jwtRefToTask(
      pkg.jwt_ebook,
      `${pkg.rol}_ebook.pdf`,
      'otro',
      null,
      null,
      null
    ))
  }

  // Visible cuaderno folios
  if (pkg.folios) {
    for (const folio of pkg.folios) {
      const folioTasks = folioToTasks(folio, pkg.rol, selectedCuaderno)
      tasks.push(...folioTasks)
    }
  }

  return tasks
}

function jwtRefToTask(
  ref: JwtRef,
  filename: string,
  docType: string,
  folio: number | null,
  cuaderno: string | null,
  fecha: string | null
): PdfDownloadTask {
  return {
    jwt: ref.jwt,
    endpoint: ref.action,
    param: ref.param,
    filename,
    document_type: docType,
    folio,
    cuaderno,
    fecha,
    source_url: ref.action,
  }
}

function folioToTasks(
  folio: Folio,
  rol: string,
  cuaderno: string
): PdfDownloadTask[] {
  const tasks: PdfDownloadTask[] = []
  const cleanTramite = (folio.tramite || 'doc')
    .replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ\s]/g, '')
    .trim()
    .substring(0, 30)
    .replace(/\s+/g, '_')

  const docType = inferDocType(folio.tramite)

  if (folio.jwt_doc_principal) {
    tasks.push({
      jwt: folio.jwt_doc_principal.jwt,
      endpoint: folio.jwt_doc_principal.action,
      param: folio.jwt_doc_principal.param,
      filename: `${rol}_f${folio.numero}_${cleanTramite}.pdf`,
      document_type: docType,
      folio: folio.numero,
      cuaderno,
      fecha: folio.fecha_tramite,
      source_url: folio.jwt_doc_principal.action,
    })
  }

  if (folio.jwt_certificado_escrito) {
    tasks.push({
      jwt: folio.jwt_certificado_escrito.jwt,
      endpoint: folio.jwt_certificado_escrito.action,
      param: folio.jwt_certificado_escrito.param,
      filename: `${rol}_f${folio.numero}_cert_escrito.pdf`,
      document_type: 'actuacion',
      folio: folio.numero,
      cuaderno,
      fecha: folio.fecha_tramite,
      source_url: folio.jwt_certificado_escrito.action,
    })
  }

  return tasks
}

function inferDocType(tramite: string): string {
  const t = (tramite || '').toUpperCase()
  if (/RESOLUCI[OÓ]N|AUTO|SENTENCIA|DECRETO/i.test(t)) return 'resolucion'
  if (/ESCRITO|DEMANDA|CONTESTACI|RECURSO|APELACI/i.test(t)) return 'escrito'
  if (/ACTUACI[OÓ]N|RECEPTOR|DILIGENCIA/i.test(t)) return 'actuacion'
  if (/NOTIFICACI[OÓ]N|C[ÉE]DULA|CARTA/i.test(t)) return 'notificacion'
  return 'otro'
}

// ════════════════════════════════════════════════════════
// FETCH OTHER CUADERNOS
// ════════════════════════════════════════════════════════

async function fetchOtherCuadernos(
  pjud: PjudClient,
  pkg: CausaPackage,
  emit?: SseEmitter,
  totalCuadernos?: number,
): Promise<PdfDownloadTask[]> {
  const tasks: PdfDownloadTask[] = []

  if (!pkg.cuadernos || pkg.cuadernos.length <= 1 || !pkg.csrf_token) {
    return tasks
  }

  const nonSelected = pkg.cuadernos.filter((c) => !c.selected)
  const total = totalCuadernos ?? nonSelected.length

  for (let idx = 0; idx < nonSelected.length; idx++) {
    const cuaderno = nonSelected[idx]
    try {
      console.log(`[sync] Fetching cuaderno "${cuaderno.nombre}" via causaCivil.php...`)

      emit?.('progress', {
        message: `Obteniendo cuaderno ${idx + 1}/${total}: ${cuaderno.nombre}…`,
        current: 0,
        total: 0,
        cuaderno_current: idx + 1,
        cuaderno_total: total,
      })

      const html = await pjud.fetchCuadernoHtml(
        cuaderno.jwt,
        pkg.csrf_token,
        pkg.cookies
      )

      if (!html) {
        console.warn(`[sync] No se pudo obtener cuaderno "${cuaderno.nombre}" — skipping`)
        continue
      }

      const folios = parseFoliosFromHtml(html)
      console.log(`[sync] Cuaderno "${cuaderno.nombre}": ${folios.length} folios encontrados`)

      for (const folio of folios) {
        const folioTasks = folioToTasks(folio, pkg.rol, cuaderno.nombre)
        tasks.push(...folioTasks)
      }
    } catch (err) {
      console.error(`[sync] Error fetching cuaderno "${cuaderno.nombre}":`, err)
    }
  }

  return tasks
}

// ════════════════════════════════════════════════════════
// PROCESS ONE DOCUMENT (download → dedup → upload → register)
// ════════════════════════════════════════════════════════

async function processOneDocument(
  pjud: PjudClient,
  supabase: ReturnType<typeof createClientWithToken>,
  supabaseAdmin: ReturnType<typeof createAdminClient>,
  userId: string,
  caseId: string,
  task: PdfDownloadTask
): Promise<SyncedDocument | 'duplicate' | 'failed'> {
  // 1. Download PDF from PJUD
  const pdf = await pjud.downloadPdf(task.endpoint, task.param, task.jwt)
  if (!pdf) return 'failed'

  if (pdf.buffer.length > MAX_FILE_SIZE) {
    console.warn(`[sync] PDF too large: ${pdf.buffer.length} bytes — ${task.filename}`)
    return 'failed'
  }

  // 2. SHA-256 hash
  const fileHash = createHash('sha256').update(pdf.buffer).digest('hex')

  // 3. Check dedup
  const { data: existingHash } = await supabase
    .from('document_hashes')
    .select('id')
    .eq('user_id', userId)
    .eq('hash', fileHash)
    .maybeSingle()

  if (existingHash) return 'duplicate'

  // 4. Upload to Supabase Storage
  const now = new Date()
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const sanitizedName = task.filename.replace(/[^a-zA-Z0-9._-]/g, '_')
  const uniqueId = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
  const storagePath = `${userId}/${yearMonth}/${uniqueId}_${sanitizedName}`

  const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET_NAME)
    .upload(storagePath, pdf.buffer, {
      contentType: 'application/pdf',
      cacheControl: '3600',
      upsert: false,
      duplex: 'half',
      metadata: {
        owner: userId,
        sync_source: 'api_sync',
        uploaded_at: now.toISOString(),
      },
    })

  if (uploadError) {
    console.error(`[sync] Storage upload failed for ${task.filename}:`, uploadError)
    return 'failed'
  }

  // 5. Insert document record
  const newDoc: DocumentInsert = {
    case_id: caseId,
    user_id: userId,
    filename: sanitizedName,
    original_filename: task.filename,
    storage_path: uploadData.path,
    document_type: task.document_type,
    file_size: pdf.buffer.length,
    file_hash: fileHash,
    source: 'sync',
    source_url: task.source_url || null,
    captured_at: now.toISOString(),
  }

  const { data: createdDoc, error: docError } = await supabase
    .from('documents')
    .insert(newDoc)
    .select('id')
    .single()

  if (docError) {
    console.error(`[sync] Document insert failed for ${task.filename}:`, docError)
    return 'failed'
  }

  // 6. Insert hash for dedup
  const newHash: DocumentHashInsert = {
    user_id: userId,
    rol: task.filename.split('_')[0] || 'sin_rol',
    case_id: caseId,
    hash: fileHash,
    filename: sanitizedName,
    document_type: task.document_type,
  }

  const { error: hashError } = await supabase
    .from('document_hashes')
    .insert(newHash)

  if (hashError && !hashError.message.includes('unique') && !hashError.message.includes('duplicate')) {
    console.error(`[sync] Hash insert error for ${task.filename}:`, hashError)
  }

  // 7. Create extracted_texts placeholder (processing queue handles the rest)
  const placeholder: ExtractedTextInsert = {
    document_id: createdDoc.id,
    case_id: caseId,
    user_id: userId,
    status: 'pending',
  }

  const { error: placeholderError } = await supabase
    .from('extracted_texts')
    .upsert(placeholder, { onConflict: 'document_id' })

  if (placeholderError) {
    console.error(`[sync] Placeholder error for ${task.filename}:`, placeholderError)
  }

  return {
    document_id: createdDoc.id,
    filename: sanitizedName,
    document_type: task.document_type,
    folio: task.folio,
    cuaderno: task.cuaderno,
    fecha: task.fecha,
    storage_path: uploadData.path,
    is_new: true,
  }
}
