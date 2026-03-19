/**
 * Test de validación del normalizer contra fixtures reales PJUD.
 * Ejecutar con: npx tsx src/lib/pipeline/chunking/normalizer.test.ts
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { normalizePjudText, type NormalizerResult } from './normalizer'

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

console.log('\n=== PJUD Text Normalizer — Validation Tests ===\n')

// ─── Fixture 01: Sentencia ──────────────────────────────────
console.log('Fixture 01 — Sentencia C-15200-2023:')
const sentencia = loadFixture('01-sentencia-C-15200-2023.txt')
const r1 = normalizePjudText(sentencia, { extractionMethod: 'pdf-parse' }) as NormalizerResult

runTest('reduce tamaño significativamente', () => {
  assert(r1.stats.reductionPercent > 3, `Solo redujo ${r1.stats.reductionPercent}%`)
})

runTest('detecta firma PJUD', () => {
  const firmas = r1.artifacts.filter(a => a.type === 'firma_pjud')
  assert(firmas.length > 0, `No detectó firmas PJUD (total artifacts: ${r1.artifacts.length})`)
  console.log(`    → ${firmas.length} firmas PJUD detectadas`)
})

runTest('detecta page markers', () => {
  const markers = r1.artifacts.filter(a => a.type === 'page_marker')
  assert(markers.length > 0, `No detectó page markers`)
  console.log(`    → ${markers.length} page markers detectados`)
})

runTest('detecta page boundaries', () => {
  assert(r1.extractedMetadata.pageBoundaries.length > 1,
    `Solo ${r1.extractedMetadata.pageBoundaries.length} boundaries`)
  console.log(`    → ${r1.extractedMetadata.pageBoundaries.length} page boundaries`)
})

runTest('corrige encoding roto', () => {
  assert(r1.stats.encodingFixes > 0, `No hizo correcciones de encoding`)
  assert(!r1.cleanText.includes('presentaci n'), 'Aún contiene "presentaci n"')
  assert(!r1.cleanText.includes('se ala'), 'Aún contiene "se ala"')
  console.log(`    → ${r1.stats.encodingFixes} correcciones de encoding`)
})

runTest('NO remueve "Vistos:" ni "CONSIDERANDO"', () => {
  assert(r1.cleanText.includes('Vistos:'), 'Removió "Vistos:"')
  assert(r1.cleanText.includes('CONSIDERANDO'), 'Removió "CONSIDERANDO"')
})

runTest('NO remueve resolución final ("resuelve")', () => {
  assert(r1.cleanText.toLowerCase().includes('resuelve'),
    'Removió "resuelve" — el contenido legal más crítico de la sentencia')
})

runTest('NO remueve nombre jueza', () => {
  assert(r1.cleanText.includes('ROCIO') || r1.cleanText.includes('Rocío') || r1.cleanText.includes('ROC O'),
    'Removió nombre de la jueza')
})

runTest('remueve verificadoc.pjud.cl', () => {
  assert(!r1.cleanText.includes('verificadoc.pjud.cl'), 'No removió verificadoc.pjud.cl')
})

runTest('remueve "-- N of M --"', () => {
  assert(!r1.cleanText.match(/--\s*\d+\s+of\s+\d+\s*--/), 'No removió page markers')
})

// ─── Fixture 07: Certificado firma PJUD ─────────────────────
console.log('\nFixture 07 — Certificado firma PJUD:')
const certFirma = loadFixture('07-certificado-firma-pjud-C-15200-2023.txt')
const r7 = normalizePjudText(certFirma, { extractionMethod: 'pdf-parse' }) as NormalizerResult

runTest('preserva contenido legal del certificado', () => {
  assert(r7.cleanText.includes('Certifico'), 'Removió "Certifico"')
  assert(r7.cleanText.includes('Corte de Apelaciones'), 'Removió "Corte de Apelaciones"')
})

runTest('remueve firma y page marker', () => {
  assert(!r7.cleanText.includes('verificadoc'), 'No removió firma PJUD')
  assert(!r7.cleanText.includes('-- 1 of 1 --'), 'No removió page marker')
})

// ─── Fixture 04: Receptor búsqueda ──────────────────────────
console.log('\nFixture 04 — Receptor búsqueda:')
const receptor = loadFixture('04-receptor-busqueda-C-15200-2023.txt')
const r4 = normalizePjudText(receptor, { extractionMethod: 'pdf-parse' }) as NormalizerResult

runTest('preserva nombre receptor y contenido legal', () => {
  assert(r4.cleanText.includes('TATIANA MUÑOZ'), 'Removió nombre del receptor')
  assert(r4.cleanText.includes('CERTIFICO'), 'Removió "CERTIFICO"')
  assert(r4.cleanText.includes('haber buscado'), 'Removió "haber buscado"')
})

runTest('preserva detalles de la diligencia', () => {
  assert(r4.cleanText.includes('Av. El Golf'), 'Removió dirección')
  assert(r4.cleanText.includes('Doy fe'), 'Removió "Doy fe"')
})

// ─── Fixture 10: Audiencia encoding severo ───────────────────
console.log('\nFixture 10 — Audiencia encoding roto severo:')
const audiencia = loadFixture('10-audiencia-encoding-roto-C-15200-2023.txt')
const r10 = normalizePjudText(audiencia, { extractionMethod: 'pdf-parse' }) as NormalizerResult

runTest('corrige encoding severo', () => {
  assert(!r10.cleanText.includes('veintis is'), 'No corrigió "veintis is"')
  assert(!r10.cleanText.includes('veintitr s'), 'No corrigió "veintitr s"')
  assert(!r10.cleanText.includes('habi ndose'), 'No corrigió "habi ndose"')
  console.log(`    → ${r10.stats.encodingFixes} correcciones de encoding`)
})

runTest('preserva contenido legal de audiencia', () => {
  assert(r10.cleanText.toLowerCase().includes('audiencia'), 'Removió "audiencia"')
  assert(r10.cleanText.includes('contestación') || r10.cleanText.includes('contestaci'),
    'Removió referencia a contestación')
})

// ─── Fixture 11: Resolución reposición Illapel ──────────────
console.log('\nFixture 11 — Resolución reposición (Illapel):')
const resolucion = loadFixture('11-resolucion-reposicion-C-153-2021.txt')
const r11 = normalizePjudText(resolucion, { extractionMethod: 'pdf-parse' }) as NormalizerResult

runTest('preserva contenido legal de resolución', () => {
  assert(r11.cleanText.includes('VISTOS'), 'Removió "VISTOS"')
  assert(r11.cleanText.includes('artículo 181'), 'Removió referencia al artículo')
  assert(r11.cleanText.includes('acoge la reposición'), 'Removió dispositivo de la resolución')
})

runTest('preserva notificación por estado diario', () => {
  assert(r11.cleanText.includes('se notificó por el estado diario'),
    'Removió notificación por estado diario')
})

// ─── Fixture 15: Resolución doble nomenclatura Illapel ──────
console.log('\nFixture 15 — Resolución doble nomenclatura + disclaimer:')
const res15 = loadFixture('15-resolucion-doble-nomenclatura-C-153-2021.txt')
const r15 = normalizePjudText(res15, { extractionMethod: 'pdf-parse' }) as NormalizerResult

runTest('remueve disclaimer horario Chile', () => {
  assert(!r15.cleanText.includes('horaoficial.cl'), 'No removió disclaimer horario')
})

runTest('preserva contenido de la resolución', () => {
  assert(r15.cleanText.includes('Proveyendo'), 'Removió "Proveyendo"')
  assert(r15.cleanText.includes('Sirva la presente'), 'Removió "Sirva la presente"')
})

// ─── Fixture 09: Informe OCR ────────────────────────────────
console.log('\nFixture 09 — Informe OCR (document-ai):')
const informe = loadFixture('09-informe-ocr-C-15200-2023.txt')
const r9 = normalizePjudText(informe, { extractionMethod: 'document-ai' }) as NormalizerResult

runTest('remueve watermarks de scanner', () => {
  assert(!r9.cleanText.includes('Scanned with AnyScanner'), 'No removió watermark')
  const wm = r9.artifacts.filter(a => a.type === 'watermark_scanner')
  console.log(`    → ${wm.length} watermarks removidos`)
})

runTest('preserva contenido del informe', () => {
  assert(r9.cleanText.includes('INFORME'), 'Removió "INFORME"')
  assert(r9.cleanText.includes('audiencia testimonial'), 'Removió "audiencia testimonial"')
})

// ─── Fixture 12: Demanda ejecutiva ──────────────────────────
console.log('\nFixture 12 — Demanda ejecutiva (Illapel):')
const demanda = loadFixture('12-demanda-ejecutiva-C-153-2021.txt')
const r12 = normalizePjudText(demanda, { extractionMethod: 'pdf-parse' }) as NormalizerResult

runTest('remueve firma e-signer', () => {
  assert(!r12.cleanText.includes('esigner.cl'), 'No removió firma e-signer')
})

runTest('preserva contenido de demanda ejecutiva', () => {
  assert(r12.cleanText.includes('demanda ejecutiva'), 'Removió "demanda ejecutiva"')
  assert(r12.cleanText.includes('mandamiento de ejecución'), 'Removió "mandamiento"')
  assert(r12.cleanText.includes('artículo') || r12.cleanText.includes('art culo'),
    'Removió referencias a artículos')
})

// ─── Dry-run test ───────────────────────────────────────────
console.log('\nDry-run test:')
const dryResult = normalizePjudText(sentencia, { extractionMethod: 'pdf-parse', dryRun: true })

runTest('dry-run retorna annotatedText', () => {
  assert('annotatedText' in dryResult, 'No contiene annotatedText')
})

runTest('dry-run NO modifica el texto original', () => {
  assert(
    (dryResult as { annotatedText: string }).annotatedText.includes('verificadoc.pjud.cl'),
    'Dry-run removió contenido del texto original'
  )
})

runTest('dry-run marca artefactos con delimitadores', () => {
  const annotated = (dryResult as { annotatedText: string }).annotatedText
  assert(annotated.includes('««firma_pjud»»'), 'No marcó firma_pjud')
})

// ─── Summary ────────────────────────────────────────────────
console.log('\n=== Stats Summary ===\n')
const fixtures = [
  { name: '01-sentencia', result: r1 },
  { name: '07-cert-firma', result: r7 },
  { name: '04-receptor', result: r4 },
  { name: '10-encoding', result: r10 },
  { name: '11-resolucion', result: r11 },
  { name: '15-doble-nom', result: r15 },
  { name: '09-informe-ocr', result: r9 },
  { name: '12-demanda-ej', result: r12 },
]

console.log('Fixture            | Original | Clean    | Reducción | Artefactos | Encoding')
console.log('-------------------|----------|----------|-----------|------------|--------')
for (const { name, result: r } of fixtures) {
  console.log(
    `${name.padEnd(19)}| ${String(r.stats.originalLength).padEnd(9)}| ${String(r.stats.cleanLength).padEnd(9)}| ${String(r.stats.reductionPercent + '%').padEnd(10)}| ${String(r.stats.artifactsDetected).padEnd(11)}| ${r.stats.encodingFixes}`
  )
}

console.log('\n=== Done ===\n')
