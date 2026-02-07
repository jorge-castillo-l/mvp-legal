/**
 * Database Types - Auto-generados para Supabase
 * Tarea 1.04: SQL Perfiles & RLS
 * 
 * ACTUALIZACIÓN Feb 2026:
 *   FREE ("Prueba Profesional" - 7 días): 1 causa, 20 chats, 3 DT
 *   PRO ($50.00/mes): 500 causas, chat fair use 3,000/mes, 100 DT/mes
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string | null
          plan_type: 'free' | 'pro'
          chat_count: number
          deep_thinking_count: number
          monthly_chat_count: number
          monthly_deep_thinking_count: number
          monthly_reset_date: string
          case_count: number
          device_fingerprint: string | null
          last_active_date: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email?: string | null
          plan_type?: 'free' | 'pro'
          chat_count?: number
          deep_thinking_count?: number
          monthly_chat_count?: number
          monthly_deep_thinking_count?: number
          monthly_reset_date?: string
          case_count?: number
          device_fingerprint?: string | null
          last_active_date?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string | null
          plan_type?: 'free' | 'pro'
          chat_count?: number
          deep_thinking_count?: number
          monthly_chat_count?: number
          monthly_deep_thinking_count?: number
          monthly_reset_date?: string
          case_count?: number
          device_fingerprint?: string | null
          last_active_date?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey"
            columns: ["id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_user_limits: {
        Args: {
          user_id: string
          action_type: 'chat' | 'deep_thinking' | 'case'
        }
        Returns: {
          allowed: boolean
          error?: string
          message?: string
          current_count: number
          monthly_count?: number
          monthly_remaining?: number
          limit?: number
          remaining?: number
          plan: 'free' | 'pro'
          upgrade_required?: boolean
          fair_use_throttle?: boolean
          throttle_ms?: number
        }
      }
      increment_counter: {
        Args: {
          user_id: string
          counter_type: 'chat' | 'deep_thinking' | 'case'
        }
        Returns: boolean
      }
      maybe_reset_monthly_counters: {
        Args: {
          user_id: string
        }
        Returns: void
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

// Helper Types
export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
export type Enums<T extends keyof Database['public']['Enums']> = Database['public']['Enums'][T]

// Specific Types
export type Profile = Tables<'profiles'>

/**
 * Plan Limits Constants
 * 
 * ACTUALIZACIÓN Feb 2026 — Rediseño "Prueba Profesional" + Fair Use:
 * 
 * FREE ("Prueba Profesional" - 7 días):
 *   - 1 causa, 20 chats (lifetime), 3 deep thinking (lifetime)
 *   - 7 días de retención, luego The Reaper borra datos
 *   - Ghost card: se conserva metadata de causa (ROL, tribunal, carátula)
 *   - Device fingerprint impide re-crear cuenta free
 * 
 * PRO ($50.00/mes):
 *   - 500 causas, chat con Fair Use (soft cap 3,000/mes)
 *   - 100 deep thinking por mes, editor ilimitado
 *   - Fair Use: al superar 3,000 chats/mes se aplica throttle
 *     de 30s entre queries (no se bloquea, se ralentiza)
 *   - Retención permanente de datos
 */
export const PLAN_LIMITS = {
  free: {
    cases: 1,
    chats: 20,
    deep_thinking: 3,
    retention_days: 7,
    price_usd: 0,
  },
  pro: {
    cases: 500,
    chats: Infinity,
    deep_thinking: 100,  // por mes
    retention_days: Infinity,
    price_usd: 50,
    fair_use: {
      chat_soft_cap_monthly: 3_000,
      throttle_ms: 30_000,  // 30 segundos entre queries al superar soft cap
    },
  },
} as const

export type PlanType = 'free' | 'pro'
export type ActionType = 'chat' | 'deep_thinking' | 'case'
