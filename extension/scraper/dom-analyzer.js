/**
 * ============================================================
 * DOM ANALYZER - Layer 2 (Inmunidad al DOM)
 * ============================================================
 * SOLUCIÓN A: Inmunidad al DOM (Vulnerabilidad 1.1, 1.2, 1.3)
 * 
 * En lugar de depender de un selector CSS frágil como #btn-descarga,
 * este módulo usa un SISTEMA DE PUNTUACIÓN HEURÍSTICO:
 * 
 *   1. Intenta selectores conocidos (rápido, config remota)
 *   2. Si fallan, escanea TODO el DOM buscando patrones:
 *      - Texto: "descargar", "PDF", "documento"
 *      - Atributos: href con .pdf, onclick con download
 *      - Iconos: clases .fa-download, imágenes pdf.png
 *      - Contexto: elementos dentro de tablas con datos legales
 *   3. Penetra Shadow DOM recursivamente (Vuln. 1.3)
 *   4. Penetra iframes same-origin (Vuln. 1.2)
 * 
 * Resultado: Incluso si PJud cambia todos sus IDs y clases,
 * el analizador encontrará los botones de descarga por su
 * SIGNIFICADO SEMÁNTICO, no por su nombre CSS.
 * ============================================================
 */

class DOMAnalyzer {
  constructor(config) {
    this.config = config || {};
    this.selectors = config?.selectors || {};
    this.heuristics = config?.heuristics || {};
  }

  /**
   * FUNCIÓN PRINCIPAL: Encontrar todos los elementos descargables
   * Retorna array ordenado por confianza (mayor primero)
   */
  findDownloadElements() {
    const candidates = [];

    // Estrategia A: Selectores conocidos (más rápido, más preciso si están actualizados)
    const selectorResults = this._tryKnownSelectors();
    candidates.push(...selectorResults);

    // Estrategia B: Escaneo heurístico (resiliente a cambios de DOM)
    const heuristicResults = this._heuristicScan();
    candidates.push(...heuristicResults);

    // Deduplicar y ordenar por confianza
    return this._deduplicateAndRank(candidates);
  }

  /**
   * Encontrar la tabla principal de causas/documentos
   * Usa selectores conocidos + heurísticas de contenido
   */
  findCausaTable() {
    // Intentar selectores conocidos primero
    const tableSelectors = this.selectors.causaTable || [];
    for (const selector of tableSelectors) {
      try {
        const el = this._querySelectorDeep(selector);
        if (el && el.rows && el.rows.length > 1) {
          return { element: el, source: 'known_selector', confidence: 0.95 };
        }
      } catch (e) { /* selector inválido */ }
    }

    // Heurística: buscar tabla con palabras clave legales en headers
    const tables = this._querySelectorAllDeep('table');
    const keywords = this.heuristics.tableKeywords || [
      'ROL', 'Causa', 'Tribunal', 'Carátula', 'Fecha', 'Tipo'
    ];

    let bestTable = null;
    let bestScore = 0;

    for (const table of tables) {
      const headerText = (table.querySelector('thead')?.textContent || 
                          table.querySelector('tr')?.textContent || '').toUpperCase();
      const fullText = (table.textContent || '').toUpperCase();
      let score = 0;

      // Puntuar por keywords en headers (más peso)
      for (const kw of keywords) {
        if (headerText.includes(kw.toUpperCase())) score += 2;
        else if (fullText.includes(kw.toUpperCase())) score += 0.5;
      }

      // Bonus por tener varias filas (probable tabla de datos)
      const rowCount = table.rows?.length || 0;
      if (rowCount > 2) score += Math.min(rowCount, 10) * 0.15;

      // Bonus por tener links (probable tabla con documentos)
      const linkCount = table.querySelectorAll('a').length;
      if (linkCount > 0) score += Math.min(linkCount, 10) * 0.1;

      if (score > bestScore) {
        bestScore = score;
        bestTable = table;
      }
    }

    if (bestTable && bestScore > 2) {
      return {
        element: bestTable,
        source: 'heuristic',
        confidence: Math.min(bestScore / 8, 0.9),
      };
    }

    return null;
  }

  /**
   * Extraer datos de casos desde una tabla detectada
   */
  extractCaseData(tableResult) {
    if (!tableResult?.element) return [];

    const table = tableResult.element;
    const rows = table.querySelectorAll('tbody tr, tr:not(:first-child)');
    const cases = [];

    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 2) continue; // Ignorar filas vacías/headers

