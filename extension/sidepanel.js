/**
 * ============================================================
 * SIDEPANEL - "La Cara" del Legal Bot
 * ============================================================
 * Flujo actualizado con confirmación de causa (4.07/4.11):
 *
 *   1. Auto-detecta causa al conectar con content script
 *   2. Muestra ROL, tribunal, carátula, preview de documentos
 *   3. Abogado presiona "Confirmar Causa"
 *   4. Se habilita "Sincronizar"
 *   5. Sync ejecuta captura → validación (4.09) → upload
 *   6. Si falla, muestra upload manual
 * ============================================================
 */

let currentUser = null;
let currentSession = null;
let isSyncing = false;
let causaConfirmed = false;

// ══════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ══════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Sidepanel] Legal Bot v1.1 iniciado');

  await checkAuthentication();
  setupEventListeners();
  setupScraperEventListener();
  setupDragAndDrop();

  // Intentar detectar causa en la pestaña activa
  setTimeout(requestCausaDetection, 1000);

  setInterval(checkAuthentication, 30000);
});

// ══════════════════════════════════════════════════════════
// AUTENTICACIÓN
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
  document.getElementById('causa-section').style.display = 'block';
  document.getElementById('sync-section').style.display = 'block';
}

function showUnauthenticatedUI() {
  document.getElementById('auth-status').innerHTML = '<p style="color: #ea580c;">● Sin sesión activa</p>';
  document.getElementById('login-btn').style.display = 'block';
  document.getElementById('logout-btn').style.display = 'none';
  document.getElementById('authenticated-content').style.display = 'none';
  document.getElementById('unauthenticated-content').style.display = 'block';
}

// ══════════════════════════════════════════════════════════
// EVENT LISTENERS
// ══════════════════════════════════════════════════════════

function setupEventListeners() {
  document.getElementById('login-btn')?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'http://localhost:3000/login' });
  });

  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await supabase.signOut();
    currentUser = null;
    currentSession = null;
    showUnauthenticatedUI();
  });

  document.getElementById('open-dashboard-btn')?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'http://localhost:3000/login' });
  });

  // ══════ CONFIRMAR CAUSA (4.07) ══════
  document.getElementById('confirm-causa-btn')?.addEventListener('click', handleConfirmCausa);

  // ══════ SINCRONIZAR ══════
  document.getElementById('sync-btn')?.addEventListener('click', handleSync);

  // ══════ ANALIZAR ══════
  document.getElementById('analyze-btn')?.addEventListener('click', handleAnalyze);
}

// ══════════════════════════════════════════════════════════
// 4.07 - DETECCIÓN Y CONFIRMACIÓN DE CAUSA
// ══════════════════════════════════════════════════════════

async function requestCausaDetection() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    const response = await chrome.tabs.sendMessage(tab.id, { action: 'detect_causa' });
    if (response?.causa) {
      displayDetectedCausa(response.causa);
    }
  } catch (e) {
    // Content script no cargado aún - normal
  }
}

function displayDetectedCausa(causa) {
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

  // Mostrar ROL
  document.getElementById('causa-rol').textContent = `ROL: ${causa.rol}`;

  // Tribunal
  document.getElementById('causa-tribunal').textContent =
    causa.tribunal ? `Tribunal: ${causa.tribunal}` : `Fuente: ${causa.rolSource} (confianza: ${Math.round(causa.rolConfidence * 100)}%)`;

  // Carátula
  document.getElementById('causa-caratula').textContent =
    causa.caratula ? `Carátula: ${causa.caratula}` : '';

  // Preview de documentos
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

  // Mostrar botón de confirmación
  document.getElementById('confirm-causa-btn').style.display = 'block';
  document.getElementById('causa-hint').textContent =
    'Verifique que la causa detectada es correcta y confirme';

  updateHeaderStatus(`Causa ${causa.rol} detectada`, 'info');
}

async function handleConfirmCausa() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    const response = await chrome.tabs.sendMessage(tab.id, { action: 'confirm_causa' });

    if (response?.status === 'confirmed') {
      causaConfirmed = true;

      // UI: Causa confirmada
      document.getElementById('confirm-causa-btn').style.display = 'none';
      document.getElementById('causa-hint').textContent = '✓ Causa confirmada. Lista para sincronizar.';
      document.getElementById('causa-hint').classList.add('hint-success');

      // Habilitar botón de sync
      const syncBtn = document.getElementById('sync-btn');
      syncBtn.disabled = false;
      document.getElementById('sync-hint').textContent =
        'Presione para capturar y subir los documentos de esta causa';

      updateHeaderStatus(`Causa ${response.causa.rol} confirmada`, 'success');
    } else {
      showNotification(response?.error || 'Error al confirmar', 'error');
    }
  } catch (error) {
    showNotification('Error: ' + error.message, 'error');
  }
}

// ══════════════════════════════════════════════════════════
// SYNC
// ══════════════════════════════════════════════════════════

