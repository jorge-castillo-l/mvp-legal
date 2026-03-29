import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'

export const metadata: Metadata = {
  title: 'Política de Privacidad — Caussa',
  description: 'Política de Privacidad de Caussa. Cómo recopilamos, usamos y protegemos tus datos.',
}

export default function PrivacidadPage() {
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
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Política de Privacidad</h1>
        <p className="mt-2 text-sm text-slate-500">Última actualización: 27 de marzo de 2026 · Versión v1</p>

        <h2>1. Responsable del tratamiento</h2>
        <p>
          El responsable del tratamiento de datos personales es Caussa SpA, con domicilio en Santiago, Chile. Contacto: <a href="mailto:contacto@caussa.cl" className="text-blue-600 hover:underline">contacto@caussa.cl</a>.
        </p>

        <h2>2. Datos que recopilamos</h2>

        <h3>2.1 Datos de registro</h3>
        <p>
          Al crear una cuenta recopilamos su dirección de correo electrónico. La autenticación se realiza mediante enlace de verificación (magic link) sin contraseña.
        </p>

        <h3>2.2 Documentos judiciales</h3>
        <p>
          Cuando usted sincroniza una causa desde PJUD, el Servicio descarga y almacena los documentos del expediente judicial (PDFs, resoluciones, escritos, actuaciones). Estos documentos son información de acceso público disponible en el sistema del Poder Judicial.
        </p>
        <p>
          El Servicio procesa estos documentos para: extraer texto (OCR para documentos escaneados), generar fragmentos indexables y crear representaciones vectoriales (embeddings) que permiten la búsqueda por contenido.
        </p>

        <h3>2.3 Consultas y conversaciones</h3>
        <p>
          Las preguntas que realiza al asistente de IA y las respuestas generadas se almacenan asociadas a su cuenta y a la causa consultada, para permitir el historial de conversaciones.
        </p>

        <h3>2.4 Datos de uso</h3>
        <p>
          Registramos contadores de uso (cantidad de consultas por nivel, causas sincronizadas) para la gestión de límites del plan contratado.
        </p>

        <h2>3. Cómo usamos los datos</h2>
        <ul>
          <li><strong>Prestación del Servicio:</strong> almacenar y procesar expedientes, generar respuestas con IA, mantener historial de conversaciones.</li>
          <li><strong>Gestión de cuenta:</strong> autenticación, gestión de suscripción, aplicación de límites por plan.</li>
          <li><strong>Mejora del Servicio:</strong> análisis agregado y anónimo de patrones de uso para mejorar la calidad de las respuestas.</li>
        </ul>
        <p>
          <strong>No vendemos, compartimos ni cedemos datos personales ni documentos judiciales a terceros</strong> para fines de marketing o publicidad.
        </p>

        <h2>4. Proveedores de inteligencia artificial</h2>
        <p>
          Para generar respuestas, el Servicio envía fragmentos de los documentos del expediente a proveedores de IA externos:
        </p>
        <ul>
          <li><strong>Google (Gemini API):</strong> utilizado para consultas rápidas y generación de embeddings. En el tier de pago de la API, Google no utiliza los datos enviados para entrenar o mejorar sus modelos. Los datos se retienen hasta 55 días exclusivamente para detección de abuso.</li>
          <li><strong>Anthropic (Claude API):</strong> utilizado para análisis avanzado y experto. Anthropic no utiliza datos enviados vía API comercial para entrenar modelos. Los datos se retienen por 30 días para detección de abuso y luego se eliminan.</li>
        </ul>
        <p>
          En ningún caso se envía el expediente completo al proveedor de IA. Solo se envían los fragmentos relevantes a la consulta específica del usuario.
        </p>

        <h2>5. Almacenamiento y seguridad</h2>
        <p>
          Los datos se almacenan en Supabase (infraestructura en la nube). Los documentos PDF se almacenan en almacenamiento cifrado. El acceso a los datos se controla mediante políticas de seguridad a nivel de fila (Row Level Security) que garantizan que cada usuario solo accede a sus propias causas.
        </p>
        <p>
          Las comunicaciones entre el navegador, la extensión y nuestros servidores se realizan exclusivamente mediante HTTPS.
        </p>

        <h2>6. Retención de datos</h2>
        <ul>
          <li><strong>Plan gratuito:</strong> documentos, textos extraídos, embeddings, conversaciones y datos derivados se eliminan automáticamente <strong>7 días</strong> después de la última actividad. Se preserva el perfil del usuario y la metadata básica de las causas.</li>
          <li><strong>Planes de pago:</strong> retención permanente mientras la suscripción esté activa. Tras cancelar la suscripción, los datos se conservan por 30 días antes de su eliminación.</li>
          <li><strong>Eliminación voluntaria:</strong> el usuario puede eliminar causas individuales desde la interfaz del Servicio. La eliminación es inmediata e irreversible e incluye todos los documentos, textos, embeddings y conversaciones asociados.</li>
        </ul>

        <h2>7. Derechos del usuario (Ley 19.628)</h2>
        <p>
          En conformidad con la Ley 19.628 sobre Protección de la Vida Privada, usted tiene derecho a:
        </p>
        <ul>
          <li><strong>Acceso:</strong> solicitar información sobre los datos personales que mantenemos sobre usted.</li>
          <li><strong>Rectificación:</strong> solicitar la corrección de datos personales inexactos.</li>
          <li><strong>Eliminación:</strong> solicitar la eliminación de sus datos personales y toda la información asociada a su cuenta.</li>
          <li><strong>Oposición:</strong> oponerse al tratamiento de sus datos para fines distintos a la prestación del Servicio.</li>
        </ul>
        <p>
          Para ejercer estos derechos, contacte a <a href="mailto:contacto@caussa.cl" className="text-blue-600 hover:underline">contacto@caussa.cl</a>. Responderemos dentro de los 15 días hábiles siguientes.
        </p>

        <h2>8. Extensión de Chrome</h2>
        <p>
          La extensión de Chrome de Caussa:
        </p>
        <ul>
          <li>Solo se activa en páginas del Poder Judicial (pjud.cl).</li>
          <li>Lee el contenido del DOM de la página PJUD para extraer información de causas (ROL, tribunal, carátula, identificadores de documentos).</li>
          <li>No accede a datos de otras páginas web ni al historial de navegación.</li>
          <li>Almacena localmente (chrome.storage) solo: sesión de autenticación, registros de causas sincronizadas y preferencias.</li>
          <li>Se comunica exclusivamente con los servidores de Caussa (caussa.cl) y Supabase para sincronización y autenticación.</li>
        </ul>

        <h2>9. Cookies y tecnologías similares</h2>
        <p>
          El Servicio utiliza cookies de sesión para la autenticación del usuario. No utilizamos cookies de seguimiento, analytics de terceros ni tecnologías de tracking publicitario.
        </p>

        <h2>10. Menores de edad</h2>
        <p>
          El Servicio está diseñado para profesionales del derecho mayores de 18 años. No recopilamos intencionalmente datos de menores de edad.
        </p>

        <h2>11. Cambios a esta política</h2>
        <p>
          Publicaremos los cambios en esta página con la fecha actualizada. Si los cambios son significativos, podremos solicitar una nueva aceptación del consentimiento de privacidad dentro del Servicio.
        </p>

        <h2>12. Contacto</h2>
        <p>
          Para consultas sobre privacidad y protección de datos: <a href="mailto:contacto@caussa.cl" className="text-blue-600 hover:underline">contacto@caussa.cl</a>
        </p>
      </article>

      <footer className="border-t border-slate-200 py-8">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 text-sm text-slate-400">
          <Link href="/" className="hover:text-slate-600 transition-colors">&larr; Volver a Caussa</Link>
          <Link href="/terminos" className="hover:text-slate-600 transition-colors">Términos de Servicio</Link>
        </div>
      </footer>
    </div>
  )
}
