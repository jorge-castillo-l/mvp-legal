ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS pending_sync_tasks JSONB;

COMMENT ON COLUMN public.cases.pending_sync_tasks IS
  'Tareas de descarga pendientes cuando un sync se interrumpe por timeout. Permite resume automático. NULL cuando no hay tareas pendientes.';
