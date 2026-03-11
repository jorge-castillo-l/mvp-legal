-- ============================================================================
-- MIGRACIÓN: Columna remisiones_data en tabla cases
-- ============================================================================
-- Almacena metadata y datos tabulares de las remisiones en la Corte
-- (apelaciones) extraídos del endpoint causaApelaciones.php.
--
-- Cada elemento contiene: metadata de la apelación, folios de movimientos,
-- litigantes, exhortos, incompetencia, expediente primera instancia,
-- y JWTs directos (ebook, certificado, texto).
--
-- Dependencias: 20260209120000_create_legal_tables.sql
-- ============================================================================

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS remisiones_data JSONB;

COMMENT ON COLUMN public.cases.remisiones_data IS
  'Datos de remisiones en la Corte (apelaciones): metadata, folios movimientos, litigantes, expediente primera instancia. Poblado en sync cuando la causa tiene remisiones.';

CREATE INDEX IF NOT EXISTS cases_has_remisiones_idx
  ON public.cases((remisiones_data IS NOT NULL))
  WHERE remisiones_data IS NOT NULL;
