/**
 * ============================================================
 * JWT EXTRACTOR — Extrae CausaPackage del DOM de PJUD
 * ============================================================
 * Lee el modal #modalDetalleCivil y extrae:
 *   1) Metadata global de la causa (T1)
 *   2) JWTs de docs directos: Texto Demanda, Certificado, Ebook (T2)
 *   3) JWT de Anexos de la causa (T3)
 *   4) JWT de Receptor (T4)
 *   5) Remisiones en la Corte con JWTs (T5)
 *   6) Exhortos deduplicados con JWTs (T6)
 *   7) Causa Origen para tipo E (T6-E)
 *   8) Cuaderno visible completo: proc, etapa, folios, litigantes,
 *      notificaciones, escritos, piezas exhorto (T10a-T12)
 *   9) JWTs de cuadernos no-visibles
 *  10) CSRF token y cookies
 *
 * Estructura de 2 niveles:
 *   - Global: metadata, docs directos, anexos, receptor, exhortos, remisiones
 *   - Por cuaderno: proc, etapa, folios, litigantes, notificaciones, escritos
 * ============================================================
 */

class JwtExtractor {
  constructor() {
    this.detectedCausa = null;
    this.isConfirmed = false;
    this._lastPackage = null;
  }

  /**
   * Quick detection — finds ROL, tribunal, and basic causa info.
   */
  detect() {
    const modalBody = this._findModalBody();
    if (modalBody) {
      const metadata = this._extractMetadata(modalBody);
      if (metadata.rol) {
        this.detectedCausa = {
          rol: metadata.rol,
          rolSource: 'pjud_modal',
          rolConfidence: 0.99,
          tribunal: metadata.tribunal,
          caratula: null,
          materia: metadata.procedimiento_raw,
          estado: metadata.estado_adm,
          libro_tipo: metadata.libro_tipo,
          hasDocumentZone: true,
          documentZoneType: 'pjud_modal',
          documentPreview: { total: 0, byType: {}, items: [] },
          totalDocuments: 0,
          pageUrl: window.location.href,
          detectedAt: Date.now(),
        };
        return this.detectedCausa;
      }
    }

    const pageRol = this._detectRolFromPage();
    if (pageRol) {
      this.detectedCausa = {
        rol: pageRol.rol,
        rolSource: pageRol.source,
        rolConfidence: pageRol.confidence,
        tribunal: null,
        caratula: null,
        hasDocumentZone: false,
        documentZoneType: null,
        documentPreview: { total: 0, byType: {}, items: [] },
        totalDocuments: 0,
        pageUrl: window.location.href,
        detectedAt: Date.now(),
      };
      return this.detectedCausa;
    }

    return null;
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

    const caratula = await this._resolveCaratula(metadata.rol, metadata.tribunal, metadata._partialCaratula);
    const directJwts = this._extractDirectJwts(modalBody);
    const receptorJwt = this._extractReceptorJwt(modalBody);
    const anexosJwt = this._extractAnexosJwt(modalBody);
    const csrfToken = this._extractCsrfToken();
    const exhortoData = this._extractExhortoData(modalBody);
    const remisiones = this._extractRemisiones(modalBody);

    // Cuadernos: visible (completo) + otros (solo JWTs)
    const { cuadernoVisible, otrosCuadernos } = this._extractCuadernosStructured(modalBody, metadata);

    // Exhortos: extraer una sola vez del cuaderno visible (son iguales en todos)
    const exhortos = this._extractExhortos(modalBody);

    const causaPackage = {
      // T1: Metadata global
      rol: metadata.rol,
      libro_tipo: metadata.libro_tipo,
      tribunal: metadata.tribunal,
      caratula: caratula,
      materia: metadata.procedimiento_raw,
      estado_adm: metadata.estado_adm,
      ubicacion: metadata.ubicacion,
      estado_procesal: metadata.estado_procesal,
      fecha_ingreso: metadata.fecha_ingreso,
      fuente: this._detectEntryPoint(),
      cookies: this._captureCookies(),
      csrf_token: csrfToken,

      // T2: Docs directos (globales)
      jwt_texto_demanda: directJwts.textoDemanda,
      jwt_certificado_envio: directJwts.certificadoEnvio,
      jwt_ebook: directJwts.ebook,

      // JWTs globales
      jwt_anexos: anexosJwt,
      jwt_receptor: receptorJwt,

      // Cuaderno visible completo
      cuaderno_visible: cuadernoVisible,

      // Cuadernos no-visibles (JWTs para server)
      otros_cuadernos: otrosCuadernos,

      // T6: Exhortos (deduplicados)
      exhortos: exhortos,

      // T6-E: Causa origen (solo tipo E)
      exhorto_data: exhortoData,

      // T5: Remisiones
      remisiones: remisiones,

      // Meta
      extracted_at: new Date().toISOString(),
      page_url: window.location.href,
    };

    this._lastPackage = causaPackage;

    this.detectedCausa = {
      rol: metadata.rol,
      rolSource: 'pjud_modal',
      rolConfidence: 0.99,
      tribunal: metadata.tribunal,
      caratula: caratula,
      materia: metadata.procedimiento_raw,
      estado: metadata.estado_adm,
      libro_tipo: metadata.libro_tipo,
      hasDocumentZone: true,
      documentZoneType: 'pjud_modal',
      documentPreview: { total: cuadernoVisible.folios.length, byType: {}, items: [] },
      totalDocuments: cuadernoVisible.folios.length,
      pageUrl: window.location.href,
      detectedAt: Date.now(),
    };

    console.log(
      '[JwtExtractor] CausaPackage extraído:',
      metadata.rol, '|',
      metadata.tribunal, '|',
      `cuaderno "${cuadernoVisible.nombre}": ${cuadernoVisible.folios.length} folios,`,
      `${otrosCuadernos.length} cuadernos adicionales,`,
      `${exhortos.length} exhortos,`,
      `${remisiones.length} remisiones`,
    );

    return causaPackage;
  }

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
  // 1) METADATA — T1: tabla superior del modal
  // ════════════════════════════════════════════════════════

