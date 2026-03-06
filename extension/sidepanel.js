/**
 * ============================================================
 * SIDEPANEL - "La Cara" del Legal Bot
 * ============================================================
 * v1.3 — Tarea 4.18: Sync UI v2
 *
 *   • Preview: ROL + tribunal + carátula + N cuadernos + N folios
 *   • Estado de sync: compara folios visibles vs cases.document_count
 *     → "Puede haber documentos nuevos desde [fecha]. Sincronizar?"
 *     → "Actualizada ✓"
 *   • Sync directo a API via fetch + SSE stream (no via content script)
 *     → El sync continúa en el servidor aunque el abogado navegue
 *   • Barra de progreso en tiempo real: "Descargando doc 5/47…"
 *   • Resultado: N nuevos · N existentes · N errores + lista de docs
 *
 * Estructura:
 *   1. Estado global e inicialización
 *   2. Autenticación
 *   3. Sistema de Tabs
 *   4. Tab Sincronizar — detección y estado
 *   5. Tab Mis Causas — fetch y render
 *   6. Sync v2 — obtener CausaPackage + SSE
 *   7. Eventos del Scraper
 *   8. Utilidades
 * ============================================================
 */

// ══════════════════════════════════════════════════════════
// 1. ESTADO GLOBAL
// ══════════════════════════════════════════════════════════

let currentUser = null;
let currentSession = null;
let isSyncing = false;
let lastDetectedCausa = null;
let lastSyncState = null;  // { count, lastSyncedAt, rol, tribunal }
let activeTab = 'sync';
let casesLoaded = false;
let isDetecting = false;
let syncingCausaInfo = null;

// ══════════════════════════════════════════════════════════
// 2. INICIALIZACIÓN
// ══════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Sidepanel] Legal Bot v1.3 iniciado');

  await checkAuthentication();
  setupTabs();
  setupEventListeners();
  setupDeleteListeners();
  setupScraperEventListener();
  setupTabChangeDetection();

  setTimeout(requestCausaDetection, 1000);
  setInterval(checkAuthentication, 30000);
});

// ══════════════════════════════════════════════════════════
// 3. AUTENTICACIÓN
// ══════════════════════════════════════════════════════════

async function checkAuthentication() {
  try {
    const authSection = document.getElementById('auth-section');
    authSection.style.display = 'block';

    let session = await supabase.syncSessionFromDashboard();
    if (!session) session = await supabase.getSession();

    if (session && session.user) {
      currentSession = session;
      currentUser = session.user;
      showAuthenticatedUI();
    } else {
      currentSession = null;
      currentUser = null;
      showUnauthenticatedUI();
    }
  } catch (error) {
    console.error('[Sidepanel] Error auth:', error);
    showUnauthenticatedUI();
  }
}

function showAuthenticatedUI() {
  document.getElementById('auth-status').innerHTML = `
    <p style="color: #16a34a;">● Sesión activa</p>
    <p><strong>Email:</strong> ${currentUser.email}</p>
  `;
  document.getElementById('login-btn').style.display = 'none';
  document.getElementById('logout-btn').style.display = 'block';
  document.getElementById('authenticated-content').style.display = 'block';
  document.getElementById('unauthenticated-content').style.display = 'none';
}

function showUnauthenticatedUI() {
  document.getElementById('auth-status').innerHTML = '<p style="color: #ea580c;">● Sin sesión activa</p>';
  document.getElementById('login-btn').style.display = 'block';
  document.getElementById('logout-btn').style.display = 'none';
  document.getElementById('authenticated-content').style.display = 'none';
  document.getElementById('unauthenticated-content').style.display = 'block';
}

// ══════════════════════════════════════════════════════════
// 4. SISTEMA DE TABS
// ══════════════════════════════════════════════════════════

function setupTabs() {
  document.querySelectorAll('.tab[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('go-to-sync-btn')?.addEventListener('click', () => switchTab('sync'));
  document.getElementById('cases-retry-btn')?.addEventListener('click', () => {
    casesLoaded = false;
    loadCases();
  });
}

function switchTab(tabId) {
  activeTab = tabId;

  document.querySelectorAll('.tab[data-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-content').forEach(panel => {
    panel.classList.toggle('active', panel.id === `tab-${tabId}`);
  });

  if (tabId === 'cases' && !casesLoaded && currentUser) {
    loadCases();
  }
}

// ══════════════════════════════════════════════════════════
// 5. EVENT LISTENERS
// ══════════════════════════════════════════════════════════

function setupEventListeners() {
  document.getElementById('login-btn')?.addEventListener('click', () => {
    chrome.tabs.create({ url: CONFIG.PAGES.LOGIN });
  });

  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await supabase.signOut();
    currentUser = null;
    currentSession = null;
    casesLoaded = false;
    showUnauthenticatedUI();
  });

  document.getElementById('open-dashboard-btn')?.addEventListener('click', () => {
    chrome.tabs.create({ url: CONFIG.PAGES.LOGIN });
  });

  document.getElementById('sync-btn')?.addEventListener('click', handleSync);
}

// ══════════════════════════════════════════════════════════
// 6. DETECCIÓN DE CAUSA
// ══════════════════════════════════════════════════════════

