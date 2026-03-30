-- ============================================================================
-- MIGRACIÓN: Actualizar límites de planes — Zero Hallucination Architecture
-- ============================================================================
-- Pipeline unificado: fast_chat ahora usa enhanced pipeline con key docs
-- completos, lo que incrementa costos. Ajuste de precios y límites.
--
-- Cambios:
--   FREE:   deep_thinking 3→2
--   BÁSICO: precio $16.990→$19.990 (límites sin cambio)
--   PRO:    precio $49.990→$69.990, fast_chat 600→500, full_analysis 60→50, deep_thinking 15→12
--   ULTRA:  precio $89.990→$149.990, fast_chat 1000→800, full_analysis 150→100, deep_thinking 30→25
--
-- La función check_user_limits se actualiza con los nuevos límites.
-- Los precios se manejan en Flow.cl (no en SQL), pero los comentarios reflejan el cambio.
-- ============================================================================

-- Actualizar comentario de plan_type
COMMENT ON COLUMN public.profiles.plan_type IS
  'Plan: free | basico ($24) | pro ($80) | ultra ($170)';

-- Recrear check_user_limits con nuevos límites
CREATE OR REPLACE FUNCTION public.check_user_limits(
  user_id uuid,
  action_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.profiles%ROWTYPE;
  plan text;
  pi int;
  case_limits int[] := ARRAY[1, 10, 30, 100];
  fc_limit int;
  fc_count int;
  fc_is_soft boolean;
  fa_limit int;
  fa_count int;
  dt_limit int;
  dt_count int;
BEGIN
  SELECT * INTO p FROM public.profiles WHERE id = user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'error', 'Perfil no encontrado', 'plan', 'free', 'current_count', 0);
  END IF;

  plan := p.plan_type;
  pi := CASE plan
    WHEN 'free' THEN 1 WHEN 'basico' THEN 2 WHEN 'pro' THEN 3 WHEN 'ultra' THEN 4
    ELSE 1 END;

  PERFORM public.maybe_reset_monthly_counters(user_id);

  CASE action_type

    -- ═══════════ FAST CHAT (Capa 1) ═══════════
    WHEN 'fast_chat' THEN
      IF plan = 'free' THEN
        fc_limit := 20;
        fc_count := p.fast_chat_count;
        fc_is_soft := false;
        IF fc_count >= fc_limit THEN
          RETURN jsonb_build_object(
            'allowed', false,
            'error', 'Límite de Chat Rápido alcanzado. Actualiza tu plan.',
            'current_count', fc_count, 'limit', fc_limit,
            'plan', plan, 'upgrade_required', true
          );
        END IF;
        RETURN jsonb_build_object(
          'allowed', true,
          'current_count', fc_count, 'remaining', fc_limit - fc_count,
          'limit', fc_limit, 'plan', plan
        );
      ELSE
        fc_limit := CASE plan WHEN 'basico' THEN 200 WHEN 'pro' THEN 500 WHEN 'ultra' THEN 800 ELSE 200 END;
        fc_count := p.monthly_fast_chat_count;
        fc_is_soft := plan IN ('pro', 'ultra');

        IF fc_count >= fc_limit AND fc_is_soft THEN
          RETURN jsonb_build_object(
            'allowed', true,
            'message', 'Soft cap alcanzado. Throttle aplicado.',
            'current_count', p.fast_chat_count, 'monthly_count', fc_count,
            'plan', plan, 'fair_use_throttle', true, 'throttle_ms', 30000
          );
        ELSIF fc_count >= fc_limit THEN
          RETURN jsonb_build_object(
            'allowed', false,
            'error', 'Límite mensual de Chat Rápido alcanzado.',
            'current_count', p.fast_chat_count, 'monthly_count', fc_count,
            'limit', fc_limit, 'plan', plan, 'upgrade_required', true
          );
        END IF;
        RETURN jsonb_build_object(
          'allowed', true,
          'current_count', p.fast_chat_count, 'monthly_count', fc_count,
          'monthly_remaining', fc_limit - fc_count,
          'plan', plan, 'fair_use_throttle', false
        );
      END IF;

    -- ═══════════ FULL ANALYSIS (Capa 2) ═══════════
    WHEN 'full_analysis' THEN
      IF plan = 'free' THEN
        fa_limit := 5;
        fa_count := p.full_analysis_count;
        IF fa_count >= fa_limit THEN
          RETURN jsonb_build_object(
            'allowed', false,
            'error', 'Límite de Análisis Completo alcanzado. Actualiza tu plan.',
            'current_count', fa_count, 'limit', fa_limit,
            'plan', plan, 'upgrade_required', true
          );
        END IF;
        RETURN jsonb_build_object(
          'allowed', true,
          'current_count', fa_count, 'remaining', fa_limit - fa_count,
          'limit', fa_limit, 'plan', plan
        );
      ELSE
        fa_limit := CASE plan WHEN 'basico' THEN 15 WHEN 'pro' THEN 50 WHEN 'ultra' THEN 100 ELSE 15 END;
        fa_count := p.monthly_full_analysis_count;
        IF fa_count >= fa_limit THEN
          RETURN jsonb_build_object(
            'allowed', false,
            'error', 'Límite mensual de Análisis Completo alcanzado.',
            'current_count', p.full_analysis_count, 'monthly_count', fa_count,
            'limit', fa_limit, 'plan', plan, 'upgrade_required', true
          );
        END IF;
        RETURN jsonb_build_object(
          'allowed', true,
          'current_count', p.full_analysis_count, 'monthly_count', fa_count,
          'monthly_remaining', fa_limit - fa_count,
          'plan', plan
        );
      END IF;

    -- ═══════════ DEEP THINKING (Capa 3) ═══════════
    WHEN 'deep_thinking' THEN
      IF plan = 'free' THEN
        dt_limit := 2;
        dt_count := p.deep_thinking_count;
        IF dt_count >= dt_limit THEN
          RETURN jsonb_build_object(
            'allowed', false,
            'error', 'Límite de Pensamiento Profundo alcanzado. Actualiza tu plan.',
            'current_count', dt_count, 'limit', dt_limit,
            'plan', plan, 'upgrade_required', true
          );
        END IF;
        RETURN jsonb_build_object(
          'allowed', true,
          'current_count', dt_count, 'remaining', dt_limit - dt_count,
          'limit', dt_limit, 'plan', plan
        );
      ELSE
        dt_limit := CASE plan WHEN 'basico' THEN 5 WHEN 'pro' THEN 12 WHEN 'ultra' THEN 25 ELSE 5 END;
        dt_count := p.monthly_deep_thinking_count;
        IF dt_count >= dt_limit THEN
          RETURN jsonb_build_object(
            'allowed', false,
            'error', 'Límite mensual de Pensamiento Profundo alcanzado.',
            'current_count', p.deep_thinking_count, 'monthly_count', dt_count,
            'limit', dt_limit, 'plan', plan, 'upgrade_required', true
          );
        END IF;
        RETURN jsonb_build_object(
          'allowed', true,
          'current_count', p.deep_thinking_count, 'monthly_count', dt_count,
          'monthly_remaining', dt_limit - dt_count,
          'plan', plan
        );
      END IF;

    -- ═══════════ CASE (Causas) ═══════════
    WHEN 'case' THEN
      DECLARE
        c_limit int;
      BEGIN
        c_limit := case_limits[pi];
        IF p.case_count >= c_limit THEN
          RETURN jsonb_build_object(
            'allowed', false,
            'error', format('Límite de causas alcanzado (%s). Actualiza tu plan.', c_limit),
            'current_count', p.case_count, 'limit', c_limit,
            'plan', plan, 'upgrade_required', true
          );
        END IF;
        RETURN jsonb_build_object(
          'allowed', true,
          'current_count', p.case_count, 'remaining', c_limit - p.case_count,
          'limit', c_limit, 'plan', plan
        );
      END;

    ELSE
      RETURN jsonb_build_object('allowed', false, 'error', 'Acción desconocida: ' || action_type, 'plan', plan, 'current_count', 0);
  END CASE;
END;
$$;
