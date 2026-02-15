-- ============================================================================
-- MIGRACIÓN: Tablas extracted_texts y document_chunks
-- ============================================================================
-- Tarea 7.02 (Pipeline):
--   1) extracted_texts: texto completo extraído por documento PDF
--   2) document_chunks: fragmentos semánticos para RAG
--
-- Dependencias:
--   - 20260209120000_create_legal_tables.sql (cases, documents)
--   - 20260205120000_create_profiles_table.sql (handle_updated_at)
-- ============================================================================

-- 1. TABLA PUBLIC.EXTRACTED_TEXTS
-- ============================================================================

create table if not exists public.extracted_texts (
  id uuid default gen_random_uuid() primary key,
  document_id uuid references public.documents(id) on delete cascade not null,
  case_id uuid references public.cases(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  full_text text default '' not null,
  extraction_method text check (extraction_method in ('pdf-parse', 'document-ai')),
  page_count int default 0 not null check (page_count >= 0),
  status text default 'pending' not null check (status in ('pending', 'needs_ocr', 'completed', 'failed')),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

comment on table public.extracted_texts is 'Texto plano extraído desde PDFs por documento (pdf-parse o document-ai).';
comment on column public.extracted_texts.extraction_method is 'Método de extracción: pdf-parse (nativo) o document-ai (OCR).';
comment on column public.extracted_texts.status is 'Estado del pipeline de extracción: pending, needs_ocr, completed o failed.';

-- 1 extracción final por documento (idempotencia en orquestador)
create unique index if not exists extracted_texts_document_id_unique_idx
  on public.extracted_texts(document_id);

-- Índices de consulta
create index if not exists extracted_texts_case_id_idx
  on public.extracted_texts(case_id);
create index if not exists extracted_texts_user_id_idx
  on public.extracted_texts(user_id);

-- RLS para extracted_texts
alter table public.extracted_texts enable row level security;

create policy "extracted_texts_select_own"
  on public.extracted_texts for select
  using (auth.uid() = user_id);

create policy "extracted_texts_insert_own"
  on public.extracted_texts for insert
  with check (auth.uid() = user_id);

create policy "extracted_texts_update_own"
  on public.extracted_texts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "extracted_texts_delete_own"
  on public.extracted_texts for delete
  using (auth.uid() = user_id);

create trigger extracted_texts_updated_at
  before update on public.extracted_texts
  for each row
  execute function public.handle_updated_at();


-- 2. TABLA PUBLIC.DOCUMENT_CHUNKS
-- ============================================================================

create table if not exists public.document_chunks (
  id uuid default gen_random_uuid() primary key,
  extracted_text_id uuid references public.extracted_texts(id) on delete cascade not null,
  document_id uuid references public.documents(id) on delete cascade not null,
  case_id uuid references public.cases(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  chunk_index int not null check (chunk_index >= 0),
  chunk_text text not null,
  page_number int check (page_number is null or page_number > 0),
  section_type text default 'general' not null,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

comment on table public.document_chunks is 'Fragmentos de texto para retrieval RAG con metadata legal por sección/página.';
comment on column public.document_chunks.chunk_index is 'Orden del chunk dentro del documento extraído (0-based).';
comment on column public.document_chunks.metadata is 'Metadatos flexibles del chunk (ej: tipo doc, rol, tribunal, offsets, etc).';

-- Evita duplicar índices de chunk para el mismo extracted_text
create unique index if not exists document_chunks_extracted_text_chunk_unique_idx
  on public.document_chunks(extracted_text_id, chunk_index);

-- Índices solicitados por la tarea + soporte de consultas frecuentes
create index if not exists document_chunks_case_id_idx
  on public.document_chunks(case_id);
create index if not exists document_chunks_document_id_idx
  on public.document_chunks(document_id);
create index if not exists document_chunks_extracted_text_id_idx
  on public.document_chunks(extracted_text_id);
create index if not exists document_chunks_user_id_idx
  on public.document_chunks(user_id);

-- RLS para document_chunks
alter table public.document_chunks enable row level security;

create policy "document_chunks_select_own"
  on public.document_chunks for select
  using (auth.uid() = user_id);

create policy "document_chunks_insert_own"
  on public.document_chunks for insert
  with check (auth.uid() = user_id);

create policy "document_chunks_update_own"
  on public.document_chunks for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "document_chunks_delete_own"
  on public.document_chunks for delete
  using (auth.uid() = user_id);
