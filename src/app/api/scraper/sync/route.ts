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
import { mergeTabsData, parseAnexosFromHtml, parseApelacionFromHtml, parseExhortoDetalleFromHtml, parseFoliosFromHtml, parseReceptorData, parseTabsFromHtml } from '@/lib/pjud/parser'
import type {
  AnexoFile,
  ApelacionDetail,
  CausaPackage,
  ExhortoDetalleDoc,
  PdfDownloadTask,
  RemisionEntry,
  StoredRemisionDetail,
  SyncResult,
  SyncChange,
  SyncSnapshot,
  SyncedDocument,
  TabsData,
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
    (pkg.tabs?.exhortos?.some((e) => e.jwt_detalle)) ||
    (pkg.remisiones && pkg.remisiones.length > 0)

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

  const isResume = !!pkg.resume_case_id

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = createSseEmitter(controller)
      const startTime = Date.now()

      try {
        const supabase = createClientWithToken(token)
        const supabaseAdmin = createAdminClient()

        let caseId: string
        let prevSnapshot: SyncSnapshot | null = null
        let isFirstSync: boolean
        const downloadTasks: PdfDownloadTask[] = []

        const snapshotCuadernos: SyncSnapshot['cuadernos'] = []
        const snapshotAnexos: SyncSnapshot['anexos'] = []
        const snapshotExhortos: SyncSnapshot['exhortos'] = []
        let snapshotReceptorRetiros: SyncSnapshot['receptor_retiros'] = []
        const snapshotRemisiones: SyncSnapshot['remisiones'] = []
        const fullRemisionesData: StoredRemisionDetail[] = []

        const pjud = new PjudClient()
        pjud.setCookies(pkg.cookies)

        if (isResume) {
          // ────────────────────────────────────────────
          // RESUME: Leer pending tasks de la DB
          // ────────────────────────────────────────────
          caseId = pkg.resume_case_id!
          emit('progress', { message: 'Retomando descarga pendiente…', current: 0, total: 0 })
          console.log(`[sync] RESUME for case ${caseId}`)

          const { data: caseRow } = await supabase
            .from('cases')
            .select('sync_snapshot, pending_sync_tasks')
            .eq('id', caseId)
            .eq('user_id', user.id)
            .single()

          if (!caseRow?.pending_sync_tasks || !Array.isArray(caseRow.pending_sync_tasks) || caseRow.pending_sync_tasks.length === 0) {
            emit('complete', {
              success: true, case_id: caseId, rol: pkg.rol,
              documents_new: [], documents_existing: 0, documents_failed: 0,
              total_downloaded: 0, errors: [], duration_ms: Date.now() - startTime,
              has_pending: false, pending_count: 0,
              changes: [], is_first_sync: false,
            } as unknown as SyncResult)
            controller.close()
            return
          }

          prevSnapshot = (caseRow.sync_snapshot as SyncSnapshot) || null
          isFirstSync = !prevSnapshot
          downloadTasks.push(...(caseRow.pending_sync_tasks as PdfDownloadTask[]))

          console.log(`[sync] RESUME: ${downloadTasks.length} pending tasks loaded`)
          emit('progress', { message: 'Retomando descarga de documentos…', current: 0, total: downloadTasks.length })

        } else {
          // ────────────────────────────────────────────
          // NORMAL: Pipeline completo (pasos 3-6)
          // ────────────────────────────────────────────
          emit('progress', { message: 'Registrando causa…', current: 0, total: 0 })

          const upsertedId = await upsertCase(supabase, user.id, pkg)
          if (!upsertedId) {
            emit('error', { message: 'Error al registrar/actualizar la causa en la base de datos' })
            controller.close()
            return
          }
          caseId = upsertedId

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
          isFirstSync = !prevSnapshot

          emit('progress', { message: 'Calculando documentos a descargar…', current: 0, total: 0 })

          const initialTasks = buildDownloadTasks(pkg)
          downloadTasks.push(...initialTasks)

          const selectedCuadernoName = pkg.cuadernos?.find(c => c.selected)?.nombre || 'Principal'
          if (pkg.folios && pkg.folios.length > 0) {
            snapshotCuadernos.push({
              nombre: selectedCuadernoName,
              folio_count: pkg.folios.length,
              folio_numeros: pkg.folios.map(f => f.numero),
            })
          }

          const nonSelectedCount = (pkg.cuadernos?.filter(c => !c.selected) || []).length
          if (nonSelectedCount > 0) {
            emit('progress', {
              message: `Obteniendo ${nonSelectedCount} cuaderno(s) adicional(es)…`,
              current: 0, total: 0,
              cuaderno_current: 0, cuaderno_total: nonSelectedCount,
            })
          }

          const extraFolioTasks = await fetchOtherCuadernos(pjud, pkg, emit, nonSelectedCount, snapshotCuadernos)
          downloadTasks.push(...extraFolioTasks)

          const anexosTasks = await fetchAnexos(pjud, pkg, emit, snapshotAnexos)
          downloadTasks.push(...anexosTasks)

          const exhortoDocTasks = await fetchExhortoDocuments(pjud, pkg, emit, snapshotExhortos)
          downloadTasks.push(...exhortoDocTasks)

          const escritosTasks = buildEscritosDownloadTasks(pkg)
          downloadTasks.push(...escritosTasks)

          const folioAnexoTasks = await fetchFolioAnexos(pjud, pkg, emit)
          downloadTasks.push(...folioAnexoTasks)

          const remisionesDocTasks = await fetchRemisiones(pjud, pkg, emit, snapshotRemisiones, fullRemisionesData)
          downloadTasks.push(...remisionesDocTasks)

          console.log(
            `[sync] ${pkg.rol} — ${downloadTasks.length} PDFs a descargar ` +
            `(${pkg.folios?.length || 0} folios visibles + ` +
            `${extraFolioTasks.length} de otros cuadernos + ` +
            `${anexosTasks.length} anexos + ` +
            `${exhortoDocTasks.length} docs exhortos + ` +
            `${escritosTasks.length} escritos + ` +
            `${folioAnexoTasks.length} anexos solicitud + ` +
            `${remisionesDocTasks.length} docs remisiones)`
          )

          if (downloadTasks.length === 0) {
            emit('progress', { message: 'No se encontraron documentos para descargar.', current: 0, total: 0 })
          } else {
            emit('progress', { message: 'Iniciando descarga de documentos…', current: 0, total: downloadTasks.length })
          }
        }

        const totalTasks = downloadTasks.length

        // ────────────────────────────────────────────
        // PASO 7: DESCARGAR, DEDUP, UPLOAD, REGISTRAR
        // ────────────────────────────────────────────
        const results: SyncedDocument[] = []
        const errors: string[] = []
        let existingCount = 0
        let failedCount = 0
        let timedOut = false

        for (let i = 0; i < downloadTasks.length; i++) {
          const task = downloadTasks[i]

          if (Date.now() - startTime > SYNC_TIMEOUT_MS) {
            const pendingTasks = downloadTasks.slice(i)
            await supabase
              .from('cases')
              .update({ pending_sync_tasks: pendingTasks })
              .eq('id', caseId)

            timedOut = true
            console.log(`[sync] Timeout — ${pendingTasks.length} tasks saved for resume`)
            emit('progress', {
              message: `Continuará automáticamente (${pendingTasks.length} pendientes)…`,
              current: i,
              total: totalTasks,
            })
            break
          }

          emit('progress', {
            message: 'Sincronizando documentos…',
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
        // PASO 7.5: LEER DATOS PREVIOS PARA DEEP COMPARISON
        // ────────────────────────────────────────────
        let prevTabsData: TabsData | null = null
        let prevReceptorData: ReceptorData | null = null
        let prevRemisionesData: StoredRemisionDetail[] | null = null

        if (!isResume && !isFirstSync) {
          try {
            const { data: prevJsonb } = await supabase
              .from('cases')
              .select('tabs_data, receptor_data, remisiones_data')
              .eq('id', caseId)
              .single()
            if (prevJsonb) {
              prevTabsData = (prevJsonb.tabs_data as TabsData) ?? null
              prevReceptorData = (prevJsonb.receptor_data as ReceptorData) ?? null
              prevRemisionesData = (prevJsonb.remisiones_data as StoredRemisionDetail[]) ?? null
            }
          } catch { /* first sync or no previous data */ }
        }

        // ────────────────────────────────────────────
        // PASO 8: DATOS ADICIONALES (solo en sync normal, no resume)
        // ────────────────────────────────────────────
        let tabsStored = false
        let receptorStored = false
        let causaOrigenStored = false
        let remisionesStored = false
        let parsedReceptorData: ReceptorData | null = null

        if (!isResume) {
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

          if (pkg.jwt_receptor) {
            emit('progress', { message: 'Obteniendo datos del receptor…', current: totalTasks, total: totalTasks })

            try {
              const receptorHtml = await pjud.fetchReceptorHtml(
                pkg.jwt_receptor,
                pkg.csrf_token,
                pkg.cookies
              )

              if (receptorHtml) {
                parsedReceptorData = parseReceptorData(receptorHtml)

                const { error: receptorError } = await supabase
                  .from('cases')
                  .update({ receptor_data: parsedReceptorData })
                  .eq('id', caseId)

                if (receptorError) {
                  console.warn('[sync] receptor_data update error:', receptorError.message)
                } else {
                  receptorStored = true
                  snapshotReceptorRetiros = parsedReceptorData.retiros.map(r => ({
                    cuaderno: r.cuaderno,
                    fecha_retiro: r.fecha_retiro,
                    estado: r.estado,
                  }))
                  console.log(
                    `[sync] receptor_data: ${parsedReceptorData.receptor_nombre ?? 'sin nombre'} — ` +
                    `${parsedReceptorData.retiros.length} retiro(s)`
                  )
                }
              } else {
                console.warn('[sync] receptorCivil.php no retornó HTML útil')
              }
            } catch (receptorErr) {
              console.error('[sync] Error procesando receptor:', receptorErr)
            }
          }

          if (fullRemisionesData.length > 0) {
            const { error: remError } = await supabase
              .from('cases')
              .update({ remisiones_data: fullRemisionesData })
              .eq('id', caseId)

            if (remError) {
              console.warn('[sync] remisiones_data update error:', remError.message)
            } else {
              remisionesStored = true
              console.log(`[sync] remisiones_data guardadas: ${snapshotRemisiones.length} remisión(es)`)
            }
          }
        }

        // ────────────────────────────────────────────
        // PASO 9: GENERAR SNAPSHOT + DIFF (solo en sync normal)
        // ────────────────────────────────────────────
        let changes: SyncChange[] = []

        if (!isResume) {
          const newSnapshot: SyncSnapshot = {
            cuadernos: snapshotCuadernos,
            anexos: snapshotAnexos,
            exhortos: snapshotExhortos,
            receptor_retiros: snapshotReceptorRetiros,
            remisiones: snapshotRemisiones,
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

          changes = isFirstSync ? [] : generateDiff(prevSnapshot!, newSnapshot, {
            prevTabs: prevTabsData,
            currTabs: pkg.tabs,
            prevReceptor: prevReceptorData,
            currReceptor: parsedReceptorData,
            prevRemisiones: prevRemisionesData,
            currRemisiones: fullRemisionesData.length > 0 ? fullRemisionesData : null,
          })

          await supabase
            .from('cases')
            .update({ sync_snapshot: newSnapshot })
            .eq('id', caseId)
        }

        // ────────────────────────────────────────────
        // PASO 10: ACTUALIZAR CASE STATS + LIMPIAR PENDING
        // ────────────────────────────────────────────
        emit('progress', { message: 'Actualizando estadísticas…', current: totalTasks, total: totalTasks })

        const { count: docCount } = await supabase
          .from('documents')
          .select('id', { count: 'exact', head: true })
          .eq('case_id', caseId)

        const caseUpdate: Record<string, unknown> = {
          document_count: docCount ?? 0,
          last_synced_at: new Date().toISOString(),
        }
        if (!timedOut) {
          caseUpdate.pending_sync_tasks = null
        }

        await supabase
          .from('cases')
          .update(caseUpdate)
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
          exhortos_docs_downloaded: 0,
          remisiones_count: pkg.remisiones?.length ?? 0,
          remisiones_docs_downloaded: 0,
          remisiones_stored: remisionesStored,
          changes,
          is_first_sync: isFirstSync,
          has_pending: timedOut,
          pending_count: timedOut
            ? downloadTasks.length - (results.length + existingCount + failedCount)
            : 0,
        }

        console.log(
          `[sync] ${pkg.rol} — ${timedOut ? 'Parcial' : 'Completado'} en ${syncResult.duration_ms}ms: ` +
          `${results.length} nuevos, ${existingCount} existentes, ${failedCount} fallidos` +
          (timedOut ? ` | ${syncResult.pending_count} pendientes para resume` : '') +
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
// FETCH REMISIONES EN LA CORTE (apelaciones)
// ════════════════════════════════════════════════════════

async function fetchRemisiones(
  pjud: PjudClient,
  pkg: CausaPackage,
  emit?: SseEmitter,
  snapshotRemisiones?: SyncSnapshot['remisiones'],
  fullRemisionesOut?: StoredRemisionDetail[],
): Promise<PdfDownloadTask[]> {
  const tasks: PdfDownloadTask[] = []

  const remisiones = pkg.remisiones ?? []
  if (remisiones.length === 0) return tasks

  emit?.('progress', {
    message: `Obteniendo ${remisiones.length} remisión(es) en la Corte…`,
    current: 0,
    total: 0,
  })

  for (let idx = 0; idx < remisiones.length; idx++) {
    const remision = remisiones[idx]
    const label = `${remision.descripcion_tramite || 'Remisión'} ${remision.fecha_tramite || ''}`

    try {
      console.log(`[sync] Fetching remisión ${idx + 1}/${remisiones.length}: ${label}`)

      emit?.('progress', {
        message: `Obteniendo remisión ${idx + 1}/${remisiones.length}: ${label}…`,
        current: 0,
        total: 0,
      })

      const html = await pjud.fetchApelacionHtml(remision.jwt, pkg.cookies)

      if (!html) {
        console.warn(`[sync] causaApelaciones.php no retornó HTML útil para remisión "${label}"`)
        continue
      }

      const detail: ApelacionDetail = parseApelacionFromHtml(html)
      const libroLabel = detail.metadata.libro || `remision_${idx + 1}`
      const cleanLibro = libroLabel.replace(/[^a-zA-Z0-9-]/g, '_').substring(0, 40)

      snapshotRemisiones?.push({
        descripcion_tramite: remision.descripcion_tramite,
        fecha_tramite: remision.fecha_tramite,
        libro: detail.metadata.libro,
        folio_count: detail.folios.length,
      })

      fullRemisionesOut?.push({
        descripcion_tramite: remision.descripcion_tramite,
        fecha_tramite: remision.fecha_tramite,
        metadata: detail.metadata,
        folios: detail.folios.map(f => ({
          numero: f.numero,
          tramite: f.tramite,
          descripcion: f.descripcion,
          nomenclaturas: f.nomenclaturas,
          fecha: f.fecha,
          sala: f.sala,
          estado: f.estado,
        })),
        tabs: detail.tabs,
        expediente: detail.expediente,
      })

      // Direct documents from the apelacion
      if (detail.direct_jwts.ebook) {
        tasks.push(jwtRefToTask(
          detail.direct_jwts.ebook,
          `${pkg.rol}_ape_${cleanLibro}_ebook.pdf`,
          'otro', null, `Apelación ${libroLabel}`, detail.metadata.fecha
        ))
      }
      if (detail.direct_jwts.certificado_envio) {
        tasks.push(jwtRefToTask(
          detail.direct_jwts.certificado_envio,
          `${pkg.rol}_ape_${cleanLibro}_certificado.pdf`,
          'actuacion', null, `Apelación ${libroLabel}`, detail.metadata.fecha
        ))
      }
      if (detail.direct_jwts.texto) {
        tasks.push(jwtRefToTask(
          detail.direct_jwts.texto,
          `${pkg.rol}_ape_${cleanLibro}_texto.pdf`,
          'escrito', null, `Apelación ${libroLabel}`, detail.metadata.fecha
        ))
      }

      // Movimientos (folios) from the apelacion
      for (const folio of detail.folios) {
        const cleanTramite = (folio.tramite || 'doc')
          .replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ\s]/g, '')
          .trim()
          .substring(0, 30)
          .replace(/\s+/g, '_')

        if (folio.jwt_doc) {
          tasks.push({
            jwt: folio.jwt_doc.jwt,
            endpoint: folio.jwt_doc.action,
            param: folio.jwt_doc.param,
            filename: `${pkg.rol}_ape_${cleanLibro}_f${folio.numero}_${cleanTramite}.pdf`,
            document_type: inferDocType(folio.tramite),
            folio: folio.numero,
            cuaderno: `Apelación ${libroLabel}`,
            fecha: folio.fecha,
            source_url: folio.jwt_doc.action,
            folio_metadata: {
              folio_numero: folio.numero,
              etapa: null,
              tramite: folio.tramite || null,
              desc_tramite: folio.descripcion || null,
              fecha_tramite: folio.fecha || null,
              foja: null,
              cuaderno: `Apelación ${libroLabel}`,
            },
          })
        }

        if (folio.jwt_certificado_escrito) {
          tasks.push({
            jwt: folio.jwt_certificado_escrito.jwt,
            endpoint: folio.jwt_certificado_escrito.action,
            param: folio.jwt_certificado_escrito.param,
            filename: `${pkg.rol}_ape_${cleanLibro}_f${folio.numero}_cert_escrito.pdf`,
            document_type: 'actuacion',
            folio: folio.numero,
            cuaderno: `Apelación ${libroLabel}`,
            fecha: folio.fecha,
            source_url: folio.jwt_certificado_escrito.action,
            folio_metadata: {
              folio_numero: folio.numero,
              etapa: null,
              tramite: folio.tramite || null,
              desc_tramite: folio.descripcion || null,
              fecha_tramite: folio.fecha || null,
              foja: null,
              cuaderno: `Apelación ${libroLabel}`,
            },
          })
        }
      }

      console.log(
        `[sync] Remisión "${label}": ${detail.folios.length} folios, ` +
        `${detail.tabs.litigantes.length} litigantes, ` +
        `ebook: ${!!detail.direct_jwts.ebook}`
      )
    } catch (err) {
      console.error(`[sync] Error fetching remisión "${label}":`, err)
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
  // 0. Pre-check: skip download if document already exists in DB
  const sanitizedName = task.filename.replace(/[^a-zA-Z0-9._-]/g, '_')
  const { data: existingDoc } = await supabase
    .from('documents')
    .select('id')
    .eq('case_id', caseId)
    .eq('user_id', userId)
    .eq('filename', sanitizedName)
    .maybeSingle()

  if (existingDoc) return 'duplicate'

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
// DIFF ENGINE — comparación profunda snapshot + JSONB
// ════════════════════════════════════════════════════════

interface DeepDiffContext {
  prevTabs: TabsData | null
  currTabs: TabsData | null
  prevReceptor: ReceptorData | null
  currReceptor: ReceptorData | null
  prevRemisiones: StoredRemisionDetail[] | null
  currRemisiones: StoredRemisionDetail[] | null
}

function diffByKey<T>(
  prev: T[], curr: T[],
  keyFn: (item: T) => string,
  category: SyncChange['category'],
  labelFn: (item: T) => string,
  compareFields: string[],
  fieldLabels: Record<string, string>,
): SyncChange[] {
  const out: SyncChange[] = []
  const pMap = new Map(prev.map(i => [keyFn(i), i]))
  const cMap = new Map(curr.map(i => [keyFn(i), i]))
  for (const [k, v] of cMap) {
    if (!pMap.has(k)) out.push({ category, type: 'added', description: `Nuevo: ${labelFn(v)}` })
  }
  for (const [k, v] of pMap) {
    if (!cMap.has(k)) out.push({ category, type: 'removed', description: `Eliminado: ${labelFn(v)}` })
  }
  for (const [k, cv] of cMap) {
    const pv = pMap.get(k)
    if (!pv) continue
    const pvR = pv as Record<string, unknown>
    const cvR = cv as Record<string, unknown>
    for (const f of compareFields) {
      const o = String(pvR[f] ?? '').trim()
      const n = String(cvR[f] ?? '').trim()
      if (o !== n && (o || n)) {
        out.push({
          category, type: 'changed',
          description: o
            ? `${labelFn(cv)}: ${fieldLabels[f] || f} "${o}" → "${n}"`
            : `${labelFn(cv)}: ${fieldLabels[f] || f} = "${n}"`,
        })
      }
    }
  }
  return out
}

function generateDiff(
  prev: SyncSnapshot,
  curr: SyncSnapshot,
  deep?: DeepDiffContext,
): SyncChange[] {
  const changes: SyncChange[] = []

  // ── A. Metadata principal ──
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
        type: oldVal ? 'changed' : 'added',
        description: oldVal ? `${label}: "${oldVal}" → "${newVal}"` : `${label}: "${newVal}"`,
      })
    }
  }

  // ── B. Cuadernos ──
  const prevCuadernoNames = new Set(prev.cuadernos.map(c => c.nombre))
  const currCuadernoNames = new Set(curr.cuadernos.map(c => c.nombre))
  for (const c of curr.cuadernos) {
    if (!prevCuadernoNames.has(c.nombre)) {
      changes.push({ category: 'cuaderno', type: 'added', description: `Cuaderno nuevo: ${c.nombre} (${c.folio_count} folios)` })
    }
  }
  for (const c of prev.cuadernos) {
    if (!currCuadernoNames.has(c.nombre)) {
      changes.push({ category: 'cuaderno', type: 'removed', description: `Cuaderno eliminado: ${c.nombre}` })
    }
  }

  // ── C. Folios por cuaderno ──
  const prevCuadernoMap = new Map(prev.cuadernos.map(c => [c.nombre, new Set(c.folio_numeros)]))
  const currCuadernoMap = new Map(curr.cuadernos.map(c => [c.nombre, new Set(c.folio_numeros)]))
  for (const c of curr.cuadernos) {
    const pf = prevCuadernoMap.get(c.nombre)
    if (!pf) continue
    const added = c.folio_numeros.filter(n => !pf.has(n))
    if (added.length > 0) {
      const list = added.length <= 3 ? added.join(', ') : `${added.slice(0, 3).join(', ')}… (+${added.length - 3})`
      changes.push({ category: 'folio', type: 'added', description: `${added.length} folio(s) nuevo(s) en ${c.nombre}: ${list}` })
    }
  }
  for (const c of prev.cuadernos) {
    const cf = currCuadernoMap.get(c.nombre)
    if (!cf) continue
    const removed = c.folio_numeros.filter(n => !cf.has(n))
    if (removed.length > 0) {
      changes.push({ category: 'folio', type: 'removed', description: `${removed.length} folio(s) eliminado(s) de ${c.nombre}` })
    }
  }

  // ── D. Anexos ──
  const prevAnexoKeys = new Set(prev.anexos.map(a => `${a.fecha}|${a.referencia}`))
  const currAnexoKeys = new Set(curr.anexos.map(a => `${a.fecha}|${a.referencia}`))
  for (const a of curr.anexos) {
    if (!prevAnexoKeys.has(`${a.fecha}|${a.referencia}`)) {
      changes.push({ category: 'anexo', type: 'added', description: `Anexo nuevo: ${a.referencia || a.fecha || 'sin referencia'}` })
    }
  }
  for (const a of prev.anexos) {
    if (!currAnexoKeys.has(`${a.fecha}|${a.referencia}`)) {
      changes.push({ category: 'anexo', type: 'removed', description: `Anexo eliminado: ${a.referencia || a.fecha || 'sin referencia'}` })
    }
  }

  // ── E-H: Deep comparison (JSONB) or shallow (snapshot counts) ──

  if (deep) {
    // ── E. Litigantes (deep) ──
    if (deep.prevTabs && deep.currTabs) {
      changes.push(...diffByKey(
        deep.prevTabs.litigantes ?? [], deep.currTabs.litigantes ?? [],
        l => l.rut || `${l.nombre}|${l.participante}`,
        'litigante',
        l => `${l.nombre} (${l.participante})`,
        ['participante', 'persona', 'nombre'],
        { participante: 'Rol', persona: 'Tipo persona', nombre: 'Nombre' },
      ))

      // ── F. Notificaciones (deep) ──
      changes.push(...diffByKey(
        deep.prevTabs.notificaciones ?? [], deep.currTabs.notificaciones ?? [],
        n => `${n.fecha_tramite}|${n.tipo_notif}|${n.nombre}`,
        'notificacion',
        n => `Notif. ${n.tipo_notif} ${n.fecha_tramite} — ${n.nombre}`,
        ['estado_notif', 'tramite', 'obs_fallida', 'tipo_participante'],
        { estado_notif: 'Estado', tramite: 'Trámite', obs_fallida: 'Observación', tipo_participante: 'Tipo participante' },
      ))

      // ── G. Escritos por resolver (deep) ──
      changes.push(...diffByKey(
        deep.prevTabs.escritos_por_resolver ?? [], deep.currTabs.escritos_por_resolver ?? [],
        e => `${e.fecha_ingreso}|${e.tipo_escrito}|${e.solicitante}`,
        'escrito',
        e => `Escrito ${e.tipo_escrito} — ${e.solicitante}`,
        ['doc', 'anexo'],
        { doc: 'Documento', anexo: 'Anexo' },
      ))

      // ── H. Exhortos (deep: todos los campos de tabs_data) ──
      changes.push(...diffByKey(
        deep.prevTabs.exhortos ?? [], deep.currTabs.exhortos ?? [],
        e => e.rol_destino || `${e.rol_origen}|${e.tipo_exhorto}`,
        'exhorto',
        e => `Exhorto ${e.rol_destino}`,
        ['tipo_exhorto', 'fecha_ordena', 'fecha_ingreso', 'tribunal_destino', 'estado_exhorto', 'rol_origen'],
        { tipo_exhorto: 'Tipo', fecha_ordena: 'Fecha ordena', fecha_ingreso: 'Fecha ingreso', tribunal_destino: 'Tribunal destino', estado_exhorto: 'Estado', rol_origen: 'Rol origen' },
      ))
    }

    // Exhorto doc counts (del snapshot, no está en tabs_data)
    const prevExhMap = new Map(prev.exhortos.map(e => [e.rol_destino, e]))
    for (const e of curr.exhortos) {
      const pe = prevExhMap.get(e.rol_destino)
      if (!pe) continue
      if (e.doc_count > pe.doc_count) {
        changes.push({ category: 'exhorto', type: 'added', description: `${e.doc_count - pe.doc_count} doc(s) nuevo(s) en exhorto ${e.rol_destino}` })
      } else if (e.doc_count < pe.doc_count) {
        changes.push({ category: 'exhorto', type: 'removed', description: `${pe.doc_count - e.doc_count} doc(s) eliminado(s) del exhorto ${e.rol_destino}` })
      }
    }
    // Exhortos nuevos/eliminados a nivel snapshot
    const prevExhKeys = new Set(prev.exhortos.map(e => e.rol_destino))
    const currExhKeys = new Set(curr.exhortos.map(e => e.rol_destino))
    for (const e of curr.exhortos) {
      if (!prevExhKeys.has(e.rol_destino)) {
        changes.push({ category: 'exhorto', type: 'added', description: `Exhorto nuevo: ${e.rol_destino} (${e.estado}, ${e.doc_count} docs)` })
      }
    }
    for (const e of prev.exhortos) {
      if (!currExhKeys.has(e.rol_destino)) {
        changes.push({ category: 'exhorto', type: 'removed', description: `Exhorto eliminado: ${e.rol_destino}` })
      }
    }

    // ── I. Receptor (deep) ──
    if (deep.prevReceptor && deep.currReceptor) {
      const pName = (deep.prevReceptor.receptor_nombre || '').trim()
      const cName = (deep.currReceptor.receptor_nombre || '').trim()
      if (pName !== cName && (pName || cName)) {
        changes.push({
          category: 'receptor', type: 'changed',
          description: pName
            ? `Receptor: "${pName}" → "${cName}"`
            : `Receptor: "${cName}"`,
        })
      }
      changes.push(...diffByKey(
        deep.prevReceptor.retiros ?? [], deep.currReceptor.retiros ?? [],
        r => `${r.cuaderno}|${r.fecha_retiro}`,
        'receptor',
        r => `Retiro ${r.cuaderno} ${r.fecha_retiro}`,
        ['estado', 'datos_retiro'],
        { estado: 'Estado', datos_retiro: 'Datos retiro' },
      ))
    } else {
      // Shallow receptor
      const prevRetiroKeys = new Set(prev.receptor_retiros.map(r => `${r.cuaderno}|${r.fecha_retiro}`))
      const currRetiroKeys = new Set(curr.receptor_retiros.map(r => `${r.cuaderno}|${r.fecha_retiro}`))
      for (const r of curr.receptor_retiros) {
        if (!prevRetiroKeys.has(`${r.cuaderno}|${r.fecha_retiro}`)) {
          changes.push({ category: 'receptor', type: 'added', description: `Retiro nuevo: ${r.cuaderno} — ${r.fecha_retiro} (${r.estado})` })
        }
      }
      for (const r of prev.receptor_retiros) {
        if (!currRetiroKeys.has(`${r.cuaderno}|${r.fecha_retiro}`)) {
          changes.push({ category: 'receptor', type: 'removed', description: `Retiro eliminado: ${r.cuaderno} — ${r.fecha_retiro}` })
        }
      }
    }

    // ── J. Remisiones (deep) ──
    if (deep.prevRemisiones && deep.currRemisiones) {
      deepDiffRemisiones(deep.prevRemisiones, deep.currRemisiones, changes)
    } else {
      shallowDiffRemisiones(prev, curr, changes)
    }

  } else {
    // ══ SHALLOW FALLBACK (sin datos JSONB previos) ══

    // Exhortos shallow
    const prevExhortoMap = new Map(prev.exhortos.map(e => [e.rol_destino, e]))
    for (const e of curr.exhortos) {
      const pe = prevExhortoMap.get(e.rol_destino)
      if (!pe) {
        changes.push({ category: 'exhorto', type: 'added', description: `Exhorto nuevo: ${e.rol_destino} (${e.estado}, ${e.doc_count} docs)` })
        continue
      }
      if (pe.estado && e.estado && pe.estado !== e.estado) {
        changes.push({ category: 'exhorto', type: 'changed', description: `Exhorto ${e.rol_destino}: estado "${pe.estado}" → "${e.estado}"` })
      }
      if (e.doc_count > pe.doc_count) {
        changes.push({ category: 'exhorto', type: 'added', description: `${e.doc_count - pe.doc_count} doc(s) nuevo(s) en exhorto ${e.rol_destino}` })
      }
    }

    // Receptor shallow
    const prevRetiroKeys = new Set(prev.receptor_retiros.map(r => `${r.cuaderno}|${r.fecha_retiro}`))
    for (const r of curr.receptor_retiros) {
      if (!prevRetiroKeys.has(`${r.cuaderno}|${r.fecha_retiro}`)) {
        changes.push({ category: 'receptor', type: 'added', description: `Retiro nuevo: ${r.cuaderno} — ${r.fecha_retiro} (${r.estado})` })
      }
    }

    // Remisiones shallow
    shallowDiffRemisiones(prev, curr, changes)

    // Tab counts shallow
    const tabLabels: Record<string, string> = {
      litigantes: 'Litigantes', notificaciones: 'Notificaciones',
      escritos_por_resolver: 'Escritos por Resolver', exhortos: 'Exhortos',
    }
    for (const [key, label] of Object.entries(tabLabels)) {
      const oldCount = prev.tabs_counts[key as keyof typeof prev.tabs_counts] || 0
      const newCount = curr.tabs_counts[key as keyof typeof curr.tabs_counts] || 0
      if (newCount > oldCount) {
        changes.push({ category: 'metadata', type: 'added', description: `${newCount - oldCount} nuevo(s) en ${label}` })
      } else if (newCount < oldCount) {
        changes.push({ category: 'metadata', type: 'removed', description: `${oldCount - newCount} eliminado(s) en ${label}` })
      }
    }
  }

  return changes
}

function shallowDiffRemisiones(prev: SyncSnapshot, curr: SyncSnapshot, changes: SyncChange[]): void {
  const prevKeys = new Set((prev.remisiones ?? []).map(r => `${r.descripcion_tramite}|${r.fecha_tramite}`))
  const currKeys = new Set((curr.remisiones ?? []).map(r => `${r.descripcion_tramite}|${r.fecha_tramite}`))
  const prevMap = new Map((prev.remisiones ?? []).map(r => [`${r.descripcion_tramite}|${r.fecha_tramite}`, r]))

  for (const r of (curr.remisiones ?? [])) {
    const key = `${r.descripcion_tramite}|${r.fecha_tramite}`
    if (!prevKeys.has(key)) {
      changes.push({ category: 'remision', type: 'added', description: `Remisión nueva: ${r.descripcion_tramite} ${r.fecha_tramite}${r.libro ? ` (${r.libro})` : ''}` })
    } else {
      const pr = prevMap.get(key)
      if (pr && r.folio_count !== pr.folio_count) {
        const d = r.folio_count - pr.folio_count
        changes.push({
          category: 'remision', type: d > 0 ? 'added' : 'removed',
          description: d > 0
            ? `${d} folio(s) nuevo(s) en remisión ${r.descripcion_tramite}`
            : `${-d} folio(s) eliminado(s) de remisión ${r.descripcion_tramite}`,
        })
      }
    }
  }
  for (const r of (prev.remisiones ?? [])) {
    if (!currKeys.has(`${r.descripcion_tramite}|${r.fecha_tramite}`)) {
      changes.push({ category: 'remision', type: 'removed', description: `Remisión eliminada: ${r.descripcion_tramite} ${r.fecha_tramite}` })
    }
  }
}

function deepDiffRemisiones(
  prev: StoredRemisionDetail[],
  curr: StoredRemisionDetail[],
  changes: SyncChange[],
): void {
  const isFullDetail = (d: unknown): d is StoredRemisionDetail =>
    !!d && typeof d === 'object' && 'metadata' in d

  const prevFull = prev.filter(isFullDetail)
  const currFull = curr.filter(isFullDetail)
  const pMap = new Map(prevFull.map(r => [`${r.descripcion_tramite}|${r.fecha_tramite}`, r]))
  const cMap = new Map(currFull.map(r => [`${r.descripcion_tramite}|${r.fecha_tramite}`, r]))

  // Nuevas / Eliminadas
  for (const [k, cr] of cMap) {
    if (!pMap.has(k)) {
      changes.push({ category: 'remision', type: 'added', description: `Remisión nueva: ${cr.descripcion_tramite} ${cr.fecha_tramite}${cr.metadata?.libro ? ` (${cr.metadata.libro})` : ''}` })
    }
  }
  for (const [k, pr] of pMap) {
    if (!cMap.has(k)) {
      changes.push({ category: 'remision', type: 'removed', description: `Remisión eliminada: ${pr.descripcion_tramite} ${pr.fecha_tramite}` })
    }
  }

  // Cambios internos de cada remisión existente
  for (const [k, cr] of cMap) {
    const pr = pMap.get(k)
    if (!pr) continue
    const remLabel = cr.descripcion_tramite

    // Metadata de la apelación (7 campos)
    const metaFields: Array<keyof StoredRemisionDetail['metadata']> = [
      'libro', 'fecha', 'estado_recurso', 'estado_procesal', 'ubicacion', 'recurso', 'corte',
    ]
    const metaFieldLabels: Record<string, string> = {
      libro: 'Libro', fecha: 'Fecha', estado_recurso: 'Estado recurso',
      estado_procesal: 'Estado procesal', ubicacion: 'Ubicación', recurso: 'Recurso', corte: 'Corte',
    }
    for (const f of metaFields) {
      const o = (pr.metadata?.[f] ?? '').trim()
      const n = (cr.metadata?.[f] ?? '').trim()
      if (o !== n && (o || n)) {
        changes.push({
          category: 'remision', type: 'changed',
          description: o
            ? `Remisión ${remLabel}: ${metaFieldLabels[f]} "${o}" → "${n}"`
            : `Remisión ${remLabel}: ${metaFieldLabels[f]} = "${n}"`,
        })
      }
    }

    // Folios (movimientos) de la remisión
    changes.push(...diffByKey(
      pr.folios ?? [], cr.folios ?? [],
      f => String(f.numero),
      'remision',
      f => `Rem. ${remLabel} folio ${f.numero}`,
      ['tramite', 'descripcion', 'fecha', 'sala', 'estado'],
      { tramite: 'Trámite', descripcion: 'Descripción', fecha: 'Fecha', sala: 'Sala', estado: 'Estado' },
    ))

    // Litigantes de la remisión
    changes.push(...diffByKey(
      pr.tabs?.litigantes ?? [], cr.tabs?.litigantes ?? [],
      l => l.rut || l.nombre,
      'remision',
      l => `Rem. ${remLabel} litigante ${l.nombre}`,
      ['sujeto', 'persona', 'nombre'],
      { sujeto: 'Sujeto', persona: 'Tipo persona', nombre: 'Nombre' },
    ))

    // Exhortos de la remisión
    const prExh = pr.tabs?.exhortos ?? []
    const crExh = cr.tabs?.exhortos ?? []
    const prExhSet = new Set(prExh.map(e => e.descripcion))
    const crExhSet = new Set(crExh.map(e => e.descripcion))
    for (const e of crExh) {
      if (!prExhSet.has(e.descripcion)) {
        changes.push({ category: 'remision', type: 'added', description: `Rem. ${remLabel}: exhorto nuevo "${e.descripcion}"` })
      }
    }
    for (const e of prExh) {
      if (!crExhSet.has(e.descripcion)) {
        changes.push({ category: 'remision', type: 'removed', description: `Rem. ${remLabel}: exhorto eliminado "${e.descripcion}"` })
      }
    }

    // Incompetencia de la remisión
    const prInc = pr.tabs?.incompetencia ?? []
    const crInc = cr.tabs?.incompetencia ?? []
    const prIncSet = new Set(prInc.map(i => i.descripcion))
    const crIncSet = new Set(crInc.map(i => i.descripcion))
    for (const i of crInc) {
      if (!prIncSet.has(i.descripcion)) {
        changes.push({ category: 'remision', type: 'added', description: `Rem. ${remLabel}: incompetencia nueva "${i.descripcion}"` })
      }
    }
    for (const i of prInc) {
      if (!crIncSet.has(i.descripcion)) {
        changes.push({ category: 'remision', type: 'removed', description: `Rem. ${remLabel}: incompetencia eliminada "${i.descripcion}"` })
      }
    }

    // Expediente primera instancia
    if (pr.expediente || cr.expediente) {
      const pe = (pr.expediente ?? {}) as Record<string, unknown>
      const ce = (cr.expediente ?? {}) as Record<string, unknown>
      const expFields = ['causa_origen', 'tribunal', 'caratulado', 'materia', 'ruc', 'fecha_ingreso']
      const expLabels: Record<string, string> = {
        causa_origen: 'Causa origen', tribunal: 'Tribunal', caratulado: 'Caratulado',
        materia: 'Materia', ruc: 'RUC', fecha_ingreso: 'Fecha ingreso',
      }
      for (const f of expFields) {
        const o = String(pe[f] ?? '').trim()
        const n = String(ce[f] ?? '').trim()
        if (o !== n && (o || n)) {
          changes.push({
            category: 'remision', type: 'changed',
            description: o
              ? `Rem. ${remLabel} expediente: ${expLabels[f]} "${o}" → "${n}"`
              : `Rem. ${remLabel} expediente: ${expLabels[f]} = "${n}"`,
          })
        }
      }
    }
  }
}
