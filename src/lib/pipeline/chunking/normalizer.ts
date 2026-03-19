/**
 * ============================================================
 * PJUD Text Normalizer — Tarea 7.07a
 * ============================================================
 * Limpia artefactos digitales del sistema judicial PJUD/OJV
 * del texto extraído de PDFs, ANTES del chunking (7.07b).
 *
 * Opera sobre extracted_texts.full_text (el original se preserva
 * intacto en DB). El texto limpio pasa al chunker en memoria.
 *
 * Principio rector: conservadurismo. Un falso positivo (remover
 * texto legal) es mucho peor que un falso negativo (dejar un
 * artefacto). Ante la duda, preservar.
 *
 * Spec completo: docs/specs/7.07a-normalizer-refinements.md
 * Fixtures de referencia: docs/fixtures/normalizer/
 * ============================================================
 */

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type ExtractionMethod = 'pdf-parse' | 'document-ai'

export type NormalizerMode = 'conservative' | 'aggressive'

export interface NormalizerOptions {
  extractionMethod: ExtractionMethod
  dryRun?: boolean
  mode?: NormalizerMode
}

export interface ExtractedArtifact {
  type:
    | 'firma_pjud'
    | 'firma_esigner'
    | 'firma_digital_ocr'
    | 'page_marker'
    | 'header_nomenclatura'
    | 'foja_repetida'
    | 'encoding_fix'
    | 'disclaimer_horario'
    | 'watermark_scanner'
    | 'page_number_loose'
  offset: number
  length: number
  rawText: string
  extractedData?: Record<string, unknown>
}

export interface NormalizerMetadata {
  foja?: number
  foja_texto?: string
  nomenclaturas?: Array<{ codigo: number; descripcion: string }>
  juzgado?: string
  rol?: string
  caratulado?: string
  firma_pjud_codigos?: string[]
  firma_esigner_codigo?: string
  firma_digital?: { nombre?: string; fecha?: string }
  total_pages?: number
  pageBoundaries: number[]
  /** Ley 20.886: metadata extraída del Certificado de Envío OJV si el documento es de ese tipo */
  certificado_envio?: {
    juzgado?: string
    rol?: string
    ruc?: string
    caratulado?: string
    procedimiento?: string
    materia?: string
    fecha_envio?: string
  }
}

export interface NormalizerStats {
  originalLength: number
  cleanLength: number
  reductionPercent: number
  artifactsDetected: number
  artifactsRemoved: number
  encodingFixes: number
  pageBoundariesDetected: number
  mode: NormalizerMode
  extractionMethod: ExtractionMethod
}

export interface NormalizerResult {
  cleanText: string
  extractedMetadata: NormalizerMetadata
  artifacts: ExtractedArtifact[]
  stats: NormalizerStats
}

export interface NormalizerDryRunResult {
  annotatedText: string
  detectedArtifacts: ExtractedArtifact[]
  extractedMetadata: NormalizerMetadata
  stats: NormalizerStats
}

// ─────────────────────────────────────────────────────────────
// Regex patterns (basados en fixtures reales PJUD)
// ─────────────────────────────────────────────────────────────

/**
 * Firma electrónica PJUD: `Código: XXXX ...verificadoc.pjud.cl`
 * Variantes de prefijo: "Código:", "Cvc", "SEC Código:"
 * Código: 5-20 caracteres alfanuméricos.
 * Sufijo opcional: "o en la tramitación de la causa."
 */
const RE_FIRMA_PJUD =
  /(?:(?:SEC\s+)?C[óo]digo|Cvc)\s*:?\s*[A-Z0-9]{5,20}\s+Este documento tiene firma electr[óo]nica y su original puede ser validado en\s+h\s*t\s*t\s*p\s*s?\s*:\s*\/\s*\/\s*v\s*e\s*r\s*i\s*f\s*i\s*c\s*a\s*d\s*o\s*c\s*\.\s*p\s*j\s*u\s*d\s*\.\s*c\s*l(?:\s+o\s+en\s+la\s+tramitaci[óo]n\s+de\s+la\s+causa\.?)?/gi

/**
 * Marcador de página: `-- N of M --`
 * Captura N y M para extraer total_pages y detectar boundaries.
 */
