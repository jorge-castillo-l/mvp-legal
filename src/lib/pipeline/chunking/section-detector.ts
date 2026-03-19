/**
 * ============================================================
 * Legal Section Detector — Tarea 7.07c
 * ============================================================
 * Detector de secciones legales del foro judicial chileno
 * mediante regex/heurísticas. Opera sobre texto ya normalizado
 * (output de 7.07a).
 *
 * Catálogo UNIFICADO: los marcadores textuales son transversales
 * a todos los procedimientos civiles (ordinario, ejecutivo,
 * sumario, monitorio, voluntario). El procedimiento es metadata,
 * NO determinante de cómo se detectan secciones.
 *
 * Spec: docs/specs/7.07c-section-detector.md
 *
 * BASE LEGAL VERIFICADA:
 *
 * Art.170 CPC — Sentencia definitiva (6 requisitos):
 *   N°1: Designación de partes → sección 'vistos' (parte expositiva)
 *   N°2: Pretensiones del demandante → sección 'vistos'
 *   N°3: Excepciones del demandado → sección 'vistos'
 *   N°4: Consideraciones de hecho/derecho → sección 'considerando_n'
 *   N°5: Enunciación de leyes aplicables → último considerando
 *   N°6: Decisión del asunto → sección 'resolutivo'
 *
 * Art.254 CPC — Requisitos demanda (5 requisitos):
 *   N°1: Designación del tribunal → implícito en 'individualizacion'
 *   N°2: Nombre/domicilio/profesión demandante → 'individualizacion'
 *   N°3: Nombre/domicilio/profesión demandado → 'individualizacion'
 *   N°4: Exposición hechos + derecho → 'hechos' + 'derecho'
 *   N°5: Peticiones precisas → 'petitorio'
 *
 * Art.434 CPC — Títulos ejecutivos:
 *   Estructura demanda ejecutiva → 'en_lo_principal' + 'mandamiento'
 *
 * Art.441-443 CPC — Mandamiento de ejecución y embargo
 *
 * Art.683 CPC — Audiencia procedimiento sumario:
 *   Fases: contestación → conciliación → prueba/sentencia
 *   Secciones: 'audiencia_inicio' → 'audiencia_conciliacion' → 'audiencia_prueba'
 *
 * Ley 20.886 — Tramitación Electrónica:
 *   Firma electrónica avanzada → manejada por normalizer (7.07a)
 *   Certificado de Envío OJV → metadata extraída por normalizer
 * ============================================================
 */

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type SectionType =
  // ── Sentencia definitiva (Art. 170 CPC) ──────────────────
  // Art.170 N°1-3: Parte expositiva (partes + pretensiones + excepciones)
  | 'vistos'
  // Art.170 N°4-5: Parte considerativa (fundamentos de hecho/derecho + leyes)
  | 'considerando'
  | 'considerando_n'
  // Art.170 N°6: Parte resolutiva (decisión del asunto)
  | 'resolutivo'
  // Cierre: "Regístrese, notifíquese y archívese"
  | 'cierre_sentencia'

  // ── Escritos procesales (Art. 254 CPC — demanda) ─────────
  // Art.254 N°1: Designación del tribunal (implícita en "S.J.L...")
  // Art.254 N°2-3: Individualización demandante/demandado
  | 'individualizacion'
  // Estructura forense: suma + principal + otrosíes
  | 'suma'
  | 'en_lo_principal'
  // Art.254 N°4: Exposición de hechos y fundamentos de derecho
  | 'hechos'
  | 'derecho'
  // Art.254 N°5: Peticiones precisas
  | 'petitorio'
  | 'otrosi'

  // ── Actuaciones receptor (Art. 390+ CPC) ─────────────────
  | 'receptor_certificacion'
  | 'receptor_diligencia'
  | 'receptor_cierre'

  // ── Resoluciones / Autos / Decretos (Art. 158 CPC) ──────
  | 'resolucion_proveyendo'
  | 'resolucion_vistos'
  | 'resolucion_dispositivo'
  | 'notificacion_estado_diario'

  // ── Audiencias (Art. 683 CPC — sumario) ──────────────────
  | 'audiencia_inicio'
  // Art.683: conciliación obligatoria en audiencia sumaria
  | 'audiencia_conciliacion'
  // Art.683: recepción de la causa a prueba
  | 'audiencia_prueba'
  | 'audiencia_cierre'

  // ── Demanda ejecutiva (Art. 434 CPC) ─────────────────────
  // Mandamiento de ejecución y embargo (Art.441-443 CPC)
  | 'mandamiento'

  // ── Fallback ─────────────────────────────────────────────
  | 'general'