function isPjudUrl(url) {
  return url && /pjud\.cl/i.test(url);
}

function showDetectingState() {
  if (isSyncing) return;
  isDetecting = true;
  const causaRol = document.getElementById('causa-rol');
  const causaTribunal = document.getElementById('causa-tribunal');
  const causaCaratula = document.getElementById('causa-caratula');
  if (causaRol) causaRol.innerHTML = '<span class="spinner">⟳</span> Detectando…';
  if (causaTribunal) causaTribunal.textContent = 'Analizando página…';
  if (causaCaratula) causaCaratula.textContent = '';
  const syncBtn = document.getElementById('sync-btn');
  if (syncBtn) { syncBtn.disabled = true; syncBtn.style.display = 'none'; }
  const syncStatus = document.getElementById('sync-status');
  if (syncStatus) syncStatus.style.display = 'none';
  const changesBanner = document.getElementById('changes-detected-banner');
  if (changesBanner) changesBanner.style.display = 'none';
  hideCausaPackagePreview();
}

/**
 * Restaura la UI con la última causa detectada (sin spinner).
 * Se usa al navegar a pestañas no-PJUD o cuando falla la detección.
 */
function restoreLastDetectedCausaUI() {
  const causaRol = document.getElementById('causa-rol');
  const causaTribunal = document.getElementById('causa-tribunal');
  const causaCaratula = document.getElementById('causa-caratula');
  const syncBtn = document.getElementById('sync-btn');

  if (lastDetectedCausa) {
    if (causaRol) causaRol.textContent = `ROL: ${lastDetectedCausa.rol}`;
    if (causaTribunal) causaTribunal.textContent = lastDetectedCausa.tribunal
      ? `Tribunal: ${lastDetectedCausa.tribunal}`
      : `Fuente: ${lastDetectedCausa.rolSource || 'PJUD'}`;
    if (causaCaratula) causaCaratula.textContent = lastDetectedCausa.caratula
      ? `Carátula: ${lastDetectedCausa.caratula}`
      : '';
    if (syncBtn) syncBtn.style.display = '';
    if (lastSyncState) {
      applySyncStateUI(lastDetectedCausa, lastSyncState);
    }
  } else {
    if (causaRol) causaRol.textContent = '--';
    if (causaTribunal) causaTribunal.textContent = 'Navegue a una causa en PJUD';
    if (causaCaratula) causaCaratula.textContent = '';
    if (syncBtn) { syncBtn.disabled = true; syncBtn.style.display = ''; }
  }
}

function setupTabChangeDetection() {
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      if (isPjudUrl(tab.url)) {
        showDetectingState();
        setTimeout(requestCausaDetection, 800);
      }
    } catch (e) {
      // Tab may have closed
    }
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
      chrome.tabs.query({ active: true, currentWindow: true }).then(([active]) => {
        const url = changeInfo.url || active?.url;
        if (active?.id === tabId && isPjudUrl(url)) {
          showDetectingState();
        }
      });
    }
    if (changeInfo.status === 'complete') {
      chrome.tabs.query({ active: true, currentWindow: true }).then(([active]) => {
        if (active?.id === tabId && isPjudUrl(active.url)) {
          setTimeout(requestCausaDetection, 1000);
        }
      });
    }
  });
}

async function requestCausaDetection() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    if (!isPjudUrl(tab.url)) {
      isDetecting = false;
      restoreLastDetectedCausaUI();
      return;
    }

    const response = await chrome.tabs.sendMessage(tab.id, { action: 'detect_causa' });
    isDetecting = false;
    if (response?.causa) {
      await displayDetectedCausa(response.causa);
    } else if (response && !response.error) {
      await displayDetectedCausa(null);
    }
  } catch (e) {
    isDetecting = false;
    restoreLastDetectedCausaUI();
  }
}

/**
 * Consulta la fecha de última sincronización de una causa.
 */
async function fetchSyncState(userId, rol, tribunal = '') {
  const empty = { lastSyncedAt: null };
  if (!userId || !rol || typeof supabase?.fetch !== 'function') return empty;
  try {
    const rolClean = (rol || '').trim();
    const triClean = (tribunal || '').trim();
    let endpoint = `/rest/v1/cases?user_id=eq.${userId}&rol=eq.${encodeURIComponent(rolClean)}&select=id,tribunal,last_synced_at&limit=5`;
    if (triClean) {
      endpoint += `&tribunal=eq.${encodeURIComponent(triClean)}`;
    }
    const response = await supabase.fetch(endpoint);
    if (!response.ok) return empty;
    const cases = await response.json();
    if (!Array.isArray(cases) || cases.length === 0) return empty;

    const tri = triClean.toLowerCase();
    const target = cases.find(c => (c.tribunal || '').trim().toLowerCase() === tri) || null;
    if (!target) return empty;

    return { lastSyncedAt: target.last_synced_at || null };
  } catch (e) {
    console.error('[fetchSyncState] error:', e);
    return empty;
  }
}

/**
 * Persiste causa sincronizada en chrome.storage.local para recuperar
 * tribunal/carátula al re-entrar a la causa sin DOM1 disponible.
 */
