"use client"

import { useEffect, useState, useCallback } from "react"
import { createBrowserClient } from "@supabase/ssr"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  CreditCard,
  Zap,
  Brain,
  Search,
  FolderOpen,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Crown,
} from "lucide-react"
import { PLAN_LIMITS } from "@/lib/database.types"
import type { PlanType } from "@/lib/database.types"

interface ProfileData {
  plan_type: string
  case_count: number
  fast_chat_count: number
  monthly_fast_chat_count: number
  full_analysis_count: number
  monthly_full_analysis_count: number
  deep_thinking_count: number
  monthly_deep_thinking_count: number
  flow_subscription_id: string | null
  created_at: string
}

const PLAN_DISPLAY: Record<PlanType, { name: string; price: string; priceCLP: string; color: string; icon: typeof Crown }> = {
  free: { name: "Prueba Profesional", price: "Gratis", priceCLP: "$0", color: "bg-slate-100 text-slate-700", icon: Zap },
  basico: { name: "Básico", price: "$24 USD/mes", priceCLP: "$19.990/mes", color: "bg-blue-100 text-blue-700", icon: Zap },
  pro: { name: "Pro", price: "$80 USD/mes", priceCLP: "$69.990/mes", color: "bg-violet-100 text-violet-700", icon: Brain },
  ultra: { name: "Ultra", price: "$170 USD/mes", priceCLP: "$149.990/mes", color: "bg-amber-100 text-amber-700", icon: Crown },
}

const PAID_PLANS: { type: PlanType; highlights: string[] }[] = [
  {
    type: "basico",
    highlights: ["10 causas", "200 chats rápidos/mes", "15 análisis completos/mes", "5 pensamiento profundo/mes"],
  },
  {
    type: "pro",
    highlights: ["30 causas", "600 chats rápidos/mes", "60 análisis completos/mes", "15 pensamiento profundo/mes"],
  },
  {
    type: "ultra",
    highlights: ["100 causas", "1.000 chats rápidos/mes", "150 análisis completos/mes", "30 pensamiento profundo/mes"],
  },
]

