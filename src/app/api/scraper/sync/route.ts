/**
 * ============================================================
 * API ROUTE: /api/scraper/sync
 * ============================================================
 * Pipeline de sincronización server-side. Recibe CausaPackage
 * desde la extensión y ejecuta:
 *
 *   1) Auth: Verificar Bearer token
 *   2) Validar CausaPackage
 *   3) Upsert causa en DB
 *   4) Insertar cuaderno visible (folios, tabs, piezas exhorto)
 *   5) Fetch + insertar cuadernos adicionales
 *   6) Insertar datos globales (exhortos, anexos causa, receptor)
 *   7) Fetch + insertar exhorto detalles
 *   8) Fetch + insertar remisiones (con sub-tablas)
 *   9) Construir lista de PDFs a descargar
 *  10) Descargar PDFs (pre-check, dedup, upload, register)
 *  11) Actualizar stats + evento complete via SSE
 *
 * Respuesta: SSE stream (text/event-stream).
 * Node.js runtime. Timeout: 5 min máx.
 * ============================================================
 */

export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getCorsHeaders, handleCorsOptions } from '@/lib/cors'
import { checkRateLimit, rateLimitHeaders } from '@/lib/rate-limit'
import { checkPlanLimits, incrementPlanCounter } from '@/lib/plan-guard'
import { PjudClient } from '@/lib/pjud/client'
import {
  parseCuadernoFromHtml,
  parseAnexosFromHtml,
  parseAnexoEscritoApelacionesFromHtml,
  parseApelacionFromHtml,
  parseExhortoDetalleFromHtml,
  parseReceptorRetiros,
} from '@/lib/pjud/parser'
import { buildSnapshotFromDb, generateDiff } from '@/lib/pjud/sync-diff'
import { normalizeProcedimiento } from '@/lib/pjud/normalize-procedimiento'
import { invalidateCaseContextCache } from '@/lib/ai/rag/case-context'
import type {
  CausaPackage,
  CuadernoData,
  ExhortoEntry,
  PdfDownloadTask,
  DocumentOrigen,
  JwtRef,
  SyncResult,
  SyncChange,
  SyncSnapshot,
  SyncedDocument,
  ReceptorRetiro,
  AnexoFile,
  ExhortoDetalleDoc,
  ApelacionDetail,
  AnexoEscritoApelacion,
} from '@/lib/pjud/types'
import type {
  CaseInsert,
  DocumentInsert,
  DocumentHashInsert,
  ExtractedTextInsert,
} from '@/types/database'
import type { Json } from '@/types/supabase'

class PlanLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlanLimitError'
  }
}

// ════════════════════════════════════════════════════════
// SSE HELPERS
// ════════════════════════════════════════════════════════

type SseEmitter = (event: string, data: object) => void

function createSseEmitter(controller: ReadableStreamDefaultController<Uint8Array>): SseEmitter {
  const encoder = new TextEncoder()
  return (event: string, data: object) => {
    try {
      controller.enqueue(
        encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      )
    } catch { /* Client disconnected */ }
  }
}

const BUCKET_NAME = 'case-files'
const SYNC_TIMEOUT_MS = 5 * 60 * 1000
const MAX_FILE_SIZE = 50 * 1024 * 1024
const MAX_TASK_RETRIES = 3

type SupabaseAdmin = ReturnType<typeof createAdminClient>

// ════════════════════════════════════════════════════════
// POST /api/scraper/sync
// ════════════════════════════════════════════════════════