async function saveSyncedCausaRegistry(causa) {
  if (!causa?.rol) return;
  try {
    const result = await new Promise(resolve => {
      chrome.storage.local.get(['synced_causas_registry'], r => resolve(r.synced_causas_registry || []));
    });
    const registry = Array.isArray(result) ? result : [];
    const key = `${causa.rol}|${(causa.tribunal || '').trim()}|${(causa.caratula || '').trim()}`;
    const exists = registry.some(c =>
      `${c.rol}|${(c.tribunal || '').trim()}|${(c.caratula || '').trim()}` === key
    );
    if (!exists) {
      registry.push({ rol: causa.rol, tribunal: (causa.tribunal || '').trim(), caratula: (causa.caratula || '').trim(), savedAt: Date.now() });
      if (registry.length > 500) registry.splice(0, registry.length - 500);
      await new Promise(resolve => { chrome.storage.local.set({ synced_causas_registry: registry }, resolve); });
      console.log('[SyncRegistry] Causa registrada:', key);
    }
  } catch (e) {
    console.warn('[SyncRegistry] Error guardando:', e.message);
  }
}

/**
 * Aplica UI según estado de sync.
 * Solo muestra la fecha de última sincronización y el botón apropiado.
 */
function applySyncStateUI(causa, syncState) {
  const syncStatus = document.getElementById('sync-status');
  const syncStatusLine = document.getElementById('sync-status-line');
  const changesBanner = document.getElementById('changes-detected-banner');
  const syncBtn = document.getElementById('sync-btn');
  if (!syncBtn) return;

  if (changesBanner) changesBanner.style.display = 'none';

  const lastSyncedAt = syncState?.lastSyncedAt ?? null;

  if (lastSyncedAt) {
    const syncDateStr = formatSyncDate(lastSyncedAt);
    if (syncStatus && syncStatusLine) {
      syncStatusLine.textContent = `Sincronizada el ${syncDateStr}`;
      syncStatus.className = 'sync-status sync-status-ok';
      syncStatus.style.display = 'block';
    }
    syncBtn.innerHTML = '<span class="btn-icon">↻</span> Buscar actualizaciones';
    syncBtn.disabled = false;
  } else {
    if (syncStatus) syncStatus.style.display = 'none';
    syncBtn.innerHTML = '<span class="btn-icon">⚡</span> Sincronizar';
    syncBtn.disabled = false;
  }

  lastSyncState = {
    lastSyncedAt,
    rol: causa?.rol || '',
    tribunal: causa?.tribunal || '',
  };
}

async function displayDetectedCausa(causa) {
  isDetecting = false;

  // During sync, freeze UI to keep showing the syncing causa
  if (isSyncing) return;

  const isSame = typeof CAUSA_IDENTITY !== 'undefined' && CAUSA_IDENTITY.isSameCausa
    ? CAUSA_IDENTITY.isSameCausa(causa, lastDetectedCausa)
    : false;

  if (causa && lastDetectedCausa && isSame) {
    if (!causa.caratula && lastDetectedCausa.caratula) causa = { ...causa, caratula: lastDetectedCausa.caratula };
    if (!causa.tribunal && lastDetectedCausa.tribunal) causa = { ...causa, tribunal: lastDetectedCausa.tribunal };
    lastDetectedCausa = causa;
    // Causa unchanged + sync state already fetched → skip re-render to avoid flickering
    if (lastSyncState) return;
  }

  const causaChanged = !isSame;
  lastDetectedCausa = causa;

  if (causaChanged) {
    lastSyncState = null;
    const compactEl = document.getElementById('sync-compact');
    if (compactEl) {
      compactEl.style.display = 'none';
      const resultEl = document.getElementById('sync-compact-result');
      const detailsEl = document.getElementById('sync-compact-details');
      if (resultEl) resultEl.innerHTML = '';
      if (detailsEl) detailsEl.innerHTML = '';
    }
    const syncStatus = document.getElementById('sync-status');
    if (syncStatus) syncStatus.style.display = 'none';
    const changesBanner = document.getElementById('changes-detected-banner');
    if (changesBanner) changesBanner.style.display = 'none';
    hideCausaPackagePreview();
  }

  const syncBtn = document.getElementById('sync-btn');
  const causaRol = document.getElementById('causa-rol');
  const causaTribunal = document.getElementById('causa-tribunal');
  const causaCaratula = document.getElementById('causa-caratula');

  if (syncBtn) syncBtn.style.display = '';

  if (!causa) {
    causaRol.textContent = '--';
    causaTribunal.textContent = 'No se detectó una causa en esta página';
    causaCaratula.textContent = '';
    hideCausaPackagePreview();
    const syncStatus = document.getElementById('sync-status');
    if (syncStatus) syncStatus.style.display = 'none';
    const changesBanner = document.getElementById('changes-detected-banner');
    if (changesBanner) changesBanner.style.display = 'none';
    if (syncBtn) syncBtn.disabled = true;
    return;
  }

  causaRol.textContent = `ROL: ${causa.rol}`;
  causaTribunal.textContent = causa.tribunal ? `Tribunal: ${causa.tribunal}` : `Fuente: ${causa.rolSource || 'PJUD'}`;
  causaCaratula.textContent = causa.caratula ? `Carátula: ${causa.caratula}` : '';

  if (currentUser?.id && causa.rol) {
    const syncState = await fetchSyncState(currentUser.id, causa.rol, causa.tribunal || '');
    applySyncStateUI(causa, syncState);
  }
}

