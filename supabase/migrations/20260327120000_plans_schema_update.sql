-- ============================================================================
-- TAREA 6.04: Plans Schema Update (4 Planes + 3 Capas IA + OCR Tracking)
-- ============================================================================
-- DESBLOQUEA: 4.04 (Rate Limiting) + 6.01 (Stripe)
--
-- Cambios:
--   1. plan_type: 'free'|'pro' → 'free'|'basico'|'pro'|'ultra'
--   2. chat_count/monthly_chat_count → fast_chat_count/monthly_fast_chat_count
--   3. Nuevas columnas: full_analysis_count + monthly_full_analysis_count
--   4. Nueva tabla: ocr_usage (tracking de páginas OCR por documento)
--   5. Funciones actualizadas: check_user_limits, increment_counter,
--      maybe_reset_monthly_counters, handle_new_user
--
-- Planes (margen ~70% usuario típico):
--   FREE:   1 causa  | 20 fast_chat (life) | 5 full (life) | 3 deep (life)
--   BÁSICO: 10 causas | 200/mes            | 15/mes        | 5/mes    — $20
--   PRO:    30 causas | 600/mes (soft)     | 60/mes        | 15/mes   — $60
--   ULTRA:  100 causas| 1000/mes (soft)    | 150/mes       | 30/mes   — $99
-- ============================================================================

-- ============================================================================
-- 1. MIGRAR plan_type DE 'pro' A 'ultra' (si existen registros)
-- ============================================================================
UPDATE public.profiles SET plan_type = 'ultra' WHERE plan_type = 'pro';

-- ============================================================================
-- 2. CAMBIAR CHECK CONSTRAINT DE plan_type
-- ============================================================================
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_plan_type_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_plan_type_check
  CHECK (plan_type IN ('free', 'basico', 'pro', 'ultra'));

-- ============================================================================
-- 3. RENOMBRAR COLUMNAS chat → fast_chat
-- ============================================================================
ALTER TABLE public.profiles RENAME COLUMN chat_count TO fast_chat_count;
ALTER TABLE public.profiles RENAME COLUMN monthly_chat_count TO monthly_fast_chat_count;

-- ============================================================================
-- 4. AGREGAR COLUMNAS full_analysis
-- ============================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS full_analysis_count int DEFAULT 0 NOT NULL
    CHECK (full_analysis_count >= 0);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS monthly_full_analysis_count int DEFAULT 0 NOT NULL
    CHECK (monthly_full_analysis_count >= 0);

-- ============================================================================
-- 5. ACTUALIZAR COMENTARIOS
-- ============================================================================
COMMENT ON COLUMN public.profiles.plan_type IS
  'Plan: free | basico ($20) | pro ($60) | ultra ($99)';
COMMENT ON COLUMN public.profiles.fast_chat_count IS
  'Contador lifetime de Capa 1 (Gemini Flash). FREE: 20 lifetime.';
COMMENT ON COLUMN public.profiles.monthly_fast_chat_count IS
  'Contador mensual Capa 1. PRO/ULTRA: soft cap con throttle 30s.';
COMMENT ON COLUMN public.profiles.full_analysis_count IS
  'Contador lifetime de Capa 2 (Claude Sonnet). FREE: 5 lifetime.';
COMMENT ON COLUMN public.profiles.monthly_full_analysis_count IS
  'Contador mensual Capa 2. Hard cap por plan.';
COMMENT ON COLUMN public.profiles.deep_thinking_count IS
  'Contador lifetime de Capa 3 (Claude Opus). FREE: 3 lifetime.';
COMMENT ON COLUMN public.profiles.monthly_deep_thinking_count IS
  'Contador mensual Capa 3. Hard cap por plan.';

-- ============================================================================
-- 6. ACTUALIZAR ÍNDICE REAPER (plan_type = 'free')
-- ============================================================================
DROP INDEX IF EXISTS profiles_reaper_idx;
CREATE INDEX profiles_reaper_idx
  ON public.profiles(plan_type, last_active_date)
  WHERE plan_type = 'free';

DROP INDEX IF EXISTS profiles_free_fingerprint_unique_idx;
CREATE UNIQUE INDEX profiles_free_fingerprint_unique_idx
  ON public.profiles(device_fingerprint)
  WHERE plan_type = 'free' AND device_fingerprint IS NOT NULL;

-- ============================================================================
-- 7. CREAR TABLA ocr_usage
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ocr_usage (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  case_id uuid REFERENCES public.cases(id) ON DELETE SET NULL,
  pages_processed int NOT NULL DEFAULT 0 CHECK (pages_processed >= 0),
  processing_type text NOT NULL DEFAULT 'document_ai'
    CHECK (processing_type IN ('document_ai', 'pdf_parse', 'tesseract')),
  cost_estimate_usd numeric(10, 6) DEFAULT 0,
  created_at timestamptz DEFAULT timezone('utc', now()) NOT NULL
);

CREATE INDEX ocr_usage_user_id_idx ON public.ocr_usage(user_id);
CREATE INDEX ocr_usage_created_at_idx ON public.ocr_usage(user_id, created_at);

ALTER TABLE public.ocr_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ocr_usage_select_own" ON public.ocr_usage
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "ocr_usage_insert_own" ON public.ocr_usage
  FOR INSERT WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE public.ocr_usage IS
  'Tracking de páginas OCR procesadas por Document AI. Para analytics de costos y límites futuros.';

