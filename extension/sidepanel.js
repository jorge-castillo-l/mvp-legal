/**
 * ============================================================
 * SIDEPANEL - "La Cara" del Legal Bot
 * ============================================================
 * v1.2 — Navegación por Tabs: "Sincronizar" + "Mis Causas"
 *
 * Estructura:
 *   1. Estado global y inicialización
 *   2. Autenticación
 *   3. Sistema de Tabs
 *   4. Tab Sincronizar (causa detection, sync)
 *   5. Tab Mis Causas (fetch, render, empty/loading states)
 *   6. Eventos del Scraper (progreso, resultados)
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
let activeTab = 'sync';
let casesLoaded = false;

// ══════════════════════════════════════════════════════════
// 2. INICIALIZACIÓN
// ══════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Sidepanel] Legal Bot v1.2 iniciado');

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
  const tabButtons = document.querySelectorAll('.tab[data-tab]');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      switchTab(tabId);
    });
  });

  // Botón "Ir a Sincronizar" desde empty state
  document.getElementById('go-to-sync-btn')?.addEventListener('click', () => {
    switchTab('sync');
  });

  // Botón reintentar en error de causas
  document.getElementById('cases-retry-btn')?.addEventListener('click', () => {
    casesLoaded = false;
    loadCases();
  });
}

function switchTab(tabId) {
  activeTab = tabId;

  // Actualizar botones
  document.querySelectorAll('.tab[data-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  // Actualizar paneles
  document.querySelectorAll('.tab-content').forEach(panel => {
    panel.classList.toggle('active', panel.id === `tab-${tabId}`);
  });

  // Lazy-load causas al abrir la pestaña por primera vez
  if (tabId === 'cases' && !casesLoaded && currentUser) {
    loadCases();
  }
}

// ══════════════════════════════════════════════════════════
// 5. EVENT LISTENERS (TAB SINCRONIZAR)
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
// 6. DETECCIÓN Y CONFIRMACIÓN DE CAUSA
// ══════════════════════════════════════════════════════════

async function requestCausaDetection() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'detect_causa' });
    if (response?.causa) displayDetectedCausa(response.causa);
    else if (response && !response.error) displayDetectedCausa(null);
  } catch (e) { /* Content script no cargado */ }
}

function displayDetectedCausa(causa) {
  // Preservar caratulado/tribunal ante re-detecciones (ej. durante sync) que los pierdan
  if (causa && lastDetectedCausa && causa.rol === lastDetectedCausa.rol) {
    if (!causa.caratula && lastDetectedCausa.caratula) {
      causa = { ...causa, caratula: lastDetectedCausa.caratula };
    }
    if (!causa.tribunal && lastDetectedCausa.tribunal) {
      causa = { ...causa, tribunal: lastDetectedCausa.tribunal };
    }
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
    causaRol.textContent = '--';
    causaTribunal.textContent = 'No se detectó una causa en esta página';
    causaCaratula.textContent = '';
    docPreview.style.display = 'none';
    if (syncBtn) syncBtn.disabled = true;
    return;
  }

  causaRol.textContent = `ROL: ${causa.rol}`;
  causaTribunal.textContent =
    causa.tribunal ? `Tribunal: ${causa.tribunal}` : `Fuente: ${causa.rolSource}`;
  causaCaratula.textContent =
    causa.caratula ? `Carátula: ${causa.caratula}` : '';

  const preview = causa.documentPreview;
  if (preview && preview.total > 0) {
    docPreview.style.display = 'block';
    docCount.textContent = `${preview.total} documento(s) encontrado(s) + anexos de la causa`;
    const typesHtml = Object.entries(preview.byType)
      .filter(([, count]) => count > 0)
      .map(([type, count]) => `<span class="doc-type-badge">${type}: ${count}</span>`)
      .join('');
    docTypes.innerHTML = typesHtml;
  } else {
    docPreview.style.display = 'none';
  }

  if (syncBtn) syncBtn.disabled = false;
}

// ══════════════════════════════════════════════════════════
// 7. SYNC
// ══════════════════════════════════════════════════════════

