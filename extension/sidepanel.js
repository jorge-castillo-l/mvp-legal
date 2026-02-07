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
 *   4. Tab Sincronizar (causa detection, sync, upload manual)
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
let causaConfirmed = false;
let lastDetectedCausa = null;
let activeTab = 'sync';
let casesLoaded = false; // Evita re-fetch innecesario

// ══════════════════════════════════════════════════════════
// 2. INICIALIZACIÓN
// ══════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Sidepanel] Legal Bot v1.2 iniciado');

  await checkAuthentication();
  setupTabs();
  setupEventListeners();
  setupScraperEventListener();
  setupDragAndDrop();

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

  document.getElementById('confirm-causa-btn')?.addEventListener('click', handleConfirmCausa);
  document.getElementById('sync-btn')?.addEventListener('click', handleSync);
  document.getElementById('analyze-btn')?.addEventListener('click', handleAnalyze);
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
  } catch (e) { /* Content script no cargado */ }
}

function displayDetectedCausa(causa) {
  lastDetectedCausa = causa;

  if (!causa) {
    document.getElementById('causa-rol').textContent = '--';
    document.getElementById('causa-tribunal').textContent = 'No se detectó una causa en esta página';
    document.getElementById('causa-caratula').textContent = '';
    document.getElementById('confirm-causa-btn').style.display = 'none';
    document.getElementById('doc-preview').style.display = 'none';
    document.getElementById('causa-hint').textContent = 'Navegue a una causa en pjud.cl para detectarla';
    updateHeaderStatus('Sin causa detectada', 'warning');
    return;
  }

  document.getElementById('causa-rol').textContent = `ROL: ${causa.rol}`;
  document.getElementById('causa-tribunal').textContent =
    causa.tribunal ? `Tribunal: ${causa.tribunal}` : `Fuente: ${causa.rolSource} (confianza: ${Math.round(causa.rolConfidence * 100)}%)`;
  document.getElementById('causa-caratula').textContent =
    causa.caratula ? `Carátula: ${causa.caratula}` : '';

  const preview = causa.documentPreview;
  if (preview && preview.total > 0) {
    document.getElementById('doc-preview').style.display = 'block';
    document.getElementById('doc-count').textContent = `${preview.total} documento(s) encontrado(s)`;
    const typesHtml = Object.entries(preview.byType)
      .filter(([, count]) => count > 0)
      .map(([type, count]) => `<span class="doc-type-badge">${type}: ${count}</span>`)
      .join('');
    document.getElementById('doc-types').innerHTML = typesHtml;
  } else {
    document.getElementById('doc-preview').style.display = 'none';
  }

  document.getElementById('confirm-causa-btn').style.display = 'block';
  document.getElementById('causa-hint').textContent = 'Verifique que la causa detectada es correcta y confirme';
  updateHeaderStatus(`Causa ${causa.rol} detectada`, 'info');
}

async function handleConfirmCausa() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'confirm_causa' });

    if (response?.status === 'confirmed') {
      causaConfirmed = true;
      document.getElementById('confirm-causa-btn').style.display = 'none';
      document.getElementById('causa-hint').textContent = '✓ Causa confirmada. Lista para sincronizar.';
      document.getElementById('causa-hint').classList.add('hint-success');
      document.getElementById('sync-btn').disabled = false;
      document.getElementById('sync-hint').textContent = 'Presione para capturar y subir los documentos de esta causa';
      updateHeaderStatus(`Causa ${response.causa.rol} confirmada`, 'success');
    } else {
      showNotification(response?.error || 'Error al confirmar', 'error');
    }
  } catch (error) {
    showNotification('Error: ' + error.message, 'error');
  }
}

// ══════════════════════════════════════════════════════════
// 7. SYNC
// ══════════════════════════════════════════════════════════