async function handleSync() {
  if (isSyncing || !causaConfirmed) return;
  if (!currentUser) {
    showNotification('Debe iniciar sesión primero', 'error');
    return;
  }

  isSyncing = true;
  const syncBtn = document.getElementById('sync-btn');
  const progressSection = document.getElementById('sync-progress');
  const resultsSection = document.getElementById('sync-results');
  const manualSection = document.getElementById('manual-upload-section');

  syncBtn.disabled = true;
  syncBtn.innerHTML = '<span class="btn-icon spinner">⟳</span> Sincronizando...';
  progressSection.style.display = 'block';
  resultsSection.style.display = 'none';
  manualSection.style.display = 'none';
  updateProgress(0, 'Conectando con la página...');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No hay pestaña activa');

    updateProgress(10, 'Iniciando scraper resiliente...');
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'sync' });

    if (response?.error) throw new Error(response.error);
    showSyncResults(response?.results);
  } catch (error) {
    updateProgress(100, `Error: ${error.message}`, 'error');
    manualSection.style.display = 'block';
  }

  isSyncing = false;
  syncBtn.disabled = false;
  syncBtn.innerHTML = '<span class="btn-icon">⚡</span> Sincronizar';
}

// ══════════════════════════════════════════════════════════
// PROGRESO EN TIEMPO REAL
// ══════════════════════════════════════════════════════════

function setupScraperEventListener() {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'scraper_event') {
      handleScraperEvent(message.event, message.data);
    }
    if (message.type === 'scraper_ready') {
      if (message.causa) {
        displayDetectedCausa(message.causa);
      }
      updateHeaderStatus('Scraper conectado', 'success');
    }
  });
}

function handleScraperEvent(event, data) {
  switch (event) {
    case 'status': handleStatusUpdate(data); break;
    case 'causa_detected':
      displayDetectedCausa(data);
      break;
    case 'causa_confirmed':
      updateHeaderStatus(`Causa ${data?.rol} confirmada`, 'success');
      break;
    case 'pdf_captured':
      showNotification(`PDF capturado: ${formatSize(data?.size)}`, 'success');
      break;
    case 'pdf_uploaded':
      showNotification(`Subido: ${data?.filename} (${data?.type || ''})`, 'success');
      break;
    case 'content_updated':
      if (data?.causa) displayDetectedCausa(data.causa);
      break;
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
    'validating': 70, 'filtered': 75,
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

// ══════════════════════════════════════════════════════════
// RESULTADOS
// ══════════════════════════════════════════════════════════

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

    // Mostrar razones de rechazo si hay
    if (results.rejectedReasons?.length > 0) {
      content.innerHTML += `
        <div class="result-filtered">
          <p><strong>Documentos filtrados:</strong></p>
          ${results.rejectedReasons.map(r => `<p class="result-detail">• ${r}</p>`).join('')}
        </div>
      `;
    }
  } else if (results.totalFound > 0) {
    content.innerHTML = `
      <div class="result-summary result-warning">
        <p>Se encontraron ${results.totalFound} documento(s) pero todos fueron filtrados</p>
        <p class="result-detail">Los filtros de calidad rechazaron todos los documentos.</p>
        ${results.rejectedReasons?.length ? results.rejectedReasons.map(r => `<p class="result-detail">• ${r}</p>`).join('') : ''}
      </div>
    `;
    manualSection.style.display = 'block';
  } else {
    content.innerHTML = `
      <div class="result-summary result-warning">
        <p>No se detectaron documentos automáticamente</p>
        <p class="result-detail">Use la subida manual como alternativa.</p>
      </div>
    `;
    manualSection.style.display = 'block';
  }

  if (results.errors?.length > 0) {
    content.innerHTML += `
      <div class="result-errors">
        ${results.errors.map(e => `<p class="result-detail error-text">• ${e}</p>`).join('')}
      </div>
    `;
  }
}

// ══════════════════════════════════════════════════════════
// UPLOAD MANUAL (Layer 3)
// ══════════════════════════════════════════════════════════

function setupDragAndDrop() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  if (!dropZone || !fileInput) return;

  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drop-zone-active');
  });

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

  const formData = new FormData();
  formData.append('file', file, file.name);
  formData.append('source', 'manual_upload');

  const response = await fetch('http://localhost:3000/api/upload', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${session.access_token}` },
    body: formData,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return response.json();
}

// ══════════════════════════════════════════════════════════
// ANÁLISIS
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
        ${(r.topDownloads || []).length > 0 ? `
          <p><strong>Top elementos:</strong></p>
          <ul class="download-list">
            ${r.topDownloads.map(d => `<li>${truncate(d.text, 40)} <span class="confidence">${Math.round(d.confidence * 100)}%</span></li>`).join('')}
          </ul>
        ` : ''}
      </div>
    `;
  } catch (error) {
    output.innerHTML = `<p class="error-text">Error: ${error.message}</p>`;
  }

  btn.disabled = false;
  btn.textContent = 'Analizar Página';
}

// ══════════════════════════════════════════════════════════
// UTILIDADES
// ══════════════════════════════════════════════════════════

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
