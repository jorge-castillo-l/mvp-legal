/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║           STRATEGY ENGINE - "EL CEREBRO DEL SCRAPER"        ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║                                                              ║
 * ║  Arquitectura de 3 Capas con Fallback Automático:            ║
 * ║                                                              ║
 * ║  ┌─────────────────────────────────────────────────────┐     ║
 * ║  │  LAYER 1: NETWORK INTERCEPTOR (Máxima Resiliencia)  │     ║
 * ║  │  Captura PDFs a nivel de tráfico HTTP.               │     ║
 * ║  │  NO depende del DOM. Si el servidor envía un PDF,   │     ║
 * ║  │  lo capturamos sin importar cómo luce el HTML.      │     ║
 * ║  └──────────────────────┬──────────────────────────────┘     ║
 * ║                         │ Si no hay capturas...              ║
 * ║  ┌──────────────────────▼──────────────────────────────┐     ║
 * ║  │  LAYER 2: SMART DOM SCRAPER (Inmunidad al DOM)      │     ║
 * ║  │  Análisis heurístico que encuentra botones de        │     ║
 * ║  │  descarga por SIGNIFICADO (texto, iconos, contexto)  │     ║
 * ║  │  en vez de por ID/clase CSS frágil.                  │     ║
 * ║  │  + Penetra Shadow DOM e iframes.                     │     ║
 * ║  │  + Selectores actualizables via Remote Config.       │     ║
 * ║  └──────────────────────┬──────────────────────────────┘     ║
 * ║                         │ Si todo falla...                   ║
 * ║  ┌──────────────────────▼──────────────────────────────┐     ║
 * ║  │  LAYER 3: UPLOAD MANUAL (Último Recurso)             │     ║
 * ║  │  Drag & Drop de PDFs en el Sidepanel.                │     ║
 * ║  │  El usuario arrastra el archivo, nosotros lo subimos │     ║
 * ║  │  automáticamente a Supabase.                         │     ║
 * ║  └─────────────────────────────────────────────────────┘     ║
 * ║                                                              ║
 * ║  ANTI-WAF: Todas las acciones pasan por HumanThrottle       ║
 * ║  (delays gaussianos + burst protection + jitter)             ║
 * ║                                                              ║
 * ║  REMOTE CONFIG: Los selectores vienen del servidor,          ║
 * ║  NO del código. Actualización instantánea sin Chrome Store.  ║
 * ║                                                              ║
 * ╚══════════════════════════════════════════════════════════════╝
 * 
 * FLUJO DEL USUARIO (ACTUALIZADO con 4.07 + 4.09):
 *   1. Abogado navega a pjud.cl y busca su causa
 *   2. CausaContext detecta el ROL automáticamente → se muestra en Sidepanel
 *   3. Abogado CONFIRMA la causa detectada
 *   4. Presiona "Sincronizar" (UN SOLO CLICK)
 *   5. Layers 1 & 2 capturan PDFs SOLO de la zona de documentos confirmada
 *   6. PdfValidator filtra basura (tamaño, URL, magic bytes, duplicados)
 *   7. PDFs aprobados se etiquetan con ROL y se suben a Supabase
 *   8. Si todo falla, se muestra opción de upload manual
 *
 * REGLA DE ORO: Sin ROL confirmado = sin scraping. Punto.
 */

class StrategyEngine {
  constructor() {
    this.remoteConfig = new RemoteConfig();
    this.networkInterceptor = new NetworkInterceptor();
    this.causaContext = null;    // 4.07 - Detector de causa
    this.pdfValidator = null;    // 4.09 - Validador de PDFs
    this.domAnalyzer = null;
    this.humanThrottle = null;
    this.config = null;
    this.status = 'idle'; // idle | initializing | syncing | error
    this.listeners = [];
    this._initialized = false;
  }

