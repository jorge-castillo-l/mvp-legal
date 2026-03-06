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
import { mergeTabsData, parseAnexosFromHtml, parseExhortoDetalleFromHtml, parseFoliosFromHtml, parseReceptorData, parseTabsFromHtml } from '@/lib/pjud/parser'
import type {
  AnexoFile,
  CausaPackage,
  ExhortoDetalleDoc,
  PdfDownloadTask,
  SyncResult,
  SyncChange,
  SyncSnapshot,
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
    (pkg.cuadernos && pkg.cuadernos.length > 0) ||
    (pkg.tabs?.exhortos?.some((e) => e.jwt_detalle))

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
        // PASO 3b: LEER SNAPSHOT PREVIO (para diff)
        // ────────────────────────────────────────────
        let prevSnapshot: SyncSnapshot | null = null
        try {
          const { data: snapRow } = await supabase
            .from('cases')
            .select('sync_snapshot')
            .eq('id', caseId)
            .single()
          if (snapRow?.sync_snapshot) {
            prevSnapshot = snapRow.sync_snapshot as SyncSnapshot
          }
        } catch {
          // First sync — no snapshot
        }
        const isFirstSync = !prevSnapshot

        // Collectors for the new snapshot
        const snapshotCuadernos: SyncSnapshot['cuadernos'] = []
        const snapshotAnexos: SyncSnapshot['anexos'] = []
        const snapshotExhortos: SyncSnapshot['exhortos'] = []
        let snapshotReceptorRetiros: SyncSnapshot['receptor_retiros'] = []

        // ────────────────────────────────────────────
        // PASO 4–5: CONSTRUIR TAREAS DE DESCARGA
        // ────────────────────────────────────────────
        emit('progress', { message: 'Calculando documentos a descargar…', current: 0, total: 0 })

        const pjud = new PjudClient()
        pjud.setCookies(pkg.cookies)
        const downloadTasks = buildDownloadTasks(pkg)

        // Snapshot: folios del cuaderno visible
        const selectedCuadernoName = pkg.cuadernos?.find(c => c.selected)?.nombre || 'Principal'
        if (pkg.folios && pkg.folios.length > 0) {
          snapshotCuadernos.push({
            nombre: selectedCuadernoName,
            folio_count: pkg.folios.length,
            folio_numeros: pkg.folios.map(f => f.numero),
          })
        }

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

        const extraFolioTasks = await fetchOtherCuadernos(pjud, pkg, emit, nonSelectedCount, snapshotCuadernos)
        downloadTasks.push(...extraFolioTasks)

        // ────────────────────────────────────────────
        // PASO 6b: FETCH ANEXOS DE LA CAUSA
        // ────────────────────────────────────────────
        const anexosTasks = await fetchAnexos(pjud, pkg, emit, snapshotAnexos)
        downloadTasks.push(...anexosTasks)

        // ────────────────────────────────────────────
        // PASO 6c: FETCH DOCUMENTOS DE EXHORTOS
        // ────────────────────────────────────────────
        const exhortoDocTasks = await fetchExhortoDocuments(pjud, pkg, emit, snapshotExhortos)
        downloadTasks.push(...exhortoDocTasks)

        // ────────────────────────────────────────────
        // PASO 6d: DOCUMENTOS DE ESCRITOS POR RESOLVER
        // ────────────────────────────────────────────
        const escritosTasks = buildEscritosDownloadTasks(pkg)
        downloadTasks.push(...escritosTasks)

        // ────────────────────────────────────────────
        // PASO 6e: ANEXOS POR FOLIO (anexoSolicitudCivil)
        // ────────────────────────────────────────────
        const folioAnexoTasks = await fetchFolioAnexos(pjud, pkg, emit)
        downloadTasks.push(...folioAnexoTasks)

        const totalTasks = downloadTasks.length
        console.log(
          `[sync] ${pkg.rol} — ${totalTasks} PDFs a descargar ` +
          `(${pkg.folios?.length || 0} folios visibles + ` +
          `${extraFolioTasks.length} de otros cuadernos + ` +
          `${anexosTasks.length} anexos + ` +
          `${exhortoDocTasks.length} docs exhortos + ` +
          `${escritosTasks.length} escritos + ` +
          `${folioAnexoTasks.length} anexos solicitud)`
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
              pjud, supabase, supabaseAdmin, user.id, caseId, task,
              { rol: pkg.rol, tribunal: pkg.tribunal, caratula: pkg.caratula },
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
        // PASO 8: DATOS ADICIONALES (4.20 + exhortos)
        //   8a) Causa origen (para causas tipo E)
        //   8b) Tabs data (notificaciones, escritos, exhortos con jwt_detalle, litigantes)
        //   8c) Receptor data (si jwt_receptor presente)
        // ────────────────────────────────────────────
        let tabsStored = false
        let receptorStored = false
        let causaOrigenStored = false

        // 8a: Guardar causa_origen (causas tipo E → referencia a la C de origen)
        if (pkg.exhorto?.causa_origen) {
          const { error: origenError } = await supabase
            .from('cases')
            .update({
              causa_origen_rol: pkg.exhorto.causa_origen,
              causa_origen_tribunal: pkg.exhorto.tribunal_origen,
            })
            .eq('id', caseId)

          if (origenError) {
            console.warn('[sync] causa_origen update error:', origenError.message)
          } else {
            causaOrigenStored = true
            console.log(
              `[sync] causa_origen guardada: ${pkg.exhorto.causa_origen} — ${pkg.exhorto.tribunal_origen}`
            )
          }
        }

        // 8b: Guardar tabs_data (ya extraído por JwtExtractor, sin request extra a PJUD)
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

        // 8c: Receptor — fetch HTML + parse + guardar
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
                snapshotReceptorRetiros = receptorData.retiros.map(r => ({
                  cuaderno: r.cuaderno,
                  fecha_retiro: r.fecha_retiro,
                  estado: r.estado,
                }))
                console.log(
                  `[sync] receptor_data: ${receptorData.receptor_nombre ?? 'sin nombre'} — ` +
                  `${receptorData.retiros.length} retiro(s)`
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
        // PASO 9: GENERAR SNAPSHOT + DIFF
        // ────────────────────────────────────────────
        const newSnapshot: SyncSnapshot = {
          cuadernos: snapshotCuadernos,
          anexos: snapshotAnexos,
          exhortos: snapshotExhortos,
          receptor_retiros: snapshotReceptorRetiros,
          metadata: {
            estado: pkg.estado_adm || '',
            estado_procesal: pkg.estado_procesal || '',
            etapa: pkg.etapa || '',
            ubicacion: pkg.ubicacion || '',
            procedimiento: pkg.procedimiento || '',
          },
          tabs_counts: {
            litigantes: pkg.tabs?.litigantes?.length ?? 0,
            notificaciones: pkg.tabs?.notificaciones?.length ?? 0,
            escritos_por_resolver: pkg.tabs?.escritos_por_resolver?.length ?? 0,
            exhortos: pkg.tabs?.exhortos?.length ?? 0,
          },
          snapshot_at: new Date().toISOString(),
        }

        const changes: SyncChange[] = isFirstSync ? [] : generateDiff(prevSnapshot!, newSnapshot)

        // ────────────────────────────────────────────
        // PASO 10: ACTUALIZAR CASE STATS + SNAPSHOT
        // ────────────────────────────────────────────
        emit('progress', { message: 'Actualizando estadísticas…', current: totalTasks, total: totalTasks })

        const { count: docCount } = await supabase
          .from('documents')
          .select('id', { count: 'exact', head: true })
          .eq('case_id', caseId)

        await supabase
          .from('cases')
          .update({
            document_count: docCount ?? 0,
            last_synced_at: new Date().toISOString(),
            sync_snapshot: newSnapshot,
          })
          .eq('id', caseId)

        // ────────────────────────────────────────────
        // PASO 11: TRIGGER PROCESAMIENTO ASYNC
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
        // PASO 12: EVENTO COMPLETE
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
          causa_origen_stored: causaOrigenStored,
          exhortos_count: pkg.tabs?.exhortos?.length ?? 0,
          exhortos_docs_downloaded: exhortoDocTasks.length,
          changes,
          is_first_sync: isFirstSync,
        }

        console.log(
          `[sync] ${pkg.rol} — Completado en ${syncResult.duration_ms}ms: ` +
          `${results.length} nuevos, ${existingCount} existentes, ${failedCount} fallidos` +
          (changes.length > 0 ? ` | ${changes.length} cambio(s) detectado(s)` : '')
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
    if (pkg.etapa) updateData.etapa = pkg.etapa
    if (pkg.ubicacion) updateData.ubicacion = pkg.ubicacion
    if (pkg.fecha_ingreso) updateData.fecha_ingreso = pkg.fecha_ingreso
    if (pkg.estado_procesal) updateData.estado_procesal = pkg.estado_procesal

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
    etapa: pkg.etapa,
    ubicacion: pkg.ubicacion,
    fecha_ingreso: pkg.fecha_ingreso,
    estado_procesal: pkg.estado_procesal,
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

  const folioMeta: import('@/lib/pjud/types').FolioMetadata = {
    folio_numero: folio.numero,
    etapa: folio.etapa || null,
    tramite: folio.tramite || null,
    desc_tramite: folio.desc_tramite || null,
    fecha_tramite: folio.fecha_tramite || null,
    foja: folio.foja || null,
    cuaderno,
    source_tab: folio._source === 'piezas_exhorto' ? 'piezas_exhorto' : 'historia',
  }

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
      folio_metadata: folioMeta,
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
      folio_metadata: folioMeta,
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
  snapshotCuadernos?: SyncSnapshot['cuadernos'],
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

      snapshotCuadernos?.push({
        nombre: cuaderno.nombre,
        folio_count: folios.length,
        folio_numeros: folios.map(f => f.numero),
      })

      for (const folio of folios) {
        const folioTasks = folioToTasks(folio, pkg.rol, cuaderno.nombre)
        tasks.push(...folioTasks)
      }

      // Also parse and merge tabs from this cuaderno (Gap 6)
      if (pkg.tabs) {
        try {
          const cuadernoTabs = parseTabsFromHtml(html)
          const merged = mergeTabsData(pkg.tabs, cuadernoTabs)
          pkg.tabs = merged
          const newRows =
            (merged.notificaciones.length - (pkg.tabs.notificaciones?.length ?? 0)) +
            (merged.escritos_por_resolver.length - (pkg.tabs.escritos_por_resolver?.length ?? 0))
          if (newRows > 0) {
            console.log(`[sync] Cuaderno "${cuaderno.nombre}": ${newRows} filas nuevas en tabs`)
          }
        } catch {
          // Tab parsing failed for this cuaderno — continue with folios
        }
      }
    } catch (err) {
      console.error(`[sync] Error fetching cuaderno "${cuaderno.nombre}":`, err)
    }
  }

  return tasks
}