/** Actualiza el badge de cuadernos cuando llega un CausaPackage del service worker */
function updateCausaPackagePreview(nCuadernos) {
  const pkgEl = document.getElementById('causa-package-preview');
  const cuadernosEl = document.getElementById('causa-cuadernos');
  if (!pkgEl || !cuadernosEl) return;

  if (nCuadernos > 0) {
    cuadernosEl.textContent = `${nCuadernos} cuaderno${nCuadernos !== 1 ? 's' : ''}`;
    pkgEl.style.display = 'flex';
  } else {
    hideCausaPackagePreview();
  }
}

function hideCausaPackagePreview() {
  const pkgEl = document.getElementById('causa-package-preview');
  if (pkgEl) pkgEl.style.display = 'none';
}

// ══════════════════════════════════════════════════════════
// 7. SYNC v2 — Flujo directo a API + SSE (4.18)
// ══════════════════════════════════════════════════════════

async function handleSync() {
  if (isSyncing || !lastDetectedCausa) return;
  if (!currentUser) { showNotification('Debe iniciar sesión primero', 'error'); return; }

  isSyncing = true;
  syncingCausaInfo = {
    rol: lastDetectedCausa.rol,
    tribunal: lastDetectedCausa.tribunal || '',
    caratula: lastDetectedCausa.caratula || '',
  };

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.disabled = true;

  const syncBtn = document.getElementById('sync-btn');
  const compactEl = document.getElementById('sync-compact');
  const waitBanner = document.getElementById('sync-wait-banner');
  const causaRol = document.getElementById('causa-rol');

  syncBtn.disabled = true;
  syncBtn.innerHTML = '<span class="btn-icon spinner">⟳</span> Sincronizando…';
  compactEl.style.display = 'block';
  if (waitBanner) {
    const parts = [`<strong>${escapeHtml(syncingCausaInfo.rol)}</strong>`];
    if (syncingCausaInfo.tribunal) parts.push(escapeHtml(syncingCausaInfo.tribunal));
    if (syncingCausaInfo.caratula) parts.push(escapeHtml(syncingCausaInfo.caratula));
    waitBanner.innerHTML = `<span class="sync-wait-icon">⟳</span><span>Sincronizando: ${parts.join(' · ')}</span>`;
    waitBanner.style.display = 'flex';
  }

  document.getElementById('sync-compact-result').innerHTML = '';
  document.getElementById('sync-compact-details').innerHTML = '';
  const sizeWarnings = document.getElementById('size-warnings-content');
  if (sizeWarnings) { sizeWarnings.style.display = 'none'; sizeWarnings.innerHTML = ''; }

  updateProgress(0, 'Conectando...');

  let syncSuccess = false;

  try {
    updateProgress(5, 'Extrayendo paquete de la causa...');
    const causaPackage = await getCausaPackage();
    if (!causaPackage) throw new Error('No se pudo obtener el paquete de la causa. Asegúrese de estar viendo el modal de una causa en PJUD.');

    const nCuadernos = causaPackage.cuadernos?.length || 0;
    updateCausaPackagePreview(nCuadernos);

    const session = await supabase.getSession();
    if (!session?.access_token) throw new Error('Sesión no disponible. Por favor recargue la extensión.');

    updateProgress(10, `Iniciando sync: ${nCuadernos} cuaderno(s)...`);
    const syncResult = await callSyncWithSSE(causaPackage, session.access_token);

    showSyncResultsV2(syncResult);

    if (syncResult) await storeSyncBadge(syncResult);

    if (lastDetectedCausa?.rol && currentUser?.id) {
      const syncState = await fetchSyncState(currentUser.id, lastDetectedCausa.rol, lastDetectedCausa.tribunal || '');
      applySyncStateUI(lastDetectedCausa, syncState);
      await saveSyncedCausaRegistry(lastDetectedCausa);
    }

    if (casesLoaded) { casesLoaded = false; loadCases(); }
    syncSuccess = true;

  } catch (error) {
    console.error('[Sync] Error:', error);
    updateProgress(100, `Error: ${error.message}`, 'error');
    renderCompactResult(null, `Error: ${error.message}`, 'error');
  }

  isSyncing = false;
  if (logoutBtn) logoutBtn.disabled = false;

  if (waitBanner) {
    waitBanner.style.display = 'none';
    waitBanner.innerHTML = '<span class="sync-wait-icon">⟳</span><span>Sincronizando en el servidor. Puede seguir navegando.</span>';
  }

  if (syncSuccess) {
    syncBtn.innerHTML = '<span class="btn-icon">↻</span> Buscar actualizaciones';
    syncBtn.disabled = false;
    setTimeout(() => {
      syncingCausaInfo = null;
      requestCausaDetection();
    }, 2000);
  } else {
    syncingCausaInfo = null;
    syncBtn.innerHTML = '<span class="btn-icon">⚡</span> Sincronizar';
    syncBtn.disabled = !lastDetectedCausa;
  }
}

