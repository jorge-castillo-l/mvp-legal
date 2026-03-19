/**
 * ============================================================
 * Token-Based Chunker — Tarea 7.07b
 * ============================================================
 * Chunking genérico por tokens para español jurídico chileno.
 * Produce chunks utilizables para embedding (text-embedding-004)
 * y RAG. Respeta fronteras legales básicas sin necesitar el
 * section-detector completo (7.07c).
 *
 * Spec: docs/specs/7.07b-token-chunker.md
 * Consumidor: 7.07d (Metadata Enricher) → 7.08 (Embeddings)
 * ============================================================
 */

import type { NormalizerMetadata } from './normalizer'
import type { DetectedSection } from './section-detector'

// ─────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────

const TARGET_TOKENS = 768
const TOKEN_FLEX = 0.30
const MIN_TARGET = Math.floor(TARGET_TOKENS * (1 - TOKEN_FLEX))   // 538
const MAX_TARGET = Math.ceil(TARGET_TOKENS * (1 + TOKEN_FLEX))    // 998
const OVERLAP_PERCENT = 0.15
const OVERLAP_TOKENS = Math.floor(TARGET_TOKENS * OVERLAP_PERCENT) // 115
const MIN_CHUNK_TOKENS = 50
const MAX_CHUNK_TOKENS = 1500
const SHORT_DOC_THRESHOLD = 200
const CHARS_PER_TOKEN = 5  // aprox para español jurídico (~6.5 chars/word, ~1.3 tokens/word)

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface Chunk {
  chunkIndex: number
  chunkText: string
  pageNumber: number | null
  sectionType: string
  startOffset: number
  endOffset: number
  tokenEstimate: number
  metadata: ChunkMetadata
}

export interface ChunkMetadata {
  foja?: number
  juzgado?: string
  rol?: string
  caratulado?: string
  nomenclaturas?: Array<{ codigo: number; descripcion: string }>
  overlapWithPrevious: boolean
  documentTokenEstimate: number
  sectionLabel?: string
  sectionConfidence?: number
  sectionOrdinal?: number
}

export interface ChunkerOptions {
  normalizerMetadata?: NormalizerMetadata
  documentType?: string
  detectedSections?: DetectedSection[]
}

export interface ChunkerResult {
  chunks: Chunk[]
  stats: {
    totalChunks: number
    documentTokens: number
    documentChars: number
    avgChunkTokens: number
    minChunkTokens: number
    maxChunkTokens: number
    shortDocSingleChunk: boolean
  }
}

// ─────────────────────────────────────────────────────────────
// Token estimation
// ─────────────────────────────────────────────────────────────

export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

// ─────────────────────────────────────────────────────────────
// Protected legal prefixes (fronteras que no se deben cortar)
// ─────────────────────────────────────────────────────────────

/**
 * Patrones que marcan inicio de sección legal significativa.
 * El chunker los usa como puntos de corte prioritarios.
 * Ordenados por especificidad descendente.
 */
const LEGAL_BOUNDARY_PATTERNS: RegExp[] = [
  // Estructura sentencia (Art.170 CPC)
  /\bVistos?:\s/i,
  /\bCONSIDERANDO:\s/i,
  /\bSE\s+RESUELVE:\s/i,
  /\bse\s+declara:\s/i,

  // Considerandos numerados (ordinal + ":")
  /\bPRIMERO:\s/,
  /\bSEGUNDO:\s/,
  /\bTERCERO:\s/,
  /\bCUARTO:\s/,
  /\bQUINTO:\s/,
  /\bSEXTO:\s/,
  /\bS[ÉE]PTIMO:\s/,
  /\bOCTAVO:\s/,
  /\bNOVENO:\s/,
  /\bD[ÉE]CIMO[^:]*:\s/,
  /\bUND[ÉE]CIMO:\s/,
  /\bDUOD[ÉE]CIMO:\s/,

  // Estructura escritos procesales
  /\bEN\s+LO\s+PRINCIPAL:\s/,
  /\bPRIMER\s+OTROS[ÍI]:\s/i,
  /\bSEGUNDO\s+OTROS[ÍI]:\s/i,
  /\bTERCER\s+OTROS[ÍI]:\s/i,
  /\bCUARTO\s+OTROS[ÍI]:\s/i,
  /\bQUINTO\s+OTROS[ÍI]:\s/i,

  // Petitorios
  /\bPOR\s+TANTO,/i,
  /\bA\s+SS\.?\s+PIDO:/i,
  /\bSOLICITO\s+A\s+[SU]{2}\.?:/i,

  // Actuaciones receptor
  /\bCERTIFICO:\s/,

  // Considerandos con formato numérico: "1°.-", "2°.-", "1.-"
  /\b\d{1,2}[°º]?\.\s*-\s/,

  // Audiencia: fases Art.683 CPC (conciliación + prueba)
  /\bSe\s+llam[óo]\s+a\s+las\s+partes\s+a\s+conciliaci[óo]n/i,
  /\bSe\s+recib(?:e|i[óo])\s+la\s+causa\s+a\s+prueba/i,

  // Demanda ejecutiva: mandamiento (Art.441 CPC)
  /\bmandamiento\s+de\s+ejecuci[óo]n/i,
]

