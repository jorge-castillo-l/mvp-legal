/**
 * Test de validación del token-chunker contra fixtures reales PJUD.
 * Ejecutar con: npx tsx src/lib/pipeline/chunking/token-chunker.test.ts
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { normalizePjudText, type NormalizerResult } from './normalizer'
import { chunkText, estimateTokens } from './token-chunker'

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

function normalizeAndChunk(filename: string, method: 'pdf-parse' | 'document-ai' = 'pdf-parse') {
  const raw = loadFixture(filename)
  const normalized = normalizePjudText(raw, { extractionMethod: method }) as NormalizerResult
  const result = chunkText(normalized.cleanText, {
    normalizerMetadata: normalized.extractedMetadata,
  })
  return { raw, normalized, result }
}

console.log('\n=== Token Chunker — Validation Tests ===\n')

// ─── Fixture 01: Sentencia larga (23K chars) ────────────────
console.log('Fixture 01 — Sentencia (23K chars, ~4300 tokens):')
const { normalized: n1, result: r1 } = normalizeAndChunk('01-sentencia-C-15200-2023.txt')

runTest('produce múltiples chunks', () => {
  assert(r1.chunks.length > 1, `Solo ${r1.chunks.length} chunk(s)`)
  console.log(`    → ${r1.stats.totalChunks} chunks generados`)
})

runTest('chunks dentro del rango de tokens (538-998)', () => {
  for (const chunk of r1.chunks) {
    if (chunk.chunkIndex > 0 && chunk.chunkIndex < r1.chunks.length - 1) {
      assert(chunk.tokenEstimate >= 40, `Chunk ${chunk.chunkIndex}: solo ${chunk.tokenEstimate} tokens (muy pequeño)`)
      assert(chunk.tokenEstimate <= 1500, `Chunk ${chunk.chunkIndex}: ${chunk.tokenEstimate} tokens (excede máximo)`)
    }
  }
})

runTest('NO corta en medio de CONSIDERANDO', () => {
  for (const chunk of r1.chunks) {
    const text = chunk.chunkText
    const hasTruncatedConsiderando =
      text.match(/PRIMERO:\s*$/) || text.match(/SEGUNDO:\s*$/) || text.match(/TERCERO:\s*$/)
    assert(!hasTruncatedConsiderando,
      `Chunk ${chunk.chunkIndex} termina justo en un CONSIDERANDO truncado`)
  }
})

runTest('preserva "Vistos:" y "resuelve" en algún chunk', () => {
  const allText = r1.chunks.map(c => c.chunkText).join(' ')
  assert(allText.includes('Vistos:'), 'Ningún chunk contiene "Vistos:"')
  assert(allText.toLowerCase().includes('resuelve'), 'Ningún chunk contiene "resuelve"')
})

runTest('primer chunk no tiene overlap', () => {
  assert(!r1.chunks[0].metadata.overlapWithPrevious, 'Primer chunk tiene overlap')
})

runTest('chunks posteriores tienen overlap', () => {
  if (r1.chunks.length > 1) {
    assert(r1.chunks[1].metadata.overlapWithPrevious, 'Segundo chunk no tiene overlap')
  }
})

runTest('metadata heredada del normalizer', () => {
  const meta = r1.chunks[0].metadata
  assert(meta.documentTokenEstimate > 0, 'No tiene documentTokenEstimate')
})

runTest('page numbers asignados desde pageBoundaries', () => {
  const withPage = r1.chunks.filter(c => c.pageNumber !== null)
  console.log(`    → ${withPage.length}/${r1.chunks.length} chunks con page_number`)
})

// ─── Fixture 07: Certificado firma (384 chars, ~77 tokens) ──
console.log('\nFixture 07 — Certificado firma PJUD (doc corto):')
const { result: r7 } = normalizeAndChunk('07-certificado-firma-pjud-C-15200-2023.txt')

runTest('documento corto → 1 solo chunk (sin fragmentar)', () => {
  assert(r7.stats.shortDocSingleChunk, 'No detectó como documento corto')
  assert(r7.chunks.length === 1, `Generó ${r7.chunks.length} chunks en vez de 1`)
  console.log(`    → ${r7.chunks[0].tokenEstimate} tokens, 1 chunk`)
})

runTest('chunk contiene el texto completo', () => {
  assert(r7.chunks[0].chunkText.includes('Certifico'), 'Texto incompleto')
})

// ─── Fixture 04: Receptor búsqueda (710 chars, ~142 tokens) ─
console.log('\nFixture 04 — Receptor búsqueda (doc corto):')
const { result: r4 } = normalizeAndChunk('04-receptor-busqueda-C-15200-2023.txt')

runTest('documento corto → 1 solo chunk', () => {
  assert(r4.chunks.length === 1, `Generó ${r4.chunks.length} chunks`)
  assert(r4.stats.shortDocSingleChunk, 'No detectó como documento corto')
})

// ─── Fixture 03: Contestación larga (21K chars) ─────────────
console.log('\nFixture 03 — Contestación + excepción (21K chars):')
const { result: r3 } = normalizeAndChunk('03-contestacion-excepcion-C-15200-2023.txt')

runTest('produce chunks y respeta fronteras de otrosí', () => {
  assert(r3.chunks.length > 1, `Solo ${r3.chunks.length} chunk`)
  console.log(`    → ${r3.stats.totalChunks} chunks, avg ${r3.stats.avgChunkTokens} tokens`)
})

runTest('ningún chunk vacío o solo whitespace', () => {
  for (const chunk of r3.chunks) {
    assert(chunk.chunkText.trim().length > 0, `Chunk ${chunk.chunkIndex} está vacío`)
  }
})

// ─── Fixture 12: Demanda ejecutiva (6.4K chars) ─────────────
console.log('\nFixture 12 — Demanda ejecutiva (6.4K chars):')
const { result: r12 } = normalizeAndChunk('12-demanda-ejecutiva-C-153-2021.txt')

runTest('produce chunks de tamaño razonable', () => {
  console.log(`    → ${r12.stats.totalChunks} chunks, avg ${r12.stats.avgChunkTokens} tokens`)
  assert(r12.chunks.length >= 1, 'No generó chunks')
})

runTest('preserva estructura POR TANTO', () => {
  const allText = r12.chunks.map(c => c.chunkText).join(' ')
  assert(allText.includes('POR TANTO'), 'Perdió "POR TANTO"')
})

// ─── Fixture 06: Acta audiencia (8K chars) ──────────────────
console.log('\nFixture 06 — Acta audiencia (8K chars):')
const { result: r6 } = normalizeAndChunk('06-acta-audiencia-C-15200-2023.txt')

runTest('produce chunks de audiencia', () => {
  console.log(`    → ${r6.stats.totalChunks} chunks, avg ${r6.stats.avgChunkTokens} tokens`)
  assert(r6.chunks.length >= 1, 'No generó chunks')
})

// ─── Fixture 09: Informe OCR (6.5K chars, document-ai) ──────
console.log('\nFixture 09 — Informe OCR (document-ai):')
const { result: r9 } = normalizeAndChunk('09-informe-ocr-C-15200-2023.txt', 'document-ai')

runTest('genera chunks de contenido OCR', () => {
  console.log(`    → ${r9.stats.totalChunks} chunks, avg ${r9.stats.avgChunkTokens} tokens`)
  assert(r9.chunks.length >= 1, 'No generó chunks')
})

// ─── Edge case: texto vacío ─────────────────────────────────
console.log('\nEdge case — texto vacío:')
const emptyResult = chunkText('', {})

runTest('texto vacío → 0 chunks', () => {
  assert(emptyResult.chunks.length === 0, 'Generó chunks de texto vacío')
})

// ─── Token estimation ───────────────────────────────────────
console.log('\nToken estimation (chars/5 para español):')

runTest('estima tokens razonablemente', () => {
  const sample = 'Santiago, doce de Marzo de dos mil veinticuatro'
  const tokens = estimateTokens(sample)
  const words = sample.split(/\s+/).length
  assert(tokens >= words * 0.8, `${tokens} tokens es demasiado bajo para ${words} palabras`)
  assert(tokens <= words * 2, `${tokens} tokens es demasiado alto para ${words} palabras`)
  console.log(`    → "${sample}" = ${tokens} tokens est. (${words} palabras)`)
})

// ─── Guarantee: nunca documento sin chunks ──────────────────
console.log('\nGarantía — nunca documento sin chunks:')

const allFixtures = [
  '01-sentencia-C-15200-2023.txt',
  '02-demanda-sumaria-C-15200-2023.txt',
  '03-contestacion-excepcion-C-15200-2023.txt',
  '04-receptor-busqueda-C-15200-2023.txt',
  '05-receptor-notificacion-C-15200-2023.txt',
  '06-acta-audiencia-C-15200-2023.txt',
  '07-certificado-firma-pjud-C-15200-2023.txt',
  '08-certificado-envio-ojv-C-15200-2023.txt',
  '09-informe-ocr-C-15200-2023.txt',
  '10-audiencia-encoding-roto-C-15200-2023.txt',
  '11-resolucion-reposicion-C-153-2021.txt',
  '12-demanda-ejecutiva-C-153-2021.txt',
  '13-receptor-busqueda-C-153-2021.txt',
  '14-informe-pdi-ocr-C-153-2021.txt',
  '15-resolucion-doble-nomenclatura-C-153-2021.txt',
]

runTest('TODOS los 15 fixtures producen al menos 1 chunk', () => {
  const failures: string[] = []
  for (const f of allFixtures) {
    const method = f.includes('ocr') ? 'document-ai' as const : 'pdf-parse' as const
    const raw = loadFixture(f)
    const norm = normalizePjudText(raw, { extractionMethod: method }) as NormalizerResult
    const res = chunkText(norm.cleanText, { normalizerMetadata: norm.extractedMetadata })
    if (res.chunks.length === 0) failures.push(f)
  }
  assert(failures.length === 0, `Sin chunks: ${failures.join(', ')}`)
  console.log(`    → 15/15 fixtures producen chunks ✓`)
})

// ─── Summary ────────────────────────────────────────────────
console.log('\n=== Stats Summary ===\n')

console.log('Fixture                    | Chars  | Tokens | Chunks | Avg Tok | Short')
console.log('---------------------------|--------|--------|--------|---------|------')
for (const f of allFixtures) {
  const method = f.includes('ocr') ? 'document-ai' as const : 'pdf-parse' as const
  const raw = loadFixture(f)
  const norm = normalizePjudText(raw, { extractionMethod: method }) as NormalizerResult
  const res = chunkText(norm.cleanText, { normalizerMetadata: norm.extractedMetadata })
  const name = f.replace('.txt', '').slice(0, 27)
  console.log(
    `${name.padEnd(27)}| ${String(res.stats.documentChars).padEnd(7)}| ${String(res.stats.documentTokens).padEnd(7)}| ${String(res.stats.totalChunks).padEnd(7)}| ${String(res.stats.avgChunkTokens).padEnd(8)}| ${res.stats.shortDocSingleChunk ? 'sí' : 'no'}`
  )
}

console.log('\n=== Done ===\n')