export async function POST(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request, { methods: 'POST, OPTIONS' })

  // ── Rate limit (sync es costoso: 5 req/min por IP) ──
  const rl = checkRateLimit(request, { maxRequests: 5, windowMs: 60_000 }, 'sync')
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Demasiadas solicitudes de sincronización. Intenta en unos segundos.', code: 'RATE_LIMITED' },
      { status: 429, headers: { ...corsHeaders, ...rateLimitHeaders(rl) } },
    )
  }

  // ── PASO 1: AUTENTICACIÓN ──
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

  // ── PASO 2: VALIDAR CausaPackage ──
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

  // ── SSE STREAM ──
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
        const db = createAdminClient()
        const pjud = new PjudClient()
        pjud.setCookies(pkg.cookies)

        let caseId: string
        let prevSnapshot: SyncSnapshot | null = null
        let newSnapshot: SyncSnapshot | null = null
        const downloadTasks: PdfDownloadTask[] = []

        if (isResume) {
          // ── RESUME ──
          caseId = pkg.resume_case_id!
          emit('progress', { message: 'Retomando descarga pendiente…', current: 0, total: 0 })
          console.log(`[sync] RESUME for case ${caseId}`)

          const { data: caseRow } = await db
            .from('cases')
            .select('pending_sync_tasks')
            .eq('id', caseId)
            .eq('user_id', user.id)
            .single()

          if (!caseRow?.pending_sync_tasks || !Array.isArray(caseRow.pending_sync_tasks) || caseRow.pending_sync_tasks.length === 0) {
            emit('complete', {
              success: true, case_id: caseId, rol: pkg.rol, tribunal: null,
              documents_new: [], documents_existing: 0, documents_failed: 0,
              total_downloaded: 0, errors: [], duration_ms: Date.now() - startTime,
              has_pending: false, pending_count: 0, changes: [], is_first_sync: false,
              failed_saved_for_retry: false,
            } as SyncResult)
            controller.close()
            return
          }

          downloadTasks.push(...(caseRow.pending_sync_tasks as unknown as PdfDownloadTask[]))
          emit('progress', { message: 'Retomando descarga de documentos…', current: 0, total: downloadTasks.length })

        } else {
          // ── SYNC NORMAL ──
          emit('progress', { message: 'Registrando causa…', current: 0, total: 0 })

          // PASO 3: Upsert causa (verifica plan limits si es causa nueva)
          let upsertedId: string | null
          try {
            upsertedId = await upsertCase(db, user.id, pkg)
          } catch (e) {
            if (e instanceof PlanLimitError) {
              emit('error', { message: e.message, code: 'PLAN_LIMIT_EXCEEDED', upgrade_required: true })
            } else {
              emit('error', { message: 'Error al registrar la causa' })
            }
            controller.close()
            return
          }
          if (!upsertedId) {
            emit('error', { message: 'Error al registrar la causa' })
            controller.close()
            return
          }
          caseId = upsertedId

          // Leer snapshot anterior ANTES de borrar datos (para diff)
          const { data: prevSnapRow } = await db
            .from('cases')
            .select('sync_snapshot')
            .eq('id', caseId)
            .single()
          prevSnapshot = (prevSnapRow?.sync_snapshot as SyncSnapshot | null) ?? null

          // Limpiar datos previos de tablas estructuradas para re-sync limpio
          await cleanStructuredData(db, caseId)

          // PASO 4: Insertar cuaderno visible
          emit('progress', { message: `Procesando cuaderno "${pkg.cuaderno_visible.nombre}"…`, current: 0, total: 0 })
          console.log(`[sync] Cuaderno visible "${pkg.cuaderno_visible.nombre}": ${pkg.cuaderno_visible.folios.length} folios, ${pkg.cuaderno_visible.litigantes.length} litigantes`)
          const cuadernoVisibleId = await insertCuaderno(db, user.id, caseId, pkg.cuaderno_visible, 0)
          buildFolioTasks(downloadTasks, pkg.cuaderno_visible, pkg.rol, cuadernoVisibleId)

          // PASO 5: Fetch + insertar cuadernos adicionales
          const parsedOtrosCuadernos: CuadernoData[] = []
          for (let i = 0; i < pkg.otros_cuadernos.length; i++) {
            const ref = pkg.otros_cuadernos[i]
            emit('progress', { message: `Obteniendo cuaderno "${ref.nombre}"…`, current: 0, total: 0 })

            try {
              if (!ref.jwt) continue
              const html = await pjud.fetchCuadernoHtml(ref.jwt, pkg.csrf_token!, pkg.cookies)
              if (!html) continue

              const { cuaderno } = parseCuadernoFromHtml(html, ref.nombre)
              const cuadernoId = await insertCuaderno(db, user.id, caseId, cuaderno, i + 1)
              buildFolioTasks(downloadTasks, cuaderno, pkg.rol, cuadernoId)
              parsedOtrosCuadernos.push(cuaderno)

              console.log(`[sync] Cuaderno "${ref.nombre}": ${cuaderno.folios.length} folios`)
            } catch (err) {
              console.error(`[sync] Error cuaderno "${ref.nombre}":`, err)
            }
          }

          // Fallback: si el cuaderno visible no clasificó, buscar
          // específicamente el cuaderno llamado "Principal". Si no
          // existe o tampoco clasifica, queda null (prompt genérico).
          if (!normalizeProcedimiento(pkg.cuaderno_visible.procedimiento) && parsedOtrosCuadernos.length > 0) {
            const principal = parsedOtrosCuadernos.find(c => /principal/i.test(c.nombre))
            const fallback = principal ? normalizeProcedimiento(principal.procedimiento) : null
            if (fallback) {
              await db.from('cases').update({ procedimiento: fallback }).eq('id', caseId)
              console.log(`[sync] Procedimiento desde cuaderno "${principal!.nombre}": ${fallback}`)
            }
          }

          // PASO 6: Datos globales
          // Exhortos (deduplicados)
          if (pkg.exhortos.length > 0) {
            await insertExhortos(db, user.id, caseId, pkg.exhortos)
          }

          // Anexos causa
          if (pkg.jwt_anexos) {
            emit('progress', { message: 'Obteniendo anexos de la causa…', current: 0, total: 0 })
            try {
              const html = await pjud.fetchAnexosHtml(pkg.jwt_anexos, pkg.cookies)
              if (html) {
                const anexos = parseAnexosFromHtml(html)
                const anexoIds = await insertAnexosCausa(db, user.id, caseId, anexos)
                buildAnexoCausaTasks(downloadTasks, anexos, anexoIds, pkg.rol)
                console.log(`[sync] Anexos causa: ${anexos.length}`)
              }
            } catch (err) {
              console.error('[sync] Error anexos causa:', err)
            }
          }

          // Receptor
          if (pkg.jwt_receptor) {
            emit('progress', { message: 'Obteniendo datos del receptor…', current: 0, total: 0 })
            try {
              const html = await pjud.fetchReceptorHtml(pkg.jwt_receptor, pkg.csrf_token, pkg.cookies)
              if (html) {
                const retiros = parseReceptorRetiros(html)
                await insertReceptorRetiros(db, user.id, caseId, retiros)
                console.log(`[sync] Receptor: ${retiros.length} retiro(s)`)
              }
            } catch (err) {
              console.error('[sync] Error receptor:', err)
            }
          }

          // Causa origen (tipo E)
          if (pkg.exhorto_data?.causa_origen) {
            await db.from('cases').update({
              causa_origen: pkg.exhorto_data.causa_origen,
              tribunal_origen: pkg.exhorto_data.tribunal_origen,
            }).eq('id', caseId)
          }

          // PASO 7: Exhorto detalles
          const exhortoRows = await db
            .from('case_exhortos')
            .select('id, rol_destino, jwt_detalle:estado_exhorto')
            .eq('case_id', caseId)

          for (const exhortoEntry of pkg.exhortos.filter(e => e.jwt_detalle)) {
            try {
              emit('progress', { message: `Obteniendo exhorto ${exhortoEntry.rol_destino}…`, current: 0, total: 0 })
              const html = await pjud.fetchExhortoDetalleHtml(exhortoEntry.jwt_detalle!, pkg.cookies)
              if (!html) continue

              const docs = parseExhortoDetalleFromHtml(html)
              const exhortoRow = (exhortoRows.data ?? []).find(e => e.rol_destino === exhortoEntry.rol_destino)
              if (exhortoRow) {
                const docIds = await insertExhortoDocs(db, user.id, caseId, exhortoRow.id, docs)
                buildExhortoDocTasks(downloadTasks, docs, docIds, pkg.rol, exhortoEntry.rol_destino)
              }
              console.log(`[sync] Exhorto "${exhortoEntry.rol_destino}": ${docs.length} docs`)
            } catch (err) {
              console.error(`[sync] Error exhorto "${exhortoEntry.rol_destino}":`, err)
            }
          }

          // Folio anexos solicitud (de todos los cuadernos)
          await fetchAllFolioAnexos(db, pjud, user.id, caseId, pkg, parsedOtrosCuadernos, downloadTasks, emit)

          // PASO 8: Remisiones
          for (let i = 0; i < pkg.remisiones.length; i++) {
            const rem = pkg.remisiones[i]
            const label = `${rem.descripcion_tramite} ${rem.fecha_tramite}`
            try {
              emit('progress', { message: `Obteniendo remisión ${i + 1}/${pkg.remisiones.length}…`, current: 0, total: 0 })
              const html = await pjud.fetchApelacionHtml(rem.jwt, pkg.cookies)
              if (!html) continue

              const detail = parseApelacionFromHtml(html)
              await insertRemision(db, pjud, user.id, caseId, rem, detail, pkg, downloadTasks, emit)
              console.log(`[sync] Remisión "${label}": ${detail.folios.length} folios`)
            } catch (err) {
              console.error(`[sync] Error remisión "${label}":`, err)
            }
          }

          // Docs directos
          buildDirectDocTasks(downloadTasks, pkg)

          // Escritos por resolver (de todos los cuadernos)
          await buildEscritosTasks(db, caseId, downloadTasks, pkg.rol)

          // Construir snapshot del estado actual (después de todas las inserciones estructuradas)
          emit('progress', { message: 'Calculando cambios…', current: 0, total: 0 })
          try {
            newSnapshot = await buildSnapshotFromDb(db, caseId)
          } catch (err) {
            console.error('[sync] Error building snapshot:', err)
          }

          emit('progress', { message: 'Iniciando descarga de documentos…', current: 0, total: downloadTasks.length })
          console.log(`[sync] ${pkg.rol} — ${downloadTasks.length} PDFs a descargar`)
        }

        // ── PASO 10: DESCARGAR PDFs ──
        const totalTasks = downloadTasks.length
        const results: SyncedDocument[] = []
        const errors: string[] = []
        const failedTasks: PdfDownloadTask[] = []
        const skippedTasks: PdfDownloadTask[] = []
        let existingCount = 0
        let failedCount = 0
        let skippedCount = 0
        let timedOut = false

        for (let i = 0; i < downloadTasks.length; i++) {
          const task = downloadTasks[i]

          if (task.skip_reason) {
            skippedCount++
            skippedTasks.push(task)
            continue
          }

          if ((task.retry_count ?? 0) >= MAX_TASK_RETRIES) {
            task.skip_reason = 'max_retries'
            skippedCount++
            skippedTasks.push(task)
            console.warn(`[sync] ${task.filename}: max retries (${MAX_TASK_RETRIES}) reached, skipping permanently`)
            continue
          }

          if (Date.now() - startTime > SYNC_TIMEOUT_MS) {
            const pendingTasks = [...downloadTasks.slice(i)]
            await db.from('cases').update({ pending_sync_tasks: pendingTasks as unknown as Json }).eq('id', caseId)
            timedOut = true
            console.log(`[sync] Timeout — ${pendingTasks.length} tasks saved for resume`)
            emit('progress', { message: `Continuará automáticamente (${pendingTasks.length} pendientes)…`, current: i, total: totalTasks })
            break
          }

          emit('progress', { message: 'Sincronizando documentos…', current: i + 1, total: totalTasks })

          try {
            const result = await processOneDocument(
              pjud, db, user.id, caseId, task,
              { rol: pkg.rol, tribunal: pkg.tribunal, caratula: pkg.caratula },
            )
            if (result === 'duplicate') existingCount++
            else if (result === 'unsupported_format') {
              task.skip_reason = 'unsupported_format'
              skippedCount++
              skippedTasks.push(task)
            }
            else if (result === 'failed') {
              failedCount++
              task.retry_count = (task.retry_count ?? 0) + 1
              failedTasks.push(task)
            }
            else results.push(result)
          } catch (err) {
            failedCount++
            task.retry_count = (task.retry_count ?? 0) + 1
            failedTasks.push(task)
            const msg = err instanceof Error ? err.message : String(err)
            errors.push(`${task.filename}: ${msg}`)
            console.error(`[sync] Error procesando ${task.filename}:`, err)
          }
        }

        // ── PASO 11: STATS + COMPLETE ──
        emit('progress', { message: 'Actualizando estadísticas…', current: totalTasks, total: totalTasks })

        const { count: docCount } = await db
          .from('documents')
          .select('id', { count: 'exact', head: true })
          .eq('case_id', caseId)

        const caseUpdate: Record<string, unknown> = {
          document_count: docCount ?? 0,
          last_synced_at: new Date().toISOString(),
        }

        if (newSnapshot) {
          caseUpdate.sync_snapshot = newSnapshot
        }

        if (timedOut) {
          // timeout already saved remaining tasks above
        } else if (failedTasks.length > 0) {
          const retryableTasks = failedTasks.filter(t => (t.retry_count ?? 0) < MAX_TASK_RETRIES)
          if (retryableTasks.length > 0) {
            caseUpdate.pending_sync_tasks = retryableTasks
            console.log(`[sync] ${retryableTasks.length} failed tasks saved for retry (${failedTasks.length - retryableTasks.length} exhausted max retries)`)
          } else {
            caseUpdate.pending_sync_tasks = null
            console.log(`[sync] All ${failedTasks.length} failed tasks exhausted max retries, clearing pending`)
          }
        } else {
          caseUpdate.pending_sync_tasks = null
        }

        if (skippedTasks.length > 0) {
          console.log(`[sync] ${skippedTasks.length} task(s) skipped: ${skippedTasks.map(t => `${t.filename} (${t.skip_reason})`).join(', ')}`)
        }

        await db.from('cases').update(caseUpdate).eq('id', caseId)
        invalidateCaseContextCache(caseId)

        // Trigger procesamiento async
        const pipelineKey = process.env.PIPELINE_SECRET_KEY
        const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
        if (pipelineKey && results.length > 0) {
          for (const doc of results) {
            fetch(`${appUrl}/api/pipeline/process-document`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Pipeline-Key': pipelineKey },
              body: JSON.stringify({ document_id: doc.document_id }),
            }).catch(() => {})
          }
        }

        const retryablePending = !timedOut
          ? failedTasks.filter(t => (t.retry_count ?? 0) < MAX_TASK_RETRIES)
          : []
        const failedSavedForRetry = retryablePending.length > 0

        // Generar diff entre snapshot anterior y actual
        const isFirstSync = !prevSnapshot
        let changes: SyncChange[] = []
        if (!isFirstSync && newSnapshot) {
          try {
            changes = generateDiff(prevSnapshot!, newSnapshot)
            console.log(`[sync] Diff: ${changes.length} cambio(s) detectado(s)`)
            if (changes.length > 0) {
              await db.from('cases')
                .update({ last_sync_changes: changes } as any)
                .eq('id', caseId)
            }
          } catch (err) {
            console.error('[sync] Error generating diff:', err)
          }
        }

        const syncResult: SyncResult = {
          success: true,
          case_id: caseId,
          rol: pkg.rol,
          tribunal: pkg.tribunal,
          documents_new: results,
          documents_existing: existingCount,
          documents_failed: failedCount,
          total_downloaded: results.length,
          errors,
          duration_ms: Date.now() - startTime,
          changes,
          is_first_sync: isFirstSync,
          has_pending: timedOut || failedSavedForRetry,
          pending_count: timedOut
            ? downloadTasks.length - (results.length + existingCount + failedCount + skippedCount)
            : retryablePending.length,
          failed_saved_for_retry: failedSavedForRetry,
        }

        console.log(
          `[sync] ${pkg.rol} — ${timedOut ? 'Parcial' : 'Completado'} en ${syncResult.duration_ms}ms: ` +
          `${results.length} nuevos, ${existingCount} existentes, ${failedCount} fallidos, ${skippedCount} omitidos` +
          (timedOut ? ` | ${syncResult.pending_count} pendientes` : '') +
          (failedSavedForRetry ? ` | ${retryablePending.length} guardados para reintento` : '')
        )

        if (skippedCount > 0) {
          const formatSkipped = skippedTasks.filter(t => t.skip_reason === 'unsupported_format')
          const retrySkipped = skippedTasks.filter(t => t.skip_reason === 'max_retries')
          emit('skipped', {
            count: skippedCount,
            unsupported_format: formatSkipped.length,
            max_retries: retrySkipped.length,
            message: `${skippedCount} documento(s) omitidos`
              + (formatSkipped.length ? ` (${formatSkipped.length} formato no soportado)` : '')
              + (retrySkipped.length ? ` (${retrySkipped.length} reintentos agotados)` : ''),
            filenames: skippedTasks.map(t => t.filename),
          })
        }

        if (failedSavedForRetry) {
          emit('failed_saved', {
            count: retryablePending.length,
            message: `${retryablePending.length} documento(s) no pudieron descargarse y se reintentarán automáticamente.`,
            filenames: retryablePending.map(t => t.filename),
          })
        }

        emit('complete', syncResult)
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Error interno del servidor'
        console.error('[sync] Error fatal:', error)
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