/**
 * Busca la posición del boundary legal más cercano HACIA ATRÁS
 * desde `fromOffset`, dentro de un rango dado.
 * Retorna el offset del inicio del pattern, o -1 si no encuentra.
 */
function findLegalBoundaryBackward(
  text: string,
  fromOffset: number,
  searchRange: number
): number {
  const searchStart = Math.max(0, fromOffset - searchRange)
  const searchText = text.slice(searchStart, fromOffset)

  let bestOffset = -1
  for (const pattern of LEGAL_BOUNDARY_PATTERNS) {
    const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g')
    let match: RegExpExecArray | null
    while ((match = globalPattern.exec(searchText)) !== null) {
      const absoluteOffset = searchStart + match.index
      if (absoluteOffset > bestOffset) {
        bestOffset = absoluteOffset
      }
    }
  }
  return bestOffset
}

/**
 * Busca la posición del boundary legal más cercano HACIA ADELANTE
 * desde `fromOffset`, dentro de un rango dado.
 */
function findLegalBoundaryForward(
  text: string,
  fromOffset: number,
  searchRange: number
): number {
  const searchEnd = Math.min(text.length, fromOffset + searchRange)
  const searchText = text.slice(fromOffset, searchEnd)

  let bestOffset = -1
  let bestDist = searchRange + 1
  for (const pattern of LEGAL_BOUNDARY_PATTERNS) {
    const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g')
    const match = globalPattern.exec(searchText)
    if (match && match.index < bestDist) {
      bestDist = match.index
      bestOffset = fromOffset + match.index
    }
  }
  return bestOffset
}

// ─────────────────────────────────────────────────────────────
// Sentence/paragraph boundary detection
// ─────────────────────────────────────────────────────────────

/**
 * Encuentra el final de oración más cercano hacia atrás (para overlap semántico).
 * Busca: punto seguido de espacio, o doble newline.
 */
function findSentenceBoundaryBackward(text: string, fromOffset: number, searchRange: number): number {
  const searchStart = Math.max(0, fromOffset - searchRange)
  const searchText = text.slice(searchStart, fromOffset)

  // Buscar el último punto seguido de espacio o newline
  const lastPeriod = searchText.lastIndexOf('. ')
  const lastDoubleNewline = searchText.lastIndexOf('\n\n')

  const best = Math.max(lastPeriod, lastDoubleNewline)
  if (best >= 0) {
    // +2 para incluir el ". " o "\n\n"
    return searchStart + best + 2
  }
  return -1
}

/**
 * Encuentra el final de oración más cercano hacia adelante (para punto de corte).
 */
function findSentenceBoundaryForward(text: string, fromOffset: number, searchRange: number): number {
  const searchEnd = Math.min(text.length, fromOffset + searchRange)
  const searchText = text.slice(fromOffset, searchEnd)

  const nextPeriod = searchText.indexOf('. ')
  const nextDoubleNewline = searchText.indexOf('\n\n')

  let best = -1
  if (nextPeriod >= 0 && nextDoubleNewline >= 0) {
    best = Math.min(nextPeriod, nextDoubleNewline)
  } else if (nextPeriod >= 0) {
    best = nextPeriod
  } else if (nextDoubleNewline >= 0) {
    best = nextDoubleNewline
  }

  if (best >= 0) {
    return fromOffset + best + 2
  }
  return -1
}

