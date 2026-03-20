-- ============================================================================
-- MIGRACIÓN: Tablas conversations y chat_messages
-- ============================================================================
-- Tarea 3.10 (Cerebro):
--   1) conversations: Sesiones de chat asociadas a una causa
--   2) chat_messages: Mensajes individuales con métricas de uso y citas
--
-- Refinamientos sobre Kanban:
--   - user_id directo en chat_messages (RLS sin JOIN — patrón Supabase)
--   - thinking_content para Extended Thinking (Capa 3)
--   - cache_read_tokens / cache_write_tokens para billing analytics (3.05)
--   - model_used como TEXT libre (model IDs cambian con upgrades)
--
-- Dependencias:
--   - 20260209120000_create_legal_tables.sql (cases)
--   - 20260205120000_create_profiles_table.sql (handle_updated_at)
-- ============================================================================

-- 1. TABLA PUBLIC.CONVERSATIONS
-- ============================================================================

create table if not exists public.conversations (
  id uuid default gen_random_uuid() primary key,
  case_id uuid references public.cases(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text,
  mode text not null check (mode in ('fast_chat', 'full_analysis', 'deep_thinking')),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

comment on table public.conversations is 'Sesiones de chat vinculadas a una causa judicial. Cada sesión tiene un modo (capa IA) fijo.';
comment on column public.conversations.mode is 'Capa IA: fast_chat (Gemini Flash), full_analysis (Claude Sonnet), deep_thinking (Claude Opus).';
comment on column public.conversations.title is 'Título auto-generado desde la primera query del usuario. Puede ser editado.';

create index if not exists conversations_user_id_idx
  on public.conversations(user_id);
create index if not exists conversations_case_id_idx
  on public.conversations(case_id);
create index if not exists conversations_user_case_idx
  on public.conversations(user_id, case_id);
create index if not exists conversations_updated_at_idx
  on public.conversations(updated_at desc);

-- RLS para conversations
alter table public.conversations enable row level security;

create policy "conversations_select_own"
  on public.conversations for select
  using (auth.uid() = user_id);

create policy "conversations_insert_own"
  on public.conversations for insert
  with check (auth.uid() = user_id);

create policy "conversations_update_own"
  on public.conversations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "conversations_delete_own"
  on public.conversations for delete
  using (auth.uid() = user_id);

create trigger conversations_updated_at
  before update on public.conversations
  for each row
  execute function public.handle_updated_at();


-- 2. TABLA PUBLIC.CHAT_MESSAGES
-- ============================================================================

create table if not exists public.chat_messages (
  id uuid default gen_random_uuid() primary key,
  conversation_id uuid references public.conversations(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',

  -- Citas al expediente sincronizado (foja, cuaderno, fecha, etc.)
  sources_cited jsonb default '[]'::jsonb,
  -- Citas a jurisprudencia encontrada via web search (URLs)
  web_sources_cited jsonb default '[]'::jsonb,

  -- Extended Thinking output (solo deep_thinking / Claude Opus)
  thinking_content text,

  -- Métricas de uso por mensaje
  tokens_input int default 0 not null check (tokens_input >= 0),
  tokens_output int default 0 not null check (tokens_output >= 0),
  cache_read_tokens int default 0 not null check (cache_read_tokens >= 0),
  cache_write_tokens int default 0 not null check (cache_write_tokens >= 0),

  -- Modelo y proveedor exacto (para billing analytics)
  model_used text,
  provider text check (provider is null or provider in ('google', 'anthropic')),
  latency_ms int default 0 not null check (latency_ms >= 0),

  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

comment on table public.chat_messages is 'Mensajes de chat con métricas de uso, citas y tracking de modelo/proveedor para billing.';
comment on column public.chat_messages.sources_cited is 'Array JSON de citas al expediente: [{citedText, documentId, documentType, folioNumero, cuaderno, fechaTramite, foja, pageNumber}].';
comment on column public.chat_messages.web_sources_cited is 'Array JSON de citas web/jurisprudencia: [{title, url, snippet}].';
comment on column public.chat_messages.thinking_content is 'Output de Extended Thinking de Claude Opus (Capa 3). NULL para otros modos.';
comment on column public.chat_messages.model_used is 'Model ID exacto del API (ej: gemini-3-flash-preview, claude-sonnet-4-20250514).';
comment on column public.chat_messages.cache_read_tokens is 'Tokens leídos desde cache (Gemini explicit / Claude prompt caching). Para calcular ahorro.';
comment on column public.chat_messages.cache_write_tokens is 'Tokens escritos al cache en esta request. Se cobra solo al crear.';

-- Índice principal: historial ordenado por conversación
create index if not exists chat_messages_conversation_created_idx
  on public.chat_messages(conversation_id, created_at asc);
create index if not exists chat_messages_user_id_idx
  on public.chat_messages(user_id);

-- RLS para chat_messages (user_id directo — sin JOIN a conversations)
alter table public.chat_messages enable row level security;

create policy "chat_messages_select_own"
  on public.chat_messages for select
  using (auth.uid() = user_id);

create policy "chat_messages_insert_own"
  on public.chat_messages for insert
  with check (auth.uid() = user_id);

create policy "chat_messages_update_own"
  on public.chat_messages for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "chat_messages_delete_own"
  on public.chat_messages for delete
  using (auth.uid() = user_id);