async function upsertCase(db: SupabaseAdmin, userId: string, pkg: CausaPackage): Promise<string | null> {
  const tribunalNorm = pkg.tribunal || ''
  const procedimiento = normalizeProcedimiento(pkg.cuaderno_visible.procedimiento)

  const { data: candidates } = await db
    .from('cases')
    .select('id, tribunal')
    .eq('user_id', userId)
    .eq('rol', pkg.rol)

  const existingCase = candidates?.find(c => (c.tribunal || '') === tribunalNorm)

  // Re-sync: causa ya existe → solo actualizar metadata
  if (existingCase) {
    const update: Record<string, string | null> = { last_synced_at: new Date().toISOString() }
    if (pkg.tribunal) update.tribunal = pkg.tribunal
    if (pkg.caratula) update.caratula = pkg.caratula
    if (pkg.materia) update.materia = pkg.materia
    if (pkg.estado_adm) update.estado = pkg.estado_adm
    if (pkg.ubicacion) update.ubicacion = pkg.ubicacion
    if (pkg.fecha_ingreso) update.fecha_ingreso = pkg.fecha_ingreso
    if (pkg.estado_procesal) update.estado_procesal = pkg.estado_procesal
    if (pkg.libro_tipo) update.libro_tipo = pkg.libro_tipo
    if (procedimiento) update.procedimiento = procedimiento

    await db.from('cases').update(update).eq('id', existingCase.id)
    return existingCase.id
  }

  // Primera sync: verificar que el plan permite crear otra causa
  const planCheck = await checkPlanLimits(userId, 'case')
  if (!planCheck.allowed) {
    console.warn(`[sync] Plan limit reached for user ${userId}: ${planCheck.error}`)
    throw new PlanLimitError(planCheck.error ?? 'Límite de causas alcanzado')
  }

  const newCase: CaseInsert = {
    user_id: userId,
    rol: pkg.rol,
    tribunal: pkg.tribunal,
    caratula: pkg.caratula,
    materia: pkg.materia,
    estado: pkg.estado_adm,
    ubicacion: pkg.ubicacion,
    fecha_ingreso: pkg.fecha_ingreso,
    estado_procesal: pkg.estado_procesal,
    libro_tipo: pkg.libro_tipo,
    procedimiento,
    last_synced_at: new Date().toISOString(),
  }

  const { data: created, error } = await db.from('cases').insert(newCase).select('id').single()

  if (error) {
    if (error.message.includes('unique') || error.message.includes('duplicate')) {
      const { data: retry } = await db.from('cases').select('id, tribunal').eq('user_id', userId).eq('rol', pkg.rol)
      const raceCase = retry?.find(c => (c.tribunal || '') === tribunalNorm)
      if (raceCase) return raceCase.id
    }
    console.error('[sync] Error creando causa:', error)
    return null
  }

  await incrementPlanCounter(userId, 'case')
  return created.id
}

