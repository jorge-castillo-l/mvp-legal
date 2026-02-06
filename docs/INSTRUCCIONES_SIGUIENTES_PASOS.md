# 🎯 SIGUIENTES PASOS - MVP Legal

## ✅ Lo que Ya Está Listo en Cursor

Todas las tareas 1-6 del Kanban están **completamente implementadas en código**:

- ✅ **Tarea 1.01**: Next.js 16.1 + TypeScript
- ✅ **Tarea 1.02**: Shadcn/UI v2 con tema legal
- ✅ **Tarea 1.03**: Supabase Auth + autenticación compartida Extensión ↔ Dashboard
- ✅ **Tarea 1.04**: Tabla `profiles` con RLS (en `supabase/migrations/`)
- ✅ **Tarea 2.01**: Bucket `case-files` con políticas (en `supabase/migrations/`)
- ✅ **Tarea 4.01**: Extensión Chrome Manifest V3 con SidePanel

**Todo el código está en Cursor. Ahora hay que aplicarlo a Supabase.**

---

## 🔧 Qué Hacer Ahora (Paso a Paso)

### Paso 1: Instalar Supabase CLI

Abre PowerShell y ejecuta:

```bash
npm install -g supabase
```

Verifica la instalación:

```bash
supabase --version
```

---

### Paso 2: Vincular tu Proyecto con Supabase

```bash
cd "C:\Users\ncastillo\Desktop\MVP Legal\mvp-legal"
supabase login
```

Te abrirá el navegador para hacer login. Luego:

```bash
supabase link --project-ref jszpfokzybhpngmqdezd
```

Te pedirá la **contraseña de la base de datos**. La encuentras en:
- Supabase Dashboard → Settings → Database → Database password

---

### Paso 3: Aplicar TODAS las Migraciones

Este comando aplica todo lo que está en `supabase/migrations/` a tu proyecto de Supabase:

```bash
supabase db push
```

Qué hace este comando:
- Lee `20260204120000_create_profiles_table.sql` → Crea tabla profiles
- Lee `20260204120001_create_case_files_bucket.sql` → Crea bucket case-files
- Aplica políticas RLS
- Crea triggers automáticos
- Crea funciones de validación

**Nota**: Si ya creaste el bucket en el Dashboard, no hay problema. La migración usa `on conflict do nothing`, así que no romperá nada.

---

### Paso 4: Verificar que Todo se Aplicó

Ve a Supabase Dashboard y verifica:

1. **Tabla Profiles**:
   - Dashboard → Table Editor → Busca `profiles`
   - Deberías ver las columnas: `id`, `email`, `plan_type`, `chat_count`, etc.

2. **Bucket Case-Files**:
   - Dashboard → Storage → Deberías ver `case-files`

3. **Políticas RLS**:
   - Dashboard → Authentication → Policies
   - Deberías ver políticas para `profiles` y `storage.objects`

---

### Paso 5: Generar Tipos TypeScript (Opcional pero Recomendado)

Para que tu código TypeScript tenga autocompletado perfecto:

```bash
supabase gen types typescript --project-id jszpfokzybhpngmqdezd > src/lib/database.types.ts
```

Esto sobrescribe `src/lib/database.types.ts` con los tipos exactos de tu base de datos real.

---

## 🎉 ¡Listo! Ahora Todo Está Sincronizado

Después de estos pasos:

- ✅ Tu código en Cursor refleja exactamente lo que hay en Supabase
- ✅ Supabase tiene todo lo que está en tu código
- ✅ **Cursor es la fuente de verdad**

---

## 📝 Flujo de Trabajo de Aquí en Adelante

### Cuando necesites cambiar el esquema de la base de datos:

1. **En Cursor**: Crea un nuevo archivo en `supabase/migrations/`
   - Nombre: `YYYYMMDDHHMMSS_descripcion.sql`
   - Ejemplo: `20260205100000_add_documents_table.sql`

2. **Aplica a Supabase**:
   ```bash
   supabase db push
   ```

3. **Actualiza tipos** (opcional):
   ```bash
   supabase gen types typescript --project-id jszpfokzybhpngmqdezd > src/lib/database.types.ts
   ```

### Ventajas de este flujo:

