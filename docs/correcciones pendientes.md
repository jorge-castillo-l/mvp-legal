- cambiar middleware por proxy.
- arreglar el código del archivo cases, al parecer existe localmente pero no en la supabase(nube).
-  la extensión capta los links de descarga pero no el rol y otros datos, al parecer hay que estudiar el HTML del pjud y cambiar el código del scraper en función del html del pjud, en cuanto a selectores, etc.
- ghost card, que era una mejora propuesta por un chat de cursor para agregarle valo al producto.

---------------------------------------------------------------------------------------------------

El error aparece porque **la tabla `public.cases` no existe en tu base de datos de Supabase**.

## Qué está pasando

- La app **sí** usa la tabla `cases`:
  - **`/api/cases`** hace `supabase.from('cases').select(...)` para listar “Mis causas”.
  - **`/api/upload`** hace upsert en `cases` al subir archivos.
- En **`src/types/supabase.ts`** están definidos los tipos de `cases` y de `documents` (relación casos ↔ documentos).
- En **Supabase** solo tienes aplicadas estas migraciones:
  - `20260205120000` → tabla `profiles`
  - `20260205120001` → bucket Storage `case-files`

No hay ninguna migración que cree las tablas **`public.cases`** ni **`public.documents`**. Por eso Supabase responde: *"Could not find the table 'public.cases' in the schema cache"*.

## Qué necesitas hacer

Hay que **crear la tabla `public.cases` (y seguramente `public.documents`) en la base de datos** mediante una nueva migración y luego aplicarla.

1. **Añadir una nueva migración** en `supabase/migrations/`, por ejemplo:
   - `20260209120000_create_cases_and_documents_tables.sql`
   En esa migración debes definir:
   - **`public.cases`** con al menos: `id` (uuid, PK), `user_id` (uuid, FK a `auth.users`), `rol`, `tribunal`, `caratula`, `materia`, `estado`, `document_count`, `last_synced_at`, `created_at`, `updated_at`, y las políticas RLS que quieras (por ejemplo, que cada usuario solo vea sus causas).
   - **`public.documents`** con: `id`, `case_id` (FK a `cases`), `user_id`, `filename`, `original_filename`, `storage_path`, `document_type`, `file_size`, `file_hash`, `source`, timestamps, etc., y RLS coherente con tu lógica (por ejemplo, solo documentos del usuario y de sus causas).

   La estructura exacta debe coincidir con lo que usa el código (por ejemplo lo que tienes en `src/types/supabase.ts` y en `src/app/api/upload/route.ts`).

2. **Aplicar la migración** en Supabase:
   ```bash
   npx supabase@latest db push
   ```

Después de eso, “Mis causas” dejará de dar el error *"Could not find the table 'public.cases' in the schema cache"* porque la tabla existirá en el esquema.

Si quieres, en el siguiente mensaje pega el contenido de la migración que tengas (o la estructura que quieras) y te indico exactamente qué columnas y FKs debe tener para que coincida con tu código. Si prefieres que te genere yo el SQL de la migración, activa el modo Agent y lo escribo en un archivo nuevo en `supabase/migrations/`.

---------------------------------------------------------------------------------------------------