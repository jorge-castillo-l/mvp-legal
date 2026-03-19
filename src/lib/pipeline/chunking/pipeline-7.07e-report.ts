/**
 * ============================================================
 * 7.07e — Pipeline Completo: Reporte de Métricas sobre 24 Fixtures
 * ============================================================
 * Ejecuta normalizer → section-detector → token-chunker → metadata-enricher
 * sobre TODOS los fixtures reales de PJUD y genera reporte formal.
 *
 * Ejecutar con: npx tsx src/lib/pipeline/chunking/pipeline-7.07e-report.ts
 * ============================================================
 */
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { normalizePjudText, type NormalizerResult } from './normalizer'
import { detectSections, type SectionDetectorResult } from './section-detector'
import { chunkText, type ChunkerResult } from './token-chunker'
import {
  enrichChunkMetadata,
  buildEmbeddingInput,
  buildCitationLabel,
  type DocumentParentMetadata,
  type CaseMetadata,
} from './metadata-enricher'

const FIXTURES_DIR = join(process.cwd(), 'docs', 'fixtures', 'normalizer')

interface FixtureResult {
  filename: string
  method: 'pdf-parse' | 'document-ai'
  normalizer: {
    originalChars: number
    cleanChars: number
    reductionPercent: number
    artifactsRemoved: number
    encodingFixes: number
    pageBoundaries: number
  }
  sectionDetector: {
    documentStructure: string
    sectionsDetected: number
    highConfidence: number
    sectionTypes: string[]
  }
  chunker: {
    totalChunks: number
    avgTokens: number
    minTokens: number
    maxTokens: number
    shortDoc: boolean
  }
  enricher: {
    chunksWithSectionType: number
    sampleEmbeddingPrefix: string
    sampleCitation: string
  }
  issues: string[]
}

function runFullPipeline(filename: string): FixtureResult {
  const raw = readFileSync(join(FIXTURES_DIR, filename), 'utf-8')
  const method = filename.includes('ocr') || filename.includes('art464') ? 'document-ai' as const : 'pdf-parse' as const
  const issues: string[] = []

  // 1. Normalizer
  const normalized = normalizePjudText(raw, { extractionMethod: method }) as NormalizerResult

  if (normalized.cleanText.length === 0) {
    issues.push('CRÍTICO: normalizer produjo texto vacío')
  }
  if (normalized.stats.reductionPercent > 50) {
    issues.push(`ADVERTENCIA: reducción excesiva ${normalized.stats.reductionPercent}% — posible pérdida de contenido`)
  }

  // 2. Section Detector
  const sections = detectSections(normalized.cleanText)

  if (sections.documentStructure === 'indeterminado' && normalized.cleanText.length > 500) {
    issues.push('Estructura indeterminada en documento largo')
  }

  // 3. Token Chunker
  const chunked = chunkText(normalized.cleanText, {
    normalizerMetadata: normalized.extractedMetadata,
    detectedSections: sections.sections,
  })

  if (chunked.chunks.length === 0 && normalized.cleanText.length > 0) {
    issues.push('CRÍTICO: chunker no produjo chunks')
  }

  for (const chunk of chunked.chunks) {
    if (chunk.tokenEstimate > 1500) {
      issues.push(`Chunk ${chunk.chunkIndex} excede 1500 tokens (${chunk.tokenEstimate})`)
    }
    if (chunk.chunkText.trim().length === 0) {
      issues.push(`Chunk ${chunk.chunkIndex} está vacío`)
    }
  }

  // 4. Metadata Enricher
  const parentMeta: DocumentParentMetadata = { document_type: 'folio' }
  const caseMeta: CaseMetadata = {}
  const enrichedFirst = chunked.chunks.length > 0
    ? enrichChunkMetadata(chunked.chunks[0], { parentMetadata: parentMeta, caseMetadata: caseMeta })
    : null
  const embeddingInput = chunked.chunks.length > 0 && enrichedFirst
    ? buildEmbeddingInput(chunked.chunks[0], enrichedFirst)
    : ''
  const citation = enrichedFirst ? buildCitationLabel(enrichedFirst) : ''

  const chunksWithSection = chunked.chunks.filter(c => c.sectionType !== 'general').length

  const bracket = embeddingInput.indexOf(']')
  const prefix = bracket > 0 ? embeddingInput.slice(0, bracket + 1) : '(sin prefijo)'

  return {
    filename,
    method,
    normalizer: {
      originalChars: raw.length,
      cleanChars: normalized.cleanText.length,
      reductionPercent: normalized.stats.reductionPercent,
      artifactsRemoved: normalized.stats.artifactsRemoved,
      encodingFixes: normalized.stats.encodingFixes,
      pageBoundaries: normalized.stats.pageBoundariesDetected,
    },
    sectionDetector: {
      documentStructure: sections.documentStructure,
      sectionsDetected: sections.stats.sectionsDetected,
      highConfidence: sections.stats.highConfidence,
      sectionTypes: [...new Set(sections.sections.map(s => s.type))],
    },
    chunker: {
      totalChunks: chunked.stats.totalChunks,
      avgTokens: chunked.stats.avgChunkTokens,
      minTokens: chunked.stats.minChunkTokens,
      maxTokens: chunked.stats.maxChunkTokens,
      shortDoc: chunked.stats.shortDocSingleChunk,
    },
    enricher: {
      chunksWithSectionType: chunksWithSection,
      sampleEmbeddingPrefix: prefix,
      sampleCitation: citation,
    },
    issues,
  }
}

