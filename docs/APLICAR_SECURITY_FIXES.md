# Guía: Aplicar Correcciones de Seguridad Supabase

Esta guía te ayuda a implementar las correcciones para los 5 warnings de seguridad detectados por el linter de Supabase.

---

## 📋 Resumen de Correcciones

| Warning | Solución | Estado |
|---------|----------|--------|
| Function Search Path Mutable (4 funciones) | Migración SQL | ✅ Lista |
| Leaked Password Protection Disabled | Configuración Dashboard | ⏳ Manual |

---

## 🔧 Paso 1: Aplicar Migración SQL

La migración `20260212120000_fix_function_search_path.sql` ya está creada en `supabase/migrations/`.

### Opción A: Supabase CLI (Recomendado)

```bash
# Desde la raíz del proyecto
npx supabase migration up
```

### Opción B: SQL Editor en Supabase Dashboard

1. Abre el **SQL Editor** en tu proyecto Supabase
2. Copia el contenido de `supabase/migrations/20260212120000_fix_function_search_path.sql`
3. Pégalo en el editor
4. Pulsa **Run**

### Verificación

Ejecuta en el SQL Editor para confirmar que las funciones tienen `search_path`:

```sql
SELECT 
  proname as function_name,
  prosrc as source_code
FROM pg_proc 
WHERE pronamespace = 'public'::regnamespace 
  AND proname IN (
    'handle_updated_at',
    'maybe_reset_monthly_counters',
    'check_user_limits',
    'increment_counter'
  );
```

Busca en el resultado la línea `set search_path = public` en cada función.

---

## 🔒 Paso 2: Activar Leaked Password Protection

### En el Supabase Dashboard:

1. Ve a tu proyecto en https://supabase.com/dashboard
2. **Authentication** → **Settings** (en el menú lateral)
3. Scroll hasta **"Password Settings"**
4. Activa **"Enable Leaked Password Protection"**
5. Guarda los cambios

### ¿Qué hace esto?

- Al registrarse o cambiar contraseña, Supabase verifica contra la base de datos de HaveIBeenPwned
- Bloquea contraseñas conocidas como comprometidas
- No afecta sesiones actuales ni contraseñas existentes
- Solo aplica a nuevas contraseñas o cambios futuros

---

## ✅ Verificación Final

### 1. Volver a ejecutar el linter

En el Supabase Dashboard → **Database** → **Linter**

Los 5 warnings deberían desaparecer.

### 2. Probar funcionalidad

```bash
# Probar que la app sigue funcionando
npm run dev
```

- Inicia sesión
- Sincroniza una causa
- Verifica que los contadores funcionan

---

## 🚨 Rollback (si algo sale mal)

Si necesitas revertir la migración:

```sql
-- En SQL Editor, ejecuta la migración original SIN el search_path
-- (contenido de 20260205120000_create_profiles_table.sql, funciones originales)
```

O usa:

```bash
npx supabase migration rollback
```

---

## 📝 Notas

- **Impacto**: BAJO - Solo añade seguridad, no cambia comportamiento
- **Tiempo**: ~2 minutos para aplicar ambas correcciones
- **Reversible**: Sí (aunque no hay razón para revertir)
- **Testing**: Recomendado pero no crítico - las funciones no cambian su lógica

---

## ❓ Troubleshooting

### Error: "function already exists"

Normal - `CREATE OR REPLACE` sobreescribe la función existente.

### Error: "search_path is not a valid option"

Verifica la sintaxis: debe ser `set search_path = public` (minúsculas, sin comillas en public).

### Los warnings siguen apareciendo

- Espera 1-2 minutos para que el linter se actualice
- Refresca la página del Dashboard
- Si persisten, verifica que la migración se aplicó correctamente

---

✅ **¡Listo!** Tu base de datos ahora cumple con las mejores prácticas de seguridad de Supabase.
