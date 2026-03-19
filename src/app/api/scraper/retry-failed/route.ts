/**
 * API ROUTE: /api/scraper/retry-failed
 *
 * Retries download of documents that failed during a previous sync.
 * Reads pending_sync_tasks from the case row and re-attempts each one
 * with the same dedup + upload + register pipeline.
 *
 * Called by:
 *   - Extension sidepanel (manual "Reintentar" button)
 *   - Cron/scheduled job for automatic recovery
 *
 * Auth: Bearer token (same as /api/scraper/sync).
 */

export const runtime = 'nodejs'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getCorsHeaders, handleCorsOptions } from '@/lib/cors'
import { PjudClient } from '@/lib/pjud/client'
import type {
  PdfDownloadTask,
  SyncedDocument,
} from '@/lib/pjud/types'
import type { DocumentInsert, ExtractedTextInsert } from '@/types/database'

const BUCKET_NAME = 'case-files'
const MAX_FILE_SIZE = 50 * 1024 * 1024
const RETRY_TIMEOUT_MS = 4 * 60 * 1000
const MAX_TASK_RETRIES = 3

type SupabaseAdmin = ReturnType<typeof createAdminClient>

interface RetryRequest {
  case_id: string
  cookies?: { PHPSESSID: string; TS01262d1d?: string } | null
}

interface RetryResult {
  success: boolean
  case_id: string
  documents_recovered: number
  documents_still_failed: number
  documents_duplicate: number
  total_pending_before: number
  errors: string[]
  duration_ms: number
  has_remaining: boolean
}

