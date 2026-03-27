/**
 * Flow.cl API Client — Tarea 6.01
 *
 * Wrapper tipado para la API REST de Flow.cl (suscripciones).
 * Maneja firma HMAC-SHA256 de parámetros según spec de Flow.
 *
 * Docs: https://developers.flow.cl/docs/intro
 */

import { createHmac } from 'crypto'
import type { PlanType } from './database.types'

const FLOW_API_URL = process.env.FLOW_API_URL || 'https://sandbox.flow.cl/api'
const FLOW_BASE_URL = process.env.FLOW_BASE_URL || 'https://sandbox.flow.cl'
const FLOW_API_KEY = process.env.FLOW_API_KEY!
const FLOW_SECRET_KEY = process.env.FLOW_SECRET_KEY!

// ─────────────────────────────────────────────────────────
// Plan ↔ Flow planId mapping
// ─────────────────────────────────────────────────────────

const PLAN_TO_FLOW_ID: Record<string, string | undefined> = {
  basico: process.env.FLOW_PLAN_BASICO,
  pro: process.env.FLOW_PLAN_PRO,
  ultra: process.env.FLOW_PLAN_ULTRA,
}

const FLOW_ID_TO_PLAN: Record<string, PlanType> = {}
for (const [plan, flowId] of Object.entries(PLAN_TO_FLOW_ID)) {
  if (flowId) FLOW_ID_TO_PLAN[flowId] = plan as PlanType
}

export function flowPlanIdToType(flowPlanId: string): PlanType | null {
  return FLOW_ID_TO_PLAN[flowPlanId] ?? null
}

export function planTypeToFlowId(plan: PlanType): string | null {
  return PLAN_TO_FLOW_ID[plan] ?? null
}

// ─────────────────────────────────────────────────────────
// HMAC signature (required by all Flow API calls)
// ─────────────────────────────────────────────────────────

function signParams(params: Record<string, string | number>): string {
  const keys = Object.keys(params).sort()
  const toSign = keys.map((k) => `${k}${params[k]}`).join('')
  return createHmac('sha256', FLOW_SECRET_KEY).update(toSign).digest('hex')
}

function buildSignedBody(params: Record<string, string | number>): URLSearchParams {
  const withKey = { ...params, apiKey: FLOW_API_KEY }
  const signature = signParams(withKey)
  const body = new URLSearchParams()
  for (const [k, v] of Object.entries(withKey)) {
    body.append(k, String(v))
  }
  body.append('s', signature)
  return body
}

function buildSignedQuery(params: Record<string, string | number>): string {
  const withKey = { ...params, apiKey: FLOW_API_KEY }
  const signature = signParams(withKey)
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(withKey)) {
    qs.append(k, String(v))
  }
  qs.append('s', signature)
  return qs.toString()
}

// ─────────────────────────────────────────────────────────
// Generic API caller
// ─────────────────────────────────────────────────────────