// ════════════════════════════════════════════════════════
// FETCH ANEXOS DE LA CAUSA
// ════════════════════════════════════════════════════════

async function fetchAnexos(
  pjud: PjudClient,
  pkg: CausaPackage,
  emit?: SseEmitter,
  snapshotAnexos?: SyncSnapshot['anexos'],
): Promise<PdfDownloadTask[]> {
  const tasks: PdfDownloadTask[] = []

  if (!pkg.jwt_anexos) return tasks

  try {
    emit?.('progress', {
      message: 'Obteniendo anexos de la causa…',
      current: 0,
      total: 0,
    })

    console.log(`[sync] Fetching anexos via anexoCausaCivil.php...`)

    const html = await pjud.fetchAnexosHtml(pkg.jwt_anexos, pkg.cookies)

    if (!html) {
      console.warn('[sync] anexoCausaCivil.php no retornó HTML útil')
      return tasks
    }

    const anexos: AnexoFile[] = parseAnexosFromHtml(html)
    console.log(`[sync] Anexos de la causa: ${anexos.length} archivo(s) encontrado(s)`)

    for (const a of anexos) {
      snapshotAnexos?.push({ fecha: a.fecha || '', referencia: a.referencia || '' })
    }

    for (let i = 0; i < anexos.length; i++) {
      const anexo = anexos[i]
      const cleanRef = (anexo.referencia || `anexo_${i + 1}`)
        .replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ\s]/g, '')
        .trim()
        .substring(0, 30)
        .replace(/\s+/g, '_')

      tasks.push({
        jwt: anexo.jwt.jwt,
        endpoint: anexo.jwt.action,
        param: anexo.jwt.param,
        filename: `${pkg.rol}_anexo_${i + 1}_${cleanRef}.pdf`,
        document_type: 'anexo',
        folio: null,
        cuaderno: null,
        fecha: anexo.fecha || null,
        source_url: anexo.jwt.action,
        referencia: anexo.referencia || undefined,
      })
    }
  } catch (err) {
    console.error('[sync] Error fetching anexos:', err)
  }

  return tasks
}