const RE_PAGE_MARKER = /--\s*(\d{1,4})\s+of\s+(\d{1,4})\s*--/g

/**
 * Marcador de página variante OCR: `-N-` (solo dígitos entre guiones)
 * Más conservador: solo matchea si está rodeado de whitespace.
 */
const RE_PAGE_MARKER_OCR = /(?<=\s)-(\d{1,3})-(?=\s)/g

/**
 * ROL + Foja repetido por página (aparece después del page marker).
 * Patrón: `C-NNNNN-YYYY Foja: N`
 */
const RE_ROL_FOJA_REPETIDO = /[CEV]-\d{1,6}-\d{4}\s+Foja:\s*\d+/g

/**
 * Header NOMENCLATURA (con o sin FOJA previa).
 * Estructura:
 *   [FOJA: NN .- texto .-]
 *   NOMENCLATURA : N. [código]descripción [N. [código]descripción...]
 *   JUZGADO : nombre tribunal [º]
 *   CAUSA ROL : C-NNNNN-YYYY
 *   CARATULADO : NOMBRES EN MAYÚSCULAS
 *
 * El caratulado siempre está en MAYÚSCULAS (nombres de partes). El contenido
 * legal que sigue comienza con un nombre de ciudad en mixed-case seguido de
 * coma (ej: "Santiago, doce de..." / "Illapel, veintiuno de...").
 * Usamos este patrón como delimitador confiable para evitar comer texto legal.
 */
