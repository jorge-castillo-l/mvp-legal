/**
 * ============================================================
 * JWT EXTRACTOR MODULE - Tarea 4.16
 * ============================================================
 * Reemplaza CausaContext (4.07) + DOMAnalyzer (4.08).
 *
 * LECTURA 100% PASIVA del DOM visible:
 *   - Cero clics
 *   - Cero navegación
 *   - Cero requests a PJUD
 *
 * Extrae TODO lo necesario del modal #modalDetalleCivil (DOM2):
 *   1) ROL + metadata de table.table-titulos
 *   2) JWTs de forms directos (Texto Demanda, Certificado, Ebook)
 *   3) JWT de Anexos (onclick=anexoCausaCivil)
 *   4) JWTs de cuadernos (select#selCuaderno)
 *   5) JWT de Receptor (onclick=receptorCivil)
 *   6) CSRF token del DOM
 *   7) Datos tabulares de 5 tabs
 *   8) Folios visibles con JWTs
 *   9) Carátula desde DOM1 (solo Consulta Unificada, nullable)
 *  10) libro_tipo de la letra del ROL
 *
 * Empaqueta todo en un CausaPackage JSON → service-worker → API.
 *
 * DISEÑO DUAL ENTRY POINT:
 *   - consulta_unificada: caratulado desde DOM1, libro_tipo detectable
 *   - mis_causas (MVP v1.1): todo desde DOM2, caratulado nullable
 * ============================================================
 */

class JwtExtractor {
  constructor(config) {
    this.config = config || {};

    // Backward-compat state (replaces CausaContext)
    this.detectedCausa = null;
    this.isConfirmed = false;
    this._lastPackage = null;
  }

  // ════════════════════════════════════════════════════════
  // PUBLIC API
  // ════════════════════════════════════════════════════════

  /**
   * Quick detection — lightweight, runs on page load.
   * Returns basic causa info for sidepanel preview.
   * Backward-compatible with CausaContext.detect().
   */
  async detect() {
    this.isConfirmed = false;
    this.detectedCausa = null;

    if (!/pjud\.cl/i.test(window.location.href)) return null;

    const modalBody = this._findModalBody();
    if (!modalBody) {
      // Fallback: try detecting ROL from page text (pre-modal state)
      const rolResult = this._detectRolFromPage();
      if (!rolResult) return null;

      this.detectedCausa = {
        rol: rolResult.rol,
        rolSource: rolResult.source,
        rolConfidence: rolResult.confidence,
        tribunal: null,
        caratula: null,
        materia: null,
        estado: null,
        hasDocumentZone: false,
        documentZoneType: null,
        documentPreview: { total: 0, byType: {}, items: [] },
        totalDocuments: 0,
        pageUrl: window.location.href,
        detectedAt: Date.now(),
      };
      return this.detectedCausa;
    }

    const metadata = this._extractMetadata(modalBody);
    if (!metadata.rol) return null;

    const caratula = await this._resolveCaratula(metadata.rol, metadata._partialCaratula);
    const folioCount = this._countVisibleFolios(modalBody);

    this.detectedCausa = {
      rol: metadata.rol,
      rolSource: 'pjud_modal',
      rolConfidence: 0.99,
      tribunal: metadata.tribunal,
      caratula: caratula,
      materia: metadata.procedimiento_raw,
      estado: metadata.estado_adm,
      procedimiento: metadata.procedimiento,
      libro_tipo: metadata.libro_tipo,
      hasDocumentZone: true,
      documentZoneType: 'pjud_modal',
      documentPreview: {
        total: folioCount,
        byType: {},
        items: [],
      },
      totalDocuments: folioCount,
      pageUrl: window.location.href,
      detectedAt: Date.now(),
    };

    return this.detectedCausa;
  }

