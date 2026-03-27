/**
 * POST /api/flow/webhook
 *
 * Recibe notificaciones de Flow cuando se procesan pagos de suscripciones.
 * Flow envía un POST con token que debe consultarse para obtener detalles.
 *
 * Se usa como urlCallback en la creación de planes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getSubscription, flowPlanIdToType } from '@/lib/flow'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const subscriptionId = formData.get('subscriptionId') as string | null
    const status = formData.get('status') as string | null

    if (!subscriptionId) {
      console.warn('[flow/webhook] No subscriptionId in payload')
      return NextResponse.json({ received: true })
    }

    console.log(`[flow/webhook] Event: subscriptionId=${subscriptionId} status=${status}`)

    const subscription = await getSubscription(subscriptionId)
    const db = createAdminClient()

    const { data: profile } = await db
      .from('profiles')
      .select('id, plan_type')
      .eq('flow_subscription_id', subscriptionId)
      .maybeSingle()

    if (!profile) {
      const { data: profileByCustomer } = await db
        .from('profiles')
        .select('id, plan_type')
        .eq('flow_customer_id', subscription.customerId)
        .maybeSingle()

      if (!profileByCustomer) {
        console.error(`[flow/webhook] No profile found for subscription ${subscriptionId}`)
        return NextResponse.json({ received: true })
      }

      await processSubscriptionUpdate(db, profileByCustomer.id, subscription)
      return NextResponse.json({ received: true })
    }

    await processSubscriptionUpdate(db, profile.id, subscription)
    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('[flow/webhook] Error:', error)
    return NextResponse.json({ received: true }, { status: 200 })
  }
}

type SupabaseAdmin = ReturnType<typeof createAdminClient>

async function processSubscriptionUpdate(
  db: SupabaseAdmin,
  userId: string,
  subscription: { subscriptionId: string; planId: string; status: number; customerId: string },
) {
  // status: 1=active, 2=past_due, 3=unpaid, 4=cancelled
  if (subscription.status === 4) {
    console.log(`[flow/webhook] Subscription ${subscription.subscriptionId} cancelled → user ${userId} → free`)
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
      .eq('id', userId)
    return
  }

  if (subscription.status === 1) {
    const planType = flowPlanIdToType(subscription.planId)
    if (planType && planType !== 'free') {
      console.log(`[flow/webhook] Subscription ${subscription.subscriptionId} active → user ${userId} → ${planType}`)
      await db
        .from('profiles')
        .update({
          plan_type: planType,
          flow_subscription_id: subscription.subscriptionId,
          flow_plan_id: subscription.planId,
          flow_customer_id: subscription.customerId,
        })
        .eq('id', userId)
    }
  }
}
