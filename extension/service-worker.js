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
importScripts('lib/supabase.js');

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

      const nCuadernos = (pkg.otros_cuadernos?.length || 0) + 1;
      const nFolios = pkg.cuaderno_visible?.folios?.length || 0;

      console.log(
        '[ServiceWorker] CausaPackage recibido:',
        pkg.rol, '|', pkg.tribunal,
        `| ${nCuadernos} cuadernos, ${nFolios} folios`
      );

      chrome.runtime.sendMessage({
        type: 'scraper_event',
        event: 'causa_package_ready',
        data: {
          rol: pkg.rol,
          tribunal: pkg.tribunal,
          procedimiento: pkg.materia || null,
          libro_tipo: pkg.libro_tipo,
          cuadernos: nCuadernos,
          folios: nFolios,
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

  // Sync orchestrator messages
  if (message.type === 'start_sync') {
    executeSyncInBackground(message.causaPackage, message.causaInfo)
      .catch(err => console.error('[SW-Sync] Unhandled:', err));
    sendResponse({ status: 'started' });
    return;
  }

  if (message.type === 'get_sync_state') {
    getSyncJob().then(job => sendResponse({ syncJob: job }));
    return true;
  }

  if (message.type === 'clear_sync_state') {
    clearSyncJob().then(() => sendResponse({ status: 'cleared' }));
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
// SYNC ORCHESTRATOR
// Runs sync in the background, independent of sidepanel.
// The sidepanel delegates sync here via 'start_sync' message.
// Progress is broadcast back; state is persisted in storage
// so the panel can recover on reopen.
// ══════════════════════════════════════════════════════════

let isSWsyncing = false;
let lastStorageProgressUpdate = 0;
const STORAGE_PROGRESS_INTERVAL = 3000;

function getSyncJob() {
  return new Promise(resolve => {
    chrome.storage.local.get(['sync_job'], r => resolve(r.sync_job || null));
  });
}

function setSyncJob(job) {
  return new Promise(resolve => {
    chrome.storage.local.set({ sync_job: job }, resolve);
  });
}

function clearSyncJob() {
  return new Promise(resolve => {
    chrome.storage.local.remove(['sync_job'], resolve);
  });
}

function broadcastSyncUpdate(update) {
  chrome.runtime.sendMessage({ type: 'sync_update', ...update }).catch(() => {});

  if (update.event === 'progress') {
    const now = Date.now();
    if (now - lastStorageProgressUpdate > STORAGE_PROGRESS_INTERVAL) {
      lastStorageProgressUpdate = now;
      chrome.storage.local.get(['sync_job'], (r) => {
        const job = r.sync_job;
        if (job && job.status === 'syncing') {
          job.progress = update.data;
          chrome.storage.local.set({ sync_job: job });
        }
      });
    }
  }
}

async function executeSyncInBackground(causaPackage, causaInfo) {
  if (isSWsyncing) {
    broadcastSyncUpdate({ event: 'error', data: { message: 'Ya hay una sincronización en curso.' } });
    return;
  }
  isSWsyncing = true;

  const MAX_RESUME_ITERATIONS = 30;
  const MAX_NULL_RETRIES = 3;

  let totalAccumulated = 0;
  let allDocumentsNew = [];
  let allChanges = [];
  let resumeCaseId = null;
  let lastKnownCaseId = null;
  let iteration = 0;
  let nullStreakCount = 0;
  let syncResult = null;

  const nCuadernos = (causaPackage.otros_cuadernos?.length || 0) + 1;

  await setSyncJob({
    status: 'syncing',
    rol: causaInfo.rol,
    tribunal: causaInfo.tribunal,
    caratula: causaInfo.caratula,
    startedAt: Date.now(),
    progress: { percent: 10, message: `Iniciando sync: ${nCuadernos} cuaderno(s)...` },
    totalAccumulated: 0,
    result: null,
    error: null,
    completedAt: null,
  });

  broadcastSyncUpdate({
    event: 'progress',
    data: { percent: 10, message: `Iniciando sync: ${nCuadernos} cuaderno(s)...` },
  });

  try {
    do {
      iteration++;
      const payload = resumeCaseId
        ? { ...causaPackage, resume_case_id: resumeCaseId }
        : causaPackage;

      if (resumeCaseId) {
        console.log(`[SW-Sync] Resume iteration ${iteration}, case ${resumeCaseId}`);
        const pct = 10 + Math.round((totalAccumulated / (totalAccumulated + 100)) * 80);
        broadcastSyncUpdate({
          event: 'progress',
          data: { percent: pct, message: `Continuando descarga (lote ${iteration})…` },
        });
      }

      const session = await supabase.ensureFreshSession();
      if (!session?.access_token) {
        throw new Error('Sesión expirada durante la sincronización. Abra el panel y reintente.');
      }

      const iterResult = await swCallSyncSSE(payload, session.access_token);

      if (iterResult) {
        nullStreakCount = 0;
        syncResult = iterResult;
        totalAccumulated += iterResult.total_downloaded || 0;
        if (iterResult.documents_new?.length) allDocumentsNew.push(...iterResult.documents_new);
        if (iterResult.changes?.length) allChanges.push(...iterResult.changes);
        lastKnownCaseId = iterResult.case_id || lastKnownCaseId;
        resumeCaseId = iterResult.has_pending ? iterResult.case_id : null;

        if (iterResult.has_pending) {
          console.log(`[SW-Sync] Pending: ${iterResult.pending_count} tasks. Retrying in 3s...`);
          await new Promise(r => setTimeout(r, 3000));
        }
      } else {
        nullStreakCount++;
        console.warn(`[SW-Sync] Stream cortado sin resultado (intento ${nullStreakCount}/${MAX_NULL_RETRIES})`);

        if (lastKnownCaseId && nullStreakCount <= MAX_NULL_RETRIES) {
          resumeCaseId = lastKnownCaseId;
          const pct = 10 + Math.round((totalAccumulated / (totalAccumulated + 100)) * 80);
          broadcastSyncUpdate({
            event: 'progress',
            data: { percent: pct, message: `Reconectando (intento ${nullStreakCount})…` },
          });
          await new Promise(r => setTimeout(r, 3000));
        } else {
          resumeCaseId = null;
        }
      }
    } while (resumeCaseId && iteration < MAX_RESUME_ITERATIONS);

    if (syncResult) {
      syncResult.total_downloaded = totalAccumulated;
      syncResult.documents_new = allDocumentsNew;
      syncResult.changes = allChanges;

      // Store sync badge for "Mis Causas" tab
      if (syncResult.case_id && allDocumentsNew.length > 0) {
        try {
          const badgeResult = await new Promise(resolve =>
            chrome.storage.local.get(['sync_badges'], r => resolve(r.sync_badges || {}))
          );
          badgeResult[syncResult.case_id] = {
            newCount: allDocumentsNew.length,
            rol: syncResult.rol,
            syncedAt: new Date().toISOString(),
          };
          await new Promise(resolve =>
            chrome.storage.local.set({ sync_badges: badgeResult }, resolve)
          );
        } catch (e) {
          console.warn('[SW-Sync] Badge storage error:', e.message);
        }
      }

      await setSyncJob({
        status: 'completed',
        rol: causaInfo.rol,
        tribunal: causaInfo.tribunal,
        caratula: causaInfo.caratula,
        startedAt: Date.now(),
        progress: { percent: 100, message: '¡Sincronización completada!' },
        totalAccumulated,
        result: syncResult,
        error: null,
        completedAt: Date.now(),
      });

      broadcastSyncUpdate({ event: 'complete', data: syncResult });
    } else {
      await setSyncJob({
        status: 'failed',
        rol: causaInfo.rol,
        tribunal: causaInfo.tribunal,
        caratula: causaInfo.caratula,
        progress: { percent: 100, message: 'La conexión se perdió.' },
        result: null,
        error: 'Conexión perdida — los documentos descargados se guardaron. Vuelva a sincronizar para continuar.',
        completedAt: Date.now(),
      });

      broadcastSyncUpdate({
        event: 'error',
        data: { message: 'Conexión perdida — los documentos descargados se guardaron. Vuelva a sincronizar para continuar.' },
      });
    }
  } catch (error) {
    console.error('[SW-Sync] Error:', error);

    await setSyncJob({
      status: 'failed',
      rol: causaInfo.rol,
      tribunal: causaInfo.tribunal,
      caratula: causaInfo.caratula,
      progress: { percent: 100, message: `Error: ${error.message}` },
      result: null,
      error: error.message,
      completedAt: Date.now(),
    });

    broadcastSyncUpdate({ event: 'error', data: { message: error.message } });
  } finally {
    isSWsyncing = false;
  }
}

async function swCallSyncSSE(causaPackage, accessToken) {
  const response = await fetch(CONFIG.API.SCRAPER_SYNC, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    },
    body: JSON.stringify(causaPackage),
  });

  if (!response.ok) {
    let errMsg = `Error del servidor: HTTP ${response.status}`;
    try {
      const err = await response.json();
      if (err.error) errMsg = err.error;
    } catch {}
    throw new Error(errMsg);
  }

  const contentType = response.headers.get('content-type') || '';

  if (!contentType.includes('text/event-stream')) {
    return await response.json();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let syncResult = null;
  let errorMsg = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() || '';

      for (const block of blocks) {
        if (!block.trim()) continue;
        const eventMatch = block.match(/^event:\s*(.+)$/m);
        const dataMatch = block.match(/^data:\s*(.+)$/m);
        if (!eventMatch || !dataMatch) continue;

        const event = eventMatch[1].trim();
        let data;
        try { data = JSON.parse(dataMatch[1]); } catch { continue; }

        if (event === 'progress') {
          const total = data.total || 0;
          const current = data.current || 0;
          const pct = total > 0 ? 10 + Math.round((current / total) * 80) : 15;
          broadcastSyncUpdate({ event: 'progress', data: { percent: pct, message: data.message } });
        } else if (event === 'complete') {
          if (data.has_pending) {
            broadcastSyncUpdate({ event: 'progress', data: { percent: 90, message: 'Lote completado. Continuando descarga…' } });
          } else {
            broadcastSyncUpdate({ event: 'progress', data: { percent: 100, message: '¡Sincronización completada!' } });
          }
          syncResult = data;
        } else if (event === 'error') {
          errorMsg = data.message;
        }
      }

      if (syncResult || errorMsg) break;
    }
  } finally {
    try { reader.cancel(); } catch {}
    try { reader.releaseLock(); } catch {}
  }

  if (errorMsg) throw new Error(errorMsg);
  return syncResult;
}

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