export interface DetectedSection {
  type: SectionType
  label: string
  offsetStart: number
  offsetEnd: number
  confidence: number
  ordinal?: number
}

export interface SectionDetectorResult {
  sections: DetectedSection[]
  documentStructure: DocumentStructureType
  stats: {
    sectionsDetected: number
    highConfidence: number
    mediumConfidence: number
    lowConfidence: number
  }
}

export type DocumentStructureType =
  | 'sentencia'
  | 'escrito_procesal'
  | 'actuacion_receptor'
  | 'resolucion'
  | 'audiencia'
  | 'indeterminado'

// ─────────────────────────────────────────────────────────────
// Section marker definitions
// ─────────────────────────────────────────────────────────────

interface SectionMarker {
  type: SectionType
  label: string
  pattern: RegExp
  confidence: number
  ordinalExtractor?: (match: RegExpExecArray) => number | undefined
}

const ORDINAL_MAP: Record<string, number> = {
  'PRIMERO': 1, 'SEGUNDO': 2, 'TERCERO': 3, 'CUARTO': 4, 'QUINTO': 5,
  'SEXTO': 6, 'SÉPTIMO': 7, 'SEPTIMO': 7, 'OCTAVO': 8, 'NOVENO': 9,
  'DÉCIMO': 10, 'DECIMO': 10, 'UNDÉCIMO': 11, 'UNDECIMO': 11,
  'DUODÉCIMO': 12, 'DUODECIMO': 12, 'DÉCIMO TERCERO': 13, 'DECIMO TERCERO': 13,
  'DÉCIMO CUARTO': 14, 'DECIMO CUARTO': 14, 'DÉCIMO QUINTO': 15, 'DECIMO QUINTO': 15,
  'DÉCIMO SEXTO': 16, 'DECIMO SEXTO': 16, 'DÉCIMO SÉPTIMO': 17, 'DECIMO SEPTIMO': 17,
  'DÉCIMO OCTAVO': 18, 'DECIMO OCTAVO': 18, 'DÉCIMO NOVENO': 19, 'DECIMO NOVENO': 19,
  'VIGÉSIMO': 20, 'VIGESIMO': 20,
}

function extractOrdinalFromWord(match: RegExpExecArray): number | undefined {
  const word = match[1]?.toUpperCase().trim()
  return word ? ORDINAL_MAP[word] : undefined
}

function extractOrdinalFromNumber(match: RegExpExecArray): number | undefined {
  const num = match[1]
  return num ? parseInt(num, 10) : undefined
}

/**
 * Catálogo de marcadores de sección, ordenados por prioridad de detección.
 * Cada patrón se busca con flag 'g' sobre el texto normalizado.
 *
 * Los patrones son CONSERVADORES: prefieren no detectar antes que
 * detectar incorrectamente (coherente con principio anti-alucinación).
 */
