/**
 * POST /api/flow/portal
 *
 * Gestión de suscripción: cambiar plan o cancelar.
 *
 * Body:
 *   { action: 'cancel' }
 *   { action: 'change', newPlan: 'basico' | 'pro' | 'ultra' }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import {
  cancelSubscription,
  changePlan,
  planTypeToFlowId,
  flowPlanIdToType,
} from '@/lib/flow'
import type { PlanType } from '@/lib/database.types'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json()
    const { action, newPlan } = body as { action: 'cancel' | 'change'; newPlan?: PlanType }

    const db = createAdminClient()
    const { data: profile } = await db
      .from('profiles')
      .select('flow_subscription_id, flow_customer_id, plan_type')
      .eq('id', user.id)
      .single()

    if (!profile?.flow_subscription_id) {
      return NextResponse.json(
        { error: 'No tienes una suscripción activa' },
        { status: 400 },
      )
    }

    if (action === 'cancel') {
      await cancelSubscription(profile.flow_subscription_id, true)

      await db
        .from('profiles')
        .update({
          plan_type: 'free',
          flow_subscription_id: null,
          flow_plan_id: null,
          monthly_fast_chat_count: 0,
          monthly_full_analysis_count: 0,
          monthly_deep_thinking_count: 0,
        })
        .eq('id', user.id)

      return NextResponse.json({ success: true, plan: 'free' })
    }

    if (action === 'change' && newPlan) {
      if (newPlan === 'free') {
        return NextResponse.json({ error: 'Usa cancel para volver a free' }, { status: 400 })
      }

      const flowPlanId = planTypeToFlowId(newPlan)
      if (!flowPlanId) {
        return NextResponse.json({ error: 'Plan no configurado' }, { status: 400 })
      }

      if (!profile.flow_customer_id) {
        return NextResponse.json({ error: 'Customer Flow no encontrado' }, { status: 400 })
      }

      const newSub = await changePlan(
        profile.flow_subscription_id,
        profile.flow_customer_id,
        flowPlanId,
      )

      const resolvedPlan = flowPlanIdToType(newSub.planId) || newPlan

      await db
        .from('profiles')
        .update({
          plan_type: resolvedPlan,
          flow_subscription_id: newSub.subscriptionId,
          flow_plan_id: newSub.planId,
        })
        .eq('id', user.id)

      return NextResponse.json({ success: true, plan: resolvedPlan })
    }

    return NextResponse.json({ error: 'Acción inválida' }, { status: 400 })
  } catch (error) {
    console.error('[flow/portal] Error:', error)
    const msg = error instanceof Error ? error.message : 'Error interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
