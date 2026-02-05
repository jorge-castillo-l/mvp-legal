// Estado global de autenticación
let currentUser = null;
let currentSession = null;

// Inicialización al cargar el DOM
document.addEventListener('DOMContentLoaded', async () => {
  console.log('Legal Bot Sidepanel iniciado');
  
  // Verificar autenticación
  await checkAuthentication();
  
  // Configurar event listeners
  setupEventListeners();
  
  // Sincronizar sesión cada 30 segundos
  setInterval(checkAuthentication, 30000);
});

// Verificar estado de autenticación
async function checkAuthentication() {
  try {
    const authSection = document.getElementById('auth-section');
    const authStatus = document.getElementById('auth-status');
    
    authSection.style.display = 'block';
    authStatus.innerHTML = '<p>Verificando sesión...</p>';
    
    // Primero intentar sincronizar desde el Dashboard
    let session = await supabase.syncSessionFromDashboard();
    
    // Si no hay sesión en cookies, intentar desde storage local
    if (!session) {
      session = await supabase.getSession();
    }
    
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
    console.error('Error verificando autenticación:', error);
    showUnauthenticatedUI();
  }
}

// Mostrar UI para usuario autenticado
function showAuthenticatedUI() {
  const authSection = document.getElementById('auth-section');
  const authStatus = document.getElementById('auth-status');
  const loginBtn = document.getElementById('login-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const authenticatedContent = document.getElementById('authenticated-content');
  const unauthenticatedContent = document.getElementById('unauthenticated-content');
  
  authStatus.innerHTML = `
    <p style="color: green;">✓ Sesión activa</p>
    <p><strong>Email:</strong> ${currentUser.email}</p>
  `;
  
  loginBtn.style.display = 'none';
  logoutBtn.style.display = 'block';
  authenticatedContent.style.display = 'block';
  unauthenticatedContent.style.display = 'none';
  
  console.log('Usuario autenticado:', currentUser.email);
}

// Mostrar UI para usuario no autenticado
function showUnauthenticatedUI() {
  const authSection = document.getElementById('auth-section');
  const authStatus = document.getElementById('auth-status');
  const loginBtn = document.getElementById('login-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const authenticatedContent = document.getElementById('authenticated-content');
  const unauthenticatedContent = document.getElementById('unauthenticated-content');
  
  authStatus.innerHTML = '<p style="color: orange;">⚠ Sin sesión activa</p>';
  
  loginBtn.style.display = 'block';
  logoutBtn.style.display = 'none';
  authenticatedContent.style.display = 'none';
  unauthenticatedContent.style.display = 'block';
  
  console.log('Usuario no autenticado');
}

// Configurar todos los event listeners
function setupEventListeners() {
  // Botón de login
  const loginBtn = document.getElementById('login-btn');
  if (loginBtn) {
    loginBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: 'http://localhost:3000/login' });
    });
  }
  
  // Botón de logout
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await supabase.signOut();
      currentUser = null;
      currentSession = null;
      showUnauthenticatedUI();
    });
  }
  
  // Botón de abrir dashboard
  const openDashboardBtn = document.getElementById('open-dashboard-btn');
  if (openDashboardBtn) {
    openDashboardBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: 'http://localhost:3000/login' });
    });
  }
  
  // Botón de analizar (solo disponible cuando está autenticado)
  const analyzeBtn = document.getElementById('analyze-btn');
  if (analyzeBtn) {
    analyzeBtn.addEventListener('click', handleAnalyzeCause);
  }
}

// Manejar análisis de causa
async function handleAnalyzeCause() {
  const analyzeBtn = document.getElementById('analyze-btn');
  const outputDiv = document.getElementById('output');
  
  if (!currentUser) {
    outputDiv.innerHTML = '<p style="color: red;">Error: Debe iniciar sesión primero.</p>';
    return;
  }
  
  console.log('Botón Analizar Causa clickeado');
  
  // Feedback visual inmediato
  analyzeBtn.textContent = 'Analizando...';
  analyzeBtn.disabled = true;
  outputDiv.textContent = 'Iniciando análisis...';
  
  try {
    // Aquí iría la lógica real de comunicación con el content script
    // Por ahora, simulamos el análisis
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Simulación de resultado
    analyzeBtn.textContent = 'Analizar Causa';
    analyzeBtn.disabled = false;
    outputDiv.innerHTML = `
      <strong>Análisis completado:</strong><br>
      <p>Usuario: ${currentUser.email}</p>
      <p>No se detectaron expedientes activos en la vista actual.</p>
      <p><em>Nota: La funcionalidad de scraping se implementará en las siguientes tareas.</em></p>
    `;
  } catch (error) {
    analyzeBtn.textContent = 'Analizar Causa';
    analyzeBtn.disabled = false;
    outputDiv.innerHTML = `<p style="color: red;">Error: ${error.message}</p>`;
  }
}