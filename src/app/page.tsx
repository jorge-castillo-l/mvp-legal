import Link from 'next/link'
import Image from 'next/image'
import { CheckCircle2 } from 'lucide-react'

const PLANS = [
  {
    name: 'Prueba',
    price: 'Gratis',
    period: '7 días',
    description: 'Conoce Caussa sin compromiso',
    features: [
      '1 causa',
      '20 consultas rápidas',
      '5 análisis completos',
      '2 análisis expertos',
      'Retención 7 días',
    ],
    cta: 'Comenzar gratis',
    href: '/login',
    highlighted: false,
  },
  {
    name: 'Básico',
    price: '$19.990',
    period: '/mes',
    description: 'Para el abogado independiente',
    features: [
      '10 causas',
      '200 consultas rápidas/mes',
      '15 análisis completos/mes',
      '5 análisis expertos/mes',
      'Retención permanente',
    ],
    cta: 'Suscribirse',
    href: '/login',
    highlighted: false,
  },
  {
    name: 'Pro',
    price: '$69.990',
    period: '/mes',
    description: 'Para estudios con cartera activa',
    features: [
      '30 causas',
      '500 consultas rápidas/mes',
      '50 análisis completos/mes',
      '12 análisis expertos/mes',
      'Retención permanente',
    ],
    cta: 'Suscribirse',
    href: '/login',
    highlighted: true,
  },
  {
    name: 'Ultra',
    price: '$149.990',
    period: '/mes',
    description: 'Para estudios de alto volumen',
    features: [
      '100 causas',
      '800 consultas rápidas/mes',
      '100 análisis completos/mes',
      '25 análisis expertos/mes',
      'Retención permanente',
    ],
    cta: 'Suscribirse',
    href: '/login',
    highlighted: false,
  },
]

const STEPS = [
  {
    number: '01',
    title: 'Sincroniza',
    description: 'Navega a tu causa en PJUD y presiona sincronizar. Caussa descarga todos los documentos del expediente automáticamente.',
  },
  {
    number: '02',
    title: 'Procesa',
    description: 'El sistema extrae texto, estructura y clasifica cada documento. OCR automático para PDFs escaneados.',
  },
  {
    number: '03',
    title: 'Pregunta',
    description: 'Consulta sobre tu causa en lenguaje natural. Cada respuesta incluye citas verificables al expediente.',
  },
]