// ─────────────────────────────────────────────────────────────
// MAIN: Run pipeline on all fixtures
// ─────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(80))
console.log('  7.07e — REPORTE DE MÉTRICAS: Pipeline Completo sobre 24 Fixtures PJUD')
console.log('='.repeat(80) + '\n')

const allFiles = readdirSync(FIXTURES_DIR)
  .filter(f => f.endsWith('.txt'))
  .sort()

const results: FixtureResult[] = []
let totalIssues = 0

for (const file of allFiles) {
  const result = runFullPipeline(file)
  results.push(result)
  totalIssues += result.issues.length
}

// ─── Tabla 1: Normalizer ────────────────────────────────────
console.log('┌─────────────────────────────────────────────────────────────────────────────┐')
console.log('│  NORMALIZER (7.07a) — Limpieza de artefactos PJUD                          │')
console.log('├────────────────────────────────────┬────────┬────────┬──────┬───────┬───────┤')
console.log('│ Fixture                            │Original│ Limpio │ Red% │Artef. │Encod. │')
console.log('├────────────────────────────────────┼────────┼────────┼──────┼───────┼───────┤')
for (const r of results) {
  const name = r.filename.replace('.txt', '').slice(0, 36)
  console.log(
    `│ ${name.padEnd(35)}│${String(r.normalizer.originalChars).padStart(7)} │${String(r.normalizer.cleanChars).padStart(7)} │${String(r.normalizer.reductionPercent + '%').padStart(5)} │${String(r.normalizer.artifactsRemoved).padStart(6)} │${String(r.normalizer.encodingFixes).padStart(6)} │`
  )
}
console.log('└────────────────────────────────────┴────────┴────────┴──────┴───────┴───────┘')

// ─── Tabla 2: Section Detector ──────────────────────────────
console.log('\n┌─────────────────────────────────────────────────────────────────────────────┐')
console.log('│  SECTION DETECTOR (7.07c) — Detección de secciones legales                 │')
console.log('├────────────────────────────────────┬──────────────────┬──────┬──────┬───────┤')
console.log('│ Fixture                            │ Estructura       │ Secs │ Alta │Tipos  │')
console.log('├────────────────────────────────────┼──────────────────┼──────┼──────┼───────┤')
for (const r of results) {
  const name = r.filename.replace('.txt', '').slice(0, 36)
  console.log(
    `│ ${name.padEnd(35)}│ ${r.sectionDetector.documentStructure.padEnd(17)}│${String(r.sectionDetector.sectionsDetected).padStart(5)} │${String(r.sectionDetector.highConfidence).padStart(5)} │${String(r.sectionDetector.sectionTypes.length).padStart(6)} │`
  )
}
console.log('└────────────────────────────────────┴──────────────────┴──────┴──────┴───────┘')

// ─── Tabla 3: Chunker ───────────────────────────────────────
console.log('\n┌─────────────────────────────────────────────────────────────────────────────┐')
console.log('│  TOKEN CHUNKER (7.07b) — Fragmentación por tokens                          │')
console.log('├────────────────────────────────────┬───────┬───────┬───────┬───────┬────────┤')
console.log('│ Fixture                            │Chunks │  Avg  │  Min  │  Max  │ Short  │')
console.log('├────────────────────────────────────┼───────┼───────┼───────┼───────┼────────┤')
for (const r of results) {
  const name = r.filename.replace('.txt', '').slice(0, 36)
  console.log(
    `│ ${name.padEnd(35)}│${String(r.chunker.totalChunks).padStart(6)} │${String(r.chunker.avgTokens).padStart(6)} │${String(r.chunker.minTokens).padStart(6)} │${String(r.chunker.maxTokens).padStart(6)} │${(r.chunker.shortDoc ? '  sí  ' : '  no  ').padStart(7)} │`
  )
}
console.log('└────────────────────────────────────┴───────┴───────┴───────┴───────┴────────┘')