  /**
   * Full extraction — reads the entire DOM2 modal.
   * Returns a complete CausaPackage ready for the API.
   */
  async extract() {
    const modalBody = this._findModalBody();
    if (!modalBody) return null;

    const metadata = this._extractMetadata(modalBody);
    if (!metadata.rol) return null;

    const caratula = await this._resolveCaratula(metadata.rol, metadata._partialCaratula);
    const directJwts = this._extractDirectJwts(modalBody);
    const cuadernos = this._extractCuadernos(modalBody);
    const receptorJwt = this._extractReceptorJwt(modalBody);
    const anexosJwt = this._extractAnexosJwt(modalBody);
    const csrfToken = this._extractCsrfToken();
    const folios = this._extractFolios(modalBody);
    const tabs = this._extractTabsData(modalBody);
    const exhorto = this._extractExhortoData(modalBody);

    const causaPackage = {
      rol: metadata.rol,
      libro_tipo: metadata.libro_tipo,
      tribunal: metadata.tribunal,
      estado_adm: metadata.estado_adm,
      procedimiento: metadata.procedimiento,
      procedimiento_raw: metadata.procedimiento_raw,
      etapa: metadata.etapa,
      ubicacion: metadata.ubicacion,
      fecha_ingreso: metadata.fecha_ingreso,
      estado_procesal: metadata.estado_procesal,

      caratula: caratula,
      materia: metadata.procedimiento_raw,
      fuente: this._detectEntryPoint(),
      cookies: this._captureCookies(),

      jwt_texto_demanda: directJwts.textoDemanda,
      jwt_certificado_envio: directJwts.certificadoEnvio,
      jwt_ebook: directJwts.ebook,
      jwt_anexos: anexosJwt,
      jwt_receptor: receptorJwt,
      csrf_token: csrfToken,

      cuadernos: cuadernos,
      folios: folios,
      tabs: tabs,
      exhorto: exhorto,

      extracted_at: new Date().toISOString(),
      page_url: window.location.href,
    };

    this._lastPackage = causaPackage;

    // Also update detected causa for backward compat
    this.detectedCausa = {
      rol: metadata.rol,
      rolSource: 'pjud_modal',
      rolConfidence: 0.99,
      tribunal: metadata.tribunal,
      caratula: caratula,
      materia: metadata.procedimiento_raw,
      estado: metadata.estado_adm,
      procedimiento: metadata.procedimiento,
      libro_tipo: metadata.libro_tipo,
      hasDocumentZone: true,
      documentZoneType: 'pjud_modal',
      documentPreview: {
        total: folios.length,
        byType: this._groupFoliosByType(folios),
        items: folios.slice(0, 50).map(f => ({
          text: `Folio ${f.numero} - ${f.tramite} - ${f.desc_tramite}`.substring(0, 150),
          type: this._inferDocType(f.tramite),
          hasDownload: !!f.jwt_doc_principal,
        })),
      },
      totalDocuments: folios.length,
      pageUrl: window.location.href,
      detectedAt: Date.now(),
    };

    console.log(
      '[JwtExtractor] CausaPackage extraído:',
      metadata.rol, '|',
      metadata.tribunal, '|',
      `${cuadernos.length} cuadernos,`,
      `${folios.length} folios,`,
      `proc: ${metadata.procedimiento || 'desconocido'}`,
    );

    return causaPackage;
  }

  /**
   * Get the last extracted CausaPackage.
   */
  getLastPackage() {
    return this._lastPackage;
  }

  // ════════════════════════════════════════════════════════
  // BACKWARD COMPAT — CausaContext interface
  // ════════════════════════════════════════════════════════

  confirm() {
    if (!this.detectedCausa) return false;
    this.isConfirmed = true;
    return true;
  }

  hasConfirmedCausa() {
    return this.isConfirmed && this.detectedCausa !== null;
  }

  getConfirmedCausa() {
    if (!this.isConfirmed) return null;
    return this.detectedCausa;
  }

  getDocumentZone() {
    if (!this.isConfirmed) return null;
    const zone = this._findModalBody();
    if (!zone) return null;
    return { element: zone, type: 'pjud_modal', selector: 'modal_body', confidence: 0.99 };
  }

  reset() {
    this.detectedCausa = null;
    this.isConfirmed = false;
    this._lastPackage = null;
  }

  // ════════════════════════════════════════════════════════
  // 1) METADATA — table.table-titulos (first table)
  // ════════════════════════════════════════════════════════

