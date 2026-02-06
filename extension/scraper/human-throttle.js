/**
 * ============================================================
 * HUMAN THROTTLE - Anti-WAF / Anti-Ban
 * ============================================================
 * SOLUCIÓN A: Bypass de WAF (Vulnerabilidad 3.1, 3.2)
 * 
 * Hace que el patrón de requests del scraper sea INDISTINGUIBLE
 * de un humano revisando causas manualmente:
 * 
 *   1. Delays Gaussianos: Los humanos no esperan exactamente N ms
 *      entre clicks. Usamos distribución gaussiana centrada en ~4.5s
 *      con varianza, produciendo tiempos entre 2.5s y 7s naturales.
 * 
 *   2. Burst Protection: Un humano no descarga 50 PDFs en ráfaga.
 *      Limitamos a 5 acciones por minuto con cooldown automático.
 * 
 *   3. Concurrencia Única: Solo 1 request a la vez. Los humanos
 *      no hacen requests paralelos desde su navegador.
 * 
 *   4. Jitter de Sesión: Pequeñas variaciones aleatorias adicionales
 *      para evitar patrones detectables por heurísticas de WAF.
 * 
 * RESULTADO: El WAF del PJud ve exactamente el mismo patrón que
 * vería un abogado revisando causas a mano. Sin ban de IP.
 * ============================================================
 */

class HumanThrottle {
  constructor(config) {
    const c = config || {};
    this.minDelay = c.minDelayMs || 2500;
    this.maxDelay = c.maxDelayMs || 7000;
    this.maxConcurrent = c.maxConcurrent || 1;
    this.burstLimit = c.burstLimit || 5;
    this.burstWindowMs = c.burstWindowMs || 60000;
    this.sessionCooldownMs = c.sessionCooldownMs || 3000;

    this.activeRequests = 0;
    this.requestTimestamps = [];
    this._queue = [];
    this._processing = false;
  }

  /**
   * Espera un tiempo aleatorio con distribución humana (gaussiana)
   * Los tiempos se agrupan naturalmente alrededor del punto medio
   */
  async waitHumanDelay() {
    const delay = this._gaussianRandom(this.minDelay, this.maxDelay);
    console.log(`[HumanThrottle] Esperando ${(delay / 1000).toFixed(1)}s (simulación humana)`);
    await this._sleep(delay);
  }

  /**
   * Verifica si podemos hacer un request ahora
   */
  canMakeRequest() {
    this._cleanOldTimestamps();

    // Verificar límite de ráfaga
    if (this.requestTimestamps.length >= this.burstLimit) {
      const oldestInWindow = this.requestTimestamps[0];
      const waitTime = this.burstWindowMs - (Date.now() - oldestInWindow);
      console.log(`[HumanThrottle] Burst limit alcanzado. Esperar ${(waitTime / 1000).toFixed(0)}s`);
      return false;
    }

    // Verificar concurrencia
    if (this.activeRequests >= this.maxConcurrent) {
      return false;
    }

    return true;
  }

  /**
   * Ejecutar una acción con timing humano completo:
   * 1. Espera un slot disponible
   * 2. Espera delay gaussiano
   * 3. Ejecuta la acción
   * 4. Marca como completada
   */
  async executeThrottled(action) {
    // Esperar slot disponible
    await this._waitForSlot();

    // Delay humano antes de actuar
    await this.waitHumanDelay();

    // Registrar y ejecutar
    this._registerRequest();
    try {
      const result = await action();
      return result;
    } finally {
      this._requestComplete();
    }
  }

  /**
   * Ejecutar una serie de acciones con timing humano entre cada una
   * Ideal para: navegar -> buscar -> click resultado -> descargar
   */
  async executeSequence(actions) {
    const results = [];

    for (let i = 0; i < actions.length; i++) {
      const result = await this.executeThrottled(actions[i]);
      results.push(result);

      // Cooldown extra entre pasos de una secuencia
      if (i < actions.length - 1) {
        const cooldown = this._jitter(this.sessionCooldownMs, 0.3);
        await this._sleep(cooldown);
      }
    }

    return results;
  }

  /**
   * Obtener estadísticas del throttle (para debug/UI)
   */
  getStats() {
    this._cleanOldTimestamps();
    return {
      activeRequests: this.activeRequests,
      requestsInWindow: this.requestTimestamps.length,
      burstLimit: this.burstLimit,
      burstWindowMs: this.burstWindowMs,
      canMakeRequest: this.canMakeRequest(),
    };
  }

  // ════════════════════════════════════════════════════════
  // INTERNALS
  // ════════════════════════════════════════════════════════

  _registerRequest() {
    this.requestTimestamps.push(Date.now());
    this.activeRequests++;
  }

  _requestComplete() {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
  }

  _cleanOldTimestamps() {
    const cutoff = Date.now() - this.burstWindowMs;
    this.requestTimestamps = this.requestTimestamps.filter(ts => ts > cutoff);
  }

  async _waitForSlot() {
    let attempts = 0;
    while (!this.canMakeRequest()) {
      attempts++;
      // Espera con backoff exponencial suave
      const wait = Math.min(1000 * Math.pow(1.5, attempts), 15000);
      await this._sleep(wait);
    }
  }

  /**
   * Distribución Gaussiana (Box-Muller Transform)
   * Produce tiempos que se agrupan naturalmente alrededor del centro
   * del rango [min, max], igual que un humano real.
   * 
   * Un Math.random() simple produce distribución uniforme (todos los
   * tiempos son igualmente probables = sospechoso para un WAF).
   * Gaussiana = la mayoría de delays están cerca de ~4.5s con
   * variaciones naturales hacia los extremos.
   */
  _gaussianRandom(min, max) {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();

    // Box-Muller transform
    let num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);

    // Normalizar a rango [0, 1] (99.7% de valores)
    num = (num + 3) / 6;
    num = Math.max(0, Math.min(1, num));

    return Math.floor(min + num * (max - min));
  }

  /**
   * Añadir jitter (variación aleatoria) a un valor base
   * @param {number} base - Valor base
   * @param {number} factor - Factor de variación (0.3 = ±30%)
   */
  _jitter(base, factor) {
    const variation = base * factor;
    return base + (Math.random() * 2 - 1) * variation;
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