const SECTION_MARKERS: SectionMarker[] = [
  // ── SENTENCIA (Art. 170 CPC) ──────────────────────────────

  {
    type: 'vistos',
    label: 'Vistos',
    // Art.170 N°1-3: "Vistos:" o "VISTOS." o "VISTO:" (variantes reales)
    pattern: /\bVistos?[.:]\s/gi,
    confidence: 0.95,
  },
  {
    type: 'considerando',
    label: 'Considerando',
    // Art.170 N°4: "CONSIDERANDO:" o "CON LO RELACIONADO Y CONSIDERANDO:"
    pattern: /\b(?:CON\s+LO\s+RELACIONADO\s+Y\s+)?CONSIDERANDO:?\s/g,
    confidence: 0.95,
  },
  // Considerandos ordinales ALL-CAPS: PRIMERO: Que, SEGUNDO: Que,...
  {
    type: 'considerando_n',
    label: 'Considerando',
    pattern: /\b(PRIMERO|SEGUNDO|TERCERO|CUARTO|QUINTO|SEXTO|S[ÉE]PTIMO|OCTAVO|NOVENO|D[ÉE]CIMO(?:\s+(?:TERCERO|CUARTO|QUINTO|SEXTO|S[ÉE]PTIMO|OCTAVO|NOVENO))?|UND[ÉE]CIMO|DUOD[ÉE]CIMO|VIG[ÉE]SIMO)\s*:\s/g,
    confidence: 0.90,
    ordinalExtractor: extractOrdinalFromWord,
  },
  // Considerandos ordinales mixed-case: Primero: Que, Segundo:, Décimo Noveno:
  {
    type: 'considerando_n',
    label: 'Considerando',
    pattern: /\b(Primero|Segundo|Tercero|Cuarto|Quinto|Sexto|S[ée]ptimo|Octavo|Noveno|D[ée]cimo(?:\s+(?:Primero|Segundo|Tercero|Cuarto|Quinto|Sexto|S[ée]ptimo|Octavo|Noveno))?|Und[ée]cimo|Duod[ée]cimo|Vig[ée]simo)\s*:\s/g,
    confidence: 0.88,
    ordinalExtractor: (match) => {
      const word = match[1]?.toUpperCase().trim()
      return word ? ORDINAL_MAP[word] : undefined
    },
  },
  // Considerandos numéricos: 1°.-, 2°.-, 1.-, 2.-
  {
    type: 'considerando_n',
    label: 'Considerando',
    pattern: /\b(\d{1,2})[°º]?\.\s*-\s/g,
    confidence: 0.85,
    ordinalExtractor: extractOrdinalFromNumber,
  },
  {
    type: 'resolutivo',
    label: 'Resolutivo',
    // Art.170 N°6: "se resuelve:", "se declara:", "FALLO:", etc.
    pattern: /\b(?:se\s+resuelve|se\s+declara|resuelve|FALLO|Y\s+VISTO|Y\s+TENIENDO\s+PRESENTE)\s*:\s/gi,
    confidence: 0.95,
  },
  {
    type: 'cierre_sentencia',
    label: 'Cierre sentencia',
    // "Regístrese, notifíquese..." o "Regístrese y archívese"
    pattern: /\bReg[ií]strese[,\s]+(?:notif[ií]quese|y\s+arch[ií]vese)/gi,
    confidence: 0.85,
  },

  // ── ESCRITOS PROCESALES ────────────────────────────────────

  {
    type: 'en_lo_principal',
    label: 'En lo principal',
    pattern: /\bEN\s+LO\s+PRINCIPAL\s*:\s/g,
    confidence: 0.95,
  },
  // Otrosíes: PRIMER OTROSÍ, SEGUNDO OTROSÍ, AL PRIMER OTROSÍ, etc.
  {
    type: 'otrosi',
    label: 'Otrosí',
    pattern: /\b(?:AL\s+)?(PRIMER|SEGUNDO|TERCER|CUARTO|QUINTO|SEXTO|S[ÉE]PTIMO|OCTAVO|NOVENO|D[ÉE]CIMO)\s+OTROS[ÍI]\s*:\s/gi,
    confidence: 0.90,
    ordinalExtractor: (match) => {
      const map: Record<string, number> = {
        'PRIMER': 1, 'SEGUNDO': 2, 'TERCER': 3, 'CUARTO': 4, 'QUINTO': 5,
        'SEXTO': 6, 'SÉPTIMO': 7, 'SEPTIMO': 7, 'OCTAVO': 8, 'NOVENO': 9,
        'DÉCIMO': 10, 'DECIMO': 10,
      }
      return map[match[1]?.toUpperCase().trim()]
    },
  },
  // Otrosí genérico (sin ordinal): "OTROSÍ:" o "EN EL OTROSÍ:"
  {
    type: 'otrosi',
    label: 'Otrosí',
    pattern: /\b(?:EN\s+EL\s+)?OTROS[ÍI]\s*:\s/g,
    confidence: 0.85,
  },
  {
    type: 'hechos',
    label: 'Hechos',
    pattern: /\bLOS\s+HECHOS\b/g,
    confidence: 0.85,
  },
  {
    type: 'derecho',
    label: 'Derecho',
    pattern: /\bEL\s+DERECHO\b/g,
    confidence: 0.85,
  },
  {
    type: 'petitorio',
    label: 'Petitorio',
    pattern: /\bPOR\s+TANTO\s*,/gi,
    confidence: 0.90,
  },
  // Variantes de petitorio: "A SS. PIDO:", "SOLICITO A SS.:", "SOLICITO A US.:"
  {
    type: 'petitorio',
    label: 'Petitorio',
    pattern: /\b(?:A\s+SS\.?\s+PIDO|SOLICITO\s+A\s+(?:SS|US|S\.S)\.?\s*:)/gi,
    confidence: 0.88,
  },

  // ── ACTUACIONES RECEPTOR ───────────────────────────────────

  {
    type: 'receptor_certificacion',
    label: 'Certificación receptor',
    pattern: /\bCERTIFICO\s*:\s*haber\s+(?:buscado|notificado|practicado)/gi,
    confidence: 0.95,
  },
  {
    type: 'receptor_diligencia',
    label: 'Diligencia receptor',
    // "En Santiago, a dieciséis de octubre... me constituí en..."
    // Usa [^\s,]+ en vez de \w+ porque \w no matchea acentos en JS
    pattern: /\bEn\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\s*,\s*a\s+[^\s,]+\s+de\s+[^\s,]+\s+(?:del\s+a[ñn]o\s+)?(?:de\s+)?dos\s+mil\s+[^\s,]+.*?me\s+constitu[ií]/gi,
    confidence: 0.90,
  },
  {
    type: 'receptor_cierre',
    label: 'Cierre receptor',
    pattern: /\b(?:Doy\s+fe|DOY\s+FE|Para\s+constancia\s+firmo)\s*[.\-]/gi,
    confidence: 0.85,
  },
  // Búsqueda negativa (receptor)
  {
    type: 'receptor_certificacion',
    label: 'Búsqueda negativa',
    pattern: /\bBUSQUEDA\s+NEGATIVA\b/gi,
    confidence: 0.90,
  },

  // ── RESOLUCIONES / AUTOS / DECRETOS ────────────────────────

  {
    type: 'resolucion_proveyendo',
    label: 'Proveyendo',
    pattern: /\bProveyendo\s+(?:presentaci[óo]n|escrito|el\s+escrito|devoluci[óo]n)/gi,
    confidence: 0.90,
  },
  {
    type: 'notificacion_estado_diario',
    label: 'Notificación estado diario',
    pattern: /\bse\s+notific[óo]\s+por\s+el\s+estado\s+diario/gi,
    confidence: 0.90,
  },

  // ── AUDIENCIAS ─────────────────────────────────────────────

  {
    type: 'audiencia_inicio',
    label: 'Inicio audiencia',
    pattern: /\bA\s+la\s+hora\s+y\s+fecha\s+indicada/gi,
    confidence: 0.90,
  },
  {
    type: 'audiencia_cierre',
    label: 'Cierre audiencia',
    pattern: /\bSe\s+(?:tiene\s+por\s+afinada\s+la\s+audiencia|pone\s+t[ée]rmino\s+a\s+la\s+diligencia)/gi,
    confidence: 0.85,
  },

  // ── AUDIENCIA: FASES Art.683 CPC (conciliación + prueba) ──

  // Art.262 CPC: conciliación obligatoria / Art.683: en audiencia sumaria
  {
    type: 'audiencia_conciliacion',
    label: 'Conciliación',
    pattern: /\b(?:Se\s+llam[óo]\s+a\s+las\s+partes\s+a\s+conciliaci[óo]n|llamado\s+a\s+conciliaci[óo]n|Se\s+realiza\s+el\s+llamado\s+a\s+conciliaci[óo]n)/gi,
    confidence: 0.88,
  },
  // Art.318 CPC / Art.683: recepción de la causa a prueba
  {
    type: 'audiencia_prueba',
    label: 'Recepción a prueba',
    pattern: /\b(?:Se\s+recib(?:e|i[óo])\s+la\s+causa\s+a\s+prueba|recibe\s+la\s+causa\s+a\s+prueba|recibi[óo]\s+a\s+prueba)/gi,
    confidence: 0.88,
  },

  // ── DEMANDA EJECUTIVA (Art.434 + Art.441-443 CPC) ────────

  // Mandamiento de ejecución y embargo (Art.441 CPC)
  {
    type: 'mandamiento',
    label: 'Mandamiento',
    pattern: /\b(?:mandamiento\s+de\s+ejecuci[óo]n\s+y\s+embargo|Desp[áa]chese\s+mandamiento|mand[óo]\s+despachar\s+mandamiento)/gi,
    confidence: 0.85,
  },

  // ── INDIVIDUALIZACIÓN DE PARTES (Art.254 N°2-3 CPC) ──────
  // Patrones comunes al inicio de escritos procesales que identifican
  // al compareciente y su calidad procesal

  // Fórmula estándar: "S.J.L en lo Civil de [Tribunal]"
  {
    type: 'individualizacion',
    label: 'Individualización',
    pattern: /\bS\.?\s*J\.?\s*L\.?\s+(?:en\s+lo\s+)?Civil\s+de\s+/gi,
    confidence: 0.80,
  },
  // Fórmula alternativa: "SEÑOR JUEZ DE LETRAS EN LO CIVIL DE"
  {
    type: 'individualizacion',
    label: 'Individualización',
    pattern: /\bSE[ÑN]OR\s+JUEZ\s+DE\s+LETRAS\s+(?:EN\s+LO\s+)?CIVIL/gi,
    confidence: 0.80,
  },
]