  _extractMetadata(modalBody) {
    const result = {
      rol: null,
      libro_tipo: null,
      tribunal: null,
      estado_adm: null,
      procedimiento: null,
      procedimiento_raw: null,
      etapa: null,
      ubicacion: null,
      fecha_ingreso: null,
      estado_procesal: null,
      _partialCaratula: null,
    };

    const tables = modalBody.querySelectorAll('table.table-titulos');
    if (tables.length === 0) return result;

    const metaTable = tables[0];
    const rows = metaTable.querySelectorAll('tbody > tr');

    // Row 1: ROL | F.Ing. | partial caratulado
    if (rows[0]) {
      const cells = rows[0].querySelectorAll('td');
      if (cells[0]) {
        const rolText = this._cleanText(cells[0].textContent);
        const rolMatch = rolText.match(/ROL\s*:?\s*([A-Z]{1,4}-\d{1,8}-\d{4})/i);
        if (rolMatch) {
          result.rol = rolMatch[1].toUpperCase().replace(/\s/g, '');
          result.libro_tipo = this._extractLibroTipo(result.rol);
        }
      }
      // F. Ing. — search across all cells
      for (const cell of cells) {
        const text = this._cleanText(cell.textContent);
        const fechaMatch = text.match(/F\.\s*Ing\.\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i);
        if (fechaMatch) {
          result.fecha_ingreso = fechaMatch[1];
          break;
        }
      }
      // Partial caratulado — last cell without label
      const lastCell = cells[cells.length - 1];
      if (lastCell) {
        const lastText = this._cleanText(lastCell.textContent);
        if (lastText && !/ROL|F\.\s*Ing/i.test(lastText)) {
          result._partialCaratula = lastText.substring(0, 120);
        }
      }
    }

    // Row 2: Est. Adm. | Proc. | Ubicación
    if (rows[1]) {
      const cells = rows[1].querySelectorAll('td');
      for (const cell of cells) {
        const text = this._cleanText(cell.textContent);
        const admMatch = text.match(/Est\.\s*Adm\.\s*:?\s*(.+)/i);
        if (admMatch) result.estado_adm = admMatch[1].trim();

        const procMatch = text.match(/Proc\.\s*:?\s*(.+)/i);
        if (procMatch) {
          result.procedimiento_raw = procMatch[1].trim();
          result.procedimiento = this._mapProcedimiento(result.procedimiento_raw);
        }

        const ubiMatch = text.match(/Ubicaci[oó]n\s*:?\s*(.+)/i);
        if (ubiMatch) result.ubicacion = ubiMatch[1].trim();
      }
    }

    // Row 3: Estado Proc. | Etapa | Tribunal
    if (rows[2]) {
      const cells = rows[2].querySelectorAll('td');
      for (const cell of cells) {
        const text = this._cleanText(cell.textContent);
        const estadoMatch = text.match(/Estado\s+Proc\.\s*:?\s*(.+)/i);
        if (estadoMatch) result.estado_procesal = estadoMatch[1].trim();

        const etapaMatch = text.match(/Etapa\s*:?\s*(.+)/i);
        if (etapaMatch) result.etapa = etapaMatch[1].trim();

        const tribMatch = text.match(/Tribunal\s*:?\s*(.+)/i);
        if (tribMatch) result.tribunal = tribMatch[1].trim();
      }
    }

    return result;
  }

  // ════════════════════════════════════════════════════════
  // 2) DIRECT JWTs — forms in second table.table-titulos
  // ════════════════════════════════════════════════════════

  _extractDirectJwts(modalBody) {
    const result = {
      textoDemanda: null,
      certificadoEnvio: null,
      ebook: null,
    };

    // Texto Demanda: form → docu.php, input name="valorEncTxtDmda"
    const demandaForm = modalBody.querySelector('form[action*="docu.php"]:not([action*="docuS"]):not([action*="docuN"])');
    if (demandaForm) {
      const input = demandaForm.querySelector('input[name="valorEncTxtDmda"]');
      if (input?.value) {
        result.textoDemanda = {
          jwt: input.value,
          action: demandaForm.getAttribute('action') || '',
          param: 'valorEncTxtDmda',
        };
      }
    }

    // Certificado Envío: form → docCertificadoDemanda.php, input name="dtaCert"
    const certForm = modalBody.querySelector('form[action*="docCertificadoDemanda"]');
    if (certForm) {
      const input = certForm.querySelector('input[name="dtaCert"]');
      if (input?.value) {
        result.certificadoEnvio = {
          jwt: input.value,
          action: certForm.getAttribute('action') || '',
          param: 'dtaCert',
        };
      }
    }

    // Ebook: form → newebookcivil.php, input name="dtaEbook"
    const ebookForm = modalBody.querySelector('form[action*="newebookcivil"]');
    if (ebookForm) {
      const input = ebookForm.querySelector('input[name="dtaEbook"]');
      if (input?.value) {
        result.ebook = {
          jwt: input.value,
          action: ebookForm.getAttribute('action') || '',
          param: 'dtaEbook',
        };
      }
    }

    return result;
  }

