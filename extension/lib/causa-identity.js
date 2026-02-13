/**
 * ============================================================
 * CAUSA IDENTITY - Identificación de causas judiciales
 * ============================================================
 * REGLA: Una causa se identifica ÚNICAMENTE por 3 variables:
 *   1. rol
 *   2. tribunal
 *   3. caratula
 *
 * Dos causas con el mismo ROL pero distinto tribunal o carátula
 * son causas DIFERENTES. Todo el proyecto debe usar esta convención.
 *
 * Nota: En el PJUD la columna se llama "caratulado"; en nuestra
 * BD y código usamos "caratula". Son el mismo concepto.
 * ============================================================
 */

(function (global) {
  'use strict';

  /**
   * Genera una clave única para una causa.
   * @param {{ rol?: string, tribunal?: string, caratula?: string } | null} causa
   * @returns {string}
   */
  function getCausaKey(causa) {
    if (!causa) return '';
    return [
      (causa.rol || '').trim(),
      (causa.tribunal || '').trim(),
      (causa.caratula || '').trim()
    ].join('|');
  }

  /**
   * Indica si dos causas son la misma (mismo rol + tribunal + carátula).
   * @param {{ rol?: string, tribunal?: string, caratula?: string } | null} a
   * @param {{ rol?: string, tribunal?: string, caratula?: string } | null} b
   * @returns {boolean}
   */
  function isSameCausa(a, b) {
    return getCausaKey(a) === getCausaKey(b);
  }

  // Exportar globalmente para uso en sidepanel y otros contextos
  global.CAUSA_IDENTITY = Object.freeze({
    getCausaKey,
    isSameCausa
  });
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : this);