  _extractMetadata(modalBody) {
    const result = {
      rol: null,
      libro_tipo: null,
      tribunal: null,
      estado_adm: null,
      procedimiento_raw: null,
      ubicacion: null,
      fecha_ingreso: null,
      estado_procesal: null,
      etapa_raw: null,
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
      for (const cell of cells) {
        const text = this._cleanText(cell.textContent);
        const fechaMatch = text.match(/F\.\s*Ing\.\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i);
        if (fechaMatch) {
          result.fecha_ingreso = fechaMatch[1];
          break;
        }
      }
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
        if (procMatch) result.procedimiento_raw = procMatch[1].trim();

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
        if (etapaMatch) result.etapa_raw = etapaMatch[1].trim();

        const tribMatch = text.match(/Tribunal\s*:?\s*(.+)/i);
        if (tribMatch) result.tribunal = tribMatch[1].trim();
      }
    }

    return result;
  }

  // ════════════════════════════════════════════════════════
  // 2) DIRECT JWTs — T2: forms in second table.table-titulos
  // ════════════════════════════════════════════════════════

  _extractDirectJwts(modalBody) {
    const result = { textoDemanda: null, certificadoEnvio: null, ebook: null };

    const tables = modalBody.querySelectorAll('table.table-titulos');
    if (tables.length < 2) return result;

    const jwtTable = tables[1];

    const txtForm = jwtTable.querySelector('form[action*="docu.php"]:not([action*="docuS"]):not([action*="docuN"])');
    if (txtForm) {
      const input = txtForm.querySelector('input[name="valorEncTxtDmda"]');
      if (input?.value && input.value.length > 20) {
        result.textoDemanda = { jwt: input.value, action: txtForm.getAttribute('action') || '', param: 'valorEncTxtDmda' };
      }
    }

    const certForm = jwtTable.querySelector('form[action*="docCertificadoDemanda"]');
    if (certForm) {
      const input = certForm.querySelector('input[name="dtaCert"]');
      if (input?.value && input.value.length > 20) {
        result.certificadoEnvio = { jwt: input.value, action: certForm.getAttribute('action') || '', param: 'dtaCert' };
      }
    }

    const ebookForm = jwtTable.querySelector('form[action*="newebookcivil"]');
    if (ebookForm) {
      const input = ebookForm.querySelector('input[name="dtaEbook"]');
      if (input?.value && input.value.length > 20) {
        result.ebook = { jwt: input.value, action: ebookForm.getAttribute('action') || '', param: 'dtaEbook' };
      }
    }

    return result;
  }

  // ════════════════════════════════════════════════════════
  // 3) ANEXOS JWT — T3: onclick=anexoCausaCivil('JWT')
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
  // 4) CUADERNOS — visible (completo) + otros (JWTs)
  // ════════════════════════════════════════════════════════

  _extractCuadernosStructured(modalBody, metadata) {
    const select = modalBody.querySelector('select#selCuaderno');
    const allOptions = select ? Array.from(select.querySelectorAll('option')) : [];

    let selectedName = 'Principal';
    const otrosCuadernos = [];

    for (const option of allOptions) {
      const jwt = option.value;
      const nombre = this._cleanText(option.textContent);
      if (!jwt || jwt.length < 20) continue;

      const isSelected = option.selected || option.hasAttribute('selected');
      if (isSelected) {
        selectedName = nombre;
      } else {
        otrosCuadernos.push({ nombre, jwt });
      }
    }

    // Cuaderno visible: datos completos del DOM actual
    const cuadernoVisible = {
      nombre: selectedName,
      procedimiento: metadata.procedimiento_raw || null,
      etapa: metadata.etapa_raw || null,
      folios: this._extractFolios(modalBody),
      litigantes: this._extractLitigantes(modalBody),
      notificaciones: this._extractNotificaciones(modalBody),
      escritos: this._extractEscritos(modalBody),
      piezas_exhorto: this._extractPiezasExhorto(modalBody),
    };

    return { cuadernoVisible, otrosCuadernos };
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
    const tokenInput = document.querySelector(
      'input[name="token"][type="hidden"], input[name="_token"][type="hidden"]'
    );
    if (tokenInput?.value && /^[a-f0-9]{20,64}$/i.test(tokenInput.value)) {
      return tokenInput.value;
    }

    const metaTags = document.querySelectorAll('meta[name*="token"], meta[name*="csrf"]');
    for (const meta of metaTags) {
      const content = meta.getAttribute('content');
      if (content && /^[a-f0-9]{20,64}$/i.test(content)) return content;
    }

    const scripts = document.querySelectorAll('script:not([src])');
    for (const script of scripts) {
      const tokenMatch = (script.textContent || '').match(
        /(?:var\s+)?token\s*[:=]\s*['"]([a-f0-9]{20,64})['"]/i
      );
      if (tokenMatch) return tokenMatch[1];
    }

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
  // 7) TABS — T10c, T10d, T10e (por cuaderno)
  // ════════════════════════════════════════════════════════

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
        nombre_razon_social: this._cleanText(cells[3]?.textContent),
      };
    }).filter(r => r.participante || r.nombre_razon_social);
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

      const jwtDoc = cells[0] ? this._extractFormJwt(cells[0], 'docuS.php', 'docuN.php') : null;

      return {
        fecha_ingreso: this._cleanText(cells[2]?.textContent),
        tipo_escrito: this._cleanText(cells[3]?.textContent),
        solicitante: this._cleanText(cells[4]?.textContent),
        tiene_doc: !!jwtDoc,
        tiene_anexo: !!(cells[1] && cells[1].querySelector('a')),
        jwt_doc: jwtDoc,
      };
    }).filter(r => r.tipo_escrito || r.fecha_ingreso);
  }

  // ════════════════════════════════════════════════════════
  // 8) EXHORTOS — T6 (global, extraer una sola vez)
  // ════════════════════════════════════════════════════════

  _extractExhortos(modalBody) {
    const tab = modalBody.querySelector('#exhortosCiv');
    if (!tab) return [];

    const rows = tab.querySelectorAll('tbody tr');
    return Array.from(rows).map(row => {
      const cells = row.querySelectorAll('td');

      let jwt_detalle = null;
      if (cells[2]) {
        const label = cells[2].querySelector('label[onclick*="detalleExhortosCivil"]');
        if (label) {
          jwt_detalle = this._extractJwtFromOnclick(
            label.getAttribute('onclick') || '', 'detalleExhortosCivil'
          );
        }
      }

      return {
        rol_origen: this._cleanText(cells[0]?.textContent),
        tipo_exhorto: this._cleanText(cells[1]?.textContent),
        rol_destino: this._cleanText(cells[2]?.textContent),
        fecha_ordena: this._cleanText(cells[3]?.textContent),
        fecha_ingreso: this._cleanText(cells[4]?.textContent),
        tribunal_destino: this._cleanText(cells[5]?.textContent),
        estado_exhorto: this._cleanText(cells[6]?.textContent),
        jwt_detalle: jwt_detalle,
      };
    }).filter(r => r.rol_origen || r.tipo_exhorto);
  }

  // ════════════════════════════════════════════════════════
  // 9) FOLIOS — T10b: tabla Historia (por cuaderno)
  //    Extrae TODOS los folios, tengan o no PDF
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

    return folios;
  }

  _parseFolioRow(cells) {
    const folioNum = parseInt(this._cleanText(cells[0]?.textContent), 10);
    if (isNaN(folioNum)) return null;

    const docCell = cells[1];
    const jwtDocPrincipal = this._extractFormJwt(docCell, 'docuS.php', 'docuN.php');
    const jwtCertEscrito = this._extractFormJwt(docCell, 'docCertificadoEscrito.php');

    let jwtAnexoSolicitud = null;
    if (cells[2]) {
      const anexoLink = cells[2].querySelector('a[onclick*="anexoSolicitudCivil"]');
      if (anexoLink) {
        jwtAnexoSolicitud = this._extractJwtFromOnclick(
          anexoLink.getAttribute('onclick') || '', 'anexoSolicitudCivil'
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
      tiene_doc_principal: !!jwtDocPrincipal,
      tiene_certificado_escrito: !!jwtCertEscrito,
      tiene_anexo_solicitud: !!jwtAnexoSolicitud,
      jwt_doc_principal: jwtDocPrincipal,
      jwt_certificado_escrito: jwtCertEscrito,
      jwt_anexo_solicitud: jwtAnexoSolicitud,
    };
  }

  // ════════════════════════════════════════════════════════
  // 10) PIEZAS EXHORTO — T12 (solo causas tipo E)
  //     Columnas: Folio, Doc, Cuaderno, Anexo, Etapa,
  //               Trámite, Desc.Trámite, Fec.Trámite, Foja
  // ════════════════════════════════════════════════════════

  _extractPiezasExhorto(modalBody) {
    const tab = modalBody.querySelector('#piezasExhortoCiv');
    if (!tab) return [];

    const piezas = [];
    const rows = tab.querySelectorAll('tbody tr');
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 8) continue;

      const folioNum = parseInt(this._cleanText(cells[0]?.textContent), 10);
      if (isNaN(folioNum)) continue;

      const jwtDoc = this._extractFormJwt(cells[1], 'docuS.php', 'docuN.php');

      piezas.push({
        numero_folio: folioNum,
        cuaderno_pieza: this._cleanText(cells[2]?.textContent),
        etapa: this._cleanText(cells[4]?.textContent),
        tramite: this._cleanText(cells[5]?.textContent),
        desc_tramite: this._cleanText(cells[6]?.textContent),
        fecha_tramite: this._cleanText(cells[7]?.textContent),
        foja: parseInt(this._cleanText(cells[8]?.textContent), 10) || 0,
        tiene_doc: !!jwtDoc,
        tiene_anexo: !!(cells[3] && cells[3].querySelector('a')),
        jwt_doc: jwtDoc,
      });
    }

    return piezas;
  }

  // ════════════════════════════════════════════════════════
  // 11) REMISIONES EN LA CORTE — T5
  // ════════════════════════════════════════════════════════

  _extractRemisiones(modalBody) {
    const remisiones = [];

    const headings = modalBody.querySelectorAll('.panel-heading h4');
    let remisionesPanel = null;
    for (const h4 of headings) {
      if (/remisiones\s+en\s+la\s+corte/i.test(h4.textContent)) {
        remisionesPanel = h4.closest('.panel');
        break;
      }
    }

    if (!remisionesPanel) return remisiones;

    const rows = remisionesPanel.querySelectorAll('tbody tr');
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 3) continue;

      const link = cells[0].querySelector('a[onclick*="detalleCausaApelaciones"]');
      if (!link) continue;

      const jwt = this._extractJwtFromOnclick(
        link.getAttribute('onclick') || '', 'detalleCausaApelaciones'
      );
      if (!jwt) continue;

      remisiones.push({
        jwt: jwt,
        descripcion_tramite: this._cleanText(cells[1]?.textContent),
        fecha_tramite: this._cleanText(cells[2]?.textContent),
      });
    }

    return remisiones;
  }

  // ════════════════════════════════════════════════════════
  // 12) EXHORTO DATA — T6-E (solo causas tipo E)
  // ════════════════════════════════════════════════════════

  _extractExhortoData(modalBody) {
    const wellTable = modalBody.querySelector('table.table-titulos.wellTable');
    if (!wellTable) return null;

    const text = this._cleanText(wellTable.textContent);
    const causaOrigenMatch = text.match(/Causa\s+Origen\s*:?\s*([A-Z]{1,4}-\d{1,8}-\d{4})/i);
    const tribunalOrigenMatch = text.match(/Tribunal\s+Origen\s*:?\s*(.+?)(?:$|\n)/i);

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
  // DOM HELPERS
  // ════════════════════════════════════════════════════════

  _findModalBody() {
    const selectors = [
      '#modalDetalleCivil .modal-body',
      '.modal.in .modal-body',
      '.modal.show .modal-body',
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.querySelector('table.table-titulos')) return el;
    }

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

  _extractJwtFromOnclick(onclick, fnName) {
    if (!onclick) return null;

    const pattern = new RegExp(
      fnName + "\\s*\\(\\s*['\"]([^'\"]+)['\"]\\s*\\)",
      'i'
    );
    const match = onclick.match(pattern);
    if (match && match[1].length > 20) return match[1];

    const jwtMatch = onclick.match(/(eyJ[A-Za-z0-9_-]+\.[\w_-]+\.[\w_-]+)/);
    if (jwtMatch) return jwtMatch[1];

    return null;
  }

  // ════════════════════════════════════════════════════════
  // CARÁTULA — from DOM1 click or chrome.storage
  // ════════════════════════════════════════════════════════

  async _resolveCaratula(rol, tribunal, partialCaratula) {
    try {
      const cached = typeof window !== 'undefined' && window.__pjudLastClickedRow;
      if (cached?.caratulado && this._rolMatch(cached.rol, rol) &&
          this._tribunalMatch(cached.tribunal, tribunal)) {
        const notExpired = cached.clickedAt && (Date.now() - cached.clickedAt) < 300000;
        if (notExpired) return cached.caratulado.substring(0, 120);
      }
    } catch (_) { /* ignore */ }

    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.session) {
        const data = await new Promise(resolve => {
          chrome.storage.session.get(['__pjudLastClickedRow'], r =>
            resolve(r?.__pjudLastClickedRow)
          );
        });
        if (data?.caratulado && this._rolMatch(data.rol, rol) &&
            this._tribunalMatch(data.tribunal, tribunal)) {
          return data.caratulado.substring(0, 120);
        }
      }
    } catch (_) { /* ignore */ }

    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const registry = await new Promise(resolve => {
          chrome.storage.local.get(['synced_causas_registry'], r =>
            resolve(r?.synced_causas_registry)
          );
        });
        if (Array.isArray(registry)) {
          const match = registry.find(c =>
            this._rolMatch(c.rol, rol) && this._tribunalMatch(c.tribunal, tribunal)
          );
          if (match?.caratula) return match.caratula.substring(0, 120);
        }
      }
    } catch (_) { /* ignore */ }

    return partialCaratula || null;
  }

  // ════════════════════════════════════════════════════════
  // UTILITIES
  // ════════════════════════════════════════════════════════

  _extractLibroTipo(rol) {
    const match = (rol || '').match(/^([A-Za-z])-/);
    return match ? match[1].toLowerCase() : null;
  }

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

  _detectEntryPoint() {
    const url = window.location.href.toLowerCase();
    if (/miscausas|mis.causas|miscausa/i.test(url)) return 'mis_causas';
    const dom1Table = document.querySelector('#verDetalle, #dtaTableDetalle');
    if (dom1Table) return 'consulta_unificada';
    return 'consulta_unificada';
  }

  _detectRolFromPage() {
    const pjudTables = document.querySelectorAll('table.table-titulos');
    for (const table of pjudTables) {
      const text = this._cleanText(table.textContent);
      const rolMatch = text.match(/ROL\s*:?\s*([A-Z]{1,4}-\d{1,8}-\d{4})/i);
      if (rolMatch) {
        return { rol: rolMatch[1].toUpperCase().replace(/\s/g, ''), source: 'pjud_table', confidence: 0.95 };
      }
    }

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

  _tribunalMatch(triA, triB) {
    if (!triA || !triB) return true;
    return triA.trim().toLowerCase() === triB.trim().toLowerCase();
  }
}
