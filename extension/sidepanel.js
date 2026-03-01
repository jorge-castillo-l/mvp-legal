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

// ══════════════════════════════════════════════════════════
// 2. INICIALIZACIÓN
// ══════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Sidepanel] Legal Bot v1.3 iniciado');

  await checkAuthentication();
  setupTabs();
  setupEventListeners();
  setupScraperEventListener();

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

async function requestCausaDetection() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'detect_causa' });
    if (response?.causa) {
      await displayDetectedCausa(response.causa);
    } else if (response && !response.error) {
      await displayDetectedCausa(null);
    }
  } catch (e) { /* Content script no cargado */ }
}

/**
 * 4.18: Consulta cases por ROL → retorna document_count + last_synced_at.
 * Usa document_count guardado en DB (no cuenta hashes en tiempo real).
 */
async function fetchSyncState(userId, rol, tribunal = '') {
  if (!userId || !rol || typeof supabase?.fetch !== 'function') return { count: 0, lastSyncedAt: null };
  try {
    const rolClean = (rol || '').trim();
    const endpoint = `/rest/v1/cases?user_id=eq.${userId}&rol=eq.${encodeURIComponent(rolClean)}&select=id,tribunal,document_count,last_synced_at&limit=5`;
    const response = await supabase.fetch(endpoint);
    if (!response.ok) return { count: 0, lastSyncedAt: null };
    const cases = await response.json();
    if (!Array.isArray(cases) || cases.length === 0) return { count: 0, lastSyncedAt: null };

    let target = cases[0];
    if (cases.length > 1 && tribunal) {
      const tri = tribunal.trim().toLowerCase();
      const match = cases.find(c => (c.tribunal || '').trim().toLowerCase() === tri);
      if (match) target = match;
    }

    const count = target.document_count || 0;
    const lastSyncedAt = target.last_synced_at || null;
    console.log('[4.18] fetchSyncState:', { rol, count, lastSyncedAt });
    return { count, lastSyncedAt };
  } catch (e) {
    console.error('[4.18] fetchSyncState error:', e);
    return { count: 0, lastSyncedAt: null };
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
 * 4.18: Aplica UI según estado de sync.
 * Muestra "Puede haber documentos nuevos desde [fecha]" o "Actualizada ✓".
 */
function applySyncStateUI(causa, syncState) {
  const sameCausa = typeof CAUSA_IDENTITY !== 'undefined' && CAUSA_IDENTITY.isSameCausa
    ? CAUSA_IDENTITY.isSameCausa(causa, lastDetectedCausa)
    : (causa && lastDetectedCausa && lastDetectedCausa.rol === causa.rol &&
        (lastDetectedCausa.tribunal || '') === (causa.tribunal || ''));
  if (!causa || !sameCausa) return;

  const docPreview = document.getElementById('doc-preview');
  const docCount = document.getElementById('doc-count');
  const docTypes = document.getElementById('doc-types');
  const syncBtn = document.getElementById('sync-btn');
  const syncStateBanner = document.getElementById('sync-state-banner');
  if (!docPreview || !docCount || !syncBtn) return;

  const count = syncState?.count ?? 0;
  const lastSyncedAt = syncState?.lastSyncedAt ?? null;
  const preview = causa.documentPreview;
  const pageTotal = preview?.total ?? 0;

  if (count > 0) {
    docPreview.style.display = 'block';
    docPreview.classList.add('sync-state-synced');
    docPreview.classList.remove('sync-state-new');

    const hasNewDocs = pageTotal > count;
    const fullySynced = !hasNewDocs && pageTotal > 0;
    const syncDateStr = lastSyncedAt ? formatSyncDate(lastSyncedAt) : null;

    if (hasNewDocs && syncDateStr) {
      docCount.textContent = `Puede haber documentos nuevos desde ${syncDateStr}. Sincronizar?`;
      docCount.classList.remove('sync-badge-synced');
    } else if (hasNewDocs) {
      docCount.textContent = `Puede haber documentos nuevos (${count} sincronizados). Sincronizar?`;
      docCount.classList.remove('sync-badge-synced');
    } else if (fullySynced) {
      docCount.textContent = `Actualizada ✓ (${count} documento${count !== 1 ? 's' : ''})`;
      docCount.classList.add('sync-badge-synced');
    } else {
      docCount.textContent = `${count} documento(s) sincronizado(s)`;
      docCount.classList.add('sync-badge-synced');
    }

    if (docTypes) {
      docTypes.innerHTML = hasNewDocs
        ? '<span class="doc-type-badge">Hay documentos nuevos disponibles</span>'
        : '<span class="doc-type-badge">Todo al día</span>';
    }

    if (fullySynced) {
      syncBtn.innerHTML = '<span class="btn-icon">✓</span> Causa sincronizada';
      syncBtn.disabled = true;
      syncBtn.setAttribute('data-fully-synced', '1');
    } else {
      syncBtn.innerHTML = '<span class="btn-icon">↻</span> Sincronizar documentos nuevos';
      syncBtn.disabled = false;
      syncBtn.removeAttribute('data-fully-synced');
    }

    if (syncStateBanner) {
      syncStateBanner.style.display = 'block';
      syncStateBanner.className = 'sync-state-banner sync-state-banner-info';
      syncStateBanner.textContent = fullySynced
        ? (syncDateStr ? `Sincronizada el ${syncDateStr}` : 'Esta causa está completamente sincronizada.')
        : 'Hay documentos nuevos disponibles.';
    }

    const warn = document.getElementById('sync-context-warning');
    if (warn && hasNewDocs) {
      warn.style.display = 'block';
      warn.innerHTML = `⚠️ ${pageTotal - count} documento(s) nuevo(s). Sincronice antes de consultar a la IA.`;
    } else if (warn) {
      warn.style.display = 'none';
    }
  } else {
    docPreview.classList.remove('sync-state-synced');
    docPreview.classList.add('sync-state-new');
    docCount.classList.remove('sync-badge-synced');
    if (preview && preview.total > 0) {
      docPreview.style.display = 'block';
      docCount.textContent = `${preview.total} folio(s) en cuaderno visible + docs directos y otros cuadernos`;
      if (docTypes) {
        docTypes.innerHTML = (Object.entries(preview.byType || {}).filter(([, c]) => c > 0)
          .map(([type, c]) => `<span class="doc-type-badge">${type}: ${c}</span>`).join('')) || '';
      }
    }
    syncBtn.innerHTML = '<span class="btn-icon">⚡</span> Sincronizar';
    syncBtn.disabled = false;
    syncBtn.removeAttribute('data-fully-synced');
    if (syncStateBanner) syncStateBanner.style.display = 'none';
    const warn = document.getElementById('sync-context-warning');
    if (warn) warn.style.display = 'none';
  }

  lastSyncState = {
    count,
    lastSyncedAt,
    rol: causa.rol,
    tribunal: causa.tribunal || '',
  };
}

async function displayDetectedCausa(causa) {
  if (causa && lastDetectedCausa && causa.rol === lastDetectedCausa.rol) {
    if (!causa.caratula && lastDetectedCausa.caratula) causa = { ...causa, caratula: lastDetectedCausa.caratula };
    if (!causa.tribunal && lastDetectedCausa.tribunal) causa = { ...causa, tribunal: lastDetectedCausa.tribunal };
  }
  lastDetectedCausa = causa;

  const syncBtn = document.getElementById('sync-btn');
  const causaRol = document.getElementById('causa-rol');
  const causaTribunal = document.getElementById('causa-tribunal');
  const causaCaratula = document.getElementById('causa-caratula');
  const docPreview = document.getElementById('doc-preview');
  const docCount = document.getElementById('doc-count');
  const docTypes = document.getElementById('doc-types');

  if (!causa) {
    lastSyncState = null;
    causaRol.textContent = '--';
    causaTribunal.textContent = 'No se detectó una causa en esta página';
    causaCaratula.textContent = '';
    docPreview.style.display = 'none';
    hideCausaPackagePreview();
    const banner = document.getElementById('sync-state-banner');
    const warn = document.getElementById('sync-context-warning');
    if (banner) banner.style.display = 'none';
    if (warn) warn.style.display = 'none';
    if (syncBtn) syncBtn.disabled = true;
    return;
  }

  causaRol.textContent = `ROL: ${causa.rol}`;
  causaTribunal.textContent = causa.tribunal ? `Tribunal: ${causa.tribunal}` : `Fuente: ${causa.rolSource || 'PJUD'}`;
  causaCaratula.textContent = causa.caratula ? `Carátula: ${causa.caratula}` : '';

  if (syncBtn) syncBtn.disabled = false;

  if (currentUser?.id && causa.rol) {
    const syncState = await fetchSyncState(currentUser.id, causa.rol, causa.tribunal || '');
    applySyncStateUI(causa, syncState);
  } else {
    const preview = causa.documentPreview;
    if (preview && preview.total > 0) {
      docPreview.style.display = 'block';
      docCount.textContent = `${preview.total} folio(s) en cuaderno visible + docs directos y otros cuadernos`;
      if (docTypes) {
        docTypes.innerHTML = Object.entries(preview.byType || {})
          .filter(([, c]) => c > 0)
          .map(([type, c]) => `<span class="doc-type-badge">${type}: ${c}</span>`)
          .join('');
      }
      syncBtn.innerHTML = '<span class="btn-icon">⚡</span> Sincronizar';
    } else {
      docPreview.style.display = 'none';
    }
  }
}

/** Actualiza los badges de cuadernos/folios cuando llega un CausaPackage del service worker */
function updateCausaPackagePreview(nCuadernos, nFolios) {
  const pkgEl = document.getElementById('causa-package-preview');
  const cuadernosEl = document.getElementById('causa-cuadernos');
  const foliosEl = document.getElementById('causa-folios');
  if (!pkgEl || !cuadernosEl || !foliosEl) return;

  if (nCuadernos > 0 || nFolios > 0) {
    cuadernosEl.textContent = `${nCuadernos} cuaderno${nCuadernos !== 1 ? 's' : ''}`;
    foliosEl.textContent = `${nFolios} folio${nFolios !== 1 ? 's' : ''}`;
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
  if (document.getElementById('sync-btn')?.getAttribute('data-fully-synced') === '1') return;
  if (lastSyncState?.count >= lastSyncState?.pageTotal && lastSyncState?.pageTotal > 0) return;

  isSyncing = true;
  const syncBtn = document.getElementById('sync-btn');
  const compactEl = document.getElementById('sync-compact');
  const waitBanner = document.getElementById('sync-wait-banner');

  syncBtn.disabled = true;
  syncBtn.innerHTML = '<span class="btn-icon spinner">⟳</span> Sincronizando...';
  compactEl.style.display = 'block';
  if (waitBanner) waitBanner.style.display = 'flex';

  document.getElementById('sync-compact-result').innerHTML = '';
  document.getElementById('sync-compact-details').innerHTML = '';
  const sizeWarnings = document.getElementById('size-warnings-content');
  if (sizeWarnings) { sizeWarnings.style.display = 'none'; sizeWarnings.innerHTML = ''; }

  updateProgress(0, 'Conectando...');

  try {
    // ── 1. Obtener CausaPackage (del service worker o content script)
    updateProgress(5, 'Extrayendo paquete de la causa...');
    const causaPackage = await getCausaPackage();
    if (!causaPackage) throw new Error('No se pudo obtener el paquete de la causa. Asegúrese de estar viendo el modal de una causa en PJUD.');

    // Mostrar cuadernos/folios en el preview
    const nCuadernos = causaPackage.cuadernos?.length || 0;
    const nFolios = causaPackage.folios?.length || 0;
    updateCausaPackagePreview(nCuadernos, nFolios);

    // ── 2. Obtener sesión
    const session = await supabase.getSession();
    if (!session?.access_token) throw new Error('Sesión no disponible. Por favor recargue la extensión.');

    // ── 3. Llamar a la API con SSE
    updateProgress(10, `Iniciando sync: ${nCuadernos} cuaderno(s) · ${nFolios} folio(s) visibles...`);
    const syncResult = await callSyncWithSSE(causaPackage, session.access_token);

    showSyncResultsV2(syncResult);

    // 4.19: Guardar badge de documentos nuevos para Mis Causas
    if (syncResult) await storeSyncBadge(syncResult);

    // ── 4. Actualizar estado de sync
    if (lastDetectedCausa?.rol && currentUser?.id) {
      const syncState = await fetchSyncState(currentUser.id, lastDetectedCausa.rol, lastDetectedCausa.tribunal || '');
      applySyncStateUI(lastDetectedCausa, syncState);
      await saveSyncedCausaRegistry(lastDetectedCausa);
    }

    if (casesLoaded) { casesLoaded = false; loadCases(); }
    syncBtn.innerHTML = '<span class="btn-icon">✓</span> Sincronizado';

  } catch (error) {
    console.error('[Sync] Error:', error);
    updateProgress(100, `Error: ${error.message}`, 'error');
    renderCompactResult(null, `Error: ${error.message}`, 'error');
    syncBtn.innerHTML = '<span class="btn-icon">⚡</span> Sincronizar';
  }

  isSyncing = false;
  syncBtn.disabled = !lastDetectedCausa || syncBtn.getAttribute('data-fully-synced') === '1';
  if (waitBanner) waitBanner.style.display = 'none';
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

      // Indicador de cuaderno (si viene en el evento)
      if (data.cuaderno_current != null && data.cuaderno_total > 0) {
        const cuadernoEl = document.getElementById('cuaderno-progress');
        const cuadernoText = document.getElementById('cuaderno-progress-text');
        if (cuadernoEl && cuadernoText) {
          cuadernoEl.style.display = 'block';
          cuadernoText.textContent = `Cuaderno ${data.cuaderno_current} de ${data.cuaderno_total}`;
        }
      }
      break;
    }
    case 'complete':
      updateProgress(100, '¡Sincronización completada!', 'success');
      hideCuadernoProgress();
      break;
    case 'error':
      updateProgress(100, `Error: ${data.message}`, 'error');
      hideCuadernoProgress();
      break;
  }
}

function hideCuadernoProgress() {
  const el = document.getElementById('cuaderno-progress');
  if (el) el.style.display = 'none';
}

/**
 * 4.18: Resultado enriquecido — N nuevos + lista + N existentes + N errores.
 */
function showSyncResultsV2(syncResult) {
  if (!syncResult) return;

  const newDocs = syncResult.documents_new || [];
  const existingCount = syncResult.documents_existing || 0;
  const failedCount = syncResult.documents_failed || 0;
  const errors = syncResult.errors || [];
  const duration = syncResult.duration_ms ? `${(syncResult.duration_ms / 1000).toFixed(1)}s` : '';

  const el = document.getElementById('sync-compact-result');
  if (!el) return;

  let html = '';

  if (newDocs.length > 0) {
    html += `<div class="result-summary result-success">`;
    html += `<p><strong>Se descargaron ${newDocs.length} documento(s) nuevo(s)</strong></p>`;
    const showDocs = newDocs.slice(0, 5);
    for (const doc of showDocs) {
      const fecha = doc.fecha
        ? new Date(doc.fecha).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })
        : '';
      const folio = doc.folio ? `folio ${doc.folio}` : '';
      const cuaderno = doc.cuaderno ? `(${doc.cuaderno})` : '';
      const tipo = capitalizeFirst(doc.document_type || 'Documento');
      const parts = [tipo, folio, fecha, cuaderno].filter(Boolean);
      html += `<p class="result-detail">· ${parts.join(' ')}</p>`;
    }
    if (newDocs.length > 5) {
      html += `<p class="result-detail">… y ${newDocs.length - 5} más</p>`;
    }
    html += `</div>`;
  } else if (existingCount > 0) {
    html += `<div class="result-summary result-info"><p>No hay documentos nuevos — ${existingCount} ya sincronizado(s)</p></div>`;
  } else {
    html += `<div class="result-summary result-warning"><p>No se descargaron documentos nuevos</p></div>`;
  }

  // Stats secundarias
  const stats = [];
  if (existingCount > 0) stats.push(`${existingCount} ya existentes`);
  if (failedCount > 0) stats.push(`${failedCount} fallidos`);
  if (duration) stats.push(duration);
  if (stats.length > 0) {
    html += `<p class="result-detail stats-line">${stats.join(' · ')}</p>`;
  }

  if (errors.length > 0) {
    html += `<div class="result-errors">${
      errors.slice(0, 3).map(e => `<p class="result-detail error-text">• ${e}</p>`).join('')
    }</div>`;
  }

  el.innerHTML = html;

  // Mantener lastDetectedCausa enriquecida con datos del resultado
  if (lastDetectedCausa && syncResult.rol === lastDetectedCausa.rol) {
    const updates = {};
    if (syncResult.tribunal && !lastDetectedCausa.tribunal) updates.tribunal = syncResult.tribunal;
    if (Object.keys(updates).length) lastDetectedCausa = { ...lastDetectedCausa, ...updates };
  }

  // Actualizar doc-preview con totales reales
  const totalDescargados = newDocs.length + existingCount;
  if (totalDescargados > 0) {
    const docPreview = document.getElementById('doc-preview');
    const docCount = document.getElementById('doc-count');
    if (docPreview && docCount) {
      docPreview.style.display = 'block';
      docCount.textContent = `${totalDescargados} documento(s) procesado(s) (${newDocs.length} nuevos)`;
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
      // JwtExtractor extrajo el CausaPackage — actualizar preview de cuadernos/folios
      if (data) {
        updateCausaPackagePreview(data.cuadernos || 0, data.folios || 0);
        console.log('[4.18] CausaPackage listo:', data.rol, `| ${data.cuadernos} cuadernos, ${data.folios} folios`);
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