// ════════════════════════════════════════════════════════
// ESCRITOS POR RESOLVER DOWNLOAD TASKS
// ════════════════════════════════════════════════════════

function buildEscritosDownloadTasks(pkg: CausaPackage): PdfDownloadTask[] {
  const tasks: PdfDownloadTask[] = []
  const escritos = pkg.tabs?.escritos_por_resolver ?? []

  for (let i = 0; i < escritos.length; i++) {
    const escrito = escritos[i]
    if (!escrito.jwt_doc) continue

    const cleanTipo = (escrito.tipo_escrito || `escrito_${i + 1}`)
      .replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ\s]/g, '')
      .trim()
      .substring(0, 30)
      .replace(/\s+/g, '_')

    tasks.push({
      jwt: escrito.jwt_doc.jwt,
      endpoint: escrito.jwt_doc.action,
      param: escrito.jwt_doc.param,
      filename: `${pkg.rol}_escrito_${i + 1}_${cleanTipo}.pdf`,
      document_type: 'escrito',
      folio: null,
      cuaderno: null,
      fecha: escrito.fecha_ingreso || null,
      source_url: escrito.jwt_doc.action,
    })
  }

  return tasks
}

// ════════════════════════════════════════════════════════
// FETCH PER-FOLIO ANEXOS (anexoSolicitudCivil)
// ════════════════════════════════════════════════════════

