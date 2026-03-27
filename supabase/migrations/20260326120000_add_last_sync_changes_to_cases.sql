-- Almacena el array SyncChange[] del último re-sync con cambios.
-- Se usa como contexto para el chat de IA cuando el usuario pregunta
-- por las actualizaciones de la última sincronización.
ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS last_sync_changes JSONB DEFAULT NULL;
