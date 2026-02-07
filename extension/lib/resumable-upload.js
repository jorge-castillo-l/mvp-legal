/**
 * ============================================================
 * RESUMABLE UPLOAD CLIENT — TUS Protocol para Supabase Storage
 * ============================================================
 * Cliente liviano que implementa el protocolo TUS 1.0.0 contra
 * el endpoint resumable de Supabase Storage.
 * 
 * No requiere npm ni bundler: es vanilla JS compatible con
 * Chrome Extension Manifest V3.
 *
 * Supabase TUS endpoint:
 *   POST   /storage/v1/upload/resumable  (crear upload)
 *   PATCH  {uploadUrl}                   (subir chunks)
 *   HEAD   {uploadUrl}                   (verificar progreso)
 *
 * Refs:
 *   https://supabase.com/docs/guides/storage/uploads/resumable-uploads
 *   https://tus.io/protocols/resumable-upload
 * ============================================================
 */

const TUS_CHUNK_SIZE = 6 * 1024 * 1024; // 6 MB (Supabase default óptimo)
const TUS_RETRY_DELAYS = [0, 3000, 5000, 10000, 20000]; // Reintentos progresivos

class ResumableUpload {
  /**
   * @param {Object} options
   * @param {string} options.supabaseUrl — e.g. 'https://xxx.supabase.co'
   * @param {string} options.accessToken — JWT del usuario
   * @param {string} options.bucketName — e.g. 'case-files'
   * @param {string} options.objectPath — e.g. 'userId/2026-02/file.pdf'
   * @param {Blob}   options.file — El blob/file a subir
   * @param {Object} [options.metadata] — Metadata adicional (rol, tipo, etc.)
   * @param {Function} [options.onProgress] — Callback(bytesUploaded, bytesTotal)
   * @param {Function} [options.onSuccess] — Callback(result)
   * @param {Function} [options.onError] — Callback(error)
   */
  constructor(options) {
    this.supabaseUrl = options.supabaseUrl;
    this.accessToken = options.accessToken;
    this.bucketName = options.bucketName;
    this.objectPath = options.objectPath;
    this.file = options.file;
    this.metadata = options.metadata || {};
    this.onProgress = options.onProgress || (() => {});
    this.onSuccess = options.onSuccess || (() => {});
    this.onError = options.onError || (() => {});

    this.chunkSize = TUS_CHUNK_SIZE;
    this.uploadUrl = null;
    this.bytesUploaded = 0;
    this.aborted = false;
    this._retryCount = 0;
  }

  /**
   * Inicia (o reanuda) el upload.
   * Si se interrumpe, llamar start() de nuevo reanuda desde donde quedó.
   */
  async start() {
    this.aborted = false;

    try {
      // Paso 1: Crear el upload (obtener URL de upload)
      if (!this.uploadUrl) {
        await this._createUpload();
      } else {
        // Si ya teníamos URL, verificar cuánto se subió
        await this._resumeUpload();
      }

      // Paso 2: Subir chunks secuencialmente
      await this._uploadChunks();

      // Paso 3: Éxito
      this.onSuccess({
        path: this.objectPath,
        size: this.file.size,
        bytesUploaded: this.bytesUploaded,
      });
    } catch (error) {
      if (this.aborted) return;

      // Reintento automático
      if (this._retryCount < TUS_RETRY_DELAYS.length) {
        const delay = TUS_RETRY_DELAYS[this._retryCount];
        this._retryCount++;
        console.warn(`[ResumableUpload] Reintento ${this._retryCount} en ${delay}ms:`, error.message);
        await new Promise(r => setTimeout(r, delay));
        return this.start(); // Reanudar
      }

      this.onError(error);
    }
  }

  /**
   * Abortar el upload en curso.
   * El upload puede reanudarse después llamando start() de nuevo
   * (el servidor recuerda el progreso por 24h).
   */
  abort() {
    this.aborted = true;
  }

  // ════════════════════════════════════════════════════════
  // INTERNOS: Protocolo TUS
  // ════════════════════════════════════════════════════════

  /**
   * Paso 1: POST al endpoint TUS para crear el upload.
   * Retorna una Upload-URL única que se usa para los PATCH.
   */
  async _createUpload() {
    const endpoint = `${this.supabaseUrl}/storage/v1/upload/resumable`;

    // TUS requiere metadata en base64
    const tusMetadata = this._encodeTusMetadata({
      bucketName: this.bucketName,
      objectName: this.objectPath,
      contentType: 'application/pdf',
      cacheControl: '3600',
      // Metadata personalizada del PDF (ROL, tipo, etc.)
      ...this.metadata,
    });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'apikey': this.accessToken,
        'Tus-Resumable': '1.0.0',
        'Upload-Length': String(this.file.size),
        'Upload-Metadata': tusMetadata,
        'x-upsert': 'false',
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`TUS CREATE failed (${response.status}): ${text}`);
    }

    this.uploadUrl = response.headers.get('Location');
    if (!this.uploadUrl) {
      throw new Error('TUS CREATE: No se recibió Location header');
    }

    this.bytesUploaded = 0;
    console.log(`[ResumableUpload] Upload creado: ${this.objectPath} (${this._formatSize(this.file.size)})`);
  }

  /**
   * Verificar cuántos bytes ya se subieron (HEAD request).
   * Permite reanudar uploads interrumpidos.
   */
  async _resumeUpload() {
    try {
      const response = await fetch(this.uploadUrl, {
        method: 'HEAD',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Tus-Resumable': '1.0.0',
        },
      });

      if (response.ok) {
        const offset = parseInt(response.headers.get('Upload-Offset') || '0', 10);
        this.bytesUploaded = offset;
        console.log(`[ResumableUpload] Reanudando desde ${this._formatSize(offset)}`);
      }
    } catch (e) {
      // Si falla el HEAD, empezar de nuevo
      console.warn('[ResumableUpload] No se pudo verificar progreso, reiniciando');
      this.uploadUrl = null;
      await this._createUpload();
    }
  }

  /**
   * Subir el archivo en chunks de 6MB (PATCH requests).
   */
  async _uploadChunks() {
    while (this.bytesUploaded < this.file.size) {
      if (this.aborted) throw new Error('Upload abortado por el usuario');

      const chunkEnd = Math.min(this.bytesUploaded + this.chunkSize, this.file.size);
      const chunk = this.file.slice(this.bytesUploaded, chunkEnd);

      const response = await fetch(this.uploadUrl, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Tus-Resumable': '1.0.0',
          'Upload-Offset': String(this.bytesUploaded),
          'Content-Type': 'application/offset+octet-stream',
        },
        body: chunk,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`TUS PATCH failed (${response.status}): ${text}`);
      }

      const newOffset = parseInt(response.headers.get('Upload-Offset') || String(chunkEnd), 10);
      this.bytesUploaded = newOffset;
      this._retryCount = 0; // Reset reintentos tras chunk exitoso

      this.onProgress(this.bytesUploaded, this.file.size);
    }

    console.log(`[ResumableUpload] Upload completo: ${this.objectPath}`);
  }

  // ════════════════════════════════════════════════════════
  // UTILIDADES
  // ════════════════════════════════════════════════════════

  /**
   * Codifica metadata en formato TUS (key base64value, key base64value, ...)
   */
  _encodeTusMetadata(obj) {
    return Object.entries(obj)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([key, value]) => {
        const encoded = btoa(unescape(encodeURIComponent(String(value))));
        return `${key} ${encoded}`;
      })
      .join(',');
  }

  _formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }
}
