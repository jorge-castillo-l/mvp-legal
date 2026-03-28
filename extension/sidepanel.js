/**
 * ============================================================
 * SIDEPANEL - Caussa Extension
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
 *   3. Sistema de Tabs (Sincronizar + Chat IA)
 *   4. Tab Sincronizar — detección y estado
 *   5. Sync v2 — obtener CausaPackage + SSE
 *   6. Eventos del Scraper
 *   7. Utilidades
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
let isDetecting = false;
let syncingCausaInfo = null;
let syncJustFinished = false;
let privacyConsentGranted = false; // cached consent status for current session

// ══════════════════════════════════════════════════════════
// 2. INICIALIZACIÓN
// ══════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Sidepanel] Caussa v1.3 iniciado');

  await checkAuthentication();
  setupTabs();
  setupEventListeners();
  setupScraperEventListener();
  setupTabChangeDetection();
  await recoverSyncState();

  setTimeout(requestCausaDetection, 1000);
  setInterval(checkAuthentication, 30000);

  window.addEventListener('message', async (event) => {
    if (event.data?.type === 'request_fresh_token') {
      const session = await supabase.ensureFreshSession();
      if (session?.access_token) {
        const iframe = document.getElementById('chat-iframe');
        iframe?.contentWindow?.postMessage({ type: 'auth_token', token: session.access_token }, '*');
      }
    }
    if (event.data?.type === 'case_deleted_from_chat') {
      const { caseId, rol } = event.data;
      cleanupDeletedCaseLocalData(caseId, rol, currentUser?.id).catch(e =>
        console.warn('[Delete] Limpieza local parcial:', e.message)
      );
      if (lastDetectedCausa && rol === lastDetectedCausa.rol) {
        lastSyncState = null;
        applySyncStateUI(lastDetectedCausa, { lastSyncedAt: null });
        const compactEl = document.getElementById('sync-compact');
        if (compactEl) {
          compactEl.style.display = 'none';
          document.getElementById('sync-compact-result').innerHTML = '';
          document.getElementById('sync-compact-details').innerHTML = '';
        }
      }
    }
  });
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

      if (chatIframeLoaded && session.access_token) {
        const iframe = document.getElementById('chat-iframe');
        iframe?.contentWindow?.postMessage({ type: 'auth_token', token: session.access_token }, '*');
      }
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
  const dot = document.getElementById('auth-dot');
  const email = document.getElementById('auth-email');
  dot.className = 'auth-indicator active';
  email.textContent = currentUser.email;
  email.title = currentUser.email;

  document.getElementById('login-btn').style.display = 'none';
  document.getElementById('logout-btn').style.display = 'block';
  document.getElementById('authenticated-content').style.display = 'block';
  document.getElementById('unauthenticated-content').style.display = 'none';
  closeAuthDropdown();
}

function showUnauthenticatedUI() {
  const dot = document.getElementById('auth-dot');
  const email = document.getElementById('auth-email');
  dot.className = 'auth-indicator inactive';
  email.textContent = 'Sin sesión activa';
  email.title = '';

  document.getElementById('login-btn').style.display = 'block';
  document.getElementById('logout-btn').style.display = 'none';
  document.getElementById('authenticated-content').style.display = 'none';
  document.getElementById('unauthenticated-content').style.display = 'block';
  closeAuthDropdown();
}

function toggleAuthDropdown() {
  const dropdown = document.getElementById('auth-dropdown');
  const chevron = document.getElementById('auth-chevron');
  const isOpen = dropdown.style.display !== 'none';
  dropdown.style.display = isOpen ? 'none' : 'block';
  chevron.classList.toggle('open', !isOpen);
}

function closeAuthDropdown() {
  const dropdown = document.getElementById('auth-dropdown');
  const chevron = document.getElementById('auth-chevron');
  if (dropdown) dropdown.style.display = 'none';
  if (chevron) chevron.classList.remove('open');
}

document.addEventListener('click', (e) => {
  const authBar = document.getElementById('auth-section');
  if (authBar && !authBar.contains(e.target)) closeAuthDropdown();
});

window.addEventListener('blur', () => {
  closeAuthDropdown();
});

// ══════════════════════════════════════════════════════════
// 4. SISTEMA DE TABS
// ══════════════════════════════════════════════════════════

function setupTabs() {
  document.querySelectorAll('.tab[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tabId) {
  activeTab = tabId;
  closeAuthDropdown();

  document.querySelectorAll('.tab[data-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-content').forEach(panel => {
    panel.classList.toggle('active', panel.id === `tab-${tabId}`);
  });

  if (tabId === 'chat') {
    loadChatIframe();
  }
}

let chatIframeLoaded = false;
async function loadChatIframe() {
  const iframe = document.getElementById('chat-iframe');
  if (!iframe) return;

  const session = await supabase.getSession();
  const token = session?.access_token ?? '';
  const chatUrl = `${CONFIG.DASHBOARD_URL}/chat?token=${encodeURIComponent(token)}`;

  if (chatIframeLoaded && iframe.src.includes('/chat')) {
    iframe.contentWindow?.postMessage({ type: 'auth_token', token }, '*');
    return;
  }

  iframe.src = chatUrl;
  chatIframeLoaded = true;
}

// ══════════════════════════════════════════════════════════
// 5. EVENT LISTENERS
// ══════════════════════════════════════════════════════════

function setupEventListeners() {
  document.getElementById('auth-toggle')?.addEventListener('click', toggleAuthDropdown);

  document.getElementById('login-btn')?.addEventListener('click', () => {
    chrome.tabs.create({ url: CONFIG.PAGES.LOGIN });
  });

  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await supabase.signOut();
    currentUser = null;
    currentSession = null;
    privacyConsentGranted = false;
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
  if (isSyncing) return;

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
    syncJustFinished = false;
    try {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      if (isPjudUrl(tab.url)) {
        if (isSyncing) return;
        showDetectingState();
        setTimeout(requestCausaDetection, 800);
      }
    } catch (e) {
      // Tab may have closed
    }
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
      syncJustFinished = false;
      chrome.tabs.query({ active: true, currentWindow: true }).then(([active]) => {
        const url = changeInfo.url || active?.url;
        if (active?.id === tabId && isPjudUrl(url) && !isSyncing) {
          showDetectingState();
        }
      });
    }
    if (changeInfo.status === 'complete') {
      syncJustFinished = false;
      chrome.tabs.query({ active: true, currentWindow: true }).then(([active]) => {
        if (active?.id === tabId && isPjudUrl(active.url) && !isSyncing) {
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
    } else {
      restoreLastDetectedCausaUI();
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
  if (isSyncing) return;

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

  if (isSyncing) return;
  if (syncJustFinished) return;

  const isSame = typeof CAUSA_IDENTITY !== 'undefined' && CAUSA_IDENTITY.isSameCausa
    ? CAUSA_IDENTITY.isSameCausa(causa, lastDetectedCausa)
    : false;

  if (causa && lastDetectedCausa && isSame) {
    if (!causa.caratula && lastDetectedCausa.caratula) causa = { ...causa, caratula: lastDetectedCausa.caratula };
    if (!causa.tribunal && lastDetectedCausa.tribunal) causa = { ...causa, tribunal: lastDetectedCausa.tribunal };
    lastDetectedCausa = causa;
    // Causa unchanged + sync state already fetched → skip re-render to avoid flickering
    if (lastSyncState) {
      restoreLastDetectedCausaUI();
      return;
    }
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
// 7. SYNC v2 — Delegated to Service Worker (resilient)
//
// The sidepanel triggers sync and extracts the CausaPackage,
// then delegates execution to the Service Worker which runs
// the SSE loop independently. If the panel closes mid-sync,
// the SW continues and stores the result. On reopen the panel
// recovers the state from chrome.storage.local.
// ══════════════════════════════════════════════════════════

async function handleSync() {
  if (isSyncing || !lastDetectedCausa) return;
  if (!currentUser) { showNotification('Debe iniciar sesión primero', 'error'); return; }

  const consentOk = await ensurePrivacyConsent();
  if (!consentOk) return;

  isSyncing = true;
  syncingCausaInfo = {
    rol: lastDetectedCausa.rol,
    tribunal: lastDetectedCausa.tribunal || '',
    caratula: lastDetectedCausa.caratula || '',
  };

  enterSyncingUI();
  updateProgress(0, 'Conectando...');

  try {
    updateProgress(5, 'Extrayendo paquete de la causa...');
    const causaPackage = await getCausaPackage();
    if (!causaPackage) throw new Error('No se pudo obtener el paquete de la causa. Asegúrese de estar viendo el modal de una causa en PJUD.');

    const nCuadernos = (causaPackage.otros_cuadernos?.length || 0) + 1;
    updateCausaPackagePreview(nCuadernos);
    updateProgress(10, `Iniciando sync: ${nCuadernos} cuaderno(s)...`);

    chrome.runtime.sendMessage({
      type: 'start_sync',
      causaPackage,
      causaInfo: syncingCausaInfo,
    });

  } catch (error) {
    console.error('[Sync] Error preparing sync:', error);
    updateProgress(100, `Error: ${error.message}`, 'error');
    renderCompactResult(null, `Error: ${error.message}`, 'error');
    leaveSyncingUI(false);
  }
}

function enterSyncingUI() {
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.disabled = true;

  const syncBtn = document.getElementById('sync-btn');
  const compactEl = document.getElementById('sync-compact');

  if (syncBtn) {
    syncBtn.disabled = true;
    syncBtn.innerHTML = '<span class="btn-icon spinner">⟳</span> Sincronizando…';
  }
  if (compactEl) compactEl.style.display = 'block';

  document.getElementById('sync-compact-result').innerHTML = '';
  document.getElementById('sync-compact-details').innerHTML = '';
  const sizeWarnings = document.getElementById('size-warnings-content');
  if (sizeWarnings) { sizeWarnings.style.display = 'none'; sizeWarnings.innerHTML = ''; }
}

function leaveSyncingUI(success) {
  isSyncing = false;
  syncingCausaInfo = null;
  syncJustFinished = true;
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.disabled = false;
  finishSyncUI(success);
}

function handleSyncCompleteFromSW(syncResult) {
  updateProgress(100, '¡Sincronización completada!', 'success');
  showSyncResultsV2(syncResult);
  leaveSyncingUI(true);

  lastSyncState = {
    lastSyncedAt: new Date().toISOString(),
    rol: syncResult.rol || syncingCausaInfo?.rol || lastDetectedCausa?.rol || '',
    tribunal: syncResult.tribunal || syncingCausaInfo?.tribunal || lastDetectedCausa?.tribunal || '',
  };

  (async () => {
    try {
      await storeSyncBadge(syncResult);
      const rol = syncResult.rol || lastDetectedCausa?.rol;
      const tribunal = syncResult.tribunal || lastDetectedCausa?.tribunal || '';
      if (rol && currentUser?.id) {
        const syncState = await fetchSyncState(currentUser.id, rol, tribunal);
        if (lastDetectedCausa) {
          applySyncStateUI(lastDetectedCausa, syncState);
        }
        await saveSyncedCausaRegistry({ rol, tribunal, caratula: syncResult.caratula || lastDetectedCausa?.caratula || '' });
      }
    } catch (e) {
      console.warn('[Sync] Post-sync bookkeeping error:', e.message);
    }
  })();

  const chatIframe = document.getElementById('chat-iframe');
  chatIframe?.contentWindow?.postMessage({ type: 'cases_updated' }, '*');
  chrome.runtime.sendMessage({ type: 'clear_sync_state' }).catch(() => {});
}

function handleSyncErrorFromSW(errorMessage) {
  updateProgress(100, `Error: ${errorMessage}`, 'error');
  renderCompactResult(null, errorMessage, 'error');
  leaveSyncingUI(false);
  chrome.runtime.sendMessage({ type: 'clear_sync_state' }).catch(() => {});
}

async function recoverSyncState() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'get_sync_state' });
    const job = response?.syncJob;
    if (!job) return;

    const STALE_THRESHOLD = 10 * 60 * 1000;

    if (job.status === 'syncing') {
      if (job.startedAt && Date.now() - job.startedAt > STALE_THRESHOLD) {
        console.warn('[Sidepanel] Stale sync job detected, clearing.');
        chrome.runtime.sendMessage({ type: 'clear_sync_state' }).catch(() => {});
        return;
      }

      isSyncing = true;
      syncingCausaInfo = { rol: job.rol, tribunal: job.tribunal, caratula: job.caratula };

      const causaRol = document.getElementById('causa-rol');
      const causaTribunal = document.getElementById('causa-tribunal');
      const causaCaratula = document.getElementById('causa-caratula');
      if (causaRol) causaRol.textContent = `ROL: ${job.rol}`;
      if (causaTribunal) causaTribunal.textContent = job.tribunal ? `Tribunal: ${job.tribunal}` : '';
      if (causaCaratula) causaCaratula.textContent = job.caratula ? `Carátula: ${job.caratula}` : '';

      enterSyncingUI();
      if (job.progress) {
        updateProgress(job.progress.percent, job.progress.message);
      }

    } else if (job.status === 'completed' && job.result) {
      handleSyncCompleteFromSW(job.result);

    } else if (job.status === 'failed') {
      handleSyncErrorFromSW(job.error || 'Error desconocido durante la sincronización.');
    }
  } catch (e) {
    console.warn('[Sidepanel] Error recovering sync state:', e.message);
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

function finishSyncUI(success) {
  const syncBtn = document.getElementById('sync-btn');

  if (syncBtn) {
    if (success) {
      syncBtn.innerHTML = '<span class="btn-icon">↻</span> Buscar actualizaciones';
      syncBtn.disabled = false;
    } else {
      syncBtn.innerHTML = '<span class="btn-icon">⚡</span> Sincronizar';
      syncBtn.disabled = !lastDetectedCausa;
    }
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

    // Cambios detectados (diff) con indicadores de tipo
    if (changes.length > 0) {
      const typeStyle = { added: 'color:#16a34a', changed: 'color:#d97706', removed: 'color:#dc2626' };
      const typePrefix = { added: '+', changed: '~', removed: '−' };

      html += `<div class="result-changes">`;
      html += `<p class="result-changes-title"><strong>Cambios detectados:</strong></p>`;
      for (const c of changes.slice(0, 20)) {
        const style = typeStyle[c.type] || '';
        const prefix = typePrefix[c.type] || '·';
        html += `<p class="result-detail" style="${style}">${prefix} ${escapeHtml(c.description)}</p>`;
      }
      if (changes.length > 20) {
        html += `<p class="result-detail">… y ${changes.length - 20} cambio(s) más</p>`;
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
// 8. LOCAL CLEANUP — usado cuando el Chat IA elimina una causa
// ══════════════════════════════════════════════════════════

/**
 * Limpia todos los datos locales (chrome.storage + service worker) asociados
 * a una causa eliminada para evitar datos huérfanos que afecten re-syncs.
 */
