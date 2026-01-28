import { login } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function LoginPage() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-slate-50 dark:bg-slate-900">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Iniciar Sesión</CardTitle>
          <CardDescription>
            Ingresa tu correo electrónico para acceder a tu cuenta.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <form action={login} className="grid gap-4">
            <div className="grid gap-2">
              <label htmlFor="email">Correo Electrónico</label>
              <Input id="email" name="email" type="email" placeholder="m@example.com" required />
            </div>
            <Button type="submit" className="w-full">
              Enviar enlace mágico
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
