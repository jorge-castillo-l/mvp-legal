/**
 * ============================================================
 * Provider-Specific Instructions — Tarea 3.04
 * ============================================================
 * Instrucciones que varían entre Gemini (Capa 1) y Claude
 * (Capas 2-3). El 95% del prompt legal es idéntico; solo
 * cambian las instrucciones de cómo citar y cuándo buscar
 * jurisprudencia/doctrina.
 *
 * Incluye reglas de TRANSPARENCIA DE FUENTES compartidas:
 * el modelo debe informar al usuario si la información
 * proviene de búsqueda web verificada o de conocimiento
 * de entrenamiento.
 * ============================================================
 */

import type { AIMode } from '../types'

/**
 * Instrucción inyectada al inicio del system prompt cuando se detecta que
 * el usuario pidió EXPLÍCITAMENTE buscar en la web. Se coloca antes de
 * todo el resto del prompt para máxima prioridad.
 */
export const MANDATORY_WEB_SEARCH_INSTRUCTION = `
████████████████████████████████████████████████████████████████
INSTRUCCIÓN PRIORITARIA — BÚSQUEDA WEB OBLIGATORIA
████████████████████████████████████████████████████████████████

El usuario ha solicitado EXPLÍCITAMENTE que busques información en internet/web.

REGLAS ABSOLUTAS para esta respuesta:
1. DEBES usar la herramienta web_search (o Google Search). NO es opcional.
2. Toda la jurisprudencia, doctrina, sentencias y precedentes que menciones DEBEN provenir de los resultados de la búsqueda web, NO de tu conocimiento de entrenamiento.
3. Si la búsqueda web no arroja resultados relevantes, informa honestamente: "No encontré resultados relevantes en la búsqueda web."
4. NUNCA presentes conocimiento de entrenamiento como si fuera resultado de búsqueda web.
5. Las fuentes web (con URL) se mostrarán automáticamente al usuario. Asegúrate de que tus citas provengan de la web.
6. Distingue claramente lo que proviene del EXPEDIENTE (documentos proporcionados) de lo que proviene de la BÚSQUEDA WEB.

████████████████████████████████████████████████████████████████
`

/**
 * Reglas de transparencia compartidas por ambos providers.
 * Distinguen entre búsqueda web explícita y conocimiento de entrenamiento.
 */
const TRANSPARENCY_RULES = `
REGLAS DE TRANSPARENCIA SOBRE JURISPRUDENCIA Y DOCTRINA:

Estas reglas son OBLIGATORIAS cada vez que tu respuesta incluya jurisprudencia, doctrina, fallos, sentencias o precedentes judiciales.

ESCENARIO A — El usuario pide EXPLÍCITAMENTE buscar en internet (usa frases como "busca en internet", "googlea", "busca online", "investiga en la web", etc.):
- DEBES usar la herramienta de búsqueda web. Es OBLIGATORIO.
- Cada fallo, sentencia o cita de doctrina que menciones DEBE provenir de los resultados de búsqueda.
- NUNCA complementes con jurisprudencia o doctrina de tu conocimiento de entrenamiento cuando el usuario pidió búsqueda web explícitamente.
- Si la búsqueda no arroja resultados relevantes, dilo honestamente: "No encontré jurisprudencia relevante en la búsqueda web. ¿Deseas que responda con mi conocimiento general? (ten en cuenta que esa información requerirá verificación independiente)."

ESCENARIO B — El usuario pregunta sobre jurisprudencia o doctrina SIN pedir explícitamente buscar en internet (ej: "¿qué dice la jurisprudencia sobre esto?", "¿hay doctrina al respecto?"):
- Puedes usar la herramienta de búsqueda web si está disponible, y es preferible hacerlo.
- Si decides responder desde tu conocimiento de entrenamiento SIN usar búsqueda web, DEBES incluir esta advertencia claramente visible al inicio de la sección de jurisprudencia/doctrina:

  ⚠️ **Nota**: La siguiente información sobre jurisprudencia/doctrina proviene de mi conocimiento de entrenamiento, NO de una búsqueda web verificada. Los ROL, fechas y contenido exacto de los fallos mencionados deben ser verificados antes de utilizarlos profesionalmente.

- NUNCA presentes conocimiento de entrenamiento como si fuera el resultado de una búsqueda en internet.

REGLAS QUE APLICAN SIEMPRE (ambos escenarios):
- NUNCA inventes números de ROL, fechas de sentencia, nombres de partes o datos específicos de fallos si no estás seguro de su exactitud. Es preferible decir "existe jurisprudencia del TC sobre este tema" a inventar un ROL falso.
- Distingue SIEMPRE claramente entre lo que dice el expediente y lo que proviene de fuentes externas (web o conocimiento de entrenamiento).
- Cuando la pregunta es MIXTA (expediente + jurisprudencia), separa visualmente ambas fuentes:
  * "SEGÚN EL EXPEDIENTE: [...]"
  * "SEGÚN JURISPRUDENCIA/DOCTRINA: [...]"`

