# Próximas Features: Búsqueda de Jurisprudencia con IA

## Contexto

Existen múltiples apps en el mercado chileno que prometen buscar jurisprudencia y citar sentencias específicas usando IA:

- **BaseJurisprudencial.cl** — +500K sentencias indexadas, búsqueda semántica gratuita.
- **Leyer** — +1M sentencias, planes desde gratuito hasta Pro ($37.990/mes).
- **Jurispeed** — Asistente conversacional sobre jurisprudencia verificada.
- **LEXIUS Chile** — +4.8M sentencias actualizadas diariamente.
- **JusticeNow** — Asistente legal IA para abogados en Chile.
- **Sentent-IA** — Búsqueda de jurisprudencia con IA.
- Y al menos 4-5 apps más con propuestas similares.

## Estado actual de MVP Legal

La app **ya busca jurisprudencia en tiempo real** mediante:

1. **Gemini (Google Search Grounding)** — Se activa automáticamente cuando el usuario menciona keywords como "jurisprudencia", "corte suprema", "sentencia de", etc. (`src/lib/ai/config.ts`).
2. **Claude (Web Search Tool)** — Búsqueda web en modos `full_analysis` y `deep_thinking`.
3. **Reglas de transparencia** — Distinguen entre información del expediente vs. jurisprudencia web, con advertencias cuando proviene de conocimiento de entrenamiento (`src/lib/ai/prompts/provider-instructions.ts`).
4. **Infraestructura RAG completa** — Embeddings (Gemini 768D), búsqueda híbrida (vector + BM25), pipeline de procesamiento de documentos.

## Ventaja competitiva actual

El **scraper de PJUD** sigue siendo una ventaja significativa porque permite **cruzar jurisprudencia con el expediente específico del usuario**: "dado lo que dice TU expediente, esta jurisprudencia de la CS aplica a TU caso porque...". Las apps de la competencia no tienen acceso al expediente del abogado.

---

## Opciones de implementación

### Opción A: Potenciar lo que ya existe

**Dificultad:** Baja
**Tiempo estimado:** 1-2 semanas
**Costo:** Solo desarrollo

#### Qué implica

- Crear una sección dedicada "Buscar Jurisprudencia" en la UI (no solo dentro del chat de una causa).
- Un prompt especializado que fuerce al modelo a buscar, citar ROL, tribunal, fecha, y enlazar la fuente.
- Permitir búsqueda de jurisprudencia **sin necesidad de tener una causa abierta** (hoy el chat está atado a un caso).
- Mejorar la presentación de resultados (agrupar por tribunal, mostrar relevancia, etc.).

#### Ventajas

- Rápido de implementar, ya se tiene casi todo.
- Iguala a la mayoría de las ~10 apps del mercado inmediatamente.
- Sin costos adicionales de infraestructura.

#### Limitaciones

- Resultados inconsistentes, depende de qué indexe Google.
- No se puede filtrar por tribunal/fecha/materia de forma confiable.
- No hay control sobre la calidad ni completitud de las sentencias encontradas.

---

### Opción B: Corpus propio masivo de sentencias

**Dificultad:** Media-Alta
**Tiempo estimado:** 1-3 meses
**Costo:** Infraestructura + storage + embeddings

#### Qué implica

1. **Obtener sentencias** — Scraping del Portal Unificado de Sentencias del PJUD (`basejurisprudencial.pjud.cl`) o usar APIs de terceros (Khipu Open Data, APIs-Chile).
2. **Procesarlas** — Extraer texto de PDFs (ya se tiene `pdf-parse` y Document AI).
3. **Chunking + Embeddings** — Usar el pipeline RAG existente con tablas paralelas (ej. `jurisprudence_chunks`, `jurisprudence_embeddings`).
4. **Búsqueda híbrida** — Crear funciones RPC análogas a `match_case_chunks_vector` y `match_case_chunks_text` para jurisprudencia.
5. **Actualización continua** — Cron job que indexe sentencias nuevas periódicamente.

#### Fuentes de datos disponibles

- **Portal Unificado de Sentencias del PJUD** — Acceso público.
- **Scraping** — Existe repo público de referencia (`luisesanmartin/chile-judiciary-scraping`, Python).
- **API Khipu Open Data** — Endpoints para consultar causas por RUT (persona natural/jurídica), autenticación JWT/API Key.
- **API APIs-Chile** — Servicio asincrónico con webhook, requiere contactar proveedor para API Key.

#### Desafíos reales

