-- ============================================================================
-- MIGRACIÓN: Tabla processing_queue + trigger de auto-encolado
-- ============================================================================
-- Tarea 7.05 (Pipeline): PDF Processing Orchestrator
--
-- Cola de procesamiento asíncrono para extracción de texto de PDFs.
-- Desacopla la extracción del upload: el usuario no espera mientras se procesa.
--
-- Flujo:
--   1) INSERT en documents → trigger auto-crea entrada en processing_queue
--   2) Edge Function / API recoge la entrada y procesa el PDF
--   3) Resultado se guarda en extracted_texts
--   4) Si falla → reintenta hasta max_attempts (3) con backoff exponencial
--
-- Dependencias:
--   - 20260209120000_create_legal_tables.sql (documents, cases)
--   - 20260215120000_create_extracted_texts_and_document_chunks.sql
-- ============================================================================


-- 1. TABLA PUBLIC.PROCESSING_QUEUE
-- ============================================================================

create table if not exists public.processing_queue (
  id uuid default gen_random_uuid() primary key,

  -- Referencias al documento, causa y usuario
  document_id uuid references public.documents(id) on delete cascade not null,
  case_id     uuid references public.cases(id) on delete cascade not null,
  user_id     uuid references auth.users(id) on delete cascade not null,

  -- Estado del procesamiento
  status text default 'queued' not null
    check (status in ('queued', 'processing', 'completed', 'failed')),

  -- Control de reintentos
  attempts     int default 0 not null check (attempts >= 0),
  max_attempts int default 3 not null check (max_attempts > 0),
  last_error   text,

  -- Timestamps de ciclo de vida
  started_at    timestamptz,
  completed_at  timestamptz,
  next_retry_at timestamptz,

  -- Metadata propagada: ROL, storage_path, document_type, filename, file_size, source
  metadata jsonb default '{}'::jsonb not null,

  created_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null
);

comment on table public.processing_queue is
  'Cola de procesamiento asíncrono de PDFs. Desacopla extracción de texto del upload.';
comment on column public.processing_queue.status is
  'Estado: queued → processing → completed|failed. Failed se reintenta hasta max_attempts.';
comment on column public.processing_queue.metadata is
  'Metadata propagada del documento: storage_path, filename, document_type, file_size, source, rol.';
comment on column public.processing_queue.next_retry_at is
  'Timestamp para el próximo reintento (backoff exponencial: 10s, 60s, 5min).';


-- 2. ÍNDICES
-- ============================================================================

-- 1 entrada por documento (idempotencia)
create unique index if not exists processing_queue_document_id_unique_idx
  on public.processing_queue(document_id);

-- Polling de items pendientes: status + next_retry_at
create index if not exists processing_queue_pending_idx
  on public.processing_queue(status, next_retry_at)
  where status in ('queued', 'failed');

-- Consultas por usuario (UI muestra estado de procesamiento)
create index if not exists processing_queue_user_id_idx
  on public.processing_queue(user_id);

-- Consultas por causa
create index if not exists processing_queue_case_id_idx
  on public.processing_queue(case_id);


-- 3. RLS
-- ============================================================================

alter table public.processing_queue enable row level security;

-- Usuarios pueden ver el estado de procesamiento de sus documentos
create policy "processing_queue_select_own"
  on public.processing_queue for select
  using (auth.uid() = user_id);

-- Inserts/updates se manejan via service role (trigger SECURITY DEFINER + API admin)
-- No se necesitan policies de insert/update para authenticated role


-- 4. TRIGGER updated_at
-- ============================================================================

create trigger processing_queue_updated_at
  before update on public.processing_queue
  for each row
  execute function public.handle_updated_at();


-- 5. TRIGGER AUTO-ENCOLADO EN DOCUMENTS
-- ============================================================================
-- Al insertar un documento, se crea automáticamente una entrada en la cola.
-- Propaga metadata (storage_path, filename, document_type, file_size, source, rol)
-- para que el orquestador no necesite queries adicionales.

create or replace function public.enqueue_document_processing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  case_rol text;
begin
  -- Obtener ROL de la causa asociada para propagar como metadata
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
      'storage_path', NEW.storage_path,
      'filename',     NEW.filename,
      'document_type', NEW.document_type,
      'file_size',    NEW.file_size,
      'source',       NEW.source,
      'rol',          coalesce(case_rol, 'sin_rol')
    )
  )
  on conflict (document_id) do nothing;

  return NEW;
end;
$$;

comment on function public.enqueue_document_processing() is
  'Trigger: auto-encola documento para procesamiento de texto al insertarlo en documents.';

create trigger trigger_enqueue_document_processing
  after insert on public.documents
  for each row
  execute function public.enqueue_document_processing();
