import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { CreditCard } from "lucide-react"

export default function SuscripcionPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Suscripción</h1>
        <p className="text-muted-foreground mt-2">
          Gestiona tu plan y revisa tu información de facturación.
        </p>
      </div>

      <Card className="border-slate-200">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100">
              <CreditCard className="h-6 w-6 text-slate-700" />
            </div>
            <div>
              <CardTitle>Plan y Facturación</CardTitle>
              <CardDescription>
                Funcionalidad en desarrollo
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
            <p className="text-sm text-slate-600">
              Esta sección estará disponible próximamente. Aquí podrás gestionar tu plan de suscripción, métodos de pago y ver tu historial de facturación.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
