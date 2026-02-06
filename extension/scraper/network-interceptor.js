/**
 * ============================================================
 * NETWORK INTERCEPTOR - Layer 1 (Máxima Resiliencia)
 * ============================================================
 * SOLUCIÓN A: Interceptación de Tráfico (Vulnerabilidad 2.3)
 * 
 * Esta es la capa MÁS RESILIENTE del scraper porque NO depende
 * del DOM en absoluto. Funciona a nivel de red:
 * 
 *   - Inyecta page-interceptor.js en el MAIN world de la página
 *   - Captura fetch(), XHR y Blob URLs que contengan PDFs
 *   - Los PDFs se capturan "al vuelo" sin importar si el botón
 *     HTML cambió de ID, clase o estructura
 * 
 * Si PJud cambia todo su HTML pero sigue sirviendo PDFs por HTTP,
 * esta capa seguirá funcionando.
 * ============================================================
 */

class NetworkInterceptor {
  constructor() {
    this.capturedFiles = [];
    this.listeners = [];
    this.isActive = false;
  }

  /**
   * Inicializa la interceptación inyectando el script en el MAIN world.
   * Debe llamarse desde el content script (tiene acceso a chrome.runtime).
   */
  setupPageInterception() {
    if (this.isActive) return;

    // Inyectar page-interceptor.js en el contexto REAL de la página
    // Esto permite interceptar fetch/XHR que el isolated world no puede
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('scraper/page-interceptor.js');
      script.onload = () => {
        script.remove(); // Limpiar el tag tras carga
        console.log('[NetworkInterceptor] Page interceptor inyectado');
      };
      script.onerror = (e) => {
        console.error('[NetworkInterceptor] Error inyectando interceptor:', e);
      };
      (document.head || document.documentElement).appendChild(script);
    } catch (e) {
      console.error('[NetworkInterceptor] Error fatal al inyectar:', e);
      return;
    }

    // Escuchar eventos del page-interceptor (llegan via CustomEvent)
    window.addEventListener('__legalbot_pdf_intercepted', (event) => {
      if (!event.detail) return;

      const fileInfo = {
        url: event.detail.url,
        contentType: event.detail.contentType,
        blobUrl: event.detail.blobUrl,
        size: event.detail.size,
        method: event.detail.method,
        timestamp: Date.now(),
        source: 'network_intercept',
      };

      console.log('[NetworkInterceptor] PDF capturado:', fileInfo.url, `(${this._formatSize(fileInfo.size)})`);
      this.capturedFiles.push(fileInfo);
      this._notifyListeners({ type: 'pdf_captured', data: fileInfo });
    });

    this.isActive = true;
    console.log('[NetworkInterceptor] Layer 1 activa - escuchando tráfico de red');
  }

  /**
   * Registrar un listener para eventos de captura
   */
  onCapture(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  /**
   * Obtener todos los archivos capturados
   */
  getCapturedFiles() {
    return [...this.capturedFiles];
  }

  /**
   * Verificar si hay capturas pendientes
   */
  hasCapturedFiles() {
    return this.capturedFiles.length > 0;
  }

  /**
   * Limpiar capturas procesadas
   */
  clearCaptured() {
    this.capturedFiles = [];
  }

  /**
   * Esperar a que se capture un PDF (útil tras simular un click)
   * @param {number} timeoutMs - Tiempo máximo de espera
   * @returns {Promise<object|null>} - El PDF capturado o null si timeout
   */
  waitForCapture(timeoutMs = 10000) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve(null);
      }, timeoutMs);

      const handler = (event) => {
        clearTimeout(timeout);
        cleanup();
        resolve(event.data);
      };

      const cleanup = () => {
        this.listeners = this.listeners.filter(l => l !== handler);
      };

      this.listeners.push(handler);
    });
  }

  // === Internals ===

  _notifyListeners(event) {
    for (const cb of this.listeners) {
      try {
        cb(event);
      } catch (e) {
        console.error('[NetworkInterceptor] Error en listener:', e);
      }
    }
  }

  _formatSize(bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
}
