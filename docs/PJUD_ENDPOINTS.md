# PJUD Endpoints Map — Tarea 4.14

Fecha: 27/02/2026
Entry point: Consulta Unificada de Causas (MVP v1)

## Base URL

```
https://oficinajudicialvirtual.pjud.cl/
```

## 1. Endpoints de documentos (GET directo)

| Endpoint | Param | Tipo doc | Capturado en |
|----------|-------|----------|-------------|
| `ADIR_871/civil/documentos/docu.php` | `valorEncTxtDmda=JWT` | Texto Demanda | DOM2 |
| `ADIR_871/civil/documentos/docuS.php` | `dtaDoc=JWT` | Doc simple (resoluciones, certificados) | DOM2, DOM4 |
| `ADIR_871/civil/documentos/docuN.php` | `dtaDoc=JWT` | Doc normal (escritos, actuaciones receptor) | DOM2, DOM4, DOM6 |
| `ADIR_871/civil/documentos/docCertificadoDemanda.php` | `dtaCert=JWT` | Certificado envío demanda | DOM2 |
| `ADIR_871/civil/documentos/docCertificadoEscrito.php` | `dtaCert=JWT` | Certificado envío escrito | DOM2, DOM4 |
| `ADIR_871/civil/documentos/newebookcivil.php` | `dtaEbook=JWT` | Ebook causa completa | DOM2 |
| `ADIR_871/civil/documentos/anexoDocCivil.php` | `dtaDoc=JWT` | Anexo individual | DOM3 |

### Diferencia docuS vs docuN

- `docuS.php`: documentos "simples" — resoluciones del tribunal, certificados. Solo 1 form por folio.
- `docuN.php`: documentos "normales" — escritos de las partes, actuaciones de receptor. Puede tener 2 forms: doc principal + certificado de envío (`docCertificadoEscrito.php`).

## 2. Endpoints AJAX (modales y cambios dinámicos)

| Función JS | Endpoint | Método | Param | Respuesta | DOM |
|------------|----------|--------|-------|-----------|-----|
| `detalleCausaCivil(JWT)` | `ADIR_871/civil/modal/causaCivil.php` | POST | `dtaCausa=JWT&token=CSRF` | HTML modal completo | DOM2 |
| cambio `#selCuaderno` | `ADIR_871/civil/modal/causaCivil.php` | POST | `dtaCausa=JWT&token=CSRF` | HTML modal completo regenerado | DOM4 |
| `anexoCausaCivil(JWT)` | `ADIR_871/civil/modal/anexoCausaCivil.php` | POST | `dtaAnexCau=JWT` | HTML tabla anexos | DOM3 |
| `receptorCivil(JWT)` | `ADIR_871/civil/modal/receptorCivil.php` | POST | `valReceptor=JWT` | HTML tabla receptor | DOM5 |
| `detalleExhortosCivil(JWT)` | ? (no capturado) | ? | ? | HTML detalle exhorto | — |
| `detalleCausaApelaciones(JWT)` | ? (no capturado) | ? | ? | HTML detalle apelaciones | — |
| `geoReferencia(JWT)` | ? (no capturado, baja prioridad) | ? | ? | HTML/JS mapa | — |

### Observaciones

- `causaCivil.php` se usa tanto para abrir el modal inicial (DOM2) como para cambiar cuaderno (DOM4). Mismo endpoint, mismos parámetros. La respuesta siempre es el modal completo regenerado.
- `detalleExhortosCivil` y `detalleCausaApelaciones` fueron descubiertos en DOM4 pero sus endpoints no se capturaron. No son críticos para MVP v1.

## 3. Tabs (#loadHistCuadernoCiv)

Todas las tabs son **INLINE** (no AJAX). Vienen completas en la respuesta de `causaCivil.php`.

| Tab | ID | Carga | Datos reales en |
|-----|----|-------|-----------------|
| Historia | `#historiaCiv` | Inline | DOM2, DOM4 |
| Litigantes | `#litigantesCiv` | Inline | DOM4 |
| Notificaciones | `#notificacionesCiv` | Inline | DOM4 |
| Escritos por Resolver | `#escritosCiv` | Inline | DOM6 |
| Exhortos | `#exhortosCiv` | Inline | DOM4 |

### Columnas por tab

**Historia** (`#historiaCiv`):
Folio | Doc. | Anexo | Etapa | Trámite | Desc. Trámite | Fec. Trámite | Foja | Georref.

**Litigantes** (`#litigantesCiv`):
Participante | Rut | Persona | Nombre o Razón Social

**Notificaciones** (`#notificacionesCiv`):
ROL | Est. Notif. | Tipo Notif. | Fecha Trámite | Tipo Part. | Nombre | Trámite | Obs. Fallida

**Escritos por Resolver** (`#escritosCiv`):
Doc. | Anexo | Fecha de Ingreso | Tipo Escrito | Solicitante

