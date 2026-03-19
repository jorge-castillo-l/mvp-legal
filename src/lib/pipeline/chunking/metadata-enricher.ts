/**
 * ============================================================
 * Chunk Metadata Enricher + Embedding Input Builder — Tarea 7.07d
 * ============================================================
 * Enriquece chunks con metadata completa del documento padre,
 * la causa y el section-detector. Provee buildEmbeddingInput()
 * para generar el input contextualizado de text-embedding-004.
 *
 * Spec: docs/specs/7.07d-metadata-enricher.md
 * Consumidor: 7.08 (Embedding Generation Pipeline)
 *
 * CRÍTICO para:
 *   - Sistema de citas (3.09): foja + cuaderno + fecha en cada chunk
 *   - RAG accuracy: procedimiento + tipo doc como contexto de búsqueda
 *   - Anti-alucinación: solo metadata de alta confianza en embeddings
 * ============================================================
 */

import type { Chunk } from './token-chunker'

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

/** Metadata del documento padre (de processing_queue.metadata.doc_metadata) */
export interface DocumentParentMetadata {
  document_type?: string
  folio_numero?: number | null
  cuaderno?: string | null
  fecha_tramite?: string | null
  desc_tramite?: string | null
  foja?: number | null
  etapa?: string | null
  tramite?: string | null
}

/** Metadata de la causa (de tabla cases) */
export interface CaseMetadata {
  procedimiento?: string | null
  libro_tipo?: string | null
  tribunal?: string | null
  rol?: string | null
}

/** Chunk enriquecido con toda la metadata disponible */
export interface EnrichedChunkMetadata {
  // Capa 1: Documento padre
  document_type?: string
  folio_numero?: number | null
  cuaderno?: string | null
  fecha_tramite?: string | null
  desc_tramite?: string | null

  // Capa 2: Detección (ya presente en chunk.metadata del chunker)
  section_type: string
  section_label?: string
  section_confidence?: number
  section_ordinal?: number
  page_number: number | null

  // Capa 3: Causa
  procedimiento?: string | null
  libro_tipo?: string | null

  // Del normalizer (ya presente)
  foja?: number
  juzgado?: string
  rol?: string
  caratulado?: string

  // Operational
  overlap_with_previous: boolean
  document_token_estimate: number
}

export interface EnrichmentContext {
  parentMetadata?: DocumentParentMetadata
  caseMetadata?: CaseMetadata
}

// ─────────────────────────────────────────────────────────────
// Enrichment function
// ─────────────────────────────────────────────────────────────

/**
 * Enriquece un chunk con metadata completa de las 3 capas.
 * Combina lo que el chunker ya propagó (normalizer + section-detector)
 * con metadata del documento padre y de la causa.
 *
 * Retorna el JSONB que se guarda en document_chunks.metadata.
 */
export function enrichChunkMetadata(
  chunk: Chunk,
  context: EnrichmentContext
): EnrichedChunkMetadata {
  const { parentMetadata, caseMetadata } = context

  // Foja: preferir la del doc_metadata (más precisa, viene del folio específico),
  // fallback a la del normalizer (extraída del header NOMENCLATURA)
  const foja = parentMetadata?.foja ?? chunk.metadata.foja

  return {
    // Capa 1: Documento padre
    document_type: parentMetadata?.document_type,
    folio_numero: parentMetadata?.folio_numero,
    cuaderno: parentMetadata?.cuaderno,
    fecha_tramite: parentMetadata?.fecha_tramite,
    desc_tramite: parentMetadata?.desc_tramite,

    // Capa 2: Detección
    section_type: chunk.sectionType,
    section_label: chunk.metadata.sectionLabel,
    section_confidence: chunk.metadata.sectionConfidence,
    section_ordinal: chunk.metadata.sectionOrdinal,
    page_number: chunk.pageNumber,

    // Capa 3: Causa
    procedimiento: caseMetadata?.procedimiento,
    libro_tipo: caseMetadata?.libro_tipo,

    // Normalizer
    foja,
    juzgado: caseMetadata?.tribunal ?? chunk.metadata.juzgado,
    rol: caseMetadata?.rol ?? chunk.metadata.rol,
    caratulado: chunk.metadata.caratulado,

    // Operational
    overlap_with_previous: chunk.metadata.overlapWithPrevious,
    document_token_estimate: chunk.metadata.documentTokenEstimate,
  }
}

// ─────────────────────────────────────────────────────────────
// Embedding Input Builder
// ─────────────────────────────────────────────────────────────

const SECTION_CONFIDENCE_THRESHOLD = 0.70
const SECTION_DISPLAY_MAP: Record<string, string> = {
  // Sentencia (Art.170 CPC)
  vistos: 'Vistos',
  considerando: 'Considerando',
  considerando_n: 'Considerando',
  resolutivo: 'Resolutivo',
  cierre_sentencia: 'Cierre',
  // Escritos (Art.254 CPC)
  individualizacion: 'Individualización',
  en_lo_principal: 'Principal',
  hechos: 'Hechos',
  derecho: 'Derecho',
  petitorio: 'Petitorio',
  otrosi: 'Otrosí',
  // Receptor
  receptor_certificacion: 'Certificación',
  receptor_diligencia: 'Diligencia',
  receptor_cierre: 'Cierre',
  // Resoluciones
  resolucion_proveyendo: 'Proveyendo',
  resolucion_vistos: 'Vistos',
  resolucion_dispositivo: 'Dispositivo',
  notificacion_estado_diario: 'Estado diario',
  // Audiencia (Art.683 CPC)
  audiencia_inicio: 'Audiencia',
  audiencia_conciliacion: 'Conciliación',
  audiencia_prueba: 'Prueba',
  audiencia_cierre: 'Cierre audiencia',
  // Ejecutivo (Art.434 CPC)
  mandamiento: 'Mandamiento',
}

