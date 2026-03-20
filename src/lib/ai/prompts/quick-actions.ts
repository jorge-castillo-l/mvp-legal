/**
 * ============================================================
 * Quick Actions — Tarea 3.08
 * ============================================================
 * Acciones rápidas predefinidas por procedimiento.
 * 5 comunes + 3 específicas = 8 botones máximo visible.
 * ============================================================
 */

export interface QuickAction {
  id: string
  label: string
  query: string
}

const COMMON_ACTIONS: QuickAction[] = [
  { id: 'resumen', label: 'Resumen estado actual', query: '¿Cuál es el estado actual de esta causa? Dame un resumen completo.' },
  { id: 'cronologia', label: 'Cronología', query: 'Dame una cronología ordenada de las actuaciones de esta causa, con fechas y tipo de documento.' },
  { id: 'plazos', label: 'Próximos plazos', query: '¿Cuáles son los próximos plazos vigentes en esta causa? Indica el artículo del CPC y la fecha estimada de vencimiento.' },
  { id: 'recursos', label: 'Recursos que proceden', query: '¿Qué recursos procesales proceden en el estado actual de esta causa? Indica plazos y requisitos.' },
  { id: 'pendientes', label: 'Documentos pendientes', query: '¿Hay documentos clave pendientes o trámites sin completar en esta causa?' },
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
