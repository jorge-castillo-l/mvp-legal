/**
 * Plan Guard — Tarea 4.04
 *
 * Helper que unifica check de límites + increment + response format.
 * Se llama desde cada API route que consume cuota del plan.
 */

import { createAdminClient } from '@/lib/supabase/server'
import type { ActionType, PlanType } from './database.types'

export interface PlanCheckResult {
  allowed: boolean
  error?: string
  code?: 'PLAN_LIMIT_EXCEEDED' | 'PLAN_THROTTLED' | 'PROFILE_NOT_FOUND'
  plan: PlanType
  current_count: number
  monthly_count?: number
  limit?: number
  remaining?: number | 'unlimited'
  upgrade_required?: boolean
  fair_use_throttle?: boolean
  throttle_ms?: number
}

/**
 * Verifica si el usuario puede realizar la acción según su plan.
 * Usa admin client para bypasear RLS (las funciones SQL son SECURITY DEFINER).
 */
export async function checkPlanLimits(
  userId: string,
  actionType: ActionType,
): Promise<PlanCheckResult> {
  const supabase = createAdminClient()

  const { data, error } = await supabase.rpc('check_user_limits', {
    user_id: userId,
    action_type: actionType,
  })

  if (error) {
    console.error('[plan-guard] check_user_limits error:', error.message)
    return {
      allowed: false,
      error: 'Error verificando límites del plan',
      code: 'PROFILE_NOT_FOUND',
      plan: 'free',
      current_count: 0,
    }
  }

  const result = data as Record<string, unknown>

  if (result.allowed === false) {
    return {
      allowed: false,
      error: result.error as string,
      code: 'PLAN_LIMIT_EXCEEDED',
      plan: (result.plan as PlanType) ?? 'free',
      current_count: (result.current_count as number) ?? 0,
      monthly_count: result.monthly_count as number | undefined,
      limit: result.limit as number | undefined,
      upgrade_required: (result.upgrade_required as boolean) ?? false,
    }
  }

  if (result.fair_use_throttle === true) {
    return {
      allowed: true,
      plan: result.plan as PlanType,
      current_count: (result.current_count as number) ?? 0,
      monthly_count: result.monthly_count as number | undefined,
      fair_use_throttle: true,
      throttle_ms: (result.throttle_ms as number) ?? 30_000,
      code: 'PLAN_THROTTLED',
    }
  }

  return {
    allowed: true,
    plan: (result.plan as PlanType) ?? 'free',
    current_count: (result.current_count as number) ?? 0,
    monthly_count: result.monthly_count as number | undefined,
    remaining: (result.remaining ?? result.monthly_remaining) as number | 'unlimited' | undefined,
  }
}

/**
 * Incrementa el contador de uso tras una operación exitosa.
 * Llamar DESPUÉS de que la operación se haya procesado.
 */
export async function incrementPlanCounter(
  userId: string,
  actionType: ActionType,
): Promise<{ success: boolean; error?: string }> {
  const supabase = createAdminClient()

  const { error } = await supabase.rpc('increment_counter', {
    user_id: userId,
    counter_type: actionType,
  })

  if (error) {
    console.error('[plan-guard] increment_counter error:', error.message)
    return { success: false, error: error.message }
  }

  return { success: true }
}

/**
 * Mapea AIMode a ActionType.
 */
export function modeToActionType(mode: string): ActionType {
  switch (mode) {
    case 'fast_chat': return 'fast_chat'
    case 'full_analysis': return 'full_analysis'
    case 'deep_thinking': return 'deep_thinking'
    default: return 'fast_chat'
  }
}

/**
 * Genera JSON body para respuesta 429.
 */
export function planLimitErrorBody(result: PlanCheckResult) {
  return {
    error: result.error ?? 'Límite de plan alcanzado',
    code: result.code ?? 'PLAN_LIMIT_EXCEEDED',
    plan: result.plan,
    current_count: result.current_count,
    monthly_count: result.monthly_count,
    limit: result.limit,
    upgrade_required: result.upgrade_required ?? true,
  }
}
