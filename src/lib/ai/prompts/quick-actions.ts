/**
 * ============================================================
 * Quick Actions — Tareas 3.08 + 3.13
 * ============================================================
 * Acciones rápidas predefinidas por procedimiento.
 * 5 comunes (incluye Plazos Fatales 3.13) + 3 específicas.
 * ============================================================
 */

export interface QuickAction {
  id: string
  label: string
  query: string
  /** Marks this action as triggering specialized prompt injection (e.g. deadline analysis) */
  specialAction?: 'deadline_analysis'
  /** Minimum recommended AI mode for this action — UI will auto-upgrade when clicked */
  recommendedMode?: 'full_analysis' | 'deep_thinking'
}

const COMMON_ACTIONS: QuickAction[] = [
  { id: 'resumen', label: 'Resumen estado actual', query: '¿Cuál es el estado actual de esta causa? Dame un resumen completo.' },
  { id: 'cronologia', label: 'Cronología', query: 'Dame una cronología ordenada de las actuaciones de esta causa, con fechas y tipo de documento.' },
  {
    id: 'plazos-fatales',
    label: 'Plazos fatales',
    query: 'Analiza los plazos fatales vigentes en esta causa. Busca las notificaciones recientes, identifica qué resoluciones fueron notificadas y cómo (personal, Art. 44, estado diario), calcula los días hábiles restantes según el Art. 66 CPC excluyendo feriados, y responde con una tabla: Plazo | Origen | Notificado | Vence | Días restantes | Art. CPC | Estado. Destaca con ⚠️ los plazos que venzan en 3 días o menos. Indica también si hay riesgo de abandono del procedimiento.',
    specialAction: 'deadline_analysis',
    recommendedMode: 'full_analysis',
  },
  { id: 'recursos', label: 'Recursos que proceden', query: '¿Qué recursos procesales proceden en el estado actual de esta causa? Indica plazos y requisitos.', recommendedMode: 'full_analysis' },
  { id: 'pendientes', label: 'Documentos pendientes', query: '¿Hay documentos clave pendientes o trámites sin completar en esta causa?' },
  { id: 'sync-updates', label: 'Cambios de sincronización', query: 'Explícame los cambios detectados en la última sincronización de esta causa. Agrupa por relevancia procesal y destaca si algún cambio implica plazos o acciones urgentes.' },
]

const PROCEDURE_ACTIONS: Record<string, QuickAction[]> = {
  ordinario: [
    { id: 'notificacion-ord', label: '¿Se notificó al demandado?', query: '¿Se notificó correctamente al demandado? ¿Qué tipo de notificación se practicó y en qué fecha?' },
    { id: 'contestacion', label: '¿Se contestó la demanda?', query: '¿Se contestó la demanda dentro de plazo (18 días hábiles Art. 258 CPC)? ¿En qué fecha?' },
    { id: 'prueba', label: 'Estado de la prueba', query: '¿Se recibió la causa a prueba? ¿En qué estado está el término probatorio? ¿Qué pruebas se rindieron?' },
  ],
  ejecutivo: [
    { id: 'requerimiento', label: '¿Se requirió de pago?', query: '¿Se practicó el requerimiento de pago al ejecutado? ¿En qué fecha y cómo fue notificado (personal o Art. 44)?' },
    { id: 'embargo', label: '¿Qué bienes se embargaron?', query: '¿Se embargaron bienes? ¿Cuáles? ¿Hay acta de embargo en el expediente?' },
    { id: 'excepciones', label: '¿Se opusieron excepciones?', query: '¿Se opusieron excepciones dentro de plazo (4-8 días Art. 459 CPC)? ¿Cuáles de las causales del Art. 464 se alegaron?' },
  ],
  sumario: [
    { id: 'audiencia', label: '¿Se realizó la audiencia?', query: '¿Se realizó la audiencia del Art. 683 CPC? ¿Comparecieron ambas partes? ¿Qué ocurrió en ella?' },
    { id: 'conciliacion', label: '¿Hubo conciliación?', query: '¿Hubo conciliación en la audiencia o se recibió la causa a prueba?' },
    { id: 'lanzamiento-sum', label: '¿Se ordenó lanzamiento?', query: '¿Se ordenó lanzamiento o restitución del inmueble? ¿Se cumplió? ¿En qué estado está el desalojo?' },
  ],
  monitorio: [
    { id: 'notificacion-mon', label: '¿Se notificó el requerimiento?', query: '¿Se notificó al arrendatario la resolución de requerimiento de pago? ¿En qué fecha?' },
    { id: 'pago-oposicion', label: '¿Pagó o se opuso?', query: '¿El arrendatario pagó, se opuso o no hizo nada dentro de los 10 días corridos (Ley 21.461)?' },
    { id: 'lanzamiento-mon', label: '¿Se ordenó lanzamiento?', query: '¿Se ordenó el lanzamiento del arrendatario? ¿Se ejecutó?' },
  ],
  voluntario: [
    { id: 'informes', label: '¿Se evacuaron informes?', query: '¿Se ordenaron y evacuaron los informes requeridos? ¿De qué organismos?' },
    { id: 'oposicion-vol', label: '¿Hubo oposición?', query: '¿Algún tercero se opuso, transformando el asunto en contencioso?' },
    { id: 'resolucion-vol', label: '¿Se resolvió la solicitud?', query: '¿Se dictó resolución sobre la solicitud? ¿Fue favorable?' },
  ],
}

export function getQuickActions(procedimiento?: string | null): QuickAction[] {
  const specific = PROCEDURE_ACTIONS[procedimiento ?? ''] ?? []
  return [...COMMON_ACTIONS, ...specific]
}

export { COMMON_ACTIONS, PROCEDURE_ACTIONS }
