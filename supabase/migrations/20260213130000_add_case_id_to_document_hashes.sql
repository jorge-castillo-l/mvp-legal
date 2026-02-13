-- ============================================================================
-- Migración: Añadir case_id a document_hashes
-- ============================================================================
-- Permite consultar hashes por case_id (FK estable) en vez de depender de
-- coincidencia exacta de strings scrapeados (tribunal, carátula).
-- ============================================================================

ALTER TABLE public.document_hashes
  ADD COLUMN IF NOT EXISTS case_id uuid REFERENCES public.cases(id) ON DELETE CASCADE;

-- Índice para consultas rápidas por case_id
CREATE INDEX IF NOT EXISTS document_hashes_case_id_idx
  ON public.document_hashes(case_id);

COMMENT ON COLUMN public.document_hashes.case_id IS 'FK a cases. Permite consultar sync state sin depender de strings scrapeados.';
