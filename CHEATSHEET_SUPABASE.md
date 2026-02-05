# 🎯 CHEAT SHEET - Supabase CLI

## 🚀 Primera Vez (Configuración)

```bash
# 1. Login (abre el navegador)
npx supabase@latest login

# 2. Vincular proyecto
npx supabase@latest link --project-ref jszpfokzybhpngmqdezd
# Te pedirá la contraseña de DB (Dashboard → Settings → Database)

# 3. Aplicar migraciones
npx supabase@latest db push
```

---

## 🔄 Uso Diario

### Aplicar nuevas migraciones:
```bash
npx supabase@latest db push
```

### Ver qué migraciones están aplicadas:
```bash
npx supabase@latest migration list
```

### Traer cambios de Supabase a Cursor (si hiciste algo en el Dashboard):
```bash
npx supabase@latest db pull
```

### Generar tipos TypeScript actualizados:
```bash
npx supabase@latest gen types typescript --project-id jszpfokzybhpngmqdezd > src/lib/database.types.ts
```

### Abrir Dashboard:
```bash
npx supabase@latest dashboard
```

---

## 📝 Crear Nueva Migración

1. Crea archivo en `supabase/migrations/`:
   ```
   20260205100000_descripcion.sql
   ```

2. Escribe tu SQL:
   ```sql
   create table if not exists public.nueva_tabla (
     id uuid primary key default gen_random_uuid(),
     nombre text not null
   );
   ```

3. Aplica:
   ```bash
   npx supabase@latest db push
   ```

---

## 🆘 Troubleshooting

### Error: "Failed to link"
- Verifica la contraseña de DB
- Verifica el project-ref: `jszpfokzybhpngmqdezd`

### Error: "relation already exists"
- Normal, significa que ya existe esa tabla
- No hay problema, las migraciones son idempotentes

### ¿Cómo sé si mi migración se aplicó?
```bash
npx supabase@latest migration list
```

---

## 🎯 Regla de Oro

✅ **Siempre en Cursor primero** → luego `db push`  
❌ **Nunca en Dashboard primero** → perderás el control de versiones

Si por error hiciste algo en el Dashboard:
```bash
npx supabase@latest db pull
```
Esto trae los cambios como una nueva migración.

---

## 📂 Project Info

- **Project Ref**: `jszpfokzybhpngmqdezd`
- **Dashboard**: https://supabase.com/dashboard/project/jszpfokzybhpngmqdezd
- **Migraciones**: `supabase/migrations/`

---

## ⚡ Comandos Rápidos

```bash
# Todo en uno (aplicar y generar tipos)
npx supabase@latest db push && npx supabase@latest gen types typescript --project-id jszpfokzybhpngmqdezd > src/lib/database.types.ts
```

---

**Guárdalo en favoritos 📌**