export default function SuscripcionPage() {
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  const fetchProfile = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data } = await supabase
      .from("profiles")
      .select("plan_type, case_count, fast_chat_count, monthly_fast_chat_count, full_analysis_count, monthly_full_analysis_count, deep_thinking_count, monthly_deep_thinking_count, flow_subscription_id, created_at")
      .eq("id", user.id)
      .single()

    if (data) setProfile(data)
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    fetchProfile()

    const params = new URLSearchParams(window.location.search)
    if (params.get("success") === "subscribed") {
      const plan = params.get("plan") || ""
      setMessage({ type: "success", text: `¡Suscripción a ${PLAN_DISPLAY[plan as PlanType]?.name || plan} activada!` })
      fetchProfile()
      window.history.replaceState({}, "", "/dashboard/suscripcion")
    } else if (params.get("error")) {
      const errorMap: Record<string, string> = {
        card_failed: "Error al registrar la tarjeta. Intenta nuevamente.",
        subscription_failed: "Error al crear la suscripción. Intenta nuevamente.",
        invalid_plan: "Plan inválido.",
        params_missing: "Parámetros faltantes en la respuesta de Flow.",
      }
      setMessage({ type: "error", text: errorMap[params.get("error")!] || "Error desconocido." })
      window.history.replaceState({}, "", "/dashboard/suscripcion")
    }
  }, [fetchProfile])

  async function handleSubscribe(planType: PlanType) {
    setActionLoading(planType)
    setMessage(null)
    try {
      const res = await fetch("/api/flow/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planType }),
      })
      const data = await res.json()
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl
      } else {
        setMessage({ type: "error", text: data.error || "Error al iniciar suscripción" })
        setActionLoading(null)
      }
    } catch {
      setMessage({ type: "error", text: "Error de conexión" })
      setActionLoading(null)
    }
  }

  async function handleCancel() {
    if (!confirm("¿Seguro que deseas cancelar tu suscripción? Volverás al plan gratuito.")) return
    setActionLoading("cancel")
    setMessage(null)
    try {
      const res = await fetch("/api/flow/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      })
      const data = await res.json()
      if (data.success) {
        setMessage({ type: "success", text: "Suscripción cancelada. Ahora tienes el plan gratuito." })
        fetchProfile()
      } else {
        setMessage({ type: "error", text: data.error || "Error al cancelar" })
      }
    } catch {
      setMessage({ type: "error", text: "Error de conexión" })
    }
    setActionLoading(null)
  }

  async function handleChangePlan(newPlan: PlanType) {
    setActionLoading(newPlan)
    setMessage(null)
    try {
      const res = await fetch("/api/flow/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "change", newPlan }),
      })
      const data = await res.json()
      if (data.success) {
        setMessage({ type: "success", text: `Plan cambiado a ${PLAN_DISPLAY[newPlan]?.name}` })
        fetchProfile()
      } else {
        setMessage({ type: "error", text: data.error || "Error al cambiar plan" })
      }
    } catch {
      setMessage({ type: "error", text: "Error de conexión" })
    }
    setActionLoading(null)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    )
  }

  if (!profile) {
    return <div className="py-10 text-center text-slate-500">Error cargando perfil</div>
  }

  const plan = profile.plan_type as PlanType
  const display = PLAN_DISPLAY[plan] || PLAN_DISPLAY.free
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free
  const isPaid = plan !== "free"
  const isFree = plan === "free"

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Suscripción</h1>
        <p className="text-muted-foreground mt-2">
          Gestiona tu plan y revisa tu uso.
        </p>
      </div>

      {message && (
        <div className={`flex items-center gap-2 rounded-lg border p-4 ${message.type === "success" ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"}`}>
          {message.type === "success" ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
          <span className="text-sm font-medium">{message.text}</span>
        </div>
      )}

      {/* Plan actual */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`flex h-12 w-12 items-center justify-center rounded-lg ${display.color}`}>
                <display.icon className="h-6 w-6" />
              </div>
              <div>
                <CardTitle>Plan {display.name}</CardTitle>
                <CardDescription>{display.priceCLP}</CardDescription>
              </div>
            </div>
            {isPaid && (
              <Button
                variant="outline"
                size="sm"
                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                onClick={handleCancel}
                disabled={actionLoading !== null}
              >
                {actionLoading === "cancel" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Cancelar
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <UsageBar
              icon={<FolderOpen className="h-4 w-4" />}
              label="Causas"
              used={profile.case_count}
              limit={limits.cases}
              isLifetime
            />
            <UsageBar
              icon={<Zap className="h-4 w-4" />}
              label="Chat Rápido"
              used={isFree ? profile.fast_chat_count : profile.monthly_fast_chat_count}
              limit={limits.fast_chat}
              isLifetime={isFree}
            />
            <UsageBar
              icon={<Search className="h-4 w-4" />}
              label="Análisis Completo"
              used={isFree ? profile.full_analysis_count : profile.monthly_full_analysis_count}
              limit={limits.full_analysis}
              isLifetime={isFree}
            />
            <UsageBar
              icon={<Brain className="h-4 w-4" />}
              label="Pensamiento Profundo"
              used={isFree ? profile.deep_thinking_count : profile.monthly_deep_thinking_count}
              limit={limits.deep_thinking}
              isLifetime={isFree}
            />
          </div>
        </CardContent>
      </Card>

      {/* Planes disponibles */}
      <div>
        <h2 className="text-xl font-semibold mb-4">
          {isFree ? "Elige tu plan" : "Cambiar plan"}
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {PAID_PLANS.map(({ type, highlights }) => {
            const d = PLAN_DISPLAY[type]
            const isCurrent = type === plan
            return (
              <Card key={type} className={`relative ${isCurrent ? "ring-2 ring-violet-500" : ""}`}>
                {isCurrent && (
                  <div className="absolute -top-3 left-4 rounded-full bg-violet-600 px-3 py-0.5 text-xs font-medium text-white">
                    Plan actual
                  </div>
                )}
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-md ${d.color}`}>
                      <d.icon className="h-4 w-4" />
                    </div>
                    <CardTitle className="text-lg">{d.name}</CardTitle>
                  </div>
                  <p className="text-2xl font-bold mt-2">{d.priceCLP}</p>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm text-slate-600 mb-4">
                    {highlights.map((h) => (
                      <li key={h} className="flex items-center gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                        {h}
                      </li>
                    ))}
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                      Retención permanente
                    </li>
                  </ul>
                  {isCurrent ? (
                    <Button variant="outline" className="w-full" disabled>
                      Plan actual
                    </Button>
                  ) : isFree ? (
                    <Button
                      className="w-full"
                      onClick={() => handleSubscribe(type)}
                      disabled={actionLoading !== null}
                    >
                      {actionLoading === type ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CreditCard className="h-4 w-4 mr-2" />}
                      Suscribirse
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => handleChangePlan(type)}
                      disabled={actionLoading !== null}
                    >
                      {actionLoading === type ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Cambiar a {d.name}
                    </Button>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function UsageBar({
  icon,
  label,
  used,
  limit,
  isLifetime = false,
}: {
  icon: React.ReactNode
  label: string
  used: number
  limit: number
  isLifetime?: boolean
}) {
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0
  const isNearLimit = pct >= 80
  const isAtLimit = pct >= 100

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 font-medium text-slate-700">
          {icon} {label}
        </span>
        <span className={`text-xs ${isAtLimit ? "text-red-600 font-semibold" : isNearLimit ? "text-amber-600" : "text-slate-500"}`}>
          {used}/{limit} {isLifetime ? "(total)" : "/mes"}
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full transition-all ${isAtLimit ? "bg-red-500" : isNearLimit ? "bg-amber-400" : "bg-violet-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
