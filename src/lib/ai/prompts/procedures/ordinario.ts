/**
 * Procedimiento Ordinario — Arts. 253-433 CPC
 * Fuente: CPC (Ley 1.552), verificado contra leyes-cl.com/bcn.cl, marzo 2026.
 */

export const ORDINARIO_PROMPT = `
PROCEDIMIENTO: JUICIO ORDINARIO CIVIL (Arts. 253-433 CPC)

ESTRUCTURA PROCESAL:
1. DEMANDA (Art. 253-254): Requisitos Art. 254 — tribunal, partes, hechos, derecho, peticiones.
2. EMPLAZAMIENTO: Notificación personal o subsidiaria (Art. 44) al demandado.
3. EXCEPCIONES DILATORIAS (Art. 303): Plazo = dentro del término de emplazamiento (antes de contestar).
   - Incompetencia del tribunal
   - Falta de capacidad o personería
   - Litis pendencia
   - Ineptitud del libelo
   - Beneficio de excusión
   - Corrección del procedimiento
4. CONTESTACIÓN DE LA DEMANDA (Art. 309): Requisitos similares a la demanda.
5. RÉPLICA (Art. 311): 6 días hábiles desde notificación de la contestación.
6. DÚPLICA (Art. 312): 6 días hábiles desde notificación de la réplica.
7. CONCILIACIÓN OBLIGATORIA (Art. 262): El juez DEBE llamar a conciliación en todo juicio que admita transacción. Audiencia entre el día 5 y el día 15 desde notificación.
   - Excepciones: juicios ejecutivos, juicios de hacienda, juicios sobre estado civil.
8. AUTO DE PRUEBA (Art. 318): Resolución que recibe la causa a prueba fijando hechos sustanciales, pertinentes y controvertidos.
9. TÉRMINO PROBATORIO ORDINARIO (Art. 328): 20 días hábiles.
   - Extraordinario: hasta 20 días adicionales para prueba dentro de Chile; plazo de tabla + 20 para fuera del país (Art. 329-333).
10. OBSERVACIONES A LA PRUEBA (Art. 430): 10 días hábiles.
11. CITACIÓN A OÍR SENTENCIA (Art. 432): Una vez vencido el plazo de observaciones.
12. SENTENCIA DEFINITIVA (Art. 162 inc. 3): 60 días desde citación a oír sentencia.

PLAZOS CLAVE:
- Contestación: 18 días hábiles (demandado en territorio jurisdiccional, Art. 258).
- Contestación fuera de territorio: 18 + aumento según tabla de la Corte Suprema (Art. 259).
- Réplica: 6 días hábiles (Art. 311).
- Dúplica: 6 días hábiles (Art. 312).
- Término probatorio: 20 días hábiles (Art. 328).
- Observaciones a la prueba: 10 días hábiles (Art. 430).
- Sentencia: 60 días (Art. 162 inc. 3).
- Apelación de sentencia definitiva: 10 días hábiles (Art. 189 inc. 2).
- Casación: 15 días hábiles (Art. 770).

AL ANALIZAR UNA CAUSA ORDINARIA, VERIFICA:
- ¿Se notificó correctamente al demandado? Busca actuación de receptor + certificación.
- ¿Se contestó la demanda dentro de plazo? Compara fecha notificación con fecha contestación.
- ¿Se realizó la conciliación obligatoria (Art. 262)? Si se omitió, puede ser causal de casación.
- ¿Se recibió la causa a prueba? Busca auto de prueba con hechos controvertidos.
- ¿Corrió el término probatorio completo? 20 días hábiles desde última notificación del auto de prueba.
- ¿Se dictó sentencia dentro de plazo? 60 días.
- ¿Se interpusieron recursos? Revisa apelación (10d) y casación (15d).
`
