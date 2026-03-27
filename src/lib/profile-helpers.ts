/**
 * Profile Helper Functions — Tarea 6.04
 *
 * 4 planes: free | basico ($20) | pro ($60) | ultra ($99)
 * 3 capas IA: fast_chat (Gemini) | full_analysis (Claude Sonnet) | deep_thinking (Claude Opus)
 */

import { createClient } from '@/lib/supabase/server'
import { PLAN_LIMITS } from './database.types'
import type { ActionType, PlanType, Profile } from './database.types'

export interface CheckUserLimitsResult {
  allowed: boolean
  error?: string
  message?: string
  current_count: number
  monthly_count?: number
  monthly_remaining?: number
  limit?: number
  remaining?: number
  plan: PlanType
  upgrade_required?: boolean
  fair_use_throttle?: boolean
  throttle_ms?: number
}

const FALLBACK_DENIED: CheckUserLimitsResult = {
  allowed: false,
  error: 'Respuesta inesperada del servidor al verificar límites',
  current_count: 0,
  plan: 'free',
}

const VALID_PLANS: readonly string[] = ['free', 'basico', 'pro', 'ultra']

function isCheckUserLimitsResult(value: unknown): value is CheckUserLimitsResult {
  if (value === null || value === undefined || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.allowed === 'boolean' &&
    typeof obj.current_count === 'number' &&
    typeof obj.plan === 'string' &&
    VALID_PLANS.includes(obj.plan)
  )
}

export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return null

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (error) {
    console.error('Error fetching profile:', error)
    return null
  }
  return profile
}

/**
 * Verifica si el usuario puede realizar una acción según su plan.
 * Para PRO/ULTRA fast_chat: si fair_use_throttle es true, el middleware
 * debe aplicar un delay de throttle_ms antes de procesar.
 */
export async function checkUserLimits(
  userId: string,
  actionType: ActionType
): Promise<CheckUserLimitsResult> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('check_user_limits', {
    user_id: userId,
    action_type: actionType,
  })

  if (error) {
    console.error('Error checking limits:', error)
    return { allowed: false, error: 'Error verificando límites', current_count: 0, plan: 'free' }
  }

  if (!isCheckUserLimitsResult(data)) {
    console.error('check_user_limits devolvió forma inesperada:', data)
    return FALLBACK_DENIED
  }

  return data
}

/**
 * Incrementa un contador de uso.
 * Lanza error si el usuario alcanzó su límite (excepto soft cap fast_chat PRO/ULTRA).
 */
export async function incrementCounter(
  userId: string,
  counterType: ActionType
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()

  const { error } = await supabase.rpc('increment_counter', {
    user_id: userId,
    counter_type: counterType,
  })

  if (error) return { success: false, error: error.message }
  return { success: true }
}

export async function updateDeviceFingerprint(
  userId: string,
  fingerprint: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('profiles')
    .update({ device_fingerprint: fingerprint, last_active_date: new Date().toISOString() })
    .eq('id', userId)

  if (error) return { success: false, error: error.message }
  return { success: true }
}

export async function updateLastActive(
  userId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('profiles')
    .update({ last_active_date: new Date().toISOString() })
    .eq('id', userId)

  if (error) return { success: false, error: error.message }
  return { success: true }
}

export async function checkFingerprintExists(
  fingerprint: string
): Promise<{ exists: boolean; userId?: string }> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('device_fingerprint', fingerprint)
    .eq('plan_type', 'free')
    .single()

  if (error) return { exists: false }
  return { exists: true, userId: data?.id }
}

// ─────────────────────────────────────────────────────────
// Helpers para plan info
// ─────────────────────────────────────────────────────────

function getPlanDisplayName(plan: PlanType): string {
  switch (plan) {
    case 'free': return 'Prueba Profesional'
    case 'basico': return 'Básico'
    case 'pro': return 'Pro'
    case 'ultra': return 'Ultra'
  }
}

function getPlanPrice(plan: PlanType): string {
  const p = PLAN_LIMITS[plan]
  return p.price_usd === 0 ? 'Gratis' : `$${p.price_usd}/mes`
}

function isPaidPlan(plan: PlanType): boolean {
  return plan !== 'free'
}

// ─────────────────────────────────────────────────────────
// Profile Stats (para UI: Dashboard + Sidepanel)
// ─────────────────────────────────────────────────────────

interface LayerStats {
  used: number
  monthlyUsed?: number
  limit: number | 'unlimited'
  remaining: number | 'unlimited'
  fairUseStatus?: 'normal' | 'warning' | 'throttled'
  fairUseSoftCap?: number
}