// ─────────────────────────────────────────────────────────────
// Document structure classification
// ─────────────────────────────────────────────────────────────

function classifyDocumentStructure(sections: DetectedSection[]): DocumentStructureType {
  const types = new Set(sections.map(s => s.type))

  // Sentencia: requiere estructura Art.170 CPC (Vistos/Considerandos + Resolutivo)
  const hasSentenciaMarkers =
    (types.has('vistos') || types.has('considerando') || types.has('considerando_n')) &&
    types.has('resolutivo')
  if (hasSentenciaMarkers) return 'sentencia'

  // Audiencia: Art.683 CPC — requiere audiencia_inicio como marcador obligatorio.
  // conciliación y prueba solos no bastan (aparecen en narrativa de sentencias).
  const hasAudienciaMarkers =
    types.has('audiencia_inicio') || types.has('audiencia_cierre')
  if (hasAudienciaMarkers && !hasSentenciaMarkers) return 'audiencia'

  // Escrito procesal: Art.254 CPC (EN LO PRINCIPAL, OTROSÍ, POR TANTO)
  const hasEscritoMarkers =
    types.has('en_lo_principal') || types.has('otrosi') || types.has('petitorio')
  if (hasEscritoMarkers) return 'escrito_procesal'

  // Actuación receptor: Art.390+ CPC
  const hasReceptorMarkers =
    types.has('receptor_certificacion') || types.has('receptor_diligencia')
  if (hasReceptorMarkers) return 'actuacion_receptor'

  // Resolución/auto/decreto: Art.158 CPC
  const hasResolucionMarkers =
    types.has('resolucion_proveyendo') || types.has('notificacion_estado_diario')
  if (hasResolucionMarkers) return 'resolucion'

  return 'indeterminado'
}

