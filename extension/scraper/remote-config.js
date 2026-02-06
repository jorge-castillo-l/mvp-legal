/**
 * ============================================================
 * REMOTE CONFIG MANAGER
 * ============================================================
 * SOLUCIÓN AL "CICLO DE LA MUERTE" (Vulnerabilidad 4.1)
 * 
 * En lugar de hardcodear selectores CSS en la extensión (que requiere
 * revisión de Google para cada actualización), los selectores se
 * almacenan en el servidor y se descargan dinámicamente.
 * 
 * Cuando PJud cambia su DOM:
 *   1. Detectamos el fallo (monitoreo automático o reporte de usuario)
 *   2. Actualizamos el JSON en el servidor (segundos)
 *   3. TODAS las extensiones reciben los selectores nuevos (minutos)
 *   4. Sin revisión de Chrome Store. Sin espera de 4 días.
 * 
 * Fallback: Si el servidor no responde, usa la última config cacheada
 *           en chrome.storage.local. Si no hay cache, usa defaults
 *           hardcodeados como último recurso.
 * ============================================================
 */

// En producción, cambiar a la URL del servidor desplegado
const SCRAPER_CONFIG_ENDPOINT = 'http://localhost:3000/api/scraper/config';
const CONFIG_CACHE_KEY = 'legalbot_scraper_config';
const CONFIG_CACHE_TS_KEY = 'legalbot_scraper_config_ts';
const CONFIG_TTL_MS = 30 * 60 * 1000; // 30 minutos de cache

class RemoteConfig {
  constructor() {
    this.config = null;
    this.lastFetch = 0;
  }

  /**
   * Obtiene la configuración del scraper con fallback en 3 niveles:
   * 1. Cache en memoria (si no expiró)
   * 2. Servidor remoto (fetch fresco)
   * 3. Cache en chrome.storage.local (offline)
   * 4. Defaults hardcodeados (último recurso)
   */
  async getConfig() {
    // Nivel 1: Cache en memoria (más rápido)
    if (this.config && (Date.now() - this.lastFetch) < CONFIG_TTL_MS) {
      return this.config;
    }

    // Nivel 2: Servidor remoto
    try {
      const response = await fetch(SCRAPER_CONFIG_ENDPOINT, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000), // Timeout de 5s
      });

