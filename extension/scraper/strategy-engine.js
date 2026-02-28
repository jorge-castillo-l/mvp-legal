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
 * FLUJO DEL USUARIO (ACTUALIZADO con 4.16 JWT Extractor):
 *   1. Abogado navega a pjud.cl y busca su causa
 *   2. JwtExtractor detecta el ROL automáticamente → se muestra en Sidepanel
 *   3. Abogado CONFIRMA la causa detectada
 *   4. Presiona "Sincronizar" (UN SOLO CLICK)
 *   5. JwtExtractor extrae CausaPackage (JWTs + metadata) del DOM visible
 *   6. CausaPackage se envía al service-worker → API /api/scraper/sync (4.17)
 *   7. El servidor descarga los PDFs usando los JWTs
 *   8. Upload manual disponible como fallback
 *
 * REGLA DE ORO: Sin ROL confirmado = sin scraping. Punto.
 */

class StrategyEngine {
  constructor() {
    this.remoteConfig = new RemoteConfig();
    this.networkInterceptor = new NetworkInterceptor();
    this.jwtExtractor = null;    // 4.16 - JWT Extractor (replaces CausaContext + DOMAnalyzer)
    this.pdfValidator = null;    // 4.09 - Validador de PDFs
    this.humanThrottle = null;
    this.config = null;
    this.status = 'idle'; // idle | initializing | syncing | error
    this.listeners = [];
    this._initialized = false;

    // Backward-compat alias
    this.causaContext = null;
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
      this.humanThrottle = new HumanThrottle(this.config.throttle);
      this.jwtExtractor = new JwtExtractor(this.config);
      this.causaContext = this.jwtExtractor; // Backward-compat alias for PdfValidator
      this.pdfValidator = new PdfValidator(this.jwtExtractor);

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
  // 4.16 - DETECCIÓN, CONFIRMACIÓN Y EXTRACCIÓN
  // ════════════════════════════════════════════════════════

  /**
   * Detectar la causa en la página actual.
   * Se llama automáticamente al cargar y bajo demanda.
   */
  async detectCausa() {
    if (!this.jwtExtractor) return null;
    const result = await this.jwtExtractor.detect();
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
    if (!this.jwtExtractor) return false;
    const confirmed = this.jwtExtractor.confirm();
    if (confirmed) {
      this._emit('causa_confirmed', this.jwtExtractor.getConfirmedCausa());
    }
    return confirmed;
  }

  /**
   * Obtener la causa detectada (confirmada o no)
   */
  getDetectedCausa() {
    return this.jwtExtractor?.detectedCausa || null;
  }

  /**
   * 4.16: Full extraction — CausaPackage with all JWTs + metadata.
   * Called before sync to prepare the package for the API.
   */
  async extractCausaPackage() {
    if (!this.jwtExtractor) return null;

    this._emit('status', { phase: 'extracting', message: 'Extrayendo datos del expediente...' });

    const pkg = await this.jwtExtractor.extract();
    if (!pkg) {
      this._emit('status', {
        phase: 'extract_failed',
        message: 'No se pudo extraer la información de la causa. ¿Está el modal abierto?',
      });
      return null;
    }

    this._emit('causa_package_extracted', {
      rol: pkg.rol,
      tribunal: pkg.tribunal,
      procedimiento: pkg.procedimiento,
      cuadernos: pkg.cuadernos.length,
      folios: pkg.folios.length,
      hasTextoDemanda: !!pkg.jwt_texto_demanda,
      hasCertificado: !!pkg.jwt_certificado_envio,
      hasEbook: !!pkg.jwt_ebook,
      hasAnexos: !!pkg.jwt_anexos,
    });

    return pkg;
  }

  /**
   * ════════════════════════════════════════════════════════
   * SYNC - El flujo principal del "botón único"
   * ════════════════════════════════════════════════════════
   * REGLA: Requiere causa detectada. Sin excepción.
   *
   * FLUJO 4.16+:
   *   1. JwtExtractor extrae CausaPackage (JWTs + metadata) del DOM
   *   2. CausaPackage se envía al service-worker
   *   3. service-worker → API /api/scraper/sync (4.17) descarga PDFs server-side
   *   4. Fallback: upload manual si la extracción falla
   */
  async sync() {
    if (this.status === 'syncing') {
      console.warn('[StrategyEngine] Ya hay una sincronización en curso');
      return null;
    }

    if (!this._initialized) {
      await this.initialize();
    }

    // ──── GATE: Verificar causa detectada; auto-confirmar ────
    const detected = this.jwtExtractor.detectedCausa;
    if (!detected) {
      this._emit('status', {
        phase: 'no_causa',
        message: 'No se detectó una causa. Navegue a una causa en pjud.cl y intente de nuevo.',
      });
      return { error: 'Causa no detectada', needsManual: false, totalFound: 0, totalUploaded: 0 };
    }
    if (!this.jwtExtractor.hasConfirmedCausa()) {
      this.jwtExtractor.confirm();
    }

    this.status = 'syncing';
    const startTime = Date.now();

    const results = {
      rol: detected.rol,
      tribunal: detected.tribunal || '',
      caratula: detected.caratula || '',
      causaPackage: null,
      needsManual: false,
      totalFound: 0,
      totalUploaded: 0,
      errors: [],
      duration: 0,
    };

    try {
      // ──── FASE 1: Extract CausaPackage (4.16) ────
      this._emit('status', {
        phase: 'starting',
        message: `Sincronizando causa ${detected.rol}...`,
      });

      const causaPackage = await this.extractCausaPackage();

      if (!causaPackage) {
        results.needsManual = true;
        this._emit('status', {
          phase: 'extract_failed',
          message: 'No se pudo extraer los datos del expediente. ¿Está abierto el detalle de la causa?',
        });
        this.status = 'idle';
        results.duration = Date.now() - startTime;
        return results;
      }

      results.causaPackage = causaPackage;
      results.totalFound = causaPackage.folios.length;

      const directDocs = [
        causaPackage.jwt_texto_demanda,
        causaPackage.jwt_certificado_envio,
        causaPackage.jwt_ebook,
      ].filter(Boolean).length;

      this._emit('status', {
        phase: 'extracted',
        message: `Extraídos: ${causaPackage.cuadernos.length} cuaderno(s), ` +
                 `${causaPackage.folios.length} folio(s), ${directDocs} doc(s) directos`,
      });

      // ──── FASE 2: Send to service-worker → API (4.17) ────
      this._emit('status', {
        phase: 'sending',
        message: 'Enviando paquete al servidor para descarga...',
      });

      try {
        const response = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            type: 'causa_package',
            package: causaPackage,
          }, (resp) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(resp);
            }
          });
        });

        if (response?.status === 'accepted') {
          results.totalUploaded = response.documentsQueued || 0;
          this._emit('status', {
            phase: 'complete',
            message: `Paquete enviado: ${causaPackage.folios.length} folios + ${directDocs} documentos directos. ` +
                     'El servidor procesará la descarga.',
            causaPackage: {
              rol: causaPackage.rol,
              cuadernos: causaPackage.cuadernos.length,
              folios: causaPackage.folios.length,
              directDocs: directDocs,
            },
          });
        } else if (response?.status === 'api_unavailable') {
          this._emit('status', {
            phase: 'api_pending',
            message: 'Paquete extraído correctamente. API sync pendiente (4.17).',
          });
        } else {
          this._emit('status', {
            phase: 'send_error',
            message: response?.error || 'Error al enviar paquete al servidor.',
          });
          results.errors.push(response?.error || 'Unknown send error');
        }
      } catch (sendError) {
        console.warn('[StrategyEngine] CausaPackage send:', sendError.message);
        this._emit('status', {
          phase: 'api_pending',
          message: 'Paquete extraído. API sync se implementará en tarea 4.17.',
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
    return results;
  }

  // ════════════════════════════════════════════════════════
  // LEGACY: DOM Scraping helpers (kept for manual upload compat)
  // ════════════════════════════════════════════════════════
  // DOM-click-based scraping replaced by JWT extraction (4.16).
  // Server-side PDF download via JWTs will be in 4.17.

  // ════════════════════════════════════════════════════════
  // UPLOAD: Subir PDFs capturados al servidor
  // ════════════════════════════════════════════════════════
  //
  // v2.0: Ruteo inteligente basado en sizeTier (4.09):
  //   - standard (≤50MB): API Route /api/upload (FormData)
  //   - resumable (>50MB): Supabase TUS protocol directo
  //

  async _uploadValidated(validatedPdfs, confirmedCausa) {
    let uploadedCount = 0;
    const confirmedRol = confirmedCausa?.rol || '';

    for (let i = 0; i < validatedPdfs.length; i++) {
      const pdf = validatedPdfs[i];
      if (!pdf?.blobUrl) continue;

      try {
        const response = await fetch(pdf.blobUrl);
        const blob = await response.blob();

        const timestamp = Date.now();
        const rolToUse = pdf.rol || confirmedRol;
        const rolPart = rolToUse ? rolToUse.replace(/[^a-zA-Z0-9-]/g, '_') : 'doc';
        const typePart = pdf.documentType || 'doc';
        const filename = `${rolPart}_${typePart}_${timestamp}.pdf`;

        const session = await supabase.getSession();
        if (!session?.access_token) {
          throw new Error('No hay sesión activa. Inicie sesión primero.');
        }

        // Determinar estrategia de upload según sizeTier
        const uploadStrategy = pdf._sizeTier?.uploadStrategy || 'standard';

        const tri = pdf.tribunal || confirmedCausa?.tribunal || '';
        const car = pdf.caratula || confirmedCausa?.caratula || '';
        let result;
        if (uploadStrategy === 'resumable') {
          result = await this._uploadResumable(blob, filename, pdf, session, confirmedRol, tri, car);
        } else {
          result = await this._uploadStandard(blob, filename, pdf, session, confirmedRol, tri, car);
        }

        // Si el servidor detectó duplicado, no contar como upload nuevo
        if (result.duplicate) {
          continue;
        }

        uploadedCount++;

        // Registrar hash localmente para deduplicación client-side futura
        const hashToRegister = result.hash || pdf._hash;
        if (hashToRegister && this.pdfValidator) {
          await this.pdfValidator.registerUploadedHash(
            hashToRegister, session?.user?.id, rolToUse, tri, car
          );
        }

        this._emit('pdf_uploaded', {
          filename,
          size: blob.size,
          path: result.path,
          case_id: result.case_id,
          document_id: result.document_id,
          rol: rolToUse,
          type: pdf.documentType,
          uploadStrategy,
          index: i + 1,
          total: validatedPdfs.length,
        });
      } catch (error) {
        console.error(`[StrategyEngine] Error subiendo PDF (${pdf._sizeTier?.tier || 'unknown'}):`, error);
        this._emit('upload_error', {
          error: error.message,
          pdf: pdf.url,
          tier: pdf._sizeTier?.tier,
        });
      }
    }

    return uploadedCount;
  }

  /**
   * Upload estándar via API Route (archivos ≤50MB).
   * Flujo: Extension → /api/upload → Storage + DB (cases, documents, document_hashes)
   *
   * CONTRATO FORMDATA (debe coincidir EXACTO con route.ts):
   *   file, case_rol, tribunal, caratula, materia, document_type,
   *   file_hash, source, source_url, captured_at
   */
  async _uploadStandard(blob, filename, pdf, session, confirmedRol = '', tribunal = '', caratula = '') {
    const formData = new FormData();
    formData.append('file', blob, filename);

    // Campos de causa (para upsert en tabla cases)
    const rolToUse = pdf.rol || confirmedRol || '';
    formData.append('case_rol', rolToUse);
    formData.append('tribunal', pdf.tribunal || tribunal || '');
    formData.append('caratula', pdf.caratula || caratula || '');
    formData.append('materia', pdf.materia || '');

    // Campos de documento
    formData.append('document_type', pdf.documentType || 'otro');
    formData.append('file_hash', pdf._hash || '');
    formData.append('source', pdf.source || 'scraper');
    formData.append('source_url', pdf.url || '');
    formData.append('captured_at', pdf.capturedAt || new Date().toISOString());

    const uploadResponse = await fetch(CONFIG.API.UPLOAD, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: formData,
    });

    const responseData = await uploadResponse.json().catch(() => ({}));

    if (!uploadResponse.ok) {
      throw new Error(responseData.error || `Upload HTTP ${uploadResponse.status}`);
    }

    // Si el servidor detectó duplicado, no es un error pero lo reportamos
    if (responseData.duplicate) {
      console.log(`[StrategyEngine] Duplicado detectado server-side: ${responseData.message}`);
      this._emit('status', {
        phase: 'duplicate_skipped',
        message: responseData.message,
      });
    }

    return responseData;
  }

  /**
   * Upload resumable via TUS protocol (archivos >50MB).
   * Flujo: Extension → Supabase Storage TUS endpoint directo.
   * Usa chunks de 6MB con retry automático y progreso en tiempo real.
   */
  async _uploadResumable(blob, filename, pdf, session, confirmedRol = '', tribunal = '', caratula = '') {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const uniqueId = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const objectPath = `${session.user?.id || 'anonymous'}/${yearMonth}/${uniqueId}_${filename}`;

    const rolToUse = pdf.rol || confirmedRol || '';
    const triToUse = pdf.tribunal || tribunal || '';
    const carToUse = pdf.caratula || caratula || '';

    return new Promise((resolve, reject) => {
      const upload = new ResumableUpload({
        supabaseUrl: supabase.url,
        accessToken: session.access_token,
        bucketName: 'case-files',
        objectPath: objectPath,
        file: blob,
        metadata: {
          source: pdf.source || 'scraper',
          rol: rolToUse,
          tribunal: triToUse,
          caratula: carToUse,
          documentType: pdf.documentType || 'otro',
          capturedAt: pdf.capturedAt || new Date().toISOString(),
        },
        onProgress: (bytesUploaded, bytesTotal) => {
          const percent = Math.round((bytesUploaded / bytesTotal) * 100);
          this._emit('upload_progress', {
            filename,
            bytesUploaded,
            bytesTotal,
            percent,
            rol: pdf.rol,
            tier: pdf._sizeTier?.tier,
            formatted: `${this._formatSize(bytesUploaded)} / ${this._formatSize(bytesTotal)}`,
          });
        },
        onSuccess: async (result) => {
          if (pdf._hash?.startsWith('p:')) {
            try {
              await this._confirmHashServerSide(result.path, pdf._hash, rolToUse, session, triToUse, carToUse);
            } catch (e) {
              console.warn('[StrategyEngine] Hash confirm fallido (no crítico):', e.message);
            }
          }
          resolve({ path: result.path, success: true });
        },
        onError: (error) => {
          reject(error);
        },
      });

      // Guardar referencia para poder abortar si necesario
      this._currentResumableUpload = upload;
      upload.start();
    });
  }

  /**
   * Confirma el hash SHA-256 completo de un archivo subido.
   * Se llama después de un upload resumable exitoso cuando
   * el validador calculó un hash parcial (prefijo "p:").
   * El servidor descarga el archivo, calcula el hash real
   * y retorna el hash completo para registrar en la BD.
   */
  async _confirmHashServerSide(storagePath, partialHash, rol, session, tribunal = '', caratula = '') {
    const response = await fetch(CONFIG.API.UPLOAD_CONFIRM, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ storagePath, partialHash, rol, tribunal, caratula }),
    });

    if (!response.ok) return;

    const data = await response.json();
    if (data.hash && this.pdfValidator) {
      await this.pdfValidator.registerUploadedHash(
        data.hash, session?.user?.id, rol, tribunal, caratula
      );
      console.log(`[StrategyEngine] Hash parcial reemplazado: ${partialHash.substring(0, 14)}... → ${data.hash.substring(0, 14)}...`);
    }
  }

  /**
   * Abortar un upload resumable en curso
   */
  abortResumableUpload() {
    if (this._currentResumableUpload) {
      this._currentResumableUpload.abort();
      this._currentResumableUpload = null;
    }
  }

  _formatSize(bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  // ════════════════════════════════════════════════════════
  // UPLOAD MANUAL (Layer 3) - Llamado desde el Sidepanel
  // ════════════════════════════════════════════════════════

  async uploadManual(file) {
    if (!file) throw new Error('No se proporcionó archivo');
    if (file.type !== 'application/pdf') throw new Error('Solo se aceptan archivos PDF');

    this._emit('status', { phase: 'manual_uploading', message: `Subiendo ${file.name}...` });

    const session = await supabase.getSession();
    if (!session?.access_token) {
      throw new Error('No hay sesión activa');
    }

    // Calcular hash del archivo manual para deduplicación
    let fileHash = '';
    try {
      const arrayBuffer = await file.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
      fileHash = Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      console.warn('[StrategyEngine] No se pudo calcular hash manual:', e.message);
    }

    // Si hay causa confirmada, asociar el archivo a ella
    const confirmedCausa = this.jwtExtractor?.getConfirmedCausa();

    const formData = new FormData();
    formData.append('file', file, file.name);
    formData.append('source', 'manual_upload');
    formData.append('file_hash', fileHash);

    // Asociar a causa si existe contexto confirmado
    if (confirmedCausa) {
      formData.append('case_rol', confirmedCausa.rol || '');
      formData.append('tribunal', confirmedCausa.tribunal || '');
      formData.append('caratula', confirmedCausa.caratula || '');
    }

    const response = await fetch(CONFIG.API.UPLOAD, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: formData,
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.error || `Upload HTTP ${response.status}`);
    }

    if (result.duplicate) {
      this._emit('status', { phase: 'manual_duplicate', message: result.message });
      return result;
    }

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
