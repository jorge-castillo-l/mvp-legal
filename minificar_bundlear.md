# Minificar y Bundlear la Extensión de Chrome — Guía paso a paso

## Contexto

La extensión actualmente tiene **16 archivos .js** distribuidos en `extension/`. Cualquiera que instale la extensión puede leer cada archivo con nombres descriptivos (`jwt-extractor.js`, `strategy-engine.js`, etc.) y comentarios detallados.

El objetivo es generar un build que convierta todo en **4 archivos minificados** con variables ilegibles, sin comentarios, y sin estructura de archivos reveladora.

## Resultado esperado

```
ANTES (lo que ves en el repo):          DESPUÉS (lo que se publica):
extension/                              dist-extension/
├── content.js                          ├── content.bundle.js      (1 archivo)
├── lib/config.js                       ├── sw.bundle.js           (1 archivo)
├── lib/supabase.js                     ├── sidepanel.bundle.js    (1 archivo)
├── lib/resumable-upload.js             ├── interceptor.bundle.js  (1 archivo)
├── scraper/remote-config.js            ├── sidepanel.html         (copiado)
├── scraper/network-interceptor.js      ├── styles.css             (copiado)
├── scraper/human-throttle.js           ├── icons/                 (copiado)
├── scraper/jwt-extractor.js            └── manifest.json          (generado)
├── scraper/pdf-validator.js
├── scraper/strategy-engine.js
├── scraper/page-interceptor.js
├── service-worker.js
├── sidepanel.js
├── sidepanel.html
├── styles.css
└── manifest.json
```

Tu flujo de desarrollo NO cambia: sigues editando los archivos originales en `extension/`. Webpack genera `dist-extension/` automáticamente al hacer build. Solo publicas `dist-extension/` en Chrome Web Store.

---

## Paso 1: Instalar dependencias de build

```bash
npm install --save-dev webpack webpack-cli terser-webpack-plugin copy-webpack-plugin
```

| Paquete | Qué hace |
|---------|----------|
| `webpack` | Bundler — combina múltiples .js en uno |
| `webpack-cli` | Permite correr webpack desde terminal |
| `terser-webpack-plugin` | Minifica el código (acorta variables, quita whitespace) |
| `copy-webpack-plugin` | Copia archivos estáticos (HTML, CSS, icons) al dist |

---

## Paso 2: Crear `webpack.extension.config.js` en la raíz del proyecto

```javascript
const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  mode: 'production',

  // Los 4 entry points de la extensión
  entry: {
    content: './extension/content.js',
    sw: './extension/service-worker.js',
    sidepanel: './extension/sidepanel.js',
    interceptor: './extension/scraper/page-interceptor.js',
  },

  output: {
    path: path.resolve(__dirname, 'dist-extension'),
    filename: '[name].bundle.js',
    clean: true,
  },

  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          // Mangling: renombra variables a nombres cortos
          mangle: {
            reserved: ['chrome'], // No renombrar la API de Chrome
          },
          compress: {
            drop_console: false, // Cambiar a true en producción final si quieres
            drop_debugger: true,
            passes: 2,
          },
          format: {
            comments: false, // Eliminar TODOS los comentarios
          },
        },
        extractComments: false,
      }),
    ],
  },

  // Copiar archivos estáticos que no pasan por webpack
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: 'extension/sidepanel.html', to: 'sidepanel.html' },
        { from: 'extension/styles.css', to: 'styles.css' },
        { from: 'extension/icons', to: 'icons', noErrorOnMissing: true },
      ],
    }),
  ],

  // Sin source maps en producción (IMPORTANTE: no exponer código original)
  devtool: false,

  resolve: {
    extensions: ['.js'],
  },
};
```

---

## Paso 3: Adaptar los archivos para que webpack los entienda

Actualmente los archivos declaran clases globales (ej: `class StrategyEngine { ... }`) y se cargan en orden vía `manifest.json`. Webpack necesita imports/exports explícitos.

### 3.1 Agregar exports a cada módulo del scraper

En cada archivo de `extension/scraper/` y `extension/lib/`, agregar al final:

```javascript
// Al final de remote-config.js:
if (typeof module !== 'undefined') module.exports = RemoteConfig;

// Al final de network-interceptor.js:
if (typeof module !== 'undefined') module.exports = NetworkInterceptor;

// Al final de human-throttle.js:
if (typeof module !== 'undefined') module.exports = HumanThrottle;

// Al final de jwt-extractor.js:
if (typeof module !== 'undefined') module.exports = JwtExtractor;

// Al final de pdf-validator.js:
if (typeof module !== 'undefined') module.exports = PdfValidator;

// Al final de strategy-engine.js:
if (typeof module !== 'undefined') module.exports = StrategyEngine;
```

El `if (typeof module !== 'undefined')` asegura que el código siga funcionando sin webpack durante desarrollo.

### 3.2 Agregar imports al inicio de `content.js`

