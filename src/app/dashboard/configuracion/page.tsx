import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Settings } from "lucide-react"

export default function ConfiguracionPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Configuración</h1>
        <p className="text-muted-foreground mt-2">
          Personaliza tu perfil y gestiona las preferencias de seguridad.
        </p>
      </div>

      <Card className="border-slate-200">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100">
              <Settings className="h-6 w-6 text-slate-700" />
            </div>
            <div>
              <CardTitle>Ajustes de Cuenta</CardTitle>
              <CardDescription>
                Funcionalidad en desarrollo
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
            <p className="text-sm text-slate-600">
              Esta sección estará disponible próximamente. Aquí podrás personalizar tu perfil, cambiar tu contraseña y gestionar las configuraciones de seguridad de tu cuenta.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