// ════════════════════════════════════════════════════════
// CLEAN STRUCTURED DATA (antes de re-sync)
// ════════════════════════════════════════════════════════

async function cleanStructuredData(db: SupabaseAdmin, caseId: string): Promise<void> {
  await db.from('case_remision_mov_anexos').delete().eq('case_id', caseId)
  await db.from('case_remision_movimientos').delete().eq('case_id', caseId)
  await db.from('case_remision_litigantes').delete().eq('case_id', caseId)
  await db.from('case_remision_exhortos').delete().eq('case_id', caseId)
  await db.from('case_remision_incompetencias').delete().eq('case_id', caseId)
  await db.from('case_remisiones').delete().eq('case_id', caseId)
  await db.from('case_exhorto_docs').delete().eq('case_id', caseId)
  await db.from('case_exhortos').delete().eq('case_id', caseId)
  await db.from('case_folio_anexos').delete().eq('case_id', caseId)
  await db.from('case_piezas_exhorto').delete().eq('case_id', caseId)
  await db.from('case_escritos').delete().eq('case_id', caseId)
  await db.from('case_notificaciones').delete().eq('case_id', caseId)
  await db.from('case_litigantes').delete().eq('case_id', caseId)
  await db.from('case_folios').delete().eq('case_id', caseId)
  await db.from('case_receptor_retiros').delete().eq('case_id', caseId)
  await db.from('case_anexos_causa').delete().eq('case_id', caseId)
  await db.from('case_cuadernos').delete().eq('case_id', caseId)
}

// ════════════════════════════════════════════════════════
// INSERT CUADERNO (completo con folios + tabs)
// ════════════════════════════════════════════════════════