// ─────────────────────────────────────────────────────────────
// Page number assignment from normalizer boundaries
// ─────────────────────────────────────────────────────────────

function getPageNumber(offset: number, pageBoundaries: number[]): number | null {
  if (!pageBoundaries || pageBoundaries.length <= 1) return null
  for (let i = pageBoundaries.length - 1; i >= 0; i--) {
    if (offset >= pageBoundaries[i]) {
      return i + 1
    }
  }
  return 1
}

// ─────────────────────────────────────────────────────────────
// Best cut point finder
// ─────────────────────────────────────────────────────────────

/**
 * Encuentra el mejor punto de corte cerca de `idealOffset`.
 * Prioridad:
 *   1. Legal boundary (CONSIDERANDO, OTROSÍ, etc.) dentro del flex range
 *   2. Sentence boundary (punto seguido o doble newline) dentro del flex range
 *   3. Espacio más cercano al ideal (fallback)
 */
function findBestCutPoint(text: string, idealOffset: number): number {
  const flexChars = Math.floor(TARGET_TOKENS * TOKEN_FLEX * CHARS_PER_TOKEN)

  // 1. Buscar legal boundary hacia adelante (preferir no cortar antes de una sección)
  const legalForward = findLegalBoundaryForward(text, idealOffset, flexChars)
  if (legalForward > 0 && legalForward <= idealOffset + flexChars) {
    return legalForward
  }

  // 2. Buscar legal boundary hacia atrás
  const legalBackward = findLegalBoundaryBackward(text, idealOffset, flexChars)
  if (legalBackward > 0 && legalBackward >= idealOffset - flexChars) {
    return legalBackward
  }

  // 3. Buscar sentence boundary hacia adelante
  const sentForward = findSentenceBoundaryForward(text, idealOffset, flexChars)
  if (sentForward > 0 && sentForward <= idealOffset + flexChars) {
    return sentForward
  }

  // 4. Buscar sentence boundary hacia atrás
  const sentBackward = findSentenceBoundaryBackward(text, idealOffset, flexChars)
  if (sentBackward > 0 && sentBackward >= idealOffset - flexChars) {
    return sentBackward
  }

  // 5. Fallback: espacio más cercano
  const spaceAfter = text.indexOf(' ', idealOffset)
  if (spaceAfter >= 0 && spaceAfter <= idealOffset + flexChars) {
    return spaceAfter + 1
  }
  return idealOffset
}

/**
 * Calcula el offset de inicio del overlap para un chunk.
 * Intenta retroceder hasta un boundary de oración en vez de cortar mecánicamente.
 */
function calculateOverlapStart(text: string, chunkStart: number): number {
  if (chunkStart <= 0) return 0

  const overlapChars = OVERLAP_TOKENS * CHARS_PER_TOKEN
  const mechanicalStart = Math.max(0, chunkStart - overlapChars)

  // Buscar sentence boundary cerca del punto mecánico
  const tolerance = Math.floor(overlapChars * 0.35)
  const sentBoundary = findSentenceBoundaryBackward(text, chunkStart, overlapChars + tolerance)

  if (sentBoundary >= 0 && sentBoundary >= mechanicalStart - tolerance && sentBoundary < chunkStart) {
    return sentBoundary
  }
  return mechanicalStart
}

// ─────────────────────────────────────────────────────────────
// Section assignment: maps chunk offsets to detected sections
// ─────────────────────────────────────────────────────────────

function getSectionForOffset(
  offset: number,
  sections: DetectedSection[]
): DetectedSection | null {
  if (!sections || sections.length === 0) return null
  for (let i = sections.length - 1; i >= 0; i--) {
    if (offset >= sections[i].offsetStart && offset < sections[i].offsetEnd) {
      return sections[i]
    }
  }
  return null
}