**Exhortos** (`#exhortosCiv`):
Rol Origen | Tipo Exhorto | Rol Destino | Fecha Ordena Exhorto | Fecha Ingreso Exhorto | Tribunal Destino | Estado Exhorto

**Piezas Exhorto** (`#piezasExhortoCiv`) — SOLO tipo e:
Folio | Doc. | **Cuaderno** | Anexo | Etapa | Trámite | Desc. Trámite | Fec. Trámite | Foja

## 4. Secciones adicionales condicionales

### 4.1 Bloque "Piezas Exhorto" en metadata (solo tipo e)

Tercera tabla `table.table-titulos.wellTable` entre documentos directos y cuadernos.
Solo aparece en causas tipo e (Exhorto). Capturada en `DOM2-tipo-e.html`.

| Campo | Contenido |
|-------|-----------|
| Causa Origen | ROL de la causa original (ej: C-1915-2020). Link clickeable via `detalleCausaCivil(JWT)` |
| Tribunal Origen | Tribunal que ordenó el exhorto (ej: 1º Juzgado de Letras de Coyhaique) |

Nota: existe una función comentada `causaOrigenCivil(JWT)` → `#modalCausaOrigenCivil` (deshabilitada).
PJUD reutiliza `detalleCausaCivil()` en su lugar.

### 4.2 Tab "Piezas Exhorto" (solo tipo e)

6ta tab `#piezasExhortoCiv`. Estructura casi idéntica a `#historiaCiv` pero con columna **Cuaderno** 
adicional (posición 3). Muestra los folios de la causa origen remitidos al tribunal exhortado.

Endpoints de descarga: mismos `docuS.php` y `docuN.php`.
Targets de ventana: `exTraP[N]` (resoluciones) y `exTraW[N]` (escritos) — distintos a Historia (`p[N]`, `w[N]`).

### 4.3 Remisiones en la Corte (condicional, cualquier tipo)

Aparece cuando la causa tiene recursos ante Corte de Apelaciones. Descubierta en DOM4.

| Columna | Descripción |
|---------|-------------|
| Rol Corte | Clickeable: `detalleCausaApelaciones(JWT)` |
| Descripción del Trámite | ej: REMISION |
| Fecha Trámite | |

## 5. Tokens y seguridad

| Elemento | Valor/Comportamiento |
|----------|---------------------|
| JWT estructura | Header.Payload.Signature (HS256) |
| JWT expiración | ~1h (iat a exp = 3600s) |
| CSRF token | Parámetro `token` separado del JWT. Ej: `447597319b44e62175b7141372f560dd`. Se envía junto a `dtaCausa` en `causaCivil.php` |
| Cookie PHPSESSID | Sesión PHP del servidor. Requerida en todos los requests |
| Cookie TS01262d1d | Cookie F5 WAF (Web Application Firewall). Cambia entre sesiones |
| Cookie TSa2ac8a0a027 | Cookie adicional F5 WAF |
| Header X-Requested-With | `XMLHttpRequest` — identifica requests AJAX |
| Content-Type (POST) | `application/x-www-form-urlencoded; charset=UTF-8` |

## 6. Resumen de parámetros JWT por endpoint

| Endpoint | Nombre parámetro |
|----------|-----------------|
| `causaCivil.php` | `dtaCausa` |
| `anexoCausaCivil.php` | `dtaAnexCau` |
| `receptorCivil.php` | `valReceptor` |
| `docu.php` | `valorEncTxtDmda` |
| `docuS.php` | `dtaDoc` |
| `docuN.php` | `dtaDoc` |
| `docCertificadoDemanda.php` | `dtaCert` |
| `docCertificadoEscrito.php` | `dtaCert` |
| `newebookcivil.php` | `dtaEbook` |
| `anexoDocCivil.php` | `dtaDoc` |

## 7. Archivos de referencia DOM

| Archivo | DOM | Causa | Contenido |
|---------|-----|-------|-----------|
| `DOM1.html` | DOM1 | C-1-2025 BCI/MENA | Tabla resultados `#dtaTableDetalle` |
| `DOM2.html` | DOM2 | C-1-2025 BCI/MENA | Modal detalle `#modalDetalleCivil` (cuaderno Principal) |
| `DOM3.html` | DOM3 | C-100-2023 Lebu | Modal Anexos `#modalAnexoCausaCivil` |
| `DOM4.html` | DOM4 | C-100-2023 Lebu | Modal completo tras cambio cuaderno (Apremio Ejecutivo) + tabs con datos |
| `DOM5.html` | DOM5 | C-100-2023 Lebu | Modal Receptor `#modalReceptorCivil` |
| `DOM6.html` | DOM6 | C-50-2026 Cabrero | Tab Escritos por Resolver `#escritosCiv` con datos |
| `DOM2-tipo-e.html` | DOM2 (tipo e) | E-1-2023 Cochrane | Modal detalle tipo Exhorto + Piezas Exhorto (bloque metadata + 6ta tab) |

