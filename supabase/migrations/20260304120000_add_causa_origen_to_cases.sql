-- ============================================================================
-- MIGRACIÓN: Causa Origen para causas tipo E (Exhorto)
-- ============================================================================
-- Las causas tipo E tienen siempre una "causa origen" (generalmente tipo C)
-- que es el juicio principal que generó el exhorto. Estos campos permiten
-- vincular la E con su C de origen sin necesidad de una tabla separada.
--
-- El abogado trabaja desde la causa C; cuando se sincroniza una E, estos
-- campos permiten mostrar "Causa Origen: C-9460-2021" en el sidepanel
-- y facilitar la navegación al juicio principal.
--
-- Dependencias: 20260209120000_create_legal_tables.sql
-- ============================================================================

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS causa_origen_rol TEXT,
  ADD COLUMN IF NOT EXISTS causa_origen_tribunal TEXT;

COMMENT ON COLUMN public.cases.causa_origen_rol IS
  'ROL de la causa origen para causas tipo E (exhorto). Ej: "C-9460-2021". NULL para causas que no son exhortos.';

COMMENT ON COLUMN public.cases.causa_origen_tribunal IS
  'Tribunal de la causa origen para causas tipo E. Ej: "9º Juzgado Civil de Santiago". NULL si no aplica.';

CREATE INDEX IF NOT EXISTS cases_causa_origen_rol_idx
  ON public.cases(causa_origen_rol)
  WHERE causa_origen_rol IS NOT NULL;
