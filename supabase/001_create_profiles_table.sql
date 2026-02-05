-- ============================================================================
-- TAREA 1.04: SQL Perfiles & RLS
-- ============================================================================
-- Tabla de perfiles de usuarios con modelo binario FREE/PRO
-- Incluye control de multicuentas mediante device_fingerprint
-- ============================================================================

-- 1. CREAR TABLA PROFILES
-- ============================================================================

create table if not exists public.profiles (
  -- Identificación
  id uuid references auth.users on delete cascade not null primary key,
  email text,
  
  -- Plan y límites
  plan_type text default 'free' not null check (plan_type in ('free', 'pro')),
  
  -- Contadores (Modelo Binario)
  -- FREE: 10 chats, 1 deep thinking
  -- PRO: Ilimitado chats, 100 deep thinking
  chat_count int default 0 not null check (chat_count >= 0),
  deep_thinking_count int default 0 not null check (deep_thinking_count >= 0),
  
  -- Control de casos subidos
  -- FREE: 1 causa máximo (borrado a los 3 días)
  -- PRO: 500 causas
  case_count int default 0 not null check (case_count >= 0),
  
  -- Anti-Multicuentas (Tarea 24: Fingerprinting Shield)
  -- Este campo debe ser único para usuarios FREE
  device_fingerprint text,
  
  -- Gestión temporal (Para "The Reaper" - Tarea 23)
  last_active_date timestamp with time zone default timezone('utc'::text, now()) not null,
  
  -- Timestamps
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Comentarios para documentación
comment on table public.profiles is 'Perfiles de usuarios con control de planes FREE/PRO y límites de uso';
comment on column public.profiles.plan_type is 'Tipo de plan: free (1 causa, 10 chats, 1 deep thinking, borrado 3 días) o pro ($29.90, 500 causas, chat ilimitado, 100 deep thinking)';
comment on column public.profiles.chat_count is 'Contador de chats realizados. Límite: 10 para FREE, ilimitado para PRO';
comment on column public.profiles.deep_thinking_count is 'Contador de Deep Thinking. Límite: 1 para FREE, 100 para PRO';
comment on column public.profiles.case_count is 'Contador de causas subidas. Límite: 1 para FREE, 500 para PRO';
comment on column public.profiles.device_fingerprint is 'Hash único del dispositivo para evitar multicuentas FREE. Debe ser único por usuario FREE';
comment on column public.profiles.last_active_date is 'Última actividad. Usado por The Reaper para borrar cuentas FREE inactivas después de 3 días';


-- 2. ÍNDICES PARA OPTIMIZACIÓN
-- ============================================================================

-- Índice para búsquedas por email (útil para admin)
create index if not exists profiles_email_idx on public.profiles(email);

-- Índice para el script "The Reaper" (Tarea 23)
-- Busca usuarios FREE con más de 3 días de inactividad
create index if not exists profiles_reaper_idx 
  on public.profiles(plan_type, last_active_date) 
  where plan_type = 'free';

-- Índice para control de multicuentas (Tarea 24)
-- Device fingerprint debe ser único para usuarios FREE
create unique index if not exists profiles_free_fingerprint_unique_idx 
  on public.profiles(device_fingerprint) 
  where plan_type = 'free' and device_fingerprint is not null;

-- Índice para actualización de timestamp
create index if not exists profiles_updated_at_idx on public.profiles(updated_at);


-- 3. ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Activar RLS
alter table public.profiles enable row level security;

-- Política: Los usuarios pueden VER su propio perfil
create policy "profiles_select_own"
  on public.profiles
  for select
  using (auth.uid() = id);

-- Política: Los usuarios pueden ACTUALIZAR su propio perfil
-- (Pero solo campos permitidos: device_fingerprint, last_active_date)
create policy "profiles_update_own"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Política: Solo el sistema puede INSERTAR perfiles (vía trigger)
-- Los usuarios NO pueden crear perfiles manualmente
create policy "profiles_insert_system_only"
  on public.profiles
  for insert
  with check (false);

-- Política: Los usuarios NO pueden eliminar sus propios perfiles
-- Solo el sistema (The Reaper) o admins pueden hacerlo
create policy "profiles_delete_system_only"
  on public.profiles
  for delete
  using (false);


-- 4. TRIGGER: CREAR PERFIL AUTOMÁTICAMENTE AL REGISTRARSE
-- ============================================================================

-- Función que se ejecuta cuando un nuevo usuario se registra
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, plan_type)
  values (
    new.id,
    new.email,
    'free' -- Todos los usuarios inician con plan FREE
  );
  return new;
end;
$$;

-- Trigger que llama a la función anterior
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

comment on function public.handle_new_user is 'Crea automáticamente un perfil FREE cuando un usuario se registra en auth.users';


-- 5. FUNCIÓN: ACTUALIZAR TIMESTAMP AUTOMÁTICAMENTE
-- ============================================================================

create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row
  execute function public.handle_updated_at();


-- 6. FUNCIÓN HELPER: VERIFICAR LÍMITES DE PLAN
-- ============================================================================

create or replace function public.check_user_limits(
  user_id uuid,
  action_type text -- 'chat', 'deep_thinking', 'case'
)
returns jsonb
language plpgsql
security definer
as $$
declare
  user_profile record;
  result jsonb;