/**
 * Obtiene el CausaPackage del service worker (causaPackageStore) o,
 * si no está disponible, lo solicita al content script del tab activo.
 */
async function getCausaPackage() {
  // Intentar desde el service worker primero (ya extraído por JwtExtractor)
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      const response = await chrome.runtime.sendMessage({ type: 'get_causa_package', tabId: tab.id });
      if (response?.status === 'found' && response.package) {
        console.log('[4.18] CausaPackage desde service worker:', response.package.rol);
        return response.package;
      }
    }
  } catch (e) {
    console.warn('[4.18] No se pudo obtener del service worker:', e.message);
  }

  // Fallback: pedir extracción al content script
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return null;
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'extract_causa_package' });
    if (response?.causaPackage) {
      console.log('[4.18] CausaPackage desde content script:', response.causaPackage.rol);
      // Poblar el store del service worker para futuras consultas
      chrome.runtime.sendMessage({
        type: 'causa_package',
        package: response.causaPackage,
      }).catch(() => {});
      return response.causaPackage;
    }
  } catch (e) {
    console.warn('[4.18] No se pudo obtener del content script:', e.message);
  }

  return null;
}

/**
 * Llama a /api/scraper/sync con el CausaPackage y consume el SSE stream.
 * El servidor continúa aunque el cliente se desconecte.
 */
async function callSyncWithSSE(causaPackage, accessToken) {
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
    // Fallback JSON (compatibilidad)
    return await response.json();
  }

  // Consumir SSE stream
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

      // Parsear bloques SSE completos (separados por \n\n)
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

        handleSSEEvent(event, data);

        if (event === 'complete') syncResult = data;
        else if (event === 'error') errorMsg = data.message;
      }
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }

  if (errorMsg) throw new Error(errorMsg);
  return syncResult;
}

/**
 * Procesa cada evento SSE recibido y actualiza la UI.
 */
function handleSSEEvent(event, data) {
  switch (event) {
    case 'progress': {
      const total = data.total || 0;
      const current = data.current || 0;
      const pct = total > 0 ? 10 + Math.round((current / total) * 80) : 15;
      updateProgress(pct, data.message);

      break;
    }
    case 'complete':
      updateProgress(100, '¡Sincronización completada!', 'success');
      break;
    case 'error':
      updateProgress(100, `Error: ${data.message}`, 'error');
      break;
  }
}

/**
 * Muestra resultado de sync/actualización.
 * Solo info relevante para el abogado: qué hay nuevo, qué falló.
 */
function showSyncResultsV2(syncResult) {
  if (!syncResult) return;

  const newDocs = syncResult.documents_new || [];
  const changes = syncResult.changes || [];
  const failedCount = syncResult.documents_failed || 0;
  const errors = syncResult.errors || [];
  const isFirstSync = syncResult.is_first_sync;

  const el = document.getElementById('sync-compact-result');
  if (!el) return;

  let html = '';
  const hasNovelties = newDocs.length > 0 || changes.length > 0;

  if (isFirstSync && newDocs.length > 0) {
    html += `<div class="result-summary result-success">`;
    html += `<p><strong>${newDocs.length} documento${newDocs.length !== 1 ? 's' : ''} sincronizado${newDocs.length !== 1 ? 's' : ''}</strong></p>`;
    html += `</div>`;
  } else if (hasNovelties) {
    // Documentos nuevos
    if (newDocs.length > 0) {
      html += `<div class="result-summary result-success">`;
      html += `<p><strong>${newDocs.length} documento${newDocs.length !== 1 ? 's' : ''} nuevo${newDocs.length !== 1 ? 's' : ''}</strong></p>`;
      const showDocs = newDocs.slice(0, 5);
      for (const doc of showDocs) {
        const parts = [];
        if (doc.document_type) parts.push(capitalizeFirst(doc.document_type));
        if (doc.folio) parts.push(`folio ${doc.folio}`);
        if (doc.cuaderno) parts.push(doc.cuaderno);
        html += `<p class="result-detail">· ${parts.join(' — ') || doc.filename}</p>`;
      }
      if (newDocs.length > 5) {
        html += `<p class="result-detail">… y ${newDocs.length - 5} más</p>`;
      }
      html += `</div>`;
    }

    // Cambios detectados (diff)
    if (changes.length > 0) {
      html += `<div class="result-changes">`;
      html += `<p class="result-changes-title"><strong>Cambios detectados:</strong></p>`;
      for (const c of changes.slice(0, 10)) {
        html += `<p class="result-detail">· ${escapeHtml(c.description)}</p>`;
      }
      if (changes.length > 10) {
        html += `<p class="result-detail">… y ${changes.length - 10} más</p>`;
      }
      html += `</div>`;
    }
  } else {
    html += `<div class="result-summary result-info"><p>Sin novedades — todo al día</p></div>`;
  }

  if (failedCount > 0) {
    html += `<p class="result-detail error-text">${failedCount} documento${failedCount !== 1 ? 's' : ''} no se pudo descargar</p>`;
  }

  if (errors.length > 0) {
    html += `<div class="result-errors">${
      errors.slice(0, 3).map(e => `<p class="result-detail error-text">· ${escapeHtml(e)}</p>`).join('')
    }</div>`;
  }

  el.innerHTML = html;

  if (lastDetectedCausa && syncResult.rol === lastDetectedCausa.rol &&
      (syncResult.tribunal || '') === (lastDetectedCausa.tribunal || '')) {
    if (syncResult.tribunal && !lastDetectedCausa.tribunal) {
      lastDetectedCausa = { ...lastDetectedCausa, tribunal: syncResult.tribunal };
    }
  }
}