const RE_HEADER_NOMENCLATURA =
  /(?:FOJA:\s*\d+\s*\.-[^.]*?\.-\s*)?NOMENCLATURA\s*:\s*(?:\d+\.\s*\[\d+\][^\[]*?)+\s*JUZGADO\s*:\s*.*?CAUSA\s+ROL\s*:\s*[CEV]-\d{1,6}-\d{4}\s+CARATULADO\s*:\s*[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s.\/()&0-9-]*(?=\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+,)/gi

/**
 * Disclaimer horario Chile (horaoficial.cl).
 * Bloque de boilerplate que aparece en certificados.
 */
const RE_DISCLAIMER_HORARIO =
  /A contar del \d{2} de (?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre) de \d{4},\s*la hora visualizada corresponde al horario de invierno establecido en Chile Continental\..*?(?:Para m[áa]s informaci[óo]n consulte\s*)?https?:\/\/www\.horaoficial\.cl/gis

/**
 * Firma electrónica e-signer (servicio privado).
 * Patrón: `Código: NNNNN validar en https://www.esigner.cl/...`
 */
const RE_FIRMA_ESIGNER =
  /C[óo]digo:\s*\d{10,20}\s+validar en https?:\/\/www\.esigner\.cl\/\S+/gi

/**
 * Firma digital OCR garbled (de sellos digitales escaneados).
 * Detecta el patrón "Firmado digitalmente" seguido de nombre fragmentado y fecha.
 */
const RE_FIRMA_DIGITAL_OCR =
  /[A-ZÁÉÍÓÚÑ]+\s+Firmado\s+digitalmente\s+[A-ZÁÉÍÓÚÑ]+\s+por\s+[A-ZÁÉÍÓÚÑ\s]+\s*Fecha:\s*\d{4}\.\d{2}\.\d{2}\s*[A-ZÁÉÍÓÚÑ]+\s+\d{2}:\d{2}:\d{2}\s*-\d{2}'\d{2}'/gi

/**
 * Watermark de scanner ("Scanned with AnyScanner" y similares).
 */
const RE_WATERMARK_SCANNER = /Scanned with \w+/gi

/**
 * Número de página suelto inmediatamente después de page marker.
 * Patrón: `-- N of M -- [dígito(s)] [texto]`
 * Solo remueve el número suelto, no el texto que sigue.
 */
const RE_PAGE_NUMBER_AFTER_MARKER = /(?<=--\s*\d{1,4}\s+of\s+\d{1,4}\s*--\s*)\d{1,3}(?=\s+[A-ZÁÉÍÓÚÑ])/g

// ─────────────────────────────────────────────────────────────
// Encoding fix: caracteres acentuados separados (pdf-parse)
// ─────────────────────────────────────────────────────────────

/**
 * Caracteres acentuados aislados (rodeados de espacios).
 * En pdf-parse, los acentos se extraen como glifos separados:
 *   "presentaci n de Miner a y ó í Construcciones"
 * Paso 1: remover los acentos flotantes.
 */
const RE_FLOATING_ACCENT = /\s+[óáéíúñÓÁÉÍÚÑ]\s+(?=[A-Za-záéíóúñÁÉÍÓÚÑ])/g

/**
 * Correcciones conocidas del español jurídico donde pdf-parse
 * produce un espacio en lugar del carácter acentuado.
 *
 * Organizadas por sufijo afectado. Se aplican con word boundary
 * para evitar falsos positivos.
 *
 * Fuente: patrones observados en fixtures 01, 06, 10.
 */
const ENCODING_CORRECTIONS: Array<{ pattern: RegExp; replacement: string }> = [
  // -ción (ó separada): presentaci n → presentación
  // Sin \b inicial: el sufijo aparece al final de una palabra más larga
  { pattern: /ci n\b/g, replacement: 'ción' },
  // -sión: presi n → presión, versi n → versión
  { pattern: /si n\b/g, replacement: 'sión' },
  // -ó- in common words: C digo → Código (very frequent in legal text)
  { pattern: /\bC digo/g, replacement: 'Código' },
  { pattern: /\bc digo/g, replacement: 'código' },
  // -ñ- patterns: se ala → señala, a o → año, do a → doña
  { pattern: /\bse ala/g, replacement: 'señala' },
  { pattern: /\bSe ala/g, replacement: 'Señala' },
  { pattern: /\bse al\b/g, replacement: 'señal' },
  { pattern: /(?<=\s)a o(?=\s)/g, replacement: 'año' },
  { pattern: /\bdo a\b/g, replacement: 'doña' },
  { pattern: /\bDo a\b/g, replacement: 'Doña' },
  { pattern: /\bda o/g, replacement: 'daño' },
  { pattern: /\bDa o/g, replacement: 'Daño' },
  { pattern: /\bdue o/g, replacement: 'dueño' },
  { pattern: /\bni o/g, replacement: 'niño' },
  { pattern: /\bcompa /g, replacement: 'compaña' },  // acompaña, acompañó
  { pattern: /\brese ado/g, replacement: 'reseñado' },
  { pattern: /\borse ado/g, replacement: 'orseñado' },
  { pattern: /\bCama o/g, replacement: 'Camaño' },
  { pattern: /\bMu oz/g, replacement: 'Muñoz' },
  { pattern: /\bNu ez/g, replacement: 'Nuñez' },
  { pattern: /\bIba ez/g, replacement: 'Ibañez' },
  { pattern: /\bOrdo ez/g, replacement: 'Ordoñez' },
  { pattern: /\bYa ez/g, replacement: 'Yañez' },
  { pattern: /\bZu iga/g, replacement: 'Zuñiga' },
  { pattern: /\bpe a\b/g, replacement: 'peña' },
  { pattern: /\bPe a\b/g, replacement: 'Peña' },
  // -ía patterns: Miner a → Minería
  { pattern: /\bMiner a\b/g, replacement: 'Minería' },
  { pattern: /\bminer a\b/g, replacement: 'minería' },
  { pattern: /\bpolicí a\b/g, replacement: 'policía' },
  // -á- patterns: m quina → máquina, m s → más, cl usula → cláusula
  { pattern: /\bm quina/g, replacement: 'máquina' },
  { pattern: /\bM quina/g, replacement: 'Máquina' },
  { pattern: /\btelem tico/g, replacement: 'telemático' },
  { pattern: /\btelem tica/g, replacement: 'telemática' },
  { pattern: /\bcl usula/g, replacement: 'cláusula' },
  { pattern: /\bCl usula/g, replacement: 'Cláusula' },
  { pattern: /\bpr ctic/g, replacement: 'práctic' },
  { pattern: /(?<=\s)m s(?=\s)/g, replacement: 'más' },
  { pattern: /\bdem s\b/g, replacement: 'demás' },
  { pattern: /\bpag r /g, replacement: 'pagar' },  // for "pagará"
  // -é- patterns: c dula → cédula, m rito → mérito, t rmino → término
  { pattern: /\bc dula/g, replacement: 'cédula' },
  { pattern: /\bC dula/g, replacement: 'Cédula' },
  { pattern: /\bm rito/g, replacement: 'mérito' },
  { pattern: /\bt rmino/g, replacement: 'término' },
  { pattern: /\bT rmino/g, replacement: 'Término' },
  { pattern: /\btrav s\b/g, replacement: 'través' },
  { pattern: /\bAndr s\b/g, replacement: 'Andrés' },
  { pattern: /\bP rez\b/g, replacement: 'Pérez' },
  { pattern: /\bGuti rrez\b/g, replacement: 'Gutiérrez' },
  { pattern: /\bJim nez\b/g, replacement: 'Jiménez' },
  { pattern: /\bRam rez\b/g, replacement: 'Ramírez' },
  { pattern: /\bFern ndez\b/g, replacement: 'Fernández' },
  { pattern: /\bHern ndez\b/g, replacement: 'Hernández' },
  { pattern: /\bGonz lez\b/g, replacement: 'González' },
  { pattern: /\bRodr guez\b/g, replacement: 'Rodríguez' },
  { pattern: /\bL pez\b/g, replacement: 'López' },
  { pattern: /\bMart nez\b/g, replacement: 'Martínez' },
  // -í- patterns: d a → día, art culo → artículo, jur dico → jurídico
  { pattern: /(?<=\s)d a(?=\s)/g, replacement: 'día' },
  { pattern: /\bd as\b/g, replacement: 'días' },
  { pattern: /\bart culo/g, replacement: 'artículo' },
  { pattern: /\bArt culo/g, replacement: 'Artículo' },
  { pattern: /\bart culos/g, replacement: 'artículos' },
  { pattern: /\bArt culos/g, replacement: 'Artículos' },
  { pattern: /\bjur dico/g, replacement: 'jurídico' },
  { pattern: /\bjur dica/g, replacement: 'jurídica' },
  { pattern: /\bs ntesis/g, replacement: 'síntesis' },
  { pattern: /\bt tulo/g, replacement: 'título' },
  { pattern: /\bT tulo/g, replacement: 'Título' },
  { pattern: /\bper odo/g, replacement: 'período' },
  { pattern: /\bPer odo/g, replacement: 'Período' },
  { pattern: /\bRoc o\b/g, replacement: 'Rocío' },
  // -ú- patterns: gr as → grúas, ltimo → último, n mero → número
  { pattern: /\bgr as\b/g, replacement: 'grúas' },
  { pattern: /\bltimo/g, replacement: 'último' },
  { pattern: /\bn mero/g, replacement: 'número' },
  { pattern: /\bN mero/g, replacement: 'Número' },
  { pattern: /\bp blico/g, replacement: 'público' },
  { pattern: /\bP blico/g, replacement: 'Público' },
  { pattern: /\bp blica/g, replacement: 'pública' },
  { pattern: /\bP blica/g, replacement: 'Pública' },
  // -ó- patterns: resolución already covered by ci n → ción
  // Broader: electr nico → electrónico, vig simo → vigésimo
  { pattern: /\belectr nico/g, replacement: 'electrónico' },
  { pattern: /\belectr nica/g, replacement: 'electrónica' },
  // Ordinal numbers in legal text (mixed case + ALL CAPS)
  { pattern: /\bD cimo\b/g, replacement: 'Décimo' },
  { pattern: /\bd cimo\b/g, replacement: 'décimo' },
  { pattern: /\bD CIMO\b/g, replacement: 'DÉCIMO' },
  { pattern: /\bvig simo/g, replacement: 'vigésimo' },
  { pattern: /\bVIG SIMO/g, replacement: 'VIGÉSIMO' },
  { pattern: /\bS ptimo\b/g, replacement: 'Séptimo' },
  { pattern: /\bs ptimo\b/g, replacement: 'séptimo' },
  { pattern: /\bS PTIMO\b/g, replacement: 'SÉPTIMO' },
  { pattern: /\bUnd cimo/g, replacement: 'Undécimo' },
  { pattern: /\bUND CIMO/g, replacement: 'UNDÉCIMO' },
  { pattern: /\bDuod cimo/g, replacement: 'Duodécimo' },
  { pattern: /\bDUOD CIMO/g, replacement: 'DUODÉCIMO' },
  // Common verbs and legal formulas
  { pattern: /\bconcedi \b/g, replacement: 'concedió' },
  { pattern: /\brecibi \b/g, replacement: 'recibió' },
  // Cierre sentencia: Reg strese → Regístrese
  { pattern: /\bReg strese/g, replacement: 'Regístrese' },
  { pattern: /\breg strese/g, replacement: 'regístrese' },
  { pattern: /\bnotif quese/g, replacement: 'notifíquese' },
  { pattern: /\barch vese/g, replacement: 'archívese' },
  // Generic trailing ó: resolvi, cont, etc. — too risky for generic regex

  // Numbers written out (encoding issues in dates):
  // "veintis is" → veintiséis, "veintitr s" → veintitrés
  { pattern: /\bveintis is\b/g, replacement: 'veintiséis' },
  { pattern: /\bVeintis is\b/g, replacement: 'Veintiséis' },
  { pattern: /\bveintitr s\b/g, replacement: 'veintitrés' },
  { pattern: /\bVeintitr s\b/g, replacement: 'Veintitrés' },
  { pattern: /\bveintid s\b/g, replacement: 'veintitrés' },
  { pattern: /\bVeintid s\b/g, replacement: 'Veintitrés' },
  { pattern: /\bhabi ndose\b/g, replacement: 'habiéndose' },
  { pattern: /\bEst ndose\b/g, replacement: 'Estándose' },
]

// ─────────────────────────────────────────────────────────────
// Step functions (funciones puras, sin I/O)
// ─────────────────────────────────────────────────────────────

function detectPageBoundaries(text: string): number[] {
  const boundaries: number[] = [0]
  const combined = new RegExp(
    // Full PJUD page break: firma + page marker + optional ROL
    `(?:${RE_FIRMA_PJUD.source}\\s*)?${RE_PAGE_MARKER.source}(?:\\s*${RE_ROL_FOJA_REPETIDO.source})?`,
    'gi'
  )
  let match: RegExpExecArray | null
  while ((match = combined.exec(text)) !== null) {
    const boundaryOffset = match.index + match[0].length
    if (boundaryOffset < text.length) {
      boundaries.push(boundaryOffset)
    }
  }
  return boundaries
}

function extractAndRemoveFirmaPjud(
  text: string,
  artifacts: ExtractedArtifact[],
  metadata: NormalizerMetadata
): string {
  const codigos: string[] = []
  const result = text.replace(RE_FIRMA_PJUD, (match, ...args) => {
    const offset = args[args.length - 2] as number
    const codigoMatch = match.match(/[A-Z0-9]{5,20}/)
    if (codigoMatch) codigos.push(codigoMatch[0])
    artifacts.push({
      type: 'firma_pjud',
      offset,
      length: match.length,
      rawText: match,
      extractedData: { codigo: codigoMatch?.[0] },
    })
    return ''
  })
  if (codigos.length > 0) metadata.firma_pjud_codigos = codigos
  return result
}

function extractAndRemovePageMarkers(
  text: string,
  artifacts: ExtractedArtifact[],
  metadata: NormalizerMetadata
): string {
  let maxPage = 0
  let result = text.replace(RE_PAGE_MARKER, (match, _n: string, m: string, offset: number) => {
    const total = parseInt(m, 10)
    if (total > maxPage) maxPage = total
    artifacts.push({
      type: 'page_marker',
      offset,
      length: match.length,
      rawText: match,
      extractedData: { page: parseInt(_n, 10), total },
    })
    return ''
  })
  result = result.replace(RE_PAGE_MARKER_OCR, (match, _n: string, offset: number) => {
    artifacts.push({
      type: 'page_marker',
      offset,
      length: match.length,
      rawText: match,
      extractedData: { page: parseInt(_n, 10) },
    })
    return ''
  })
  if (maxPage > 0) metadata.total_pages = maxPage
  return result
}

function removeRolFojaRepetido(
  text: string,
  artifacts: ExtractedArtifact[]
): string {
  return text.replace(RE_ROL_FOJA_REPETIDO, (match, offset: number) => {
    artifacts.push({
      type: 'foja_repetida',
      offset,
      length: match.length,
      rawText: match,
    })
    return ''
  })
}

function extractAndRemoveHeaderNomenclatura(
  text: string,
  artifacts: ExtractedArtifact[],
  metadata: NormalizerMetadata
): string {
  let isFirst = true
  return text.replace(RE_HEADER_NOMENCLATURA, (match, ...args) => {
    const offset = args[args.length - 2] as number

    if (isFirst) {
      isFirst = false
      const fojaMatch = match.match(/FOJA:\s*(\d+)\s*\.-\s*([^.]*)\.-/)
      if (fojaMatch) {
        metadata.foja = parseInt(fojaMatch[1], 10)
        metadata.foja_texto = fojaMatch[2].trim() || undefined
      }

      const nomMatches = [...match.matchAll(/\[(\d+)\]([^\[]*?)(?=\d+\.\s*\[|\s*JUZGADO)/g)]
      if (nomMatches.length > 0) {
        metadata.nomenclaturas = nomMatches.map((m) => ({
          codigo: parseInt(m[1], 10),
          descripcion: m[2].trim(),
        }))
      }

      const juzgadoMatch = match.match(/JUZGADO\s*:\s*(.*?)(?:\s*º)?\s*CAUSA/i)
      if (juzgadoMatch) {
        let juzgado = juzgadoMatch[1].trim()
        if (juzgado.match(/^\d+\s/) && !juzgado.includes('º')) {
          juzgado = juzgado.replace(/^(\d+)\s/, '$1º ')
        }
        metadata.juzgado = juzgado
      }

      const rolMatch = match.match(/CAUSA\s+ROL\s*:\s*([CEV]-\d{1,6}-\d{4})/i)
      if (rolMatch) metadata.rol = rolMatch[1]

      const caratMatch = match.match(/CARATULADO\s*:\s*(.*?)$/im)
      if (caratMatch) metadata.caratulado = caratMatch[1].trim()
    }

    artifacts.push({
      type: 'header_nomenclatura',
      offset,
      length: match.length,
      rawText: match,
    })
    return ''
  })
}

function removeDisclaimerHorario(
  text: string,
  artifacts: ExtractedArtifact[]
): string {
  return text.replace(RE_DISCLAIMER_HORARIO, (match, offset: number) => {
    artifacts.push({
      type: 'disclaimer_horario',
      offset,
      length: match.length,
      rawText: match,
    })
    return ''
  })
}

function removeBoilerplate(
  text: string,
  artifacts: ExtractedArtifact[]
): string {
  let result = text

  result = result.replace(RE_FIRMA_ESIGNER, (match, offset: number) => {
    const codigoMatch = match.match(/\d{10,20}/)
    artifacts.push({
      type: 'firma_esigner',
      offset,
      length: match.length,
      rawText: match,
      extractedData: { codigo: codigoMatch?.[0] },
    })
    return ''
  })

  result = result.replace(RE_FIRMA_DIGITAL_OCR, (match, offset: number) => {
    const fechaMatch = match.match(/Fecha:\s*(\d{4}\.\d{2}\.\d{2})/)
    artifacts.push({
      type: 'firma_digital_ocr',
      offset,
      length: match.length,
      rawText: match,
      extractedData: { fecha: fechaMatch?.[1] },
    })
    return ''
  })

  result = result.replace(RE_WATERMARK_SCANNER, (match, offset: number) => {
    artifacts.push({
      type: 'watermark_scanner',
      offset,
      length: match.length,
      rawText: match,
    })
    return ''
  })

  return result
}

function removeLoosePageNumbers(
  text: string,
  artifacts: ExtractedArtifact[]
): string {
  return text.replace(RE_PAGE_NUMBER_AFTER_MARKER, (match, offset: number) => {
    artifacts.push({
      type: 'page_number_loose',
      offset,
      length: match.length,
      rawText: match,
    })
    return ''
  })
}

/**
 * Ley 20.886: Extrae metadata estructurada del Certificado de Envío OJV.
 * Este es un documento completo (no un artefacto dentro de otro doc).
 * El texto se preserva intacto; solo se extrae metadata para enriquecimiento.
 */
function extractCertificadoEnvioMetadata(
  text: string,
  metadata: NormalizerMetadata
): void {
  if (!text.includes('OFICINA JUDICIAL VIRTUAL') || !text.includes('CERTIFICADO DE ENV')) return

  const juzgado = text.match(/Juzgado:\s*(.+?)(?:\s+N[°º]|\s+$)/im)
  const rol = text.match(/N[°º]\s*Rol\/Rit:\s*([^\s]+)/i)
  const ruc = text.match(/Ruc:\s*([^\s]+)/i)
  const caratulado = text.match(/Caratulado:\s*(.+?)(?:\s+Procedimiento|\s+$)/im)
  const procedimiento = text.match(/Procedimiento:\s*(.+?)(?:\s+Materia|\s+$)/im)
  const materia = text.match(/Materia\(s\):\s*(.+?)(?:\s+Fecha|\s+$)/im)
  const fechaEnvio = text.match(/Fecha\s+Env[ií]o\s*:\s*(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})/i)

  metadata.certificado_envio = {
    juzgado: juzgado?.[1]?.trim(),
    rol: rol?.[1]?.trim(),
    ruc: ruc?.[1]?.trim(),
    caratulado: caratulado?.[1]?.trim(),
    procedimiento: procedimiento?.[1]?.trim(),
    materia: materia?.[1]?.trim(),
    fecha_envio: fechaEnvio?.[1]?.trim(),
  }
}

function fixBrokenEncoding(text: string, aggressive = true): { text: string; fixes: number } {
  let fixes = 0
  let result = text

  // Remoción de acentos flotantes aislados: siempre se aplica porque
  // los caracteres flotantes son inequívocos (un ó/á/é/í/ú/ñ suelto
  // entre espacios NO es texto legal válido en español).
  result = result.replace(RE_FLOATING_ACCENT, () => {
    fixes++
    return ' '
  })

  for (const { pattern, replacement } of ENCODING_CORRECTIONS) {
    const before = result
    result = result.replace(pattern, replacement)
    if (result !== before) {
      const diff = (before.match(pattern) || []).length
      fixes += diff
    }
  }

  return { text: result, fixes }
}

/**
 * Colapsa whitespace excesivo preservando separadores de párrafo.
 * - 3+ newlines → 2 newlines (preserva separación de párrafos)
 * - Múltiples espacios horizontales → 1 espacio
 * - Trim de líneas individuales
 */
function collapseWhitespace(text: string): string {
  return text
    .replace(/[^\S\n]+/g, ' ')       // múltiples espacios → 1 (preserva \n)
    .replace(/ *\n */g, '\n')          // trim cada línea
    .replace(/\n{3,}/g, '\n\n')        // 3+ newlines → 2 (separador párrafo)
    .trim()
}

// ─────────────────────────────────────────────────────────────
// Función principal
// ─────────────────────────────────────────────────────────────

export function normalizePjudText(
  rawText: string,
  options: NormalizerOptions
): NormalizerResult | NormalizerDryRunResult {
  const { dryRun = false, extractionMethod, mode = 'conservative' } = options
  const isOcr = extractionMethod === 'document-ai'
  const isAggressive = mode === 'aggressive'
  const artifacts: ExtractedArtifact[] = []
  const metadata: NormalizerMetadata = { pageBoundaries: [] }

  if (!rawText || rawText.trim().length === 0) {
    const emptyStats: NormalizerStats = {
      originalLength: rawText?.length ?? 0,
      cleanLength: 0,
      reductionPercent: 0,
      artifactsDetected: 0,
      artifactsRemoved: 0,
      encodingFixes: 0,
      pageBoundariesDetected: 0,
      mode,
      extractionMethod,
    }
    if (dryRun) {
      return { annotatedText: '', detectedArtifacts: [], extractedMetadata: metadata, stats: emptyStats }
    }
    return { cleanText: '', extractedMetadata: metadata, artifacts: [], stats: emptyStats }
  }

  // Paso 0: detectar page boundaries ANTES de modificar el texto
  metadata.pageBoundaries = detectPageBoundaries(rawText)

  // Paso 0b: Ley 20.886 — extraer metadata del Certificado de Envío OJV (si aplica)
  extractCertificadoEnvioMetadata(rawText, metadata)

  if (dryRun) {
    // En dry-run, detectamos artefactos sin modificar el texto.
    // Ejecutamos las mismas funciones sobre una copia para recoger artifacts.
    let tempText = rawText
    tempText = extractAndRemoveFirmaPjud(tempText, artifacts, metadata)
    tempText = extractAndRemovePageMarkers(tempText, artifacts, metadata)
    tempText = removeRolFojaRepetido(tempText, artifacts)
    tempText = extractAndRemoveHeaderNomenclatura(tempText, artifacts, metadata)
    tempText = removeDisclaimerHorario(tempText, artifacts)
    tempText = removeBoilerplate(tempText, artifacts)
    tempText = removeLoosePageNumbers(tempText, artifacts)
    const { fixes } = fixBrokenEncoding(tempText, isAggressive)

    let annotatedText = rawText
    const sortedArtifacts = [...artifacts].sort((a, b) => b.offset - a.offset)
    for (const art of sortedArtifacts) {
      const before = annotatedText.slice(0, art.offset)
      const content = annotatedText.slice(art.offset, art.offset + art.length)
      const after = annotatedText.slice(art.offset + art.length)
      annotatedText = `${before}««${art.type}»»${content}««/${art.type}»»${after}`
    }

    return {
      annotatedText,
      detectedArtifacts: artifacts,
      extractedMetadata: metadata,
      stats: {
        originalLength: rawText.length,
        cleanLength: tempText.length,
        reductionPercent: Math.round((1 - tempText.length / rawText.length) * 100),
        artifactsDetected: artifacts.length,
        artifactsRemoved: artifacts.length,
        encodingFixes: fixes,
        pageBoundariesDetected: metadata.pageBoundaries.length,
        mode,
        extractionMethod,
      },
    }
  }

  // Pipeline de limpieza (orden importa)
  let text = rawText

  // ── Pasos comunes (ambos métodos, ambos modos) ─────────────

  // 1. Firma electrónica PJUD (antes de page markers para no fragmentar la secuencia)
  text = extractAndRemoveFirmaPjud(text, artifacts, metadata)

  // 2. Page markers (registrar boundaries ya hecho en paso 0)
  text = extractAndRemovePageMarkers(text, artifacts, metadata)

  // 3. ROL + Foja repetido por página
  text = removeRolFojaRepetido(text, artifacts)

  // 4. Header NOMENCLATURA (extraer metadata del primero, remover todos)
  text = extractAndRemoveHeaderNomenclatura(text, artifacts, metadata)

  // 5. Disclaimer horario Chile
  text = removeDisclaimerHorario(text, artifacts)

  // ── Pasos condicionales por método de extracción ───────────

  // 6a. Firma e-signer: aparece en ambos métodos
  text = removeBoilerplate(text, artifacts)

  // 6b. Watermarks y firma digital OCR: solo relevante en document-ai
  //     En modo conservative + pdf-parse, no arriesgamos falsos positivos
  //     con patrones OCR en texto nativo.
  //     (removeBoilerplate ya incluye watermarks y firma_digital_ocr,
  //     pero los regex solo matchean contenido real de OCR — safe para ambos)

  // 7. Números de página sueltos
  text = removeLoosePageNumbers(text, artifacts)

  // 8. Corrección de encoding roto
  //    Aplica a AMBOS métodos (hallazgo 9.1: pdf-parse también produce encoding roto)
  //    En mode=conservative se aplican solo las correcciones del diccionario (alta confianza)
  //    En mode=aggressive se aplica también remoción de acentos flotantes aislados
  const { text: encodingFixed, fixes: encodingFixes } = fixBrokenEncoding(text, isAggressive)
  text = encodingFixed

  // 9. Colapsar whitespace preservando párrafos semánticos
  text = collapseWhitespace(text)

  return {
    cleanText: text,
    extractedMetadata: metadata,
    artifacts,
    stats: {
      originalLength: rawText.length,
      cleanLength: text.length,
      reductionPercent: Math.round((1 - text.length / rawText.length) * 100),
      artifactsDetected: artifacts.length,
      artifactsRemoved: artifacts.length,
      encodingFixes,
      pageBoundariesDetected: metadata.pageBoundaries.length,
      mode,
      extractionMethod,
    },
  }
}
