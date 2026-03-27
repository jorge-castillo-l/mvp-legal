# Pendientes

## 1. Embeddings parciales por rate limit de Gemini

**Detectado**: 2026-03-22 durante sync de C-1-2023
**Prioridad**: Media
**Afecta**: Calidad del chat RAG para documentos grandes

### Problema

Al sincronizar causas con muchos documentos, la generación de embeddings (Gemini `text-embedding-004`) alcanza el rate limit (HTTP 429). El retry con backoff exponencial (3 intentos) no es suficiente cuando hay ráfagas de cientos de chunks.

### Evidencia

- `C-1-2023_anexo_3_NOMINA.pdf`: 462 chunks, solo 300 embeddings generados (65%)
- `C-1-2023_f22_anexo_4_4_FALLO_CIDH.pdf`: 0 chunks (fallo OCR, no de embeddings)
- `C-1-2023_1___Principal_f15_cert.pdf`: 0 chunks (PDF imagen/vacío)

Log del servidor:
```
[embeddings] Retry 3/3 después de 4000ms: RESOURCE_EXHAUSTED
[orchestrator] Embeddings parcial para doc 6e03f9d5: 300/462 generados, 2 errores
```

### Soluciones a evaluar

1. **Rate limiting proactivo**: Agregar throttle/delay entre batches de embeddings para no saturar la cuota
2. **Cola con reintentos diferidos**: Encolar chunks fallidos y reprocesarlos después (minutos/horas)
3. **Endpoint de re-procesamiento**: Permitir re-generar embeddings faltantes para un documento específico sin re-sincronizar toda la causa
4. **Upgrade de cuota Gemini**: Evaluar tier de pago con límites más altos

### Cómo detectar documentos afectados

```sql
SELECT
  d.id,
  d.original_filename,
  c.rol,
  (SELECT count(*) FROM document_chunks dc WHERE dc.document_id = d.id) AS chunks,
  (SELECT count(*) FROM document_embeddings de
   JOIN document_chunks dc2 ON de.chunk_id = dc2.id
   WHERE dc2.document_id = d.id) AS embeddings
FROM documents d
JOIN cases c ON d.case_id = c.id
WHERE (SELECT count(*) FROM document_chunks dc WHERE dc.document_id = d.id) >
      (SELECT count(*) FROM document_embeddings de
       JOIN document_chunks dc2 ON de.chunk_id = dc2.id
       WHERE dc2.document_id = d.id)
  AND (SELECT count(*) FROM document_chunks dc WHERE dc.document_id = d.id) > 0
ORDER BY c.rol, d.original_filename;
```

---

## 2. Análisis de costos por causa para modelo de negocio

**Detectado**: 2026-03-22 durante auditoría de billing
**Prioridad**: Alta (bloquea decisiones de pricing y límites de usuario)
**Afecta**: Modelo de negocio, pricing de planes, límites por usuario

### Contexto

En 3 meses de desarrollo con 3 syncs de prueba (~223 documentos totales, 2 causas), el gasto real fue:

| Servicio | CLP | ~USD | % del total |
|----------|-----|------|-------------|
| Document AI (OCR) | $28,724 | ~$29.50 | 99.4% |
| Gemini Embeddings | $176 | ~$0.18 | 0.6% |
| **Total** | **$28,900** | **~$29.68** | 100% |

**Document AI domina el costo.** Embeddings y Gemini Flash (chat) son despreciables.

### Lo que necesitamos calcular

Antes de definir planes y pricing, necesitamos datos precisos de costo unitario:

1. **Costo promedio de OCR por causa según tipo de causa**
   - Causa civil simple (~20-30 folios): ¿cuántas páginas van a Document AI?
   - Causa civil compleja (~70+ folios, con anexos extensos): ¿cuántas páginas?
   - ¿Qué porcentaje de documentos del PJUD son escaneados (requieren OCR) vs. texto nativo (gratis)?

2. **Costo por página de Document AI**
   - Verificar tipo de procesador configurado (OCR a $1.50/1000 pags vs Form Parser a $30/1000 pags)
   - Si es Form Parser → cambiar a Document OCR (20x más barato, suficiente para nuestro caso)

3. **Métricas a instrumentar en el pipeline**
   - Total de páginas enviadas a Document AI por sync (no existe este tracking hoy)
   - Páginas que usaron pdf-parse exitosamente vs. las que fueron a OCR
   - Costo estimado antes de procesar (para poder alertar al usuario)

4. **Definir límites por plan de usuario**
   - Causas máximas por usuario (free / básico / pro)
   - Documentos máximos por sync
   - Páginas OCR máximas por mes
   - ¿Permitir re-sync? ¿Con qué frecuencia?

5. **Evaluar alternativas de OCR más baratas**
   - Tesseract (gratis, local) como primario para PDFs escaneados simples
   - Document AI solo como fallback para PDFs complejos donde Tesseract falla
   - Esto invertiría la prioridad actual (hoy Document AI es primario sobre Tesseract)

### Datos de referencia de las syncs de desarrollo