const ANALYSIS_TIERS = [
  {
    icon: '⚡',
    name: 'Rápido',
    description: 'Consultas ágiles sobre el estado de la causa, plazos, notificaciones y documentos.',
    examples: '¿Se notificó al demandado? ¿Cuántos días quedan para contestar?',
  },
  {
    icon: '◆',
    name: 'Avanzado',
    description: 'Análisis detallado con citas verificables al expediente y búsqueda de jurisprudencia.',
    examples: '¿Qué excepciones se opusieron y cuál es su fundamento?',
  },
  {
    icon: '◈',
    name: 'Experto',
    description: 'Razonamiento profundo con análisis procesal completo, riesgos y probabilidad de éxito.',
    examples: '¿Procede recurso de apelación? Análisis de viabilidad con jurisprudencia.',
  },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* ─── Navbar ─── */}
      <nav className="sticky top-0 z-50 border-b border-slate-100 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-3">
            <Image src="/caussa-logo.png" alt="Caussa" width={360} height={96} priority className="h-14 w-auto" />
          </Link>
          <div className="flex items-center gap-4">
            <Link href="#pricing" className="hidden text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors sm:block">
              Planes
            </Link>
            <Link
              href="/login"
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
            >
              Iniciar sesión
            </Link>
          </div>
        </div>
      </nav>

      {/* ─── Hero ─── */}
      <section className="relative overflow-hidden bg-slate-950 text-white">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(37,99,235,0.15),transparent_60%)]" />
        <div className="relative mx-auto max-w-4xl px-6 py-24 text-center sm:py-32">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
            Tu expediente judicial,<br className="hidden sm:block" /> respondido por IA
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-300 leading-relaxed">
            Sincroniza tus causas civiles desde PJUD y obtén respuestas inmediatas con citas verificables al expediente. Plazos, notificaciones, estado procesal — todo en segundos.
          </p>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/login"
              className="rounded-lg bg-blue-600 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-blue-600/25 transition-all hover:bg-blue-500 hover:shadow-blue-500/30"
            >
              Comenzar gratis
            </Link>
            <a
              href="#extension"
              className="rounded-lg border border-slate-700 px-8 py-3.5 text-base font-semibold text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
            >
              Descargar extensión
            </a>
          </div>
          <p className="mt-6 text-sm text-slate-500">
            Extensión de Chrome gratuita · Sin tarjeta de crédito
          </p>
        </div>
      </section>

      {/* ─── Cómo funciona ─── */}
      <section className="border-b border-slate-100 bg-slate-50 py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Cómo funciona</h2>
            <p className="mt-3 text-slate-600">Tres pasos. Sin configuración compleja.</p>
          </div>
          <div className="mt-14 grid gap-8 sm:grid-cols-3">
            {STEPS.map((step) => (
              <div key={step.number} className="relative rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
                <span className="text-4xl font-bold text-slate-200">{step.number}</span>
                <h3 className="mt-3 text-xl font-bold">{step.title}</h3>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── 3 Niveles de análisis ─── */}
      <section className="py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Tres niveles de análisis</h2>
            <p className="mt-3 text-slate-600">Desde consultas rápidas hasta análisis procesal profundo.</p>
          </div>
          <div className="mt-14 grid gap-6 sm:grid-cols-3">
            {ANALYSIS_TIERS.map((tier) => (
              <div key={tier.name} className="rounded-xl border border-slate-200 p-8 transition-shadow hover:shadow-md">
                <span className="text-2xl" style={{ filter: 'grayscale(1)' }}>{tier.icon}</span>
                <h3 className="mt-4 text-lg font-bold">{tier.name}</h3>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">{tier.description}</p>
                <p className="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-xs text-slate-500 italic leading-relaxed">
                  &ldquo;{tier.examples}&rdquo;
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Competencia civil ─── */}
      <section className="border-y border-slate-100 bg-slate-950 py-16">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">
            Funciona con todas las causas civiles de PJUD
          </h2>
          <p className="mt-4 text-slate-400 leading-relaxed">
            Ordinarios, ejecutivos, sumarios, monitorios y voluntarios. Cobranzas, arrendamiento, desahucios — todo lo que pasa por la competencia civil.
          </p>
        </div>
      </section>

      {/* ─── Pricing ─── */}
      <section id="pricing" className="scroll-mt-16 py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Planes</h2>
            <p className="mt-3 text-slate-600">Menos de lo que cobra un procurador por una gestión.</p>
          </div>
          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`relative flex flex-col rounded-xl border p-8 transition-shadow hover:shadow-md ${
                  plan.highlighted
                    ? 'border-blue-600 ring-1 ring-blue-600 shadow-lg'
                    : 'border-slate-200'
                }`}
              >
                {plan.highlighted && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-3 py-0.5 text-xs font-semibold text-white">
                    Popular
                  </span>
                )}
                <div>
                  <h3 className="text-lg font-bold">{plan.name}</h3>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="text-3xl font-bold tracking-tight">{plan.price}</span>
                    <span className="text-sm text-slate-500">{plan.period}</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">{plan.description}</p>
                </div>
                <ul className="mt-6 flex-1 space-y-3">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm text-slate-700">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Link
                  href={plan.href}
                  className={`mt-8 block rounded-lg px-4 py-3 text-center text-sm font-semibold transition-colors ${
                    plan.highlighted
                      ? 'bg-blue-600 text-white hover:bg-blue-500'
                      : 'bg-slate-900 text-white hover:bg-slate-800'
                  }`}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA final ─── */}
      <section className="bg-slate-950 py-20">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            Deja de buscar a fojas.<br />Pregúntale a tu expediente.
          </h2>
          <p className="mt-4 text-slate-400">
            Crea tu cuenta en 30 segundos y sincroniza tu primera causa.
          </p>
          <Link
            href="/login"
            className="mt-8 inline-block rounded-lg bg-blue-600 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-blue-600/25 transition-all hover:bg-blue-500"
          >
            Comenzar gratis
          </Link>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="border-t border-slate-200 bg-white py-12">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-6 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-3">
            <Image src="/caussa-logo.png" alt="Caussa" width={280} height={72} className="h-10 w-auto" />
          </div>
          <div className="flex gap-6 text-sm text-slate-500">
            <Link href="/terminos" className="hover:text-slate-900 transition-colors">Términos</Link>
            <Link href="/privacidad" className="hover:text-slate-900 transition-colors">Privacidad</Link>
            <a href="mailto:contacto@caussa.cl" className="hover:text-slate-900 transition-colors">Contacto</a>
          </div>
          <p className="text-xs text-slate-400">
            &copy; {new Date().getFullYear()} Caussa. Todos los derechos reservados.
          </p>
        </div>
      </footer>
    </div>
  )
}
