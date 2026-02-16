export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      cases: {
        Row: {
          caratula: string | null
          created_at: string
          document_count: number
          estado: string | null
          id: string
          last_synced_at: string | null
          materia: string | null
          rol: string
          tribunal: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          caratula?: string | null
          created_at?: string
          document_count?: number
          estado?: string | null
          id?: string
          last_synced_at?: string | null
          materia?: string | null
          rol: string
          tribunal?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          caratula?: string | null
          created_at?: string
          document_count?: number
          estado?: string | null
          id?: string
          last_synced_at?: string | null
          materia?: string | null
          rol?: string
          tribunal?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      document_chunks: {
        Row: {
          case_id: string
          chunk_index: number
          chunk_text: string
          created_at: string
          document_id: string
          extracted_text_id: string
          id: string
          metadata: Json
          page_number: number | null
          section_type: string
          user_id: string
        }
        Insert: {
          case_id: string
          chunk_index: number
          chunk_text: string
          created_at?: string
          document_id: string
          extracted_text_id: string
          id?: string
          metadata?: Json
          page_number?: number | null
          section_type?: string
          user_id: string
        }
        Update: {
          case_id?: string
          chunk_index?: number
          chunk_text?: string
          created_at?: string
          document_id?: string
          extracted_text_id?: string
          id?: string
          metadata?: Json
          page_number?: number | null
          section_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_chunks_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_chunks_extracted_text_id_fkey"
            columns: ["extracted_text_id"]
            isOneToOne: false
            referencedRelation: "extracted_texts"
            referencedColumns: ["id"]
          },
        ]
      }
      document_embeddings: {
        Row: {
          case_id: string
          chunk_id: string
          created_at: string
          embedding: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          case_id: string
          chunk_id: string
          created_at?: string
          embedding: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          case_id?: string
          chunk_id?: string
          created_at?: string
          embedding?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_embeddings_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_embeddings_chunk_id_fkey"
            columns: ["chunk_id"]
            isOneToOne: false
            referencedRelation: "document_chunks"
            referencedColumns: ["id"]
          },
        ]
      }
      document_hashes: {
        Row: {
          caratula: string | null
          case_id: string | null
          document_type: string | null
          filename: string | null
          hash: string
          id: string
          rol: string
          tribunal: string | null
          uploaded_at: string
          user_id: string
        }
        Insert: {
          caratula?: string | null
          case_id?: string | null
          document_type?: string | null
          filename?: string | null
          hash: string
          id?: string
          rol: string
          tribunal?: string | null
          uploaded_at?: string
          user_id: string
        }
        Update: {
          caratula?: string | null
          case_id?: string | null
          document_type?: string | null
          filename?: string | null
          hash?: string
          id?: string
          rol?: string
          tribunal?: string | null
          uploaded_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_hashes_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          captured_at: string | null
          case_id: string
          created_at: string
          document_type: string
          file_hash: string | null
          file_size: number
          filename: string
          id: string
          original_filename: string | null
          source: string
          source_url: string | null
          storage_path: string
          user_id: string
        }
        Insert: {
          captured_at?: string | null
          case_id: string
          created_at?: string
          document_type?: string
          file_hash?: string | null
          file_size: number
          filename: string
          id?: string
          original_filename?: string | null
          source?: string
          source_url?: string | null
          storage_path: string
          user_id: string
        }
        Update: {
          captured_at?: string | null
          case_id?: string
          created_at?: string
          document_type?: string
          file_hash?: string | null
          file_size?: number
          filename?: string
          id?: string
          original_filename?: string | null
          source?: string
          source_url?: string | null
          storage_path?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      extracted_texts: {
        Row: {
          case_id: string
          created_at: string
          document_id: string
          extraction_method: string | null
          full_text: string
          id: string
          page_count: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          case_id: string
          created_at?: string
          document_id: string
          extraction_method?: string | null
          full_text?: string
          id?: string
          page_count?: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          case_id?: string
          created_at?: string
          document_id?: string
          extraction_method?: string | null
          full_text?: string
          id?: string
          page_count?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "extracted_texts_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extracted_texts_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      processing_queue: {
        Row: {
          attempts: number
          case_id: string
          completed_at: string | null
          created_at: string
          document_id: string
          id: string
          last_error: string | null
          max_attempts: number
          metadata: Json
          next_retry_at: string | null
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          case_id: string
          completed_at?: string | null
          created_at?: string
          document_id: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          metadata?: Json
          next_retry_at?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          case_id?: string
          completed_at?: string | null
          created_at?: string
          document_id?: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          metadata?: Json
          next_retry_at?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "processing_queue_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "processing_queue_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          case_count: number
          chat_count: number
          created_at: string
          deep_thinking_count: number
          device_fingerprint: string | null
          email: string | null
          id: string
          last_active_date: string
          monthly_chat_count: number
          monthly_deep_thinking_count: number
          monthly_reset_date: string
          plan_type: string
          updated_at: string
        }
        Insert: {
          case_count?: number
          chat_count?: number
          created_at?: string
          deep_thinking_count?: number
          device_fingerprint?: string | null
          email?: string | null
          id: string
          last_active_date?: string
          monthly_chat_count?: number
          monthly_deep_thinking_count?: number
          monthly_reset_date?: string
          plan_type?: string
          updated_at?: string
        }
        Update: {
          case_count?: number
          chat_count?: number
          created_at?: string
          deep_thinking_count?: number
          device_fingerprint?: string | null
          email?: string | null
          id?: string
          last_active_date?: string
          monthly_chat_count?: number
          monthly_deep_thinking_count?: number
          monthly_reset_date?: string
          plan_type?: string
          updated_at?: string
        }
        Relationships: []
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

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

// Alias de compatibilidad usados en rutas existentes
export type CaseInsert = TablesInsert<'cases'>
export type DocumentInsert = TablesInsert<'documents'>
export type DocumentHashInsert = TablesInsert<'document_hashes'>
export type ExtractedTextInsert = TablesInsert<'extracted_texts'>
export type DocumentChunkInsert = TablesInsert<'document_chunks'>
export type DocumentEmbeddingInsert = TablesInsert<'document_embeddings'>
export type DocumentEmbeddingRow = Tables<'document_embeddings'>
export type ProcessingQueueInsert = TablesInsert<'processing_queue'>
export type ProcessingQueueRow = Tables<'processing_queue'>