/** Resultado de error o warning simplificado */
function renderCompactResult(results, errorMsg, type) {
  const el = document.getElementById('sync-compact-result');
  if (!el) return;
  if (errorMsg) {
    el.innerHTML = `<div class="result-summary result-error"><p>${escapeHtml(errorMsg)}</p></div>`;
    return;
  }
  if (!results) return;
  // Delegar al nuevo renderer si es un SyncResult completo
  if (results.documents_new !== undefined) {
    showSyncResultsV2(results);
  }
}

// ══════════════════════════════════════════════════════════
// 8. TAB MIS CAUSAS — Fetch + Render
// ══════════════════════════════════════════════════════════

async function loadCases() {
  const listEl = document.getElementById('cases-list');
  const emptyEl = document.getElementById('cases-empty');
  const skeletonEl = document.getElementById('cases-skeleton');
  const errorEl = document.getElementById('cases-error');

  listEl.innerHTML = '';
  emptyEl.style.display = 'none';
  errorEl.style.display = 'none';
  skeletonEl.style.display = 'block';

  try {
    const session = await supabase.getSession();
    if (!session?.access_token) throw new Error('Sin sesión activa');

    const response = await fetch(CONFIG.API.CASES, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    const { cases } = await response.json();
    skeletonEl.style.display = 'none';
    casesLoaded = true;

    if (!cases || cases.length === 0) {
      emptyEl.style.display = 'flex';
      return;
    }

    // 4.19: Enriquecer con badges de sync reciente (chrome.storage.local)
    const badges = await getSyncBadges();
    const enriched = cases.map(c => ({
      ...c,
      new_since_sync: badges[c.id]?.newCount || 0,
    }));

    listEl.innerHTML = enriched.map(renderCaseCard).join('');
  } catch (error) {
    console.error('[Sidepanel] Error cargando causas:', error);
    skeletonEl.style.display = 'none';
    errorEl.style.display = 'block';
    document.getElementById('cases-error-msg').textContent = error.message;
  }
}

function renderCaseCard(c) {
  const docCount = c.document_count || 0;
  const timeAgo = c.last_synced_at ? getTimeAgo(c.last_synced_at) : 'Sin sincronizar';
  const tribunalDisplay = c.tribunal || 'Tribunal no disponible';
  const newCount = c.new_since_sync || 0;

  let freshness = 'stale';
  if (c.last_synced_at) {
    const hoursSince = (Date.now() - new Date(c.last_synced_at).getTime()) / (1000 * 60 * 60);
    if (hoursSince < 24) freshness = 'fresh';
    else if (hoursSince < 72) freshness = 'recent';
  }

  return `
    <div class="case-card" data-case-id="${escapeHtml(c.id)}">
      <div class="case-header">
        <span class="case-rol">${escapeHtml(c.rol)}</span>
        <div class="case-badges">
          ${newCount > 0 ? `<span class="badge-new" title="${newCount} documento(s) nuevo(s) desde última sync">Nuevo</span>` : ''}
          <span class="case-badge badge-${freshness}">${docCount} doc${docCount !== 1 ? 's' : ''}</span>
          <button class="case-delete-btn" title="Eliminar causa"
            data-del-id="${escapeHtml(c.id)}"
            data-del-rol="${escapeHtml(c.rol)}"
            data-del-docs="${docCount}">✕</button>
        </div>
      </div>
      <p class="case-tribunal">${escapeHtml(tribunalDisplay)}</p>
      <div class="case-footer">
        <span class="case-time">${timeAgo}</span>
        ${newCount > 0 ? `<span class="new-docs-hint">${newCount} doc${newCount !== 1 ? 's' : ''} nuevo${newCount !== 1 ? 's' : ''}</span>` : ''}
      </div>
    </div>
  `;
}

// ══════════════════════════════════════════════════════════
// 9. DELETE CAUSA — Modal + API call
// ══════════════════════════════════════════════════════════

let pendingDelete = null; // { id, rol, docs }

function setupDeleteListeners() {
  document.getElementById('cases-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.case-delete-btn');
    if (!btn) return;
    e.stopPropagation();

    if (isSyncing) {
      showNotification('No se puede eliminar mientras se sincroniza', 'warning');
      return;
    }

    const id = btn.dataset.delId;
    const rol = btn.dataset.delRol;
    const docs = parseInt(btn.dataset.delDocs, 10) || 0;

    pendingDelete = { id, rol, docs };

    const modal = document.getElementById('delete-modal');
    document.getElementById('delete-modal-title').textContent = `¿Eliminar causa ${rol}?`;
    const detail = docs > 0
      ? `Se eliminarán permanentemente ${docs} documento${docs !== 1 ? 's' : ''} sincronizado${docs !== 1 ? 's' : ''} y todo su historial.`
      : 'Se eliminará la causa y todo su historial.';
    document.getElementById('delete-modal-detail').textContent = detail;
    document.getElementById('delete-confirm-btn').disabled = false;
    document.getElementById('delete-confirm-btn').textContent = 'Eliminar';
    modal.style.display = 'flex';
  });

  document.getElementById('delete-cancel-btn')?.addEventListener('click', closeDeleteModal);

  document.getElementById('delete-modal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeDeleteModal();
  });

  document.getElementById('delete-confirm-btn')?.addEventListener('click', confirmDelete);
}