      if (response.ok) {
        this.config = await response.json();
        this.lastFetch = Date.now();

        // Guardar en cache persistente
        await this._saveToCache(this.config);
        console.log('[RemoteConfig] Config obtenida del servidor v' + this.config.version);
        return this.config;
      }
    } catch (error) {
      console.warn('[RemoteConfig] Servidor inaccesible, usando cache local:', error.message);
    }

    // Nivel 3: Cache persistente en chrome.storage.local
    const cached = await this._loadFromCache();
    if (cached) {
      this.config = cached;
      console.log('[RemoteConfig] Usando config cacheada v' + this.config.version);
      return this.config;
    }

    // Nivel 4: Defaults hardcodeados (siempre funciona)
    console.warn('[RemoteConfig] Sin cache, usando defaults hardcodeados');
    this.config = this.getDefaultConfig();
    return this.config;
  }

  /**
   * Forzar actualización de config (útil tras detectar un fallo)
   */
  async forceRefresh() {
    this.lastFetch = 0;
    this.config = null;
    return this.getConfig();
  }

  /**
   * Configuración por defecto - ÚLTIMA LÍNEA DE DEFENSA
   * Estos selectores se mantienen como respaldo hardcodeado.
   * Se basan en la estructura conocida de pjud.cl a Febrero 2026.
   */
  getDefaultConfig() {
    return {
      version: '1.0.0-default',
      updatedAt: new Date().toISOString(),

      // === SELECTORES CSS ===
      // Múltiples alternativas por elemento (prioridad descendente)
      selectors: {
        // Tabla principal de causas/documentos
        causaTable: [
          '#gridDatos',
          '.tabla-causas',
          'table.dataTable',
          '#tblDatos',
          'table.table-striped',
          'table[summary*="causa"]',
          'table',
        ],
        // Links/botones de descarga de documentos
        downloadLink: [
          'a[href*=".pdf"]',
          'a[onclick*="download"]',
          'a[onclick*="descarga"]',
          'a[onclick*="Descarga"]',
          'a[onclick*="verDocumento"]',
          'a[onclick*="abrirDocumento"]',
          '.btn-descarga',
          'a.descarga',
          'a[title*="Descargar"]',
          'a[title*="Ver documento"]',
          'button[onclick*="download"]',
        ],
        // Filas de documentos dentro de la tabla
        documentRow: [
          'tr.causa-row',
          'tr[data-id]',
          'tbody tr',
        ],
        // Campo de ROL de la causa
        rolField: [
          '#rolCausa',
          '#txtRol',
          '.rol-causa',
          'input[name="rol"]',
          'input[name*="Rol"]',
        ],
        // Botón de búsqueda
        searchButton: [
          '#btnBuscar',
          '#btnConsulta',
          '#btnBuscarCausa',
          'input[type="submit"]',
          'button[type="submit"]',
        ],
      },

      // === PATRONES DE URL PARA PDFs ===
      // Usados por el Network Interceptor para detectar respuestas PDF
      pdfUrlPatterns: [
        /\.pdf/i,
        /download/i,
        /documento/i,
        /escrito/i,
        /resoluc/i,
        /getDocumento/i,
        /obtenerArchivo/i,
        /visorDocumento/i,
      ],

      // Content-Types que indican PDF
      pdfContentTypes: [
        'application/pdf',
        'application/octet-stream',
        'application/x-pdf',
      ],

      // === HEURÍSTICAS PARA ANÁLISIS INTELIGENTE ===
      heuristics: {
        // Palabras clave en elementos descargables
        downloadKeywords: [
          'descargar', 'download', 'pdf', 'documento', 'escrito',
          'resolución', 'auto', 'sentencia', 'ver', 'abrir',
          'expediente', 'notificación', 'actuación',
        ],
        // Palabras clave en tablas de causas
        tableKeywords: [
          'ROL', 'Causa', 'Carátula', 'Tribunal', 'Fecha',
          'Tipo', 'Estado', 'Documento', 'Cuaderno', 'Folio',
        ],
        // Selectores de iconos de descarga
        iconSelectors: [
          '.fa-download',
          '.fa-file-pdf',
          '.fa-file-pdf-o',
          '[class*="download"]',
          '[class*="pdf"]',
          'img[src*="pdf"]',
          'img[src*="download"]',
          'img[alt*="descargar"]',
          'img[alt*="PDF"]',
        ],
        // Peso mínimo de confianza para intentar descarga (0-1)
        minConfidenceThreshold: 0.35,
      },

      // === CONFIGURACIÓN ANTI-WAF (Throttle Humano) ===
      throttle: {
        minDelayMs: 2500,      // Mínimo entre acciones (ms)
        maxDelayMs: 7000,      // Máximo entre acciones (ms)
        maxConcurrent: 1,      // Máximo requests simultáneos
        burstLimit: 5,         // Máximo requests en ventana
        burstWindowMs: 60000,  // Ventana de burst (60s)
        sessionCooldownMs: 3000, // Espera tras cada página
      },

      // === PATRONES DE URL RELEVANTES ===
      // Para detectar si estamos en una página útil del PJUD
      relevantUrlPatterns: [
        /pjud\.cl/i,
        /oficinavirtual.*poder.*judicial/i,
        /consultaunificada/i,
      ],
    };
  }

  // === Helpers de cache persistente ===

  async _saveToCache(config) {
    try {
      await new Promise((resolve) => {
        chrome.storage.local.set({
          [CONFIG_CACHE_KEY]: config,
          [CONFIG_CACHE_TS_KEY]: Date.now(),
        }, resolve);
      });
    } catch (e) {
      console.warn('[RemoteConfig] Error guardando en cache:', e);
    }
  }

  async _loadFromCache() {
    try {
      return new Promise((resolve) => {
        chrome.storage.local.get([CONFIG_CACHE_KEY, CONFIG_CACHE_TS_KEY], (result) => {
          const config = result[CONFIG_CACHE_KEY];
          const ts = result[CONFIG_CACHE_TS_KEY] || 0;

          if (config) {
            this.lastFetch = ts;
            resolve(config);
          } else {
            resolve(null);
          }
        });
      });
    } catch (e) {
      return null;
    }
  }
}
