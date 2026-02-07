/**
 * ============================================================
 * PDF VALIDATOR & CAUSA FILTER - Tarea 4.09 (v2.0)
 * ============================================================
 * "La Aduana" - Puerta de validación entre la captura y el upload.
 *
 * Todo PDF capturado por Layer 1 o Layer 2 DEBE pasar estos
 * filtros antes de subirse a Supabase. Sin excepción.
 *
 * ═══════════════════════════════════════════════════════════
 * v2.0 — REDISEÑO ESTRATÉGICO (Feb 2026)
 * ═══════════════════════════════════════════════════════════
 * ELIMINADO: Bloqueo duro de 100MB. Los abogados manejan
 * "Tomos" de pruebas de 300MB, 500MB o más. Rechazarlos
 * es inaceptable para un producto legal profesional.
 *
 * NUEVO: Sistema de Tiers inteligente basado en investigación
 * del estado del arte (Feb 2026):
 *
 * INVESTIGACIÓN BASE:
 * - Gemini 3 Flash: 1M tokens, $0.50/$3.00 per M tokens
 * - Gemini 3 Pro: 1M tokens, $2.00/$12.00 per M tokens
 * - Gemini PDF API limit: 50MB / 1,000 páginas por request
 * - Supabase TUS resumable uploads: hasta 50GB por archivo
 * - Context Caching: 90% reducción en tokens cacheados
 *
 * CONCLUSIÓN: El cuello de botella NO es el storage (Supabase
 * maneja 50GB). Es el procesamiento: Gemini no acepta PDFs
 * >50MB directo. Todo archivo grande necesita extracción de
 * texto server-side (Edge Function 4.02) + chunking para RAG.
 *
 * FILTROS:
 * FILTRO 1 - Tamaño: Rechaza <5KB (no es PDF real). Sin cap superior.
 *            Clasifica en tiers: standard | large | tomo | mega
 * FILTRO 2 - Origen URL: Rechaza /ayuda/, /manual/, /faq/
 * FILTRO 3 - Magic Bytes: Verifica header %PDF real
 * FILTRO 4 - Deduplicación: Hash SHA-256 contra BD existente
 * FILTRO 5 - ROL Tagging: Etiqueta con ROL + tipo documento + timestamp
 *
 * Si un filtro falla, el PDF se descarta con motivo registrado.
 * Esto protege al RAG (3.02) de datos basura.
 * ============================================================
 */

// ════════════════════════════════════════════════════════
// CONSTANTES DE TIER
// ════════════════════════════════════════════════════════

/**
 * Tiers de tamaño y su estrategia asociada.
 *
 * Cada tier define:
 * - label: Nombre legible del tier
 * - uploadStrategy: 'standard' (API Route 4.03) | 'resumable' (TUS protocol)
 * - processingStrategy: 'direct' (Gemini File API) | 'chunked' (Edge Fn 4.02 → RAG)
 * - geminiDirect: Si Gemini puede procesar el PDF directo (≤50MB, ≤1000 páginas)
 * - uiWarning: null | 'progress' | 'time_estimate' | 'confirmation_required'
 * - estimatedUploadChunkSize: Tamaño de chunk para TUS uploads (bytes)
 */
const SIZE_TIERS = {
  standard: {
    label: 'Estándar',
    maxBytes: 50 * 1024 * 1024,  // 50 MB
    uploadStrategy: 'standard',
    processingStrategy: 'direct',
    geminiDirect: true,
    uiWarning: null,
    estimatedUploadChunkSize: null,  // Upload de una sola vez
  },
  large: {
    label: 'Archivo Grande',
    maxBytes: 500 * 1024 * 1024,  // 500 MB
    uploadStrategy: 'resumable',
    processingStrategy: 'chunked',
    geminiDirect: false,
    uiWarning: 'progress',
    estimatedUploadChunkSize: 6 * 1024 * 1024,  // 6 MB (TUS default)
  },
  tomo: {
    label: 'Tomo',
    maxBytes: 5 * 1024 * 1024 * 1024,  // 5 GB
    uploadStrategy: 'resumable',
    processingStrategy: 'chunked',
    geminiDirect: false,
    uiWarning: 'time_estimate',
    estimatedUploadChunkSize: 6 * 1024 * 1024,
  },
  mega: {
    label: 'Archivo Excepcional',
    maxBytes: Infinity,
    uploadStrategy: 'resumable',
    processingStrategy: 'chunked',
    geminiDirect: false,
    uiWarning: 'confirmation_required',
    estimatedUploadChunkSize: 6 * 1024 * 1024,
  },
};

