=== DATOS CAPTURADOS PARA PRUEBAS 4.15 ===
Fecha/hora de captura: 2026-02-28 19:25

---

## Datos extraídos (listos para variables)

### 1) COOKIES (solo PHPSESSID + TS01262d1d para pruebas)
```
PHPSESSID=f28d2386f82807ab947f6b8078cfe49e; TS01262d1d=01b485afe576ca159ebfb5a088fbfd7d0bff8d458f7c7da41f261ddd9c5d76d5f7afc14cfbec883d706f70278f9d42c3d324b2838c82e5611d2cb45af6ffbb25c2684e432f
```

### 2) JWT_CAUSA (para causaCivil.php)
```
eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwczpcL1wvb2ZpY2luYWp1ZGljaWFsdmlydHVhbC5wanVkLmNsIiwiYXVkIjoiaHR0cHM6XC9cL29maWNpbmFqdWRpY2lhbHZpcnR1YWwucGp1ZC5jbCIsImlhdCI6MTc3MjMxNjg5MywiZXhwIjoxNzcyMzIwNDkzLCJkYXRhIjoiM1JyOTlNcFlJdkNYZUFzZ2RIbzFNa2dIN0thTjdmRTZieTZzRkFOV0QwMVwvQ1wvVHRkMkNVMzQrZDErQW05M0hFVTZvVmt2Z09OVCtrMlBPa0t4dEFWUW5UTHFyOWdhRnpGNHZcL09pbXV2V1FNdzY3NUNUcU11OGZMMWN4azhTVTRsRWt6R2pBeFhocmZUSzNYcmdxWm5oT0YzTnZueTExMDZSMXRHUUJDWlVNPSJ9.g-XBhn7qn8UsvxwdHP0l9G8mRIIbz7Nwu_7yqf2cLEU
```

### 3) CSRF_TOKEN
```
dc977b44695cf46f83a66801ee30bd9a
```

### 4) JWT_PDF (para docuS.php)
```
eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwczpcL1wvb2ZpY2luYWp1ZGljaWFsdmlydHVhbC5wanVkLmNsIiwiYXVkIjoiaHR0cHM6XC9cL29maWNpbmFqdWRpY2lhbHZpcnR1YWwucGp1ZC5jbCIsImlhdCI6MTc3MjMxNjg5NiwiZXhwIjoxNzcyMzIwNDk2LCJkYXRhIjoiTVFLS3ViaUU2XC93b3V6TEllOWRGXC9Ed2I0YXB0ODBBMWpGdWNQYWdTYk1UVlNaWmxjb2tXUkdiRGtlZFJudkVWTUNBUTdDOEU3VXpuVFVtTlBUTEQ4MmE5SzN3ZHJHckhmR3ppZVJFMFFBNWpCS2xaKzVBSjliRDQ1WXllQXhPU1o5Vlg0cEdLUkhDc013Z3RxdVp1cUE9PSJ9.4-pq_fZYJ3MZI7enSf3sWPHOZLv8tMNxRLJ7llfnIj0
```

---

## Resultados de pruebas — EJECUTADAS 2026-02-28 22:33

### Hallazgo crítico: F5 WAF bloquea curl por defecto
Sin `User-Agent` y `Referer` de navegador → **403 Forbidden**. Con esos headers → OK.

### Prueba A: PDF endpoint CON cookies
- **Estado:** ✅ OK (con User-Agent Chrome + Referer)
- Archivo: `prueba_A_ua.pdf` — PDF válido descargado

### Prueba B: PDF endpoint SIN cookies — JWT autosuficiente
- **Estado:** ✅ OK
- **Conclusión:** El JWT es autosuficiente. No requiere cookies para descargar PDFs.
- Archivo: `prueba_B.pdf` — PDF válido descargado
- **Impacto arquitectura 4.17:** API proxy pura — el server puede descargar PDFs directo con solo JWT + headers (User-Agent + Referer).

### Prueba C: POST a causaCivil.php con JWT + CSRF + cookies
- **Estado:** ✅ OK
- Archivo: `prueba_C.html` — HTML completo del modal (~19KB) con ROL C-1-2025, tabla folios, selCuaderno
- Requiere: cookies PHPSESSID + JWT + CSRF token + headers

---

## Documentación adicional (Kanban 4.15)

### Tiempos de expiración JWT
- **Observado:** ~1 hora desde emisión. Verificado en payload de los JWTs capturados:
  - JWT_PDF: `iat`=1772316896, `exp`=1772320496 → **3600 s = 1 h**
  - JWT_CAUSA: `iat`=1772316893, `exp`=1772320493 → **3600 s = 1 h**
- **Implicación:** La extensión (4.16) debe extraer JWTs justo antes del sync. El API (4.17) debe ejecutar el pipeline completo dentro de esa ventana. No cachear JWTs en el servidor.

### Comportamiento token CSRF
- Se obtiene del DOM del modal (input hidden o script). Se envía como parámetro `token` en el POST a causaCivil.php, separado del JWT.
- **Probado:** Un token funcionó correctamente para un POST a causaCivil.php. No se verificó si cambia entre requests de la misma sesión.
- **Recomendación:** Extraer el CSRF del DOM en el momento de la request, como hace el JWT Extractor (4.16).

### Cookie F5 WAF (TS01262d1d)
- La cookie `TS01262d1d` es parte del F5 WAF. Sin headers de navegador (User-Agent + Referer) → **403 Forbidden** aunque el JWT sea válido.
- **Implicación para 4.17:** Todas las requests a PJUD deben incluir:
  - `User-Agent: Mozilla/5.0 ... Chrome/...`
  - `Referer: https://oficinajudicialvirtual.pjud.cl/indexN.php`
- Las cookies PHPSESSID y TS01262d1d son necesarias **solo** para el POST a causaCivil.php (Prueba C). Las descargas PDF (docuS.php) funcionan sin ellas (Prueba B).

---

## Comandos para futuras pruebas (Git Bash o PowerShell)

**Headers obligatorios para evitar 403 WAF:**
```
-A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
-H "Referer: https://oficinajudicialvirtual.pjud.cl/indexN.php"
```

**Prueba A (PDF con cookies):**
```bash
curl.exe -A "Mozilla/5.0 ..." -H "Referer: https://oficinajudicialvirtual.pjud.cl/indexN.php" -b "PHPSESSID=xxx; TS01262d1d=xxx" -o prueba_A.pdf "https://oficinajudicialvirtual.pjud.cl/ADIR_871/civil/documentos/docuS.php?dtaDoc=JWT"
```

**Prueba B (PDF sin cookies):**
```bash
curl.exe -A "Mozilla/5.0 ..." -H "Referer: ..." -o prueba_B.pdf "https://oficinajudicialvirtual.pjud.cl/ADIR_871/civil/documentos/docuS.php?dtaDoc=JWT"
```

**Prueba C (causaCivil.php):**
```bash
curl.exe -A "Mozilla/5.0 ..." -X POST -b "PHPSESSID=xxx; TS01262d1d=xxx" -H "Content-Type: application/x-www-form-urlencoded" -H "X-Requested-With: XMLHttpRequest" -H "Origin: https://oficinajudicialvirtual.pjud.cl" -H "Referer: https://oficinajudicialvirtual.pjud.cl/indexN.php" -d "dtaCausa=JWT&token=CSRF" -o prueba_C.html "https://oficinajudicialvirtual.pjud.cl/ADIR_871/civil/modal/causaCivil.php"
```