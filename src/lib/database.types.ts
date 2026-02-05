/**
 * Database Types - Auto-generados para Supabase
 * Tarea 1.04: SQL Perfiles & RLS
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
          limit?: number
          remaining?: number
          plan: 'free' | 'pro'
        }
      }
      increment_counter: {
        Args: {
          user_id: string
          counter_type: 'chat' | 'deep_thinking' | 'case'
        }
        Returns: boolean
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

// Plan Limits Constants
export const PLAN_LIMITS = {
  free: {
    cases: 1,
    chats: 10,
    deep_thinking: 1,
    retention_days: 3
  },
  pro: {
    cases: 500,
    chats: Infinity,
    deep_thinking: 100,
    retention_days: Infinity
  }
} as const

export type PlanType = 'free' | 'pro'
export type ActionType = 'chat' | 'deep_thinking' | 'case'