// ─── Tabla 4: Enricher + Embedding Input ────────────────────
console.log('\n┌─────────────────────────────────────────────────────────────────────────────┐')
console.log('│  METADATA ENRICHER (7.07d) — sectionType + Embedding Input                 │')
console.log('├────────────────────────────────────┬───────┬──────────────────────────────────┤')
console.log('│ Fixture                            │w/Type │ Embedding Prefix (chunk 0)      │')
console.log('├────────────────────────────────────┼───────┼──────────────────────────────────┤')
for (const r of results) {
  const name = r.filename.replace('.txt', '').slice(0, 36)
  const prefix = r.enricher.sampleEmbeddingPrefix.slice(0, 33)
  console.log(
    `│ ${name.padEnd(35)}│${String(r.enricher.chunksWithSectionType).padStart(6)} │ ${prefix.padEnd(33)}│`
  )
}
console.log('└────────────────────────────────────┴───────┴──────────────────────────────────┘')

// ─── Métricas agregadas ─────────────────────────────────────
console.log('\n' + '='.repeat(80))
console.log('  MÉTRICAS AGREGADAS')
console.log('='.repeat(80))

const totalFixtures = results.length
const totalChunks = results.reduce((sum, r) => sum + r.chunker.totalChunks, 0)
const fixturesWithChunks = results.filter(r => r.chunker.totalChunks > 0).length
const fixturesWithSections = results.filter(r => r.sectionDetector.sectionsDetected > 0).length
const fixturesIndeterminado = results.filter(r => r.sectionDetector.documentStructure === 'indeterminado').length
const shortDocs = results.filter(r => r.chunker.shortDoc).length
const avgReduction = Math.round(results.reduce((sum, r) => sum + r.normalizer.reductionPercent, 0) / totalFixtures)
const totalEncodingFixes = results.reduce((sum, r) => sum + r.normalizer.encodingFixes, 0)
const totalArtifacts = results.reduce((sum, r) => sum + r.normalizer.artifactsRemoved, 0)
const chunksWithSection = results.reduce((sum, r) => sum + r.enricher.chunksWithSectionType, 0)

const allTokens = results.flatMap(r => {
  const nr = normalizePjudText(
    readFileSync(join(FIXTURES_DIR, r.filename), 'utf-8'),
    { extractionMethod: r.method }
  ) as NormalizerResult
  const sr = detectSections(nr.cleanText)
  const cr = chunkText(nr.cleanText, { normalizerMetadata: nr.extractedMetadata, detectedSections: sr.sections })
  return cr.chunks.map(c => c.tokenEstimate)
})

const structureCounts: Record<string, number> = {}
for (const r of results) {
  structureCounts[r.sectionDetector.documentStructure] = (structureCounts[r.sectionDetector.documentStructure] || 0) + 1
}

console.log(`\n  Fixtures totales:               ${totalFixtures}`)
console.log(`  Fixtures con chunks:            ${fixturesWithChunks}/${totalFixtures} (${Math.round(fixturesWithChunks / totalFixtures * 100)}%)`)
console.log(`  Fixtures con secciones:         ${fixturesWithSections}/${totalFixtures} (${Math.round(fixturesWithSections / totalFixtures * 100)}%)`)
console.log(`  Fixtures indeterminados:        ${fixturesIndeterminado}`)
console.log(`  Documentos cortos (1 chunk):    ${shortDocs}`)
console.log(``)
console.log(`  Total chunks generados:         ${totalChunks}`)
console.log(`  Chunks con sectionType:         ${chunksWithSection}/${totalChunks} (${totalChunks > 0 ? Math.round(chunksWithSection / totalChunks * 100) : 0}%)`)
console.log(`  Promedio tokens/chunk:          ${allTokens.length > 0 ? Math.round(allTokens.reduce((a, b) => a + b, 0) / allTokens.length) : 0}`)
console.log(`  Rango tokens:                   ${allTokens.length > 0 ? Math.min(...allTokens) : 0} — ${allTokens.length > 0 ? Math.max(...allTokens) : 0}`)
console.log(``)
console.log(`  Artefactos removidos (total):   ${totalArtifacts}`)
console.log(`  Encoding fixes (total):         ${totalEncodingFixes}`)
console.log(`  Reducción promedio:             ${avgReduction}%`)
console.log(``)
console.log(`  Clasificación de estructura:`)
for (const [structure, count] of Object.entries(structureCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${structure.padEnd(25)} ${count} fixture(s)`)
}

// ─── Issues ─────────────────────────────────────────────────
console.log(`\n${'='.repeat(80)}`)
console.log(`  ISSUES DETECTADOS: ${totalIssues}`)
console.log('='.repeat(80))
if (totalIssues === 0) {
  console.log('\n  ✓ Sin issues — pipeline funciona correctamente en los 24 fixtures.\n')
} else {
  for (const r of results) {
    if (r.issues.length > 0) {
      console.log(`\n  ${r.filename}:`)
      for (const issue of r.issues) {
        console.log(`    ⚠ ${issue}`)
      }
    }
  }
}

console.log('='.repeat(80))
console.log('  FIN DEL REPORTE 7.07e')
console.log('='.repeat(80) + '\n')