## 8. Verificación DOM2 por libro/tipo

Verificado el 27/02/2026 desde Consulta Unificada. 2 causas revisadas por tipo (mínimo).

### 8.1 Valores de Proc. por tipo

| Tipo | Letra ROL | Proc. observado |
|------|-----------|-----------------|
| c | C- | Ejecutivo Obligación de Dar |
| v | V- | Voluntario |
| e | E- | Exhorto |
| a | A- | Administrativo |
| i | I- | Exhorto Internacional |
| f | F- | DIFERIDO MVP v1.1 (solo Mis Causas) |

### 8.2 Metadata (primera table.table-titulos)

Los **8 campos** son idénticos en todos los tipos (c, v, e, a, i):
ROL, F.Ing., Est.Adm., Proc., Ubicación, Estado Proc., Etapa, Tribunal.

Al cambiar cuaderno en tipo c: el valor de **Etapa** cambia, **Proc.** no cambia.

### 8.3 Documentos directos (segunda table.table-titulos)

Los 5 `<td>` (Texto Demanda, Anexos, Certificado, Ebook, Info Receptor) **siempre existen** en el HTML 
para todos los tipos. Lo que varía es el contenido de cada `<td>`:

- **Documento disponible:** `<form>` con JWT + ícono `fa-file-pdf-o` (rojo)
- **Modal disponible:** `<a onclick="...">` + ícono `fa-folder-open` o `fa-folder` (amarillo)
- **No disponible:** `<i class="fa fa-ban">` con `style="color:#660000; cursor:no-drop;"` (sin link)

| Elemento | c | v | e | a | i |
|----------|---|---|---|---|---|
| Texto Demanda | form | form | form | form o ban* | form |
| Anexos de la causa | form | form | ban | ban | ban |
| Certificado de Envío | form | form | ban | ban | ban |
| Ebook | form | form | form | form | form |
| Info Receptor | link | link | link | link | link |

*Tipo a: Texto Demanda puede no tener form (ícono ban) en causas que no nacen de una demanda.

**Implicación para 4.16:** El extractor no necesita routing por tipo para documentos directos. 
Para cada `<td>`: buscar `<form>` → si existe, extraer JWT. Si no, buscar `<a onclick>`. 
Si encuentra `fa-ban` → skip. Cualquier elemento puede estar ausente en cualquier tipo.

### 8.4 Cuadernos (#selCuaderno)

Siempre existe en todos los tipos. En las causas revisadas, solo tipo c tenía múltiples cuadernos. 
Otros tipos tenían 1 cuaderno. Esto puede variar según la causa.

### 8.5 Tabs

Las mismas 5 tabs en todos los tipos: Historia, Litigantes, Notificaciones, Escritos por Resolver, Exhortos.

**Excepción tipo e:** Aparece una **6ta tab** `#piezasExhortoCiv` ("Piezas Exhorto") + un bloque 
extra `table.table-titulos.wellTable` en la metadata con Causa Origen y Tribunal Origen.
Detalle completo en sección 4.1 y 4.2. HTML capturado en `DOM2-tipo-e.html`.

### 8.6 Sección Remisiones en la Corte

No depende del tipo — aparece condicionalmente cuando la causa tiene trámites en Corte de Apelaciones.
- Observada en tipo c (C-100-2023 Lebu, DOM4.html)
- No observada en v, e, a, i en las causas revisadas (no tenían remisiones)

### 8.7 Hallazgos adicionales por tipo

**Tipo e (Exhorto):**
- Bloque "Piezas Exhorto" en metadata: tercera `table.table-titulos.wellTable` con Causa Origen y Tribunal Origen.
- 6ta tab `#piezasExhortoCiv`: tabla con columnas Folio|Doc.|Cuaderno|Anexo|Etapa|Trámite|Desc.Trámite|Fec.Trámite|Foja.
  Descarga vía `docuS.php`/`docuN.php`. Targets de ventana: `exTraP[N]` y `exTraW[N]`.
- Función deshabilitada: `causaOrigenCivil(JWT)` → `#modalCausaOrigenCivil` (PJUD usa `detalleCausaCivil()` en su lugar).
- HTML capturado en `DOM2-tipo-e.html`.

**Tipo i (Exhorto Internacional):**
- Tab Litigantes puede tener datos atípicos: Participante="otro", Rut="0-0" 
  (observado en I-1-2026 STOCKMEIER Y CHAMBERGO/LAT). El extractor debe tolerar estos valores.

**Tipo a (Administrativo):**
- Texto Demanda puede no existir (ícono ban). El extractor debe manejar su ausencia.
