-- ============================================================================
-- MIGRACIÓN: Propagar documents.metadata al trigger de processing_queue
-- ============================================================================
-- Brecha detectada: el trigger enqueue_document_processing no propagaba
-- documents.metadata (folio_numero, cuaderno, etapa, tramite, etc.) a la cola.
--
-- El chunking (7.07) y el sistema de citas (3.09) necesitan esta metadata
-- para etiquetar chunks con folio, cuaderno y sección, sin queries extra.
--
-- Cambio: se agrega 'doc_metadata' al JSONB de processing_queue.metadata.
-- ============================================================================

create or replace function public.enqueue_document_processing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  case_rol text;
begin
  select rol into case_rol
  from public.cases
  where id = NEW.case_id;

  insert into public.processing_queue (
    document_id,
    case_id,
    user_id,
    metadata
  )
  values (
    NEW.id,
    NEW.case_id,
    NEW.user_id,
    jsonb_build_object(
      'storage_path',  NEW.storage_path,
      'filename',      NEW.filename,
      'document_type', NEW.document_type,
      'file_size',     NEW.file_size,
      'source',        NEW.source,
      'rol',           coalesce(case_rol, 'sin_rol'),
      'doc_metadata',  coalesce(NEW.metadata, '{}'::jsonb)
    )
  )
  on conflict (document_id) do nothing;

  return NEW;
end;
$$;

comment on column public.processing_queue.metadata is
  'Metadata propagada del documento: storage_path, filename, document_type, file_size, source, rol, doc_metadata (folio_numero, cuaderno, etapa, tramite, etc.).';
