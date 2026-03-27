-- ============================================================================
-- TAREA 6.01: Flow.cl Integration — Columnas de suscripción en profiles
-- ============================================================================
-- Agrega campos para vincular usuario Supabase ↔ customer/subscription Flow.
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS flow_customer_id text,
  ADD COLUMN IF NOT EXISTS flow_subscription_id text,
  ADD COLUMN IF NOT EXISTS flow_plan_id text;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_flow_customer_id_idx
  ON public.profiles(flow_customer_id)
  WHERE flow_customer_id IS NOT NULL;

COMMENT ON COLUMN public.profiles.flow_customer_id IS
  'ID del customer en Flow.cl. Se crea al suscribirse por primera vez.';
COMMENT ON COLUMN public.profiles.flow_subscription_id IS
  'ID de la suscripción activa en Flow.cl. NULL si no está suscrito.';
COMMENT ON COLUMN public.profiles.flow_plan_id IS
  'planId de Flow (plan_basico/plan_pro/plan_ultra). Para reconciliar con plan_type.';