      const rowText = (row.textContent || '').trim();
      const links = row.querySelectorAll('a, button, [onclick]');
      const downloadLinks = [];

      for (const link of links) {
        const score = this._scoreDownloadElement(link);
        if (score >= (this.heuristics.minConfidenceThreshold || 0.35)) {
          downloadLinks.push({ element: link, score });
        }
      }

      // Intentar extraer ROL (formato chileno: C-XXXXX-YYYY o similar)
      const rolPatterns = [
        /[A-Z]{1,3}-\d{1,7}-\d{4}/i,   // C-12345-2026
        /\d{1,7}-\d{4}/,                  // 12345-2026
        /ROL\s*:?\s*([A-Z0-9\-]+)/i,     // ROL: C-12345-2026
      ];

      let rol = null;
      for (const pattern of rolPatterns) {
        const match = rowText.match(pattern);
        if (match) {
          rol = match[1] || match[0];
          break;
        }
      }

      if (downloadLinks.length > 0 || rol) {
        cases.push({
          rol: rol,
          text: rowText.substring(0, 300),
          downloadLinks: downloadLinks.sort((a, b) => b.score - a.score),
          rowElement: row,
          cellCount: cells.length,
        });
      }
    }

    return cases;
  }

  /**
   * Detectar contexto de la página (¿es una vista relevante del PJUD?)
   */
  analyzePageContext() {
    const url = window.location.href;
    const title = document.title || '';
    const bodyText = (document.body?.textContent || '').substring(0, 5000);

    const legalKeywords = /causa|rol|tribunal|expediente|carátula|juzgado|corte|demanda|querella/i;
    const isPjud = /pjud\.cl|oficinavirtual.*judicial/i.test(url);

    const table = this.findCausaTable();
    const hasLegalContent = legalKeywords.test(bodyText);
    const hasFrames = document.querySelectorAll('iframe, frame').length > 0;

    return {
      url,
      title,
      isPjud,
      isRelevantPage: isPjud && (table !== null || hasLegalContent),
      hasTable: table !== null,
      tableConfidence: table?.confidence || 0,
      hasLegalContent,
      hasFrames,
      frameCount: document.querySelectorAll('iframe, frame').length,
    };
  }

  // ════════════════════════════════════════════════════════
  // SCORING: Sistema de puntuación para elementos descargables
  // ════════════════════════════════════════════════════════

  /**
   * Puntuar qué tan probable es que un elemento sea un botón de descarga
   * Retorna un valor entre 0 (nada probable) y 1 (casi seguro)
   */
  _scoreDownloadElement(element) {
    let score = 0;

    // Recolectar todo el texto/atributos del elemento
    const text = (element.textContent || '').toLowerCase().trim();
    const href = (element.getAttribute('href') || '').toLowerCase();
    const onclick = (element.getAttribute('onclick') || '').toLowerCase();
    const className = (element.className || '').toLowerCase();
    const title = (element.getAttribute('title') || '').toLowerCase();
    const ariaLabel = (element.getAttribute('aria-label') || '').toLowerCase();
    const dataAttrs = this._getDataAttributes(element).toLowerCase();

    const allText = `${text} ${href} ${onclick} ${className} ${title} ${ariaLabel} ${dataAttrs}`;

    // --- Keywords de descarga ---
    const keywords = this.heuristics.downloadKeywords || [
      'descargar', 'download', 'pdf', 'documento', 'escrito',
      'resolución', 'ver', 'abrir', 'sentencia',
    ];

    for (const kw of keywords) {
      if (allText.includes(kw)) score += 0.15;
    }

    // --- Link directo a PDF (alta confianza) ---
    if (href.includes('.pdf')) score += 0.5;
    if (href.includes('download') || href.includes('descarga')) score += 0.3;

    // --- Atributo download HTML5 ---
    if (element.hasAttribute('download')) score += 0.45;

    // --- onclick con funciones de descarga ---
    if (onclick) {
      if (/download|descarga|abrir|verdoc|getdoc|obtener/i.test(onclick)) score += 0.35;
      if (/window\.open|window\.location/i.test(onclick)) score += 0.1;
    }

    // --- Iconos dentro del elemento ---
    const icons = element.querySelectorAll('i, svg, img, span[class*="icon"]');
    for (const icon of icons) {
      const iconInfo = `${icon.className || ''} ${icon.getAttribute('src') || ''} ${icon.getAttribute('alt') || ''}`.toLowerCase();
      if (/download|descarga|pdf|file|archivo/i.test(iconInfo)) {
        score += 0.25;
      }
    }

    // --- Target _blank (común para abrir PDFs) ---
    if (element.getAttribute('target') === '_blank') score += 0.1;

    // --- Penalizaciones ---
    // Navegar a otra sección (probablemente no es descarga)
    if (href.startsWith('#') && !href.includes('download')) score -= 0.2;
    // Links de paginación
    if (/página|page|next|prev|anterior|siguiente/i.test(allText)) score -= 0.3;
    // Links de navegación general
    if (/inicio|home|menú|salir|logout|cerrar/i.test(allText)) score -= 0.3;

    return Math.max(0, Math.min(score, 1.0));
  }

  // ════════════════════════════════════════════════════════
  // BÚSQUEDA: Selectores conocidos y escaneo heurístico
  // ════════════════════════════════════════════════════════

  _tryKnownSelectors() {
    const results = [];
    const downloadSelectors = this.selectors.downloadLink || [];

    for (const selector of downloadSelectors) {
      try {
        const elements = this._querySelectorAllDeep(selector);
        for (const el of elements) {
          results.push({
            element: el,
            source: 'known_selector',
            selector: selector,
            confidence: 0.9,
          });
        }
      } catch (e) {
        // Selector inválido - ignorar silenciosamente
      }
    }

    return results;
  }

  _heuristicScan() {
    const results = [];

    // Escanear todos los elementos clickeables
    const clickables = this._querySelectorAllDeep(
      'a, button, [onclick], [role="button"], input[type="button"], input[type="submit"]'
    );

    for (const el of clickables) {
      const score = this._scoreDownloadElement(el);
      if (score >= (this.heuristics.minConfidenceThreshold || 0.35)) {
        results.push({
          element: el,
          source: 'heuristic',
          confidence: score,
        });
      }
    }

    return results;
  }

  // ════════════════════════════════════════════════════════
  // DEEP QUERY: Penetración de Shadow DOM e iframes
  // ════════════════════════════════════════════════════════

  /**
   * querySelector que penetra Shadow DOM e iframes same-origin
   * Soluciona Vulnerabilidades 1.2 (iframes) y 1.3 (Shadow DOM)
   */
  _querySelectorDeep(selector, root = document) {
    // Intento normal primero
    try {
      const result = root.querySelector(selector);
      if (result) return result;
    } catch (e) { /* selector inválido */ }

    // Penetrar Shadow DOMs
    const allElements = root.querySelectorAll('*');
    for (const el of allElements) {
      if (el.shadowRoot) {
        const result = this._querySelectorDeep(selector, el.shadowRoot);
        if (result) return result;
      }
    }

    // Penetrar iframes same-origin
    const iframes = root.querySelectorAll('iframe, frame');
    for (const iframe of iframes) {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (doc) {
          const result = this._querySelectorDeep(selector, doc);
          if (result) return result;
        }
      } catch (e) {
        // Cross-origin iframe - no se puede acceder (esperado)
      }
    }

    return null;
  }

  /**
   * querySelectorAll que penetra Shadow DOM e iframes same-origin
   */
  _querySelectorAllDeep(selector, root = document) {
    const results = [];

    // Búsqueda normal
    try {
      results.push(...root.querySelectorAll(selector));
    } catch (e) { /* selector inválido */ }

    // Penetrar Shadow DOMs
    try {
      const allElements = root.querySelectorAll('*');
      for (const el of allElements) {
        if (el.shadowRoot) {
          results.push(...this._querySelectorAllDeep(selector, el.shadowRoot));
        }
      }
    } catch (e) { /* error en traversal */ }

    // Penetrar iframes same-origin
    const iframes = root.querySelectorAll('iframe, frame');
    for (const iframe of iframes) {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (doc) {
          results.push(...this._querySelectorAllDeep(selector, doc));
        }
      } catch (e) {
        // Cross-origin iframe - esperado
      }
    }

    return results;
  }

  // ════════════════════════════════════════════════════════
  // UTILIDADES
  // ════════════════════════════════════════════════════════

  /**
   * Deduplicar candidatos (mismo elemento) y ordenar por confianza
   */
  _deduplicateAndRank(candidates) {
    const elementMap = new Map();

    for (const candidate of candidates) {
      const existing = elementMap.get(candidate.element);
      if (!existing || candidate.confidence > existing.confidence) {
        elementMap.set(candidate.element, candidate);
      }
    }

    return Array.from(elementMap.values())
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Extraer todos los data-* attributes como string
   */
  _getDataAttributes(element) {
    if (!element.dataset) return '';
    return Object.values(element.dataset).join(' ');
  }
}