const DOC_TYPE_DISPLAY_MAP: Record<string, string> = {
  folio: 'Folio',
  directo: 'Documento',
  anexo_causa: 'Anexo causa',
  anexo_solicitud: 'Anexo solicitud',
}

const PROCEDIMIENTO_DISPLAY_MAP: Record<string, string> = {
  ordinario: 'Ordinario',
  ejecutivo: 'Ejecutivo',
  sumario: 'Sumario',
  monitorio: 'Monitorio',
  voluntario: 'Voluntario',
}

/**
 * Genera el string enriquecido para input de text-embedding-004.
 *
 * Formato: [prefijo contextual] + texto del chunk
 * Prefijo: [tipo_doc | sección | procedimiento | folio N | cuaderno X]
 *
 * Máximo ~25 tokens de prefijo (~125 chars) para no diluir el vector.
 * Solo incluye sección si confidence >= 0.70 (anti-alucinación).
 *
 * Este string NO se guarda en DB — se genera on-the-fly cuando
 * 7.08 necesita crear el embedding.
 *
 * @example
 * // Input: chunk de considerando 6 en sentencia sumaria
 * // Output: "[Folio | Considerando 6 | Sumario | Folio 31 | Principal] Que, en orden..."
 */
export function buildEmbeddingInput(
  chunk: Chunk,
  enrichedMetadata: EnrichedChunkMetadata
): string {
  const parts: string[] = []

  // 1. Tipo de documento
  const docType = enrichedMetadata.document_type
  if (docType) {
    parts.push(DOC_TYPE_DISPLAY_MAP[docType] ?? docType)
  }

  // 2. Descripción del trámite (más informativa que el tipo genérico)
  if (enrichedMetadata.desc_tramite) {
    parts.push(enrichedMetadata.desc_tramite)
  }

  // 3. Sección legal (solo si alta confianza)
  const sectionConf = enrichedMetadata.section_confidence ?? 0
  if (
    sectionConf >= SECTION_CONFIDENCE_THRESHOLD &&
    enrichedMetadata.section_type !== 'general'
  ) {
    const sectionName = SECTION_DISPLAY_MAP[enrichedMetadata.section_type] ?? enrichedMetadata.section_type
    const ordinal = enrichedMetadata.section_ordinal
    parts.push(ordinal ? `${sectionName} ${ordinal}` : sectionName)
  }

  // 4. Procedimiento
  if (enrichedMetadata.procedimiento) {
    parts.push(PROCEDIMIENTO_DISPLAY_MAP[enrichedMetadata.procedimiento] ?? enrichedMetadata.procedimiento)
  }

  // 5. Folio (el número más relevante para citas)
  const folio = enrichedMetadata.folio_numero ?? enrichedMetadata.foja
  if (folio) {
    parts.push(`Folio ${folio}`)
  }

  // 6. Cuaderno
  if (enrichedMetadata.cuaderno) {
    parts.push(enrichedMetadata.cuaderno)
  }

  if (parts.length === 0) {
    return chunk.chunkText
  }

  const prefix = `[${parts.join(' | ')}]`
  return `${prefix} ${chunk.chunkText}`
}

/**
 * Genera la cita formateada para display al usuario (sistema de citas 3.09).
 *
 * Formato: "Según [tipo] de fecha [DD/MM/YYYY], folio [N], cuaderno [X] (pág. N)..."
 *
 * @example
 * // "Resolución de fecha 12/03/2024, folio 31, cuaderno Principal (pág. 5)"
 */
export function buildCitationLabel(enrichedMetadata: EnrichedChunkMetadata): string {
  const parts: string[] = []

  // Tipo de documento o descripción del trámite
  const docDesc = enrichedMetadata.desc_tramite ?? enrichedMetadata.document_type ?? 'Documento'
  parts.push(docDesc)

  // Fecha
  if (enrichedMetadata.fecha_tramite) {
    const fecha = formatDateForCitation(enrichedMetadata.fecha_tramite)
    if (fecha) parts.push(`de fecha ${fecha}`)
  }

  // Folio
  const folio = enrichedMetadata.folio_numero ?? enrichedMetadata.foja
  if (folio) {
    parts.push(`folio ${folio}`)
  }

  // Cuaderno
  if (enrichedMetadata.cuaderno) {
    parts.push(`cuaderno ${enrichedMetadata.cuaderno}`)
  }

  // Página
  if (enrichedMetadata.page_number) {
    parts.push(`(pág. ${enrichedMetadata.page_number})`)
  }

  return parts.join(', ')
}

function formatDateForCitation(dateStr: string): string | null {
  if (!dateStr) return null

  // Formato PJUD: "DD/MM/YYYY" o ISO "YYYY-MM-DD"
  if (dateStr.includes('/')) return dateStr
  if (dateStr.includes('-')) {
    const [y, m, d] = dateStr.split('-')
    if (y && m && d) return `${d}/${m}/${y}`
  }
  return dateStr
}
