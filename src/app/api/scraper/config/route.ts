/**
 * ============================================================
 * API ROUTE: /api/scraper/config
 * ============================================================
 * Sirve la configuración dinámica del scraper.
 * 
 * SOLUCIÓN AL "CICLO DE LA MUERTE":
 * Cuando PJud cambia su DOM, actualizamos este JSON y TODAS
 * las extensiones reciben los selectores nuevos en minutos.
 * Sin revisión de Chrome Store. Sin 4 días de downtime.
 * 
 * En producción, esta configuración se puede mover a una tabla
 * en Supabase para actualización via dashboard admin.
 * ============================================================
 */

import { NextRequest, NextResponse } from 'next/server'
import { getCorsHeaders, handleCorsOptions } from '@/lib/cors'

// Configuración del scraper - EN PRODUCCIÓN: mover a Supabase/DB
// Por ahora, se mantiene aquí para facilitar actualizaciones rápidas
const SCRAPER_CONFIG = {
  version: '1.0.0',
  updatedAt: new Date().toISOString(),

  // === SELECTORES CSS ===
  // Múltiples alternativas por elemento, orden = prioridad
  // ACTUALIZAR AQUÍ cuando PJud cambie su DOM
  selectors: {
    causaTable: [
      '#gridDatos',
      '.tabla-causas',
      'table.dataTable',
      '#tblDatos',
      'table.table-striped',
      'table[summary*="causa"]',
      'table',
    ],
    downloadLink: [
      'a[href*=".pdf"]',
      'a[onclick*="download"]',
      'a[onclick*="descarga"]',
      'a[onclick*="Descarga"]',
      'a[onclick*="verDocumento"]',
      'a[onclick*="abrirDocumento"]',
      '.btn-descarga',
      'a.descarga',
      'a[title*="Descargar"]',
      'a[title*="Ver documento"]',
      'button[onclick*="download"]',
    ],
    documentRow: [
      'tr.causa-row',
      'tr[data-id]',
      'tbody tr',
    ],
    rolField: [
      '#rolCausa',
      '#txtRol',
      '.rol-causa',
      'input[name="rol"]',
      'input[name*="Rol"]',
    ],
    searchButton: [
      '#btnBuscar',
      '#btnConsulta',
      '#btnBuscarCausa',
      'input[type="submit"]',
      'button[type="submit"]',
    ],
  },

  // === PATRONES DE URL PARA PDFs ===
  pdfUrlPatterns: [
    '\\.pdf',
    'download',
    'documento',
    'escrito',
    'resoluc',
    'getDocumento',
    'obtenerArchivo',
    'visorDocumento',
  ],

  pdfContentTypes: [
    'application/pdf',
    'application/octet-stream',
    'application/x-pdf',
  ],

  // === HEURÍSTICAS ===
  heuristics: {
    downloadKeywords: [
      'descargar', 'download', 'pdf', 'documento', 'escrito',
      'resolución', 'auto', 'sentencia', 'ver', 'abrir',
      'expediente', 'notificación', 'actuación',
    ],
    tableKeywords: [
      'ROL', 'Causa', 'Carátula', 'Tribunal', 'Fecha',
      'Tipo', 'Estado', 'Documento', 'Cuaderno', 'Folio',
    ],
    iconSelectors: [
      '.fa-download',
      '.fa-file-pdf',
      '.fa-file-pdf-o',
      '[class*="download"]',
      '[class*="pdf"]',
      'img[src*="pdf"]',
      'img[src*="download"]',
      'img[alt*="descargar"]',
    ],
    minConfidenceThreshold: 0.35,
  },

  // === THROTTLE ANTI-WAF ===
  throttle: {
    minDelayMs: 2500,
    maxDelayMs: 7000,
    maxConcurrent: 1,
    burstLimit: 5,
    burstWindowMs: 60000,
    sessionCooldownMs: 3000,
  },
}

export async function GET(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request, {
    methods: 'GET, OPTIONS',
    credentials: false,
  })

  return NextResponse.json(SCRAPER_CONFIG, {
    status: 200,
    headers: {
      ...corsHeaders,
      // Cache en el navegador por 30 minutos, revalidar después
      'Cache-Control': 'public, max-age=1800, stale-while-revalidate=3600',
    },
  })
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsOptions(request)
}
