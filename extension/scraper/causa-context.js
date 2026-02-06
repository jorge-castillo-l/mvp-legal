/**
 * ============================================================
 * CAUSA CONTEXT DETECTOR - Tarea 4.07
 * ============================================================
 * PIEZA MÁS CRÍTICA del scraper. Sin esto, todo lo demás es
 * un aspirador ciego que contamina la base de datos.
 *
 * REGLA DE ORO: Sin ROL confirmado = sin scraping. Punto.
 *
 * Responsabilidades:
 *   1. Detectar proactivamente el ROL de la causa actual
 *   2. Identificar la zona de documentos (tabla de expediente)
 *   3. Generar preview de documentos encontrados
 *   4. Enviar contexto al Sidepanel para confirmación del abogado
 *
 * El abogado VE qué causa se detectó y CONFIRMA antes de que
 * se capture un solo byte. En el mundo legal, un documento de
 * otra causa mezclado es peor que ningún documento.
 * ============================================================
 */

class CausaContext {
  constructor(config) {
    this.config = config || {};
    this.selectors = config?.selectors || {};
    this.heuristics = config?.heuristics || {};

    // Estado actual de la detección
    this.detectedCausa = null;
    this.isConfirmed = false;
    this.documentZone = null;
  }

  /**
   * DETECCIÓN PRINCIPAL: Analiza la página y extrae el contexto de la causa.
   * Retorna null si no se detecta una causa válida.
   */
  detect() {
    this.isConfirmed = false;
    this.detectedCausa = null;
    this.documentZone = null;

    const url = window.location.href;

    // Verificar que estamos en pjud.cl
    if (!/pjud\.cl/i.test(url)) {
      return null;
    }

    // Intentar detectar ROL desde múltiples fuentes (orden de confianza)
    const rolResult =
      this._detectRolFromUrl(url) ||
      this._detectRolFromBreadcrumbs() ||
      this._detectRolFromPageTitle() ||
      this._detectRolFromFormFields() ||
      this._detectRolFromHeaderSection() ||
      this._detectRolFromDomText();

    if (!rolResult) {
      return null;
    }

    // Identificar la zona de documentos de esta causa
    this.documentZone = this._identifyDocumentZone();

    // Extraer metadata adicional de la causa
    const metadata = this._extractCausaMetadata();

    // Generar preview de documentos
    const documentPreview = this._generateDocumentPreview();

    this.detectedCausa = {
      rol: rolResult.rol,
      rolSource: rolResult.source,
      rolConfidence: rolResult.confidence,
      tribunal: metadata.tribunal,
      caratula: metadata.caratula,
      materia: metadata.materia,
      estado: metadata.estado,
      hasDocumentZone: !!this.documentZone,
      documentZoneType: this.documentZone?.type || null,
      documentPreview: documentPreview,
      totalDocuments: documentPreview.total,
      pageUrl: url,
      detectedAt: Date.now(),
    };

    console.log('[CausaContext] Causa detectada:', this.detectedCausa.rol,
      '| Tribunal:', this.detectedCausa.tribunal,
      '| Documentos:', this.detectedCausa.totalDocuments);

    return this.detectedCausa;
  }

  /**
   * Confirmar la causa detectada (llamado tras aprobación del abogado)
   */
  confirm() {
    if (!this.detectedCausa) return false;
    this.isConfirmed = true;
    console.log('[CausaContext] Causa CONFIRMADA por el usuario:', this.detectedCausa.rol);
    return true;
  }

  /**
   * Verificar si hay causa confirmada (gate para el scraper)
   */
  hasConfirmedCausa() {
    return this.isConfirmed && this.detectedCausa !== null;
  }

  /**
   * Obtener la causa confirmada actual
   */
  getConfirmedCausa() {
    if (!this.isConfirmed) return null;
    return this.detectedCausa;
  }

  /**
   * Obtener la zona de documentos confirmada (el scope del scraper)
   */
  getDocumentZone() {
    if (!this.isConfirmed) return null;
    return this.documentZone;
  }

  /**
   * Resetear (al cambiar de página o cancelar)
   */
  reset() {
    this.detectedCausa = null;
    this.isConfirmed = false;
    this.documentZone = null;
  }

  // ════════════════════════════════════════════════════════
  // DETECCIÓN DE ROL - Múltiples estrategias
  // ════════════════════════════════════════════════════════

