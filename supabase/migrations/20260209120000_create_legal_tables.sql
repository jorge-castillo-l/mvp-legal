-- ============================================================================
-- MIGRACIÓN: Tablas cases, documents, document_hashes
-- ============================================================================
-- Crea las tablas necesarias para el módulo legal de MVP:
--   - cases: Causas judiciales (1:N con documents)
--   - documents: Documentos PDF asociados a causas
--   - document_hashes: Deduplicación por hash SHA-256
--
-- Dependencias: auth.users (existente), public.profiles (migración 20260205120000)
-- ============================================================================

-- 1. TABLA PUBLIC.CASES
-- ============================================================================

create table if not exists public.cases (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  rol text not null,
  tribunal text,
  caratula text,
  materia text,
  estado text,
  document_count int default 0 not null check (document_count >= 0),
  last_synced_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

comment on table public.cases is 'Causas judiciales del usuario. Cada causa puede tener múltiples documentos.';
create index if not exists cases_user_id_idx on public.cases(user_id);
create index if not exists cases_user_rol_idx on public.cases(user_id, rol);
create index if not exists cases_updated_at_idx on public.cases(updated_at desc);

-- RLS para cases
alter table public.cases enable row level security;

create policy "cases_select_own"
  on public.cases for select
  using (auth.uid() = user_id);

create policy "cases_insert_own"
  on public.cases for insert
  with check (auth.uid() = user_id);

create policy "cases_update_own"
  on public.cases for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "cases_delete_own"
  on public.cases for delete
  using (auth.uid() = user_id);

-- Trigger updated_at (reutiliza handle_updated_at de migración profiles)
create trigger cases_updated_at
  before update on public.cases
  for each row
  execute function public.handle_updated_at();


-- 2. TABLA PUBLIC.DOCUMENTS
-- ============================================================================

create table if not exists public.documents (
  id uuid default gen_random_uuid() primary key,
  case_id uuid references public.cases(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  filename text not null,
  original_filename text,
  storage_path text not null,
  document_type text default 'otro' not null,
  file_size bigint not null check (file_size >= 0),
  file_hash text,
  source text default 'unknown' not null,
  source_url text,
  captured_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

comment on table public.documents is 'Documentos PDF asociados a causas. Referencia objetos en Storage bucket case-files.';
create index if not exists documents_case_id_idx on public.documents(case_id);
create index if not exists documents_user_id_idx on public.documents(user_id);

-- RLS para documents
alter table public.documents enable row level security;

create policy "documents_select_own"
  on public.documents for select
  using (auth.uid() = user_id);

create policy "documents_insert_own"
  on public.documents for insert
  with check (auth.uid() = user_id);

create policy "documents_update_own"
  on public.documents for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "documents_delete_own"
  on public.documents for delete
  using (auth.uid() = user_id);


-- 3. TABLA PUBLIC.DOCUMENT_HASHES
-- ============================================================================

create table if not exists public.document_hashes (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  rol text not null,
  hash text not null,
  filename text,
  document_type text,
  uploaded_at timestamp with time zone default timezone('utc'::text, now()) not null
);

comment on table public.document_hashes is 'Registro de hashes SHA-256 para deduplicación de documentos por usuario.';

-- Constraint único: un usuario no puede tener dos documentos con el mismo hash
create unique index if not exists document_hashes_user_hash_unique_idx
  on public.document_hashes(user_id, hash);

create index if not exists document_hashes_user_id_idx on public.document_hashes(user_id);
create index if not exists document_hashes_hash_idx on public.document_hashes(hash);

-- RLS para document_hashes
alter table public.document_hashes enable row level security;

create policy "document_hashes_select_own"
  on public.document_hashes for select
  using (auth.uid() = user_id);

create policy "document_hashes_insert_own"
  on public.document_hashes for insert
  with check (auth.uid() = user_id);

create policy "document_hashes_update_own"
  on public.document_hashes for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "document_hashes_delete_own"
  on public.document_hashes for delete
  using (auth.uid() = user_id);