async function fetchFolioAnexos(
  pjud: PjudClient,
  pkg: CausaPackage,
  emit?: SseEmitter,
): Promise<PdfDownloadTask[]> {
  const tasks: PdfDownloadTask[] = []

  const foliosWithAnexos = (pkg.folios ?? []).filter((f) => f.jwt_anexo_solicitud)
  if (foliosWithAnexos.length === 0) return tasks

  emit?.('progress', {
    message: `Obteniendo anexos de ${foliosWithAnexos.length} folio(s)…`,
    current: 0,
    total: 0,
  })

  for (const folio of foliosWithAnexos) {
    try {
      console.log(`[sync] Fetching anexo solicitud for folio ${folio.numero}...`)

      const html = await pjud.fetchAnexoSolicitudHtml(
        folio.jwt_anexo_solicitud!,
        pkg.cookies
      )

      if (!html) {
        console.warn(`[sync] anexoSolicitudCivil.php no retornó HTML útil para folio ${folio.numero}`)
        continue
      }

      const anexos: AnexoFile[] = parseAnexosFromHtml(html)
      console.log(`[sync] Folio ${folio.numero}: ${anexos.length} anexo(s) de solicitud`)

      for (let i = 0; i < anexos.length; i++) {
        const anexo = anexos[i]
        const cleanRef = (anexo.referencia || `anexo_${i + 1}`)
          .replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ\s]/g, '')
          .trim()
          .substring(0, 30)
          .replace(/\s+/g, '_')

        tasks.push({
          jwt: anexo.jwt.jwt,
          endpoint: anexo.jwt.action,
          param: anexo.jwt.param,
          filename: `${pkg.rol}_f${folio.numero}_anexo_${i + 1}_${cleanRef}.pdf`,
          document_type: 'anexo',
          folio: folio.numero,
          cuaderno: null,
          fecha: anexo.fecha || null,
          source_url: anexo.jwt.action,
          referencia: anexo.referencia || undefined,
        })
      }
    } catch (err) {
      console.error(`[sync] Error fetching anexo solicitud for folio ${folio.numero}:`, err)
    }
  }

  return tasks
}

// ════════════════════════════════════════════════════════
// FETCH EXHORTO DOCUMENTS
// ════════════════════════════════════════════════════════