async function insertCuaderno(
  db: SupabaseAdmin, userId: string, caseId: string,
  cuaderno: CuadernoData, posicion: number
): Promise<string> {
  const { data: row } = await db.from('case_cuadernos').insert({
    case_id: caseId, user_id: userId,
    nombre: cuaderno.nombre,
    procedimiento: cuaderno.procedimiento,
    etapa: cuaderno.etapa,
    posicion,
  }).select('id').single()

  const cuadernoId = row!.id

  // Folios — dedup by numero_folio and batch insert with error handling
  if (cuaderno.folios.length > 0) {
    const seen = new Set<number>()
    const dedupedFolios = cuaderno.folios.filter(f => {
      if (seen.has(f.numero)) return false
      seen.add(f.numero)
      return true
    })

    const folioRows = dedupedFolios.map(f => ({
      case_id: caseId, cuaderno_id: cuadernoId, user_id: userId,
      numero_folio: f.numero, etapa: f.etapa || null, tramite: f.tramite || null,
      desc_tramite: f.desc_tramite || null, fecha_tramite: f.fecha_tramite || null,
      foja: typeof f.foja === 'number' && !isNaN(f.foja) ? f.foja : 0,
      tiene_doc_principal: !!f.tiene_doc_principal,
      tiene_certificado_escrito: !!f.tiene_certificado_escrito,
      tiene_anexo_solicitud: !!f.tiene_anexo_solicitud,
    }))

    const { error: folioErr } = await db.from('case_folios').insert(folioRows)
    if (folioErr) {
      console.error(`[sync] ERROR inserting ${folioRows.length} folios for "${cuaderno.nombre}":`, folioErr.message)
      console.error(`[sync] Sample folio data:`, JSON.stringify(folioRows[0]))
      // Fallback: insert one by one to save what we can
      let inserted = 0
      for (const row of folioRows) {
        const { error: singleErr } = await db.from('case_folios').insert(row)
        if (!singleErr) inserted++
        else console.error(`[sync] Folio ${row.numero_folio} failed:`, singleErr.message)
      }
      console.log(`[sync] Fallback: ${inserted}/${folioRows.length} folios inserted for "${cuaderno.nombre}"`)
    }
  }

  // Litigantes
  if (cuaderno.litigantes.length > 0) {
    const litRows = cuaderno.litigantes.map(l => ({
      case_id: caseId, cuaderno_id: cuadernoId, user_id: userId,
      participante: l.participante || null, rut: l.rut || null,
      persona: l.persona || null, nombre_razon_social: l.nombre_razon_social || null,
    }))
    const { error: litErr } = await db.from('case_litigantes').insert(litRows)
    if (litErr) console.error(`[sync] ERROR litigantes "${cuaderno.nombre}":`, litErr.message)
  }

  // Notificaciones
  if (cuaderno.notificaciones.length > 0) {
    const notifRows = cuaderno.notificaciones.map(n => ({
      case_id: caseId, cuaderno_id: cuadernoId, user_id: userId,
      rol: n.rol || null, estado_notif: n.estado_notif || null,
      tipo_notif: n.tipo_notif || null, fecha_tramite: n.fecha_tramite || null,
      tipo_participante: n.tipo_participante || null, nombre: n.nombre || null,
      tramite: n.tramite || null, obs_fallida: n.obs_fallida || null,
    }))
    const { error: notifErr } = await db.from('case_notificaciones').insert(notifRows)
    if (notifErr) console.error(`[sync] ERROR notificaciones "${cuaderno.nombre}":`, notifErr.message)
  }

  // Escritos
  if (cuaderno.escritos.length > 0) {
    const escRows = cuaderno.escritos.map(e => ({
      case_id: caseId, cuaderno_id: cuadernoId, user_id: userId,
      fecha_ingreso: e.fecha_ingreso || null, tipo_escrito: e.tipo_escrito || null,
      solicitante: e.solicitante || null, tiene_doc: !!e.tiene_doc, tiene_anexo: !!e.tiene_anexo,
    }))
    const { error: escErr } = await db.from('case_escritos').insert(escRows)
    if (escErr) console.error(`[sync] ERROR escritos "${cuaderno.nombre}":`, escErr.message)
  }

  // Piezas exhorto (solo tipo E)
  if (cuaderno.piezas_exhorto.length > 0) {
    const piezaRows = cuaderno.piezas_exhorto.map(p => ({
      case_id: caseId, cuaderno_id: cuadernoId, user_id: userId,
      numero_folio: p.numero_folio, cuaderno_pieza: p.cuaderno_pieza || null,
      etapa: p.etapa || null, tramite: p.tramite || null,
      desc_tramite: p.desc_tramite || null, fecha_tramite: p.fecha_tramite || null,
      foja: typeof p.foja === 'number' && !isNaN(p.foja) ? p.foja : 0,
      tiene_doc: !!p.tiene_doc, tiene_anexo: !!p.tiene_anexo,
    }))
    const { error: piezaErr } = await db.from('case_piezas_exhorto').insert(piezaRows)
    if (piezaErr) console.error(`[sync] ERROR piezas exhorto "${cuaderno.nombre}":`, piezaErr.message)
  }

  return cuadernoId
}

// ════════════════════════════════════════════════════════
// INSERT DATOS GLOBALES
// ════════════════════════════════════════════════════════

async function insertExhortos(db: SupabaseAdmin, userId: string, caseId: string, exhortos: ExhortoEntry[]): Promise<void> {
  const rows = exhortos.map(e => ({
    case_id: caseId, user_id: userId,
    rol_origen: e.rol_origen, tipo_exhorto: e.tipo_exhorto,
    rol_destino: e.rol_destino, fecha_ordena: e.fecha_ordena,
    fecha_ingreso: e.fecha_ingreso, tribunal_destino: e.tribunal_destino,
    estado_exhorto: e.estado_exhorto,
  }))
  await db.from('case_exhortos').upsert(rows, { onConflict: 'case_id,rol_destino' })
}

async function insertAnexosCausa(db: SupabaseAdmin, userId: string, caseId: string, anexos: AnexoFile[]): Promise<string[]> {
  const rows = anexos.map(a => ({
    case_id: caseId, user_id: userId,
    fecha: a.fecha, referencia: a.referencia,
  }))
  const { data } = await db.from('case_anexos_causa').insert(rows).select('id')
  return (data ?? []).map(r => r.id)
}

async function insertReceptorRetiros(db: SupabaseAdmin, userId: string, caseId: string, retiros: ReceptorRetiro[]): Promise<void> {
  const rows = retiros.map(r => ({
    case_id: caseId, user_id: userId,
    cuaderno: r.cuaderno, datos_retiro: r.datos_retiro,
    fecha_retiro: r.fecha_retiro, estado: r.estado,
  }))
  await db.from('case_receptor_retiros').insert(rows)
}

async function insertExhortoDocs(db: SupabaseAdmin, userId: string, caseId: string, exhortoId: string, docs: ExhortoDetalleDoc[]): Promise<string[]> {
  const rows = docs.map(d => ({
    case_id: caseId, exhorto_id: exhortoId, user_id: userId,
    fecha: d.fecha, referencia: d.referencia, tramite: d.tramite,
  }))
  const { data } = await db.from('case_exhorto_docs').insert(rows).select('id')
  return (data ?? []).map(r => r.id)
}

// ════════════════════════════════════════════════════════
// INSERT REMISION (completa con sub-tablas)
// ════════════════════════════════════════════════════════