async function cleanupDeletedCaseLocalData(caseId, rol, userId) {
  // 1. sync_badges: badge "Nuevo" keyed por case_id
  try {
    const badges = await getSyncBadges();
    if (badges[caseId]) {
      delete badges[caseId];
      await new Promise(resolve => chrome.storage.local.set({ sync_badges: badges }, resolve));
      console.log('[Delete cleanup] sync_badge eliminado:', caseId);
    }
  } catch (e) {
    console.warn('[Delete cleanup] sync_badges:', e.message);
  }

  // 2. synced_causas_registry: registro de causas sincronizadas keyed por rol
  try {
    const result = await new Promise(resolve =>
      chrome.storage.local.get(['synced_causas_registry'], r => resolve(r.synced_causas_registry || []))
    );
    if (Array.isArray(result)) {
      const filtered = result.filter(entry => entry.rol !== rol);
      if (filtered.length !== result.length) {
        await new Promise(resolve => chrome.storage.local.set({ synced_causas_registry: filtered }, resolve));
        console.log('[Delete cleanup] synced_causas_registry: eliminada entrada para', rol);
      }
    }
  } catch (e) {
    console.warn('[Delete cleanup] synced_causas_registry:', e.message);
  }

  // 3. pdf_hashes cache: hashes de PDFs cacheados por userId+rol
  if (userId && rol) {
    try {
      const cacheKey = `pdf_hashes_${userId}_${rol}`;
      await new Promise(resolve => chrome.storage.local.remove([cacheKey], resolve));
      console.log('[Delete cleanup] pdf_hashes cache eliminado:', cacheKey);
    } catch (e) {
      console.warn('[Delete cleanup] pdf_hashes:', e.message);
    }
  }

  // 4. Notificar al service worker para limpiar causaPackageStore
  try {
    chrome.runtime.sendMessage({ type: 'case_deleted', caseId, rol });
  } catch (e) {
    console.warn('[Delete cleanup] SW notification:', e.message);
  }
}