async function fetchExhortoDocuments(
  pjud: PjudClient,
  pkg: CausaPackage,
  emit?: SseEmitter,
  snapshotExhortos?: SyncSnapshot['exhortos'],
): Promise<PdfDownloadTask[]> {
  const tasks: PdfDownloadTask[] = []

  const exhortos = pkg.tabs?.exhortos?.filter((e) => e.jwt_detalle) ?? []
  if (exhortos.length === 0) return tasks

  emit?.('progress', {
    message: `Obteniendo documentos de ${exhortos.length} exhorto(s)…`,
    current: 0,
    total: 0,
  })

  for (let idx = 0; idx < exhortos.length; idx++) {
    const exhorto = exhortos[idx]
    const rolDestino = exhorto.rol_destino || `exhorto_${idx + 1}`

    try {
      console.log(`[sync] Fetching exhorto detalle "${rolDestino}" via detalleExhortosCivil.php...`)

      emit?.('progress', {
        message: `Obteniendo exhorto ${idx + 1}/${exhortos.length}: ${rolDestino}…`,
        current: 0,
        total: 0,
      })

      const html = await pjud.fetchExhortoDetalleHtml(
        exhorto.jwt_detalle!,
        pkg.cookies
      )

      if (!html) {
        console.warn(`[sync] detalleExhortosCivil.php no retornó HTML útil para "${rolDestino}"`)
        continue
      }

      const docs: ExhortoDetalleDoc[] = parseExhortoDetalleFromHtml(html)
      console.log(`[sync] Exhorto "${rolDestino}": ${docs.length} documento(s) encontrado(s)`)

      snapshotExhortos?.push({
        rol_destino: rolDestino,
        estado: exhorto.estado_exhorto || '',
        doc_count: docs.length,
      })

      for (let i = 0; i < docs.length; i++) {
        const doc = docs[i]
        const cleanRef = (doc.referencia || `doc_${i + 1}`)
          .replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ\s]/g, '')
          .trim()
          .substring(0, 40)
          .replace(/\s+/g, '_')

        const cleanRolDestino = rolDestino
          .replace(/[^a-zA-Z0-9-]/g, '')
          .trim()

        tasks.push({
          jwt: doc.jwt.jwt,
          endpoint: doc.jwt.action,
          param: doc.jwt.param,
          filename: `${pkg.rol}_exh_${cleanRolDestino}_${i + 1}_${cleanRef}.pdf`,
          document_type: inferDocType(doc.tramite),
          folio: null,
          cuaderno: null,
          fecha: doc.fecha || null,
          source_url: doc.jwt.action,
          folio_metadata: {
            folio_numero: null,
            etapa: null,
            tramite: doc.tramite || null,
            desc_tramite: doc.referencia || null,
            fecha_tramite: doc.fecha || null,
            foja: null,
            cuaderno: `Exhorto ${cleanRolDestino}`,
          },
        })
      }
    } catch (err) {
      console.error(`[sync] Error fetching exhorto detalle "${rolDestino}":`, err)
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
  task: PdfDownloadTask,
  causaMeta: { rol: string; tribunal?: string; caratula?: string },
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
  const docMetadata: Record<string, unknown> = {
    ...(task.folio_metadata ?? {}),
  }
  if (task.fecha) docMetadata.fecha_documento = task.fecha
  if (task.referencia) docMetadata.referencia = task.referencia

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
    metadata: docMetadata,
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
    rol: causaMeta.rol,
    case_id: caseId,
    hash: fileHash,
    filename: sanitizedName,
    document_type: task.document_type,
    tribunal: causaMeta.tribunal || null,
    caratula: causaMeta.caratula || null,
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

// ════════════════════════════════════════════════════════
// DIFF ENGINE — compara snapshot previo vs actual
// ════════════════════════════════════════════════════════

function generateDiff(prev: SyncSnapshot, curr: SyncSnapshot): SyncChange[] {
  const changes: SyncChange[] = []

  // ── Metadata ──
  const metaLabels: Record<string, string> = {
    estado: 'Estado Adm.',
    estado_procesal: 'Estado Procesal',
    etapa: 'Etapa',
    ubicacion: 'Ubicación',
    procedimiento: 'Procedimiento',
  }
  for (const [key, label] of Object.entries(metaLabels)) {
    const oldVal = (prev.metadata[key as keyof typeof prev.metadata] || '').trim()
    const newVal = (curr.metadata[key as keyof typeof curr.metadata] || '').trim()
    if (newVal && oldVal !== newVal) {
      changes.push({
        category: 'metadata',
        description: oldVal
          ? `${label}: ${oldVal} → ${newVal}`
          : `${label}: ${newVal}`,
      })
    }
  }

  // ── Cuadernos nuevos ──
  const prevCuadernoNames = new Set(prev.cuadernos.map(c => c.nombre))
  for (const c of curr.cuadernos) {
    if (!prevCuadernoNames.has(c.nombre)) {
      changes.push({
        category: 'cuaderno',
        description: `Cuaderno nuevo: ${c.nombre} (${c.folio_count} folios)`,
      })
    }
  }

  // ── Folios nuevos por cuaderno ──
  const prevCuadernoMap = new Map(prev.cuadernos.map(c => [c.nombre, new Set(c.folio_numeros)]))
  for (const c of curr.cuadernos) {
    const prevFolios = prevCuadernoMap.get(c.nombre)
    if (!prevFolios) continue
    const newFolios = c.folio_numeros.filter(n => !prevFolios.has(n))
    if (newFolios.length > 0) {
      const folioList = newFolios.length <= 3
        ? newFolios.join(', ')
        : `${newFolios.slice(0, 3).join(', ')}… (+${newFolios.length - 3})`
      changes.push({
        category: 'folio',
        description: `${newFolios.length} folio(s) nuevo(s) en ${c.nombre}: ${folioList}`,
      })
    }
  }

  // ── Anexos nuevos ──
  const prevAnexoKeys = new Set(prev.anexos.map(a => `${a.fecha}|${a.referencia}`))
  const newAnexos = curr.anexos.filter(a => !prevAnexoKeys.has(`${a.fecha}|${a.referencia}`))
  if (newAnexos.length > 0) {
    for (const a of newAnexos) {
      changes.push({
        category: 'anexo',
        description: `Anexo nuevo: ${a.referencia || a.fecha || 'sin referencia'}`,
      })
    }
  }

  // ── Exhortos: estado cambiado + documentos nuevos ──
  const prevExhortoMap = new Map(prev.exhortos.map(e => [e.rol_destino, e]))
  for (const e of curr.exhortos) {
    const pe = prevExhortoMap.get(e.rol_destino)
    if (!pe) {
      changes.push({
        category: 'exhorto',
        description: `Exhorto nuevo: ${e.rol_destino} (${e.estado}, ${e.doc_count} docs)`,
      })
      continue
    }
    if (pe.estado && e.estado && pe.estado !== e.estado) {
      changes.push({
        category: 'exhorto',
        description: `Exhorto ${e.rol_destino}: ${pe.estado} → ${e.estado}`,
      })
    }
    if (e.doc_count > pe.doc_count) {
      changes.push({
        category: 'exhorto',
        description: `${e.doc_count - pe.doc_count} doc(s) nuevo(s) en exhorto ${e.rol_destino}`,
      })
    }
  }

  // ── Receptor retiros nuevos ──
  const prevRetiroKeys = new Set(prev.receptor_retiros.map(r => `${r.cuaderno}|${r.fecha_retiro}|${r.estado}`))
  const newRetiros = curr.receptor_retiros.filter(r => !prevRetiroKeys.has(`${r.cuaderno}|${r.fecha_retiro}|${r.estado}`))
  if (newRetiros.length > 0) {
    changes.push({
      category: 'receptor',
      description: `${newRetiros.length} retiro(s) nuevo(s) del receptor`,
    })
  }

  // ── Tabs: conteos ──
  const tabLabels: Record<string, string> = {
    litigantes: 'Litigantes',
    notificaciones: 'Notificaciones',
    escritos_por_resolver: 'Escritos por Resolver',
    exhortos: 'Exhortos',
  }
  for (const [key, label] of Object.entries(tabLabels)) {
    const oldCount = prev.tabs_counts[key as keyof typeof prev.tabs_counts] || 0
    const newCount = curr.tabs_counts[key as keyof typeof curr.tabs_counts] || 0
    if (newCount > oldCount) {
      changes.push({
        category: 'tab',
        description: `${newCount - oldCount} nuevo(s) en ${label}`,
      })
    }
  }

  return changes
}
