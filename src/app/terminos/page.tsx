import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'

export const metadata: Metadata = {
  title: 'Términos de Servicio — Caussa',
  description: 'Términos de Servicio de Caussa, plataforma de análisis de expedientes judiciales con inteligencia artificial.',
}

export default function TerminosPage() {
  return (
    <div className="min-h-screen bg-white">
      <nav className="sticky top-0 z-50 border-b border-slate-100 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Link href="/">
            <Image src="/caussa-logo.png" alt="Caussa" width={720} height={192} className="h-40 w-auto" />
          </Link>
          <Link href="/login" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 transition-colors">
            Iniciar sesión
          </Link>
        </div>
      </nav>

      <article className="mx-auto max-w-3xl px-6 py-16 text-slate-700 leading-relaxed [&_h2]:mt-10 [&_h2]:mb-4 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-slate-900 [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-slate-800 [&_p]:mb-4 [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-6 [&_li]:mb-1">
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Términos de Servicio</h1>
        <p className="mt-2 text-sm text-slate-500">Última actualización: 27 de marzo de 2026 · Versión v1</p>

        <h2>1. Aceptación</h2>
        <p>
          Al acceder y utilizar Caussa (en adelante, el &quot;Servicio&quot;), operado por Caussa SpA (en adelante, &quot;Caussa&quot;, &quot;nosotros&quot;), con domicilio en Santiago, Chile, usted acepta estos Términos de Servicio. Si no está de acuerdo, no utilice el Servicio.
        </p>
        <p>
          Caussa se reserva el derecho de modificar estos términos. Las actualizaciones se publicarán en esta página con la fecha de vigencia actualizada. El uso continuado del Servicio tras una modificación constituye aceptación de los nuevos términos.
        </p>

        <h2>2. Descripción del Servicio</h2>
        <p>
          Caussa es una plataforma que permite a abogados y profesionales del derecho sincronizar expedientes judiciales civiles desde el Poder Judicial de Chile (PJUD) y consultarlos mediante inteligencia artificial. El Servicio se compone de:
        </p>
        <ul>
          <li><strong>Extensión de Chrome:</strong> permite sincronizar documentos desde PJUD al sistema.</li>
          <li><strong>Panel web (Dashboard):</strong> gestión de causas, suscripción y configuración.</li>
          <li><strong>Asistente de IA:</strong> responde consultas sobre el expediente sincronizado en tres niveles de análisis (rápido, avanzado y experto).</li>
        </ul>

        <h2>3. Requisitos del usuario</h2>
        <p>
          El Servicio está diseñado para uso profesional por abogados habilitados para ejercer en Chile. Al usar Caussa, usted declara que:
        </p>
        <ul>
          <li>Es mayor de 18 años.</li>
          <li>Actúa en calidad profesional respecto de las causas que sincroniza.</li>
          <li>Cuenta con las facultades o autorizaciones necesarias para acceder a la información de las causas procesadas.</li>
          <li>No sincronizará causas reservadas, secretas o con restricción de acceso público.</li>
        </ul>

        <h2>4. Uso de inteligencia artificial</h2>
        <p>
          El Servicio utiliza modelos de inteligencia artificial de terceros para el análisis de documentos judiciales. El usuario reconoce y acepta que:
        </p>
        <ul>
          <li>Las respuestas generadas por la IA son de carácter <strong>asistencial e informativo</strong>. No constituyen asesoría legal, opinión jurídica vinculante, ni reemplazan el criterio profesional del abogado.</li>
          <li>La IA puede cometer errores, incluyendo citas incorrectas, interpretaciones inexactas o información desactualizada.</li>
          <li>El usuario es el único responsable de verificar la exactitud de las respuestas antes de utilizarlas en actuaciones judiciales o asesorías a clientes.</li>
          <li>Las citas al expediente incluidas en las respuestas deben verificarse contra el documento original disponible en el Servicio o en PJUD.</li>
        </ul>

        <h2>5. Planes y facturación</h2>
        <p>
          Caussa ofrece un plan gratuito de prueba y planes de pago mensuales. Los precios vigentes se publican en <Link href="/#pricing" className="text-blue-600 hover:underline">caussa.cl</Link>.
        </p>
        <ul>
          <li><strong>Plan gratuito:</strong> uso limitado con retención de datos por 7 días. Al vencer el período de retención, los documentos y datos asociados se eliminan permanentemente.</li>
          <li><strong>Planes de pago:</strong> retención permanente de datos mientras la suscripción esté activa. En caso de cancelación, los datos se conservan por 30 días adicionales antes de su eliminación.</li>
        </ul>
        <p>
          Los pagos se procesan a través de Flow.cl en pesos chilenos (CLP). Caussa no almacena datos de tarjetas de crédito.
        </p>

        <h2>6. Propiedad intelectual</h2>
        <p>
          El Servicio, su diseño, código fuente, algoritmos y marca son propiedad de Caussa SpA. Los documentos judiciales sincronizados son información pública del Poder Judicial y no son propiedad de Caussa.
        </p>
        <p>
          El usuario conserva todos los derechos sobre sus datos, consultas e información profesional.
        </p>

        <h2>7. Limitación de responsabilidad</h2>
        <p>
          En la máxima medida permitida por la ley chilena:
        </p>
        <ul>
          <li>Caussa <strong>no garantiza</strong> la exactitud, completitud ni actualización de las respuestas generadas por IA.</li>
          <li>Caussa <strong>no es responsable</strong> de decisiones profesionales, judiciales o de cualquier índole tomadas en base a las respuestas del Servicio.</li>
          <li>Caussa <strong>no es responsable</strong> de la disponibilidad, exactitud ni integridad de los datos obtenidos desde PJUD.</li>
          <li>La responsabilidad total de Caussa frente al usuario está limitada al monto pagado por el usuario durante los últimos 3 meses de suscripción.</li>
        </ul>

        <h2>8. Uso prohibido</h2>
        <ul>
          <li>Sincronizar causas reservadas, secretas o con acceso restringido.</li>
          <li>Compartir credenciales de acceso con terceros.</li>
          <li>Utilizar el Servicio para fines ilícitos o contrarios a la ética profesional.</li>
          <li>Intentar eludir los límites de uso del plan contratado mediante la creación de múltiples cuentas.</li>
          <li>Realizar ingeniería inversa, scraping masivo o cualquier acción que comprometa la estabilidad del Servicio.</li>
        </ul>

        <h2>9. Terminación</h2>
        <p>
          Caussa puede suspender o cancelar su cuenta si detecta un uso que viole estos términos. El usuario puede cancelar su cuenta en cualquier momento desde el Dashboard.
        </p>

        <h2>10. Legislación aplicable y jurisdicción</h2>
        <p>
          Estos términos se rigen por las leyes de la República de Chile. Cualquier controversia será sometida a la jurisdicción de los tribunales ordinarios de Santiago, Chile.
        </p>

        <h2>11. Contacto</h2>
        <p>
          Para consultas sobre estos términos: <a href="mailto:contacto@caussa.cl" className="text-blue-600 hover:underline">contacto@caussa.cl</a>
        </p>
      </article>

      <footer className="border-t border-slate-200 py-8">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 text-sm text-slate-400">
          <Link href="/" className="hover:text-slate-600 transition-colors">&larr; Volver a Caussa</Link>
          <Link href="/privacidad" className="hover:text-slate-600 transition-colors">Política de Privacidad</Link>
        </div>
      </footer>
    </div>
  )
}
