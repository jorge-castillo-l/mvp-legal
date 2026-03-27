/**
 * ============================================================
 * Deadline Analysis — Tarea 3.13
 * ============================================================
 * Prompt especializado para análisis de plazos fatales vía RAG.
 * Se inyecta como addendum al system prompt cuando la query
 * trata sobre plazos procesales.
 *
 * Contiene:
 *   - Feriados legales de Chile (Ley 19.973) 2025-2027
 *   - Reglas detalladas de cómputo por procedimiento
 *   - Formato de salida en tabla
 *   - Detector de queries de plazos
 *
 * Fuentes: CPC Arts. 64-66, Ley 19.973, Ley 21.461.
 * ============================================================
 */

export const CHILE_HOLIDAYS: { date: string; name: string }[] = [
  // 2025
  { date: '2025-01-01', name: 'Año Nuevo' },
  { date: '2025-04-18', name: 'Viernes Santo' },
  { date: '2025-04-19', name: 'Sábado Santo' },
  { date: '2025-05-01', name: 'Día del Trabajo' },
  { date: '2025-05-21', name: 'Día de las Glorias Navales' },
  { date: '2025-06-20', name: 'Día Nacional de los Pueblos Indígenas' },
  { date: '2025-06-29', name: 'San Pedro y San Pablo' },
  { date: '2025-07-16', name: 'Virgen del Carmen' },
  { date: '2025-08-15', name: 'Asunción de la Virgen' },
  { date: '2025-09-18', name: 'Fiestas Patrias' },
  { date: '2025-09-19', name: 'Día de las Glorias del Ejército' },
  { date: '2025-10-12', name: 'Encuentro de Dos Mundos' },
  { date: '2025-10-31', name: 'Día de las Iglesias Evangélicas' },
  { date: '2025-11-01', name: 'Todos los Santos' },
  { date: '2025-12-08', name: 'Inmaculada Concepción' },
  { date: '2025-12-25', name: 'Navidad' },
  // 2026
  { date: '2026-01-01', name: 'Año Nuevo' },
  { date: '2026-04-03', name: 'Viernes Santo' },
  { date: '2026-04-04', name: 'Sábado Santo' },
  { date: '2026-05-01', name: 'Día del Trabajo' },
  { date: '2026-05-21', name: 'Día de las Glorias Navales' },
  { date: '2026-06-21', name: 'Día Nacional de los Pueblos Indígenas' },
  { date: '2026-06-29', name: 'San Pedro y San Pablo' },
  { date: '2026-07-16', name: 'Virgen del Carmen' },
  { date: '2026-08-15', name: 'Asunción de la Virgen' },
  { date: '2026-09-18', name: 'Fiestas Patrias' },
  { date: '2026-09-19', name: 'Día de las Glorias del Ejército' },
  { date: '2026-10-12', name: 'Encuentro de Dos Mundos' },
  { date: '2026-10-31', name: 'Día de las Iglesias Evangélicas' },
  { date: '2026-11-01', name: 'Todos los Santos' },
  { date: '2026-12-08', name: 'Inmaculada Concepción' },
  { date: '2026-12-25', name: 'Navidad' },
  // 2027
  { date: '2027-01-01', name: 'Año Nuevo' },
  { date: '2027-03-26', name: 'Viernes Santo' },
  { date: '2027-03-27', name: 'Sábado Santo' },
  { date: '2027-05-01', name: 'Día del Trabajo' },
  { date: '2027-05-21', name: 'Día de las Glorias Navales' },
  { date: '2027-06-21', name: 'Día Nacional de los Pueblos Indígenas' },
  { date: '2027-06-28', name: 'San Pedro y San Pablo' },
  { date: '2027-07-16', name: 'Virgen del Carmen' },
  { date: '2027-08-15', name: 'Asunción de la Virgen' },
  { date: '2027-09-18', name: 'Fiestas Patrias' },
  { date: '2027-09-19', name: 'Día de las Glorias del Ejército' },
  { date: '2027-10-11', name: 'Encuentro de Dos Mundos' },
  { date: '2027-10-31', name: 'Día de las Iglesias Evangélicas' },
  { date: '2027-11-01', name: 'Todos los Santos' },
  { date: '2027-12-08', name: 'Inmaculada Concepción' },
  { date: '2027-12-25', name: 'Navidad' },
]

const HOLIDAYS_TABLE = CHILE_HOLIDAYS.map(h => `${h.date} (${h.name})`).join(', ')