- **Volumen**: 500K+ sentencias × ~10 páginas promedio = millones de chunks. Embeddings 768D en Supabase es viable pero el costo crece.
- **Scraping frágil**: El PJUD no tiene API oficial robusta. Requiere mantenimiento constante.
- **Almacenamiento**: Un corpus de 10M de documentos con embeddings 1024D requiere ~40GB solo en vectores.
- **Tiempo de indexación inicial**: Procesar 500K+ PDFs es un trabajo de semanas incluso con paralelización.

#### Ventajas

- Control total sobre los datos y la calidad de resultados.
- Filtros precisos por tribunal, materia, fecha, ROL.
- Independencia de Google/búsqueda web.
- Diferenciador potente frente a competidores de Nivel 1.

#### Limitaciones

- Alto costo inicial de desarrollo y datos.
- Mantenimiento continuo del scraper y pipeline de indexación.
- Competir en volumen con LEXIUS (+4.8M) es difícil a corto plazo.

---

### Opción C: Enfoque híbrido inteligente (Recomendada)

**Dificultad:** Media
**Tiempo estimado:** 2-4 semanas
**Costo:** Moderado

#### Qué implica

1. **Búsqueda web como base** (ya existe) para cobertura amplia.
2. **Indexar jurisprudencia "caliente"**: Las sentencias que ya pasan por el sistema (cuando un usuario sube/sincroniza documentos que son sentencias), indexarlas en una tabla de jurisprudencia compartida (anonimizada).
3. **Consumir fuentes públicas clave**: Scrapear solo Corte Suprema y Cortes de Apelaciones del portal público, que son las más citadas (~50K-100K sentencias bien indexadas).
4. **Agentic routing**: El router decide si buscar en la base local primero, y si no encuentra, complementa con búsqueda web.

#### Arquitectura propuesta

```
Usuario pregunta sobre jurisprudencia
        │
        ▼
   Router Agentic
        │
        ├─► 1. Buscar en base local (RAG híbrido)
        │       └─ Si hay resultados relevantes → responder con citas precisas
        │
        └─► 2. Si no hay suficientes → búsqueda web (Gemini/Claude)
                └─ Sintetizar y citar fuentes externas
```

#### Ventajas

- Balance entre esfuerzo y resultado.
- La base local crece orgánicamente con el uso de la plataforma.
- 50K-100K sentencias bien indexadas ya son muy valiosas para abogados.
- Permite diferenciarse sin competir frontalmente en volumen con LEXIUS.
- Combina lo mejor de ambos mundos (precisión local + cobertura web).

#### Limitaciones

- La base local empieza pequeña y tarda en crecer.
- El scraping de CS/CA sigue siendo un punto de fragilidad.
- Requiere lógica de routing que puede ser compleja de afinar.

---

## Referencia técnica: Estado del arte en Legal RAG (2026)

### Papers y benchmarks relevantes

- **Legal-DC Benchmark** (marzo 2026) — Framework de evaluación para sistemas RAG legales. El framework LegRAG integra segmentación por cláusulas con mecanismos de auto-reflexión dual.
- **Legal RAG Bench** (marzo 2026) — Revela que el rendimiento de retrieval es el driver principal del éxito de sistemas RAG legales. Embeddings especializados como Kanon 2 Embedder muestran mejoras de 34 puntos en precisión de retrieval.

### Repos open-source de referencia

- **Legal-RAG** (GitHub, feb 2026) — Retrieval híbrido (FAISS + BM25) con ColBERT, routing por tipo de query, expansión de contexto con grafos.
- **LexReviewer** (GitHub, mar 2026) — Arquitectura agentic con LangGraph, RAG streaming con citation tracking, MongoDB + Qdrant.

### Mejores prácticas de chunking para documentos legales

- Chunks de **400-512 tokens con 10-20% de overlap** logran 85-90% recall en benchmarks.
- Chunking semántico (preservar límites de significado) mejora recall hasta 9% vs. chunking fijo.
- Embeddings especializados (Voyage-3-large) superan a OpenAI y Cohere en 9-20%.

---

## Resumen comparativo

| Enfoque | Dificultad | Tiempo | Costo infra | Resultado esperado |
|---------|-----------|--------|-------------|-------------------|
| A: Potenciar web search | Baja | 1-2 sem | Nulo | Iguala al 80% del mercado |
| B: Corpus propio masivo | Media-Alta | 1-3 meses | Alto | Compite con los líderes |
| C: Híbrido inteligente | Media | 2-4 sem | Moderado | Diferenciador real |

**Recomendación**: Empezar por la Opción A (rápido, ya se tiene casi todo) para igualar a la competencia de inmediato, y construir la Opción C en paralelo como diferenciador a mediano plazo.
