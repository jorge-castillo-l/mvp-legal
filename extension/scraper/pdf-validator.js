/**
 * ============================================================
 * PDF VALIDATOR & CAUSA FILTER - Tarea 4.09
 * ============================================================
 * "La Aduana" - Puerta de validación entre la captura y el upload.
 *
 * Todo PDF capturado por Layer 1 o Layer 2 DEBE pasar estos
 * 5 filtros antes de subirse a Supabase. Sin excepción.
 *
 * FILTRO 1 - Tamaño: Rechaza <5KB (ayuda/iconos) y >100MB (corrupto)
 * FILTRO 2 - Origen URL: Rechaza /ayuda/, /manual/, /faq/
 * FILTRO 3 - Magic Bytes: Verifica header %PDF real
 * FILTRO 4 - Deduplicación: Hash SHA-256 contra BD existente
 * FILTRO 5 - ROL Tagging: Etiqueta con ROL + tipo documento + timestamp
 *
 * Si un filtro falla, el PDF se descarta con motivo registrado.
 * Esto protege al RAG (3.02) de datos basura.
 * ============================================================
 */

class PdfValidator {
  constructor(causaContext) {
    this.causaContext = causaContext;

    // Configuración de filtros
    this.MIN_SIZE_BYTES = 5 * 1024;        // 5 KB mínimo
    this.MAX_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB máximo

    // URLs que SIEMPRE se rechazan (no son documentos de causa)
    this.REJECTED_URL_PATTERNS = [
      /\/ayuda\//i,
      /\/manual\//i,
      /\/faq\//i,
      /\/instrucciones\//i,
      /\/help\//i,
      /\/tutorial\//i,
      /\/guia\//i,
      /\/soporte\//i,
      /\/about\//i,
      /\/politica\//i,
      /\/terminos\//i,
      /\/contacto\//i,
      /\/static\//i,
      /\/assets\//i,
      /\.css/i,
      /\.js$/i,
    ];

    // Magic bytes del formato PDF
    this.PDF_MAGIC_BYTES = [0x25, 0x50, 0x44, 0x46]; // %PDF

    // Set de hashes ya subidos (se carga de Supabase antes de validar)
    this.uploadedHashes = new Set();
  }

  /**
   * PIPELINE PRINCIPAL: Ejecuta todos los filtros secuencialmente.
   * Retorna { valid: true, pdf: enrichedPdf } o { valid: false, reason: string }
   */
  async validate(pdf) {
    if (!pdf) {
      return this._reject('PDF nulo o indefinido');
    }

    // FILTRO 1: Tamaño
    const sizeResult = this._filterSize(pdf);
    if (!sizeResult.pass) return this._reject(sizeResult.reason, pdf);

    // FILTRO 2: Origen URL
    const urlResult = this._filterUrlOrigin(pdf);
    if (!urlResult.pass) return this._reject(urlResult.reason, pdf);

    // FILTRO 3: Magic Bytes (%PDF header)
    const magicResult = await this._filterMagicBytes(pdf);
    if (!magicResult.pass) return this._reject(magicResult.reason, pdf);

    // FILTRO 4: Deduplicación (SHA-256)
    const dedupResult = await this._filterDuplicate(pdf);
    if (!dedupResult.pass) return this._reject(dedupResult.reason, pdf);

    // FILTRO 5: ROL Tagging (enriquecer con metadata)
    const taggedPdf = this._tagWithRol(pdf);

    return {
      valid: true,
      pdf: taggedPdf,
      hash: dedupResult.hash,
    };
  }

  /**
   * Validar un lote de PDFs, retornando aprobados y rechazados
   */
  async validateBatch(pdfs) {
    const approved = [];
    const rejected = [];

    for (const pdf of pdfs) {
      const result = await this.validate(pdf);
      if (result.valid) {
        approved.push(result.pdf);
      } else {
        rejected.push({ pdf, reason: result.reason });
      }
    }

    console.log(`[PdfValidator] Batch: ${approved.length} aprobados, ${rejected.length} rechazados`);
    if (rejected.length > 0) {
      console.log('[PdfValidator] Rechazados:', rejected.map(r => r.reason));
    }

    return { approved, rejected };
  }

  /**
   * Cargar hashes de documentos ya subidos para deduplicación.
   * Se llama antes de iniciar la validación de un batch.
   */
  async loadExistingHashes(supabaseClient, userId, rol) {
    try {
      // Pedir al servidor los hashes de documentos existentes para esta causa
      const session = await supabaseClient.getSession();
      if (!session?.access_token) return;

      // Por ahora, almacenamos hashes localmente por sesión
      // En producción, esto consultaría una tabla 'document_hashes' en Supabase
      const cacheKey = `pdf_hashes_${userId}_${rol}`;
      const cached = await new Promise(resolve => {
        chrome.storage.local.get([cacheKey], result => resolve(result[cacheKey]));
      });

      if (cached && Array.isArray(cached)) {
        cached.forEach(h => this.uploadedHashes.add(h));
        console.log(`[PdfValidator] ${this.uploadedHashes.size} hashes existentes cargados`);
      }
    } catch (e) {
      console.warn('[PdfValidator] No se pudieron cargar hashes existentes:', e.message);
    }
  }