// ══════════════════════════════════════════════════════════
// 9. SYNC BADGES — chrome.storage.local
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
// 10. EVENTOS DEL SCRAPER
// ══════════════════════════════════════════════════════════

function setupScraperEventListener() {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'scraper_event') {
      handleScraperEvent(message.event, message.data);
    }
    if (message.type === 'scraper_ready') {
      if (message.causa) displayDetectedCausa(message.causa).catch(() => {});
    }
    if (message.type === 'sync_update') {
      handleSyncUpdateFromSW(message);
    }
  });
}

function handleSyncUpdateFromSW(message) {
  const { event, data } = message;
  switch (event) {
    case 'progress':
      updateProgress(data.percent, data.message);
      break;
    case 'complete':
      handleSyncCompleteFromSW(data);
      break;
    case 'error':
      handleSyncErrorFromSW(data.message);
      break;
  }
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
// 11. ARCHIVOS GRANDES — Batch Summary
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
// 12. PRIVACY CONSENT (6.03)
// ══════════════════════════════════════════════════════════

const CONSENT_VERSION = 'v1';

async function checkPrivacyConsent() {
  if (privacyConsentGranted) return true;
  if (!currentUser?.id) return false;

  try {
    const endpoint = `/rest/v1/profiles?id=eq.${currentUser.id}&select=privacy_consent_at,privacy_consent_version`;
    const response = await supabase.fetch(endpoint);
    if (!response.ok) return false;

    const rows = await response.json();
    if (rows.length > 0 && rows[0].privacy_consent_at) {
      privacyConsentGranted = true;
      return true;
    }
    return false;
  } catch (e) {
    console.error('[Consent] Error checking consent:', e.message);
    return false;
  }
}

async function savePrivacyConsent() {
  if (!currentUser?.id) return false;
  try {
    const response = await supabase.fetch(`/rest/v1/profiles?id=eq.${currentUser.id}`, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        privacy_consent_at: new Date().toISOString(),
        privacy_consent_version: CONSENT_VERSION,
      }),
    });
    if (response.ok) {
      privacyConsentGranted = true;
      console.log('[Consent] Privacy consent saved');
      return true;
    }
    console.error('[Consent] Failed to save:', response.status);
    return false;
  } catch (e) {
    console.error('[Consent] Error saving consent:', e.message);
    return false;
  }
}