  // ════════════════════════════════════════════════════════
  // 3) ANEXOS JWT — onclick=anexoCausaCivil('JWT')
  // ════════════════════════════════════════════════════════

  _extractAnexosJwt(modalBody) {
    const link = modalBody.querySelector(
      'a[onclick*="anexoCausaCivil"], a[href="#modalAnexoCausaCivil"]'
    );
    if (!link) return null;

    const onclick = link.getAttribute('onclick') || '';
    return this._extractJwtFromOnclick(onclick, 'anexoCausaCivil');
  }

  // ════════════════════════════════════════════════════════
  // 4) CUADERNOS — select#selCuaderno options with JWTs
  // ════════════════════════════════════════════════════════

  _extractCuadernos(modalBody) {
    const cuadernos = [];
    const select = modalBody.querySelector('select#selCuaderno');
    if (!select) return cuadernos;

    const options = select.querySelectorAll('option');
    for (const option of options) {
      const jwt = option.value;
      const nombre = this._cleanText(option.textContent);
      if (!jwt || jwt.length < 20) continue; // Skip empty/placeholder options

      cuadernos.push({
        nombre: nombre,
        jwt: jwt,
        selected: option.selected || option.hasAttribute('selected'),
      });
    }

    return cuadernos;
  }

  // ════════════════════════════════════════════════════════
  // 5) RECEPTOR JWT — onclick=receptorCivil('JWT')
  // ════════════════════════════════════════════════════════

  _extractReceptorJwt(modalBody) {
    const link = modalBody.querySelector('a[onclick*="receptorCivil"]');
    if (!link) return null;

    const onclick = link.getAttribute('onclick') || '';
    return this._extractJwtFromOnclick(onclick, 'receptorCivil');
  }

  // ════════════════════════════════════════════════════════
  // 6) CSRF TOKEN
  // ════════════════════════════════════════════════════════