/**
 * Aplica sectionType y metadata de sección a cada chunk
 * basándose en las secciones detectadas por 7.07c.
 */
function applySectionTypes(chunks: Chunk[], sections: DetectedSection[]): void {
  if (!sections || sections.length === 0) return
  for (const chunk of chunks) {
    const section = getSectionForOffset(chunk.startOffset, sections)
    if (section) {
      chunk.sectionType = section.type
      chunk.metadata.sectionLabel = section.label
      chunk.metadata.sectionConfidence = section.confidence
      chunk.metadata.sectionOrdinal = section.ordinal
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Main chunking function
// ─────────────────────────────────────────────────────────────

export function chunkText(
  cleanText: string,
  options: ChunkerOptions = {}
): ChunkerResult {
  const { normalizerMetadata, documentType, detectedSections } = options
  const pageBoundaries = normalizerMetadata?.pageBoundaries ?? []
  const docTokens = estimateTokens(cleanText)

  const baseMetadata: Omit<ChunkMetadata, 'overlapWithPrevious' | 'documentTokenEstimate'> = {
    foja: normalizerMetadata?.foja,
    juzgado: normalizerMetadata?.juzgado,
    rol: normalizerMetadata?.rol,
    caratulado: normalizerMetadata?.caratulado,
    nomenclaturas: normalizerMetadata?.nomenclaturas,
  }

  // Documento vacío → 0 chunks (el orquestador maneja este caso)
  if (!cleanText || cleanText.trim().length === 0) {
    return {
      chunks: [],
      stats: {
        totalChunks: 0,
        documentTokens: 0,
        documentChars: 0,
        avgChunkTokens: 0,
        minChunkTokens: 0,
        maxChunkTokens: 0,
        shortDocSingleChunk: false,
      },
    }
  }

  // Documento corto → 1 solo chunk, sin fragmentar
  if (docTokens <= SHORT_DOC_THRESHOLD) {
    const singleChunk: Chunk = {
      chunkIndex: 0,
      chunkText: cleanText.trim(),
      pageNumber: getPageNumber(0, pageBoundaries),
      sectionType: 'general',
      startOffset: 0,
      endOffset: cleanText.length,
      tokenEstimate: docTokens,
      metadata: {
        ...baseMetadata,
        overlapWithPrevious: false,
        documentTokenEstimate: docTokens,
      },
    }
    if (detectedSections?.length) {
      applySectionTypes([singleChunk], detectedSections)
    }
    return {
      chunks: [singleChunk],
      stats: {
        totalChunks: 1,
        documentTokens: docTokens,
        documentChars: cleanText.length,
        avgChunkTokens: docTokens,
        minChunkTokens: docTokens,
        maxChunkTokens: docTokens,
        shortDocSingleChunk: true,
      },
    }
  }

  // Documento normal → chunking con overlap y fronteras legales
  const chunks: Chunk[] = []
  let currentOffset = 0
  const targetChars = TARGET_TOKENS * CHARS_PER_TOKEN

  while (currentOffset < cleanText.length) {
    const idealEnd = currentOffset + targetChars
    let chunkEnd: number

    if (idealEnd >= cleanText.length) {
      // Último chunk: tomar todo lo que queda
      chunkEnd = cleanText.length
    } else {
      chunkEnd = findBestCutPoint(cleanText, idealEnd)
    }

    // Asegurar progreso mínimo para evitar loop infinito
    if (chunkEnd <= currentOffset) {
      chunkEnd = Math.min(currentOffset + targetChars, cleanText.length)
    }

    const chunkText = cleanText.slice(currentOffset, chunkEnd).trim()
    const tokens = estimateTokens(chunkText)

    if (tokens >= MIN_CHUNK_TOKENS || currentOffset === 0 || chunkEnd >= cleanText.length) {
      chunks.push({
        chunkIndex: chunks.length,
        chunkText,
        pageNumber: getPageNumber(currentOffset, pageBoundaries),
        sectionType: 'general',
        startOffset: currentOffset,
        endOffset: chunkEnd,
        tokenEstimate: tokens,
        metadata: {
          ...baseMetadata,
          overlapWithPrevious: chunks.length > 0,
          documentTokenEstimate: docTokens,
        },
      })
    } else if (chunks.length > 0) {
      // Chunk muy pequeño → merge con el anterior
      const prev = chunks[chunks.length - 1]
      const mergedText = cleanText.slice(prev.startOffset, chunkEnd).trim()
      prev.chunkText = mergedText
      prev.endOffset = chunkEnd
      prev.tokenEstimate = estimateTokens(mergedText)
    }

    // Avanzar con overlap semántico
    if (chunkEnd >= cleanText.length) break

    const overlapStart = calculateOverlapStart(cleanText, chunkEnd)
    currentOffset = overlapStart
  }

  // Post-proceso: subdividir chunks que excedan MAX_CHUNK_TOKENS
  const finalChunks: Chunk[] = []
  for (const chunk of chunks) {
    if (chunk.tokenEstimate > MAX_CHUNK_TOKENS) {
      const subChunks = subdivideChunk(chunk, cleanText, pageBoundaries, baseMetadata, docTokens)
      for (const sub of subChunks) {
        sub.chunkIndex = finalChunks.length
        finalChunks.push(sub)
      }
    } else {
      chunk.chunkIndex = finalChunks.length
      finalChunks.push(chunk)
    }
  }

  // Asignar sectionType a cada chunk basándose en las secciones detectadas por 7.07c
  if (detectedSections?.length) {
    applySectionTypes(finalChunks, detectedSections)
  }

  const tokenCounts = finalChunks.map(c => c.tokenEstimate)
  return {
    chunks: finalChunks,
    stats: {
      totalChunks: finalChunks.length,
      documentTokens: docTokens,
      documentChars: cleanText.length,
      avgChunkTokens: Math.round(tokenCounts.reduce((a, b) => a + b, 0) / tokenCounts.length),
      minChunkTokens: Math.min(...tokenCounts),
      maxChunkTokens: Math.max(...tokenCounts),
      shortDocSingleChunk: false,
    },
  }
}

/**
 * Subdivide un chunk que excede MAX_CHUNK_TOKENS por párrafos internos.
 */
function subdivideChunk(
  chunk: Chunk,
  fullText: string,
  pageBoundaries: number[],
  baseMetadata: Omit<ChunkMetadata, 'overlapWithPrevious' | 'documentTokenEstimate'>,
  docTokens: number
): Chunk[] {
  const text = chunk.chunkText
  const subChunks: Chunk[] = []
  let offset = 0
  const subTargetChars = TARGET_TOKENS * CHARS_PER_TOKEN

  while (offset < text.length) {
    let end = offset + subTargetChars
    if (end >= text.length) {
      end = text.length
    } else {
      // Buscar boundary de párrafo o oración
      const sentBoundary = findSentenceBoundaryForward(text, end - 200, 400)
      if (sentBoundary > offset && sentBoundary < text.length) {
        end = sentBoundary
      } else {
        const space = text.indexOf(' ', end)
        if (space > 0 && space < end + 200) end = space + 1
      }
    }

    const subText = text.slice(offset, end).trim()
    const tokens = estimateTokens(subText)
    if (tokens >= MIN_CHUNK_TOKENS || subChunks.length === 0) {
      const absStart = chunk.startOffset + offset
      subChunks.push({
        chunkIndex: 0,
        chunkText: subText,
        pageNumber: getPageNumber(absStart, pageBoundaries),
        sectionType: chunk.sectionType,
        startOffset: absStart,
        endOffset: chunk.startOffset + end,
        tokenEstimate: tokens,
        metadata: {
          ...baseMetadata,
          overlapWithPrevious: subChunks.length > 0,
          documentTokenEstimate: docTokens,
        },
      })
    } else if (subChunks.length > 0) {
      const prev = subChunks[subChunks.length - 1]
      prev.chunkText = text.slice(prev.startOffset - chunk.startOffset, end).trim()
      prev.endOffset = chunk.startOffset + end
      prev.tokenEstimate = estimateTokens(prev.chunkText)
    }

    offset = end
  }

  return subChunks
}
