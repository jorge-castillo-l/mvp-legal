/**
 * ============================================================
 * CONFIG - Fuente Única de Verdad de la Extensión
 * ============================================================
 * REGLA: Cambiar de "local" a "producción" = cambiar ENV a 'production'
 * y completar las URLs de producción. Nada más.
 *
 * Este archivo se carga en TODOS los contextos de la extensión:
 *   - Content Scripts (via manifest.json content_scripts)
 *   - Sidepanel (via <script> en sidepanel.html)
 *   - Service Worker (via importScripts en service-worker.js)
 *
 * NO uses import/export (incompatible con Chrome MV3 content scripts).
 * La variable CONFIG queda global en cada contexto.
 * ============================================================
 */

const CONFIG = (() => {
  // ════════════════════════════════════════════════════════
  // CAMBIAR ESTA LÍNEA PARA PRODUCCIÓN
  // ════════════════════════════════════════════════════════
  const ENV = 'development'; // 'development' | 'production'

  // ════════════════════════════════════════════════════════
  // URLs por entorno
  // ════════════════════════════════════════════════════════
  const ENVIRONMENTS = {
    development: {
      DASHBOARD_URL: 'http://localhost:3000',
    },
    production: {
      // Completar antes de desplegar:
      DASHBOARD_URL: 'https://tu-dominio-de-produccion.com',
    },
  };

  const env = ENVIRONMENTS[ENV] || ENVIRONMENTS.development;

  // ════════════════════════════════════════════════════════
  // Supabase (mismo proyecto en todos los entornos)
  // ════════════════════════════════════════════════════════
  const SUPABASE_PROJECT_REF = 'jszpfokzybhpngmqdezd';
  const SUPABASE_URL = `https://${SUPABASE_PROJECT_REF}.supabase.co`;
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzenBmb2t6eWJocG5nbXFkZXpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk2Mzc2NjMsImV4cCI6MjA4NTIxMzY2M30.ngu3guXPmg0r7l6cZxNlLZM7W2dSpv1hjJMUmi3N2kA';

  // ════════════════════════════════════════════════════════
  // API Endpoints (derivados de DASHBOARD_URL)
  // ════════════════════════════════════════════════════════
  const API = {
    AUTH_SESSION:   `${env.DASHBOARD_URL}/api/auth/session`,
    UPLOAD:         `${env.DASHBOARD_URL}/api/upload`,
    UPLOAD_CONFIRM: `${env.DASHBOARD_URL}/api/upload/confirm-hash`,
    SCRAPER_CONFIG: `${env.DASHBOARD_URL}/api/scraper/config`,
    CASES:          `${env.DASHBOARD_URL}/api/cases`,
  };

  // ════════════════════════════════════════════════════════
  // Páginas del Dashboard
  // ════════════════════════════════════════════════════════
  const PAGES = {
    LOGIN: `${env.DASHBOARD_URL}/login`,
  };

  // ════════════════════════════════════════════════════════
  // Storage
  // ════════════════════════════════════════════════════════
  const STORAGE = {
    BUCKET_NAME: 'case-files',
  };

  // ════════════════════════════════════════════════════════
  // Objeto final (inmutable)
  // ════════════════════════════════════════════════════════
  return Object.freeze({
    ENV,
    IS_DEV: ENV === 'development',
    IS_PROD: ENV === 'production',
    DASHBOARD_URL: env.DASHBOARD_URL,
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    API,
    PAGES,
    STORAGE,
  });
})();