async function handleSync() {
  if (isSyncing || !causaConfirmed) return;
  if (!currentUser) { showNotification('Debe iniciar sesión primero', 'error'); return; }

  isSyncing = true;
  const syncBtn = document.getElementById('sync-btn');
  syncBtn.disabled = true;
  syncBtn.innerHTML = '<span class="btn-icon spinner">⟳</span> Sincronizando...';
  document.getElementById('sync-progress').style.display = 'block';
  document.getElementById('sync-results').style.display = 'none';
  document.getElementById('manual-upload-section').style.display = 'none';
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
  } catch (error) {
    updateProgress(100, `Error: ${error.message}`, 'error');
    document.getElementById('manual-upload-section').style.display = 'block';
  }

  isSyncing = false;
  syncBtn.disabled = false;
  syncBtn.innerHTML = '<span class="btn-icon">⚡</span> Sincronizar';
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
  const caratula = c.caratula || 'Carátula no disponible';
  const tribunal = c.tribunal || '';

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
      <p class="case-caratula">${escapeHtml(caratula)}</p>
      ${tribunal ? `<p class="case-tribunal">${escapeHtml(tribunal)}</p>` : ''}
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
      updateHeaderStatus('Scraper conectado', 'success');
    }
  });
}

function handleScraperEvent(event, data) {
  switch (event) {
    case 'status': handleStatusUpdate(data); break;
    case 'causa_detected': displayDetectedCausa(data); break;
    case 'causa_confirmed': updateHeaderStatus(`Causa ${data?.rol} confirmada`, 'success'); break;
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
  if (['fallback', 'wrong_page', 'all_rejected'].includes(data.phase)) {
    document.getElementById('manual-upload-section').style.display = 'block';
  }
}

function showSyncResults(results) {
  const section = document.getElementById('sync-results');
  const content = document.getElementById('results-content');
  const manualSection = document.getElementById('manual-upload-section');

  if (!results) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  const duration = results.duration ? `${(results.duration / 1000).toFixed(1)}s` : 'N/A';

  if (results.totalUploaded > 0) {
    content.innerHTML = `
      <div class="result-summary result-success">
        <p><strong>${results.totalUploaded}</strong> documento(s) sincronizado(s)</p>
        <p class="result-detail">ROL: ${results.rol || 'N/A'}</p>
        <p class="result-detail">Capturados: ${results.totalFound} | Validados: ${results.totalValidated} | Rechazados: ${results.totalRejected || 0}</p>
        <p class="result-detail">Red: ${results.layer1Count || 0} | DOM: ${results.layer2Count || 0} | Duración: ${duration}</p>
      </div>
    `;
    if (results.rejectedReasons?.length > 0) {
      content.innerHTML += `<div class="result-filtered"><p><strong>Documentos filtrados:</strong></p>${results.rejectedReasons.map(r => `<p class="result-detail">• ${r}</p>`).join('')}</div>`;
    }
  } else if (results.totalFound > 0) {
    content.innerHTML = `<div class="result-summary result-warning"><p>Se encontraron ${results.totalFound} documento(s) pero todos fueron filtrados</p></div>`;
    manualSection.style.display = 'block';
  } else {
    content.innerHTML = `<div class="result-summary result-warning"><p>No se detectaron documentos automáticamente</p><p class="result-detail">Use la subida manual como alternativa.</p></div>`;
    manualSection.style.display = 'block';
  }

  if (results.errors?.length > 0) {
    content.innerHTML += `<div class="result-errors">${results.errors.map(e => `<p class="result-detail error-text">• ${e}</p>`).join('')}</div>`;
  }
}

// ══════════════════════════════════════════════════════════
// 10. UPLOAD MANUAL (Layer 3)
// ══════════════════════════════════════════════════════════

function setupDragAndDrop() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  if (!dropZone || !fileInput) return;

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drop-zone-active'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drop-zone-active'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drop-zone-active');
    const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
    if (files.length > 0) handleManualUpload(files);
    else showNotification('Solo se aceptan archivos PDF', 'error');
  });
  fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files).filter(f => f.type === 'application/pdf');
    if (files.length > 0) handleManualUpload(files);
    fileInput.value = '';
  });
}

async function handleManualUpload(files) {
  if (!currentUser) { showNotification('Debe iniciar sesión', 'error'); return; }
  const uploadStatus = document.getElementById('upload-status');
  uploadStatus.style.display = 'block';

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    uploadStatus.textContent = `Subiendo ${file.name} (${i + 1}/${files.length})...`;
    uploadStatus.className = 'progress-status status-info';
    try {
      await uploadDirectly(file);
      uploadStatus.textContent = `${file.name} subido exitosamente`;
      uploadStatus.className = 'progress-status status-success';
      // Refrescar causas
      if (casesLoaded) { casesLoaded = false; loadCases(); }
    } catch (error) {
      uploadStatus.textContent = `Error: ${error.message}`;
      uploadStatus.className = 'progress-status status-error';
    }
  }
  setTimeout(() => { uploadStatus.style.display = 'none'; }, 5000);
}

