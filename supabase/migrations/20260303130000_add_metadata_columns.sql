-- ============================================================================
-- MIGRACIÓN: Metadata completa en cases + metadata JSONB en documents
-- ============================================================================
-- Persiste campos de metadata que el JwtExtractor ya capturaba del DOM
-- pero que no se almacenaban en la DB.
--
-- cases: etapa, ubicacion, fecha_ingreso, estado_procesal
-- documents: metadata JSONB (folio_numero, etapa, tramite, etc.)
--
-- Dependencias: 20260209120000_create_legal_tables.sql
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 1: Columnas de metadata en cases
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS etapa TEXT,
  ADD COLUMN IF NOT EXISTS ubicacion TEXT,
  ADD COLUMN IF NOT EXISTS fecha_ingreso TEXT,
  ADD COLUMN IF NOT EXISTS estado_procesal TEXT;

COMMENT ON COLUMN public.cases.etapa IS
  'Etapa procesal activa del cuaderno seleccionado. Ej: "1 Notificación demanda y su proveído". Cambia según cuaderno.';

COMMENT ON COLUMN public.cases.ubicacion IS
  'Ubicación actual de la causa. Ej: "Digital", "Corte de Apelaciones".';

COMMENT ON COLUMN public.cases.fecha_ingreso IS
  'Fecha de ingreso de la causa al tribunal. Formato dd/mm/yyyy del PJUD.';

COMMENT ON COLUMN public.cases.estado_procesal IS
  'Estado procesal general de la causa. Ej: "Tramitación", "Concluido".';

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 2: Columna metadata JSONB en documents
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.documents.metadata IS
  'Metadata del folio PJUD asociado al documento: folio_numero, etapa, tramite, desc_tramite, fecha_tramite, foja, cuaderno.';
