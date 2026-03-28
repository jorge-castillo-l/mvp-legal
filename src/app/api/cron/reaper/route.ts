/**
 * ============================================================
 * API Route: /api/cron/reaper — Tarea 2.05
 * ============================================================
 * Limpieza nocturna de datos de usuarios FREE inactivos (>7 días).
 *
 * Diseñado para ser disparado por un cron externo (GitHub Actions,
 * Vercel Cron, etc.) con un secret de autorización.
 *
 * Flujo por usuario elegible:
 *   1. Obtener storage_paths de sus documentos
 *   2. Eliminar PDFs del bucket case-files
 *   3. DELETE cases → CASCADE limpia todas las tablas dependientes
 *   4. Preservar profile (ghost account) con case_count = 0
 *
 * Query params:
 *   ?dryRun=true  — Solo reporta qué eliminaría, sin borrar nada
 * ============================================================
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const maxDuration = 300

const RETENTION_DAYS = 7
const STORAGE_BATCH_SIZE = 100

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('Authorization')
  const expectedSecret = process.env.CRON_SECRET

  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dryRun = request.nextUrl.searchParams.get('dryRun') === 'true'
  const db = createAdminClient()
  const cutoffDate = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const log: string[] = []
  const push = (msg: string) => { log.push(msg); console.log(`[Reaper] ${msg}`) }

  push(`Run started — dryRun=${dryRun}, cutoff=${cutoffDate} (${RETENTION_DAYS}d)`)

  try {
    // 1. Find eligible free users inactive beyond retention period
    const { data: users, error: usersError } = await db
      .from('profiles')
      .select('id, email, last_active_date, case_count')
      .eq('plan_type', 'free')
      .lt('last_active_date', cutoffDate)

    if (usersError) {
      push(`ERROR querying profiles: ${usersError.message}`)
      return NextResponse.json({ error: usersError.message, log }, { status: 500 })
    }

    if (!users || users.length === 0) {
      push('No eligible users found. Nothing to clean.')
      return NextResponse.json({ cleaned: 0, log })
    }

    push(`Found ${users.length} eligible user(s)`)

    let totalCasesCleaned = 0
    let totalStorageRemoved = 0
    let totalErrors = 0

    for (const user of users) {
      push(`--- User ${user.email ?? user.id} (last_active: ${user.last_active_date}, cases: ${user.case_count})`)

      // 2. Get all cases for this user
      const { data: cases, error: casesError } = await db
        .from('cases')
        .select('id, rol')
        .eq('user_id', user.id)

      if (casesError || !cases?.length) {
        push(`  No cases to clean (${casesError?.message ?? '0 cases'})`)
        continue
      }

      push(`  ${cases.length} case(s) to process`)

      for (const kase of cases) {
        // 3. Get storage paths for this case's documents
        const { data: docs } = await db
          .from('documents')
          .select('storage_path')
          .eq('case_id', kase.id)

        const storagePaths = (docs ?? []).map(d => d.storage_path).filter(Boolean) as string[]

        if (dryRun) {
          push(`  [DRY] Would delete case ${kase.rol} (${storagePaths.length} PDFs)`)
          totalCasesCleaned++
          totalStorageRemoved += storagePaths.length
          continue
        }

        // 4. Delete PDFs from storage
        let storageDeleted = 0
        if (storagePaths.length > 0) {
          for (let i = 0; i < storagePaths.length; i += STORAGE_BATCH_SIZE) {
            const batch = storagePaths.slice(i, i + STORAGE_BATCH_SIZE)
            const { data: removed, error: rmError } = await db.storage
              .from('case-files')
              .remove(batch)

            if (rmError) {
              push(`  Storage batch error: ${rmError.message}`)
              totalErrors++
            } else {
              storageDeleted += removed?.length ?? 0
            }
          }
        }

        // 5. Delete the case — CASCADE cleans all dependent tables
        const { error: deleteError } = await db
          .from('cases')
          .delete()
          .eq('id', kase.id)

        if (deleteError) {
          push(`  ERROR deleting case ${kase.rol}: ${deleteError.message}`)
          totalErrors++
        } else {
          push(`  Deleted case ${kase.rol}: ${storageDeleted} PDFs removed`)
          totalCasesCleaned++
          totalStorageRemoved += storageDeleted
        }
      }

      // 6. Reset case_count on profile (ghost account preserved)
      if (!dryRun) {
        await db
          .from('profiles')
          .update({ case_count: 0 })
          .eq('id', user.id)
      }
    }

    push(`--- Complete: ${totalCasesCleaned} cases, ${totalStorageRemoved} PDFs, ${totalErrors} errors${dryRun ? ' (DRY RUN)' : ''}`)

    return NextResponse.json({
      dryRun,
      usersProcessed: users.length,
      casesCleaned: totalCasesCleaned,
      storageRemoved: totalStorageRemoved,
      errors: totalErrors,
      log,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    push(`FATAL: ${msg}`)
    return NextResponse.json({ error: msg, log }, { status: 500 })
  }
}
