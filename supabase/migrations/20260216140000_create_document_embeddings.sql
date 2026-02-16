-- ============================================================================
-- MIGRACIÓN: pgvector + tabla document_embeddings
-- ============================================================================
-- Tarea 7.06 (Pipeline):
--   1) Habilitar extensión pgvector en Supabase
--   2) Crear tabla document_embeddings para almacenar embeddings por chunk
--   3) Índices HNSW + soporte de filtrado por case_id (RAG por causa)
--
-- Dependencias:
--   - 20260215120000_create_extracted_texts_and_document_chunks.sql
-- ============================================================================

-- 1. EXTENSIÓN PGVECTOR
-- ============================================================================
create extension if not exists vector;


-- 2. TABLA PUBLIC.DOCUMENT_EMBEDDINGS
-- ============================================================================
create table if not exists public.document_embeddings (
  id uuid default gen_random_uuid() primary key,
  chunk_id uuid references public.document_chunks(id) on delete cascade not null,
  case_id uuid references public.cases(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  embedding vector(768) not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

comment on table public.document_embeddings is
  'Embeddings vectoriales por chunk para búsqueda semántica RAG por causa.';
comment on column public.document_embeddings.chunk_id is
  'FK al chunk origen (document_chunks). Se espera 1 embedding por chunk.';
comment on column public.document_embeddings.case_id is
  'FK redundante para filtrar retrieval por causa y evitar mezcla entre expedientes.';
comment on column public.document_embeddings.embedding is
  'Vector de dimensión 768 para similarity search (pgvector + HNSW).';


-- 3. ÍNDICES
-- ============================================================================
-- Garantiza idempotencia de generación de embeddings por chunk.
create unique index if not exists document_embeddings_chunk_id_unique_idx
  on public.document_embeddings(chunk_id);

-- Filtro estricto por expediente/usuario durante retrieval.
create index if not exists document_embeddings_case_id_idx
  on public.document_embeddings(case_id);

create index if not exists document_embeddings_user_case_id_idx
  on public.document_embeddings(user_id, case_id);

-- Índice ANN para nearest-neighbor search por similitud semántica.
create index if not exists document_embeddings_embedding_hnsw_idx
  on public.document_embeddings
  using hnsw (embedding vector_cosine_ops);


-- 4. RLS
-- ============================================================================
alter table public.document_embeddings enable row level security;

drop policy if exists "document_embeddings_select_own" on public.document_embeddings;
create policy "document_embeddings_select_own"
  on public.document_embeddings for select
  using (auth.uid() = user_id);

drop policy if exists "document_embeddings_insert_own" on public.document_embeddings;
create policy "document_embeddings_insert_own"
  on public.document_embeddings for insert
  with check (auth.uid() = user_id);

drop policy if exists "document_embeddings_update_own" on public.document_embeddings;
create policy "document_embeddings_update_own"
  on public.document_embeddings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "document_embeddings_delete_own" on public.document_embeddings;
create policy "document_embeddings_delete_own"
  on public.document_embeddings for delete
  using (auth.uid() = user_id);


-- 5. TRIGGER updated_at
-- ============================================================================
drop trigger if exists document_embeddings_updated_at on public.document_embeddings;
create trigger document_embeddings_updated_at
  before update on public.document_embeddings
  for each row
  execute function public.handle_updated_at();