// ─────────────────────────────────────────────────────────────
// Main detection function
// ─────────────────────────────────────────────────────────────

/**
 * Detecta secciones legales en texto normalizado de PJUD.
 *
 * El detector encuentra MARKERS (puntos de inicio de sección).
 * Las secciones se extienden desde un marker hasta el siguiente
 * (o hasta el final del texto para la última sección).
 *
 * @param cleanText - Texto ya normalizado por 7.07a
 * @returns Lista de DetectedSection ordenadas por offset
 */
export function detectSections(cleanText: string): SectionDetectorResult {
  if (!cleanText || cleanText.trim().length === 0) {
    return {
      sections: [],
      documentStructure: 'indeterminado',
      stats: { sectionsDetected: 0, highConfidence: 0, mediumConfidence: 0, lowConfidence: 0 },
    }
  }

  // Paso 1: encontrar todos los markers en el texto
  const rawMarkers: Array<{
    type: SectionType
    label: string
    offset: number
    matchLength: number
    confidence: number
    ordinal?: number
  }> = []

  for (const marker of SECTION_MARKERS) {
    const regex = new RegExp(marker.pattern.source, marker.pattern.flags)
    let match: RegExpExecArray | null
    while ((match = regex.exec(cleanText)) !== null) {
      const ordinal = marker.ordinalExtractor?.(match)
      rawMarkers.push({
        type: marker.type,
        label: ordinal ? `${marker.label} ${ordinal}` : marker.label,
        offset: match.index,
        matchLength: match[0].length,
        confidence: marker.confidence,
        ordinal,
      })
    }
  }

  if (rawMarkers.length === 0) {
    return {
      sections: [],
      documentStructure: 'indeterminado',
      stats: { sectionsDetected: 0, highConfidence: 0, mediumConfidence: 0, lowConfidence: 0 },
    }
  }

  // Paso 2: ordenar por offset y deduplicar overlaps
  rawMarkers.sort((a, b) => a.offset - b.offset)

  const dedupedMarkers = deduplicateMarkers(rawMarkers)

  // Paso 3: construir secciones (desde un marker hasta el siguiente)
  const sections: DetectedSection[] = []
  for (let i = 0; i < dedupedMarkers.length; i++) {
    const current = dedupedMarkers[i]
    const next = dedupedMarkers[i + 1]

    sections.push({
      type: current.type,
      label: current.label,
      offsetStart: current.offset,
      offsetEnd: next ? next.offset : cleanText.length,
      confidence: current.confidence,
      ordinal: current.ordinal,
    })
  }

  // Paso 4: boost confidence basado en contexto del documento
  const boostedSections = boostConfidenceByContext(sections)

  const documentStructure = classifyDocumentStructure(boostedSections)

  const highConf = boostedSections.filter(s => s.confidence >= 0.90).length
  const medConf = boostedSections.filter(s => s.confidence >= 0.70 && s.confidence < 0.90).length
  const lowConf = boostedSections.filter(s => s.confidence < 0.70).length

  return {
    sections: boostedSections,
    documentStructure,
    stats: {
      sectionsDetected: boostedSections.length,
      highConfidence: highConf,
      mediumConfidence: medConf,
      lowConfidence: lowConf,
    },
  }
}