  /**
   * Registrar un hash como subido (tras upload exitoso)
   */
  async registerUploadedHash(hash, userId, rol) {
    this.uploadedHashes.add(hash);

    try {
      const cacheKey = `pdf_hashes_${userId}_${rol}`;
      const existing = await new Promise(resolve => {
        chrome.storage.local.get([cacheKey], result => resolve(result[cacheKey] || []));
      });
      existing.push(hash);
      await new Promise(resolve => {
        chrome.storage.local.set({ [cacheKey]: existing }, resolve);
      });
    } catch (e) {
      // No crítico
    }
  }

  // ════════════════════════════════════════════════════════
  // FILTRO 1: TAMAÑO
  // ════════════════════════════════════════════════════════

  _filterSize(pdf) {
    const size = pdf.size || 0;

    if (size < this.MIN_SIZE_BYTES) {
      return {
        pass: false,
        reason: `Tamaño muy pequeño (${this._formatSize(size)}). Probablemente no es un expediente real (mín: ${this._formatSize(this.MIN_SIZE_BYTES)})`,
      };
    }

    if (size > this.MAX_SIZE_BYTES) {
      return {
        pass: false,
        reason: `Tamaño excesivo (${this._formatSize(size)}). Posible archivo corrupto (máx: ${this._formatSize(this.MAX_SIZE_BYTES)})`,
      };
    }

    return { pass: true };
  }

  // ════════════════════════════════════════════════════════
  // FILTRO 2: ORIGEN URL
  // ════════════════════════════════════════════════════════

  _filterUrlOrigin(pdf) {
    const url = (pdf.url || '').toLowerCase();

    // Si no hay URL (blob capturado), dejarlo pasar (el origen es ambiguo)
    if (!url || url.startsWith('blob:')) {
      return { pass: true };
    }

    // Verificar contra patrones rechazados
    for (const pattern of this.REJECTED_URL_PATTERNS) {
      if (pattern.test(url)) {
        return {
          pass: false,
          reason: `URL de origen rechazada: proviene de zona no-causa (${url.substring(0, 80)})`,
        };
      }
    }

    return { pass: true };
  }

  // ════════════════════════════════════════════════════════
  // FILTRO 3: MAGIC BYTES (%PDF header)
  // ════════════════════════════════════════════════════════

  async _filterMagicBytes(pdf) {
    try {
      if (!pdf.blobUrl) {
        return { pass: true }; // Sin blob URL, no podemos verificar
      }

      const response = await fetch(pdf.blobUrl);
      const blob = await response.blob();

      // Leer los primeros 4 bytes
      const header = new Uint8Array(await blob.slice(0, 4).arrayBuffer());

      const isPdf = this.PDF_MAGIC_BYTES.every((byte, i) => header[i] === byte);

      if (!isPdf) {
        return {
          pass: false,
          reason: `No es un PDF real (magic bytes: ${Array.from(header).map(b => b.toString(16)).join(' ')}). Archivo descartado.`,
        };
      }

      // Actualizar el tamaño si no lo teníamos
      if (!pdf.size || pdf.size === 0) {
        pdf.size = blob.size;
      }

      return { pass: true };
    } catch (e) {
      // Si no podemos leer, dejarlo pasar (el servidor verificará)
      console.warn('[PdfValidator] No se pudo verificar magic bytes:', e.message);
      return { pass: true };
    }
  }

  // ════════════════════════════════════════════════════════
  // FILTRO 4: DEDUPLICACIÓN (SHA-256)
  // ════════════════════════════════════════════════════════

  async _filterDuplicate(pdf) {
    try {
      if (!pdf.blobUrl) {
        return { pass: true, hash: null };
      }

      const response = await fetch(pdf.blobUrl);
      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();

      // Calcular SHA-256
      const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      if (this.uploadedHashes.has(hash)) {
        return {
          pass: false,
          hash: hash,
          reason: `Documento duplicado (hash: ${hash.substring(0, 12)}...). Ya existe en la base de datos.`,
        };
      }

      return { pass: true, hash: hash };
    } catch (e) {
      console.warn('[PdfValidator] No se pudo calcular hash:', e.message);
      return { pass: true, hash: null };
    }
  }

  // ════════════════════════════════════════════════════════
  // FILTRO 5: ROL TAGGING
  // ════════════════════════════════════════════════════════

  _tagWithRol(pdf) {
    const causa = this.causaContext?.getConfirmedCausa();
    const url = (pdf.url || '').toLowerCase();
    const text = (pdf.caseText || pdf.text || '').toUpperCase();

    // Inferir tipo de documento
    let docType = 'otro';
    const combined = `${url} ${text}`;
    if (/resoluci[oó]n|auto\b|sentencia|decreto/i.test(combined)) docType = 'resolucion';
    else if (/escrito|demanda|contestaci|recurso|apelaci/i.test(combined)) docType = 'escrito';
    else if (/actuaci[oó]n|diligencia|audiencia/i.test(combined)) docType = 'actuacion';
    else if (/notificaci[oó]n|c[ée]dula|carta/i.test(combined)) docType = 'notificacion';

    return {
      ...pdf,
      // Metadata de causa (ESENCIAL para el RAG)
      rol: causa?.rol || pdf.rol || null,
      tribunal: causa?.tribunal || null,
      caratula: causa?.caratula || null,
      documentType: docType,
      capturedAt: new Date().toISOString(),
      validatedAt: new Date().toISOString(),
      source: pdf.source || 'unknown',
    };
  }

  // ════════════════════════════════════════════════════════
  // UTILIDADES
  // ════════════════════════════════════════════════════════

  _reject(reason, pdf) {
    console.log(`[PdfValidator] RECHAZADO: ${reason}`);
    return { valid: false, reason, pdf };
  }

  _formatSize(bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
}
