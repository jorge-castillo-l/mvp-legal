-- ============================================================================
-- MIGRACIÓN: UNIQUE Constraint en tabla cases
-- ============================================================================
-- Previene duplicación de causas por race conditions del scraper.
-- Un usuario no puede tener dos causas con el mismo (rol, tribunal, carátula).
-- COALESCE maneja NULLs: tribunal=NULL y tribunal='' se tratan como iguales.
--
-- Dependencias: 20260209120000_create_legal_tables.sql (tabla cases)
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 1: DEDUPLICAR CAUSAS EXISTENTES (si las hay)
-- ─────────────────────────────────────────────────────────────────────────────
-- Busca grupos duplicados (mismo user + rol + tribunal + carátula).
-- Conserva la causa más recientemente actualizada como "sobreviviente".
-- Reasigna documents y document_hashes de las duplicadas al sobreviviente.
-- Luego elimina las filas duplicadas.

DO $$
DECLARE
  dup RECORD;
  survivor_id uuid;
BEGIN
  FOR dup IN
    SELECT
      user_id,
      rol,
      COALESCE(tribunal, '') AS tribunal_norm,
      COALESCE(caratula, '') AS caratula_norm
    FROM public.cases
    GROUP BY user_id, rol, COALESCE(tribunal, ''), COALESCE(caratula, '')
    HAVING COUNT(*) > 1
  LOOP
    -- Sobreviviente: la causa actualizada más recientemente
    SELECT id INTO survivor_id
    FROM public.cases
    WHERE user_id = dup.user_id
      AND rol = dup.rol
      AND COALESCE(tribunal, '') = dup.tribunal_norm
      AND COALESCE(caratula, '') = dup.caratula_norm
    ORDER BY updated_at DESC
    LIMIT 1;

    -- Reasignar documents de las duplicadas al sobreviviente
    UPDATE public.documents
    SET case_id = survivor_id
    WHERE case_id IN (
      SELECT id FROM public.cases
      WHERE user_id = dup.user_id
        AND rol = dup.rol
        AND COALESCE(tribunal, '') = dup.tribunal_norm
        AND COALESCE(caratula, '') = dup.caratula_norm
        AND id != survivor_id
    );

    -- Reasignar document_hashes de las duplicadas al sobreviviente
    UPDATE public.document_hashes
    SET case_id = survivor_id
    WHERE case_id IN (
      SELECT id FROM public.cases
      WHERE user_id = dup.user_id
        AND rol = dup.rol
        AND COALESCE(tribunal, '') = dup.tribunal_norm
        AND COALESCE(caratula, '') = dup.caratula_norm
        AND id != survivor_id
    );

    -- Eliminar causas duplicadas (ON DELETE CASCADE no aplica aquí porque ya reasignamos)
    DELETE FROM public.cases
    WHERE user_id = dup.user_id
      AND rol = dup.rol
      AND COALESCE(tribunal, '') = dup.tribunal_norm
      AND COALESCE(caratula, '') = dup.caratula_norm
      AND id != survivor_id;

    -- Recalcular document_count del sobreviviente
    UPDATE public.cases
    SET document_count = (
      SELECT COUNT(*) FROM public.documents WHERE case_id = survivor_id
    )
    WHERE id = survivor_id;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 2: CREAR CONSTRAINT ÚNICO
-- ─────────────────────────────────────────────────────────────────────────────
-- COALESCE(tribunal, '') y COALESCE(caratula, '') garantizan que:
--   - NULL y '' se traten como equivalentes
--   - No se creen dos causas "iguales" solo porque una tiene tribunal=NULL
--     y otra tribunal=''

CREATE UNIQUE INDEX IF NOT EXISTS cases_user_rol_tribunal_caratula_unique_idx
  ON public.cases(user_id, rol, COALESCE(tribunal, ''), COALESCE(caratula, ''));

COMMENT ON INDEX public.cases_user_rol_tribunal_caratula_unique_idx IS
  'Previene causas duplicadas por race conditions. Un usuario no puede tener dos causas con mismo ROL + Tribunal + Carátula.';
