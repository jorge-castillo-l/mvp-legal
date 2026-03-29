import { login } from './actions'
import { LoginForm } from './login-form'
import Image from 'next/image'
import Link from 'next/link'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; error?: string }>
}) {
  const { message, error } = await searchParams

  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex justify-center">
          <Image src="/caussa-logo.png" alt="Caussa" width={200} height={56} className="h-12 w-auto" />
        </Link>

        {message === 'check-email' ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
              <svg className="h-7 w-7 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-slate-900">Revisa tu correo</h2>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              Te enviamos un enlace de acceso. Haz clic en el enlace del correo para iniciar sesión.
            </p>
            <p className="mt-4 text-xs text-slate-400">
              Si no lo ves, revisa tu carpeta de spam.
            </p>
            <Link
              href="/login"
              className="mt-6 inline-block text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
            >
              Volver a intentar
            </Link>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
            <div className="mb-6 text-center">
              <h1 className="text-xl font-bold text-slate-900">Iniciar sesión</h1>
              <p className="mt-1 text-sm text-slate-500">
                Ingresa tu correo y te enviaremos un enlace de acceso.
              </p>
            </div>

            {error && (
              <div className="mb-4 rounded-lg bg-red-50 border border-red-100 p-3 text-center">
                <p className="text-sm text-red-700">
                  No pudimos enviar el enlace. Verifica tu correo e intenta de nuevo.
                </p>
              </div>
            )}

            <LoginForm action={login} />

            <p className="mt-6 text-center text-xs text-slate-400">
              Sin contraseñas. Te enviaremos un enlace seguro a tu correo.
            </p>
          </div>
        )}

        <p className="mt-6 text-center text-xs text-slate-400">
          <Link href="/" className="hover:text-slate-600 transition-colors">
            Volver a caussa.cl
          </Link>
        </p>
      </div>
    </div>
  )
}