function closeDeleteModal() {
  document.getElementById('delete-modal').style.display = 'none';
  pendingDelete = null;
}

async function confirmDelete() {
  if (!pendingDelete) return;

  const confirmBtn = document.getElementById('delete-confirm-btn');
  const cancelBtn = document.getElementById('delete-cancel-btn');
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Eliminando…';
  cancelBtn.style.display = 'none';

  try {
    const session = await supabase.getSession();
    if (!session?.access_token) throw new Error('Sin sesión activa');

    const response = await fetch(CONFIG.API.CASES, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ case_id: pendingDelete.id }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    const card = document.querySelector(`.case-card[data-case-id="${pendingDelete.id}"]`);
    if (card) {
      card.style.transition = 'opacity 0.25s, transform 0.25s';
      card.style.opacity = '0';
      card.style.transform = 'translateX(20px)';
      setTimeout(() => {
        card.remove();
        const listEl = document.getElementById('cases-list');
        if (listEl && !listEl.children.length) {
          document.getElementById('cases-empty').style.display = 'flex';
        }
      }, 250);
    }

    closeDeleteModal();
    showNotification(`Causa ${pendingDelete.rol} eliminada`, 'success');

    if (lastDetectedCausa && pendingDelete.rol === lastDetectedCausa.rol) {
      lastSyncState = null;
      applySyncStateUI(lastDetectedCausa, { lastSyncedAt: null });
      const compactEl = document.getElementById('sync-compact');
      if (compactEl) {
        compactEl.style.display = 'none';
        const resultEl = document.getElementById('sync-compact-result');
        const detailsEl = document.getElementById('sync-compact-details');
        if (resultEl) resultEl.innerHTML = '';
        if (detailsEl) detailsEl.innerHTML = '';
      }
    }

  } catch (error) {
    console.error('[Delete] Error:', error);
    confirmBtn.textContent = 'Eliminar';
    confirmBtn.disabled = false;
    cancelBtn.style.display = '';
    showNotification(`Error: ${error.message}`, 'error');
  }
}

// ══════════════════════════════════════════════════════════
// 4.19: SYNC BADGES — chrome.storage.local
// Persiste la info de documentos nuevos por sync para
// mostrar badge "Nuevo" en Mis Causas sin consultas extra a DB.
// ══════════════════════════════════════════════════════════

/**
 * Guarda un badge de sync en chrome.storage.local.
 * Se llama tras un sync exitoso con documentos nuevos.
 */
async function storeSyncBadge(syncResult) {
  if (!syncResult?.case_id || !syncResult.documents_new?.length) return;
  try {
    const badges = await getSyncBadges();
    badges[syncResult.case_id] = {
      newCount: syncResult.documents_new.length,
      rol: syncResult.rol,
      syncedAt: new Date().toISOString(),
    };
    await new Promise(resolve => chrome.storage.local.set({ sync_badges: badges }, resolve));
    console.log('[4.19] Badge guardado:', syncResult.rol, `(${syncResult.documents_new.length} nuevos)`);
  } catch (e) {
    console.warn('[4.19] Error guardando badge:', e.message);
  }
}

/**
 * Lee los badges de sync del storage.
 * Descarta badges con más de 7 días de antigüedad (auto-limpieza).
 */
async function getSyncBadges() {
  try {
    const result = await new Promise(resolve =>
      chrome.storage.local.get(['sync_badges'], r => resolve(r.sync_badges || {}))
    );
    // Auto-limpiar badges viejos (>7 días)
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let changed = false;
    for (const [id, badge] of Object.entries(result)) {
      if (new Date(badge.syncedAt).getTime() < cutoff) {
        delete result[id];
        changed = true;
      }
    }
    if (changed) {
      await new Promise(resolve => chrome.storage.local.set({ sync_badges: result }, resolve));
    }
    return result;
  } catch (e) {
    return {};
  }
}

// ══════════════════════════════════════════════════════════
// 9. EVENTOS DEL SCRAPER
// ══════════════════════════════════════════════════════════

function setupScraperEventListener() {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'scraper_event') {
      handleScraperEvent(message.event, message.data);
    }
    if (message.type === 'scraper_ready') {
      if (message.causa) displayDetectedCausa(message.causa).catch(() => {});
    }
  });
}

