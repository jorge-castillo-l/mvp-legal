'use client'

import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function SubmitButton() {
  const { pending } = useFormStatus()

  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? (
        <span className="flex items-center gap-2">
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Enviando...
        </span>
      ) : (
        'Enviar enlace de acceso'
      )}
    </Button>
  )
}

export function LoginForm({ action }: { action: (formData: FormData) => Promise<void> }) {
  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-2">
        <label htmlFor="email" className="text-sm font-medium text-slate-700">
          Correo electrónico
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="tu@correo.com"
          required
          autoFocus
          autoComplete="email"
        />
      </div>
      <SubmitButton />
    </form>
  )
}
