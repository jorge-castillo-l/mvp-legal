/**
 * Juicio Ejecutivo — Obligaciones de Dar — Arts. 434-529 CPC
 * Fuente: CPC (Ley 1.552), verificado contra leyes-cl.com/bcn.cl, marzo 2026.
 */

export const EJECUTIVO_PROMPT = `
PROCEDIMIENTO: JUICIO EJECUTIVO — OBLIGACIONES DE DAR (Arts. 434-529 CPC)

TÍTULOS EJECUTIVOS (Art. 434) — Lista taxativa:
1° Sentencia firme (definitiva o interlocutoria).
2° Copia autorizada de escritura pública.
3° Acta de avenimiento pasada ante tribunal competente y autorizada por ministro de fe o dos testigos.
4° Instrumento privado reconocido judicialmente o mandado tener por reconocido.
5° Confesión judicial.
6° Títulos al portador o nominativos legítimamente emitidos que representen obligaciones vencidas.
7° Cualquier otro título a que las leyes den fuerza ejecutiva.
Nota: Letras de cambio, pagarés y cheques con firma autorizada por notario no requieren reconocimiento previo.

REQUISITOS PARA EJECUTAR: obligación líquida + actualmente exigible + título no prescrito (3 años desde que la obligación se hizo exigible, Art. 442).

ESTRUCTURA PROCESAL:
1. DEMANDA EJECUTIVA: Presenta título ejecutivo + solicita despacho de mandamiento.
2. EXAMEN DEL TÍTULO (Art. 441): El juez examina el título y despacha o deniega la ejecución SIN audiencia ni notificación del demandado.
3. MANDAMIENTO DE EJECUCIÓN Y EMBARGO (Art. 443): Contiene:
   - Orden de requerir de pago al deudor.
   - Orden de embargar bienes suficientes si no paga en el acto.
   - Designación de depositario provisional.
4. REQUERIMIENTO DE PAGO: El receptor judicial requiere personalmente al ejecutado. Si no es habido → notificación Art. 44 CPC.
5. EMBARGO (Arts. 443-452): Si no paga, se traban bienes. Orden de embargo (Art. 449): 1° dinero, 2° muebles, 3° inmuebles, 4° salarios/pensiones.
6. OPOSICIÓN — EXCEPCIONES (Art. 459-464): Plazo para oponer.
7. TRASLADO DE EXCEPCIONES: 4 días al ejecutante (Art. 466).
8. SENTENCIA (Art. 470): 10 días desde que el pleito queda concluso.
   - Si NO se oponen excepciones → se OMITE la sentencia (Art. 472) → apremio directo con el mandamiento.
9. REALIZACIÓN DE BIENES / REMATE (Arts. 479-502): Tasación → bases remate → publicaciones → subasta pública.
10. LIQUIDACIÓN Y PAGO (Arts. 509-517).

PLAZOS DE EXCEPCIONES (Art. 459) — La distinción es por UBICACIÓN GEOGRÁFICA:
- 4 días hábiles: requerido en la COMUNA asiento del tribunal.
- 8 días hábiles: requerido FUERA de la comuna pero DENTRO del territorio jurisdiccional.
- 8 + tabla Art. 259: requerido FUERA del territorio jurisdiccional (Art. 460).
IMPORTANTE: El plazo corre desde el REQUERIMIENTO DE PAGO, no desde la notificación de la demanda.

18 CAUSALES DE EXCEPCIÓN (Art. 464) — Numerus clausus:
1° Incompetencia del tribunal.
2° Falta de capacidad o personería del demandante.
3° Litis pendencia ante tribunal competente.
4° Ineptitud del libelo.
5° Beneficio de excusión o caducidad de la fianza.
6° Falsedad del título.
7° Falta de requisitos para fuerza ejecutiva del título.
8° Exceso de avalúo (Art. 438 incs. 2° y 3°).
9° Pago de la deuda.
10° Remisión de la deuda.
11° Concesión de esperas o prórroga del plazo.
12° Novación.
13° Compensación.
14° Nulidad de la obligación.
15° Pérdida de la cosa debida.
16° Transacción.
17° Prescripción de la deuda o solo de la acción ejecutiva.
18° Cosa juzgada.

BIENES INEMBARGABLES (Art. 445) — Principales:
- Sueldos, gratificaciones y pensiones (excepto hasta 50% para pensiones alimenticias).
- Bienes raíces de vivienda familiar de bajo avalúo fiscal.
- Muebles de dormitorio, comedor y cocina del deudor y su familia.
- Libros, máquinas e instrumentos necesarios para el trabajo.
- Pólizas de seguro de vida.
- Derechos personalísimos (uso, habitación).

TERCERÍAS (Arts. 518-529):
- Dominio: tercero reclama propiedad de bienes embargados. Tramitación: juicio ordinario sin réplica ni dúplica. Suspende apremio si se funda en instrumento público anterior a la demanda.
- Posesión: tercero alega posesión (presume dominio). Tramitación: incidente. Suspende si presunción grave.
- Prelación: tercero tiene crédito preferente. Tramitación: incidente. NO suspende.
- Pago: tercero concurre a prorrata (deudor sin otros bienes). Tramitación: incidente. NO suspende.

PLAZOS CLAVE:
- Excepciones: 4 u 8 días hábiles según ubicación (Art. 459).
- Traslado excepciones: 4 días (Art. 466).
- Sentencia: 10 días (Art. 470).
- Apelación sentencia definitiva: 10 días hábiles (Art. 189 inc. 2).
- Prescripción acción ejecutiva: 3 años (Art. 442).
- Abandono post-sentencia: 3 años sin gestión útil (Art. 153 inc. 2).

AL ANALIZAR UNA CAUSA EJECUTIVA, VERIFICA:
- ¿El título cumple requisitos del Art. 434? ¿Está prescrito (>3 años)?
- ¿Se despachó mandamiento (Art. 441)?
- ¿Se practicó requerimiento de pago? Busca actuación de receptor.
- ¿Se embargaron bienes? Busca acta de embargo. ¿Son embargables (Art. 445)?
- ¿Se opusieron excepciones dentro de plazo? Compara fecha requerimiento con fecha escrito.
- ¿Qué excepciones se alegaron? (Art. 464).
- ¿Se dictó sentencia o se omitió por falta de excepciones (Art. 472)?
- ¿Hay tercerías pendientes? ¿Suspenden el apremio?
- ¿Hay riesgo de abandono? (3 años sin gestión útil post-sentencia).
`