// ─────────────────────────────────────────────────────────────
// Deduplication: cuando dos markers detectan el mismo offset
// ─────────────────────────────────────────────────────────────

function deduplicateMarkers(
  markers: Array<{
    type: SectionType
    label: string
    offset: number
    matchLength: number
    confidence: number
    ordinal?: number
  }>
): typeof markers {
  const result: typeof markers = []

  for (const marker of markers) {
    const lastAdded = result[result.length - 1]

    if (lastAdded && Math.abs(marker.offset - lastAdded.offset) < 5) {
      // Markers at virtually the same position: keep higher confidence
      if (marker.confidence > lastAdded.confidence) {
        result[result.length - 1] = marker
      }
    } else if (
      lastAdded &&
      lastAdded.type === marker.type &&
      Math.abs(marker.offset - lastAdded.offset) < 20
    ) {
      // Same type within 20 chars: true duplicate, keep higher confidence
      if (marker.confidence > lastAdded.confidence) {
        result[result.length - 1] = marker
      }
    } else {
      // Different types or far enough apart: both are valid sections
      result.push(marker)
    }
  }

  return result
}

// ─────────────────────────────────────────────────────────────
// Context-based confidence boosting
// ─────────────────────────────────────────────────────────────

/**
 * Ajusta confidence basándose en el contexto del documento.
 * - Si un documento tiene VISTOS + CONSIDERANDO + RESUELVE → es sentencia
 *   → boost a los considerandos individuales
 * - Si tiene EN LO PRINCIPAL + OTROSÍ → es escrito
 *   → boost al petitorio
 */