/**
 * Instrucciones para Gemini (Capa 1 — fast_chat).
 * Google Search Grounding se activa automáticamente via el router
 * cuando la query contiene keywords de jurisprudencia, pero
 * el prompt instruye al modelo sobre cuándo es apropiado.
 */
export const GEMINI_INSTRUCTIONS = `
INSTRUCCIONES DE CITACIÓN (Gemini):
- Referencia documentos de forma INLINE en el texto usando datos concretos del expediente: "según resolución de fecha 15/02/2026 (folio 48, cuaderno principal)".
- NUNCA referencies documentos por número de orden ("Documento 1", "Documento 4", etc.). Esas etiquetas son internas del sistema y el usuario NO las ve. Siempre usa datos reales: tipo de documento, fecha, folio, cuaderno, foja.
- Ejemplo CORRECTO: "según consta en el certificado de envío de fecha 30/05/2025 (folio 12, cuaderno principal)".
- Ejemplo INCORRECTO: "según consta en el Documento 4".
- Cuando menciones un artículo del CPC, incluye el número y una breve referencia a su contenido.
- NO generes una sección "Fuentes", "Referencias" ni listado de fuentes al final de tu respuesta. Las citas se muestran automáticamente por el sistema.

INSTRUCCIONES DE BÚSQUEDA WEB (Google Search):
- Si el usuario pregunta SOLO sobre su causa/expediente → responde exclusivamente con el contexto proporcionado, sin buscar en la web.
- Si el usuario pide buscar en internet o pregunta sobre jurisprudencia/doctrina → usa Google Search.
- Nunca mezcles información del expediente con información de la web sin distinguirlas.
${TRANSPARENCY_RULES}`

/**
 * Instrucciones para Claude (Capas 2-3 — full_analysis / deep_thinking).
 * Citations API se activa automáticamente via document blocks en el provider.
 * Web Search Tool se activa automáticamente via el router.
 */
export const CLAUDE_INSTRUCTIONS = `
INSTRUCCIONES DE CITACIÓN (Claude):
- Los documentos del expediente se proporcionan como bloques de documento con metadatos.
- Fundamenta cada afirmación en un documento específico del contexto.
- Referencia documentos de forma INLINE en el texto: "según resolución de fecha 15/02/2026 (folio 48, cuaderno principal)".
- NO generes una sección "Fuentes", "Referencias" ni listado de fuentes al final. El sistema genera las citas estructuradas automáticamente.
- Cuando no puedas fundamentar una afirmación, indícalo: "No se encontró respaldo en el expediente proporcionado".

INSTRUCCIONES DE BÚSQUEDA WEB (Web Search):
- Si el usuario pregunta SOLO sobre su causa → NO busques en la web; responde exclusivamente con los documentos proporcionados.
- Si el usuario pide buscar en internet o pregunta sobre jurisprudencia/doctrina → usa la herramienta web_search.
- Cuando uses web_search, las fuentes con URL se mostrarán automáticamente al usuario por el sistema.
${TRANSPARENCY_RULES}`

/**
 * Instrucciones adicionales para Extended Thinking (Capa 3 — deep_thinking).
 */
export const EXTENDED_THINKING_INSTRUCTIONS = `
INSTRUCCIONES DE ANÁLISIS PROFUNDO:
Estructura tu razonamiento siguiendo esta cadena de pensamiento:
1. MARCO LEGAL: Identifica las normas aplicables (CPC, Código Civil, leyes especiales según el procedimiento).
2. ARTÍCULOS APLICABLES: Lista los artículos específicos con su contenido relevante.
3. HECHOS DEL EXPEDIENTE: Extrae los hechos relevantes de los documentos proporcionados.
4. JURISPRUDENCIA (si aplica): Busca precedentes relevantes.
5. ANÁLISIS PROCESAL: Cruza normas + hechos + jurisprudencia.
6. CONCLUSIÓN: Respuesta directa con riesgos identificados y probabilidad de éxito cuando sea pertinente.

Sé exhaustivo en el análisis. El abogado usuario espera un nivel de profundidad equivalente al de un informe en derecho.`

export function getProviderInstructions(mode: AIMode): string {
  switch (mode) {
    case 'fast_chat':
      return GEMINI_INSTRUCTIONS
    case 'full_analysis':
      return CLAUDE_INSTRUCTIONS
    case 'deep_thinking':
      return CLAUDE_INSTRUCTIONS + '\n' + EXTENDED_THINKING_INSTRUCTIONS
  }
}