```javascript
// Al inicio de content.js:
if (typeof require !== 'undefined') {
  var Config = require('./lib/config.js');
  var RemoteConfig = require('./scraper/remote-config.js');
  var NetworkInterceptor = require('./scraper/network-interceptor.js');
  var HumanThrottle = require('./scraper/human-throttle.js');
  var JwtExtractor = require('./scraper/jwt-extractor.js');
  var PdfValidator = require('./scraper/pdf-validator.js');
  var StrategyEngine = require('./scraper/strategy-engine.js');
}
```

### ALTERNATIVA más limpia (recomendada si quieres migrar de una vez)

En vez de los guards `if (typeof module...)`, convertir directamente a ES modules o CommonJS. Webpack los resuelve igual. Esto es más trabajo inicial pero el código queda más limpio a futuro.

---

## Paso 4: Generar el `manifest.json` de producción

Crear un script o agregarlo al CopyPlugin. El manifest de `dist-extension/` debe apuntar a los bundles:

```json
{
  "manifest_version": 3,
  "name": "Caussa",
  "version": "1.1",
  "description": "Sincroniza tus causas civiles desde PJUD y consulta tu expediente con IA.",
  "permissions": ["sidePanel", "activeTab", "scripting", "cookies", "storage", "webRequest", "downloads"],
  "host_permissions": ["*://*.pjud.cl/*", "https://*.supabase.co/*"],
  "background": {
    "service_worker": "sw.bundle.js"
  },
  "action": {
    "default_title": "Caussa"
  },
  "side_panel": {
    "default_path": "sidepanel.html"
  },
  "content_scripts": [
    {
      "matches": ["*://*.pjud.cl/*"],
      "js": ["content.bundle.js"],
      "run_at": "document_idle",
      "all_frames": true
    }
  ],
  "web_accessible_resources": [
    {
      "resources": ["interceptor.bundle.js"],
      "matches": ["*://*.pjud.cl/*"]
    }
  ]
}
```

Notas:
- `content_scripts.js` ahora es un solo archivo en vez de 9.
- `page-interceptor.js` ahora es `interceptor.bundle.js`.
- Se eliminó `http://localhost:3000/*` de `host_permissions` (solo para dev).

Puedes copiar este manifest con CopyPlugin o con un script que lo genere automáticamente.

---

## Paso 5: Agregar scripts al `package.json`

```json
{
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "build:ext": "webpack --config webpack.extension.config.js",
    "build:ext:watch": "webpack --config webpack.extension.config.js --watch",
    "build:all": "npm run build && npm run build:ext"
  }
}
```

| Script | Uso |
|--------|-----|
| `npm run build:ext` | Genera `dist-extension/` una vez |
| `npm run build:ext:watch` | Regenera automáticamente al guardar cambios (para desarrollo) |
| `npm run build:all` | Build completo: Next.js + extensión |

---

## Paso 6: Agregar `dist-extension/` al `.gitignore`

```
# Extension build output
dist-extension/
```

El código fuente (legible) vive en `extension/` dentro de tu repo privado. El build (minificado) se genera y se publica, pero no se commitea.

---

## Flujo de desarrollo después del setup

```
1. Editas extension/scraper/jwt-extractor.js (código legible, con comentarios)
2. Corres: npm run build:ext
3. Se genera dist-extension/content.bundle.js (minificado, ilegible)
4. Para desarrollo local: cargas extension/ en chrome://extensions
5. Para publicar: cargas dist-extension/ en Chrome Web Store
```

Refactorizar, agregar features, debuggear — todo se hace sobre los archivos originales en `extension/`. El webpack config no se toca a menos que agregues un nuevo entry point (raro).

---

## Qué queda protegido y qué no

### Queda ilegible:
- Nombres de variables, funciones y clases
- Comentarios y documentación
- Estructura de archivos (9 archivos → 1)
- Lógica de flujo y orquestación

### Sigue visible (inevitable):
- Strings literales: selectores CSS (`table.table-titulos`), URLs, nombres de cookies (`PHPSESSID`)
- Llamadas a APIs de Chrome (`chrome.storage`, `chrome.runtime`)
- La estructura general del CausaPackage (los nombres de propiedades del JSON que se envía al server)

### Mitigación adicional para los strings:
- Mover selectores al remote config (tu servidor los envía, no están hardcodeados)
- Usar variables de entorno para URLs del servidor (no hardcodear `https://tu-dominio.com`)

---

## Checklist

- [ ] Instalar dependencias: `webpack`, `webpack-cli`, `terser-webpack-plugin`, `copy-webpack-plugin`
- [ ] Crear `webpack.extension.config.js` en la raíz
- [ ] Agregar exports a cada módulo del scraper
- [ ] Agregar imports a `content.js`
- [ ] Crear manifest.json de producción (sin localhost, con bundles)
- [ ] Agregar scripts `build:ext` y `build:ext:watch` al `package.json`
- [ ] Agregar `dist-extension/` al `.gitignore`
- [ ] Probar: `npm run build:ext` y verificar que `dist-extension/` se genera
- [ ] Cargar `dist-extension/` en Chrome y verificar que la extensión funciona igual
- [ ] Para publicar en Chrome Web Store: siempre usar `dist-extension/`, nunca `extension/`
