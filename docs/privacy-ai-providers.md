# Privacy & Data Controls — AI Providers

**Tarea:** 2.02  
**Última verificación:** 27 marzo 2026  
**Objetivo:** Proteger el privilegio abogado-cliente en ambos proveedores de IA.

---

## Google — Gemini API (Capa 1: Chat Rápido)

**Modelo:** gemini-3-flash-preview  
**Variable:** `GOOGLE_API_KEY`  
**Proyecto:** Default Gemini Project (gen-lang-client-0551921260)

### Data usage para training

| Tier | ¿Usa datos para mejorar productos? |
|------|-------------------------------------|
| Gratuito | Sí |
| Pagado (billing vinculado, mín. $10 USD) | **No** |

**Acción requerida:** Confirmar que la API key está vinculada a una cuenta de facturación (paid tier). En paid tier, Google **no usa prompts ni respuestas** para entrenar o mejorar modelos.

**Estado:** Confirmado en paid tier (27 marzo 2026).

### Logging de prompts

Google AI Studio ofrece una funcionalidad de "Logs and Datasets" que registra las llamadas a la API para debugging y creación de datasets.

**Estado actual:** Logging **deshabilitado** para el proyecto `gen-lang-client-0551921260`. La página de logs (https://aistudio.google.com/logs) muestra el botón "Enable" — lo que confirma que no se está registrando ningún prompt.

**Acción:** No presionar "Enable". Dejar el logging deshabilitado.

### Retención para abuse monitoring

Google retiene prompts por **55 días** exclusivamente para detección de abuso (policy enforcement). Esta retención:
- Es obligatoria e independiente de la configuración de logging
- **No se usa** para entrenar ni fine-tunear modelos
- No es accesible desde el dashboard del usuario
- Aplica tanto al tier gratuito como al pagado

### Google Search Grounding

Cuando se activa `googleSearchRetrieval` para queries de jurisprudencia, las búsquedas pasan por Google Search. Las queries no se almacenan asociadas a la cuenta de API. Gratis hasta 5K-45K queries/mes según tier.

---

## Anthropic — Claude API (Capas 2 y 3: Análisis Completo / Pensamiento Profundo)

**Modelos:** claude-sonnet-4-6 (Capa 2), claude-opus-4-6 (Capa 3)  
**Variable:** `ANTHROPIC_API_KEY`  
**Consola:** https://console.anthropic.com/ → Settings → Data and Privacy

### Data usage para training

Anthropic **no usa datos enviados via API comercial** para entrenar modelos. Esto es el comportamiento por defecto, sin necesidad de configuración adicional.

La única excepción es el **Development Partner Program** (opt-in explícito). Ver sección abajo.

### Data retention

| Configuración | Período |
|---------------|---------|
| Actual | **30 días** |
| Mínimo configurable | 30 días |
| Para reducir a menos de 30d | Requiere Zero Data Retention (contactar sales) |

**Estado actual:** Retención de 30 días configurada. Inputs y outputs se eliminan automáticamente tras ese período.

### Allow user feedback

Toggle que permite enviar feedback sobre respuestas del modelo a Anthropic. Los reportes incluyen prompt completo + respuesta + feedback.

**Estado actual:** **Desactivado** (switch OFF). Correcto para proteger privilegio abogado-cliente.

### Development Partner Program

Programa voluntario donde se comparten sesiones de Claude Code con Anthropic para entrenamiento a cambio de descuentos (hasta 30% en input tokens).

**Estado actual:** **No inscrito** (botón "Join" visible, no presionado). Correcto — si se une, los datos compartidos no se pueden eliminar retroactivamente.

**Acción:** No unirse. Los datos de expedientes judiciales no deben usarse para training.

### Claude Code metrics logging

Toggle que habilita recolección de métricas de uso de Claude Code.

**Estado actual:** **Activado** (switch ON). Esto solo aplica a Claude Code (terminal), no a la API de mensajes que usa nuestra aplicación. No impacta la privacidad de los datos de expedientes.

**Acción opcional:** Desactivar si se desea máxima restricción. No es crítico para el MVP.

### Web Search Tool

Habilitado para la organización. Permite que las API keys usen la herramienta de búsqueda web de Claude.

**Estado actual:**
- Web search: **Habilitado** (botón "Disable" visible)
- Domain restrictions: **No restrictions**

**Nota sobre ZDR:** El Web Search Tool con dynamic filtering no es ZDR-compatible. Si en el futuro se activa Zero Data Retention, se deberá configurar `allowed_callers: ['direct']` en el código o deshabilitar dynamic filtering. Para el MVP con retención estándar de 30 días, la configuración actual es adecuada.

### Citations API

Compatible con ZDR sin restricciones. No requiere configuración adicional.

---

## Resumen de estado

| Control | Google (Gemini) | Anthropic (Claude) |
|---------|-----------------|---------------------|
| Datos usados para training | No (paid tier confirmado) | No (API comercial) |
| Logging de prompts | Deshabilitado | N/A (no existe toggle equivalente) |
| Retención | 55 días (abuse only) | 30 días |
| User feedback / data sharing | N/A | Desactivado |
| Development Partner Program | N/A | No inscrito |
| Zero Data Retention | No disponible | No activado (requiere contrato) |
| Web search | Grounding habilitado | Habilitado, sin restricciones de dominio |

## Acciones pendientes

- [x] Confirmar que `GOOGLE_API_KEY` está en paid tier — Confirmado 27/03/2026
- [x] Logging de prompts deshabilitado en Google AI Studio — Confirmado 27/03/2026
- [x] User feedback desactivado en Anthropic — Confirmado 27/03/2026
- [x] Development Partner Program no inscrito — Confirmado 27/03/2026
- [ ] Revisar si se desea desactivar "Claude Code metrics logging" (bajo impacto)
- [ ] Evaluar activación de ZDR con Anthropic cuando haya clientes enterprise