class PdfValidator {
  constructor(causaContext) {
    this.causaContext = causaContext;

    // ════════════════════════════════════════════════
    // Configuración de filtros
    // ════════════════════════════════════════════════

    // Tamaño mínimo: por debajo de esto no es un PDF real
    this.MIN_SIZE_BYTES = 5 * 1024;  // 5 KB

    // v2.0: SIN LÍMITE SUPERIOR DURO.
    // El sistema de tiers maneja archivos de cualquier tamaño.
    // El soft limit de advertencia fuerte es 5GB (tier 'mega').

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

  // ════════════════════════════════════════════════════════
  // PIPELINE PRINCIPAL
  // ════════════════════════════════════════════════════════

  /**
   * PIPELINE PRINCIPAL: Ejecuta todos los filtros secuencialmente.
   *
   * Retorna:
   *   { valid: true, pdf: enrichedPdf, hash: string, sizeTier: object }
   *   o
   *   { valid: false, reason: string }
   *
   * El campo `sizeTier` contiene la estrategia de upload/procesamiento
   * que el Sync UI (4.11) debe usar para este archivo.
   */
  async validate(pdf) {
    if (!pdf) {
      return this._reject('PDF nulo o indefinido');
    }

    // FILTRO 1: Tamaño mínimo + Clasificación por Tier
    const sizeResult = this._filterSize(pdf);
    if (!sizeResult.pass) return this._reject(sizeResult.reason, pdf);

    // FILTRO 2: Origen URL
    const urlResult = this._filterUrlOrigin(pdf);
    if (!urlResult.pass) return this._reject(urlResult.reason, pdf);

    // FILTRO 3: Magic Bytes (%PDF header)
    const magicResult = await this._filterMagicBytes(pdf);
    if (!magicResult.pass) return this._reject(magicResult.reason, pdf);

    // FILTRO 4: Deduplicación (SHA-256)
    // Para archivos >50MB, usamos hash parcial (primeros + últimos 1MB)
    // para no bloquear el navegador cargando 500MB en memoria
    const dedupResult = await this._filterDuplicate(pdf);
    if (!dedupResult.pass) return this._reject(dedupResult.reason, pdf);

    // FILTRO 5: ROL Tagging (enriquecer con metadata)
    const taggedPdf = this._tagWithRol(pdf);

    // Adjuntar información del tier al resultado
    const sizeTier = this._classifySizeTier(pdf.size || 0);

    return {
      valid: true,
      pdf: taggedPdf,
      hash: dedupResult.hash,
      sizeTier: sizeTier,
    };
  }

  /**
   * Validar un lote de PDFs, retornando aprobados y rechazados.
   * Los aprobados incluyen su sizeTier para que el Sync UI
   * agrupe los uploads por estrategia (standard vs resumable).
   */
  async validateBatch(pdfs) {
    const approved = [];
    const rejected = [];

    for (const pdf of pdfs) {
      const result = await this.validate(pdf);
      if (result.valid) {
        approved.push({
          ...result.pdf,
          _sizeTier: result.sizeTier,
          _hash: result.hash,
        });
      } else {
        rejected.push({ pdf, reason: result.reason });
      }
    }

    // Agrupar por estrategia de upload para el Sync UI
    const standardUploads = approved.filter(p => p._sizeTier.uploadStrategy === 'standard');
    const resumableUploads = approved.filter(p => p._sizeTier.uploadStrategy === 'resumable');

    console.log(
      `[PdfValidator] Batch: ${approved.length} aprobados ` +
      `(${standardUploads.length} standard, ${resumableUploads.length} resumable), ` +
      `${rejected.length} rechazados`
    );

    if (rejected.length > 0) {
      console.log('[PdfValidator] Rechazados:', rejected.map(r => r.reason));
    }

    // Resumen para la UI
    const batchSummary = this._buildBatchSummary(approved, rejected);

    return { approved, rejected, standardUploads, resumableUploads, batchSummary };
  }

  /**
   * Cargar hashes de documentos ya subidos para deduplicación.
   * Se llama antes de iniciar la validación de un batch.
   */
  async loadExistingHashes(supabaseClient, userId, rol) {
    try {
      const session = await supabaseClient.getSession();
      if (!session?.access_token) return;

      // En producción, consulta tabla 'document_hashes' en Supabase (4.12)
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
  // FILTRO 1: TAMAÑO + CLASIFICACIÓN POR TIER
  // ════════════════════════════════════════════════════════

  /**
   * v2.0: Ya NO rechaza archivos grandes.
   * Solo rechaza archivos demasiado pequeños (<5KB).
   * Clasifica el archivo en un tier que determina la estrategia
   * de upload y procesamiento.
   */
  _filterSize(pdf) {
    const size = pdf.size || 0;

    // Rechazo duro: archivos demasiado pequeños NO son expedientes reales
    if (size < this.MIN_SIZE_BYTES) {
      return {
        pass: false,
        reason: `Tamaño muy pequeño (${this._formatSize(size)}). ` +
          `Probablemente no es un expediente real (mín: ${this._formatSize(this.MIN_SIZE_BYTES)})`,
      };
    }

    // v2.0: Todo lo demás PASA. La clasificación por tier se hace aparte.
    return { pass: true };
  }

  /**
   * Clasifica un archivo en su tier de tamaño.
   * Retorna un objeto con toda la metadata de estrategia necesaria.
   */
  _classifySizeTier(sizeBytes) {
    let tierKey;

    if (sizeBytes <= SIZE_TIERS.standard.maxBytes) {
      tierKey = 'standard';
    } else if (sizeBytes <= SIZE_TIERS.large.maxBytes) {
      tierKey = 'large';
    } else if (sizeBytes <= SIZE_TIERS.tomo.maxBytes) {
      tierKey = 'tomo';
    } else {
      tierKey = 'mega';
    }

    const tier = SIZE_TIERS[tierKey];
    const estimates = this._estimateProcessing(sizeBytes, tierKey);

    return {
      tier: tierKey,
      ...tier,
      sizeBytes,
      sizeFormatted: this._formatSize(sizeBytes),
      ...estimates,
    };
  }

  /**
   * Estima tiempos de upload y costos de procesamiento.
   * Estas estimaciones se muestran al abogado en el Sync UI (4.11)
   * para que tome una decisión informada.
   *
   * Cálculos basados en investigación Feb 2026:
   * - Upload speed estimada: ~2 MB/s (conexión promedio Chile)
   * - Texto extraíble: ~20% del tamaño del PDF (PDFs escaneados)
   * - 1MB texto ≈ 250,000 tokens
   * - Gemini 3 Flash: $0.50/1M tokens input
   * - Context Caching: 90% reducción en queries posteriores
   */
  _estimateProcessing(sizeBytes, tierKey) {
    const sizeMB = sizeBytes / (1024 * 1024);

    // Estimación de tiempo de upload (2 MB/s promedio Chile)
    const uploadSpeedMBps = 2;
    const estimatedUploadSeconds = Math.ceil(sizeMB / uploadSpeedMBps);

    // Estimación de texto extraíble (~20% del tamaño para PDFs legales escaneados)
    const estimatedTextMB = sizeMB * 0.20;
    const estimatedTokens = Math.ceil(estimatedTextMB * 250_000);

    // Estimación de costo de procesamiento inicial (embedding + primera lectura)
    // Gemini 3 Flash: $0.50 / 1M tokens input
    const estimatedProcessingCostUSD = (estimatedTokens / 1_000_000) * 0.50;

    // Queries posteriores con Context Caching: 90% más baratas
    const estimatedCachedQueryCostUSD = (estimatedTokens / 1_000_000) * 0.05;

    // Tiempo de procesamiento server-side (Edge Function: ~1 page/sec para OCR)
    const estimatedPages = Math.ceil(sizeMB / 0.5); // ~0.5MB por página escaneada
    const estimatedProcessingSeconds = estimatedPages * 1; // ~1 seg/página

    return {
      estimatedUploadSeconds,
      estimatedUploadFormatted: this._formatDuration(estimatedUploadSeconds),
      estimatedTokens,
      estimatedTokensFormatted: this._formatTokens(estimatedTokens),
      estimatedProcessingCostUSD: Math.round(estimatedProcessingCostUSD * 100) / 100,
      estimatedCachedQueryCostUSD: Math.round(estimatedCachedQueryCostUSD * 1000) / 1000,
      estimatedProcessingSeconds,
      estimatedProcessingFormatted: this._formatDuration(estimatedProcessingSeconds),
      estimatedPages,
      // Mensaje para el UI según el tier
      uiMessage: this._buildTierUIMessage(tierKey, sizeMB, estimatedUploadSeconds, estimatedProcessingSeconds),
    };
  }

  /**
   * Genera el mensaje que el Sync UI (4.11) debe mostrar al abogado
   * según el tier del archivo.
   */
  _buildTierUIMessage(tierKey, sizeMB, uploadSecs, processingSecs) {
    switch (tierKey) {
      case 'standard':
        return null; // Sin mensaje especial

      case 'large':
        return {
          type: 'info',
          title: 'Archivo grande detectado',
          message: `Este documento (${sizeMB.toFixed(0)} MB) se subirá con upload resumible. ` +
            `Tiempo estimado: ~${this._formatDuration(uploadSecs)}. ` +
            `Puedes seguir trabajando mientras se sube.`,
          icon: 'upload-cloud',
          dismissable: true,
          blocking: false,
        };

      case 'tomo':
        return {
          type: 'warning',
          title: 'Tomo de pruebas detectado',
          message: `Este es un archivo de ${sizeMB.toFixed(0)} MB. ` +
            `Upload estimado: ~${this._formatDuration(uploadSecs)}. ` +
            `Procesamiento IA: ~${this._formatDuration(processingSecs)}. ` +
            `La subida es resumible: si se interrumpe, continuará donde quedó.`,
          icon: 'file-warning',
          dismissable: false,
          blocking: false,
        };

      case 'mega':
        return {
          type: 'confirm',
          title: 'Archivo excepcionalmente grande',
          message: `Este archivo pesa ${sizeMB.toFixed(0)} MB (${(sizeMB / 1024).toFixed(1)} GB). ` +
            `Upload estimado: ~${this._formatDuration(uploadSecs)}. ` +
            `El procesamiento puede tomar varias horas. ` +
            `¿Deseas continuar?`,
          icon: 'alert-triangle',
          dismissable: false,
          blocking: true,  // Requiere confirmación explícita del abogado
          confirmLabel: 'Sí, subir archivo',
          cancelLabel: 'Cancelar',
        };

      default:
        return null;
    }
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

  /**
   * v2.0: Para archivos >50MB, usa hash parcial (primeros 1MB +
   * últimos 1MB + tamaño del archivo) para evitar cargar el archivo
   * completo en memoria del navegador. Un tomo de 500MB no puede
   * pasarse completo por crypto.subtle.digest() sin crashear el tab.
   *
   * El hash server-side completo se calcula en la Edge Function (4.02)
   * tras la subida, como segunda línea de deduplicación definitiva.
   */
  async _filterDuplicate(pdf) {
    try {
      if (!pdf.blobUrl) {
        return { pass: true, hash: null };
      }

      const response = await fetch(pdf.blobUrl);
      const blob = await response.blob();
      const fileSize = blob.size;

      let hash;

      if (fileSize <= 50 * 1024 * 1024) {
        // ≤ 50MB: Hash completo (comportamiento original)
        const arrayBuffer = await blob.arrayBuffer();
        hash = await this._computeHash(arrayBuffer);
      } else {
        // > 50MB: Hash parcial (primeros 1MB + últimos 1MB + tamaño)
        // Esto evita OOM en el navegador con archivos de 500MB+
        hash = await this._computePartialHash(blob, fileSize);
      }

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

  /**
   * Hash SHA-256 completo para archivos ≤50MB
   */
  async _computeHash(arrayBuffer) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Hash parcial para archivos >50MB.
   * Combina: primeros 1MB + últimos 1MB + tamaño del archivo.
   * Rápido, memory-safe, y estadísticamente único.
   *
   * El hash completo definitivo se calcula server-side en la
   * Edge Function (4.02) tras la subida.
   */
  async _computePartialHash(blob, fileSize) {
    const CHUNK_SIZE = 1 * 1024 * 1024; // 1 MB

    // Leer primer 1MB
    const headSlice = blob.slice(0, CHUNK_SIZE);
    const headBuffer = await headSlice.arrayBuffer();

    // Leer último 1MB
    const tailStart = Math.max(0, fileSize - CHUNK_SIZE);
    const tailSlice = blob.slice(tailStart, fileSize);
    const tailBuffer = await tailSlice.arrayBuffer();

    // Combinar: head + tail + size como string
    const sizeBytes = new TextEncoder().encode(fileSize.toString());
    const combined = new Uint8Array(
      headBuffer.byteLength + tailBuffer.byteLength + sizeBytes.byteLength
    );
    combined.set(new Uint8Array(headBuffer), 0);
    combined.set(new Uint8Array(tailBuffer), headBuffer.byteLength);
    combined.set(sizeBytes, headBuffer.byteLength + tailBuffer.byteLength);

    const hashBuffer = await crypto.subtle.digest('SHA-256', combined.buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    // Prefix 'p:' indica que es un hash parcial (para diferenciar en la BD)
    return 'p:' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
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
    else if (/tomo|prueba|documental|anexo|acompaña/i.test(combined)) docType = 'tomo_pruebas';

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
  // RESUMEN DE BATCH PARA SYNC UI
  // ════════════════════════════════════════════════════════

  /**
   * Construye un resumen del batch para que el Sync UI (4.11)
   * muestre información clara al abogado antes de confirmar.
   */
  _buildBatchSummary(approved, rejected) {
    const totalSize = approved.reduce((acc, p) => acc + (p.size || 0), 0);

    // Contar por tier
    const tierCounts = { standard: 0, large: 0, tomo: 0, mega: 0 };
    for (const pdf of approved) {
      if (pdf._sizeTier?.tier) {
        tierCounts[pdf._sizeTier.tier]++;
      }
    }

    // Estimar tiempo total de upload
    const totalUploadSeconds = approved.reduce(
      (acc, p) => acc + (p._sizeTier?.estimatedUploadSeconds || 0), 0
    );

    // Archivos que necesitan confirmación especial
    const needsConfirmation = approved.filter(
      p => p._sizeTier?.uiWarning === 'confirmation_required'
    );

    // Archivos resumable (que necesitan TUS)
    const resumableCount = approved.filter(
      p => p._sizeTier?.uploadStrategy === 'resumable'
    ).length;

    return {
      totalApproved: approved.length,
      totalRejected: rejected.length,
      totalSize: totalSize,
      totalSizeFormatted: this._formatSize(totalSize),
      tierCounts,
      resumableCount,
      estimatedTotalUploadSeconds: totalUploadSeconds,
      estimatedTotalUploadFormatted: this._formatDuration(totalUploadSeconds),
      needsConfirmation: needsConfirmation.length > 0,
      confirmationFiles: needsConfirmation.map(p => ({
        name: p.url || p.filename || 'Documento sin nombre',
        size: this._formatSize(p.size || 0),
        message: p._sizeTier?.uiMessage,
      })),
      rejectedReasons: rejected.map(r => r.reason),
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
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  _formatDuration(totalSeconds) {
    if (totalSeconds < 60) return `${totalSeconds} segundos`;
    if (totalSeconds < 3600) {
      const mins = Math.floor(totalSeconds / 60);
      const secs = totalSeconds % 60;
      return secs > 0 ? `${mins} min ${secs} seg` : `${mins} min`;
    }
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
  }

  _formatTokens(tokens) {
    if (tokens < 1000) return `${tokens} tokens`;
    if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(0)}K tokens`;
    return `${(tokens / 1_000_000).toFixed(1)}M tokens`;
  }
}
