/**
 * Procedimiento Sumario — Arts. 680-692 CPC + Ley 18.101 (arrendamiento)
 * Fuente: CPC (Ley 1.552) + Ley 18.101, verificado marzo 2026.
 */

export const SUMARIO_PROMPT = `
PROCEDIMIENTO: JUICIO SUMARIO (Arts. 680-692 CPC)

APLICABILIDAD:
- FACULTATIVA (Art. 680 inc. 1): acción que requiere tramitación rápida para ser eficaz, sin otro procedimiento especial.
- OBLIGATORIA (Art. 680 inc. 2) — materias principales:
  * Arrendamiento (Ley 18.101): término de contrato, desahucio, cobro de rentas, restitución de inmueble.
  * Comodato precario y precario (Art. 2195 inc. 2 Código Civil).
  * Interdictos posesorios: querella de amparo, restitución, obra nueva, obra ruinosa (Arts. 549-583 CPC).
  * Acciones accesorias del arrendador (Art. 1945 y ss. Código Civil).
  * Otras por leyes especiales.

ESTRUCTURA PROCESAL:
1. DEMANDA SUMARIA.
2. RESOLUCIÓN: cita a audiencia de contestación y conciliación para el 5to día hábil después de la última notificación (Art. 683).
3. NOTIFICACIÓN al demandado (personal o subsidiaria Art. 44).
4. AUDIENCIA (COMPARENDO) — Art. 683:
   a) Comparecen ambas partes:
      - Se ratifica la demanda.
      - El demandado contesta (oral o escrito).
      - El juez intenta conciliación.
      - Si no hay acuerdo: recibe a prueba o cita a oír sentencia (si no hay hechos controvertidos).
   b) Comparece solo el demandante: se sigue en rebeldía del demandado.
   c) No comparece el demandante: se tiene por desistido (Art. 684).
5. TÉRMINO PROBATORIO: 8 días hábiles (reglas de incidentes, Art. 686 → Art. 90).
6. SENTENCIA: 10 días desde citación a oír sentencia (Art. 688).

SUSTITUCIÓN DE PROCEDIMIENTO (Art. 681):
El tribunal puede ordenar cambiar de sumario a ordinario (o viceversa) cuando hay motivos fundados. Solicitud se tramita como incidente.

LEY 18.101 — ARRENDAMIENTO DE INMUEBLES URBANOS:
Ámbito: Inmuebles urbanos (dentro del radio urbano) + viviendas fuera del radio urbano de superficie ≤ 1 hectárea.
NO aplica a: predios agrícolas, inmuebles fiscales, alojamientos temporales ≤3 meses, hoteles, estacionamientos.

Desahucio de contratos mes a mes o duración indefinida:
- Plazo base: 2 meses desde notificación.
- Aumento: +1 mes por cada año completo de ocupación.
- Máximo: 6 meses total.
- Forma: judicial o notificación notarial.

Restitución de contratos plazo fijo ≤1 año:
- Plazo: 2 meses desde notificación de la demanda.

Restitución anticipada por arrendatario:
- El arrendatario puede restituir antes del plazo pagando renta solo hasta el día de entrega efectiva.

Lanzamiento:
- Dictada la sentencia de desalojo, el tribunal fija fecha de lanzamiento.
- El receptor practica el lanzamiento con auxilio de la fuerza pública si es necesario.

PLAZOS CLAVE:
- Audiencia/comparendo: 5to día hábil desde última notificación (Art. 683).
- Término probatorio: 8 días hábiles (Art. 686).
- Sentencia: 10 días desde citación a oír sentencia (Art. 688).
- Apelación sentencia definitiva: 10 días hábiles (Art. 189 inc. 2).
- Desahucio (Ley 18.101): 2 meses base + 1 mes/año (máx. 6 meses).

AL ANALIZAR UNA CAUSA SUMARIA, VERIFICA:
- ¿Se notificó al demandado para la audiencia? Busca actuación de receptor.
- ¿Se realizó la audiencia del Art. 683? Busca acta de audiencia/comparendo.
- ¿Hubo conciliación? Si no, ¿se recibió a prueba o se citó a oír sentencia?
- ¿Se dictó sentencia dentro de los 10 días del Art. 688?
- Si es arrendamiento: ¿se verificó el plazo de desahucio de la Ley 18.101?
- ¿Se ordenó lanzamiento? ¿Se cumplió? Busca actuación de receptor de lanzamiento.
- ¿Se solicitó sustitución de procedimiento (Art. 681)?
`
