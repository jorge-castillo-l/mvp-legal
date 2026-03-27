/**
 * POST /api/flow/subscribe
 *
 * Inicia el flujo de suscripción:
 *   1. Crea customer en Flow (o reutiliza existente)
 *   2. Redirige al usuario a Flow para registrar tarjeta
 *
 * Body: { planType: 'basico' | 'pro' | 'ultra' }
 * Response: { redirectUrl: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import {
  createCustomer,
  registerCard,
  planTypeToFlowId,
} from '@/lib/flow'
import type { PlanType } from '@/lib/database.types'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { planType } = (await request.json()) as { planType: PlanType }

    if (!planType || planType === 'free') {
      return NextResponse.json({ error: 'Plan inválido' }, { status: 400 })
    }

    const flowPlanId = planTypeToFlowId(planType)
    if (!flowPlanId) {
      return NextResponse.json({ error: 'Plan no configurado en Flow' }, { status: 400 })
    }

    const db = createAdminClient()

    const { data: profile } = await db
      .from('profiles')
      .select('flow_customer_id, email, plan_type')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Perfil no encontrado' }, { status: 404 })
    }

    if (profile.plan_type !== 'free' && profile.plan_type === planType) {
      return NextResponse.json({ error: 'Ya estás suscrito a este plan' }, { status: 400 })
    }

    let flowCustomerId = profile.flow_customer_id

    if (!flowCustomerId) {
      const customer = await createCustomer(
        profile.email || user.email || '',
        user.email?.split('@')[0] || 'usuario',
        user.id,
      )
      flowCustomerId = customer.customerId

      await db
        .from('profiles')
        .update({ flow_customer_id: flowCustomerId })
        .eq('id', user.id)
    }

    const callbackUrl = `${APP_URL}/api/flow/callback?plan=${planType}&userId=${user.id}`
    const { redirectUrl } = await registerCard(flowCustomerId, callbackUrl)

    return NextResponse.json({ redirectUrl })
  } catch (error) {
    console.error('[flow/subscribe] Error:', error)
    const msg = error instanceof Error ? error.message : 'Error interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
