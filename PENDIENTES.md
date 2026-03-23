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
