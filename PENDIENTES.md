# Pendientes — Caussa MVP

Última actualización: 27 marzo 2026

---

## 🔴 Bloquean lanzamiento

### P1. Deploy a producción (caussa.cl)
**Tipo:** Manual/Infra  
**Bloquea:** Chrome Web Store, usuarios reales, todo lo demás

- [ ] Configurar hosting (Vercel u otro) y vincular repo
- [ ] Configurar dominio `caussa.cl` (DNS → hosting)
- [ ] Certificado SSL (automático en Vercel)
- [ ] Variables de entorno de producción: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_API_KEY`, `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SITE_URL=https://caussa.cl`
- [ ] Actualizar `CONFIG.DASHBOARD_URL` en `extension/lib/config.js` para producción
- [ ] Verificar que `https://caussa.cl/privacidad` y `https://caussa.cl/terminos` cargan correctamente

### P2. Publicar extensión en Chrome Web Store
**Tipo:** Manual  
**Bloquea:** CTA "Descargar extensión" de la landing  
**Depende de:** P1

- [ ] Crear cuenta de desarrollador en Chrome Web Store ($5 USD) → https://chrome.google.com/webstore/devconsole
- [ ] Empaquetar extensión como .zip (carpeta `extension/`)
- [ ] Subir al Developer Dashboard con URL de privacidad: `https://caussa.cl/privacidad`
- [ ] Actualizar href `#extension` en `src/app/page.tsx` con URL real de Chrome Web Store

### P3. Configurar CRON_SECRET + disparador del Reaper
**Tipo:** Manual/Config  
**Bloquea:** Retención 7 días del plan Free  
**Código ya implementado:** `/api/cron/reaper`

- [ ] Agregar `CRON_SECRET` en `.env.local` y en producción
- [ ] Probar en local: `curl -H "Authorization: Bearer SECRET" "http://localhost:3000/api/cron/reaper?dryRun=true"`
- [ ] Configurar cron nocturno en producción (Vercel Cron, GitHub Actions, o cron-job.org)

---

## 🟡 Recomendado antes de captar usuarios

### P4. Revisión legal con abogado
**Tipo:** Manual  
**Afecta:** Cumplimiento Ley 19.628, Chrome Web Store

- [ ] Revisar `/terminos` y `/privacidad` con abogado especialista en protección de datos
- [ ] Verificar coherencia entre modal de consentimiento (extensión) y política de privacidad web
- [ ] Si se modifica el texto, actualizar `CONSENT_VERSION` en `extension/sidepanel.js`

### P5. Activar cargo automático en Flow.cl
**Tipo:** Manual/Comercial  
**Afecta:** Suscripciones pagadas

- [ ] Contactar comercial@flow.cl o activar desde panel Flow
- [ ] Probar flujo completo de suscripción con tarjeta real

---

## 🟢 Post-lanzamiento (mejorar cuando haya usuarios)

### P6. Embeddings parciales por rate limit de Gemini
**Tipo:** Código  
**Cuándo:** Cuando se detecte en causas grandes de usuarios reales

Solución recomendada: agregar throttle/delay entre batches de embeddings + endpoint de reprocesamiento. Query para detectar documentos afectados:

```sql
SELECT d.id, d.original_filename, c.rol,
  (SELECT count(*) FROM document_chunks dc WHERE dc.document_id = d.id) AS chunks,
  (SELECT count(*) FROM document_embeddings de
   JOIN document_chunks dc2 ON de.chunk_id = dc2.id
   WHERE dc2.document_id = d.id) AS embeddings
FROM documents d JOIN cases c ON d.case_id = c.id
WHERE (SELECT count(*) FROM document_chunks dc WHERE dc.document_id = d.id) >
      (SELECT count(*) FROM document_embeddings de
       JOIN document_chunks dc2 ON de.chunk_id = dc2.id WHERE dc2.document_id = d.id)
  AND (SELECT count(*) FROM document_chunks dc WHERE dc.document_id = d.id) > 0;
```

### P7. Análisis de costos por causa
**Tipo:** Investigación + código  
**Cuándo:** Antes de escalar o ajustar pricing

- [ ] Instrumentar pipeline para loggear páginas Document AI vs pdf-parse
- [ ] Verificar tipo de procesador Document AI (OCR $1.50/1K vs Form Parser $30/1K)
- [ ] Hacer 5-10 syncs de causas variadas y medir costo real
- [ ] Evaluar Tesseract como primario y Document AI como fallback

### P8. Test Suite & QA Pipeline (Kanban 8.01)
**Tipo:** Código (12h estimadas)  
**Cuándo:** Cuando haya fixtures de causas reales estables

- [ ] Crear fixtures con 3+ causas indexadas (ordinaria, ejecutiva, sumaria)
- [ ] Tests de pipeline: sync → OCR → chunking → embeddings
- [ ] Tests de RAG: queries con expected answers por procedimiento
- [ ] Tests E2E: flujo completo sync → chat con citas
- [ ] Validar expected answers con abogado

---

## ✅ Completados

- [x] Branding "ZSE Legal" → "Caussa" (27/03/2026)
- [x] Privacy controls Google + Anthropic verificados (27/03/2026)
- [x] Privacy consent modal implementado (27/03/2026)
- [x] Landing page + Términos + Privacidad (27/03/2026)
- [x] Dashboard con lista de causas (27/03/2026)
- [x] Reaper implementado (27/03/2026)
- [x] Next.js cache en scraper config (27/03/2026)

---

## Notas de referencia

### Cuadernos incidentales vs procedimiento principal

Una causa tiene UN procedimiento principal, pero los cuadernos incidentales tienen reglas propias (Arts. 82-91 CPC siempre 3 días, independiente del procedimiento). El `procedimiento` a nivel caso es correcto para routing de prompts y acciones rápidas. El riesgo de sesgo en preguntas sobre cuadernos incidentales se mitiga parcialmente por el RAG (jala chunks del cuaderno correcto). Mejora futura: que el prompt detecte cuándo la pregunta es sobre un cuaderno incidental y aplique reglas correspondientes.
