/**
 * ============================================================
 * PAGE INTERCEPTOR - Inyectado en MAIN World
 * ============================================================
 * SOLUCIÓN A: Interceptación de Tráfico (Vulnerabilidad 2.3 Blobs)
 * 
 * Este script se inyecta en el contexto REAL de la página (no el
 * isolated world del content script). Esto le permite:
 * 
 *   1. Interceptar TODAS las llamadas fetch() y XMLHttpRequest
 *   2. Capturar Blobs PDF que nunca llegan a ser un <a href>
 *   3. Detectar URL.createObjectURL() para PDFs generados al vuelo
 * 
 * Comunicación: Envía CustomEvents al content script cuando detecta
 * un PDF en el tráfico de red de la página.
 * 
 * IMPORTANTE: Este archivo NO tiene acceso a chrome.* APIs.
 * Solo puede comunicarse con el content script via window events.
 * ============================================================
 */

(function () {
  'use strict';

  // Prevenir doble inyección
  if (window.__legalBotInterceptorActive) return;
  window.__legalBotInterceptorActive = true;

  // Firmas de contenido PDF
  const PDF_CONTENT_TYPES = [
    'application/pdf',
    'application/x-pdf',
    'application/octet-stream',
  ];

  // Verificar si una respuesta parece ser un PDF
  function isPdfResponse(contentType, url) {
    const ct = (contentType || '').toLowerCase();
    const u = (url || '').toLowerCase();

    // Content-Type explícito
    if (PDF_CONTENT_TYPES.some(type => ct.includes(type))) return true;

    // URL con extensión .pdf
    if (u.includes('.pdf')) return true;

    // Patrones de URL comunes en sistemas judiciales
    if (/documento|escrito|resoluc|getdoc|verdoc|obtenerdoc/i.test(u)) return true;

    return false;
  }

  // Enviar evento al content script
  function notifyContentScript(detail) {
    try {
      window.dispatchEvent(
        new CustomEvent('__legalbot_pdf_intercepted', {
          detail: {
            ...detail,
            capturedAt: Date.now(),
          },
        })
      );
    } catch (e) {
      // Silencioso - no romper la página
    }
  }

  // ─────────────────────────────────────────────────────────
  // INTERCEPTOR 1: window.fetch()
  // ─────────────────────────────────────────────────────────
  const originalFetch = window.fetch;

  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);

    try {
      const contentType = response.headers.get('content-type') || '';
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');

      if (isPdfResponse(contentType, url)) {
        // IMPORTANTE: Clonar antes de consumir el body
        const clone = response.clone();
        const blob = await clone.blob();

        // Solo notificar si tiene un tamaño razonable (>1KB = probable PDF real)
        if (blob.size > 1024) {
          const blobUrl = URL.createObjectURL(blob);
          notifyContentScript({
            url: url,
            contentType: contentType,
            blobUrl: blobUrl,
            size: blob.size,
            method: 'fetch',
          });
        }
      }
    } catch (e) {
      // Silencioso - nunca romper la página del usuario
    }

    return response;
  };

  // ─────────────────────────────────────────────────────────
  // INTERCEPTOR 2: XMLHttpRequest
  // ─────────────────────────────────────────────────────────
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__legalbot_url = url;
    this.__legalbot_method = method;
    return originalXHROpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      try {
        const contentType = this.getResponseHeader('content-type') || '';

        if (isPdfResponse(contentType, this.__legalbot_url)) {
          let blobUrl = null;
          let size = 0;

          if (this.response instanceof Blob) {
            blobUrl = URL.createObjectURL(this.response);
            size = this.response.size;
          } else if (this.responseType === 'arraybuffer' && this.response) {
            const blob = new Blob([this.response], { type: 'application/pdf' });
            blobUrl = URL.createObjectURL(blob);
            size = this.response.byteLength;
          }

          if (blobUrl && size > 1024) {
            notifyContentScript({
              url: this.__legalbot_url || '',
              contentType: contentType,
              blobUrl: blobUrl,
              size: size,
              method: 'xhr',
            });
          }
        }
      } catch (e) {
        // Silencioso
      }
    });

    return originalXHRSend.apply(this, args);
  };

  // ─────────────────────────────────────────────────────────
  // INTERCEPTOR 3: URL.createObjectURL (Blobs directos)
  // ─────────────────────────────────────────────────────────
  const originalCreateObjectURL = URL.createObjectURL;

  URL.createObjectURL = function (obj) {
    const url = originalCreateObjectURL.call(this, obj);

    try {
      if (obj instanceof Blob && obj.type === 'application/pdf' && obj.size > 1024) {
        notifyContentScript({
          url: url,
          contentType: obj.type,
          blobUrl: url,
          size: obj.size,
          method: 'blob_url',
        });
      }
    } catch (e) {
      // Silencioso
    }

    return url;
  };

  console.log('[LegalBot] Page interceptor activo en', window.location.href);
})();
