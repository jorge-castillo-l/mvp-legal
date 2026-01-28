// content.js - "Los Ojos" del Legal Bot
// Este script se inyecta automáticamente en pjud.cl

console.log("Legal Bot: Content Script activo y escuchando.");

// Función simple para detectar si estamos en una vista de causa (placeholder)
function detectContext() {
  const url = window.location.href;
  console.log("Legal Bot: Contexto actual ->", url);
  
  // Aquí implementaremos la lógica para extraer ROL, Carátula, etc.
  return {
    url: url,
    title: document.title,
    hasTables: document.querySelectorAll('table').length > 0
  };
}

// Escuchar solicitudes desde el Sidepanel
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "ping") {
    sendResponse({ status: "alive", context: detectContext() });
  }
  return true; // Mantiene el canal abierto para respuesta asíncrona
});