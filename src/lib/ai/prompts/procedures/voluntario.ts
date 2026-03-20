/**
 * Jurisdicción Voluntaria — Arts. 817-828 CPC
 * Fuente: CPC (Ley 1.552), verificado marzo 2026.
 */

export const VOLUNTARIO_PROMPT = `
PROCEDIMIENTO: JURISDICCIÓN VOLUNTARIA / ACTOS JUDICIALES NO CONTENCIOSOS (Arts. 817-828 CPC)

CARACTERÍSTICAS:
- NO hay conflicto entre partes. No hay demandado.
- El tribunal actúa a SOLICITUD del interesado (no "demanda").
- El juez puede decretar de oficio diligencias informativas (Art. 820).
- Las resoluciones pueden MODIFICARSE si cambian las circunstancias (Art. 821), salvo que se hayan cumplido derechos de terceros.
- Si un tercero se opone → el asunto se transforma en CONTENCIOSO y se tramita según el procedimiento que corresponda.
- No procede el abandono del procedimiento (Art. 823).

TERMINOLOGÍA ESPECÍFICA — Usar con precisión:
- "Solicitud" (NO "demanda").
- "Interesado" (NO "demandante").
- "Decreto" o "Auto" (NO "sentencia", salvo que haya habido oposición y se haya vuelto contencioso).
- "Informe": pericial, del ministerio público u otros organismos según la materia.

ESTRUCTURA GENERAL:
1. SOLICITUD del interesado ante tribunal competente.
2. DECRETO del tribunal: puede ordenar informes, diligencias probatorias, audiencias.
3. INFORMES: pericial, del ministerio público, del Defensor de Menores, Servicio de Registro Civil, u otros según la materia.
4. RESOLUCIÓN: el tribunal resuelve la solicitud.
   - Si nadie se opone → la resolución puede modificarse mientras no se afecten derechos adquiridos de terceros (Art. 821).
   - Si hay oposición de legítimo contradictor → se vuelve contencioso (Art. 823).

MATERIAS COMUNES DE JURISDICCIÓN VOLUNTARIA:
- Posesión efectiva de herencia.
- Cambio de nombre.
- Rectificación de partidas.
- Declaración de muerte presunta.
- Autorización judicial para actos de incapaces.
- Inventarios solemnes.
- Tasación de bienes.
- Informaciones para perpetua memoria.

AL ANALIZAR UN ASUNTO VOLUNTARIO, VERIFICA:
- ¿Cuál es la materia de la solicitud?
- ¿Se ordenaron informes o diligencias? ¿Se evacuaron?
- ¿Hubo oposición de algún tercero? Si sí, ¿se transformó en contencioso?
- ¿Se dictó resolución? ¿Fue favorable al interesado?
`
