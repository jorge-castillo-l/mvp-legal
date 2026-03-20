/**
 * Procedimiento Monitorio — Ley 21.461 (modifica Ley 18.101)
 * Vigente desde 30/06/2022. Verificado marzo 2026.
 */

export const MONITORIO_PROMPT = `
PROCEDIMIENTO: MONITORIO DE COBRO DE RENTAS (Ley 21.461, vigente desde 30/06/2022)

ÁMBITO:
- Cobro de rentas de arrendamiento adeudadas.
- Cobro de gastos comunes y cuentas de consumo adeudados por el arrendatario.
- Materias PJUD: M09 (Monitorio Cobro Rentas), M10 (Monitorio Precario), M11 (Monitorio Comodato Precario).
IMPORTANTE: Los plazos de este procedimiento corren en DÍAS CORRIDOS (excepción a la regla general de días hábiles del CPC).

ESTRUCTURA PROCESAL:
1. DEMANDA MONITORIA (Art. 18-A Ley 18.101 modificado):
   Requisitos:
   - Nombre, profesión/oficio y domicilio del arrendador y arrendatario.
   - Individualización del inmueble arrendado.
   - Detalle de rentas adeudadas, gastos comunes y cuentas de consumo, con relación precisa de antecedentes.
   - Solicitud de requerimiento al arrendatario para pagar en 10 días corridos, bajo apercibimiento de condena al pago.
2. EXAMEN POR EL TRIBUNAL:
   - Si la demanda tiene defectos formales → plazo de hasta 10 días para subsanar.
   - Si cumple requisitos → se dicta resolución de requerimiento de pago.
3. RESOLUCIÓN DE REQUERIMIENTO: Ordena al arrendatario pagar en 10 días corridos.
4. NOTIFICACIÓN al arrendatario (personal o subsidiaria Art. 44).
5. PLAZO DE 10 DÍAS CORRIDOS — tres escenarios:
   a) El arrendatario PAGA → fin del procedimiento.
   b) El arrendatario NO paga NI se opone → se le tiene por CONDENADO al pago → procede lanzamiento.
   c) El arrendatario se OPONE (Art. 18-B):
      - Oposición por escrito señalando medios de prueba.
      - Si se ACOGE la oposición → termina el monitorio; inicia juicio con tramitación más extensa.
      - Si se RECHAZA la oposición → condena al pago + lanzamiento.
6. LANZAMIENTO: Si no hubo pago ni oposición exitosa, el tribunal ordena el desalojo forzado del arrendatario.

MEDIDA PRECAUTORIA ESPECIAL — Restitución Anticipada:
- El juez puede ordenar restitución anticipada del inmueble cuando:
  * Se acredite destrucción parcial o inutilización del inmueble por acción u omisión del arrendatario.
  * Requisito: "presunción grave del derecho" a favor del arrendador.
- El juez puede exigir caución al arrendador para indemnizar si la sentencia final no condena a restituir.

PLAZOS CLAVE:
- Pago u oposición: 10 días CORRIDOS desde notificación (NO hábiles).
- Subsanación defectos demanda: hasta 10 días.
- Lanzamiento: según resolución del tribunal (sin plazo legal fijo).

AL ANALIZAR UNA CAUSA MONITORIA, VERIFICA:
- ¿Se notificó correctamente la resolución de requerimiento de pago?
- ¿Transcurrieron los 10 días corridos? Cuenta días calendario, no hábiles.
- ¿El arrendatario pagó, se opuso o no hizo nada?
- Si hubo oposición: ¿se acogió o rechazó?
- ¿Se ordenó lanzamiento? ¿Se ejecutó?
- ¿Se solicitó restitución anticipada como medida precautoria?
`
