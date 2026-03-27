/**
 * ============================================================
 * Normalizador de Procedimiento PJUD
 * ============================================================
 * Clasifica el texto crudo del campo "Proc.:" de PJUD
 * en una de las 5 categorías canónicas del sistema.
 *
 * PJUD usa textos variados por cuaderno ("Ejecutivo Obligación
 * de Dar", "Ordinario Mayor Cuantía", "Medidas Prejudiciales -
 * Precautoria", etc.). Esta función los normaliza a:
 *   ordinario | ejecutivo | sumario | monitorio | voluntario
 *
 * Valores que no clasifican (Exhorto, Liquidación, Tributario,
 * Partición, etc.) retornan null → prompt genérico.
 *
 * Estrategia:
 *   1. Exclusiones primero (falsos positivos conocidos)
 *   2. Keywords por categoría con prioridad
 *
 * Tolerante a variantes futuras de PJUD que contengan la
 * palabra clave. Lo que no clasifica queda null (seguro).
 * ============================================================
 */

export type Procedimiento = 'ordinario' | 'ejecutivo' | 'sumario' | 'monitorio' | 'voluntario'

// ─────────────────────────────────────────────────────────────
// Exclusiones: textos que contienen keywords de una categoría
// pero NO pertenecen a ella. Se evalúan ANTES de las rules.
//   - "Liquidación Voluntaria" contiene "voluntaria" pero es
//     Ley 20.720 (quiebra), NO voluntario CPC Libro IV.
//   - "Tributario" se parece a ejecutivo pero tiene reglas
//     propias (Art. 177 CT, solo 3 causales de excepción).
//   - "Partición" es arbitraje forzoso (Arts. 645-666 CPC).
// ─────────────────────────────────────────────────────────────

const EXCLUSIONS: RegExp[] = [
  /liquidaci[oó]n/i,
  /tributari/i,
  /partici[oó]n/i,
]

// ─────────────────────────────────────────────────────────────
// Reglas de clasificación por keyword.
// Orden importa: monitorio ANTES de sumario para que
// "Monitorio de Arrendamiento" no caiga en sumario.
// ─────────────────────────────────────────────────────────────

interface ClassificationRule {
  target: Procedimiento
  pattern: RegExp
}

const RULES: ClassificationRule[] = [
  {
    target: 'ejecutivo',
    pattern: /ejecutiv|gesti[oó]n\s+preparatoria/i,
  },
  {
    target: 'monitorio',
    pattern: /monitorio/i,
  },
  {
    target: 'ordinario',
    pattern: /ordinario|hacienda/i,
  },
  {
    target: 'sumario',
    pattern: /sumario|precario|interdicto|cobro.*honorarios|obra\s+nueva|obra\s+ruinosa|comodato|arrendamiento|querella|denuncia\s+de\s+obra|servidumbre|dep[oó]sito\s+necesario|rendici[oó]n.*cuenta/i,
  },
  {
    target: 'voluntario',
    pattern: /voluntari|cambio.*nombre|posesi[oó]n\s+efectiva|rectificaci[oó]n|autorizaci[oó]n\s+judicial|interdicci[oó]n|[aá]rbitro|partidor/i,
  },
]

/**
 * Normaliza el texto crudo "Proc.:" de PJUD a una categoría canónica.
 * Retorna null si el texto es excluido o no clasifica.
 */
export function normalizeProcedimiento(raw: string | null | undefined): Procedimiento | null {
  if (!raw) return null

  const trimmed = raw.trim()
  if (!trimmed) return null

  for (const excl of EXCLUSIONS) {
    if (excl.test(trimmed)) {
      console.log(`[normalizeProcedimiento] Excluido: "${trimmed}"`)
      return null
    }
  }

  for (const rule of RULES) {
    if (rule.pattern.test(trimmed)) {
      return rule.target
    }
  }

  console.log(`[normalizeProcedimiento] Sin clasificación: "${trimmed}"`)
  return null
}