function handleScraperEvent(event, data) {
  switch (event) {
    case 'status': handleStatusUpdate(data); break;
    case 'causa_detected': displayDetectedCausa(data).catch(() => {}); break;
    case 'content_updated': if (data?.causa) displayDetectedCausa(data.causa).catch(() => {}); break;
    case 'causa_package_ready':
      if (data) {
        updateCausaPackagePreview(data.cuadernos || 0);
        console.log('[4.18] CausaPackage listo:', data.rol, `| ${data.cuadernos} cuadernos`);
      }
      break;
    case 'pdf_captured': showNotification(`PDF capturado: ${formatSize(data?.size)}`, 'success'); break;
    case 'pdf_uploaded': handlePdfUploaded(data); break;
    case 'upload_progress': handleUploadProgress(data); break;
    case 'upload_error': handleUploadError(data); break;
    case 'batch_summary': displayBatchSummary(data); break;
  }
}

function handleStatusUpdate(data) {
  if (!data || isSyncing) return;
  const phaseProgress = {
    'initializing': 5, 'no_causa': 100, 'starting': 10,
    'analyzing': 15, 'page_detected': 20,
    'layer1': 30, 'layer1_success': 40, 'layer1_empty': 35,
    'layer2': 45, 'layer2_scoped': 48, 'layer2_table': 50,
    'layer2_found': 55, 'layer2_downloading': 65,
    'validating': 70, 'filtered': 75,
    'uploading': 80, 'complete': 100,
    'all_rejected': 100, 'fallback': 100, 'wrong_page': 100, 'error': 100,
  };
  const progress = phaseProgress[data.phase] || 50;
  const type = ['error', 'no_causa'].includes(data.phase) ? 'error' :
    ['fallback', 'all_rejected', 'wrong_page'].includes(data.phase) ? 'warning' :
      data.phase === 'complete' ? 'success' : 'info';
  updateProgress(progress, data.message, type);
}

// ══════════════════════════════════════════════════════════
// 10. ARCHIVOS GRANDES — Batch Summary
// ══════════════════════════════════════════════════════════

function displayBatchSummary(summary) {
  if (!summary) return;
  const warningsContent = document.getElementById('size-warnings-content');
  if (!warningsContent) return;

  if (summary.resumableCount > 0 || summary.needsConfirmation) {
    warningsContent.style.display = 'block';
    let html = '';
    if (summary.resumableCount > 0 && !summary.needsConfirmation) {
      html += `<div class="warning-banner warning-info"><p><strong>📦 ${summary.resumableCount} archivo(s) grande(s)</strong></p><p class="result-detail">Upload resumible. ~${summary.estimatedTotalUploadFormatted || '...'}</p></div>`;
    }
    if (summary.needsConfirmation && summary.confirmationFiles?.length > 0) {
      for (const file of summary.confirmationFiles) {
        html += `<div class="warning-banner warning-confirm"><p><strong>⚠️ ${file.message?.title || 'Archivo grande'}</strong></p><p class="result-detail">${file.message?.message || file.size}</p></div>`;
      }
    }
    warningsContent.innerHTML = html;
  } else {
    warningsContent.style.display = 'none';
  }
}

function handleUploadProgress(data) {
  if (!data) return;
  showNotification(`${data.filename}: ${data.formatted} (${data.percent}%)`, 'info');
}

function handlePdfUploaded(data) {
  if (!data) return;
  const progress = data.total ? ` [${data.index}/${data.total}]` : '';
  showNotification(`Subido${progress}: ${data.filename}`, 'success');
}

function handleUploadError(data) {
  if (!data) return;
  showNotification(`Error de upload: ${data.error}`, 'error');
}

// ══════════════════════════════════════════════════════════
// 11. UTILIDADES
// ══════════════════════════════════════════════════════════

function updateProgress(percent, message, type = 'info') {
  const bar = document.getElementById('progress-bar');
  const status = document.getElementById('progress-status');
  if (bar) { bar.style.width = percent + '%'; bar.className = `progress-bar progress-${type}`; }
  if (status && message) { status.textContent = message; status.className = `progress-status status-${type}`; }
}

function showNotification(message, type = 'info') {
  const details = document.getElementById('sync-compact-details');
  if (details) {
    const entry = document.createElement('p');
    entry.className = `notification notification-${type}`;
    entry.textContent = `${new Date().toLocaleTimeString()} — ${message}`;
    details.prepend(entry);
    while (details.children.length > 8) details.removeChild(details.lastChild);
  }
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function capitalizeFirst(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function getTimeAgo(dateStr) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);

  if (mins < 1) return 'Ahora mismo';
  if (mins < 60) return `Hace ${mins} min`;
  if (hours < 24) return `Hace ${hours}h`;
  if (days === 1) return 'Ayer';
  if (days < 7) return `Hace ${days} días`;
  if (days < 30) return `Hace ${Math.floor(days / 7)} sem`;
  return new Date(dateStr).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' });
}

/**
 * Formatea una fecha ISO para mostrar en el mensaje de estado de sync.
 * Ej: "28 feb 2026 14:35"
 */
function formatSyncDate(isoStr) {
  try {
    return new Date(isoStr).toLocaleDateString('es-CL', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return ''; }
}