async function insertRemision(
  db: SupabaseAdmin, pjud: PjudClient, userId: string, caseId: string,
  rem: { descripcion_tramite: string; fecha_tramite: string },
  detail: ApelacionDetail,
  pkg: CausaPackage,
  downloadTasks: PdfDownloadTask[],
  emit: SseEmitter,
): Promise<void> {
  const exp = detail.expediente
  const { data: remRow } = await db.from('case_remisiones').insert({
    case_id: caseId, user_id: userId,
    descripcion_tramite: rem.descripcion_tramite, fecha_tramite: rem.fecha_tramite,
    libro: detail.metadata.libro, fecha: detail.metadata.fecha,
    estado_recurso: detail.metadata.estado_recurso, estado_procesal: detail.metadata.estado_procesal,
    ubicacion: detail.metadata.ubicacion, recurso: detail.metadata.recurso, corte: detail.metadata.corte,
    tiene_certificado: !!detail.direct_jwts.certificado_envio,
    tiene_ebook: !!detail.direct_jwts.ebook,
    tiene_texto: !!detail.direct_jwts.texto,
    tiene_anexo: !!detail.direct_jwts.anexo_recurso,
    exp_causa_origen: exp?.causa_origen, exp_tribunal: exp?.tribunal,
    exp_caratulado: exp?.caratulado, exp_materia: exp?.materia,
    exp_ruc: exp?.ruc, exp_fecha_ingreso: exp?.fecha_ingreso,
  }).select('id').single()

  const remisionId = remRow!.id
  const libroLabel = detail.metadata.libro || rem.descripcion_tramite
  const cleanLibro = libroLabel.replace(/[^a-zA-Z0-9-]/g, '_').substring(0, 40)

  // Docs directos de la remisión
  if (detail.direct_jwts.ebook) {
    downloadTasks.push(jwtRefToTask(detail.direct_jwts.ebook, `${pkg.rol}_ape_${cleanLibro}_ebook.pdf`, 'remision_directo', detail.metadata.fecha, null))
  }
  if (detail.direct_jwts.certificado_envio) {
    downloadTasks.push(jwtRefToTask(detail.direct_jwts.certificado_envio, `${pkg.rol}_ape_${cleanLibro}_certificado.pdf`, 'remision_directo', detail.metadata.fecha, null))
  }
  if (detail.direct_jwts.texto) {
    downloadTasks.push(jwtRefToTask(detail.direct_jwts.texto, `${pkg.rol}_ape_${cleanLibro}_texto.pdf`, 'remision_directo', detail.metadata.fecha, null))
  }

  // Movimientos
  if (detail.folios.length > 0) {
    const movRows = detail.folios.map(f => ({
      case_id: caseId, remision_id: remisionId, user_id: userId,
      numero_folio: f.numero, tramite: f.tramite, descripcion: f.descripcion,
      nomenclaturas: f.nomenclaturas, fecha: f.fecha, sala: f.sala, estado: f.estado,
      tiene_doc: !!f.jwt_doc, tiene_certificado_escrito: !!f.jwt_certificado_escrito,
      tiene_anexo_escrito: !!f.jwt_anexo_escrito,
    }))
    await db.from('case_remision_movimientos').insert(movRows)

    for (const f of detail.folios) {
      const ct = (f.tramite || 'doc').replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ\s]/g, '').trim().substring(0, 30).replace(/\s+/g, '_')

      if (f.jwt_doc) {
        downloadTasks.push({
          jwt: f.jwt_doc.jwt, endpoint: f.jwt_doc.action, param: f.jwt_doc.param,
          filename: `${pkg.rol}_ape_${cleanLibro}_f${f.numero}_${ct}.pdf`,
          origen: 'remision_movimiento', tramite_pjud: f.tramite,
          folio: f.numero, cuaderno: `Apelación ${libroLabel}`, fecha: f.fecha, source_url: f.jwt_doc.action,
        })
      }
      if (f.jwt_certificado_escrito) {
        downloadTasks.push({
          jwt: f.jwt_certificado_escrito.jwt, endpoint: f.jwt_certificado_escrito.action, param: f.jwt_certificado_escrito.param,
          filename: `${pkg.rol}_ape_${cleanLibro}_f${f.numero}_cert.pdf`,
          origen: 'remision_movimiento', tramite_pjud: 'Certificado Escrito',
          folio: f.numero, cuaderno: `Apelación ${libroLabel}`, fecha: f.fecha, source_url: f.jwt_certificado_escrito.action,
        })
      }

      // Anexos escrito apelaciones (T9)
      if (f.jwt_anexo_escrito) {
        try {
          const html = await pjud.fetchAnexoEscritoApelacionesHtml(f.jwt_anexo_escrito, pkg.cookies)
          if (html) {
            const anexos = parseAnexoEscritoApelacionesFromHtml(html)
            if (anexos.length > 0) {
              const anexoRows = anexos.map(a => ({
                case_id: caseId, movimiento_id: remisionId, user_id: userId,
                codigo: a.codigo, tipo_documento: a.tipo_documento,
                cantidad: a.cantidad, observacion: a.observacion,
              }))
              await db.from('case_remision_mov_anexos').insert(anexoRows)

              for (let ai = 0; ai < anexos.length; ai++) {
                const a = anexos[ai]
                downloadTasks.push({
                  jwt: a.jwt.jwt, endpoint: a.jwt.action, param: a.jwt.param,
                  filename: `${pkg.rol}_ape_${cleanLibro}_f${f.numero}_anexo_${ai + 1}.pdf`,
                  origen: 'remision_mov_anexo', tramite_pjud: a.tipo_documento,
                  folio: f.numero, cuaderno: `Apelación ${libroLabel}`, fecha: null, source_url: a.jwt.action,
                })
              }
            }
          }
        } catch (err) {
          console.error(`[sync] Error anexo escrito ape folio ${f.numero}:`, err)
        }
      }
    }
  }

  // Litigantes remisión
  if (detail.tabs.litigantes.length > 0) {
    const litRows = detail.tabs.litigantes.map(l => ({
      case_id: caseId, remision_id: remisionId, user_id: userId,
      sujeto: l.sujeto, rut: l.rut, persona: l.persona,
      nombre_razon_social: l.nombre_razon_social,
    }))
    await db.from('case_remision_litigantes').insert(litRows)
  }

  // Exhortos remisión
  if (detail.tabs.exhortos.length > 0) {
    const exhRows = detail.tabs.exhortos.map(e => ({
      case_id: caseId, remision_id: remisionId, user_id: userId, exhorto: e.exhorto,
    }))
    await db.from('case_remision_exhortos').insert(exhRows)
  }

  // Incompetencia remisión
  if (detail.tabs.incompetencia.length > 0) {
    const incRows = detail.tabs.incompetencia.map(i => ({
      case_id: caseId, remision_id: remisionId, user_id: userId, incompetencia: i.incompetencia,
    }))
    await db.from('case_remision_incompetencias').insert(incRows)
  }
}