export interface ProfileStats {
  plan: PlanType
  planDisplayName: string
  price: string
  fastChat: LayerStats
  fullAnalysis: LayerStats
  deepThinking: LayerStats
  cases: { used: number; limit: number; remaining: number }
  accountAge: number
  expiresIn?: number
  trialNotification?: {
    type: 'info' | 'warning' | 'urgent' | 'expired'
    message: string
    daysLeft: number
  }
}

export async function getProfileStats(_userId: string): Promise<ProfileStats | null> {
  const profile = await getCurrentProfile()
  if (!profile) return null

  const plan = profile.plan_type as PlanType
  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free

  const accountAge = Math.floor(
    (Date.now() - new Date(profile.created_at).getTime()) / (1000 * 60 * 60 * 24)
  )
  const daysSinceActive = Math.floor(
    (Date.now() - new Date(profile.last_active_date).getTime()) / (1000 * 60 * 60 * 24)
  )

  const planLimits = PLAN_LIMITS[plan]
  const caseLimits = { used: profile.case_count, limit: limits.cases, remaining: Math.max(0, limits.cases - profile.case_count) }

  // ═══ FREE: lifetime counters, trial expiry ═══
  if (plan === 'free') {
    const expiresIn = Math.max(0, PLAN_LIMITS.free.retention_days - daysSinceActive)

    let trialNotification: ProfileStats['trialNotification']
    if (expiresIn <= 0) {
      trialNotification = { type: 'expired', message: 'Tu prueba ha expirado. Actualiza tu plan para re-sincronizar.', daysLeft: 0 }
    } else if (expiresIn <= 1) {
      trialNotification = { type: 'urgent', message: 'Última oportunidad: tu causa se elimina en menos de 24 horas.', daysLeft: expiresIn }
    } else if (expiresIn <= 2) {
      trialNotification = { type: 'warning', message: `Tu causa expira en ${expiresIn} día(s). Actualiza para mantener tus datos.`, daysLeft: expiresIn }
    }

    return {
      plan, planDisplayName: getPlanDisplayName(plan), price: getPlanPrice(plan),
      fastChat: {
        used: profile.fast_chat_count,
        limit: planLimits.fast_chat,
        remaining: Math.max(0, planLimits.fast_chat - profile.fast_chat_count),
      },
      fullAnalysis: {
        used: profile.full_analysis_count,
        limit: planLimits.full_analysis,
        remaining: Math.max(0, planLimits.full_analysis - profile.full_analysis_count),
      },
      deepThinking: {
        used: profile.deep_thinking_count,
        limit: planLimits.deep_thinking,
        remaining: Math.max(0, planLimits.deep_thinking - profile.deep_thinking_count),
      },
      cases: caseLimits,
      accountAge, expiresIn, trialNotification,
    }
  }

  // ═══ PAID PLANS: monthly counters ═══
  const monthlyFC = profile.monthly_fast_chat_count
  const monthlyFA = profile.monthly_full_analysis_count
  const monthlyDT = profile.monthly_deep_thinking_count

  const hasFairUse = 'fair_use' in planLimits
  const softCap = hasFairUse ? (planLimits as typeof PLAN_LIMITS.pro).fair_use.fast_chat_soft_cap_monthly : planLimits.fast_chat

  let fairUseStatus: 'normal' | 'warning' | 'throttled' = 'normal'
  if (hasFairUse) {
    if (monthlyFC >= softCap) fairUseStatus = 'throttled'
    else if (monthlyFC >= softCap * 0.8) fairUseStatus = 'warning'
  }

  return {
    plan, planDisplayName: getPlanDisplayName(plan), price: getPlanPrice(plan),
    fastChat: {
      used: profile.fast_chat_count,
      monthlyUsed: monthlyFC,
      limit: hasFairUse ? 'unlimited' : planLimits.fast_chat,
      remaining: hasFairUse ? 'unlimited' : Math.max(0, planLimits.fast_chat - monthlyFC),
      fairUseStatus: hasFairUse ? fairUseStatus : undefined,
      fairUseSoftCap: hasFairUse ? softCap : undefined,
    },
    fullAnalysis: {
      used: profile.full_analysis_count,
      monthlyUsed: monthlyFA,
      limit: planLimits.full_analysis,
      remaining: Math.max(0, planLimits.full_analysis - monthlyFA),
    },
    deepThinking: {
      used: profile.deep_thinking_count,
      monthlyUsed: monthlyDT,
      limit: planLimits.deep_thinking,
      remaining: Math.max(0, planLimits.deep_thinking - monthlyDT),
    },
    cases: caseLimits,
    accountAge,
  }
}