begin
  -- Obtener perfil del usuario
  select * into user_profile
  from public.profiles
  where id = user_id;

  -- Si no existe perfil, retornar error
  if not found then
    return jsonb_build_object(
      'allowed', false,
      'error', 'Profile not found'
    );
  end if;

  -- Verificar según tipo de acción y plan
  case action_type
    when 'chat' then
      if user_profile.plan_type = 'free' and user_profile.chat_count >= 10 then
        return jsonb_build_object(
          'allowed', false,
          'error', 'FREE plan limit reached: 10 chats maximum',
          'current_count', user_profile.chat_count,
          'limit', 10,
          'plan', 'free'
        );
      elsif user_profile.plan_type = 'pro' then
        return jsonb_build_object(
          'allowed', true,
          'message', 'PRO plan: unlimited chats',
          'current_count', user_profile.chat_count,
          'plan', 'pro'
        );
      else
        return jsonb_build_object(
          'allowed', true,
          'current_count', user_profile.chat_count,
          'remaining', 10 - user_profile.chat_count,
          'plan', 'free'
        );
      end if;

    when 'deep_thinking' then
      if user_profile.plan_type = 'free' and user_profile.deep_thinking_count >= 1 then
        return jsonb_build_object(
          'allowed', false,
          'error', 'FREE plan limit reached: 1 Deep Thinking maximum',
          'current_count', user_profile.deep_thinking_count,
          'limit', 1,
          'plan', 'free'
        );
      elsif user_profile.plan_type = 'pro' and user_profile.deep_thinking_count >= 100 then
        return jsonb_build_object(
          'allowed', false,
          'error', 'PRO plan limit reached: 100 Deep Thinking maximum',
          'current_count', user_profile.deep_thinking_count,
          'limit', 100,
          'plan', 'pro'
        );
      else
        return jsonb_build_object(
          'allowed', true,
          'current_count', user_profile.deep_thinking_count,
          'remaining', case 
            when user_profile.plan_type = 'free' then 1 - user_profile.deep_thinking_count
            else 100 - user_profile.deep_thinking_count
          end,
          'plan', user_profile.plan_type
        );
      end if;

    when 'case' then
      if user_profile.plan_type = 'free' and user_profile.case_count >= 1 then
        return jsonb_build_object(
          'allowed', false,
          'error', 'FREE plan limit reached: 1 case maximum',
          'current_count', user_profile.case_count,
          'limit', 1,
          'plan', 'free'
        );
      elsif user_profile.plan_type = 'pro' and user_profile.case_count >= 500 then
        return jsonb_build_object(
          'allowed', false,
          'error', 'PRO plan limit reached: 500 cases maximum',
          'current_count', user_profile.case_count,
          'limit', 500,
          'plan', 'pro'
        );
      else
        return jsonb_build_object(
          'allowed', true,
          'current_count', user_profile.case_count,
          'remaining', case 
            when user_profile.plan_type = 'free' then 1 - user_profile.case_count
            else 500 - user_profile.case_count
          end,
          'plan', user_profile.plan_type
        );
      end if;

    else
      return jsonb_build_object(
        'allowed', false,
        'error', 'Invalid action type'
      );
  end case;
end;
$$;

comment on function public.check_user_limits is 'Verifica si un usuario puede realizar una acción según su plan y contadores actuales';


-- 7. FUNCIÓN: INCREMENTAR CONTADORES
-- ============================================================================

create or replace function public.increment_counter(
  user_id uuid,
  counter_type text -- 'chat', 'deep_thinking', 'case'
)
returns boolean
language plpgsql
security definer
as $$
declare
  limits_check jsonb;
begin
  -- Primero verificar límites
  limits_check := public.check_user_limits(user_id, counter_type);

  if (limits_check->>'allowed')::boolean = false then
    raise exception '%', limits_check->>'error';
  end if;

  -- Incrementar el contador correspondiente
  case counter_type
    when 'chat' then
      update public.profiles
      set 
        chat_count = chat_count + 1,
        last_active_date = timezone('utc'::text, now())
      where id = user_id;

    when 'deep_thinking' then
      update public.profiles
      set 
        deep_thinking_count = deep_thinking_count + 1,
        last_active_date = timezone('utc'::text, now())
      where id = user_id;

    when 'case' then
      update public.profiles
      set 
        case_count = case_count + 1,
        last_active_date = timezone('utc'::text, now())
      where id = user_id;

    else
      raise exception 'Invalid counter type: %', counter_type;
  end case;

  return true;
end;
$$;

comment on function public.increment_counter is 'Incrementa un contador de uso y actualiza last_active_date. Valida límites antes de incrementar';


-- 8. DATOS DE PRUEBA (OPCIONAL - SOLO DESARROLLO)
-- ============================================================================
-- Descomentar para crear usuarios de prueba

-- insert into auth.users (id, email) values
--   ('00000000-0000-0000-0000-000000000001', 'test_free@example.com'),
--   ('00000000-0000-0000-0000-000000000002', 'test_pro@example.com')
-- on conflict (id) do nothing;

-- update public.profiles 
-- set plan_type = 'pro' 
-- where email = 'test_pro@example.com';


-- ============================================================================
-- FIN DE MIGRACIÓN 001: PROFILES TABLE
-- ============================================================================
