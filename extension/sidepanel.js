document.addEventListener('DOMContentLoaded', () => {
  const analyzeBtn = document.getElementById('analyze-btn');
  const outputDiv = document.getElementById('output');

  if (analyzeBtn) {
    analyzeBtn.addEventListener('click', async () => {
      console.log('Botón Analizar Causa clickeado');
      
      // Feedback visual inmediato
      analyzeBtn.textContent = 'Analizando...';
      analyzeBtn.disabled = true;
      outputDiv.textContent = 'Iniciando análisis...';

      // Simulación de acción (aquí iría la lógica real de comunicación con activeTab)
      // Para la MVP, solo simulamos un delay
      setTimeout(() => {
        analyzeBtn.textContent = 'Analizar Causa';
        analyzeBtn.disabled = false;
        outputDiv.innerHTML = '<strong>Análisis completado:</strong><br>No se detectaron expedientes activos en la vista actual.';
      }, 1500);
    });
  }
});