# Supabase Migrations

Este directorio contiene las migraciones SQL para la base de datos del proyecto MVP Legal.

**IMPORTANTE**: Este proyecto usa **Cursor como fuente de verdad**. Todos los cambios de esquema se hacen primero en archivos de migración aquí, luego se aplican a Supabase.

## Estructura

```
supabase/
├── migrations/                          # Migraciones con timestamp (CLI)
│   ├── 20260204120000_create_profiles_table.sql
│   └── 20260204120001_create_case_files_bucket.sql
├── 001_create_profiles_table.sql       # (Deprecated - usar migrations/)
├── storage_policies.sql                # (Deprecated - usar migrations/)
└── README.md
```

## Migraciones Disponibles

### 20260204120000_create_profiles_table.sql
**Tarea**: 1.04 - SQL: Perfiles & RLS

Crea la tabla `profiles` con el modelo binario FREE/PRO:

**Características**:
- ✅ Tabla `profiles` vinculada a `auth.users`
- ✅ Columnas para plan, contadores y control de multicuentas
- ✅ Row Level Security (RLS) configurado
- ✅ Trigger automático al registrar usuarios
- ✅ Funciones helper para verificar límites
- ✅ Índices optimizados para The Reaper y anti-multicuentas

**Límites por Plan (Actualización Feb 2026)**:
- **FREE** ("Prueba Profesional" - 7 días): 1 causa, 20 chats (lifetime), 3 deep thinking (lifetime), borrado a los 7 días. Ghost card tras expiración.
- **PRO** ($50.00/mes): 500 causas, chat con Fair Use (soft cap 3,000/mes con throttle 30s), 100 deep thinking/mes. Contadores mensuales auto-reset.

### 20260204120001_create_case_files_bucket.sql
**Tarea**: 2.01 - Bucket de Expedientes

Crea el bucket `case-files` y configura políticas RLS para archivos PDF:

- ✅ Bucket privado (solo usuarios autenticados)
- ✅ Sin límite de tamaño duro (sistema de tiers: standard ≤50MB, large ≤500MB, tomo ≤5GB)
- ✅ Solo PDFs permitidos
- ✅ Políticas RLS: usuarios solo acceden a sus archivos
- ✅ Metadata para The Reaper (plan_type, owner)
- ✅ Resumable uploads (TUS protocol) para archivos >50MB

## 🚀 Flujo de Trabajo: Cursor → Supabase

**Cursor es la fuente de verdad**. Los cambios se hacen primero en código, luego se aplican a Supabase.

### Configuración Inicial (Solo una vez)

1. **Instalar Supabase CLI**:
   ```bash
   npm install -g supabase
   ```

2. **Login y vincular proyecto**:
   ```bash
   supabase login
   supabase link --project-ref jszpfokzybhpngmqdezd
   ```
   Te pedirá la contraseña de la base de datos (la encuentras en Supabase Dashboard → Settings → Database).

### Aplicar Todas las Migraciones

Una vez vinculado, ejecuta:

```bash
supabase db push
```

Este comando:
- Lee todas las migraciones en `supabase/migrations/`
- Aplica solo las que no están en Supabase
- No rompe si algunas ya están aplicadas (idempotente)

### Flujo Diario

1. **Hacer cambios en Cursor**: Edita archivos SQL en `supabase/migrations/` o crea nuevos
2. **Aplicar a Supabase**: `supabase db push`
3. **Generar tipos TypeScript** (opcional): `supabase gen types typescript --project-id jszpfokzybhpngmqdezd > src/lib/database.types.ts`

---

## Cómo Aplicar las Migraciones (Alternativas)

### Opción 1: Supabase CLI (Recomendado - Automático)

```bash
supabase db push
```

### Opción 2: Supabase Dashboard (Manual)

1. Ve al Dashboard de Supabase: https://supabase.com/dashboard
2. Selecciona tu proyecto
3. Ve a **SQL Editor** en el menú lateral
4. Copia el contenido de cada archivo SQL en el orden correcto:
   - Primero: `001_create_profiles_table.sql`
   - Luego: `storage_policies.sql` (si aún no está aplicado)
5. Ejecuta cada script haciendo clic en **Run**
6. Verifica que no haya errores en la consola

### Opción 2: Supabase CLI (Producción)

Si tienes el CLI instalado:

```bash
# Instalar CLI (si no lo tienes)
npm install -g supabase

# Login
supabase login

# Vincular proyecto
supabase link --project-ref jszpfokzybhpngmqdezd

# Aplicar migraciones
supabase db push
```

## Verificar Instalación

Después de aplicar las migraciones, verifica en el Dashboard:

### 1. Tabla Profiles

```sql
-- Ver estructura
select * from public.profiles limit 1;

-- Verificar políticas RLS
select * from pg_policies where tablename = 'profiles';
```

### 2. Trigger Automático

Crea un usuario de prueba y verifica que se cree su perfil:

```sql
-- El perfil debería crearse automáticamente al registrarse
select id, email, plan_type, chat_count 
from public.profiles;
```

### 3. Funciones Helper

```sql
-- Probar verificación de límites
select public.check_user_limits(
  'tu-user-id-aqui'::uuid, 
  'chat'
);

-- Debería retornar algo como:
-- {"allowed": true, "current_count": 0, "remaining": 20, "limit": 20, "plan": "free"}
```

## Estructura de la Tabla Profiles

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | uuid | FK a `auth.users` |
| `email` | text | Email del usuario |
| `plan_type` | text | 'free' o 'pro' |
| `chat_count` | int | Contador de chats |
| `deep_thinking_count` | int | Contador de Deep Thinking |
| `case_count` | int | Contador de causas subidas |
| `device_fingerprint` | text | Hash para evitar multicuentas |
| `monthly_chat_count` | int | Contador mensual de chats (Fair Use PRO) |
| `monthly_deep_thinking_count` | int | Contador mensual de Deep Thinking |
| `monthly_reset_date` | timestamptz | Fecha de reset mensual de contadores |
| `last_active_date` | timestamptz | Última actividad (para The Reaper, 7 días) |
| `created_at` | timestamptz | Fecha de creación |
| `updated_at` | timestamptz | Última actualización |

## Políticas RLS Configuradas

- ✅ **SELECT**: Los usuarios solo pueden ver su propio perfil
- ✅ **UPDATE**: Los usuarios solo pueden actualizar su propio perfil
- ✅ **INSERT**: Solo el trigger del sistema puede crear perfiles
- ✅ **DELETE**: Solo el sistema (The Reaper) puede eliminar perfiles

## Funciones Disponibles

### `check_user_limits(user_id, action_type)`

Verifica si un usuario puede realizar una acción según su plan:

```typescript
// En tu código TypeScript
const { data, error } = await supabase
  .rpc('check_user_limits', {
    user_id: user.id,
    action_type: 'chat' // o 'deep_thinking', 'case'
  });

if (data.allowed) {
  // Proceder con la acción
} else {
  // Mostrar error: data.error
}
```

### `increment_counter(user_id, counter_type)`

Incrementa un contador de uso (valida límites automáticamente):

```typescript
// En tu código TypeScript
const { data, error } = await supabase
  .rpc('increment_counter', {
    user_id: user.id,
    counter_type: 'chat'
  });

if (error) {
  // Usuario alcanzó su límite
  console.error(error.message);
}
```

## Rollback (Deshacer Migración)

Si necesitas revertir la migración 001:

```sql
-- CUIDADO: Esto elimina todos los datos de perfiles
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop function if exists public.handle_updated_at();
drop function if exists public.check_user_limits(uuid, text);
drop function if exists public.increment_counter(uuid, text);
drop table if exists public.profiles cascade;
```

## Próximas Migraciones

- `002_create_document_embeddings.sql` (Tarea 2.04: Vector Store)
- `003_create_reaper_cron.sql` (Tarea 23: The Reaper)
- `004_stripe_subscriptions.sql` (Tarea 21: Stripe Webhooks)

## Notas de Desarrollo

- La migración incluye checks de `if not exists` para ser idempotente
- Los triggers se recrean (drop + create) para asegurar la versión correcta
- Los índices están optimizados para las queries más comunes del sistema

## Troubleshooting

### Error: "relation already exists"

Si la tabla ya existe, puedes:
1. Eliminarla manualmente (si está vacía)
2. Modificar el script para usar `create table if not exists`

### Error: "function does not exist"

Asegúrate de ejecutar el script completo, no solo partes.

### Error: "permission denied"

Verifica que tengas permisos de superadmin en Supabase.