async function uploadDirectly(file) {
  const session = await supabase.getSession();
  if (!session?.access_token) throw new Error('No hay sesión activa');

  let fileHash = '';
  try {
    const arrayBuffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    fileHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) { console.warn('[Sidepanel] No se pudo calcular hash:', e.message); }

  const formData = new FormData();
  formData.append('file', file, file.name);
  formData.append('source', 'manual_upload');
  formData.append('file_hash', fileHash);
  if (causaConfirmed && lastDetectedCausa) {
    formData.append('case_rol', lastDetectedCausa.rol || '');
    formData.append('tribunal', lastDetectedCausa.tribunal || '');
    formData.append('caratula', lastDetectedCausa.caratula || '');
  }

  const response = await fetch(CONFIG.API.UPLOAD, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${session.access_token}` },
    body: formData,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  if (result.duplicate) throw new Error(result.message || 'Documento duplicado');
  return result;
}

// ══════════════════════════════════════════════════════════
// 11. ANÁLISIS
// ══════════════════════════════════════════════════════════

async function handleAnalyze() {
  const btn = document.getElementById('analyze-btn');
  const output = document.getElementById('analysis-output');
  btn.disabled = true;
  btn.textContent = 'Analizando...';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No hay pestaña activa');
    const r = await chrome.tabs.sendMessage(tab.id, { action: 'analyze' });
    if (r?.error) throw new Error(r.error);
    const c = r.causa || {};
    output.innerHTML = `
      <div class="analysis-report">
        <p><strong>ROL:</strong> ${c.rol || 'No detectado'}</p>
        <p><strong>Tribunal:</strong> ${c.tribunal || 'N/A'}</p>
        <p><strong>Carátula:</strong> ${c.caratula || 'N/A'}</p>
        <p><strong>Zona documentos:</strong> ${c.hasDocumentZone ? '✓' : '✗'}</p>
        <p><strong>Documentos:</strong> ${c.totalDocuments || 0}</p>
        <p><strong>Links descargables:</strong> ${r.downloadElements || 0}</p>
      </div>`;
  } catch (error) {
    output.innerHTML = `<p class="error-text">Error: ${error.message}</p>`;
  }
  btn.disabled = false;
  btn.textContent = 'Analizar Página';
}

// ══════════════════════════════════════════════════════════
// 12. ARCHIVOS GRANDES — Batch Summary
// ══════════════════════════════════════════════════════════

function displayBatchSummary(summary) {
  if (!summary) return;
  const warningsEl = document.getElementById('size-warnings');
  const warningsContent = document.getElementById('size-warnings-content');
  const summaryEl = document.getElementById('batch-summary');
  const summaryContent = document.getElementById('batch-summary-content');

  if (summary.resumableCount > 0 || summary.needsConfirmation) {
    warningsEl.style.display = 'block';
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
  } else { warningsEl.style.display = 'none'; }

  if (summary.totalApproved > 0) {
    summaryEl.style.display = 'block';
    summaryContent.innerHTML = `<p class="result-detail"><strong>${summary.totalApproved}</strong> aprobado(s) · ${summary.totalSizeFormatted} · ~${summary.estimatedTotalUploadFormatted}${summary.totalRejected > 0 ? ` · ${summary.totalRejected} rechazado(s)` : ''}</p>`;
  } else { summaryEl.style.display = 'none'; }
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
// 13. UTILIDADES
// ══════════════════════════════════════════════════════════

function updateProgress(percent, message, type = 'info') {
  const bar = document.getElementById('progress-bar');
  const status = document.getElementById('progress-status');
  if (bar) { bar.style.width = percent + '%'; bar.className = `progress-bar progress-${type}`; }
  if (status && message) { status.textContent = message; status.className = `progress-status status-${type}`; }
}

function updateHeaderStatus(text, type = 'info') {
  const el = document.getElementById('header-status');
  if (el) { el.textContent = text; el.className = `status status-${type}`; }
}

function showNotification(message, type = 'info') {
  const details = document.getElementById('progress-details');
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
