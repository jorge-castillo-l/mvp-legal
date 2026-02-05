/**
 * Profile Helper Functions
 * Tarea 1.04: SQL Perfiles & RLS
 * 
 * Funciones de utilidad para trabajar con perfiles de usuario,
 * verificar límites y manejar contadores.
 */

import { createClient } from '@/lib/supabase/server'
import type { ActionType, Profile } from './database.types'

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
 * Verifica si el usuario puede realizar una acción según su plan
 */
export async function checkUserLimits(
  userId: string,
  actionType: ActionType
): Promise<{
  allowed: boolean
  error?: string
  message?: string
  current_count: number
  limit?: number
  remaining?: number
  plan: 'free' | 'pro'
}> {
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

  return data
}

/**
 * Incrementa un contador de uso
 * Lanza error si el usuario alcanzó su límite
 */
export async function incrementCounter(
  userId: string,
  counterType: ActionType
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  
  const { data, error } = await supabase.rpc('increment_counter', {
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
 * Para prevenir multicuentas
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
 * Obtiene estadísticas del perfil del usuario
 * Útil para mostrar en el Dashboard
 */
export async function getProfileStats(userId: string): Promise<{
  plan: 'free' | 'pro'
  chats: {
    used: number
    limit: number | 'unlimited'
    remaining: number | 'unlimited'
  }
  deepThinking: {
    used: number
    limit: number
    remaining: number
  }
  cases: {
    used: number
    limit: number
    remaining: number
  }
  accountAge: number // días
  expiresIn?: number // días (solo para FREE)
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

  const stats = {
    plan: profile.plan_type,
    chats: {
      used: profile.chat_count,
      limit: profile.plan_type === 'free' ? 10 : ('unlimited' as const),
      remaining: profile.plan_type === 'free' ? Math.max(0, 10 - profile.chat_count) : ('unlimited' as const),
    },
    deepThinking: {
      used: profile.deep_thinking_count,
      limit: profile.plan_type === 'free' ? 1 : 100,
      remaining: profile.plan_type === 'free' 
        ? Math.max(0, 1 - profile.deep_thinking_count)
        : Math.max(0, 100 - profile.deep_thinking_count),
    },
    cases: {
      used: profile.case_count,
      limit: profile.plan_type === 'free' ? 1 : 500,
      remaining: profile.plan_type === 'free'
        ? Math.max(0, 1 - profile.case_count)
        : Math.max(0, 500 - profile.case_count),
    },
    accountAge,
  }

  // Para usuarios FREE, calcular días restantes antes del borrado
  if (profile.plan_type === 'free') {
    const expiresIn = Math.max(0, 3 - daysSinceActive)
    return {
      ...stats,
      expiresIn,
    }
  }

  return stats
}