async function handleSync() {
  if (isSyncing || !lastDetectedCausa) return;
  if (!currentUser) { showNotification('Debe iniciar sesión primero', 'error'); return; }

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
  document.getElementById('size-warnings-content').style.display = 'none';
  document.getElementById('size-warnings-content').innerHTML = '';
  updateProgress(0, 'Conectando con la página...');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No hay pestaña activa');

    updateProgress(10, 'Iniciando scraper resiliente...');
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'sync' });

    if (response?.error) throw new Error(response.error);
    showSyncResults(response?.results);

    // Refrescar lista de causas si está cargada
    if (casesLoaded) {
      casesLoaded = false;
      loadCases();
    }

    syncBtn.innerHTML = '<span class="btn-icon">✓</span> Sincronizado';
  } catch (error) {
    updateProgress(100, `Error: ${error.message}`, 'error');
    renderCompactResult(null, `Error: ${error.message}`, 'error');
    syncBtn.innerHTML = '<span class="btn-icon">⚡</span> Sincronizar';
  }

  isSyncing = false;
  syncBtn.disabled = lastDetectedCausa ? false : true;
  if (waitBanner) waitBanner.style.display = 'none';

  // Mantener el resultado visible (éxito o error) hasta la próxima sincronización
}

// ══════════════════════════════════════════════════════════
// 8. TAB MIS CAUSAS — Fetch + Render
// ══════════════════════════════════════════════════════════

async function loadCases() {
  const listEl = document.getElementById('cases-list');
  const emptyEl = document.getElementById('cases-empty');
  const skeletonEl = document.getElementById('cases-skeleton');
  const errorEl = document.getElementById('cases-error');

  // Mostrar skeleton, ocultar resto
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

    listEl.innerHTML = cases.map(renderCaseCard).join('');
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

  // Indicador de frescura
  let freshness = 'stale'; // gris
  if (c.last_synced_at) {
    const hoursSince = (Date.now() - new Date(c.last_synced_at).getTime()) / (1000 * 60 * 60);
    if (hoursSince < 24) freshness = 'fresh';       // verde
    else if (hoursSince < 72) freshness = 'recent';  // amarillo
  }

  return `
    <div class="case-card" data-case-id="${c.id}">
      <div class="case-header">
        <span class="case-rol">${escapeHtml(c.rol)}</span>
        <span class="case-badge badge-${freshness}">${docCount} doc${docCount !== 1 ? 's' : ''}</span>
      </div>
      <p class="case-tribunal">${escapeHtml(tribunalDisplay)}</p>
      <div class="case-footer">
        <span class="case-time">${timeAgo}</span>
      </div>
    </div>
  `;
}

// ══════════════════════════════════════════════════════════
// 9. EVENTOS DEL SCRAPER (progreso, resultados)
// ══════════════════════════════════════════════════════════

function setupScraperEventListener() {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'scraper_event') {
      handleScraperEvent(message.event, message.data);
    }
    if (message.type === 'scraper_ready') {
      if (message.causa) displayDetectedCausa(message.causa);
    }
  });
}

function handleScraperEvent(event, data) {
  switch (event) {
    case 'status': handleStatusUpdate(data); break;
    case 'causa_detected': displayDetectedCausa(data); break;
    case 'pdf_captured': showNotification(`PDF capturado: ${formatSize(data?.size)}`, 'success'); break;
    case 'pdf_uploaded': handlePdfUploaded(data); break;
    case 'upload_progress': handleUploadProgress(data); break;
    case 'upload_error': handleUploadError(data); break;
    case 'batch_summary': displayBatchSummary(data); break;
    case 'content_updated': if (data?.causa) displayDetectedCausa(data.causa); break;
  }
}