// ════════════════════════════════════════════════════════
// FETCH FOLIO ANEXOS (de todos los cuadernos)
// ════════════════════════════════════════════════════════

async function fetchAllFolioAnexos(
  db: SupabaseAdmin, pjud: PjudClient, userId: string, caseId: string,
  pkg: CausaPackage, otrosCuadernos: CuadernoData[], downloadTasks: PdfDownloadTask[], emit: SseEmitter,
): Promise<void> {
  const { data: foliosWithAnexos } = await db
    .from('case_folios')
    .select('id, numero_folio, cuaderno_id, case_id')
    .eq('case_id', caseId)
    .eq('tiene_anexo_solicitud', true)

  if (!foliosWithAnexos || foliosWithAnexos.length === 0) return

  // Mapear nombre de cuaderno → cuaderno_id para matching preciso
  const { data: cuadernoRows } = await db
    .from('case_cuadernos')
    .select('id, nombre')
    .eq('case_id', caseId)
  const cuadernoNameToId = new Map((cuadernoRows ?? []).map((c: { id: string; nombre: string }) => [c.nombre, c.id]))

  const allFolios = [
    ...pkg.cuaderno_visible.folios.map(f => ({ ...f, cuadernoNombre: pkg.cuaderno_visible.nombre })),
    ...otrosCuadernos.flatMap(c => c.folios.map(f => ({ ...f, cuadernoNombre: c.nombre }))),
  ].filter(f => f.jwt_anexo_solicitud)

  emit('progress', { message: `Obteniendo anexos de ${allFolios.length} folio(s)…`, current: 0, total: 0 })

  for (const folio of allFolios) {
    if (!folio.jwt_anexo_solicitud) continue
    try {
      const html = await pjud.fetchAnexoSolicitudHtml(folio.jwt_anexo_solicitud, pkg.cookies)
      if (!html) continue

      const anexos = parseAnexosFromHtml(html)
      const expectedCuadernoId = cuadernoNameToId.get(folio.cuadernoNombre)
      const folioRow = foliosWithAnexos.find(f =>
        f.numero_folio === folio.numero && f.cuaderno_id === expectedCuadernoId
      )

      if (folioRow && anexos.length > 0) {
        const anexoRows = anexos.map(a => ({
          case_id: caseId, folio_id: folioRow.id, user_id: userId,
          fecha: a.fecha, referencia: a.referencia,
        }))
        await db.from('case_folio_anexos').insert(anexoRows)

        const cleanCuaderno = folio.cuadernoNombre.replace(/[^a-zA-Z0-9]/g, '_')
        for (let i = 0; i < anexos.length; i++) {
          const a = anexos[i]
          const cleanRef = (a.referencia || `anexo_${i + 1}`).replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ\s]/g, '').trim().substring(0, 30).replace(/\s+/g, '_')
          downloadTasks.push({
            jwt: a.jwt.jwt, endpoint: a.jwt.action, param: a.jwt.param,
            filename: `${pkg.rol}_${cleanCuaderno}_f${folio.numero}_anexo_${i + 1}_${cleanRef}.pdf`,
            origen: 'anexo_solicitud', tramite_pjud: null,
            folio: folio.numero, cuaderno: folio.cuadernoNombre, fecha: a.fecha, source_url: a.jwt.action,
            referencia: a.referencia,
          })
        }
      }
    } catch (err) {
      console.error(`[sync] Error anexo solicitud folio ${folio.numero} [${folio.cuadernoNombre}]:`, err)
    }
  }
}

// ════════════════════════════════════════════════════════
// BUILD DOWNLOAD TASKS
// ════════════════════════════════════════════════════════

function buildFolioTasks(tasks: PdfDownloadTask[], cuaderno: CuadernoData, rol: string, cuadernoId: string): void {
  for (const f of cuaderno.folios) {
    const ct = (f.tramite || 'doc').replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ\s]/g, '').trim().substring(0, 30).replace(/\s+/g, '_')

    if (f.jwt_doc_principal) {
      tasks.push({
        jwt: f.jwt_doc_principal.jwt, endpoint: f.jwt_doc_principal.action, param: f.jwt_doc_principal.param,
        filename: `${rol}_${cuaderno.nombre.replace(/[^a-zA-Z0-9]/g, '_')}_f${f.numero}_${ct}.pdf`,
        origen: 'folio', tramite_pjud: f.tramite,
        folio: f.numero, cuaderno: cuaderno.nombre, fecha: f.fecha_tramite, source_url: f.jwt_doc_principal.action,
      })
    }
    if (f.jwt_certificado_escrito) {
      tasks.push({
        jwt: f.jwt_certificado_escrito.jwt, endpoint: f.jwt_certificado_escrito.action, param: f.jwt_certificado_escrito.param,
        filename: `${rol}_${cuaderno.nombre.replace(/[^a-zA-Z0-9]/g, '_')}_f${f.numero}_cert.pdf`,
        origen: 'folio_certificado', tramite_pjud: 'Certificado Escrito',
        folio: f.numero, cuaderno: cuaderno.nombre, fecha: f.fecha_tramite, source_url: f.jwt_certificado_escrito.action,
      })
    }
  }

  // Piezas exhorto (tipo E)
  for (const p of cuaderno.piezas_exhorto) {
    if (p.jwt_doc) {
      tasks.push({
        jwt: p.jwt_doc.jwt, endpoint: p.jwt_doc.action, param: p.jwt_doc.param,
        filename: `${rol}_pieza_f${p.numero_folio}_${(p.tramite || 'doc').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30)}.pdf`,
        origen: 'pieza_exhorto', tramite_pjud: p.tramite,
        folio: p.numero_folio, cuaderno: cuaderno.nombre, fecha: p.fecha_tramite, source_url: p.jwt_doc.action,
      })
    }
  }
}

function buildDirectDocTasks(tasks: PdfDownloadTask[], pkg: CausaPackage): void {
  if (pkg.jwt_texto_demanda) {
    tasks.push(jwtRefToTask(pkg.jwt_texto_demanda, `${pkg.rol}_texto_demanda.pdf`, 'directo', pkg.fecha_ingreso, 'Texto Demanda'))
  }
  if (pkg.jwt_certificado_envio) {
    tasks.push(jwtRefToTask(pkg.jwt_certificado_envio, `${pkg.rol}_certificado_envio.pdf`, 'directo', pkg.fecha_ingreso, 'Certificado Envío'))
  }
  if (pkg.jwt_ebook) {
    tasks.push(jwtRefToTask(pkg.jwt_ebook, `${pkg.rol}_ebook.pdf`, 'directo', null, 'Ebook'))
  }
}

