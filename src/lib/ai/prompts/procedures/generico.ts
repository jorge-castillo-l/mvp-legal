/**
 * Prompt Genérico — Fallback cuando el procedimiento es desconocido o nulo.
 */

export const GENERICO_PROMPT = `
PROCEDIMIENTO: CIVIL GENERAL (procedimiento no identificado)

El procedimiento específico de esta causa no ha sido determinado. Aplica las reglas generales del derecho procesal civil chileno:

REGLAS GENERALES APLICABLES:
- Requisitos de la demanda: Art. 254 CPC.
- Notificaciones: personal (Arts. 40-43), subsidiaria (Art. 44), estado diario (Art. 50), por cédula (Art. 48).
- Plazos de recursos: apelación 5 días hábiles regla general / 10 días para sentencias definitivas (Art. 189); casación 15 días (Art. 770).
- Abandono: 6 meses sin gestión útil (Art. 152).
- Estructura de sentencias: Art. 170 (expositiva + considerativa + resolutiva).

RECOMENDACIÓN:
Si puedes identificar el tipo de procedimiento por la materia de la causa (ej: cobro de rentas → monitorio; arrendamiento → sumario; pagaré/cheque → ejecutivo), indícalo al usuario y aplica las reglas específicas de ese procedimiento.

AL ANALIZAR, VERIFICA:
- ¿Qué tipo de actuaciones hay en el expediente? Pueden indicar el procedimiento.
- ¿Hay mandamiento de ejecución y embargo? → Probablemente juicio ejecutivo.
- ¿Hay acta de audiencia/comparendo? → Probablemente sumario.
- ¿Hay réplica y dúplica? → Probablemente ordinario.
- ¿Hay resolución de requerimiento de pago monitorio? → Monitorio.
`