  _extractCsrfToken() {
    // Strategy 1: hidden input named "token"
    const tokenInput = document.querySelector(
      'input[name="token"][type="hidden"], input[name="_token"][type="hidden"]'
    );
    if (tokenInput?.value && /^[a-f0-9]{20,64}$/i.test(tokenInput.value)) {
      return tokenInput.value;
    }

    // Strategy 2: meta tag
    const metaToken = document.querySelector(
      'meta[name="csrf-token"], meta[name="_token"]'
    );
    if (metaToken?.content) return metaToken.content;

    // Strategy 3: search script tags for token variable assignments
    const scripts = document.querySelectorAll('script:not([src])');
    for (const script of scripts) {
      const text = script.textContent || '';
      // Patterns: var token = "abc123"; token: "abc123"; 'token': 'abc123'
      const tokenMatch = text.match(
        /(?:var\s+)?token\s*[:=]\s*['"]([a-f0-9]{20,64})['"]/i
      );
      if (tokenMatch) return tokenMatch[1];
    }

    // Strategy 4: look for token in any hidden input with hex value
    const hiddens = document.querySelectorAll('input[type="hidden"]');
    for (const hidden of hiddens) {
      const name = (hidden.name || '').toLowerCase();
      if (name === 'token' && /^[a-f0-9]{20,64}$/i.test(hidden.value)) {
        return hidden.value;
      }
    }

    return null;
  }

  // ════════════════════════════════════════════════════════
  // 7) TABS DATA — already present in DOM (no AJAX needed)
  // ════════════════════════════════════════════════════════

  _extractTabsData(modalBody) {
    return {
      litigantes: this._extractLitigantes(modalBody),
      notificaciones: this._extractNotificaciones(modalBody),
      escritos_por_resolver: this._extractEscritos(modalBody),
      exhortos: this._extractExhortos(modalBody),
    };
  }

  _extractLitigantes(modalBody) {
    const tab = modalBody.querySelector('#litigantesCiv');
    if (!tab) return [];

    const rows = tab.querySelectorAll('tbody tr');
    return Array.from(rows).map(row => {
      const cells = row.querySelectorAll('td');
      return {
        participante: this._cleanText(cells[0]?.textContent),
        rut: this._cleanText(cells[1]?.textContent),
        persona: this._cleanText(cells[2]?.textContent),
        nombre: this._cleanText(cells[3]?.textContent),
      };
    }).filter(r => r.participante || r.nombre);
  }

  _extractNotificaciones(modalBody) {
    const tab = modalBody.querySelector('#notificacionesCiv');
    if (!tab) return [];

    const rows = tab.querySelectorAll('tbody tr');
    return Array.from(rows).map(row => {
      const cells = row.querySelectorAll('td');
      return {
        rol: this._cleanText(cells[0]?.textContent),
        estado_notif: this._cleanText(cells[1]?.textContent),
        tipo_notif: this._cleanText(cells[2]?.textContent),
        fecha_tramite: this._cleanText(cells[3]?.textContent),
        tipo_participante: this._cleanText(cells[4]?.textContent),
        nombre: this._cleanText(cells[5]?.textContent),
        tramite: this._cleanText(cells[6]?.textContent),
        obs_fallida: this._cleanText(cells[7]?.textContent),
      };
    }).filter(r => r.rol || r.tipo_notif);
  }

  _extractEscritos(modalBody) {
    const tab = modalBody.querySelector('#escritosCiv');
    if (!tab) return [];

    const rows = tab.querySelectorAll('tbody tr');
    return Array.from(rows).map(row => {
      const cells = row.querySelectorAll('td');
      return {
        doc: this._cleanText(cells[0]?.textContent),
        anexo: this._cleanText(cells[1]?.textContent),
        fecha_ingreso: this._cleanText(cells[2]?.textContent),
        tipo_escrito: this._cleanText(cells[3]?.textContent),
        solicitante: this._cleanText(cells[4]?.textContent),
      };
    }).filter(r => r.tipo_escrito || r.fecha_ingreso);
  }

  _extractExhortos(modalBody) {
    const tab = modalBody.querySelector('#exhortosCiv');
    if (!tab) return [];

    const rows = tab.querySelectorAll('tbody tr');
    return Array.from(rows).map(row => {
      const cells = row.querySelectorAll('td');
      return {
        rol_origen: this._cleanText(cells[0]?.textContent),
        tipo_exhorto: this._cleanText(cells[1]?.textContent),
        rol_destino: this._cleanText(cells[2]?.textContent),
        fecha_ordena: this._cleanText(cells[3]?.textContent),
        fecha_ingreso: this._cleanText(cells[4]?.textContent),
        tribunal_destino: this._cleanText(cells[5]?.textContent),
        estado_exhorto: this._cleanText(cells[6]?.textContent),
      };
    }).filter(r => r.rol_origen || r.tipo_exhorto);
  }

  // ════════════════════════════════════════════════════════
  // 8) FOLIOS — Historia tab with JWTs per document
  // ════════════════════════════════════════════════════════

  _extractFolios(modalBody) {
    const folios = [];
    const historiaTab = modalBody.querySelector('#historiaCiv');
    if (!historiaTab) return folios;

    const rows = historiaTab.querySelectorAll('tbody tr');
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 7) continue;

      const folio = this._parseFolioRow(cells);
      if (folio) folios.push(folio);
    }

    // Also check #piezasExhortoCiv for tipo E causas
    const piezasTab = modalBody.querySelector('#piezasExhortoCiv');
    if (piezasTab) {
      const piezasRows = piezasTab.querySelectorAll('tbody tr');
      for (const row of piezasRows) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 7) continue;

