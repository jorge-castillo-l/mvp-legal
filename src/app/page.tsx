import { Button } from "@/components/ui/button"

export default function Home() {
  return (
    <div className="flex h-screen items-center justify-center bg-slate-50">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4 text-slate-900">
          Hola MVP Legal
        </h1>
        <p className="text-slate-600 mb-6">
          Si ves el botón negro abajo, Shadcn está funcionando.
        </p>
        
        {/* Aquí está el componente que acabamos de instalar */}
        <Button>
          Click aquí
        </Button>
      </div>
    </div>
  )
}