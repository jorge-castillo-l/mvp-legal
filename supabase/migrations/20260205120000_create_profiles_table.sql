-- ============================================================================
-- TAREA 1.04: SQL Perfiles & RLS
-- ============================================================================
-- Tabla de perfiles de usuarios con modelo binario FREE/PRO
-- Incluye control de multicuentas mediante device_fingerprint
-- 
-- ACTUALIZACIÓN Feb 2026 - Rediseño Estratégico de Planes:
--   FREE ("Prueba Profesional" - 7 días):
--     1 causa, 20 chats, 3 deep thinking, 3 docs editor IA
--     Borrado automático a los 7 días (The Reaper)
--     Ghost card: se conserva metadata de causa tras borrado
--   PRO ($50.00/mes):
--     500 causas, chat con Fair Use (soft cap 3,000/mes),
--     100 deep thinking/mes, editor ilimitado
--     Fair Use: al superar 3,000 chats/mes se aplica throttle
--     (1 query cada 30s) en vez de bloqueo
-- ============================================================================

-- 1. CREAR TABLA PROFILES
-- ============================================================================

create table if not exists public.profiles (
  -- Identificación
  id uuid references auth.users on delete cascade not null primary key,
  email text,
  
  -- Plan y límites
  plan_type text default 'free' not null check (plan_type in ('free', 'pro')),
  
  -- Contadores de uso (lifetime para FREE, mensual+lifetime para PRO)
  -- FREE: 20 chats (lifetime), 3 deep thinking (lifetime)
  -- PRO: Fair Use soft cap 3,000 chats/mes, 100 deep thinking/mes
  chat_count int default 0 not null check (chat_count >= 0),
  deep_thinking_count int default 0 not null check (deep_thinking_count >= 0),
  
  -- Contadores mensuales (para Fair Use de PRO y reset mensual de DT)
  -- Se resetean automáticamente al cambiar de mes
  monthly_chat_count int default 0 not null check (monthly_chat_count >= 0),
  monthly_deep_thinking_count int default 0 not null check (monthly_deep_thinking_count >= 0),
  monthly_reset_date timestamp with time zone default date_trunc('month', timezone('utc'::text, now())) not null,
  
  -- Control de casos subidos
  -- FREE: 1 causa máximo (borrado a los 7 días)
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
comment on column public.profiles.plan_type is 'Tipo de plan: free (1 causa, 20 chats, 3 deep thinking, 7 días) o pro ($50.00/mes, 500 causas, chat fair use 3000/mes, 100 deep thinking/mes)';
comment on column public.profiles.chat_count is 'Contador lifetime de chats. FREE: límite 20 (lifetime). PRO: acumulativo (solo referencia)';
comment on column public.profiles.deep_thinking_count is 'Contador lifetime de Deep Thinking. FREE: límite 3 (lifetime). PRO: acumulativo (solo referencia)';
comment on column public.profiles.monthly_chat_count is 'Contador mensual de chats para Fair Use PRO. Soft cap: 3,000/mes. Se resetea automáticamente al cambiar de mes';
comment on column public.profiles.monthly_deep_thinking_count is 'Contador mensual de Deep Thinking. PRO: límite 100/mes. Se resetea automáticamente al cambiar de mes';
comment on column public.profiles.monthly_reset_date is 'Primer día del mes actual. Cuando cambia, se resetean los contadores mensuales';
comment on column public.profiles.case_count is 'Contador de causas subidas. Límite: 1 para FREE, 500 para PRO';
comment on column public.profiles.device_fingerprint is 'Hash único del dispositivo para evitar multicuentas FREE. Debe ser único por usuario FREE';
comment on column public.profiles.last_active_date is 'Última actividad. Usado por The Reaper para borrar cuentas FREE inactivas después de 7 días';


-- 2. ÍNDICES PARA OPTIMIZACIÓN
-- ============================================================================

-- Índice para búsquedas por email (útil para admin)
create index if not exists profiles_email_idx on public.profiles(email);

-- Índice para el script "The Reaper" (Tarea 23)
-- Busca usuarios FREE con más de 7 días de inactividad
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


-- 6. FUNCIÓN HELPER: RESETEAR CONTADORES MENSUALES
-- ============================================================================
-- Se ejecuta dentro de check_user_limits para garantizar que los contadores
-- mensuales se reseteen automáticamente al cambiar de mes.

create or replace function public.maybe_reset_monthly_counters(
  user_id uuid
)
returns void
language plpgsql
security definer
as $$
declare
  current_month_start timestamp with time zone;
begin
  current_month_start := date_trunc('month', timezone('utc'::text, now()));
  
  update public.profiles
  set
    monthly_chat_count = 0,
    monthly_deep_thinking_count = 0,
    monthly_reset_date = current_month_start
  where id = user_id
    and monthly_reset_date < current_month_start;
end;
$$;

comment on function public.maybe_reset_monthly_counters is 'Resetea contadores mensuales si el mes cambió. Idempotente: solo resetea una vez por mes';


-- 7. FUNCIÓN HELPER: VERIFICAR LÍMITES DE PLAN
-- ============================================================================
-- ACTUALIZACIÓN Feb 2026:
--   FREE: 20 chats (lifetime), 3 deep thinking (lifetime), 1 causa
--   PRO: Fair Use 3,000 chats/mes (soft cap con throttle), 100 DT/mes, 500 causas

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
  -- Resetear contadores mensuales si corresponde
  perform public.maybe_reset_monthly_counters(user_id);

  -- Obtener perfil del usuario (con contadores ya reseteados si aplica)
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
      -- FREE: 20 chats lifetime (hard block)
      if user_profile.plan_type = 'free' and user_profile.chat_count >= 20 then
        return jsonb_build_object(
          'allowed', false,
          'error', 'FREE plan limit reached: 20 chats maximum. Upgrade to Pro for unlimited access.',
          'current_count', user_profile.chat_count,
          'limit', 20,
          'plan', 'free',
          'upgrade_required', true
        );
      -- PRO: Fair Use soft cap 3,000/mes (throttle, NOT block)
      elsif user_profile.plan_type = 'pro' and user_profile.monthly_chat_count >= 3000 then
        return jsonb_build_object(
          'allowed', true,
          'message', 'PRO plan: Fair Use soft cap reached. Throttle applied.',
          'current_count', user_profile.chat_count,
          'monthly_count', user_profile.monthly_chat_count,
          'plan', 'pro',
          'fair_use_throttle', true,
          'throttle_ms', 30000
        );
      -- PRO: Normal (below soft cap)
      elsif user_profile.plan_type = 'pro' then
        return jsonb_build_object(
          'allowed', true,
          'message', 'PRO plan: chat allowed',
          'current_count', user_profile.chat_count,
          'monthly_count', user_profile.monthly_chat_count,
          'monthly_remaining', 3000 - user_profile.monthly_chat_count,
          'plan', 'pro',
          'fair_use_throttle', false
        );
      -- FREE: Below limit
      else
        return jsonb_build_object(
          'allowed', true,
          'current_count', user_profile.chat_count,
          'remaining', 20 - user_profile.chat_count,
          'limit', 20,
          'plan', 'free'
        );
      end if;

    when 'deep_thinking' then
      -- FREE: 3 deep thinking lifetime (hard block)
      if user_profile.plan_type = 'free' and user_profile.deep_thinking_count >= 3 then
        return jsonb_build_object(
          'allowed', false,
          'error', 'FREE plan limit reached: 3 Deep Thinking maximum. Upgrade to Pro for 100/month.',
          'current_count', user_profile.deep_thinking_count,
          'limit', 3,
          'plan', 'free',
          'upgrade_required', true
        );
      -- PRO: 100 deep thinking por MES (hard block mensual)
      elsif user_profile.plan_type = 'pro' and user_profile.monthly_deep_thinking_count >= 100 then
        return jsonb_build_object(
          'allowed', false,
          'error', 'PRO plan monthly limit reached: 100 Deep Thinking per month. Resets next month.',
          'current_count', user_profile.deep_thinking_count,
          'monthly_count', user_profile.monthly_deep_thinking_count,
          'limit', 100,
          'plan', 'pro'
        );
      -- PRO: Below monthly limit
      elsif user_profile.plan_type = 'pro' then
        return jsonb_build_object(
          'allowed', true,
          'current_count', user_profile.deep_thinking_count,
          'monthly_count', user_profile.monthly_deep_thinking_count,
          'remaining', 100 - user_profile.monthly_deep_thinking_count,
          'plan', 'pro'
        );
      -- FREE: Below limit
      else
        return jsonb_build_object(
          'allowed', true,
          'current_count', user_profile.deep_thinking_count,
          'remaining', 3 - user_profile.deep_thinking_count,
          'limit', 3,
          'plan', 'free'
        );
      end if;

    when 'case' then
      if user_profile.plan_type = 'free' and user_profile.case_count >= 1 then
        return jsonb_build_object(
          'allowed', false,
          'error', 'FREE plan limit reached: 1 case maximum. Upgrade to Pro for 500 cases.',
          'current_count', user_profile.case_count,
          'limit', 1,
          'plan', 'free',
          'upgrade_required', true
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

comment on function public.check_user_limits is 'Verifica si un usuario puede realizar una acción según su plan y contadores actuales. Incluye Fair Use para PRO (soft cap 3,000 chats/mes con throttle)';


-- 8. FUNCIÓN: INCREMENTAR CONTADORES
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
  -- Primero verificar límites (esto también resetea contadores mensuales si necesario)
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
        monthly_chat_count = monthly_chat_count + 1,
        last_active_date = timezone('utc'::text, now())
      where id = user_id;

    when 'deep_thinking' then
      update public.profiles
      set 
        deep_thinking_count = deep_thinking_count + 1,
        monthly_deep_thinking_count = monthly_deep_thinking_count + 1,
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

comment on function public.increment_counter is 'Incrementa contadores lifetime y mensuales. Valida límites antes de incrementar. Fair Use: permite pero marca throttle para PRO >3,000 chats/mes';


-- ============================================================================
-- FIN DE MIGRACIÓN: PROFILES TABLE
-- ============================================================================
