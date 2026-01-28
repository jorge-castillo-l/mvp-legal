// Permite abrir el sidePanel al hacer clic en el icono de la extensión
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

chrome.runtime.onInstalled.addListener(() => {
  console.log("Legal Bot Extension Installed");
});