  /**
   * Detectar ROL desde la URL (más confiable)
   * Ejemplo: .../causa?rol=C-12345-2026 o .../causa/C-12345-2026
   */
  _detectRolFromUrl(url) {
    const patterns = [
      /[?&]rol=([A-Z]{1,4}-\d{1,8}-\d{4})/i,
      /[?&]rol=(\d{1,8}-\d{4})/i,
      /\/causa\/([A-Z]{1,4}-\d{1,8}-\d{4})/i,
      /\/expediente\/([A-Z]{1,4}-\d{1,8}-\d{4})/i,
      /[?&]rit=([A-Z]{1,4}-\d{1,8}-\d{4})/i,
      /[?&]ruc=(\d{4,}-\d{4})/i,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return { rol: match[1].toUpperCase(), source: 'url', confidence: 0.95 };
      }
    }
    return null;
  }

  /**
   * Detectar ROL desde breadcrumbs / ruta de navegación
   */
  _detectRolFromBreadcrumbs() {
    const breadcrumbSelectors = [
      '.breadcrumb', '.breadcrumbs', 'nav[aria-label*="breadcrumb"]',
      '#breadcrumb', '.ruta-navegacion', '.path-nav',
    ];

    for (const selector of breadcrumbSelectors) {
      try {
        const el = document.querySelector(selector);
        if (el) {
          const rol = this._extractRolFromText(el.textContent);
          if (rol) return { ...rol, source: 'breadcrumb', confidence: 0.9 };
        }
      } catch (e) { /* selector inválido */ }
    }
    return null;
  }

  /**
   * Detectar ROL desde el título de la página
   */
  _detectRolFromPageTitle() {
    const title = document.title || '';
    const rol = this._extractRolFromText(title);
    if (rol) return { ...rol, source: 'page_title', confidence: 0.85 };
    return null;
  }

  /**
   * Detectar ROL desde campos de formulario (búsqueda completada)
   */
  _detectRolFromFormFields() {
    const fieldSelectors = [
      ...(this.selectors.rolField || []),
      '#rolCausa', '#txtRol', 'input[name="rol"]', 'input[name*="Rol"]',
      'input[name="rit"]', 'input[name="ruc"]',
      '#txtRit', '#txtRuc',
    ];

    for (const selector of fieldSelectors) {
      try {
        const el = document.querySelector(selector);
        if (el && el.value) {
          const normalized = el.value.trim().toUpperCase();
          if (this._isValidRol(normalized)) {
            return { rol: normalized, source: 'form_field', confidence: 0.9 };
          }
        }
      } catch (e) { /* selector inválido */ }
    }
    return null;
  }

  /**
   * Detectar ROL desde la sección de encabezado de la causa
   * (cuando estamos dentro del detalle de una causa)
   */
  _detectRolFromHeaderSection() {
    const headerSelectors = [
      '.detalle-causa', '.ficha-causa', '.header-causa',
      '#detalleCausa', '#fichaCausa', '.causa-header',
      '.panel-heading', '.card-header',
      'h1', 'h2', 'h3',
    ];

    for (const selector of headerSelectors) {
      try {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          const text = (el.textContent || '').substring(0, 500);
          if (/causa|rol|rit|ruc|expediente|tribunal/i.test(text)) {
            const rol = this._extractRolFromText(text);
            if (rol) return { ...rol, source: 'header_section', confidence: 0.85 };
          }
        }
      } catch (e) { /* selector inválido */ }
    }
    return null;
  }

  /**
   * Detectar ROL escaneando el texto visible del DOM (último recurso)
   */
  _detectRolFromDomText() {
    // Buscar en el cuerpo principal, excluyendo menús y footers
    const mainContent = document.querySelector('main, #content, #main, .content, .main-content')
      || document.body;

    if (!mainContent) return null;

    // Tomar solo los primeros 3000 caracteres para eficiencia
    const text = (mainContent.textContent || '').substring(0, 3000);

    // Buscar patrones de ROL precedidos de contexto legal
    const contextPatterns = [
      /ROL\s*:?\s*([A-Z]{1,4}-\d{1,8}-\d{4})/i,
      /RIT\s*:?\s*([A-Z]{1,4}-\d{1,8}-\d{4})/i,
      /RUC\s*:?\s*(\d{4,}-\d{4})/i,
      /Causa\s+(?:N[°º]?\s*)?([A-Z]{1,4}-\d{1,8}-\d{4})/i,
      /Expediente\s*:?\s*([A-Z]{1,4}-\d{1,8}-\d{4})/i,
    ];

    for (const pattern of contextPatterns) {
      const match = text.match(pattern);
      if (match) {
        return { rol: match[1].toUpperCase(), source: 'dom_text', confidence: 0.7 };
      }
    }

    return null;
  }

  // ════════════════════════════════════════════════════════
  // ZONA DE DOCUMENTOS - Identificar el scope del scraper
  // ════════════════════════════════════════════════════════

  /**
   * Identifica la zona de la página que contiene los documentos de la causa.
   * Solo los PDFs dentro de esta zona serán capturados.
   */
  _identifyDocumentZone() {
    // Estrategia 1: Buscar tabla de documentos con selectores conocidos
    const tableSelectors = this.selectors.causaTable || [];
    for (const selector of tableSelectors) {
      try {
        const el = document.querySelector(selector);
        if (el && this._isDocumentTable(el)) {
          return { element: el, type: 'table', selector, confidence: 0.9 };
        }
      } catch (e) { /* selector inválido */ }
    }

    // Estrategia 2: Buscar tabla por contenido (keywords legales en headers)
    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      if (this._isDocumentTable(table)) {
        return { element: table, type: 'table', selector: 'heuristic', confidence: 0.75 };
      }
    }

    // Estrategia 3: Buscar contenedores con listas de documentos
    const containerSelectors = [
      '.documentos', '.expediente', '.actuaciones', '.resoluciones',
      '#documentos', '#listaDocumentos', '.lista-documentos',
      '[class*="document"]', '[class*="expediente"]',
    ];

    for (const selector of containerSelectors) {
      try {
        const el = document.querySelector(selector);
        if (el && el.querySelectorAll('a').length > 0) {
          return { element: el, type: 'container', selector, confidence: 0.7 };
        }
      } catch (e) { /* selector inválido */ }
    }

    return null;
  }

  /**
   * Verificar si una tabla parece contener documentos de una causa
   */
  _isDocumentTable(table) {
    if (!table || !table.rows || table.rows.length < 2) return false;

    const headerText = (table.querySelector('thead')?.textContent ||
      table.rows[0]?.textContent || '').toUpperCase();

    const docKeywords = [
      'DOCUMENTO', 'ESCRITO', 'RESOLUCIÓN', 'RESOLUCION',
      'ACTUACIÓN', 'ACTUACION', 'NOTIFICACIÓN', 'NOTIFICACION',
      'TIPO', 'FECHA', 'FOLIO', 'CUADERNO', 'DESCARGA',
    ];

    let matches = 0;
    for (const kw of docKeywords) {
      if (headerText.includes(kw)) matches++;
    }

    // Al menos 2 keywords legales en los headers = es tabla de documentos
    return matches >= 2;
  }

  // ════════════════════════════════════════════════════════
  // METADATA DE LA CAUSA
  // ════════════════════════════════════════════════════════

  _extractCausaMetadata() {
    const metadata = {
      tribunal: null,
      caratula: null,
      materia: null,
      estado: null,
    };

    const bodyText = (document.body?.textContent || '').substring(0, 5000);

    // Tribunal
    const tribunalPatterns = [
      /Tribunal\s*:?\s*([^\n\r]{5,80})/i,
      /Juzgado\s+(?:de\s+)?([^\n\r]{5,80})/i,
      /Corte\s+(?:de\s+)?([^\n\r]{5,80})/i,
    ];
    for (const p of tribunalPatterns) {
      const m = bodyText.match(p);
      if (m) { metadata.tribunal = m[1].trim().substring(0, 80); break; }
    }

    // Carátula
    const caratulaPatterns = [
      /Car[áa]tula\s*:?\s*([^\n\r]{5,120})/i,
      /Partes\s*:?\s*([^\n\r]{5,120})/i,
    ];
    for (const p of caratulaPatterns) {
      const m = bodyText.match(p);
      if (m) { metadata.caratula = m[1].trim().substring(0, 120); break; }
    }

    // Materia
    const materiaPatterns = [
      /Materia\s*:?\s*([^\n\r]{3,80})/i,
      /Tipo\s+de\s+Causa\s*:?\s*([^\n\r]{3,80})/i,
    ];
    for (const p of materiaPatterns) {
      const m = bodyText.match(p);
      if (m) { metadata.materia = m[1].trim().substring(0, 80); break; }
    }

    // Estado
    const estadoPatterns = [
      /Estado\s*:?\s*([^\n\r]{3,40})/i,
      /Situaci[oó]n\s*:?\s*([^\n\r]{3,40})/i,
    ];
    for (const p of estadoPatterns) {
      const m = bodyText.match(p);
      if (m) { metadata.estado = m[1].trim().substring(0, 40); break; }
    }

    return metadata;
  }

  // ════════════════════════════════════════════════════════
  // PREVIEW DE DOCUMENTOS
  // ════════════════════════════════════════════════════════

  /**
   * Genera un resumen de los documentos encontrados en la zona,
   * agrupados por tipo, para mostrar al abogado antes de sincronizar.
   */
  _generateDocumentPreview() {
    const preview = {
      total: 0,
      byType: {
        resoluciones: 0,
        escritos: 0,
        actuaciones: 0,
        notificaciones: 0,
        otros: 0,
      },
      items: [],
    };

    const zone = this.documentZone?.element;
    if (!zone) return preview;

    // Buscar filas con documentos
    const rows = zone.querySelectorAll('tr');
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 2) continue;

      const rowText = (row.textContent || '').trim();
      const hasLinks = row.querySelectorAll('a, button[onclick], [onclick]').length > 0;

      if (!hasLinks && !rowText) continue;

      // Inferir tipo de documento
      const type = this._inferDocumentType(rowText);
      preview.byType[type]++;
      preview.total++;

      // Guardar solo los primeros 50 para el preview
      if (preview.items.length < 50) {
        preview.items.push({
          text: rowText.substring(0, 150),
          type: type,
          hasDownload: hasLinks,
        });
      }
    }

    // Si no encontramos filas, contar links directamente
    if (preview.total === 0) {
      const links = zone.querySelectorAll('a');
      for (const link of links) {
        const text = (link.textContent || '').trim();
        const href = (link.getAttribute('href') || '').toLowerCase();
        const onclick = (link.getAttribute('onclick') || '').toLowerCase();

        if (href.includes('.pdf') || onclick.includes('download') ||
          onclick.includes('documento') || text.length > 3) {
          const type = this._inferDocumentType(text + ' ' + href);
          preview.byType[type]++;
          preview.total++;
          if (preview.items.length < 50) {
            preview.items.push({ text: text.substring(0, 150), type, hasDownload: true });
          }
        }
      }
    }

    return preview;
  }

  /**
   * Inferir el tipo de documento legal desde su texto
   */
  _inferDocumentType(text) {
    const t = (text || '').toUpperCase();
    if (/RESOLUCI[OÓ]N|AUTO|SENTENCIA|DECRETO/i.test(t)) return 'resoluciones';
    if (/ESCRITO|DEMANDA|CONTESTACI|RECURSO|APELACI/i.test(t)) return 'escritos';
    if (/ACTUACI[OÓ]N|DILIGENCIA|AUDIENCIA/i.test(t)) return 'actuaciones';
    if (/NOTIFICACI[OÓ]N|C[ÉE]DULA|CARTA/i.test(t)) return 'notificaciones';
    return 'otros';
  }

  // ════════════════════════════════════════════════════════
  // UTILIDADES
  // ════════════════════════════════════════════════════════

  _extractRolFromText(text) {
    if (!text) return null;
    const patterns = [
      /([A-Z]{1,4}-\d{1,8}-\d{4})/i,
      /(\d{1,8}-\d{4})/,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m && this._isValidRol(m[1])) {
        return { rol: m[1].toUpperCase() };
      }
    }
    return null;
  }

  _isValidRol(rol) {
    if (!rol || rol.length < 5) return false;
    // Verificar que el año es razonable (1990-2030)
    const yearMatch = rol.match(/(\d{4})$/);
    if (yearMatch) {
      const year = parseInt(yearMatch[1]);
      if (year < 1990 || year > 2030) return false;
    }
    return /^[A-Z]{0,4}-?\d{1,8}-\d{4}$/i.test(rol);
  }
}
