# Evaluación de Riesgos y Estrategia: IA en el Poder Judicial Chileno

**Fecha de Informe:** 05 de febrero de 2026  
**Contexto:** Integración de Inteligencia Artificial en el PJud y su impacto en el MVP Legal-Tech.

---

## 1. Estado del Arte (Febrero 2026)
A día de hoy, el Poder Judicial de Chile ha consolidado su infraestructura de IA, lo que redefine la competencia para cualquier solución privada:

* **Buscador Jurisprudencial con IA:** Motor semántico oficial que entiende contexto jurídico en más de 1.5 millones de fallos.
* **Transcripción y Traducción:** Sistemas operativos en tribunales locales (ej. Mulchén) para agilizar actas.
* **Marco Ético-Sancionatorio:** Los tribunales están penalizando activamente el uso negligente de IA generativa (alucinaciones) por parte de abogados.

---

## 2. Análisis de Impacto en el MVP (Kanban PJCCIA)

Basado en el archivo `Kanban PJCCIA.csv`, se identifican los siguientes puntos críticos:

### A. El Riesgo de "Funcionalidad Nativa" (Tareas 9 y 11)
* **Situación:** Tu "Buscador Semántico" compite directamente con la herramienta gratuita del Estado.
* **Estrategia:** Desplazar el valor desde la *búsqueda* hacia la *estrategia*. Tu MVP no debe ser un buscador de leyes, sino un **analista de expedientes privados**. El PJud ofrece datos públicos; tú ofreces inteligencia sobre los documentos privados del cliente.

### B. Vulnerabilidad del Scraper (Bloque 04)
* **Situación:** La modernización del PJud suele venir con protecciones (WAF, CAPTCHAs avanzados, cambios de DOM).
* **Estrategia:** La **Tarea 6 (Direct Upload API)** es ahora de prioridad crítica. El sistema debe funcionar perfectamente aunque el scraping falle, permitiendo al abogado subir el PDF manualmente.

### C. Riesgo Legal y Reputacional (Tarea 12 y 13)
* **Situación:** El "Editor de Escritos" podría generar citas falsas. En 2026, esto conlleva sanciones disciplinarias en Chile.
* **Estrategia:** Implementar un **"Verificador de Citas"**. Si la IA sugiere un fallo, el sistema debe intentar buscarlo en el API/Web del PJud y marcarlo como "Verificado" o "No encontrado".

---

## 3. Matriz de Mitigación

| Tarea Kanban | Riesgo | Acción Mitigadora |
| :--- | :--- | :--- |
| **4.01 Scraper** | Bloqueo por PJud | Implementar rotación de User-Agents y fallback de carga manual. |
| **1.03 Auth** | Privacidad de datos | Reforzar que los datos no se usan para entrenamiento (Vertex AI Privacy Config). |
| **2.01 Storage** | Costos/Retención | Mantener la política de "The Reaper" (Tarea 22) para usuarios Free para mitigar riesgos de datos antiguos. |
| **5.01 Editor** | Alucinaciones | Disclaimer dinámico: "Esta cita no ha sido validada contra la base oficial". |

---

## 4. Apéndice: Disclaimer Sugerido para Tarea 18 (Privacy Consent)

> **AVISO DE RESPONSABILIDAD PROFESIONAL (LEY CHILE 2026):**
> Esta herramienta utiliza Inteligencia Artificial como asistencia técnica. De acuerdo a los recientes lineamientos de la Corte Suprema de Chile, la responsabilidad por el contenido de los escritos presentados ante tribunales recae exclusivamente en el abogado firmante. El usuario declara conocer que el sistema puede generar errores ("alucinaciones") y se compromete a verificar toda cita jurisprudencial o normativa antes de su uso procesal.

---

*Este documento es una guía estratégica basada en el estado actual de la justicia digital en Chile.*