async function flowPost<T = Record<string, unknown>>(
  endpoint: string,
  params: Record<string, string | number>,
): Promise<T> {
  const body = buildSignedBody(params)
  const res = await fetch(`${FLOW_API_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const data = await res.json()
  if (!res.ok) {
    console.error(`[flow] POST ${endpoint} failed:`, data)
    throw new FlowApiError(endpoint, res.status, data)
  }
  return data as T
}

async function flowGet<T = Record<string, unknown>>(
  endpoint: string,
  params: Record<string, string | number>,
): Promise<T> {
  const qs = buildSignedQuery(params)
  const res = await fetch(`${FLOW_API_URL}${endpoint}?${qs}`, { method: 'GET' })
  const data = await res.json()
  if (!res.ok) {
    console.error(`[flow] GET ${endpoint} failed:`, data)
    throw new FlowApiError(endpoint, res.status, data)
  }
  return data as T
}

export class FlowApiError extends Error {
  constructor(
    public endpoint: string,
    public status: number,
    public body: unknown,
  ) {
    super(`Flow API error on ${endpoint}: ${status}`)
    this.name = 'FlowApiError'
  }
}

// ─────────────────────────────────────────────────────────
// Customer
// ─────────────────────────────────────────────────────────

export interface FlowCustomer {
  customerId: string
  created: string
  email: string
  name: string
  status: number
  last4CardDigits?: string
  creditCardType?: string
}

export async function createCustomer(
  email: string,
  name: string,
  externalId: string,
): Promise<FlowCustomer> {
  return flowPost<FlowCustomer>('/customer/create', {
    email,
    name,
    externalId,
  })
}

export async function getCustomer(customerId: string): Promise<FlowCustomer> {
  return flowGet<FlowCustomer>('/customer/get', { customerId })
}

// ─────────────────────────────────────────────────────────
// Card registration (redirect flow)
// ─────────────────────────────────────────────────────────

interface RegisterCardResponse {
  url: string
  token: string
}

interface RegisterStatusResponse {
  status: number
  customerId: string
  creditCardType?: string
  last4CardDigits?: string
}

/**
 * Inicia registro de tarjeta. Retorna URL a la que redirigir al usuario.
 * Flow redirige de vuelta a url_return tras completar.
 */
export async function registerCard(
  customerId: string,
  urlReturn: string,
): Promise<{ redirectUrl: string; token: string }> {
  const data = await flowPost<RegisterCardResponse>('/customer/register', {
    customerId,
    url_return: urlReturn,
  })
  return {
    redirectUrl: `${data.url}?token=${data.token}`,
    token: data.token,
  }
}

export async function getRegisterStatus(token: string): Promise<RegisterStatusResponse> {
  return flowGet<RegisterStatusResponse>('/customer/getRegisterStatus', { token })
}

// ─────────────────────────────────────────────────────────
// Subscription
// ─────────────────────────────────────────────────────────

export interface FlowSubscription {
  subscriptionId: string
  planId: string
  plan_name: string
  customerId: string
  created: string
  next_invoice_date: string
  status: number // 1=active, 2=past_due, 3=unpaid, 4=cancelled
  molestiaPeriod?: number
}

export async function createSubscription(
  customerId: string,
  planId: string,
): Promise<FlowSubscription> {
  return flowPost<FlowSubscription>('/subscription/create', {
    customerId,
    planId,
  })
}

export async function getSubscription(subscriptionId: string): Promise<FlowSubscription> {
  return flowGet<FlowSubscription>('/subscription/get', { subscriptionId })
}

export async function cancelSubscription(subscriptionId: string, atPeriodEnd = true): Promise<FlowSubscription> {
  return flowPost<FlowSubscription>('/subscription/cancel', {
    subscriptionId,
    at_period_end: atPeriodEnd ? 1 : 0,
  })
}

/**
 * Cambiar plan: cancela suscripción actual y crea nueva con otro plan.
 * Flow no tiene "update plan" nativo, así que es cancel + create.
 */
export async function changePlan(
  subscriptionId: string,
  customerId: string,
  newPlanId: string,
): Promise<FlowSubscription> {
  await cancelSubscription(subscriptionId, false)
  return createSubscription(customerId, newPlanId)
}

// ─────────────────────────────────────────────────────────
// Invoice
// ─────────────────────────────────────────────────────────

export interface FlowInvoice {
  id: number
  subscriptionId: string
  customerId: string
  amount: number
  currency: string
  status: number
  created: string
  attemptCount: number
}

export async function getInvoice(invoiceId: number): Promise<FlowInvoice> {
  return flowGet<FlowInvoice>('/invoice/get', { invoiceId })
}

// ─────────────────────────────────────────────────────────
// Webhook signature verification
// ─────────────────────────────────────────────────────────

/**
 * Verifica que el token recibido en webhook sea válido consultando a Flow.
 * Flow no envía firma en webhooks — envía un token que debe consultarse.
 */
export async function getPaymentStatus(token: string): Promise<{
  flowOrder: number
  status: number // 1=pending, 2=paid, 3=rejected, 4=cancelled
  amount: number
  currency: string
  payer: string
  pending_info?: { media: string; date: string }
}> {
  return flowGet('/payment/getStatus', { token })
}

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

export { FLOW_BASE_URL }