        const folio = this._parseFolioRow(cells);
        if (folio) {
          folio._source = 'piezas_exhorto';
          folios.push(folio);
        }
      }
    }

    return folios;
  }

  _parseFolioRow(cells) {
    const folioNum = parseInt(this._cleanText(cells[0]?.textContent), 10);
    if (isNaN(folioNum)) return null;

    // Doc cell (cells[1]): can have 1-2 forms (doc principal + certificado escrito)
    const docCell = cells[1];
    const jwtDocPrincipal = this._extractFormJwt(docCell, 'docuS.php', 'docuN.php');
    const jwtCertEscrito = this._extractFormJwt(docCell, 'docCertificadoEscrito.php');

    // Georref cell (last cell): onclick="geoReferencia('JWT')"
    const geoCell = cells[cells.length - 1];
    let jwtGeoref = null;
    if (geoCell) {
      const geoLink = geoCell.querySelector('a[onclick*="geoReferencia"]');
      if (geoLink) {
        jwtGeoref = this._extractJwtFromOnclick(
          geoLink.getAttribute('onclick') || '', 'geoReferencia'
        );
      }
    }

    return {
      numero: folioNum,
      etapa: this._cleanText(cells[3]?.textContent),
      tramite: this._cleanText(cells[4]?.textContent),
      desc_tramite: this._cleanText(cells[5]?.textContent),
      fecha_tramite: this._cleanText(cells[6]?.textContent),
      foja: parseInt(this._cleanText(cells[7]?.textContent), 10) || 0,
      jwt_doc_principal: jwtDocPrincipal,
      jwt_certificado_escrito: jwtCertEscrito,
      jwt_georef: jwtGeoref,
    };
  }

  /**
   * Extract a JWT from a form inside a cell.
   * Matches forms whose action contains any of the given endpoints.
   */
  _extractFormJwt(cell, ...endpoints) {
    if (!cell) return null;

    const forms = cell.querySelectorAll('form');
    for (const form of forms) {
      const action = form.getAttribute('action') || '';
      const matchesEndpoint = endpoints.some(ep => action.includes(ep));
      if (!matchesEndpoint) continue;

      const input = form.querySelector('input[type="hidden"]');
      if (input?.value && input.value.length > 20) {
        return {
          jwt: input.value,
          action: action,
          param: input.name || '',
        };
      }
    }
    return null;
  }

  // ════════════════════════════════════════════════════════
  // 9) CARÁTULA — from DOM1 click or chrome.storage
  // ════════════════════════════════════════════════════════

  async _resolveCaratula(rol, partialCaratula) {
    // Priority 1: window.__pjudLastClickedRow (set by content.js on row click)
    try {
      const cached = typeof window !== 'undefined' && window.__pjudLastClickedRow;
      if (cached?.caratulado && this._rolMatch(cached.rol, rol)) {
        const notExpired = cached.clickedAt && (Date.now() - cached.clickedAt) < 300000;
        if (notExpired) return cached.caratulado.substring(0, 120);
      }
    } catch (_) { /* ignore */ }

    // Priority 2: chrome.storage.session (persists until browser close)
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.session) {
        const data = await new Promise(resolve => {
          chrome.storage.session.get(['__pjudLastClickedRow'], r =>
            resolve(r?.__pjudLastClickedRow)
          );
        });
        if (data?.caratulado && this._rolMatch(data.rol, rol)) {
          return data.caratulado.substring(0, 120);
        }
      }
    } catch (_) { /* ignore */ }

    // Priority 3: chrome.storage.local (synced causas registry)
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const registry = await new Promise(resolve => {
          chrome.storage.local.get(['synced_causas_registry'], r =>
            resolve(r?.synced_causas_registry)
          );
        });
        if (Array.isArray(registry)) {
          const match = registry.find(c => this._rolMatch(c.rol, rol));
          if (match?.caratula) return match.caratula.substring(0, 120);
        }
      }
    } catch (_) { /* ignore */ }

    // Fallback: partial caratulado from DOM2 (truncated demandante name)
    return partialCaratula || null;
  }

  // ════════════════════════════════════════════════════════
  // 10) LIBRO_TIPO — from ROL letter
  // ════════════════════════════════════════════════════════

  _extractLibroTipo(rol) {
    const match = (rol || '').match(/^([A-Za-z])-/);
    return match ? match[1].toLowerCase() : null;
  }

  // ════════════════════════════════════════════════════════
  // EXHORTO DATA — exclusive to tipo E causas
  // ════════════════════════════════════════════════════════

  _extractExhortoData(modalBody) {
    // Look for the wellTable (third table.table-titulos with class wellTable)
    const wellTable = modalBody.querySelector('table.table-titulos.wellTable');
    if (!wellTable) return null;

    const text = this._cleanText(wellTable.textContent);
    const causaOrigenMatch = text.match(/Causa\s+Origen\s*:?\s*([A-Z]{1,4}-\d{1,8}-\d{4})/i);
    const tribunalOrigenMatch = text.match(/Tribunal\s+Origen\s*:?\s*(.+?)(?:$|\n)/i);

    // Extract JWT from detalleCausaCivil or causaOrigenCivil onclick
    let jwtCausaOrigen = null;
    const origenLink = wellTable.querySelector(
      'a[onclick*="detalleCausaCivil"], a[onclick*="causaOrigenCivil"]'
    );
    if (origenLink) {
      const onclick = origenLink.getAttribute('onclick') || '';
      jwtCausaOrigen =
        this._extractJwtFromOnclick(onclick, 'detalleCausaCivil') ||
        this._extractJwtFromOnclick(onclick, 'causaOrigenCivil');
    }

    if (!causaOrigenMatch && !tribunalOrigenMatch) return null;

    return {
      causa_origen: causaOrigenMatch ? causaOrigenMatch[1].toUpperCase() : null,
      tribunal_origen: tribunalOrigenMatch ? tribunalOrigenMatch[1].trim() : null,
      jwt_causa_origen: jwtCausaOrigen,
    };
  }

  // ════════════════════════════════════════════════════════
  // COOKIES — needed for causaCivil.php POST (cuaderno fetch)
  // ════════════════════════════════════════════════════════

  _captureCookies() {
    try {
      const cookieStr = document.cookie || '';
      if (!cookieStr) return null;

      const cookies = {};
      for (const part of cookieStr.split(';')) {
        const [name, ...rest] = part.trim().split('=');
        if (name === 'PHPSESSID' || name === 'TS01262d1d') {
          cookies[name] = rest.join('=');
        }
      }

      if (!cookies.PHPSESSID) return null;
      return cookies;
    } catch (_) {
      return null;
    }
  }

  // ════════════════════════════════════════════════════════
  // ENTRY POINT DETECTION
  // ════════════════════════════════════════════════════════

  _detectEntryPoint() {
    const url = window.location.href.toLowerCase();
    if (/miscausas|mis.causas|miscausa/i.test(url)) return 'mis_causas';
    // DOM1 (#verDetalle table) only exists in Consulta Unificada
    const dom1Table = document.querySelector('#verDetalle, #dtaTableDetalle');
    if (dom1Table) return 'consulta_unificada';
    return 'consulta_unificada'; // Default for MVP v1
  }

  // ════════════════════════════════════════════════════════
  // PROCEDIMIENTO MAPPING
  // ════════════════════════════════════════════════════════

  _mapProcedimiento(rawText) {
    if (!rawText) return null;
    const text = rawText.toLowerCase();

    if (/ejecutivo/i.test(text)) return 'ejecutivo';
    if (/ordinario/i.test(text)) return 'ordinario';
    if (/sumario/i.test(text)) return 'sumario';
    if (/monitorio/i.test(text)) return 'monitorio';
    if (/voluntario/i.test(text)) return 'voluntario';

    return null;
  }

  // ════════════════════════════════════════════════════════
  // DOM HELPERS
  // ════════════════════════════════════════════════════════

  _findModalBody() {
    // DOM2: the modal content for causa detail
    const selectors = [
      '#modalDetalleCivil .modal-body',
      '.modal.in .modal-body',
      '.modal.show .modal-body',
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.querySelector('table.table-titulos')) return el;
    }

    // Fallback: any modal-body with table.table-titulos visible
    const allBodies = document.querySelectorAll('.modal-body');
    for (const body of allBodies) {
      if (body.querySelector('table.table-titulos')) {
        const modal = body.closest('.modal');
        const isVisible = !modal || modal.classList.contains('in') ||
          modal.classList.contains('show') ||
          (modal.style?.display !== 'none');
        if (isVisible) return body;
      }
    }

    // Last resort: look for table.table-titulos in the page (embedded modal content)
    const tables = document.querySelectorAll('table.table-titulos');
    if (tables.length > 0) {
      const container =
        tables[0].closest('.modal-body') ||
        tables[0].closest('.panel.with-nav-tabs') ||
        tables[0].parentElement;
      if (container) return container;
    }

    return null;
  }

  /**
   * Extract JWT from an onclick attribute like: functionName('eyJhb...xyz')
   */
  _extractJwtFromOnclick(onclick, fnName) {
    if (!onclick) return null;

    // Match: fnName('JWT_VALUE') or fnName("JWT_VALUE")
    const pattern = new RegExp(
      fnName + "\\s*\\(\\s*['\"]([^'\"]+)['\"]\\s*\\)",
      'i'
    );
    const match = onclick.match(pattern);
    if (match && match[1].length > 20) return match[1];

    // Fallback: extract any JWT-like string (eyJ...) from the onclick
    const jwtMatch = onclick.match(/(eyJ[A-Za-z0-9_-]+\.[\w_-]+\.[\w_-]+)/);
    if (jwtMatch) return jwtMatch[1];

    return null;
  }

  /**
   * Detect ROL from the page when no modal is open (pre-modal state).
   */
  _detectRolFromPage() {
    // PJUD tables
    const pjudTables = document.querySelectorAll('table.table-titulos');
    for (const table of pjudTables) {
      const text = this._cleanText(table.textContent);
      const rolMatch = text.match(/ROL\s*:?\s*([A-Z]{1,4}-\d{1,8}-\d{4})/i);
      if (rolMatch) {
        return { rol: rolMatch[1].toUpperCase().replace(/\s/g, ''), source: 'pjud_table', confidence: 0.95 };
      }
    }

    // Body text scan (first 5000 chars)
    const bodyText = this._cleanText(
      (document.body?.textContent || '').substring(0, 5000)
    );
    const patterns = [
      /ROL\s*:?\s*([A-Z]{1,4}-\d{1,8}-\d{4})/i,
      /Causa\s+(?:N[°º]?\s*)?([A-Z]{1,4}-\d{1,8}-\d{4})/i,
    ];
    for (const p of patterns) {
      const m = bodyText.match(p);
      if (m) {
        return { rol: m[1].toUpperCase().replace(/\s/g, ''), source: 'dom_text', confidence: 0.7 };
      }
    }

    return null;
  }

  _cleanText(text) {
    if (!text) return '';
    return text
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _rolMatch(rolA, rolB) {
    if (!rolA || !rolB) return false;
    return String(rolA).replace(/\s/g, '').toUpperCase() ===
           String(rolB).replace(/\s/g, '').toUpperCase();
  }

  _countVisibleFolios(modalBody) {
    const historiaTab = modalBody.querySelector('#historiaCiv');
    if (!historiaTab) return 0;
    return historiaTab.querySelectorAll('tbody tr').length;
  }

  _groupFoliosByType(folios) {
    const groups = { resoluciones: 0, escritos: 0, actuaciones: 0, notificaciones: 0, otros: 0 };
    for (const f of folios) {
      groups[this._inferDocType(f.tramite)]++;
    }
    return groups;
  }

  _inferDocType(tramite) {
    const t = (tramite || '').toUpperCase();
    if (/RESOLUCI[OÓ]N|AUTO|SENTENCIA|DECRETO/i.test(t)) return 'resoluciones';
    if (/ESCRITO|DEMANDA|CONTESTACI|RECURSO|APELACI/i.test(t)) return 'escritos';
    if (/ACTUACI[OÓ]N|RECEPTOR|DILIGENCIA/i.test(t)) return 'actuaciones';
    if (/NOTIFICACI[OÓ]N|C[ÉE]DULA|CARTA/i.test(t)) return 'notificaciones';
    return 'otros';
  }
}
