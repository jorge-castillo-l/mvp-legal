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

    // Extraer metadata adicional de la causa (pasamos rol para validar caché)
    const metadata = this._extractCausaMetadata(rolResult.rol);

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
    // ESTRATEGIA ESPECÍFICA PARA PJUD: Buscar en tablas con clase table-titulos
    const pjudTables = document.querySelectorAll('table.table-titulos, table.table-responsive');
    for (const table of pjudTables) {
      const firstCell = table.querySelector('td');
      if (firstCell) {
        // Limpiar AGRESIVAMENTE espacios invisibles, saltos de línea y caracteres raros
        const cleanText = (firstCell.textContent || '')
          .replace(/[\u200B-\u200D\uFEFF]/g, '') // Zero-width chars
          .replace(/\s+/g, ' ') // Normalizar espacios
          .trim();
        
        // Buscar ROL: seguido del patrón
        const rolMatch = cleanText.match(/ROL\s*:?\s*([A-Z]{1,4}-\d{1,8}-\d{4})/i);
        if (rolMatch) {
          return { 
            rol: rolMatch[1].toUpperCase().trim(), 
            source: 'pjud_table', 
            confidence: 0.95 
          };
        }
      }
    }

    // Buscar en el cuerpo principal, excluyendo menús y footers
    const mainContent = document.querySelector('main, #content, #main, .content, .main-content, .modal-body')
      || document.body;

    if (!mainContent) return null;

    // Tomar solo los primeros 5000 caracteres para eficiencia (aumentado)
    let text = (mainContent.textContent || '').substring(0, 5000);
    
    // Limpieza AGRESIVA de caracteres problemáticos
    text = text
      .replace(/[\u200B-\u200D\uFEFF]/g, '') // Zero-width chars
      .replace(/\s+/g, ' ') // Normalizar todos los espacios a uno solo
      .replace(/\u00A0/g, ' ') // Non-breaking spaces
      .trim();

    // Buscar patrones de ROL precedidos de contexto legal
    // Hacemos los patrones MÁS PERMISIVOS con espacios
    const contextPatterns = [
      /ROL\s*:?\s*([A-Z]{1,4}\s*-\s*\d{1,8}\s*-\s*\d{4})/i,
      /RIT\s*:?\s*([A-Z]{1,4}\s*-\s*\d{1,8}\s*-\s*\d{4})/i,
      /RUC\s*:?\s*(\d{4,}\s*-\s*\d{4})/i,
      /Causa\s+(?:N[°º]?\s*)?([A-Z]{1,4}\s*-\s*\d{1,8}\s*-\s*\d{4})/i,
      /Expediente\s*:?\s*([A-Z]{1,4}\s*-\s*\d{1,8}\s*-\s*\d{4})/i,
    ];

    for (const pattern of contextPatterns) {
      const match = text.match(pattern);
      if (match) {
        // Limpiar el ROL capturado de espacios internos
        const cleanRol = match[1].replace(/\s+/g, '').toUpperCase();
        return { rol: cleanRol, source: 'dom_text', confidence: 0.7 };
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
    // ESTRATEGIA PJUD: Zona unificada (table-titulos + tabla folios)
    // Incluye: Texto Demanda, Anexos, Certificado de Envío, Ebook + tabla de historia/folios
    const tabContent = document.querySelector('#loadHistCuadernoCiv');
    if (tabContent?.parentElement) {
      const zone = tabContent.parentElement;
      const hasPdfElements = zone.querySelector(
        'i.fa-file-pdf-o, i.fa-file-pdf, form[action*="documento"], form[action*="docu"]'
      );
      if (hasPdfElements) {
        return { element: zone, type: 'container', selector: 'pjud_unified_zone', confidence: 0.95 };
      }
    }

    // Fallback: Buscar tabs de historia/documentos (solo tabla folios)
    const pjudTabs = [
      '#historiaCiv', '#historia', '#documentos', '#expediente',
      '.tab-pane.active', '.modal-body'
    ];

    for (const tabSelector of pjudTabs) {
      try {
        const tabElement = document.querySelector(tabSelector);
        if (!tabElement) continue;
        
        // Buscar tabla dentro del tab
        const table = tabElement.querySelector('table.table-bordered, table.table-striped, table.table-hover, table');
        if (table && this._isDocumentTable(table)) {
          return { element: table, type: 'table', selector: `${tabSelector} > table`, confidence: 0.95 };
        }
      } catch (e) { /* selector inválido */ }
    }

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

    // Obtener texto de headers (thead o primera fila)
    const headerText = (table.querySelector('thead')?.textContent ||
      table.rows[0]?.textContent || '').toUpperCase();

    // Keywords específicas de PJud y otros sitios judiciales
    const docKeywords = [
      'DOCUMENTO', 'ESCRITO', 'RESOLUCIÓN', 'RESOLUCION',
      'ACTUACIÓN', 'ACTUACION', 'NOTIFICACIÓN', 'NOTIFICACION',
      'TIPO', 'FECHA', 'FOLIO', 'CUADERNO', 'DESCARGA',
      'DOC', 'ANEXO', 'ETAPA', 'TRÁMITE', 'TRAMITE', // Específicos de PJud
      'DESC', 'FEC', 'FOJA', 'GEORREF', // Abreviaciones comunes
    ];

    let matches = 0;
    for (const kw of docKeywords) {
      if (headerText.includes(kw)) matches++;
    }

    // Al menos 2 keywords legales en los headers = es tabla de documentos
    if (matches >= 2) return true;

    // VALIDACIÓN ADICIONAL: Verificar si tiene enlaces a PDFs en el cuerpo
    const tbody = table.querySelector('tbody') || table;
    const pdfLinks = tbody.querySelectorAll('a[href*=".pdf"], form[action*="documento"], form[action*=".pdf"], i.fa-file-pdf-o, i.fa-file-pdf');
    
    // Si tiene al menos 2 filas con iconos de PDF o forms de descarga = es tabla de documentos
    if (pdfLinks.length >= 2) return true;

    return false;
  }

  // ════════════════════════════════════════════════════════
  // METADATA DE LA CAUSA
  // ════════════════════════════════════════════════════════

  _extractCausaMetadata(detectedRol) {
    const metadata = {
      tribunal: null,
      caratula: null,
      materia: null,
      estado: null,
    };

    // Prioridad 1: table-titulos es la clase PJUD para la tabla de metadatos (ROL, Tribunal, etc.)
    // table-responsive es demasiado genérica y puede tomar otra tabla distinta primero
    let priorityText = '';
    const metadataTables = document.querySelectorAll('table.table-titulos');
    for (const table of metadataTables) {
      const text = (table.textContent || '').trim();
      if (text.length > 50) {
        priorityText = text;
        break;
      }
    }

    const bodyText = (document.body?.textContent || '').substring(0, 5000);
    const searchText = priorityText || bodyText;

    // Tribunal
    const tribunalPatterns = [
      /Tribunal\s*:?\s*([^\n\r]{5,80})/i,
      /Juzgado\s+(?:de\s+)?([^\n\r]{5,80})/i,
      /Corte\s+(?:de\s+)?([^\n\r]{5,80})/i,
    ];
    for (const p of tribunalPatterns) {
      const m = searchText.match(p);
      if (m) { metadata.tribunal = m[1].trim().substring(0, 80); break; }
    }

    // Carátula
    const caratulaPatterns = [
      /Car[áa]tula\s*:?\s*([^\n\r]{5,120})/i,
      /Partes\s*:?\s*([^\n\r]{5,120})/i,
    ];
    for (const p of caratulaPatterns) {
      const m = searchText.match(p);
      if (m) { metadata.caratula = m[1].trim().substring(0, 120); break; }
    }

    // Materia
    const materiaPatterns = [
      /Materia\s*:?\s*([^\n\r]{3,80})/i,
      /Tipo\s+de\s+Causa\s*:?\s*([^\n\r]{3,80})/i,
    ];
    for (const p of materiaPatterns) {
      const m = searchText.match(p);
      if (m) { metadata.materia = m[1].trim().substring(0, 80); break; }
    }

    // Estado
    const estadoPatterns = [
      /Estado\s*:?\s*([^\n\r]{3,40})/i,
      /Situaci[oó]n\s*:?\s*([^\n\r]{3,40})/i,
    ];
    for (const p of estadoPatterns) {
      const m = searchText.match(p);
      if (m) { metadata.estado = m[1].trim().substring(0, 40); break; }
    }

    // Fallback: caratulado/tribunal de la fila clickeada en tabla de resultados (content.js)
    // Solo usamos el caché si: (1) ROL coincide, (2) no expiró, (3) faltan datos en la página
    try {
      const cached = typeof window !== 'undefined' && window.__pjudLastClickedRow;
      const rolMatches = detectedRol && cached?.rol &&
        String(cached.rol).replace(/\s/g, '') === String(detectedRol).replace(/\s/g, '');
      const notExpired = cached?.clickedAt && (Date.now() - cached.clickedAt) < 300000;
      if (cached && rolMatches && notExpired) {
        if (!metadata.caratula && cached.caratulado) {
          metadata.caratula = cached.caratulado.substring(0, 120);
        }
        if (!metadata.tribunal && cached.tribunal) {
          metadata.tribunal = cached.tribunal.substring(0, 80);
        }
      }
    } catch (e) { /* ignorar */ }

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

    // Buscar filas con documentos (todas las tablas en la zona cuando es container)
    const rows = zone.querySelectorAll('tr');
    
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 2) continue;

      // Limpiar texto de la fila
      const rowText = (row.textContent || '').replace(/\s+/g, ' ').trim();
      
      // Detectar si tiene documentos descargables
      const pdfIcons = row.querySelectorAll('i.fa-file-pdf-o, i.fa-file-pdf');
      const hasForm = row.querySelector('form[action*="documento"], form[action*=".pdf"], form[action*="docu"]');
      const hasLink = row.querySelector('a[href*=".pdf"], a[onclick*="submit"], a[onclick*="download"]');
      const hasDownload = !!(pdfIcons.length > 0 || hasForm || hasLink);

      // Saltar filas de header (thead puede estar dentro de tbody en algunos sitios)
      const isHeaderRow = row.querySelector('th') || /^(folio|doc|anexo|etapa|trámite|fecha)/i.test(rowText);
      if (isHeaderRow) continue;

      // Saltar filas vacías o demasiado cortas
      if (!rowText || rowText.length < 5) continue;

      // Inferir tipo de documento
      const type = this._inferDocumentType(rowText);
      const count = pdfIcons.length > 0 ? pdfIcons.length : (hasDownload ? 1 : 0);
      preview.byType[type] += count;
      preview.total += count;

      // Guardar solo los primeros 50 para el preview
      if (preview.items.length < 50) {
        preview.items.push({
          text: rowText.substring(0, 150),
          type: type,
          hasDownload: hasDownload,
        });
      }
    }

    // Si no encontramos filas, contar links/forms directamente
    if (preview.total === 0) {
      const downloadElements = zone.querySelectorAll('a, form[action*="documento"]');
      for (const el of downloadElements) {
        const text = (el.textContent || '').trim();
        const href = (el.getAttribute('href') || '').toLowerCase();
        const action = (el.getAttribute('action') || '').toLowerCase();
        const onclick = (el.getAttribute('onclick') || '').toLowerCase();

        const isDocument = href.includes('.pdf') || 
                          action.includes('documento') || 
                          onclick.includes('submit') ||
                          onclick.includes('download') ||
                          el.querySelector('i.fa-file-pdf-o, i.fa-file-pdf');

        if (isDocument && text.length > 3) {
          const type = this._inferDocumentType(text + ' ' + href + ' ' + action);
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
    
    // Limpiar agresivamente el texto de espacios invisibles y caracteres raros
    const cleanText = text
      .replace(/[\u200B-\u200D\uFEFF]/g, '') // Zero-width chars
      .replace(/\u00A0/g, ' ') // Non-breaking spaces
      .replace(/\s+/g, ' ') // Normalizar espacios
      .trim();
    
    // Patrones más permisivos que toleran espacios entre componentes
    const patterns = [
      /([A-Z]{1,4}\s*-\s*\d{1,8}\s*-\s*\d{4})/i,  // Con espacios opcionales
      /(\d{1,8}\s*-\s*\d{4})/,                      // RUC con espacios opcionales
    ];
    
    for (const p of patterns) {
      const m = cleanText.match(p);
      if (m) {
        // Limpiar el ROL capturado de espacios internos
        const cleanRol = m[1].replace(/\s+/g, '').toUpperCase();
        if (this._isValidRol(cleanRol)) {
          return { rol: cleanRol };
        }
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
