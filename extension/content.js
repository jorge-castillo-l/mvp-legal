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
    const causa = await engine.detectCausa();

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
      engine.detectCausa().then(causa => {
        chrome.runtime.sendMessage({
          type: 'scraper_event',
          event: 'content_updated',
          data: { causa: causa },
        }).catch(() => {});
      });
    }
  }, 1500);
});

if (document.body) {
  pageObserver.observe(document.body, { childList: true, subtree: true });
}

// ══════════════════════════════════════════════════════════
// RE-DETECCIÓN POR EVENTOS (OJV modal, resize, visibilidad)
// Soluciona: causa no se detecta hasta que el usuario abre DevTools
// ══════════════════════════════════════════════════════════

let redetectionDebounce = null;
const REDETECTION_DEBOUNCE_MS = 800;

function triggerRedetection() {
  clearTimeout(redetectionDebounce);
  redetectionDebounce = setTimeout(async () => {
    if (!engine) await initializeEngine();
    if (!engine) return;
    const causa = await engine.detectCausa();
    chrome.runtime.sendMessage({
      type: 'scraper_event',
      event: 'content_updated',
      data: { causa: causa },
    }).catch(() => {});
  }, REDETECTION_DEBOUNCE_MS);
}

// ══════════════════════════════════════════════════════════
// CAPTURA CLIC EN TABLA DE RESULTADOS (caratulado/tribunal)
// Al hacer clic en el ícono de detalle, guardamos la fila para
// usarla cuando el modal cargue (donde el ROL es el mismo para
// todas las causas pero caratulado/tribunal vienen de la fila).
// ══════════════════════════════════════════════════════════

const PJUD_LAST_CLICKED_KEY = '__pjudLastClickedRow';

function capturePjudRowClick(e) {
  const link = e.target.closest?.('a.toggle-modal, a[href="#modalDetalleCivil"]');
  if (!link) return;

  const row = link.closest?.('tr');
  const tbody = row?.closest?.('#verDetalle');
  if (!row || !tbody) return;

  const cells = row.querySelectorAll('td');
  if (cells.length < 5) return;

  const data = {
    rol: (cells[1]?.textContent || '').trim(),
    fecha: (cells[2]?.textContent || '').trim(),
    caratulado: (cells[3]?.textContent || '').trim(),
    tribunal: (cells[4]?.textContent || '').trim(),
    clickedAt: Date.now(),
  };

  if (!data.caratulado && !data.tribunal) return;

  window[PJUD_LAST_CLICKED_KEY] = data;
  try {
    chrome.storage.session.set({ [PJUD_LAST_CLICKED_KEY]: data });
  } catch (err) { /* ignorar */ }

  console.log('[LegalBot] Fila capturada:', data.rol, '|', data.caratulado?.substring(0, 40) + '...');
}

if (/pjud\.cl/i.test(document.location.href)) {
  document.addEventListener('click', capturePjudRowClick, true);
}

// Solo en el frame principal (evitar duplicados en iframes)
if (window === window.top && /pjud\.cl/i.test(document.location.href)) {
  // Si ya hay hash de modal al cargar, detectar tras breve espera (contenido puede cargar después)
  if (/modalDetalle|detalle|modal/i.test(location.hash)) {
    setTimeout(triggerRedetection, 1500);
  }

  // hashchange: OJV usa #modalDetalleCivil para abrir el modal de causa
  window.addEventListener('hashchange', () => {
    if (/modalDetalle|detalle|modal/i.test(location.hash)) {
      console.log('[LegalBot] Hash cambiado (modal), re-detectando:', location.hash);
      triggerRedetection();
    }
  });

  // resize: abrir DevTools o redimensionar puede hacer visible contenido lazy
  let resizeDebounce = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeDebounce);
    resizeDebounce = setTimeout(triggerRedetection, 500);
  });

  // visibilitychange: cuando la pestaña vuelve a estar visible
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      triggerRedetection();
    }
  });

  // Detección periódica cada 8s (fallback para lazy-load que no dispara eventos)
  setInterval(triggerRedetection, 8000);
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

      const causa = await engine.detectCausa();
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
      if (results?.error) return { error: results.error };
      return {
        status: 'sync_complete',
        results: {
          rol: results.rol,
          tribunal: results.tribunal || '',
          caratula: results.caratula || '',
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
