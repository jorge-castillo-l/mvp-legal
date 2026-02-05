-- ============================================================================
-- TAREA 2.01: Bucket de Expedientes
-- ============================================================================
-- Creación del bucket 'case-files' para almacenar PDFs de causas legales
-- Incluye políticas RLS para seguridad multi-tenant
-- ============================================================================

-- 1. CREAR BUCKET
-- ============================================================================

-- Crear bucket para archivos PDF de expedientes
-- Nota: Si ya existe (creado en Dashboard), esto no fallará gracias a ON CONFLICT
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'case-files',
  'case-files',
  false,                                    -- Privado (solo usuarios autenticados)
  52428800,                                 -- 50 MB límite por archivo
  array['application/pdf']::text[]          -- Solo PDFs permitidos
)
on conflict (id) do nothing;



-- 2. POLÍTICAS RLS PARA STORAGE
-- ============================================================================

-- Política 1: Ver archivos propios (SELECT/READ)
-- Los usuarios solo pueden ver archivos donde el metadata.owner es su auth.uid()
create policy "policy_ver_propios_v3" 
  on storage.objects
  for select 
  to authenticated 
  using ((metadata ->> 'owner') = auth.uid()::text);

-- Política 2: Subir archivos propios (INSERT/UPLOAD)
-- Los usuarios solo pueden subir archivos si marcan metadata.owner con su auth.uid()
create policy "policy_subir_propios_v3" 
  on storage.objects
  for insert 
  to authenticated 
  with check ((metadata ->> 'owner') = auth.uid()::text);

-- Política 3: Actualizar archivos propios (UPDATE)
-- Los usuarios solo pueden actualizar archivos que les pertenecen
create policy "policy_actualizar_propios_v3" 
  on storage.objects
  for update 
  to authenticated 
  using ((metadata ->> 'owner') = auth.uid()::text) 
  with check ((metadata ->> 'owner') = auth.uid()::text);

-- Política 4: Borrar archivos propios (DELETE)
-- Los usuarios solo pueden eliminar sus propios archivos
create policy "policy_borrar_propios_v3" 
  on storage.objects
  for delete 
  to authenticated 
  using ((metadata ->> 'owner') = auth.uid()::text);


-- ============================================================================
-- NOTAS IMPORTANTES
-- ============================================================================

-- METADATA REQUERIDA al subir archivos:
-- {
--   "owner": "uuid-del-usuario",
--   "plan_type": "free" | "pro",
--   "uploaded_at": "timestamp",
--   "case_name": "nombre-causa" (opcional)
-- }

-- Para The Reaper (Tarea 23):
-- Los archivos FREE deben incluir metadata.plan_type = 'free'
-- para que el script de limpieza los identifique y borre después de 3 días

-- EJEMPLO DE SUBIDA desde TypeScript:
-- const { data, error } = await supabase.storage
--   .from('case-files')
--   .upload(`${userId}/${filename}`, file, {
--     metadata: {
--       owner: userId,
--       plan_type: userProfile.plan_type,
--       uploaded_at: new Date().toISOString()
--     }
--   });

-- ============================================================================
-- FIN DE MIGRACIÓN: CASE FILES BUCKET
-- ============================================================================
