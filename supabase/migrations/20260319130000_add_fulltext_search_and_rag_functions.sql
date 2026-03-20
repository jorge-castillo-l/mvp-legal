-- ============================================================================
-- MIGRACIÓN: Full-text search + funciones RPC para RAG
-- ============================================================================
-- Tarea 3.02 (Cerebro — RAG Pipeline):
--   1) Columna search_vector tsvector en document_chunks para BM25
--   2) Índice GIN para full-text search eficiente
--   3) Trigger para mantener search_vector actualizado
--   4) RPC match_case_chunks_vector: cosine similarity filtrada por case_id
--   5) RPC match_case_chunks_text: full-text search filtrada por case_id
--
-- Dependencias:
--   - 20260215120000_create_extracted_texts_and_document_chunks.sql
--   - 20260216140000_create_document_embeddings.sql
-- ============================================================================


-- 1. FULL-TEXT SEARCH EN DOCUMENT_CHUNKS
-- ============================================================================

ALTER TABLE public.document_chunks
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE INDEX IF NOT EXISTS document_chunks_search_vector_gin_idx
  ON public.document_chunks USING gin (search_vector);

-- Trigger: auto-populate search_vector al insertar o actualizar chunk_text.
-- Usa configuración 'spanish' para stemming en español (built-in en Postgres).
CREATE OR REPLACE FUNCTION public.document_chunks_search_vector_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.search_vector := to_tsvector('spanish', COALESCE(NEW.chunk_text, ''));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS document_chunks_search_vector_trigger ON public.document_chunks;
CREATE TRIGGER document_chunks_search_vector_trigger
  BEFORE INSERT OR UPDATE OF chunk_text ON public.document_chunks
  FOR EACH ROW
  EXECUTE FUNCTION public.document_chunks_search_vector_update();

-- Backfill: populate search_vector para chunks existentes.
UPDATE public.document_chunks
SET search_vector = to_tsvector('spanish', COALESCE(chunk_text, ''))
WHERE search_vector IS NULL;


-- 2. RPC: VECTOR SIMILARITY SEARCH
-- ============================================================================
-- Busca chunks por cosine similarity filtrada por case_id.
-- Filtros opcionales: document_type, section_type.
-- Retorna chunks con metadata del documento padre.

CREATE OR REPLACE FUNCTION public.match_case_chunks_vector(
  query_embedding vector(768),
  p_case_id uuid,
  match_count int DEFAULT 10,
  p_document_type text DEFAULT NULL,
  p_section_type text DEFAULT NULL
)
RETURNS TABLE (
  chunk_id uuid,
  chunk_text text,
  chunk_index int,
  section_type text,
  page_number int,
  metadata jsonb,
  similarity float,
  document_id uuid,
  document_type text,
  filename text,
  created_at timestamptz
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT
    dc.id AS chunk_id,
    dc.chunk_text,
    dc.chunk_index,
    dc.section_type,
    dc.page_number,
    dc.metadata,
    1 - (de.embedding <=> query_embedding) AS similarity,
    d.id AS document_id,
    d.document_type,
    d.original_filename AS filename,
    d.created_at
  FROM public.document_embeddings de
  JOIN public.document_chunks dc ON dc.id = de.chunk_id
  JOIN public.documents d ON d.id = dc.document_id
  WHERE de.case_id = p_case_id
    AND (p_document_type IS NULL OR d.document_type = p_document_type)
    AND (p_section_type IS NULL OR dc.section_type = p_section_type)
  ORDER BY de.embedding <=> query_embedding ASC
  LIMIT match_count;
$$;

COMMENT ON FUNCTION public.match_case_chunks_vector IS
  'RAG vector search: cosine similarity filtrada por case_id con filtros opcionales de document_type y section_type.';


-- 3. RPC: FULL-TEXT SEARCH
-- ============================================================================
-- Busca chunks por full-text search (BM25-like via ts_rank) filtrada por case_id.

CREATE OR REPLACE FUNCTION public.match_case_chunks_text(
  query_text text,
  p_case_id uuid,
  match_count int DEFAULT 10,
  p_document_type text DEFAULT NULL,
  p_section_type text DEFAULT NULL
)
RETURNS TABLE (
  chunk_id uuid,
  chunk_text text,
  chunk_index int,
  section_type text,
  page_number int,
  metadata jsonb,
  rank float,
  document_id uuid,
  document_type text,
  filename text,
  created_at timestamptz
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT
    dc.id AS chunk_id,
    dc.chunk_text,
    dc.chunk_index,
    dc.section_type,
    dc.page_number,
    dc.metadata,
    ts_rank_cd(dc.search_vector, plainto_tsquery('spanish', query_text)) AS rank,
    d.id AS document_id,
    d.document_type,
    d.original_filename AS filename,
    d.created_at
  FROM public.document_chunks dc
  JOIN public.documents d ON d.id = dc.document_id
  WHERE dc.case_id = p_case_id
    AND dc.search_vector @@ plainto_tsquery('spanish', query_text)
    AND (p_document_type IS NULL OR d.document_type = p_document_type)
    AND (p_section_type IS NULL OR dc.section_type = p_section_type)
  ORDER BY rank DESC
  LIMIT match_count;
$$;

COMMENT ON FUNCTION public.match_case_chunks_text IS
  'RAG full-text search: ts_rank sobre search_vector filtrada por case_id con filtros opcionales.';
