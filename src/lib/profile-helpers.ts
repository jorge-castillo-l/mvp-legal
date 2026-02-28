/**
 * Profile Helper Functions
 * Tarea 1.04: SQL Perfiles & RLS
 * 
 * ACTUALIZACIÓN Feb 2026 — Rediseño de Planes:
 *   FREE ("Prueba Profesional" - 7 días): 1 causa, 20 chats, 3 DT, 0 escritos
 *   PRO ($50.00/mes): 500 causas, chat fair use 3,000/mes, 100 DT/mes, 200 escritos/mes
 * 
 * Funciones de utilidad para trabajar con perfiles de usuario,
 * verificar límites y manejar contadores.
 */

import { createClient } from '@/lib/supabase/server'
import { PLAN_LIMITS } from './database.types'
import type { ActionType, PlanType, Profile } from './database.types'

/**
 * Resultado tipado de la RPC check_user_limits.
 * Supabase lo devuelve como Json genérico; validamos en runtime antes de usar.
 */
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

function isCheckUserLimitsResult(value: unknown): value is CheckUserLimitsResult {
  if (value === null || value === undefined || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.allowed === 'boolean' &&
    typeof obj.current_count === 'number' &&
    typeof obj.plan === 'string' &&
    (obj.plan === 'free' || obj.plan === 'pro')
  )
}

/**
 * Obtiene el perfil del usuario actual
 */
export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient()
  
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !user) {
    return null
  }

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
 * 
 * Para PRO chat: si fair_use_throttle es true, el middleware (4.04)
 * debe aplicar un delay de throttle_ms antes de procesar la request.
 * El usuario NO se bloquea, solo se ralentiza.
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
    return {
      allowed: false,
      error: 'Error verificando límites',
      current_count: 0,
      plan: 'free',
    }
  }

  if (!isCheckUserLimitsResult(data)) {
    console.error('check_user_limits devolvió forma inesperada:', data)
    return FALLBACK_DENIED
  }

  return data
}

/**
 * Incrementa un contador de uso.
 * Lanza error si el usuario alcanzó su límite.
 * 
 * Nota: Para PRO chat, increment_counter siempre funciona
 * (Fair Use no bloquea). El throttle se aplica en el middleware.
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

  if (error) {
    return {
      success: false,
      error: error.message,
    }
  }

  return {
    success: true,
  }
}

/**
 * Actualiza el device fingerprint del usuario
 * Útil para control de multicuentas (Tarea 24)
 */
export async function updateDeviceFingerprint(
  userId: string,
  fingerprint: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  
  const { error } = await supabase
    .from('profiles')
    .update({
      device_fingerprint: fingerprint,
      last_active_date: new Date().toISOString(),
    })
    .eq('id', userId)

  if (error) {
    return {
      success: false,
      error: error.message,
    }
  }

  return {
    success: true,
  }
}

/**
 * Actualiza last_active_date del usuario
 * Se debe llamar en cada interacción importante
 */
export async function updateLastActive(
  userId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  
  const { error } = await supabase
    .from('profiles')
    .update({
      last_active_date: new Date().toISOString(),
    })
    .eq('id', userId)

  if (error) {
    return {
      success: false,
      error: error.message,
    }
  }

  return {
    success: true,
  }
}

/**
 * Verifica si un device fingerprint ya existe en usuarios FREE
 * Para prevenir multicuentas (incluye cuentas expiradas por The Reaper)
 */
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

  if (error) {
    // No existe (es esperado en la mayoría de casos)
    return { exists: false }
  }

  return {
    exists: true,
    userId: data?.id,
  }
}

/**
 * Obtiene estadísticas del perfil del usuario.
 * Útil para mostrar en el Dashboard y en el Sidepanel de la Extensión.
 * 
 * Incluye lógica de Fair Use para usuarios PRO y
 * notificaciones de expiración para FREE.
 */