  /**
   * Inicialización - Debe llamarse una sola vez desde content.js
   * Carga la config remota y activa la interceptación de red
   */
  async initialize() {
    if (this._initialized) return;

    this.status = 'initializing';
    this._emit('status', { phase: 'initializing', message: 'Cargando configuración...' });

    try {
      // Cargar configuración remota (con fallback a defaults)
      this.config = await this.remoteConfig.getConfig();

      // Inicializar módulos con la config
      this.domAnalyzer = new DOMAnalyzer(this.config);
      this.humanThrottle = new HumanThrottle(this.config.throttle);
      this.causaContext = new CausaContext(this.config);
      this.pdfValidator = new PdfValidator(this.causaContext);

      // Activar interceptación de red (Layer 1) - SIEMPRE activa
      this.networkInterceptor.setupPageInterception();

      // Escuchar capturas automáticas de PDFs
      this.networkInterceptor.onCapture((event) => {
        this._emit('pdf_captured', event.data);
      });

      this._initialized = true;
      this.status = 'idle';
      this._emit('status', {
        phase: 'ready',
        message: 'Scraper listo',
        configVersion: this.config.version,
      });

      console.log('[StrategyEngine] Inicializado con config v' + this.config.version);
    } catch (error) {
      this.status = 'error';
      console.error('[StrategyEngine] Error en inicialización:', error);
      this._emit('status', { phase: 'error', message: 'Error al inicializar: ' + error.message });
    }
  }

  // ════════════════════════════════════════════════════════
  // 4.07 - DETECCIÓN Y CONFIRMACIÓN DE CAUSA
  // ════════════════════════════════════════════════════════

  /**
   * Detectar la causa en la página actual.
   * Se llama automáticamente al cargar y bajo demanda.
   * Retorna el contexto detectado (o null).
   */
  detectCausa() {
    if (!this.causaContext) return null;
    const result = this.causaContext.detect();
    if (result) {
      this._emit('causa_detected', result);
    }
    return result;
  }

  /**
   * Confirmar la causa detectada (tras aprobación del abogado).
   * GATE: Sin esto, sync() se niega a ejecutar.
   */
  confirmCausa() {
    if (!this.causaContext) return false;
    const confirmed = this.causaContext.confirm();
    if (confirmed) {
      this._emit('causa_confirmed', this.causaContext.getConfirmedCausa());
    }
    return confirmed;
  }

  /**
   * Obtener la causa detectada (confirmada o no)
   */
  getDetectedCausa() {
    return this.causaContext?.detectedCausa || null;
  }

