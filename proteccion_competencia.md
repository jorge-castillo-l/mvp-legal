# Protección de Código y Propiedad Intelectual — Plan de Acción

## 1. Protección técnica del código

### Web App (Next.js en Vercel) — Protegida por defecto

- El código server-side (API routes, prompts, RAG pipeline, lógica de sync) **no es visible** para usuarios.
- **NO activar** `productionBrowserSourceMaps` en `next.config`.
- **NO desactivar** "Build Logs and Source Protection" en Vercel settings.

### Extensión de Chrome — Código visible

El código de la extensión es visible para cualquiera que la instale (los `.crx` son ZIPs inspeccionables).

**Mitigaciones:**

- [ ] Minificar y bundlear con webpack/rollup (convertir 9 archivos en 1 archivo minificado).
- [ ] Mover toda la lógica sensible al servidor. La extensión debe ser "tonta": solo captura datos y los envía al backend.
- [ ] No ofuscar — Chrome Web Store lo prohíbe. Solo minificación permitida.

### GitHub

- [ ] Usar repositorio **privado**. No hay razón para que sea público.
- [ ] Habilitar GitHub Secret Protection para prevenir leaks de credenciales.
- [ ] Nunca commitear `.env`, API keys, ni credenciales.

---

## 2. Registro de marca (INAPI)

**Urgencia: Alta — hacerlo antes del lanzamiento público.**

| Paso | Detalle |
|------|---------|
| Presentar solicitud | Online en [inapi.cl](https://www.inapi.cl) |
| Pago inicial | 1 UTM (~$66.000 CLP) |
| Publicación Diario Oficial | $7.000 - $20.000 CLP |
| Pago final | 2 UTM por clase (~$132.000 CLP) |
| **Costo total sin abogado** | **~$200.000 - $220.000 CLP** |
| **Costo total con asesoría** | **~$330.000 CLP** |
| Plazo estimado | 6 - 8 meses |

**Clases Niza relevantes:**

- **Clase 9**: Software como producto.
- **Clase 42**: Servicios de diseño y desarrollo de software, SaaS.
- **Clase 45**: Servicios jurídicos (evaluar si aplica).

Un abogado de propiedad intelectual puede confirmar qué clases son necesarias.

---

## 3. Registro de software (Derechos de Autor)

**Dónde:** Departamento de Derechos Intelectuales (DDI) — [propiedadintelectual.gob.cl](https://www.propiedadintelectual.gob.cl)

El código ya está protegido automáticamente por la **Ley 17.336** desde su creación. El registro formal aporta prueba de autoría y fecha.

**Documentos necesarios:**

- [ ] Copia del código fuente (al menos el server-side: prompts, RAG, pipeline).
- [ ] Manual de funcionamiento del programa.
- [ ] Declaración jurada de quiénes participaron en la creación.
- [ ] Copia de licencias de terceros usadas en el desarrollo.

**Duración de la protección:** Vida del autor + 70 años, o 70 años desde primera publicación si es de empresa.

---

## 4. Patente — No aplica

En Chile el software y los algoritmos **no se pueden patentar** (INAPI). Solo se protegen vía derechos de autor.

---

## 5. Checklist pre-deploy

- [ ] GitHub configurado como repositorio privado
- [ ] Source maps desactivados en producción
- [ ] Extensión minificada y bundleada
- [ ] Lógica sensible del scraper migrada al servidor
- [ ] Solicitud de registro de marca presentada en INAPI
- [ ] Solicitud de registro de software presentada en DDI
- [ ] `.env` y credenciales en `.gitignore`
