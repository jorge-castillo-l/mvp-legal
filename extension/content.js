/**
 * ============================================================
 * CONTENT SCRIPT - "Los Ojos" del Legal Bot
 * ============================================================
 * Se inyecta automáticamente en pjud.cl (y todos sus iframes).
 *
 * Flujo actualizado con 4.07 (Causa Context):
 *   1. Al cargar: inicializa engine + detecta ROL automáticamente
 *   2. Envía contexto de causa al Sidepanel
 *   3. Espera confirmación del abogado
 *   4. Solo entonces permite sync
 *
 * Los módulos se cargan vía manifest.json en este orden:
 *   remote-config → network-interceptor → dom-analyzer →
 *   human-throttle → causa-context → pdf-validator →
 *   strategy-engine → content.js (este archivo)
 * ============================================================
 */

console.log('[LegalBot] Content Script activo en:', window.location.href);

// ══════════════════════════════════════════════════════════
// INSTANCIA GLOBAL DEL STRATEGY ENGINE
// ══════════════════════════════════════════════════════════

let engine = null;
let isInitialized = false;

async function initializeEngine() {
  if (isInitialized && engine) return engine;

  try {
    engine = new StrategyEngine();
    await engine.initialize();
    isInitialized = true;
    console.log('[LegalBot] Strategy Engine inicializado');

    // Detección automática de causa al cargar la página
    const causa = engine.detectCausa();

    // Notificar al sidepanel
    chrome.runtime.sendMessage({
      type: 'scraper_ready',
      causa: causa,
      engineReady: true,
    }).catch(() => {});

    return engine;
  } catch (error) {
    console.error('[LegalBot] Error inicializando engine:', error);
    return null;
  }
}

// ══════════════════════════════════════════════════════════
// MUTATION OBSERVER - Detectar contenido dinámico (AJAX)
// ══════════════════════════════════════════════════════════

let observerDebounce = null;

const pageObserver = new MutationObserver((mutations) => {
  clearTimeout(observerDebounce);
  observerDebounce = setTimeout(() => {
    if (!engine) return;

    const hasNewContent = mutations.some(mutation => {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = /** @type {Element} */ (node);
          if (el.tagName === 'TABLE' || el.querySelector?.('table') ||
            el.tagName === 'A' || el.querySelector?.('a')) {
            return true;
          }
        }
      }
      return false;
    });

    if (hasNewContent) {
      console.log('[LegalBot] Contenido nuevo detectado (AJAX)');
      // Re-detectar causa con el nuevo contenido
      const causa = engine.detectCausa();
      chrome.runtime.sendMessage({
        type: 'scraper_event',
        event: 'content_updated',
        data: { causa: causa },
      }).catch(() => {});
    }
  }, 1500);
});

if (document.body) {
  pageObserver.observe(document.body, { childList: true, subtree: true });
}

// ══════════════════════════════════════════════════════════
// MESSAGE HANDLER
// ══════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleMessage(request)
    .then(response => sendResponse(response))
    .catch(error => sendResponse({ error: error.message }));
  return true;
});

async function handleMessage(request) {
  switch (request.action) {

    // ── PING ──
    case 'ping': {
      const causa = engine?.getDetectedCausa() || null;
      return {
        status: 'alive',
        engineReady: isInitialized,
        causa: causa,
      };
    }

    // ── DETECT: Detectar/re-detectar causa ──
    case 'detect_causa': {
      if (!engine) await initializeEngine();
      if (!engine) return { error: 'No se pudo inicializar' };

      const causa = engine.detectCausa();
      return { status: 'detected', causa: causa };
    }

    // ── CONFIRM: El abogado confirma la causa detectada ──
    case 'confirm_causa': {
      if (!engine) return { error: 'Engine no inicializado' };

      const confirmed = engine.confirmCausa();
      if (confirmed) {
        return { status: 'confirmed', causa: engine.causaContext.getConfirmedCausa() };
      }
      return { error: 'No hay causa detectada para confirmar' };
    }

    // ── SYNC: Sincronizar (requiere causa confirmada) ──
    case 'sync': {
      if (!engine) await initializeEngine();
      if (!engine) return { error: 'No se pudo inicializar el scraper' };

      const results = await engine.sync();
      return {
        status: 'sync_complete',
        results: {
          rol: results.rol,
          layer1Count: results.layer1?.length || 0,
          layer2Count: results.layer2?.length || 0,
          totalFound: results.totalFound,
          totalValidated: results.totalValidated,
          totalUploaded: results.totalUploaded,
          totalRejected: results.rejected?.length || 0,
          rejectedReasons: (results.rejected || []).map(r => r.reason),
          needsManual: results.needsManual,
          errors: results.errors,
          duration: results.duration,
        },
      };
    }

    // ── ANALYZE: Solo analizar sin descargar ──
    case 'analyze': {
      if (!engine) await initializeEngine();
      if (!engine) return { error: 'No se pudo inicializar' };

      const causa = engine.getDetectedCausa();
      const downloads = engine.domAnalyzer.findDownloadElements();

      return {
        status: 'analysis_complete',
        causa: causa,
        downloadElements: downloads.length,
        topDownloads: downloads.slice(0, 5).map(d => ({
          text: d.element.textContent?.trim().substring(0, 50),
          confidence: d.confidence,
          source: d.source,
        })),
      };
    }

    // ── UPLOAD_MANUAL ──
    case 'upload_manual': {
      if (!engine) await initializeEngine();
      if (!engine) return { error: 'No se pudo inicializar' };

      if (!request.fileData || !request.fileName) {
        return { error: 'Datos del archivo incompletos' };
      }

      const blob = new Blob([request.fileData], { type: 'application/pdf' });
      const file = new File([blob], request.fileName, { type: 'application/pdf' });
      const result = await engine.uploadManual(file);
      return { status: 'upload_complete', result };
    }

    // ── GET_STATUS ──
    case 'get_status': {
      return {
        status: engine?.status || 'not_initialized',
        engineReady: isInitialized,
        configVersion: engine?.config?.version || 'N/A',
        causa: engine?.getDetectedCausa() || null,
        causaConfirmed: engine?.causaContext?.isConfirmed || false,
        capturedFiles: engine?.networkInterceptor?.getCapturedFiles()?.length || 0,
      };
    }

    default:
      return { error: `Acción desconocida: ${request.action}` };
  }
}

// ══════════════════════════════════════════════════════════
// AUTO-INICIALIZACIÓN
// ══════════════════════════════════════════════════════════

if (window === window.top || document.location.href.includes('pjud.cl')) {
  initializeEngine().catch(err => {
    console.error('[LegalBot] Error en auto-inicialización:', err);
  });
}