  /**
   * ════════════════════════════════════════════════════════
   * SYNC - El flujo principal del "botón único"
   * ════════════════════════════════════════════════════════
   * REGLA: Requiere causa confirmada. Sin excepción.
   * Ejecuta las 3 capas → valida → sube.
   */
  async sync() {
    if (this.status === 'syncing') {
      console.warn('[StrategyEngine] Ya hay una sincronización en curso');
      return null;
    }

    if (!this._initialized) {
      await this.initialize();
    }

    // ──── GATE: Verificar causa confirmada (4.07) ────
    if (!this.causaContext.hasConfirmedCausa()) {
      this._emit('status', {
        phase: 'no_causa',
        message: 'Debe confirmar la causa antes de sincronizar. Verifique el ROL detectado.',
      });
      return { error: 'Causa no confirmada', needsManual: false, totalFound: 0, totalUploaded: 0 };
    }

    const confirmedCausa = this.causaContext.getConfirmedCausa();
    this.status = 'syncing';
    const startTime = Date.now();

    const results = {
      rol: confirmedCausa.rol,
      layer1: [],
      layer2: [],
      validated: [],
      rejected: [],
      needsManual: false,
      totalFound: 0,
      totalValidated: 0,
      totalUploaded: 0,
      errors: [],
      duration: 0,
    };

    try {
      this._emit('status', {
        phase: 'starting',
        message: `Sincronizando causa ${confirmedCausa.rol}...`,
      });

      // ──── FASE 1: LAYER 1 - Network Interception ────
      this._emit('status', { phase: 'layer1', message: 'Verificando documentos interceptados...' });

      const intercepted = this.networkInterceptor.getCapturedFiles();
      if (intercepted.length > 0) {
        results.layer1 = intercepted;
        this._emit('status', {
          phase: 'layer1_success',
          message: `Layer 1: ${intercepted.length} documento(s) capturado(s) de la red`,
          count: intercepted.length,
        });
      } else {
        this._emit('status', {
          phase: 'layer1_empty',
          message: 'Layer 1: Sin capturas en red. Buscando en el DOM...',
        });
      }

      // ──── FASE 2: LAYER 2 - Smart DOM Scraping (acotado a zona de documentos) ────
      this._emit('status', { phase: 'layer2', message: 'Analizando zona de documentos...' });

      const domResults = await this._executeDomScraping();
      results.layer2 = domResults;

      // ──── FASE 3: VALIDACIÓN (4.09) ────
      const allCaptured = [...results.layer1, ...results.layer2];
      results.totalFound = allCaptured.length;

      if (allCaptured.length > 0) {
        this._emit('status', {
          phase: 'validating',
          message: `Validando ${allCaptured.length} documento(s)...`,
        });

        const validation = await this.pdfValidator.validateBatch(allCaptured);
        results.validated = validation.approved;
        results.rejected = validation.rejected;
        results.totalValidated = validation.approved.length;

        if (validation.rejected.length > 0) {
          this._emit('status', {
            phase: 'filtered',
            message: `${validation.rejected.length} documento(s) descartado(s) por filtros de calidad`,
          });
        }

        // ──── FASE 4: UPLOAD (solo PDFs validados) ────
        if (validation.approved.length > 0) {
          this._emit('status', {
            phase: 'uploading',
            message: `Subiendo ${validation.approved.length} documento(s) validado(s)...`,
          });

          const uploaded = await this._uploadValidated(validation.approved);
          results.totalUploaded = uploaded;

          this._emit('status', {
            phase: 'complete',
            message: `Sincronización completa: ${uploaded} subido(s), ${validation.rejected.length} descartado(s)`,
            totalFound: results.totalFound,
            totalValidated: results.totalValidated,
            totalUploaded: uploaded,
            totalRejected: validation.rejected.length,
          });
        } else {
          results.needsManual = true;
          this._emit('status', {
            phase: 'all_rejected',
            message: 'Todos los documentos capturados fueron rechazados por los filtros. Use la subida manual.',
          });
        }
      } else {
        results.needsManual = true;
        this._emit('status', {
          phase: 'fallback',
          message: 'No se detectaron documentos en la zona de la causa. Use la subida manual.',
        });
      }
    } catch (error) {
      console.error('[StrategyEngine] Error en sync:', error);
      results.errors.push(error.message);
      results.needsManual = true;

      this._emit('status', {
        phase: 'error',
        message: `Error: ${error.message}. Use la subida manual.`,
      });
    }

    results.duration = Date.now() - startTime;
    this.status = 'idle';
    this.networkInterceptor.clearCaptured();

    return results;
  }

  // ════════════════════════════════════════════════════════
  // LAYER 2: DOM Scraping con Throttle Humano
  // ════════════════════════════════════════════════════════

  async _executeDomScraping() {
    const results = [];
    const documentZone = this.causaContext.getDocumentZone();

    // Si tenemos zona de documentos confirmada, buscar SOLO dentro de ella
    if (documentZone?.element) {
      this._emit('status', {
        phase: 'layer2_scoped',
        message: 'Buscando descargas dentro de la zona de documentos de la causa...',
      });

      // Buscar links de descarga DENTRO de la zona confirmada
      const zoneElement = documentZone.element;
      const clickables = zoneElement.querySelectorAll('a, button, [onclick], [role="button"]');
      const candidates = [];

      for (const el of clickables) {
        const score = this.domAnalyzer._scoreDownloadElement(el);
        if (score >= (this.config.heuristics?.minConfidenceThreshold || 0.35)) {
          candidates.push({ element: el, confidence: score, source: 'scoped_zone' });
        }
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => b.confidence - a.confidence);
        this._emit('status', {
          phase: 'layer2_found',
          message: `${candidates.length} enlace(s) de descarga en la zona de documentos`,
        });

        let downloadCount = 0;
        for (const candidate of candidates.slice(0, 30)) {
          const pdf = await this._attemptDownload(candidate);
          if (pdf) {
            results.push(pdf);
            downloadCount++;

            this._emit('status', {
              phase: 'layer2_downloading',
              message: `Descargando documento ${downloadCount}/${candidates.length}...`,
              current: downloadCount,
              total: candidates.length,
            });
          }
        }
      }

      return results;
    }

