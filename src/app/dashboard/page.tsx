import { Download, Chrome, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      {/* Welcome Card */}
      <Card className="border-slate-200">
        <CardHeader>
          <CardTitle className="text-2xl">Bienvenido a tu Panel de Control</CardTitle>
          <CardDescription>
            Este es el centro administrativo de ZSE Legal. Descarga la extensión para comenzar a trabajar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <Chrome className="h-6 w-6 text-slate-700 mt-1" />
            <div className="flex-1">
              <h3 className="font-semibold text-slate-900">Extensión de Chrome</h3>
              <p className="text-sm text-slate-600 mt-1">
                La herramienta principal para realizar consultas legales directamente desde tu navegador.
              </p>
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button className="bg-slate-900 hover:bg-slate-800">
            <Download className="mr-2 h-4 w-4" />
            Descargar Extensión
          </Button>
        </CardFooter>
      </Card>

      {/* Quick Start Guide */}
      <Card className="border-slate-200">
        <CardHeader>
          <CardTitle>Guía Rápida de Inicio</CardTitle>
          <CardDescription>
            Sigue estos pasos para comenzar a usar ZSE Legal
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-4">
            <li className="flex items-start gap-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                1
              </div>
              <div className="flex-1 pt-0.5">
                <p className="font-medium text-slate-900">Descarga e instala la extensión</p>
                <p className="text-sm text-slate-600 mt-1">
                  Haz clic en el botón de arriba para descargar la extensión de Chrome.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                2
              </div>
              <div className="flex-1 pt-0.5">
                <p className="font-medium text-slate-900">Inicia sesión en la extensión</p>
                <p className="text-sm text-slate-600 mt-1">
                  Usa las mismas credenciales de este panel para acceder.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                3
              </div>
              <div className="flex-1 pt-0.5">
                <p className="font-medium text-slate-900">Comienza a realizar consultas</p>
                <p className="text-sm text-slate-600 mt-1">
                  Navega por sitios legales y activa la extensión para obtener asistencia inteligente.
                </p>
              </div>
            </li>
          </ol>
        </CardContent>
      </Card>

      {/* Features Overview */}
      <div className="grid gap-6 md:grid-cols-3">
        <Card className="border-slate-200">
          <CardHeader>
            <CheckCircle2 className="h-8 w-8 text-slate-700 mb-2" />
            <CardTitle className="text-lg">Historial</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-600">
              Revisa todas las consultas realizadas desde la extensión.
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader>
            <CheckCircle2 className="h-8 w-8 text-slate-700 mb-2" />
            <CardTitle className="text-lg">Suscripción</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-600">
              Gestiona tu plan y revisa tu facturación.
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader>
            <CheckCircle2 className="h-8 w-8 text-slate-700 mb-2" />
            <CardTitle className="text-lg">Configuración</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-600">
              Personaliza tu perfil y preferencias de seguridad.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
