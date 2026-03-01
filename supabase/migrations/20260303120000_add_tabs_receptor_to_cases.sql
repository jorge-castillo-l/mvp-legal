-- ============================================================================
-- MIGRACIÓN: Columnas tabs_data + receptor_data en tabla cases (Tarea 4.20)
-- ============================================================================
-- Almacena los datos tabulares extraídos del DOM de PJUD directamente
-- en la causa (JSON estructurado, sin tabla nueva).
--
--   tabs_data:     notificaciones + escritos por resolver + exhortos + litigantes
--                  (ya vienen en CausaPackage.tabs, extraídos por JwtExtractor 4.16)
--   receptor_data: info del modal Receptor (#modalReceptorCivil):
--                  nombre receptor + certificaciones + diligencias
--                  (obtenido llamando al endpoint receptorCivil.php con jwt_receptor)
--
-- Dependencias: 20260209120000_create_legal_tables.sql
-- ============================================================================

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS tabs_data    JSONB,
  ADD COLUMN IF NOT EXISTS receptor_data JSONB;

COMMENT ON COLUMN public.cases.tabs_data IS
  'Datos tabulares extraídos del DOM del modal PJUD: notificaciones + escritos_por_resolver + exhortos + litigantes. Poblado en cada sync por la API (4.20).';

COMMENT ON COLUMN public.cases.receptor_data IS
  'Datos del modal Receptor (#modalReceptorCivil): nombre_receptor + tipo + certificaciones + diligencias. Poblado en sync si jwt_receptor presente (4.20).';

-- Índices parciales para filtrado y búsqueda
CREATE INDEX IF NOT EXISTS cases_has_receptor_idx
  ON public.cases((receptor_data IS NOT NULL))
  WHERE receptor_data IS NOT NULL;

CREATE INDEX IF NOT EXISTS cases_has_tabs_idx
  ON public.cases((tabs_data IS NOT NULL))
  WHERE tabs_data IS NOT NULL;
