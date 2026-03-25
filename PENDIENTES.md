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
