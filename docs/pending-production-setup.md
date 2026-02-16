# Pasos pendientes para produccion — Tarea 7.05

> Generado: 16 feb 2026
> Contexto: El PDF Processing Orchestrator (7.05) ya esta implementado y funciona
> en desarrollo local. Estos pasos activan el **segundo camino de procesamiento**
> (Database Webhook → Edge Function) para cuando la app este desplegada en produccion.

---

## Estado actual

| Paso | Descripcion | Estado |
|------|-------------|--------|
| 1. Migracion SQL | `processing_queue` + trigger en documents | Completado |
| 2. Deploy Edge Function | `process-pdf` en Supabase | Completado |
| 3. Secrets en Supabase | `APP_URL` + `PIPELINE_SECRET_KEY` | **Pendiente** |
| 4. Database Webhook | Conectar `processing_queue` → Edge Function | **Pendiente** |

**Bloqueante**: Se necesita la URL publica de la app (Vercel u otro hosting) para completar los pasos 3 y 4.

---

## Paso 3: Configurar Secrets de la Edge Function

**Donde**: Supabase Dashboard → Edge Functions → Secrets

**URL directa**: https://supabase.com/dashboard/project/jszpfokzybhpngmqdezd/functions

1. Ir a **Edge Functions** en el menu lateral
2. Abrir la seccion **Secrets** (o "Manage Secrets")
3. Agregar estos dos secrets:

| Secret | Valor |
|--------|-------|
| `APP_URL` | URL de produccion (ej: `https://mvp-legal.vercel.app`) |
| `PIPELINE_SECRET_KEY` | `psk_mvp_legal_7f3a9c2e4b1d8e5f6a0b3c7d9e2f4a1b` |

> La `PIPELINE_SECRET_KEY` debe ser la misma que esta en `.env.local` (linea 6).
> La `APP_URL` es la que Vercel asigne al desplegar.

4. Guardar cada secret

---

## Paso 4: Configurar Database Webhook

**Donde**: Supabase Dashboard → Database → Webhooks

**URL directa**: https://supabase.com/dashboard/project/jszpfokzybhpngmqdezd/database/hooks

1. Click en **Create a new hook**
2. Configurar asi:

| Campo | Valor |
|-------|-------|
| Name | `trigger-process-pdf` |
| Table | `processing_queue` |
| Events | Solo **Insert** |
| Type | **Supabase Edge Function** |
| Edge Function | `process-pdf` |
| Timeout | 30 segundos (default) |

3. Confirmar con **Create webhook**

> Requisito: El paso 3 debe estar completado antes. Sin `APP_URL`, la Edge
> Function fallara con "Configuracion incompleta".

---

## Verificacion post-configuracion

Una vez completados ambos pasos, verificar que el flujo end-to-end funciona:

1. Subir un PDF desde la extension o manualmente
2. Revisar en Supabase Dashboard:
   - Tabla `processing_queue` → debe aparecer una fila con status `queued` → `processing` → `completed`
   - Tabla `extracted_texts` → debe pasar de status `pending` a `completed`
3. Revisar logs de la Edge Function:
   - Dashboard → Edge Functions → `process-pdf` → Logs
   - No deberian haber errores de "Configuracion incompleta"

---

## Por que esto no bloquea el desarrollo

El upload route (`/api/upload`) tiene un mecanismo **fire-and-forget** que llama
directamente a `/api/pipeline/process-document` en el mismo servidor. Esto cubre
el 100% del procesamiento durante desarrollo local (`APP_URL=http://localhost:3000`).

El webhook + Edge Function es un **segundo camino redundante** que solo se activa
en produccion, asegurando que ningun documento quede sin procesar incluso si el
fire-and-forget falla (timeout, cold start, etc).
