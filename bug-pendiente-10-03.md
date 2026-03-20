## 1. Errores del scraper — ¿hay que arreglarlos?

**Sí, es un bug real** pero no está relacionado con el router AI. El problema es:

- La migración `20260311120000_add_pending_sync_tasks_to_cases.sql` agregó la columna `pending_sync_tasks` a la tabla `cases` en la base de datos
- Pero los tipos TypeScript en `src/types/supabase.ts` **nunca se regeneraron** para incluir esa columna
- Resultado: el scraper funciona en runtime (la columna existe en Supabase), pero TypeScript no la reconoce

**La solución es regenerar los tipos** con `supabase gen types typescript`. Es una tarea rápida pero separada del AI router. Te recomiendo abordarlo después — no bloquea nada del Cerebro (Fase 2).

---

## 2. Tarea 3.05 — Análisis y refinamientos

La tarea 3.05 está bien planificada y **no necesita refinamientos mayores**. Solo un par de observaciones:

**Lo que ya está parcialmente hecho**: en el provider Anthropic que acabamos de crear, los document blocks ya llevan `cache_control: { type: 'ephemeral' }` en el último bloque. Esto activa el caching automáticamente en Claude. Lo que falta es cachear también el **system prompt** como prefijo estable.

**Refinamiento menor — Gemini caching**: el SDK `@google/generative-ai` v0.24 incluye `GoogleAICacheManager` para explicit caching. No necesitamos instalar un SDK nuevo. Pero hay que verificar que funcione con `gemini-3-flash-preview` (algunos modelos más nuevos pueden requerir una versión más reciente del SDK).

**Refinamiento menor — Monitoreo**: la tarea menciona "monitorear cache hit rate" pero no dice **dónde** almacenar esas métricas. Sugiero loggear a `console.log` por ahora y agregar una tabla de analytics cuando sea necesario (post-MVP).

---

## 3. ¿Necesitas hacer algo manualmente?

**No.** Para la tarea 3.05 no necesitas crear cuentas, obtener API keys ni tomar decisiones arquitecturales. Todo es implementación de código usando las mismas keys y SDKs que ya tenemos. Solo necesitas cambiar a **modo Agent** para que pueda implementar.