-- ============================================================================
-- MIGRACIÓN: Columnas de Sync para tabla cases (Tarea 4.17 / 7.01 refactorizado)
-- ============================================================================
-- Agrega campos necesarios para el pipeline de sync server-side:
--   - procedimiento: EJE PRINCIPAL de routing (determina prompts/acciones/plazos)
--   - libro_tipo: metadata para display/filtros en UI (c/v/e/a/f/i)
--   - fuente_sync: entry point de la sincronización
--
-- También actualiza el UNIQUE INDEX para excluir caratula:
--   ANTES: UNIQUE(user_id, rol, COALESCE(tribunal,''), COALESCE(caratula,''))
--   AHORA: UNIQUE(user_id, rol, COALESCE(tribunal,''))
--   RAZÓN: caratula solo disponible en DOM1 (Consulta Unificada); causas desde
--   Mis Causas (v1.1) o tipo f no tendrán DOM1. ROL+tribunal ya identifican
--   unívocamente una causa en PJUD.
--
-- Dependencias: 20260209120000_create_legal_tables.sql
--               20260213140000_add_unique_constraint_cases.sql
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 1: AGREGAR NUEVAS COLUMNAS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS procedimiento text,
  ADD COLUMN IF NOT EXISTS libro_tipo text,
  ADD COLUMN IF NOT EXISTS fuente_sync text DEFAULT 'consulta_unificada';

COMMENT ON COLUMN public.cases.procedimiento IS
  'Eje principal de routing: ordinario|ejecutivo|sumario|monitorio|voluntario. Determina prompts, acciones rápidas y plazos CPC.';

COMMENT ON COLUMN public.cases.libro_tipo IS
  'Letra del ROL (c/v/e/a/f/i). Metadata para display y filtros en UI. No se usa para routing.';

COMMENT ON COLUMN public.cases.fuente_sync IS
  'Entry point de la sincronización: consulta_unificada (MVP v1) o mis_causas (MVP v1.1).';

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 2: CHECK CONSTRAINTS
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cases_procedimiento_check'
  ) THEN
    ALTER TABLE public.cases
      ADD CONSTRAINT cases_procedimiento_check
      CHECK (procedimiento IS NULL OR procedimiento IN (
        'ordinario', 'ejecutivo', 'sumario', 'monitorio', 'voluntario'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cases_libro_tipo_check'
  ) THEN
    ALTER TABLE public.cases
      ADD CONSTRAINT cases_libro_tipo_check
      CHECK (libro_tipo IS NULL OR libro_tipo IN (
        'c', 'v', 'e', 'a', 'f', 'i'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cases_fuente_sync_check'
  ) THEN
    ALTER TABLE public.cases
      ADD CONSTRAINT cases_fuente_sync_check
      CHECK (fuente_sync IN ('consulta_unificada', 'mis_causas'));
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 3: ACTUALIZAR UNIQUE INDEX (excluir caratula)
-- ─────────────────────────────────────────────────────────────────────────────
-- El índice antiguo incluía caratula. El nuevo solo usa (user_id, rol, tribunal).
-- Esto permite causas sin caratula (desde Mis Causas o tipo f).

DROP INDEX IF EXISTS public.cases_user_rol_tribunal_caratula_unique_idx;

CREATE UNIQUE INDEX IF NOT EXISTS cases_user_rol_tribunal_unique_idx
  ON public.cases(user_id, rol, COALESCE(tribunal, ''));

COMMENT ON INDEX public.cases_user_rol_tribunal_unique_idx IS
  'Previene causas duplicadas. ROL + Tribunal identifican unívocamente una causa. Caratula excluida (nullable desde Mis Causas).';

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 4: ÍNDICES PARA NUEVAS COLUMNAS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS cases_procedimiento_idx
  ON public.cases(procedimiento) WHERE procedimiento IS NOT NULL;

CREATE INDEX IF NOT EXISTS cases_libro_tipo_idx
  ON public.cases(libro_tipo) WHERE libro_tipo IS NOT NULL;
