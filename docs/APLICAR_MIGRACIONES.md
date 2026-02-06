# 🚀 APLICAR MIGRACIONES A SUPABASE

## Opción Recomendada: Usar npx (Sin Instalación)

No necesitas instalar la CLI de Supabase. Puedes usar `npx` que ya tienes con npm.

---

## Paso 1: Login a Supabase

```bash
npx supabase@latest login
```

Se abrirá tu navegador para que te autentiques. Acepta los permisos.

---

## Paso 2: Vincular tu Proyecto

```bash
cd "C:\Users\ncastillo\Desktop\MVP Legal\mvp-legal"
npx supabase@latest link --project-ref jszpfokzybhpngmqdezd
```

Te pedirá la **contraseña de la base de datos**. La encuentras en:
- Supabase Dashboard → Settings → Database → Database password

---

## Paso 3: Aplicar TODAS las Migraciones

```bash
npx supabase@latest db push
```

Este comando:
- Lee `supabase/migrations/20260204120000_create_profiles_table.sql`
- Lee `supabase/migrations/20260204120001_create_case_files_bucket.sql`
- Aplica ambas migraciones a tu base de datos en Supabase
- Crea la tabla `profiles` con todos sus triggers y funciones
- Crea el bucket `case-files` (o lo deja tal cual si ya existe)
- Aplica todas las políticas RLS

---

## Paso 4: Verificar en Supabase Dashboard

Ve a https://supabase.com/dashboard y verifica:

### Tabla Profiles:
1. Dashboard → Table Editor
2. Busca la tabla `profiles`
3. Deberías ver columnas: `id`, `email`, `plan_type`, `chat_count`, `deep_thinking_count`, etc.

### Bucket Case-Files:
1. Dashboard → Storage
2. Deberías ver el bucket `case-files`
3. Clic en él → Settings → Debería mostrar:
   - Public: No (privado)
   - File size limit: 50 MB
   - Allowed MIME types: application/pdf

### Políticas RLS:
1. Dashboard → Table Editor → `profiles` → RLS Policies
2. Deberías ver 4 políticas:
   - `profiles_select_own`
   - `profiles_update_own`
   - `profiles_insert_system_only`
   - `profiles_delete_system_only`

---

## Paso 5 (Opcional): Generar Tipos TypeScript Actualizados

```bash
npx supabase@latest gen types typescript --project-id jszpfokzybhpngmqdezd > src/lib/database.types.ts
```

Esto actualiza `src/lib/database.types.ts` con los tipos exactos de tu base de datos real.

---

## 🎉 ¡Listo!

Después de estos pasos:

- ✅ Tabla `profiles` creada en Supabase
- ✅ Bucket `case-files` creado o verificado
- ✅ Todas las políticas RLS aplicadas
- ✅ Triggers automáticos funcionando
- ✅ Funciones `check_user_limits()` y `increment_counter()` disponibles

**Todas las tareas 1-6 del Kanban están 100% completas y sincronizadas.**

---

## 🔄 Flujo de Trabajo Futuro

### Cuando necesites cambiar el esquema:

1. **Crear migración en Cursor**:
   - Nuevo archivo en `supabase/migrations/`
   - Nombre: `20260205100000_descripcion.sql`

2. **Aplicar a Supabase**:
   ```bash
   npx supabase@latest db push
   ```

3. **Actualizar tipos** (opcional):
   ```bash
   npx supabase@latest gen types typescript --project-id jszpfokzybhpngmqdezd > src/lib/database.types.ts
   ```

---

## 🆘 Troubleshooting

### Error: "Failed to link project"

Verifica que:
- Estás conectado a internet
- La contraseña de la base de datos es correcta
- El project-ref es `jszpfokzybhpngmqdezd`

### Error: "relation already exists"

No hay problema. Significa que esa tabla ya existe. Las migraciones usan `create table if not exists`, así que no rompen nada.

### Error: "Bucket already exists"

Normal si lo creaste en el Dashboard. La migración usa `on conflict do nothing`, así que no hay problema.

### ¿Cómo sé si las migraciones se aplicaron?

```bash
npx supabase@latest migration list
```

---

## 📝 Comandos Útiles

```bash
# Ver estado de migraciones
npx supabase@latest migration list

# Aplicar migraciones
npx supabase@latest db push

# Traer cambios de Supabase a Cursor (si hiciste algo en el Dashboard)
npx supabase@latest db pull

# Generar tipos TypeScript
npx supabase@latest gen types typescript --project-id jszpfokzybhpngmqdezd > src/lib/database.types.ts

# Abrir Dashboard
npx supabase@latest dashboard
```

---

## ⚡ Resumen de 3 Comandos

```bash
# 1. Login
npx supabase@latest login

# 2. Vincular
npx supabase@latest link --project-ref jszpfokzybhpngmqdezd

# 3. Aplicar todo
npx supabase@latest db push
```

**Tiempo estimado: 5 minutos**

---

## ❓ ¿Puedo Hacer Todo Desde el Dashboard sin CLI?

**Sí**, pero no es recomendado para el flujo "Cursor → Supabase". Si prefieres no usar la CLI:

1. Ve a Supabase Dashboard → SQL Editor
2. Copia el contenido de `supabase/migrations/20260204120000_create_profiles_table.sql`
3. Pega y ejecuta (Run)
4. Copia el contenido de `supabase/migrations/20260204120001_create_case_files_bucket.sql`
5. Pega y ejecuta (Run)

**Desventaja**: No tienes control de versiones de qué migraciones están aplicadas. La CLI sí lo rastrea.

---

**¿Listo para aplicar? Ejecuta los 3 comandos de arriba y luego verifica en el Dashboard 🚀**
