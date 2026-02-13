-- ============================================================================
-- Migración: Tribunal y Carátula en document_hashes
-- ============================================================================
-- Distingue causas que comparten el mismo ROL (ej: C-1-2025 en distintos tribunales)
-- ============================================================================

ALTER TABLE public.document_hashes
  ADD COLUMN IF NOT EXISTS tribunal text,
  ADD COLUMN IF NOT EXISTS caratula text;

-- Índice para consultas por causa (user + rol + tribunal + carátula)
CREATE INDEX IF NOT EXISTS document_hashes_user_rol_tribunal_caratula_idx
  ON public.document_hashes(user_id, rol, COALESCE(tribunal, ''), COALESCE(caratula, ''));

COMMENT ON COLUMN public.document_hashes.tribunal IS 'Tribunal de la causa. Distingue causas con mismo ROL.';
COMMENT ON COLUMN public.document_hashes.caratula IS 'Carátula de la causa. Distingue causas con mismo ROL.';