| Causa | Documentos | Chunks totales | Docs con OCR estimados |
|-------|-----------|----------------|----------------------|
| C-1-2026 | 28 nuevos | ~200 | Por determinar |
| C-1-2023 (1ra sync) | 129 nuevos | ~800 | Por determinar |
| C-1-2023 (2da sync) | 66 nuevos | ~500+ | Por determinar |

### Acción requerida

- [ ] Instrumentar el pipeline para loggear páginas procesadas por Document AI vs pdf-parse por causa
- [ ] Verificar y optimizar el tipo de procesador Document AI
- [ ] Hacer 5-10 syncs de causas variadas y medir costo real por causa
- [ ] Definir tabla de costos unitarios: costo por causa (promedio, mínimo, máximo)
- [ ] Usar esos datos para definir planes, pricing y límites por usuario

-------------------------------------------------------------
tomar esta respuesta en cuenta más adelante:

Esta es una pregunta muy buena y la preocupación es legítima. La respuesta desde la teoría procesal chilena es matizada:

---

**Una causa tiene UN procedimiento principal, pero los cuadernos incidentales tienen reglas propias.**

En derecho procesal civil chileno, el "procedimiento" (ordinario, ejecutivo, sumario, etc.) se determina por la **acción principal** interpuesta. Esto rige el cuaderno principal. Pero dentro de esa misma causa pueden abrirse cuadernos que se tramitan bajo reglas distintas:

| Cuaderno | Reglas que lo rigen | Depende del proc. principal? |
|---|---|---|
| **Principal** | Arts. del procedimiento (ej. 434-529 para ejecutivo) | Es el procedimiento |
| **Incidentes** | Arts. 82-91 CPC (plazo: 3 días para responder) | No. Siempre son 3 días, sea ordinario o ejecutivo |
| **Medidas prejudiciales** | Arts. 273-302 CPC | No. Reglas propias |
| **Medidas precautorias** | Arts. 290-302 CPC | No. Reglas propias |
| **Excepciones dilatorias** (ordinario) | Art. 305-307 CPC, tramitan como incidentes | Parcialmente |
| **Excepciones** (ejecutivo) | Arts. 459-464 CPC, son parte del proc. ejecutivo | Si |
| **Apremio** (ejecutivo) | Cuaderno separado post-excepciones | Si |
| **Exhorto** | Solo comunicación entre tribunales | No aplica |

---

**Tu preocupación es correcta en este escenario:**

Un abogado pregunta: "¿Cuáles son los plazos del incidente en el cuaderno de Medidas Precautorias?"

- Si el sistema solo sabe que la causa es "ejecutivo" y responde con plazos del ejecutivo -> **respuesta errónea**.
- La respuesta correcta sería que los incidentes siempre se rigen por Art. 82-91 CPC (3 días), independiente de si la causa principal es ejecutiva, ordinaria o sumaria.

**Pero este riesgo ya está parcialmente mitigado por la arquitectura actual**, y te explico por qué:

1. **El `procedimiento` a nivel caso no es lo único que el AI usa.** El RAG jala los documentos del cuaderno específico sobre el que pregunta el usuario. Si el abogado pregunta sobre una medida precautoria, los chunks relevantes vendrán del cuaderno de medidas precautorias, y el prompt base ya incluye terminología y reglas generales del CPC.

2. **El `procedimiento_raw` ya se guarda a nivel cuaderno** (en `case_cuadernos.procedimiento`). Esto significa que el dato está en la BD -- simplemente no se usa activamente todavía.

3. **Las acciones rápidas son preguntas sobre el procedimiento principal**, lo cual es correcto: "¿Se requirió de pago?" solo tiene sentido en el contexto ejecutivo del cuaderno principal.

---

**Donde SÍ hay un riesgo real:**

El riesgo está en el **prompt del sistema**. Hoy, cuando el `procedimiento` del caso es `'ejecutivo'`, se inyecta el `EJECUTIVO_PROMPT` completo (Arts. 434-529). Si el abogado pregunta sobre un incidente dentro de esa causa ejecutiva, el AI podría "sesgar" su respuesta hacia plazos ejecutivos en vez de usar los plazos de incidentes.

La solución no es eliminar el procedimiento a nivel causa, sino **complementar**. El dato a nivel causa sigue siendo útil para:
- Las acciones rápidas correctas
- El prompt base correcto
- El badge en la UI

Lo que faltaría a futuro es que cuando el AI detecte que la pregunta es sobre un cuaderno incidental (medidas, incidentes, etc.), pondere que las reglas de ese cuaderno pueden diferir del procedimiento principal. Pero eso es una mejora de la capa de AI/RAG, no un cambio en cómo se clasifica el procedimiento.

---

**En resumen:** Clasificar la causa por el procedimiento del cuaderno principal **es correcto** desde la teoría procesal. El riesgo que identificas existe pero es un problema de la capa de prompts/AI (que el modelo sepa cuándo las reglas del cuaderno incidental priman sobre las del procedimiento principal), no de la clasificación en sí.
