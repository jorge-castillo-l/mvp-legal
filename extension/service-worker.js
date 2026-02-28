/**
 * ============================================================
 * SERVICE WORKER - "El Sistema Nervioso"
 * ============================================================
 * Coordina la comunicación entre content scripts y sidepanel.
 * También monitorea descargas para captura de PDFs (Layer 1 extra).
 * 
 * Responsabilidades:
 *   1. Abrir SidePanel al click del icono
 *   2. Monitorear webRequest para detectar PDFs del PJUD
 *   3. Monitorear descargas (chrome.downloads) para PDFs
 *   4. Reenviar mensajes entre content script ↔ sidepanel
 *   5. Cachear configuración remota
 * ============================================================
 */

// Cargar configuración centralizada (MV3 Service Workers requieren importScripts al top-level)
importScripts('lib/config.js');

// ══════════════════════════════════════════════════════════
// SETUP: SidePanel behavior
// ══════════════════════════════════════════════════════════

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('[ServiceWorker] Error sidePanel:', error));

chrome.runtime.onInstalled.addListener(() => {
  console.log('[ServiceWorker] Legal Bot Extension instalada v1.1');
});

// ══════════════════════════════════════════════════════════
// NETWORK MONITOR: Detectar respuestas PDF del PJUD
// ══════════════════════════════════════════════════════════
// Capa adicional de detección a nivel de service worker.
// Complementa al page-interceptor (que opera en la página).

// Almacén temporal de URLs de PDF detectadas
const detectedPdfUrls = new Map(); // url -> { timestamp, tabId, type }

// Monitorear respuestas HTTP que parecen ser PDFs
chrome.webRequest.onCompleted.addListener(
  (details) => {
    // Filtrar por content-type PDF
    const isPdf = details.responseHeaders?.some(header => {
      const name = header.name.toLowerCase();
      const value = (header.value || '').toLowerCase();
      return name === 'content-type' && (
        value.includes('application/pdf') ||
        value.includes('application/octet-stream')
      );
    });

    // O por URL con patrón PDF
    const urlIsPdf = /\.pdf|download|documento|getdoc|verdoc/i.test(details.url);

    if (isPdf || urlIsPdf) {
      console.log('[ServiceWorker] PDF detectado en red:', details.url);

      detectedPdfUrls.set(details.url, {
        timestamp: Date.now(),
        tabId: details.tabId,
        type: details.type,
        statusCode: details.statusCode,
        contentType: isPdf ? 'application/pdf' : 'url_pattern',
      });

      // Notificar al sidepanel
      chrome.runtime.sendMessage({
        type: 'scraper_event',
        event: 'network_pdf_detected',
        data: {
          url: details.url,
          tabId: details.tabId,
        },
      }).catch(() => {});

      // Limpiar entradas antiguas (>5 min)
      const cutoff = Date.now() - 5 * 60 * 1000;
      for (const [url, info] of detectedPdfUrls) {
        if (info.timestamp < cutoff) detectedPdfUrls.delete(url);
      }
    }
  },
  { urls: ['*://*.pjud.cl/*'] },
  ['responseHeaders']
);

// ══════════════════════════════════════════════════════════
// DOWNLOAD MONITOR: Capturar descargas de PDFs
// ══════════════════════════════════════════════════════════
// Cuando el navegador inicia una descarga desde pjud.cl,
// la detectamos aquí como señal adicional para Layer 1.

chrome.downloads.onCreated.addListener((downloadItem) => {
  const isPjud = /pjud\.cl/i.test(downloadItem.url || '') ||
                 /pjud\.cl/i.test(downloadItem.referrer || '');
  const isPdf = (downloadItem.mime || '').includes('pdf') ||
                (downloadItem.filename || '').endsWith('.pdf');

  if (isPjud && isPdf) {
    console.log('[ServiceWorker] Descarga PDF del PJUD detectada:', downloadItem.filename);

    chrome.runtime.sendMessage({
      type: 'scraper_event',
      event: 'download_detected',
      data: {
        id: downloadItem.id,
        url: downloadItem.url,
        filename: downloadItem.filename,
        fileSize: downloadItem.fileSize,
        mime: downloadItem.mime,
      },
    }).catch(() => {});
  }
});

