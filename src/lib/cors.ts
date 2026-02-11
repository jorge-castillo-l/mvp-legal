/**
 * ============================================================
 * CORS - Configuración centralizada para API Routes
 * ============================================================
 * Resuelve el problema de 'chrome-extension://*' que NO es un
 * origin CORS válido. Los navegadores ignoran ese header.
 *
 * Estrategia:
 *   - Lee el header 'Origin' del request entrante.
 *   - Verifica si proviene de una extensión de Chrome permitida.
 *   - Si es válido, refleja el origin exacto en la respuesta.
 *   - En producción, restringe al ID específico de la extensión
 *     (variable de entorno CHROME_EXTENSION_ID).
 *   - En desarrollo, acepta cualquier chrome-extension:// origin.
 *
 * Uso en API Routes:
 *   import { getCorsHeaders, handleCorsOptions } from '@/lib/cors'
 *
 *   export async function GET(request: NextRequest) {
 *     const corsHeaders = getCorsHeaders(request)
 *     return NextResponse.json(data, { headers: corsHeaders })
 *   }
 *
 *   export async function OPTIONS(request: NextRequest) {
 *     return handleCorsOptions(request)
 *   }
 * ============================================================
 */

import { NextRequest, NextResponse } from 'next/server'

/**
 * Verifica si un origin está permitido para CORS.
 * Acepta:
 *   - chrome-extension://<ID> (la extensión)
 *   - http://localhost:3000 en desarrollo (para testing)
 */
function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false

  // Siempre permitir extensiones de Chrome
  if (origin.startsWith('chrome-extension://')) {
    const extensionId = process.env.CHROME_EXTENSION_ID

    // En producción: solo el ID específico
    if (extensionId) {
      return origin === `chrome-extension://${extensionId}`
    }

    // Sin ID configurado (desarrollo): aceptar cualquier extensión
    return true
  }

  // En desarrollo: permitir localhost
  if (process.env.NODE_ENV === 'development') {
    if (origin === 'http://localhost:3000') return true
    // Content scripts en iframes de PJud envían origin de la página (ej. oficinajudicialvirtual.pjud.cl)
    if (/^https:\/\/[^/]*pjud\.cl(\/|$)/.test(origin)) return true
  }

  return false
}

/**
 * Genera los headers CORS para una respuesta.
 * Si el origin del request es válido, lo refleja exactamente.
 * Si no, no incluye Access-Control-Allow-Origin (el browser bloquea).
 */
export function getCorsHeaders(
  request: NextRequest,
  options: {
    methods?: string
    headers?: string
    credentials?: boolean
  } = {}
): Record<string, string> {
  const origin = request.headers.get('Origin')
  const {
    methods = 'GET, POST, OPTIONS',
    headers: allowHeaders = 'Content-Type, Authorization',
    credentials = true,
  } = options

  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': allowHeaders,
  }

  if (isAllowedOrigin(origin)) {
    // Reflejar el origin exacto (requerido para credentials)
    corsHeaders['Access-Control-Allow-Origin'] = origin!
    if (credentials) {
      corsHeaders['Access-Control-Allow-Credentials'] = 'true'
    }
  }

  return corsHeaders
}

/**
 * Handler estándar para preflight OPTIONS requests.
 * Uso: export async function OPTIONS(req) { return handleCorsOptions(req) }
 */
export function handleCorsOptions(request: NextRequest): NextResponse {
  return NextResponse.json({}, {
    status: 200,
    headers: getCorsHeaders(request),
  })
}