export async function getProfileStats(_userId: string): Promise<{
  plan: 'free' | 'pro'
  price: string
  chats: {
    used: number
    limit: number | 'unlimited'
    remaining: number | 'unlimited'
    monthlyUsed?: number
    fairUseStatus?: 'normal' | 'warning' | 'throttled'
    fairUseSoftCap?: number
  }
  deepThinking: {
    used: number
    monthlyUsed?: number
    limit: number
    remaining: number
  }
  editor: {
    used: number
    monthlyUsed?: number
    limit: number
    remaining: number
  }
  cases: {
    used: number
    limit: number
    remaining: number
  }
  accountAge: number
  expiresIn?: number
  trialNotification?: {
    type: 'info' | 'warning' | 'urgent' | 'expired'
    message: string
    daysLeft: number
  }
} | null> {
  const profile = await getCurrentProfile()
  
  if (!profile) {
    return null
  }

  const accountAge = Math.floor(
    (Date.now() - new Date(profile.created_at).getTime()) / (1000 * 60 * 60 * 24)
  )

  const daysSinceActive = Math.floor(
    (Date.now() - new Date(profile.last_active_date).getTime()) / (1000 * 60 * 60 * 24)
  )

  // ═══════════════════════════════════════════
  // Stats para usuarios FREE
  // ═══════════════════════════════════════════
  if (profile.plan_type === 'free') {
    const expiresIn = Math.max(0, PLAN_LIMITS.free.retention_days - daysSinceActive)

    // Generar notificación de trial según los días restantes
    let trialNotification: {
      type: 'info' | 'warning' | 'urgent' | 'expired'
      message: string
      daysLeft: number
    } | undefined

    if (expiresIn <= 0) {
      trialNotification = {
        type: 'expired',
        message: 'Tu prueba ha expirado. Tus documentos fueron eliminados. Actualiza a Pro para re-sincronizar tu causa desde PJud en segundos.',
        daysLeft: 0,
      }
    } else if (expiresIn <= 1) {
      trialNotification = {
        type: 'urgent',
        message: `Última oportunidad: tu causa se elimina en menos de 24 horas.`,
        daysLeft: expiresIn,
      }
    } else if (expiresIn <= 2) {
      trialNotification = {
        type: 'warning',
        message: `Tu causa expira en ${expiresIn} día(s). Actualiza a Pro para mantener tus datos.`,
        daysLeft: expiresIn,
      }
    } else if (profile.chat_count >= PLAN_LIMITS.free.chats) {
      trialNotification = {
        type: 'warning',
        message: `Has agotado tus consultas gratuitas. Tu causa sigue aquí por ${expiresIn} días más.`,
        daysLeft: expiresIn,
      }
    }

    return {
      plan: 'free',
      price: 'Gratis',
      chats: {
        used: profile.chat_count,
        limit: PLAN_LIMITS.free.chats,
        remaining: Math.max(0, PLAN_LIMITS.free.chats - profile.chat_count),
      },
      deepThinking: {
        used: profile.deep_thinking_count,
        limit: PLAN_LIMITS.free.deep_thinking,
        remaining: Math.max(0, PLAN_LIMITS.free.deep_thinking - profile.deep_thinking_count),
      },
      editor: {
        used: 0,
        limit: PLAN_LIMITS.free.editor,
        remaining: 0,
      },
      cases: {
        used: profile.case_count,
        limit: PLAN_LIMITS.free.cases,
        remaining: Math.max(0, PLAN_LIMITS.free.cases - profile.case_count),
      },
      accountAge,
      expiresIn,
      trialNotification,
    }
  }

  // ═══════════════════════════════════════════
  // Stats para usuarios PRO
  // ═══════════════════════════════════════════
  const monthlyChatCount = profile.monthly_chat_count
  const monthlyDTCount = profile.monthly_deep_thinking_count
  const monthlyEditorCount = (profile as Record<string, unknown>).monthly_editor_count as number ?? 0
  const softCap = PLAN_LIMITS.pro.fair_use.chat_soft_cap_monthly

  // Determinar estado de Fair Use
  let fairUseStatus: 'normal' | 'warning' | 'throttled' = 'normal'
  if (monthlyChatCount >= softCap) {
    fairUseStatus = 'throttled'
  } else if (monthlyChatCount >= softCap * 0.8) {
    // Warning al 80% del soft cap (2,400 chats)
    fairUseStatus = 'warning'
  }

  return {
    plan: 'pro',
    price: '$50.00/mes',
    chats: {
      used: profile.chat_count,
      limit: 'unlimited' as const,
      remaining: 'unlimited' as const,
      monthlyUsed: monthlyChatCount,
      fairUseStatus,
      fairUseSoftCap: softCap,
    },
    deepThinking: {
      used: profile.deep_thinking_count,
      monthlyUsed: monthlyDTCount,
      limit: PLAN_LIMITS.pro.deep_thinking,
      remaining: Math.max(0, PLAN_LIMITS.pro.deep_thinking - monthlyDTCount),
    },
    editor: {
      used: monthlyEditorCount,
      monthlyUsed: monthlyEditorCount,
      limit: PLAN_LIMITS.pro.editor,
      remaining: Math.max(0, PLAN_LIMITS.pro.editor - monthlyEditorCount),
    },
    cases: {
      used: profile.case_count,
      limit: PLAN_LIMITS.pro.cases,
      remaining: Math.max(0, PLAN_LIMITS.pro.cases - profile.case_count),
    },
    accountAge,
  }
}
