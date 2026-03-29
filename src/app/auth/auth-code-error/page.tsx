import Link from 'next/link'
import Image from 'next/image'

export default function AuthCodeErrorPage() {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex justify-center">
          <Image src="/caussa-logo.png" alt="Caussa" width={200} height={56} className="h-12 w-auto" />
        </Link>

        <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50">
            <svg className="h-7 w-7 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-slate-900">Enlace expirado</h2>
          <p className="mt-2 text-sm text-slate-600 leading-relaxed">
            El enlace de acceso ya no es válido. Esto puede ocurrir si:
          </p>
          <ul className="mt-3 text-sm text-slate-500 text-left space-y-1 pl-4">
            <li className="flex gap-2"><span>•</span>Pasaron más de 10 minutos desde que lo solicitaste</li>
            <li className="flex gap-2"><span>•</span>Ya usaste este enlace anteriormente</li>
            <li className="flex gap-2"><span>•</span>Abriste el enlace en un navegador diferente</li>
          </ul>
          <Link
            href="/login"
            className="mt-6 inline-block rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 transition-colors"
          >
            Solicitar nuevo enlace
          </Link>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          <Link href="/" className="hover:text-slate-600 transition-colors">
            Volver a caussa.cl
          </Link>
        </p>
      </div>
    </div>
  )
}
