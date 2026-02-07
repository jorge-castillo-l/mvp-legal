export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string | null
          plan_type: string
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
          plan_type?: string
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
          plan_type?: string
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
        Relationships: []
      }
      cases: {
        Row: {
          id: string
          user_id: string
          rol: string
          tribunal: string | null
          caratula: string | null
          materia: string | null
          estado: string | null
          document_count: number
          last_synced_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          rol: string
          tribunal?: string | null
          caratula?: string | null
          materia?: string | null
          estado?: string | null
          document_count?: number
          last_synced_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          rol?: string
          tribunal?: string | null
          caratula?: string | null
          materia?: string | null
          estado?: string | null
          document_count?: number
          last_synced_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cases_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      documents: {
        Row: {
          id: string
          case_id: string
          user_id: string
          filename: string
          original_filename: string | null
          storage_path: string
          document_type: string
          file_size: number
          file_hash: string | null
          source: string
          source_url: string | null
          captured_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          case_id: string
          user_id: string
          filename: string
          original_filename?: string | null
          storage_path: string
          document_type?: string
          file_size: number
          file_hash?: string | null
          source?: string
          source_url?: string | null
          captured_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          case_id?: string
          user_id?: string
          filename?: string
          original_filename?: string | null
          storage_path?: string
          document_type?: string
          file_size?: number
          file_hash?: string | null
          source?: string
          source_url?: string | null
          captured_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_case_id_fkey"
            columns: ["case_id"]
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      document_hashes: {
        Row: {
          id: string
          user_id: string
          rol: string
          hash: string
          filename: string | null
          document_type: string | null
          uploaded_at: string
        }
        Insert: {
          id?: string
          user_id: string
          rol: string
          hash: string
          filename?: string | null
          document_type?: string | null
          uploaded_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          rol?: string
          hash?: string
          filename?: string | null
          document_type?: string | null
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_hashes_user_id_fkey"
            columns: ["user_id"]
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
        Args: { action_type: string; user_id: string }
        Returns: Json
      }
      increment_counter: {
        Args: { counter_type: string; user_id: string }
        Returns: boolean
      }
      maybe_reset_monthly_counters: {
        Args: { user_id: string }
        Returns: undefined
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

// ????????????????????????????????????????????????????????
// Helper Types
// ????????????????????????????????????????????????????????

type PublicSchema = Database['public']

export type Tables<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Row']

export type TablesInsert<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Insert']

export type TablesUpdate<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Update']

// Convenience aliases
export type Profile = Tables<'profiles'>
export type Case = Tables<'cases'>
export type Document = Tables<'documents'>
export type DocumentHash = Tables<'document_hashes'>

export type CaseInsert = TablesInsert<'cases'>
export type DocumentInsert = TablesInsert<'documents'>
export type DocumentHashInsert = TablesInsert<'document_hashes'>