    // Fallback: Sin zona confirmada, buscar tabla de forma heurística
    const tableResult = this.domAnalyzer.findCausaTable();
    if (!tableResult) {
      console.log('[StrategyEngine] Layer 2: No se encontró zona de documentos');
      return results;
    }

    this._emit('status', {
      phase: 'layer2_table',
      message: `Tabla detectada (confianza: ${Math.round(tableResult.confidence * 100)}%). Extrayendo...`,
    });

    const cases = this.domAnalyzer.extractCaseData(tableResult);
    let downloadCount = 0;

    for (const caseData of cases) {
      if (caseData.downloadLinks.length === 0) continue;
      const bestLink = caseData.downloadLinks[0];

      const pdf = await this._attemptDownload(bestLink);
      if (pdf) {
        pdf.caseText = caseData.text;
        results.push(pdf);
        downloadCount++;

        this._emit('status', {
          phase: 'layer2_downloading',
          message: `Descargando documento ${downloadCount}...`,
          current: downloadCount,
        });
      }
    }

    return results;
  }

  /**
   * Intentar descargar un PDF simulando click en un elemento
   * Usa el throttle humano + espera captura por red
   */
  async _attemptDownload(candidate) {
    try {
      return await this.humanThrottle.executeThrottled(async () => {
        // Preparar escucha de captura por red
        const capturePromise = this.networkInterceptor.waitForCapture(12000);

        // Simular click humano en el elemento
        this._simulateHumanClick(candidate.element);

        // Esperar a que el interceptor de red capture el PDF
        const captured = await capturePromise;

        if (captured) {
          return {
            ...captured,
            source: 'dom_triggered',
            confidence: candidate.confidence || candidate.score,
          };
        }

        return null;
      });
    } catch (error) {
      console.warn('[StrategyEngine] Error al descargar:', error.message);
      return null;
    }
  }

  /**
   * Simular un click lo más humano posible
   * Incluye mouseover, mousedown, mouseup, click
   * Los WAF avanzados verifican la secuencia completa de eventos
   */
  _simulateHumanClick(element) {
    try {
      // Scroll al elemento (un humano necesita verlo)
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Secuencia completa de eventos del mouse
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2 + (Math.random() * 4 - 2);
      const y = rect.top + rect.height / 2 + (Math.random() * 4 - 2);

      const eventOptions = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y,
      };

      element.dispatchEvent(new MouseEvent('mouseover', eventOptions));
      element.dispatchEvent(new MouseEvent('mousedown', eventOptions));

      // Pequeño delay entre mousedown y mouseup (humanos no son instantáneos)
      setTimeout(() => {
        element.dispatchEvent(new MouseEvent('mouseup', eventOptions));
        element.dispatchEvent(new MouseEvent('click', eventOptions));
      }, 50 + Math.random() * 100);
    } catch (e) {
      // Fallback: click simple
      element.click();
    }
  }

  // ════════════════════════════════════════════════════════
  // UPLOAD: Subir PDFs capturados al servidor
  // ════════════════════════════════════════════════════════

  async _uploadValidated(validatedPdfs) {
    let uploadedCount = 0;

    for (const pdf of validatedPdfs) {
      if (!pdf?.blobUrl) continue;

      try {
        // Obtener el blob desde la URL
        const response = await fetch(pdf.blobUrl);
        const blob = await response.blob();

        // Construir nombre descriptivo con ROL
        const timestamp = Date.now();
        const rolPart = pdf.rol ? pdf.rol.replace(/[^a-zA-Z0-9-]/g, '_') : 'doc';
        const typePart = pdf.documentType || 'doc';
        const filename = `${rolPart}_${typePart}_${timestamp}.pdf`;

        // Preparar FormData con metadata completa (4.09 ROL tagging)
        const formData = new FormData();
        formData.append('file', blob, filename);
        formData.append('source_url', pdf.url || '');
        formData.append('source', pdf.source || 'scraper');
        formData.append('rol', pdf.rol || '');
        formData.append('tribunal', pdf.tribunal || '');
        formData.append('caratula', pdf.caratula || '');
        formData.append('document_type', pdf.documentType || 'otro');
        formData.append('confidence', String(pdf.confidence || 0));
        formData.append('captured_at', pdf.capturedAt || new Date().toISOString());

        // Obtener token de autenticación
        const session = await supabase.getSession();
        if (!session?.access_token) {
          throw new Error('No hay sesión activa. Inicie sesión primero.');
        }

        // Subir al servidor via API
        const uploadResponse = await fetch('http://localhost:3000/api/upload', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: formData,
        });

        if (!uploadResponse.ok) {
          const errorData = await uploadResponse.json().catch(() => ({}));
          throw new Error(errorData.error || `Upload HTTP ${uploadResponse.status}`);
        }

        const result = await uploadResponse.json();
        uploadedCount++;

        // Registrar hash para deduplicación futura
        if (pdf._hash && this.pdfValidator) {
          const session2 = await supabase.getSession();
          await this.pdfValidator.registerUploadedHash(
            pdf._hash, session2?.user?.id, pdf.rol
          );
        }

        this._emit('pdf_uploaded', {
          filename, size: blob.size, path: result.path,
          rol: pdf.rol, type: pdf.documentType,
        });
      } catch (error) {
        console.error('[StrategyEngine] Error subiendo PDF:', error);
        this._emit('upload_error', { error: error.message, pdf: pdf.url });
      }
    }

    return uploadedCount;
  }

  // ════════════════════════════════════════════════════════
  // UPLOAD MANUAL (Layer 3) - Llamado desde el Sidepanel
  // ════════════════════════════════════════════════════════

  async uploadManual(file) {
    if (!file) throw new Error('No se proporcionó archivo');
    if (file.type !== 'application/pdf') throw new Error('Solo se aceptan archivos PDF');

    this._emit('status', { phase: 'manual_uploading', message: `Subiendo ${file.name}...` });

    const formData = new FormData();
    formData.append('file', file, file.name);
    formData.append('source', 'manual_upload');

    const session = await supabase.getSession();
    if (!session?.access_token) {
      throw new Error('No hay sesión activa');
    }

    const response = await fetch('http://localhost:3000/api/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Upload HTTP ${response.status}`);
    }

    const result = await response.json();
    this._emit('status', { phase: 'manual_complete', message: `${file.name} subido exitosamente` });
    this._emit('pdf_uploaded', { filename: file.name, size: file.size, path: result.path });

    return result;
  }

  // ════════════════════════════════════════════════════════
  // SISTEMA DE EVENTOS
  // ════════════════════════════════════════════════════════

  /**
   * Suscribirse a eventos del engine
   * Eventos: status, pdf_captured, pdf_uploaded, error
   */
  on(event, callback) {
    this.listeners.push({ event, callback });
    return () => {
      this.listeners = this.listeners.filter(l => !(l.event === event && l.callback === callback));
    };
  }

  _emit(event, data) {
    for (const listener of this.listeners) {
      if (listener.event === event || listener.event === '*') {
        try {
          listener.callback(data);
        } catch (e) {
          console.error('[StrategyEngine] Error en listener:', e);
        }
      }
    }

    // También enviar al service worker para que el sidepanel pueda escuchar
    try {
      chrome.runtime.sendMessage({
        type: 'scraper_event',
        event: event,
        data: data,
      }).catch(() => {}); // Ignorar si no hay listener
    } catch (e) {
      // No hay service worker escuchando - normal
    }
  }
}