export const DEADLINE_ANALYSIS_PROMPT = `
MODO ESPECIAL: ANÁLISIS DE PLAZOS FATALES
==========================================
Has recibido una consulta sobre plazos procesales. Aplica las siguientes instrucciones ADICIONALES:

METODOLOGÍA DE ANÁLISIS — sigue estos pasos EN ORDEN:
1. IDENTIFICAR ÚLTIMA ACTUACIÓN RELEVANTE: busca en el expediente la resolución o actuación más reciente que haya gatillado un plazo (notificación de demanda, notificación de sentencia, auto de prueba, requerimiento de pago, etc.).
2. DETERMINAR TIPO DE NOTIFICACIÓN: identifica cómo fue notificada (personal, Art. 44, estado diario, cédula) — esto define CUÁNDO comienza a correr el plazo.
3. CALCULAR FECHA INICIO DEL PLAZO:
   - Notificación personal (Arts. 40-43): plazo corre desde el DÍA SIGUIENTE hábil.
   - Notificación Art. 44: se tiene por notificado al tercer día hábil desde la fecha de la diligencia del receptor. Plazo corre desde el día siguiente a ese tercer día.
   - Estado diario (Art. 50): plazo corre desde el día siguiente hábil a la inclusión en el estado.
   - Por cédula (Art. 48): plazo corre desde el día siguiente hábil a la entrega.
4. COMPUTAR DÍAS HÁBILES (Art. 66 CPC):
   - Excluir sábados (Ley 20.252), domingos y feriados.
   - EXCEPCIÓN MONITORIO (Ley 21.461): plazos corren en días CORRIDOS (incluyendo sábados, domingos y feriados).
   - EXCEPCIÓN Art. 64 inc. final CPC: si el último día del plazo cae en inhábil, se extiende al próximo hábil.
5. VERIFICAR VENCIMIENTO: comparar fecha de vencimiento con la fecha de hoy (${new Date().toISOString().split('T')[0]}).

FERIADOS LEGALES DE CHILE (Ley 19.973): ${HOLIDAYS_TABLE}

PLAZOS POR PROCEDIMIENTO:

ORDINARIO (Arts. 253-433 CPC):
- Contestación demanda: 18 días hábiles (Art. 258) / 18+tabla emplazamiento si fuera del territorio (Art. 259)
- Excepciones dilatorias: 6 días hábiles antes de contestar (Art. 305)
- Réplica y dúplica: 6 días hábiles cada una (Art. 311-312)
- Término probatorio ordinario: 20 días hábiles (Art. 328)
- Observaciones a la prueba: 10 días hábiles (Art. 430)
- Apelación sentencia definitiva: 10 días hábiles (Art. 189)
- Apelación sentencia interlocutoria: 5 días hábiles (Art. 189)
- Casación forma y fondo: 15 días hábiles (Art. 770)
- Abandono: 6 meses sin gestión útil (Art. 152)

EJECUTIVO (Arts. 434-529 CPC):
- Excepciones: 4 días hábiles desde notificación personal del requerimiento (Art. 459) / 8 días hábiles si notificado por Art. 44 (Art. 459 inc. 2)
- Plazo para objetar liquidación de crédito: 3 días hábiles
- Tercería: sin plazo fatal, pero antes de la realización de bienes
- Apelación: 5 días hábiles (Art. 189) — regla general
- Apelación sentencia definitiva: 10 días hábiles (Art. 189)
- Abandono post-sentencia: 3 AÑOS sin gestión útil (Art. 153 inc. 2)

SUMARIO (Arts. 680-692 CPC):
- Audiencia: quinto día hábil desde última notificación al demandado (Art. 683)
- Término probatorio: 8 días hábiles — reglas de incidentes (Art. 90)
- Apelación: 5 días hábiles, se concede en el solo efecto devolutivo (Art. 691)

MONITORIO (Ley 21.461):
- Plazo para pagar u oponerse: 10 días CORRIDOS desde notificación (NO hábiles)
- Si no paga ni se opone: lanzamiento en 10 días corridos
- Si se opone: se transforma en juicio sumario de arrendamiento

COMUNES:
- Reposición ordinaria: 5 días hábiles (Art. 181)
- Reposición especial (auto de prueba): 3 días hábiles (Art. 319)
- Apelación genérica: 5 días hábiles (Art. 189)
- Apelación sentencia definitiva: 10 días hábiles (Art. 189)
- Casación: 15 días hábiles (Art. 770)

FORMATO DE RESPUESTA OBLIGATORIO:
Responde con:
1. Un resumen breve del estado procesal actual de la causa.
2. Una TABLA con las siguientes columnas:

| Plazo | Origen (resolución/actuación) | Notificado | Vence | Días restantes | Art. CPC | Estado |

Donde:
- Plazo: nombre del plazo (ej: "Contestación demanda", "Excepciones Art. 464")
- Origen: qué resolución o actuación gatilló el plazo, con fecha y folio si disponible
- Notificado: fecha y tipo de notificación (personal / Art. 44 / estado diario / cédula)
- Vence: fecha calculada de vencimiento (DD/MM/YYYY)
- Días restantes: número de días hábiles restantes (o "VENCIDO" si ya pasó)
- Art. CPC: artículo del CPC o ley especial que establece el plazo
- Estado: "Vigente", "Vencido", "Por vencer (≤3 días)" o "No aplica"

3. Si un plazo está por vencer en 3 días hábiles o menos, destácalo con "⚠️ URGENTE".
4. Si no encuentras datos suficientes para calcular un plazo (falta fecha de notificación, etc.), indícalo: "No se pudo determinar — falta [dato específico] en el expediente".
5. Al final, indica si hay riesgo de abandono del procedimiento (Art. 152/153 CPC) calculando tiempo desde la última gestión útil.`

// ─────────────────────────────────────────────────────────────
// Detector — keywords de queries sobre plazos
// ─────────────────────────────────────────────────────────────

const DEADLINE_KEYWORDS = [
  'plazos fatales',
  'plazos vigentes',
  'próximos plazos',
  'análisis de plazos',
  'plazo para contestar',
  'plazo para apelar',
  'plazo para oponer excepciones',
  'plazo para recurrir',
  'vencimiento de plazo',
  'plazos que corren',
  'días para contestar',
  'cuántos días quedan',
  'cuándo vence',
  'plazos procesales',
  'plazos pendientes',
]

const DEADLINE_PATTERN = new RegExp(
  DEADLINE_KEYWORDS.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'i',
)

export function isDeadlineAnalysisQuery(query: string): boolean {
  return DEADLINE_PATTERN.test(query)
}

export function getDeadlineAnalysisPrompt(): string {
  return DEADLINE_ANALYSIS_PROMPT
}