// ══════════════════════════════════════════════════════════
// CAUSA PACKAGE STORE (4.16)
// Stores the latest CausaPackage per tab for API sync (4.17)
// ══════════════════════════════════════════════════════════

const causaPackageStore = new Map(); // tabId -> { package, timestamp }

// ══════════════════════════════════════════════════════════
// MESSAGE ROUTER: Comunicación entre componentes
// ══════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Reenviar eventos del scraper al sidepanel (y vice versa)
  if (message.type === 'scraper_event' || message.type === 'scraper_ready') {
    return;
  }

  // 4.16: CausaPackage from JWT Extractor → store + forward to API (4.17)
  if (message.type === 'causa_package') {
    const tabId = sender?.tab?.id || 'unknown';
    const pkg = message.package;

    if (pkg?.rol) {
      causaPackageStore.set(tabId, { package: pkg, timestamp: Date.now() });

      console.log(
        '[ServiceWorker] CausaPackage recibido:',
        pkg.rol, '|', pkg.tribunal,
        `| ${pkg.cuadernos?.length || 0} cuadernos, ${pkg.folios?.length || 0} folios`
      );

      // Notify sidepanel about the extracted package
      chrome.runtime.sendMessage({
        type: 'scraper_event',
        event: 'causa_package_ready',
        data: {
          rol: pkg.rol,
          tribunal: pkg.tribunal,
          procedimiento: pkg.procedimiento,
          libro_tipo: pkg.libro_tipo,
          cuadernos: pkg.cuadernos?.length || 0,
          folios: pkg.folios?.length || 0,
          tabId: tabId,
        },
      }).catch(() => {});

      // API sync will be implemented in 4.17
      // For now, acknowledge receipt and store
      sendResponse({ status: 'api_unavailable', message: 'CausaPackage almacenado. API sync pendiente (4.17).' });

      // Clean stale entries (>10 min)
      const cutoff = Date.now() - 10 * 60 * 1000;
      for (const [id, entry] of causaPackageStore) {
        if (entry.timestamp < cutoff) causaPackageStore.delete(id);
      }
    } else {
      sendResponse({ status: 'error', error: 'CausaPackage inválido: falta ROL' });
    }
    return true;
  }

  // Retrieve stored CausaPackage (for sidepanel or API)
  if (message.type === 'get_causa_package') {
    const tabId = message.tabId || 'unknown';
    const entry = causaPackageStore.get(tabId);
    sendResponse(entry ? { status: 'found', package: entry.package } : { status: 'not_found' });
    return true;
  }

  // Solicitud de URLs de PDF detectadas por el service worker
  if (message.type === 'get_detected_pdfs') {
    const pdfs = Array.from(detectedPdfUrls.entries()).map(([url, info]) => ({
      url,
      ...info,
    }));
    sendResponse({ pdfs });
    return true;
  }

  // Enviar mensaje al content script de la pestaña activa
  if (message.type === 'forward_to_content') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, message.payload)
          .then(response => sendResponse(response))
          .catch(error => sendResponse({ error: error.message }));
      } else {
        sendResponse({ error: 'No hay pestaña activa' });
      }
    });
    return true;
  }
});

// ══════════════════════════════════════════════════════════
// CONFIG CACHE: Pre-cargar configuración remota
// ══════════════════════════════════════════════════════════

// Intentar pre-cachear la config al instalar/actualizar
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const response = await fetch(CONFIG.API.SCRAPER_CONFIG);
    if (response.ok) {
      const config = await response.json();
      await chrome.storage.local.set({
        'legalbot_scraper_config': config,
        'legalbot_scraper_config_ts': Date.now(),
      });
      console.log('[ServiceWorker] Config pre-cacheada v' + config.version);
    }
  } catch (e) {
    console.warn('[ServiceWorker] No se pudo pre-cachear config:', e.message);
  }
});
