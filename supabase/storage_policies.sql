-- Regla 1: Ver archivos (Lectura)
create policy "policy_ver_propios_v3" on storage.objects
  for select to authenticated 
  using ((metadata ->> 'owner') = auth.uid()::text);

-- Regla 2: Subir archivos (Escritura)
create policy "policy_subir_propios_v3" on storage.objects
  for insert to authenticated 
  with check ((metadata ->> 'owner') = auth.uid()::text);

-- Regla 3: Actualizar archivos (Edición)
create policy "policy_actualizar_propios_v3" on storage.objects
  for update to authenticated 
  using ((metadata ->> 'owner') = auth.uid()::text) 
  with check ((metadata ->> 'owner') = auth.uid()::text);

-- Regla 4: Borrar archivos (Eliminación)
create policy "policy_borrar_propios_v3" on storage.objects
  for delete to authenticated 
  using ((metadata ->> 'owner') = auth.uid()::text);