/**
 * Ajusta confidence basándose en el contexto del documento completo.
 *
 * Base legal para los boosts:
 * - Art.170 CPC: si hay Vistos+Considerandos → es sentencia → boost considerandos y resolutivo
 * - Art.254 CPC: si hay EN LO PRINCIPAL+OTROSÍ → es escrito → boost petitorio
 * - Art.683 CPC: si hay audiencia_inicio → es audiencia → boost conciliación y prueba
 */
function boostConfidenceByContext(sections: DetectedSection[]): DetectedSection[] {
  const types = new Set(sections.map(s => s.type))

  // Art.170 CPC: estructura sentencia → boost componentes
  const isSentencia =
    (types.has('vistos') || types.has('considerando')) &&
    (types.has('resolutivo') || types.has('considerando_n'))

  // Art.254 CPC: estructura escrito → boost petitorio/otrosíes
  const isEscrito =
    types.has('en_lo_principal') || types.has('otrosi')

  // Art.683 CPC: estructura audiencia → boost fases
  const isAudiencia =
    types.has('audiencia_inicio')

  return sections.map(s => {
    let boostedConfidence = s.confidence

    if (isSentencia) {
      if (s.type === 'considerando_n') {
        boostedConfidence = Math.min(1.0, s.confidence + 0.05)
      }
      if (s.type === 'resolutivo') {
        boostedConfidence = Math.min(1.0, s.confidence + 0.05)
      }
      if (s.type === 'cierre_sentencia') {
        boostedConfidence = Math.min(1.0, s.confidence + 0.05)
      }
    }

    if (isEscrito) {
      if (s.type === 'petitorio') {
        boostedConfidence = Math.min(1.0, s.confidence + 0.05)
      }
      if (s.type === 'otrosi') {
        boostedConfidence = Math.min(1.0, s.confidence + 0.05)
      }
      if (s.type === 'hechos' || s.type === 'derecho') {
        boostedConfidence = Math.min(1.0, s.confidence + 0.05)
      }
    }

    if (isAudiencia) {
      if (s.type === 'audiencia_conciliacion') {
        boostedConfidence = Math.min(1.0, s.confidence + 0.05)
      }
      if (s.type === 'audiencia_prueba') {
        boostedConfidence = Math.min(1.0, s.confidence + 0.05)
      }
    }

    return { ...s, confidence: boostedConfidence }
  })
}
