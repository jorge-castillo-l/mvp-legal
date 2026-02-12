-- ============================================================================
-- MIGRACIÓN: Fix Function Search Path Security
-- ============================================================================
-- Añade SET search_path = public a las funciones para prevenir
-- ataques de inyección de schemas (Supabase Lint Warning 0011)
--
-- Funciones afectadas:
--   - handle_updated_at
--   - maybe_reset_monthly_counters
--   - check_user_limits
--   - increment_counter
-- ============================================================================

-- 1. FUNCIÓN: ACTUALIZAR TIMESTAMP AUTOMÁTICAMENTE
-- ============================================================================

create or replace function public.handle_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

comment on function public.handle_updated_at is 'Actualiza automáticamente updated_at. Security: search_path fijado a public';


-- 2. FUNCIÓN HELPER: RESETEAR CONTADORES MENSUALES
-- ============================================================================

create or replace function public.maybe_reset_monthly_counters(
  user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
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

comment on function public.maybe_reset_monthly_counters is 'Resetea contadores mensuales si el mes cambió. Idempotente: solo resetea una vez por mes. Security: search_path fijado a public';


-- 3. FUNCIÓN HELPER: VERIFICAR LÍMITES DE PLAN
-- ============================================================================

create or replace function public.check_user_limits(
  user_id uuid,
  action_type text -- 'chat', 'deep_thinking', 'case'
)
returns jsonb
language plpgsql
security definer
set search_path = public
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

comment on function public.check_user_limits is 'Verifica si un usuario puede realizar una acción según su plan y contadores actuales. Incluye Fair Use para PRO (soft cap 3,000 chats/mes con throttle). Security: search_path fijado a public';


-- 4. FUNCIÓN: INCREMENTAR CONTADORES
-- ============================================================================

create or replace function public.increment_counter(
  user_id uuid,
  counter_type text -- 'chat', 'deep_thinking', 'case'
)
returns boolean
language plpgsql
security definer
set search_path = public
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

comment on function public.increment_counter is 'Incrementa contadores lifetime y mensuales. Valida límites antes de incrementar. Fair Use: permite pero marca throttle para PRO >3,000 chats/mes. Security: search_path fijado a public';


-- ============================================================================
-- FIN DE MIGRACIÓN: FUNCTION SEARCH PATH SECURITY
-- ============================================================================