function buildAnexoCausaTasks(tasks: PdfDownloadTask[], anexos: AnexoFile[], ids: string[], rol: string): void {
  for (let i = 0; i < anexos.length; i++) {
    const a = anexos[i]
    const cleanRef = (a.referencia || `anexo_${i + 1}`).replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ\s]/g, '').trim().substring(0, 30).replace(/\s+/g, '_')
    tasks.push({
      jwt: a.jwt.jwt, endpoint: a.jwt.action, param: a.jwt.param,
      filename: `${rol}_anexo_${i + 1}_${cleanRef}.pdf`,
      origen: 'anexo_causa', tramite_pjud: null,
      folio: null, cuaderno: null, fecha: a.fecha, source_url: a.jwt.action,
      referencia: a.referencia,
    })
  }
}

function buildExhortoDocTasks(tasks: PdfDownloadTask[], docs: ExhortoDetalleDoc[], ids: string[], rol: string, rolDestino: string): void {
  const cleanRol = rolDestino.replace(/[^a-zA-Z0-9-]/g, '')
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i]
    const cleanRef = (d.referencia || `doc_${i + 1}`).replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ\s]/g, '').trim().substring(0, 40).replace(/\s+/g, '_')
    tasks.push({
      jwt: d.jwt.jwt, endpoint: d.jwt.action, param: d.jwt.param,
      filename: `${rol}_exh_${cleanRol}_${i + 1}_${cleanRef}.pdf`,
      origen: 'exhorto', tramite_pjud: d.tramite,
      folio: null, cuaderno: null, fecha: d.fecha, source_url: d.jwt.action,
      referencia: d.referencia,
    })
  }
}

async function buildEscritosTasks(db: SupabaseAdmin, caseId: string, tasks: PdfDownloadTask[], rol: string): Promise<void> {
  const { data: escritos } = await db
    .from('case_escritos')
    .select('id, tipo_escrito, solicitante, tiene_doc')
    .eq('case_id', caseId)
    .eq('tiene_doc', true)

  // Escritos JWTs are in CausaPackage cuaderno_visible.escritos — already handled by folio tasks
  // This function is a placeholder for when server-side escrito processing is needed
}

function jwtRefToTask(ref: JwtRef, filename: string, origen: DocumentOrigen, fecha: string | null, tramitePjud: string | null): PdfDownloadTask {
  return {
    jwt: ref.jwt, endpoint: ref.action, param: ref.param,
    filename, origen, tramite_pjud: tramitePjud,
    folio: null, cuaderno: null, fecha, source_url: ref.action,
  }
}

// ════════════════════════════════════════════════════════
// PROCESS ONE DOCUMENT (download → dedup → upload → register)
// ════════════════════════════════════════════════════════

async function processOneDocument(
  pjud: PjudClient,
  db: SupabaseAdmin,
  userId: string,
  caseId: string,
  task: PdfDownloadTask,
  causaMeta: { rol: string; tribunal?: string | null; caratula?: string | null },
): Promise<SyncedDocument | 'duplicate' | 'failed' | 'unsupported_format'> {
  const sanitizedName = task.filename.replace(/[^a-zA-Z0-9._-]/g, '_')

  // Pre-check
  const { data: existingDoc } = await db
    .from('documents').select('id')
    .eq('case_id', caseId).eq('user_id', userId).eq('filename', sanitizedName)
    .maybeSingle()
  if (existingDoc) return 'duplicate'

  // Download
  const downloadResult = await pjud.downloadPdf(task.endpoint, task.param, task.jwt)
  if (!downloadResult.ok) {
    if (downloadResult.reason === 'unsupported_format') {
      console.warn(`[sync] ${task.filename}: formato ${downloadResult.detectedFormat} no soportado (${downloadResult.size} bytes)`)
      return 'unsupported_format'
    }
    return 'failed'
  }
  const pdf = downloadResult
  if (pdf.buffer.length > MAX_FILE_SIZE) return 'failed'

  // Hash dedup
  const fileHash = createHash('sha256').update(pdf.buffer).digest('hex')
  const { data: existingHash } = await db
    .from('document_hashes').select('id')
    .eq('user_id', userId).eq('hash', fileHash)
    .maybeSingle()
  if (existingHash) return 'duplicate'

  // Upload
  const now = new Date()
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const uniqueId = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
  const storagePath = `${userId}/${yearMonth}/${uniqueId}_${sanitizedName}`

  const { data: uploadData, error: uploadError } = await db.storage
    .from(BUCKET_NAME)
    .upload(storagePath, pdf.buffer, {
      contentType: 'application/pdf',
      cacheControl: '3600',
      upsert: false,
      duplex: 'half',
      metadata: { owner: userId, sync_source: 'api_sync', uploaded_at: now.toISOString() },
    })

  if (uploadError) {
    console.error(`[sync] Upload failed for ${task.filename}:`, uploadError)
    return 'failed'
  }

  // Insert document
  const newDoc: DocumentInsert = {
    case_id: caseId,
    user_id: userId,
    filename: sanitizedName,
    original_filename: task.filename,
    storage_path: uploadData.path,
    document_type: task.origen,
    file_size: pdf.buffer.length,
    file_hash: fileHash,
    source: 'sync',
    source_url: task.source_url || null,
    captured_at: now.toISOString(),
    origen: task.origen,
    tramite_pjud: task.tramite_pjud,
  }

  const { data: createdDoc, error: docError } = await db
    .from('documents').insert(newDoc).select('id').single()

  if (docError) {
    console.error(`[sync] Document insert failed for ${task.filename}:`, docError)
    return 'failed'
  }

  // Hash record
  await db.from('document_hashes').insert({
    user_id: userId, rol: causaMeta.rol, case_id: caseId,
    hash: fileHash, filename: sanitizedName, document_type: task.origen,
    tribunal: causaMeta.tribunal || null, caratula: causaMeta.caratula || null,
  }).then(({ error }) => {
    if (error && !error.message.includes('unique') && !error.message.includes('duplicate')) {
      console.error(`[sync] Hash error for ${task.filename}:`, error)
    }
  })

  // Extracted text placeholder
  await db.from('extracted_texts').upsert({
    document_id: createdDoc.id, case_id: caseId, user_id: userId, status: 'pending',
  } as ExtractedTextInsert, { onConflict: 'document_id' })

  return {
    document_id: createdDoc.id,
    filename: sanitizedName,
    document_type: task.origen,
    folio: task.folio,
    cuaderno: task.cuaderno,
    fecha: task.fecha,
    storage_path: uploadData.path,
    is_new: true,
  }
}