- ✅ Todo versionado en Git
- ✅ Migraciones idempotentes (puedes ejecutar `db push` varias veces)
- ✅ Historial de cambios claro
- ✅ Fácil de replicar en otros entornos (staging, producción)
- ✅ **No necesitas tocar el Dashboard de Supabase nunca más** (excepto para ver datos)

---

## 🚨 Importante: NO Hagas Cambios en el Dashboard

De aquí en adelante:

- ❌ **NO** crees tablas en el Dashboard
- ❌ **NO** ejecutes SQL manualmente en el SQL Editor
- ❌ **NO** cambies políticas RLS en la UI

**SIEMPRE**:
- ✅ Crea migraciones en Cursor (`supabase/migrations/`)
- ✅ Aplica con `supabase db push`
- ✅ Si por error hiciste algo en el Dashboard, trae los cambios con:
  ```bash
  supabase db pull
  ```
  Esto genera una migración nueva con lo que cambió.

---

## 📊 Estado Actual del Proyecto

### Archivos Importantes Creados Hoy:

```
supabase/
├── migrations/                    ✅ NUEVO
│   ├── 20260204120000_create_profiles_table.sql
│   └── 20260204120001_create_case_files_bucket.sql
├── README.md                      ✅ Actualizado
├── 001_create_profiles_table.sql  ⚠️ Deprecated (ahora en migrations/)
└── storage_policies.sql           ⚠️ Deprecated (ahora en migrations/)

src/lib/
├── database.types.ts              ✅ Tipos de DB
├── profile-helpers.ts             ✅ Funciones helper
└── supabase/
    ├── client.ts                  ✅ Con tipos
    ├── server.ts                  ✅ Con tipos
    └── middleware.ts              ✅ Con tipos

extension/
├── lib/
│   └── supabase.js                ✅ Cliente auth para extensión
├── sidepanel.html                 ✅ UI con auth
├── sidepanel.js                   ✅ Lógica auth completa
└── manifest.json                  ✅ Permisos actualizados
```

### Documentación Creada:

- `TAREA_1.03_COMPLETADA.md` - Autenticación
- `TAREA_1.04_COMPLETADA.md` - Profiles
- `AUDITORIA_TAREAS_LISTO.md` - Análisis completo
- `INSTRUCCIONES_SIGUIENTES_PASOS.md` - Este archivo
- `RESUMEN_COMPLETADO.md` - Resumen ejecutivo

---

## 🎯 Próximas Tareas del Kanban

Con las tareas 1-6 completas, puedes avanzar a:

- **Tarea 4.03**: Direct Upload API (requiere que el bucket esté en Supabase)
- **Tarea 4.04**: Middleware: Limits & Rate Guard (usa tabla profiles)
- **Tarea 5.01**: Vistas de Casos (Extensión + Dashboard)

---

## 🆘 Troubleshooting

### Error: "Failed to connect to database"

- Verifica la contraseña de la base de datos
- Asegúrate de estar conectado a internet
- Intenta `supabase link` de nuevo

### Error: "Migration already exists"

- No hay problema, significa que ya se aplicó esa migración
- `supabase db push` es idempotente

### Error: "Bucket already exists"

- Normal si lo creaste en el Dashboard
- La migración usa `on conflict do nothing`, no rompe nada

### ¿Cómo sé qué migraciones están aplicadas?

```bash
supabase migration list
```

---

## 📞 Comandos Útiles

```bash
# Ver estado de migraciones
supabase migration list

# Aplicar migraciones
supabase db push

# Traer cambios de Supabase a Cursor
supabase db pull

# Generar tipos TypeScript
supabase gen types typescript --project-id jszpfokzybhpngmqdezd > src/lib/database.types.ts

# Ver logs en tiempo real
supabase logs

# Abrir Dashboard
supabase dashboard
```

---

## ✅ Resumen Ejecutivo

**Lo que debes hacer AHORA**:

1. Instalar CLI: `npm install -g supabase`
2. Login: `supabase login`
3. Vincular: `supabase link --project-ref jszpfokzybhpngmqdezd`
4. **Aplicar todo**: `supabase db push`
5. Generar tipos: `supabase gen types typescript ... > src/lib/database.types.ts`

**Tiempo estimado**: 5-10 minutos

**Después de esto**: Todas las tareas 1-6 estarán 100% completas y sincronizadas entre Cursor y Supabase.

---

**¿Listo? Ejecuta los comandos en orden y luego continúa con la Tarea 4.03 (Direct Upload API) 🚀**