-- ============================================================================
-- 8. FUNCIÓN: maybe_reset_monthly_counters (actualizada para 3 capas)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.maybe_reset_monthly_counters(
  user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_month_start timestamptz;
BEGIN
  current_month_start := date_trunc('month', timezone('utc', now()));

  UPDATE public.profiles
  SET
    monthly_fast_chat_count = 0,
    monthly_full_analysis_count = 0,
    monthly_deep_thinking_count = 0,
    monthly_reset_date = current_month_start
  WHERE id = user_id
    AND monthly_reset_date < current_month_start;
END;
$$;

COMMENT ON FUNCTION public.maybe_reset_monthly_counters IS
  'Resetea contadores mensuales de las 3 capas si el mes cambió. Idempotente.';

-- ============================================================================
-- 9. FUNCIÓN: check_user_limits (3 capas × 4 planes)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.check_user_limits(
  user_id uuid,
  action_type text -- 'fast_chat', 'full_analysis', 'deep_thinking', 'case'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p record;
  plan text;
  -- Límites por plan: [free, basico, pro, ultra]
  -- Causas
  case_limits int[] := ARRAY[1, 10, 30, 100];
  -- Capa 1 (fast_chat): FREE=lifetime 20, otros=mensual
  fc_limit int;
  fc_count int;
  fc_is_soft boolean;
  -- Capa 2 (full_analysis): FREE=lifetime 5, otros=mensual
  fa_limit int;
  fa_count int;
  -- Capa 3 (deep_thinking): FREE=lifetime 3, otros=mensual
  dt_limit int;
  dt_count int;
  -- Plan index para array lookup
  pi int;
BEGIN
  PERFORM public.maybe_reset_monthly_counters(user_id);

  SELECT * INTO p FROM public.profiles WHERE id = user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'error', 'Profile not found');
  END IF;

  plan := p.plan_type;
  pi := CASE plan
    WHEN 'free' THEN 1 WHEN 'basico' THEN 2 WHEN 'pro' THEN 3 WHEN 'ultra' THEN 4
    ELSE 1
  END;

  CASE action_type

    -- ═══════════ FAST CHAT (Capa 1) ═══════════
    WHEN 'fast_chat' THEN
      IF plan = 'free' THEN
        fc_limit := 20;
        fc_count := p.fast_chat_count; -- lifetime
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
        -- Planes pagados: mensual
        fc_limit := CASE plan WHEN 'basico' THEN 200 WHEN 'pro' THEN 600 WHEN 'ultra' THEN 1000 ELSE 200 END;
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
        fa_count := p.full_analysis_count; -- lifetime
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
        fa_limit := CASE plan WHEN 'basico' THEN 15 WHEN 'pro' THEN 60 WHEN 'ultra' THEN 150 ELSE 15 END;
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
        dt_limit := 3;
        dt_count := p.deep_thinking_count; -- lifetime
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
        dt_limit := CASE plan WHEN 'basico' THEN 5 WHEN 'pro' THEN 15 WHEN 'ultra' THEN 30 ELSE 5 END;
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
          'current_count', p.case_count,
          'remaining', c_limit - p.case_count,
          'plan', plan
        );
      END;

    ELSE
      RETURN jsonb_build_object('allowed', false, 'error', 'Invalid action type: ' || action_type);

  END CASE;
END;
$$;

COMMENT ON FUNCTION public.check_user_limits IS
  'Verifica límites por plan (free/basico/pro/ultra) y capa (fast_chat/full_analysis/deep_thinking/case). Soft cap con throttle para fast_chat en PRO/ULTRA.';

-- ============================================================================
-- 10. FUNCIÓN: increment_counter (3 capas)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.increment_counter(
  user_id uuid,
  counter_type text -- 'fast_chat', 'full_analysis', 'deep_thinking', 'case'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  limits_check jsonb;
BEGIN
  limits_check := public.check_user_limits(user_id, counter_type);

  IF (limits_check->>'allowed')::boolean = false THEN
    RAISE EXCEPTION '%', limits_check->>'error';
  END IF;

  CASE counter_type
    WHEN 'fast_chat' THEN
      UPDATE public.profiles
      SET
        fast_chat_count = fast_chat_count + 1,
        monthly_fast_chat_count = monthly_fast_chat_count + 1,
        last_active_date = timezone('utc', now())
      WHERE id = user_id;

    WHEN 'full_analysis' THEN
      UPDATE public.profiles
      SET
        full_analysis_count = full_analysis_count + 1,
        monthly_full_analysis_count = monthly_full_analysis_count + 1,
        last_active_date = timezone('utc', now())
      WHERE id = user_id;

    WHEN 'deep_thinking' THEN
      UPDATE public.profiles
      SET
        deep_thinking_count = deep_thinking_count + 1,
        monthly_deep_thinking_count = monthly_deep_thinking_count + 1,
        last_active_date = timezone('utc', now())
      WHERE id = user_id;

    WHEN 'case' THEN
      UPDATE public.profiles
      SET
        case_count = case_count + 1,
        last_active_date = timezone('utc', now())
      WHERE id = user_id;

    ELSE
      RAISE EXCEPTION 'Invalid counter type: %', counter_type;
  END CASE;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.increment_counter IS
  'Incrementa contadores lifetime y mensuales para 3 capas IA + causas. Valida límites antes de incrementar.';

-- ============================================================================
-- 11. FUNCIÓN: handle_new_user (alineada con nuevas columnas)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, plan_type)
  VALUES (new.id, new.email, 'free');
  RETURN new;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user IS
  'Crea perfil FREE al registrarse. Columnas con DEFAULT 0 se inicializan automáticamente.';

-- ============================================================================
-- FIN DE MIGRACIÓN: 6.04 Plans Schema Update
-- ============================================================================
