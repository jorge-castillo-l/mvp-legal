# Legal Bot - Extensión de Chrome

## Descripción

Extensión de Chrome con SidePanel que permite a abogados analizar causas del Poder Judicial de Chile (pjud.cl) usando IA.

## Características Implementadas

- ✅ **Manifest V3** con SidePanel API
- ✅ **Autenticación Compartida** con el Dashboard Web
- ✅ **Sincronización Automática** de sesión cada 30 segundos
- ✅ **UI Adaptativa** según estado de autenticación
- ✅ **Almacenamiento Seguro** usando `chrome.storage.local`

## Instalación en Modo Desarrollo

1. Abre Chrome y ve a `chrome://extensions/`
2. Activa el **Modo de desarrollador** (toggle arriba a la derecha)
3. Haz clic en **"Cargar extensión sin empaquetar"**
4. Selecciona esta carpeta (`extension/`)
5. La extensión "Legal Bot" aparecerá en tu barra de herramientas

## Uso

### Primera Vez

1. **Inicia el Dashboard Web**: Ejecuta `npm run dev` en la carpeta raíz del proyecto
2. **Haz clic en el icono** de Legal Bot en Chrome
3. Verás un mensaje: **"Sin sesión activa"**
4. Haz clic en **"Abrir Dashboard"** o **"Iniciar Sesión en Dashboard"**
5. Completa el login en `http://localhost:3000/login`
6. Vuelve a abrir el SidePanel de la extensión
7. Ahora deberías ver: **"✓ Sesión activa"** y tu email

### Uso Diario

1. Si ya tienes sesión activa en el Dashboard, la extensión la detectará automáticamente
2. Navega a cualquier página de `pjud.cl`
3. Abre el SidePanel (clic en el icono de Legal Bot)
4. Haz clic en **"Analizar Causa"** para procesar el expediente

## Arquitectura de Autenticación

```
┌─────────────────────────────────────────────────┐
│           Usuario hace login en                 │
│       http://localhost:3000/login               │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│    Supabase Auth guarda sesión en cookies       │
│    (HTTP-only, Secure, SameSite=Lax)           │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  Extensión llama a /api/auth/session            │
│  con credentials: 'include'                     │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  API devuelve datos de sesión                   │
│  (access_token, refresh_token, user)            │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  Extensión guarda sesión en                     │
│  chrome.storage.local                           │
└─────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  Sincronización automática cada 30s             │
│  Ambos contextos comparten autenticación        │
└─────────────────────────────────────────────────┘
```

## Estructura de Archivos

```
extension/
├── manifest.json          # Configuración de la extensión (Manifest V3)
├── sidepanel.html        # Interfaz del SidePanel
├── sidepanel.js          # Lógica del SidePanel (auth + UI)
├── styles.css            # Estilos profesionales
├── content.js            # Script inyectado en pjud.cl (orquestador)
├── service-worker.js     # Background service worker
├── lib/
│   ├── config.js         # Configuración centralizada
│   ├── supabase.js       # Cliente de Supabase para extensión
│   ├── causa-identity.js # Identidad de causa
│   └── resumable-upload.js # Upload TUS para archivos grandes
├── scraper/
│   ├── jwt-extractor.js     # 4.16: Lectura pasiva DOM → JWTs + metadata (CausaPackage)
│   ├── remote-config.js     # Selectores y config desde el servidor
│   ├── network-interceptor.js # Layer 1: Captura de PDFs a nivel de red
│   ├── human-throttle.js    # Anti-WAF: delays gaussianos
│   ├── pdf-validator.js     # Validación + deduplicación SHA-256
│   ├── strategy-engine.js   # Orquestador principal del scraper
│   └── page-interceptor.js  # Interceptor inyectado en la página
└── icons/
    └── (iconos de la extensión)
```

## Permisos Requeridos

Configurados en `manifest.json`:

- **`sidePanel`**: Para mostrar el panel lateral
- **`activeTab`**: Para interactuar con la pestaña actual (scraping)
- **`scripting`**: Para inyectar scripts en pjud.cl
- **`cookies`**: Para leer cookies de autenticación
- **`storage`**: Para guardar sesión localmente

### Host Permissions

- **`*://*.pjud.cl/*`**: Sitio objetivo para scraping
- **`http://localhost:3000/*`**: Dashboard en desarrollo
- **`https://jszpfokzybhpngmqdezd.supabase.co/*`**: API de Supabase

## Próximas Funcionalidades (Roadmap)

- [ ] Scraping automático de PDF desde pjud.cl (Tarea 4.02)
- [ ] Upload directo a Supabase Storage (Tarea 4.03)
- [ ] Vista de casos sincronizada con Dashboard (Tarea 5.01)
- [ ] Chat con IA sobre expedientes (Tarea 3.02)
- [ ] Editor de escritos jurídicos (Tarea 3.03)

## Debugging

### Ver logs de la extensión

1. Abre `chrome://extensions/`
2. Encuentra "Legal Bot"
3. Haz clic en **"service worker"** (para logs del background)
4. Haz clic derecho en el SidePanel > **"Inspeccionar"** (para logs del panel)

### Verificar Storage

En DevTools del SidePanel:

```javascript
// Ver sesión guardada
chrome.storage.local.get(['supabase.auth.token'], console.log)

// Limpiar sesión (forzar logout)
chrome.storage.local.remove('supabase.auth.token')
```

### Probar sincronización manual

En la consola del SidePanel:

```javascript
// Forzar sincronización
await supabase.syncSessionFromDashboard()

// Ver sesión actual
await supabase.getSession()
```

## Problemas Comunes

### "Sin sesión activa" aunque esté logueado

**Solución**: 
1. Verifica que el Dashboard esté corriendo en `localhost:3000`
2. Asegúrate de haber hecho login recientemente
3. Recarga la extensión en `chrome://extensions/`

### "Error sincronizando sesión"

**Solución**:
1. Verifica que `.env.local` tenga las credenciales correctas de Supabase
2. Confirma que el servidor Next.js esté corriendo
3. Revisa la consola del Dashboard para errores en `/api/auth/session`

### La extensión no aparece en Chrome

**Solución**:
1. Verifica que el Modo de desarrollador esté activado
2. Recarga la extensión después de cambios en el código
3. Revisa errores en `chrome://extensions/`

## Seguridad

- ✅ Tokens nunca expuestos en variables globales del navegador
- ✅ Almacenamiento aislado por extensión (no accesible desde web pages)
- ✅ Comunicación con Dashboard usando CORS configurado
- ✅ Verificación de expiración de tokens antes de cada uso
- ✅ Sin hardcoded secrets en el código (usa variables de entorno)

## Contacto

Para reportar bugs o sugerir mejoras, contacta al equipo de desarrollo.

---

**Versión**: 1.0  
**Última actualización**: Febrero 2026