export async function POST(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request, { methods: 'POST, OPTIONS' })

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

  let body: RetryRequest
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Body JSON inválido' },
      { status: 400, headers: corsHeaders }
    )
  }

  if (!body.case_id) {
    return NextResponse.json(
      { error: 'Campo "case_id" es requerido' },
      { status: 400, headers: corsHeaders }
    )
  }

  const db = createAdminClient()
  const startTime = Date.now()

  const { data: caseRow } = await db
    .from('cases')
    .select('id, rol, tribunal, caratula, pending_sync_tasks')
    .eq('id', body.case_id)
    .eq('user_id', user.id)
    .single()

  if (!caseRow) {
    return NextResponse.json(
      { error: 'Causa no encontrada' },
      { status: 404, headers: corsHeaders }
    )
  }

  const tasks = caseRow.pending_sync_tasks as PdfDownloadTask[] | null
  if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
    return NextResponse.json({
      success: true, case_id: body.case_id,
      documents_recovered: 0, documents_still_failed: 0,
      documents_duplicate: 0, total_pending_before: 0,
      errors: [], duration_ms: Date.now() - startTime,
      has_remaining: false,
    } as RetryResult, { headers: corsHeaders })
  }

  const pjud = new PjudClient()
  if (body.cookies) pjud.setCookies(body.cookies)

  const totalBefore = tasks.length
  const results: SyncedDocument[] = []
  const errors: string[] = []
  const stillFailed: PdfDownloadTask[] = []
  let duplicateCount = 0
  let skippedCount = 0

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]

    if (task.skip_reason) {
      skippedCount++
      continue
    }

    if ((task.retry_count ?? 0) >= MAX_TASK_RETRIES) {
      task.skip_reason = 'max_retries'
      skippedCount++
      console.warn(`[retry] ${task.filename}: max retries (${MAX_TASK_RETRIES}) reached, skipping permanently`)
      continue
    }

    if (Date.now() - startTime > RETRY_TIMEOUT_MS) {
      stillFailed.push(...tasks.slice(i).filter(t => !t.skip_reason))
      console.log(`[retry] Timeout — ${tasks.length - i} tasks remaining`)
      break
    }

    try {
      const result = await processRetryDocument(
        pjud, db, user.id, caseRow.id, task,
        { rol: caseRow.rol, tribunal: caseRow.tribunal, caratula: caseRow.caratula },
      )
      if (result === 'duplicate') duplicateCount++
      else if (result === 'unsupported_format') {
        task.skip_reason = 'unsupported_format'
        skippedCount++
      }
      else if (result === 'failed') {
        task.retry_count = (task.retry_count ?? 0) + 1
        stillFailed.push(task)
      } else {
        results.push(result)
      }
    } catch (err) {
      task.retry_count = (task.retry_count ?? 0) + 1
      stillFailed.push(task)
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${task.filename}: ${msg}`)
      console.error(`[retry] Error ${task.filename}:`, err)
    }
  }

  const retryableTasks = stillFailed.filter(t => (t.retry_count ?? 0) < MAX_TASK_RETRIES)

  const caseUpdate: Record<string, unknown> = {
    last_synced_at: new Date().toISOString(),
  }

  if (retryableTasks.length > 0) {
    caseUpdate.pending_sync_tasks = retryableTasks
  } else {
    caseUpdate.pending_sync_tasks = null
  }

  const { count: docCount } = await db
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .eq('case_id', caseRow.id)
  caseUpdate.document_count = docCount ?? 0

  await db.from('cases').update(caseUpdate).eq('id', caseRow.id)

  // Trigger pipeline for recovered docs
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

  const retryResult: RetryResult = {
    success: true,
    case_id: caseRow.id,
    documents_recovered: results.length,
    documents_still_failed: retryableTasks.length,
    documents_duplicate: duplicateCount,
    total_pending_before: totalBefore,
    errors,
    duration_ms: Date.now() - startTime,
    has_remaining: retryableTasks.length > 0,
  }

  console.log(
    `[retry] ${caseRow.rol} — ${results.length} recovered, ${duplicateCount} dup, ${retryableTasks.length} still failed, ${skippedCount} skipped (of ${totalBefore})`
  )

  return NextResponse.json(retryResult, { headers: corsHeaders })
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsOptions(request)
}

async function processRetryDocument(
  pjud: PjudClient,
  db: SupabaseAdmin,
  userId: string,
  caseId: string,
  task: PdfDownloadTask,
  causaMeta: { rol: string; tribunal?: string | null; caratula?: string | null },
): Promise<SyncedDocument | 'duplicate' | 'failed' | 'unsupported_format'> {
  const sanitizedName = task.filename.replace(/[^a-zA-Z0-9._-]/g, '_')

  const { data: existingDoc } = await db
    .from('documents').select('id')
    .eq('case_id', caseId).eq('user_id', userId).eq('filename', sanitizedName)
    .maybeSingle()
  if (existingDoc) return 'duplicate'

  const downloadResult = await pjud.downloadPdf(task.endpoint, task.param, task.jwt)
  if (!downloadResult.ok) {
    if (downloadResult.reason === 'unsupported_format') {
      console.warn(`[retry] ${task.filename}: formato ${downloadResult.detectedFormat} no soportado (${downloadResult.size} bytes)`)
      return 'unsupported_format'
    }
    return 'failed'
  }
  const pdf = downloadResult
  if (pdf.buffer.length > MAX_FILE_SIZE) return 'failed'

  const fileHash = createHash('sha256').update(pdf.buffer).digest('hex')
  const { data: existingHash } = await db
    .from('document_hashes').select('id')
    .eq('user_id', userId).eq('hash', fileHash)
    .maybeSingle()
  if (existingHash) return 'duplicate'

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
      metadata: { owner: userId, sync_source: 'retry', uploaded_at: now.toISOString() },
    })

  if (uploadError) {
    console.error(`[retry] Upload failed for ${task.filename}:`, uploadError)
    return 'failed'
  }

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
    console.error(`[retry] Document insert failed for ${task.filename}:`, docError)
    return 'failed'
  }

  await db.from('document_hashes').insert({
    user_id: userId, rol: causaMeta.rol, case_id: caseId,
    hash: fileHash, filename: sanitizedName, document_type: task.origen,
    tribunal: causaMeta.tribunal || null, caratula: causaMeta.caratula || null,
  }).then(({ error }) => {
    if (error && !error.message.includes('unique') && !error.message.includes('duplicate')) {
      console.error(`[retry] Hash error for ${task.filename}:`, error)
    }
  })

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
