-- Columna sync_snapshot: estado completo de la causa al momento del último sync.
-- Se usa para generar diff detallado al re-sincronizar ("Buscar actualizaciones").

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS sync_snapshot JSONB;

COMMENT ON COLUMN public.cases.sync_snapshot IS
  'Snapshot completo de la causa al último sync: cuadernos con folios, anexos, exhortos con estados y doc_count, receptor retiros, metadata, tabs_counts. Usado para diff en re-sync.';

CREATE INDEX IF NOT EXISTS idx_cases_sync_snapshot_exists
  ON public.cases((sync_snapshot IS NOT NULL))
  WHERE sync_snapshot IS NOT NULL;