function handleStatusUpdate(data) {
  if (!data) return;
  const phaseProgress = {
    'initializing': 5, 'no_causa': 100, 'starting': 10,
    'analyzing': 15, 'page_detected': 20,
    'layer1': 30, 'layer1_success': 40, 'layer1_empty': 35,
    'layer2': 45, 'layer2_scoped': 48, 'layer2_table': 50,
    'layer2_found': 55, 'layer2_downloading': 65,
    'validating': 70, 'filtered': 75, 'needs_confirmation': 76,
    'uploading': 80, 'complete': 100,
    'all_rejected': 100, 'fallback': 100, 'wrong_page': 100, 'error': 100,
  };
  const progress = phaseProgress[data.phase] || 50;
  const type = ['error', 'no_causa'].includes(data.phase) ? 'error' :
    ['fallback', 'all_rejected', 'wrong_page'].includes(data.phase) ? 'warning' :
      data.phase === 'complete' ? 'success' : 'info';
  updateProgress(progress, data.message, type);
}

function renderCompactResult(results, errorMsg, type) {
  const el = document.getElementById('sync-compact-result');
  if (!el) return;

  if (errorMsg) {
    el.innerHTML = `<div class="result-summary result-error"><p>${errorMsg}</p></div>`;
    return;
  }

  if (!results) return;
  const duration = results.duration ? `${(results.duration / 1000).toFixed(1)}s` : 'N/A';

  if (results.totalUploaded > 0) {
    el.innerHTML = `
      <div class="result-summary result-success">
        <p><strong>${results.totalUploaded}</strong> documento(s) sincronizado(s)</p>
        <p class="result-detail">ROL: ${results.rol || 'N/A'} · Duración: ${duration}</p>
      </div>
    `;
    if (results.rejectedReasons?.length > 0) {
      el.innerHTML += `<div class="result-filtered"><p class="result-detail">Filtrados: ${results.rejectedReasons.join('; ')}</p></div>`;
    }
  } else if (results.totalFound > 0) {
    el.innerHTML = `<div class="result-summary result-warning"><p>${results.totalFound} documento(s) encontrado(s), todos filtrados.</p></div>`;
  } else {
    el.innerHTML = `<div class="result-summary result-warning"><p>No se detectaron documentos.</p></div>`;
  }

  if (results.errors?.length > 0) {
    el.innerHTML += `<div class="result-errors">${results.errors.map(e => `<p class="result-detail error-text">• ${e}</p>`).join('')}</div>`;
  }
}

function showSyncResults(results) {
  if (!results) return;
  renderCompactResult(results);

  // Actualizar "documentos encontrados" con el total real capturado (incl. anexos)
  if (typeof results.totalFound === 'number' && results.totalFound >= 0) {
    const docPreview = document.getElementById('doc-preview');
    const docCount = document.getElementById('doc-count');
    const docTypes = document.getElementById('doc-types');
    if (docPreview && docCount) {
      docPreview.style.display = 'block';
      docCount.textContent = `${results.totalFound} documento(s) encontrado(s)`;
      if (docTypes && results.totalUploaded !== undefined) {
        const badges = [`subidos: ${results.totalUploaded}`];
        if (results.totalFound > results.totalValidated && results.totalValidated !== undefined) {
          badges.push(`descartados: ${results.totalFound - results.totalValidated}`);
        }
        docTypes.innerHTML = badges.map(b => `<span class="doc-type-badge">${b}</span>`).join('');
      }
    }
  }
}

// ══════════════════════════════════════════════════════════
// 10. ARCHIVOS GRANDES — Batch Summary (dentro de sync-compact)
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
  const el = document.getElementById('resumable-progress');
  const bar = document.getElementById('resumable-bar');
  const status = document.getElementById('resumable-status');
  if (el && bar && status) {
    el.style.display = 'block';
    bar.style.width = `${data.percent}%`;
    status.textContent = `${data.filename}: ${data.formatted} (${data.percent}%)`;
  }
}

function handlePdfUploaded(data) {
  if (!data) return;
  const progress = data.total ? ` [${data.index}/${data.total}]` : '';
  showNotification(`Subido${progress}: ${data.filename}`, 'success');
  if (data.uploadStrategy === 'resumable') {
    setTimeout(() => { const el = document.getElementById('resumable-progress'); if (el) el.style.display = 'none'; }, 1000);
  }
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
    entry.textContent = `${new Date().toLocaleTimeString()} - ${message}`;
    details.prepend(entry);
    while (details.children.length > 10) details.removeChild(details.lastChild);
  }
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.substring(0, max) + '...' : str;
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
