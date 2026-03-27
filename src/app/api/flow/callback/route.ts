/**
 * GET /api/flow/callback
 *
 * Flow redirige aquí tras registro de tarjeta.
 * Query params: token (de Flow) + plan + userId (nuestros)
 *
 * Flujo:
 *   1. Verificar que el registro de tarjeta fue exitoso
 *   2. Crear suscripción en Flow
 *   3. Actualizar plan_type + flow_subscription_id en profiles
 *   4. Redirect a /dashboard/suscripcion con resultado
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import {
  getRegisterStatus,
  createSubscription,
  planTypeToFlowId,
  flowPlanIdToType,
} from '@/lib/flow'
import type { PlanType } from '@/lib/database.types'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')
  const planType = searchParams.get('plan') as PlanType | null
  const userId = searchParams.get('userId')

  if (!token || !planType || !userId) {
    return NextResponse.redirect(`${APP_URL}/dashboard/suscripcion?error=params_missing`)
  }

  try {
    const registerStatus = await getRegisterStatus(token)

    if (registerStatus.status !== 1) {
      console.error('[flow/callback] Card registration failed:', registerStatus)
      return NextResponse.redirect(`${APP_URL}/dashboard/suscripcion?error=card_failed`)
    }

    const flowPlanId = planTypeToFlowId(planType)
    if (!flowPlanId) {
      return NextResponse.redirect(`${APP_URL}/dashboard/suscripcion?error=invalid_plan`)
    }

    const subscription = await createSubscription(registerStatus.customerId, flowPlanId)

    const db = createAdminClient()
    const resolvedPlanType = flowPlanIdToType(subscription.planId) || planType

    await db
      .from('profiles')
      .update({
        plan_type: resolvedPlanType,
        flow_subscription_id: subscription.subscriptionId,
        flow_plan_id: subscription.planId,
        flow_customer_id: registerStatus.customerId,
      })
      .eq('id', userId)

    console.log(`[flow/callback] User ${userId} subscribed to ${resolvedPlanType} (sub: ${subscription.subscriptionId})`)

    return NextResponse.redirect(`${APP_URL}/dashboard/suscripcion?success=subscribed&plan=${resolvedPlanType}`)
  } catch (error) {
    console.error('[flow/callback] Error:', error)
    return NextResponse.redirect(`${APP_URL}/dashboard/suscripcion?error=subscription_failed`)
  }
}