function showConsentModal() {
  return new Promise((resolve) => {
    const overlay = document.getElementById('privacy-consent-overlay');
    const check1 = document.getElementById('consent-check-1');
    const check2 = document.getElementById('consent-check-2');
    const acceptBtn = document.getElementById('consent-accept-btn');
    const cancelBtn = document.getElementById('consent-cancel-btn');

    check1.checked = false;
    check2.checked = false;
    acceptBtn.disabled = true;
    overlay.style.display = 'flex';

    function updateAcceptState() {
      acceptBtn.disabled = !(check1.checked && check2.checked);
    }

    function cleanup() {
      overlay.style.display = 'none';
      check1.removeEventListener('change', updateAcceptState);
      check2.removeEventListener('change', updateAcceptState);
      acceptBtn.removeEventListener('click', onAccept);
      cancelBtn.removeEventListener('click', onCancel);
    }

    async function onAccept() {
      acceptBtn.disabled = true;
      acceptBtn.textContent = 'Guardando...';
      const saved = await savePrivacyConsent();
      acceptBtn.textContent = 'Aceptar y continuar';
      cleanup();
      resolve(saved);
    }

    function onCancel() {
      cleanup();
      resolve(false);
    }

    check1.addEventListener('change', updateAcceptState);
    check2.addEventListener('change', updateAcceptState);
    acceptBtn.addEventListener('click', onAccept);
    cancelBtn.addEventListener('click', onCancel);
  });
}

async function ensurePrivacyConsent() {
  const hasConsent = await checkPrivacyConsent();
  if (hasConsent) return true;
  return await showConsentModal();
}

// ══════════════════════════════════════════════════════════
// 13. UTILIDADES
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
