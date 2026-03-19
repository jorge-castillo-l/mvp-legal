/**
 * Test de validación del metadata-enricher contra fixtures reales PJUD.
 * Ejecutar con: npx tsx src/lib/pipeline/chunking/metadata-enricher.test.ts
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { normalizePjudText, type NormalizerResult } from './normalizer'
import { detectSections } from './section-detector'
import { chunkText } from './token-chunker'
import {
  enrichChunkMetadata,
  buildEmbeddingInput,
  buildCitationLabel,
  type DocumentParentMetadata,
  type CaseMetadata,
} from './metadata-enricher'

const FIXTURES_DIR = join(process.cwd(), 'docs', 'fixtures', 'normalizer')

function loadFixture(filename: string): string {
  return readFileSync(join(FIXTURES_DIR, filename), 'utf-8')
}

function runTest(name: string, fn: () => void) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
  } catch (e) {
    console.error(`  ✗ ${name}`)
    console.error(`    ${(e as Error).message}`)
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg)
}

function fullPipeline(
  filename: string,
  parentMeta: DocumentParentMetadata,
  caseMeta: CaseMetadata,
  method: 'pdf-parse' | 'document-ai' = 'pdf-parse'
) {
  const raw = loadFixture(filename)
  const normalized = normalizePjudText(raw, { extractionMethod: method }) as NormalizerResult
  const sections = detectSections(normalized.cleanText)
  const chunked = chunkText(normalized.cleanText, {
    normalizerMetadata: normalized.extractedMetadata,
    detectedSections: sections.sections,
  })
  const enrichedChunks = chunked.chunks.map((chunk) => ({
    chunk,
    enriched: enrichChunkMetadata(chunk, { parentMetadata: parentMeta, caseMetadata: caseMeta }),
    embeddingInput: buildEmbeddingInput(
      chunk,
      enrichChunkMetadata(chunk, { parentMetadata: parentMeta, caseMetadata: caseMeta })
    ),
    citation: buildCitationLabel(
      enrichChunkMetadata(chunk, { parentMetadata: parentMeta, caseMetadata: caseMeta })
    ),
  }))
  return { normalized, sections, chunked, enrichedChunks }
}

console.log('\n=== Metadata Enricher — Validation Tests ===\n')

// ─── Fixture 01: Sentencia ──────────────────────────────────
console.log('Fixture 01 — Sentencia C-15200-2023:')
const sentenciaMeta: DocumentParentMetadata = {
  document_type: 'folio',
  folio_numero: 31,
  cuaderno: 'Principal',
  fecha_tramite: '12/03/2024',
  desc_tramite: 'Sentencia',
  foja: 31,
}
const sentenciaCaseMeta: CaseMetadata = {
  procedimiento: 'sumario',
  libro_tipo: 'c',
  tribunal: '17º Juzgado Civil de Santiago',
  rol: 'C-15200-2023',
}
const p1 = fullPipeline('01-sentencia-C-15200-2023.txt', sentenciaMeta, sentenciaCaseMeta)

runTest('enriched metadata tiene las 3 capas', () => {
  const e = p1.enrichedChunks[0].enriched
  assert(e.document_type === 'folio', `document_type: ${e.document_type}`)
  assert(e.folio_numero === 31, `folio_numero: ${e.folio_numero}`)
  assert(e.cuaderno === 'Principal', `cuaderno: ${e.cuaderno}`)
  assert(e.procedimiento === 'sumario', `procedimiento: ${e.procedimiento}`)
  assert(e.rol === 'C-15200-2023', `rol: ${e.rol}`)
})

runTest('buildEmbeddingInput genera prefijo contextual', () => {
  const input = p1.enrichedChunks[0].embeddingInput
  assert(input.startsWith('['), `No empieza con [: ${input.slice(0, 50)}...`)
  assert(input.includes('Sentencia'), `No incluye "Sentencia": ${input.slice(0, 100)}...`)
  assert(input.includes('Folio 31'), `No incluye "Folio 31": ${input.slice(0, 100)}...`)
  assert(input.includes('Principal'), `No incluye "Principal": ${input.slice(0, 100)}...`)
  console.log(`    → Prefijo: ${input.slice(0, input.indexOf(']') + 1)}`)
})

runTest('buildEmbeddingInput incluye sección para chunks con alta confianza', () => {
  const chunkConConsiderando = p1.enrichedChunks.find(
    (ec) => ec.enriched.section_type === 'considerando_n'
  )
  if (chunkConConsiderando) {
    assert(
      chunkConConsiderando.embeddingInput.includes('Considerando'),
      'Embedding input no incluye Considerando para chunk con sectionType considerando_n'
    )
    console.log(`    → ${chunkConConsiderando.embeddingInput.slice(0, chunkConConsiderando.embeddingInput.indexOf(']') + 1)}`)
  }
})

runTest('buildEmbeddingInput NO incluye sección para chunks "general"', () => {
  const chunkGeneral = p1.enrichedChunks.find(
    (ec) => ec.enriched.section_type === 'general'
  )
  if (chunkGeneral) {
    const prefix = chunkGeneral.embeddingInput.slice(0, chunkGeneral.embeddingInput.indexOf(']') + 1)
    assert(
      !prefix.includes('Considerando') && !prefix.includes('Vistos'),
      `Chunk "general" tiene sección en prefijo: ${prefix}`
    )
  }
})

runTest('prefijo es breve (< 150 chars)', () => {
  for (const ec of p1.enrichedChunks) {
    const closeBracket = ec.embeddingInput.indexOf(']')
    if (closeBracket > 0) {
      assert(closeBracket < 150, `Prefijo demasiado largo: ${closeBracket} chars`)
    }
  }
})

runTest('chunk_text queda puro (sin prefijo)', () => {
  for (const ec of p1.enrichedChunks) {
    assert(!ec.chunk.chunkText.startsWith('['), 'chunk_text tiene prefijo contaminante')
  }
})

runTest('buildCitationLabel genera cita legible', () => {
  const citation = p1.enrichedChunks[0].citation
  assert(citation.includes('Sentencia'), `Cita no incluye tipo: ${citation}`)
  assert(citation.includes('12/03/2024'), `Cita no incluye fecha: ${citation}`)
  assert(citation.includes('folio 31'), `Cita no incluye folio: ${citation}`)
  assert(citation.includes('Principal'), `Cita no incluye cuaderno: ${citation}`)
  console.log(`    → Cita: "${citation}"`)
})

// ─── Fixture 12: Demanda ejecutiva ──────────────────────────
console.log('\nFixture 12 — Demanda ejecutiva (Illapel):')
const demandaMeta: DocumentParentMetadata = {
  document_type: 'folio',
  folio_numero: 1,
  cuaderno: 'Principal',
  fecha_tramite: '02/03/2021',
  desc_tramite: 'Demanda',
}
const demandaCaseMeta: CaseMetadata = {
  procedimiento: 'ejecutivo',
  libro_tipo: 'c',
  tribunal: 'Juzgado de Letras de Illapel',
  rol: 'C-153-2021',
}
const p12 = fullPipeline('12-demanda-ejecutiva-C-153-2021.txt', demandaMeta, demandaCaseMeta)

runTest('embedding input incluye "Ejecutivo"', () => {
  const input = p12.enrichedChunks[0].embeddingInput
  assert(input.includes('Ejecutivo'), `No incluye Ejecutivo: ${input.slice(0, 100)}`)
  console.log(`    → Prefijo: ${input.slice(0, input.indexOf(']') + 1)}`)
})

runTest('citation incluye datos de demanda ejecutiva', () => {
  const citation = p12.enrichedChunks[0].citation
  assert(citation.includes('Demanda'), `Cita no incluye tipo: ${citation}`)
  assert(citation.includes('folio 1'), `Cita no incluye folio: ${citation}`)
  console.log(`    → Cita: "${citation}"`)
})

// ─── Fixture 04: Receptor búsqueda ──────────────────────────
console.log('\nFixture 04 — Receptor búsqueda:')
const receptorMeta: DocumentParentMetadata = {
  document_type: 'folio',
  folio_numero: 12,
  cuaderno: 'Principal',
  fecha_tramite: '11/10/2023',
  desc_tramite: 'Certificación búsqueda',
}
const receptorCaseMeta: CaseMetadata = {
  procedimiento: 'sumario',
  tribunal: '17º Juzgado Civil de Santiago',
  rol: 'C-15200-2023',
}
const p4 = fullPipeline('04-receptor-busqueda-C-15200-2023.txt', receptorMeta, receptorCaseMeta)

runTest('doc corto: 1 chunk con metadata completa', () => {
  assert(p4.enrichedChunks.length === 1, `${p4.enrichedChunks.length} chunks`)
  const e = p4.enrichedChunks[0].enriched
  assert(e.folio_numero === 12, `folio: ${e.folio_numero}`)
  assert(e.procedimiento === 'sumario', `proc: ${e.procedimiento}`)
})

runTest('citation del receptor es precisa', () => {
  const citation = p4.enrichedChunks[0].citation
  assert(citation.includes('búsqueda'), `No incluye tipo: ${citation}`)
  assert(citation.includes('11/10/2023'), `No incluye fecha: ${citation}`)
  console.log(`    → Cita: "${citation}"`)
})

// ─── Fixture 11: Resolución Illapel ─────────────────────────
console.log('\nFixture 11 — Resolución reposición (sin parentMeta):')
const p11 = fullPipeline(
  '11-resolucion-reposicion-C-153-2021.txt',
  {},
  { procedimiento: 'ejecutivo', rol: 'C-153-2021' }
)

runTest('funciona con metadata parcial (sin doc_metadata)', () => {
  const e = p11.enrichedChunks[0].enriched
  assert(e.procedimiento === 'ejecutivo', `proc: ${e.procedimiento}`)
  assert(e.rol === 'C-153-2021', `rol: ${e.rol}`)
})

runTest('embedding input funciona sin metadata del padre', () => {
  const input = p11.enrichedChunks[0].embeddingInput
  assert(input.includes('Ejecutivo'), `No incluye procedimiento`)
  console.log(`    → Prefijo: ${input.slice(0, input.indexOf(']') + 1)}`)
})

runTest('citation funciona con metadata parcial', () => {
  const citation = p11.enrichedChunks[0].citation
  console.log(`    → Cita: "${citation}"`)
})

// ─── Edge case: sin metadata ────────────────────────────────
console.log('\nEdge case — sin metadata del padre ni causa:')
const pEmpty = fullPipeline('07-certificado-firma-pjud-C-15200-2023.txt', {}, {})

runTest('funciona sin ninguna metadata externa', () => {
  assert(pEmpty.enrichedChunks.length === 1, `${pEmpty.enrichedChunks.length} chunks`)
  const input = pEmpty.enrichedChunks[0].embeddingInput
  assert(input.length > 0, 'Embedding input vacío')
  console.log(`    → Input: "${input.slice(0, 80)}..."`)
})

// ─── Pipeline summary ───────────────────────────────────────
console.log('\n=== Embedding Input Prefixes (todos los fixtures) ===\n')

const testCases = [
  { file: '01-sentencia-C-15200-2023.txt', parent: sentenciaMeta, case_: sentenciaCaseMeta },
  { file: '12-demanda-ejecutiva-C-153-2021.txt', parent: demandaMeta, case_: demandaCaseMeta },
  { file: '04-receptor-busqueda-C-15200-2023.txt', parent: receptorMeta, case_: receptorCaseMeta },
  { file: '11-resolucion-reposicion-C-153-2021.txt', parent: {}, case_: { procedimiento: 'ejecutivo', rol: 'C-153-2021' } as CaseMetadata },
  { file: '07-certificado-firma-pjud-C-15200-2023.txt', parent: {}, case_: {} as CaseMetadata },
]

for (const tc of testCases) {
  const p = fullPipeline(tc.file, tc.parent, tc.case_)
  const name = tc.file.replace('.txt', '').slice(0, 35)
  for (const ec of p.enrichedChunks.slice(0, 2)) {
    const bracket = ec.embeddingInput.indexOf(']')
    const prefix = bracket > 0 ? ec.embeddingInput.slice(0, bracket + 1) : '(sin prefijo)'
    console.log(`${name.padEnd(36)} chunk ${ec.chunk.chunkIndex}: ${prefix}`)
  }
}

console.log('\n=== Done ===\n')
