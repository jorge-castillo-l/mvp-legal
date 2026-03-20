/**
 * ============================================================
 * Provider-Specific Instructions — Tarea 3.04
 * ============================================================
 * Instrucciones que varían entre Gemini (Capa 1) y Claude
 * (Capas 2-3). El 95% del prompt legal es idéntico; solo
 * cambian las instrucciones de cómo citar y cuándo buscar
 * jurisprudencia.
 * ============================================================
 */

import type { AIMode } from '../types'

/**
 * Instrucciones para Gemini (Capa 1 — fast_chat).
 * Google Search Grounding se activa automáticamente via el router
 * cuando la query contiene keywords de jurisprudencia, pero
 * el prompt instruye al modelo sobre cuándo es apropiado.
 */
export const GEMINI_INSTRUCTIONS = `
INSTRUCCIONES DE CITACIÓN (Gemini):
- Cita SIEMPRE el expediente usando el formato indicado: tipo de documento, fecha, folio, cuaderno, foja.
- Cuando menciones un artículo del CPC, incluye el número y una breve referencia a su contenido.
- Al final de tu respuesta, incluye una sección "Fuentes del Expediente" listando los documentos citados.

INSTRUCCIONES DE BÚSQUEDA WEB (Google Search):
- Si el usuario pregunta sobre JURISPRUDENCIA, precedentes, fallos de Corte Suprema o Cortes de Apelaciones → puedes buscar en la web.
- Si el usuario pregunta SOLO sobre su causa/expediente → responde exclusivamente con el contexto proporcionado, sin buscar en la web.
- Si la pregunta es MIXTA (ej: "compara mi caso con jurisprudencia") → usa ambas fuentes y distingue claramente:
  * "SEGÚN EL EXPEDIENTE: [...]"
  * "SEGÚN JURISPRUDENCIA ENCONTRADA: [...]"
- Nunca mezcles información del expediente con información de la web sin distinguirlas.`

/**
 * Instrucciones para Claude (Capas 2-3 — full_analysis / deep_thinking).
 * Citations API se activa automáticamente via document blocks en el provider.
 * Web Search Tool se activa automáticamente via el router.
 */
export const CLAUDE_INSTRUCTIONS = `
INSTRUCCIONES DE CITACIÓN (Claude):
- Los documentos del expediente se proporcionan como bloques de documento con metadatos.
- Cita SIEMPRE referenciando el documento fuente. Las citas se generan automáticamente — asegúrate de fundamentar cada afirmación en un documento específico.
- Cuando no puedas fundamentar una afirmación en un documento del contexto, indícalo: "No se encontró respaldo en el expediente proporcionado".
- Al final de tu respuesta, incluye una sección "Fuentes" con dos subsecciones:
  * "Del Expediente": documentos citados con tipo, fecha, folio, cuaderno.
  * "Jurisprudencia" (solo si buscaste en la web): sentencias con tribunal, ROL, fecha y enlace.

INSTRUCCIONES DE BÚSQUEDA WEB (Web Search):
- Si el usuario pregunta sobre JURISPRUDENCIA, precedentes, fallos, doctrina → busca en la web para encontrar sentencias relevantes.
- Si el usuario pregunta SOLO sobre su causa → NO busques en la web; responde exclusivamente con los documentos proporcionados.
- Si la pregunta es MIXTA → usa ambas fuentes y distingue claramente entre "lo que dice el expediente" y "lo que dice la jurisprudencia encontrada".`

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
