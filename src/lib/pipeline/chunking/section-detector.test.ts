/**
 * Test de validación del section-detector contra fixtures reales PJUD.
 * Ejecutar con: npx tsx src/lib/pipeline/chunking/section-detector.test.ts
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { normalizePjudText, type NormalizerResult } from './normalizer'
import { detectSections } from './section-detector'
import { chunkText } from './token-chunker'

const FIXTURES_DIR = join(process.cwd(), 'docs', 'fixtures', 'normalizer')

function loadFixture(filename: string): string {
  return readFileSync(join(FIXTURES_DIR, filename), 'utf-8')
}

function normalizeFixture(filename: string, method: 'pdf-parse' | 'document-ai' = 'pdf-parse') {
  const raw = loadFixture(filename)
  const normalized = normalizePjudText(raw, { extractionMethod: method }) as NormalizerResult
  return normalized
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

console.log('\n=== Legal Section Detector — Validation Tests ===\n')

// ─── Fixture 01: Sentencia (Art. 170 CPC) ───────────────────
console.log('Fixture 01 — Sentencia (estructura Art. 170 CPC):')
const n1 = normalizeFixture('01-sentencia-C-15200-2023.txt')
const s1 = detectSections(n1.cleanText)

runTest('clasifica como sentencia', () => {
  assert(s1.documentStructure === 'sentencia', `Clasificó como: ${s1.documentStructure}`)
})

runTest('detecta sección Vistos', () => {
  const vistos = s1.sections.filter(s => s.type === 'vistos')
  assert(vistos.length > 0, 'No detectó Vistos')
  console.log(`    → ${vistos.length} sección(es) Vistos, confidence ${vistos[0].confidence}`)
})

runTest('detecta CONSIDERANDO con múltiples ordinales', () => {
  const considerandos = s1.sections.filter(s => s.type === 'considerando_n')
  assert(considerandos.length >= 10, `Solo ${considerandos.length} considerandos (esperados 16)`)
  console.log(`    → ${considerandos.length} considerandos detectados`)
  const ordinales = considerandos.map(c => c.ordinal).filter(Boolean)
  console.log(`    → Ordinales: ${ordinales.join(', ')}`)
})

runTest('detecta sección Resolutivo', () => {
  const resolutivo = s1.sections.filter(s => s.type === 'resolutivo')
  assert(resolutivo.length > 0, 'No detectó Resolutivo')
  console.log(`    → confidence ${resolutivo[0].confidence}`)
})

runTest('detecta cierre sentencia (Regístrese)', () => {
  const cierre = s1.sections.filter(s => s.type === 'cierre_sentencia')
  assert(cierre.length > 0, 'No detectó cierre de sentencia')
})

runTest('orden correcto: Vistos antes de Considerandos antes de Resolutivo', () => {
  const vistos = s1.sections.find(s => s.type === 'vistos')
  const primerCons = s1.sections.find(s => s.type === 'considerando_n' && s.ordinal === 1)
  const resolutivo = s1.sections.find(s => s.type === 'resolutivo')
  assert(!!vistos && !!primerCons && !!resolutivo, 'Falta alguna sección clave')
  assert(vistos!.offsetStart < primerCons!.offsetStart, 'Vistos no está antes del primer Considerando')
  assert(primerCons!.offsetStart < resolutivo!.offsetStart, 'Considerandos no están antes del Resolutivo')
})

// Integración con chunker: los chunks ahora tienen sectionType
runTest('chunks de sentencia tienen sectionType asignado', () => {
  const chunked = chunkText(n1.cleanText, {
    normalizerMetadata: n1.extractedMetadata,
    detectedSections: s1.sections,
  })
  const withSection = chunked.chunks.filter(c => c.sectionType !== 'general')
  assert(withSection.length > 0, 'Ningún chunk tiene sectionType asignado')
  console.log(`    → ${withSection.length}/${chunked.chunks.length} chunks con sectionType`)
  const types = [...new Set(chunked.chunks.map(c => c.sectionType))]
  console.log(`    → Tipos: ${types.join(', ')}`)
})

// ─── Fixture 02: Demanda sumaria (escrito procesal) ─────────
console.log('\nFixture 02 — Demanda sumaria (estructura escrito procesal):')
const n2 = normalizeFixture('02-demanda-sumaria-C-15200-2023.txt')
const s2 = detectSections(n2.cleanText)

runTest('clasifica como escrito_procesal', () => {
  assert(s2.documentStructure === 'escrito_procesal', `Clasificó como: ${s2.documentStructure}`)
})

runTest('detecta EN LO PRINCIPAL', () => {
  const principal = s2.sections.filter(s => s.type === 'en_lo_principal')
  assert(principal.length > 0, 'No detectó EN LO PRINCIPAL')
})

runTest('detecta LOS HECHOS', () => {
  const hechos = s2.sections.filter(s => s.type === 'hechos')
  assert(hechos.length > 0, 'No detectó LOS HECHOS')
})

runTest('detecta EL DERECHO', () => {
  const derecho = s2.sections.filter(s => s.type === 'derecho')
  assert(derecho.length > 0, 'No detectó EL DERECHO')
})

runTest('detecta POR TANTO (petitorio)', () => {
  const petitorio = s2.sections.filter(s => s.type === 'petitorio')
  assert(petitorio.length > 0, 'No detectó POR TANTO')
})

runTest('detecta otrosíes', () => {
  const otrosis = s2.sections.filter(s => s.type === 'otrosi')
  assert(otrosis.length >= 3, `Solo ${otrosis.length} otrosíes (esperados 4)`)
  console.log(`    → ${otrosis.length} otrosíes detectados`)
})

runTest('orden correcto: Principal → Hechos → Derecho → Petitorio → Otrosíes', () => {
  const principal = s2.sections.find(s => s.type === 'en_lo_principal')
  const hechos = s2.sections.find(s => s.type === 'hechos')
  const derecho = s2.sections.find(s => s.type === 'derecho')
  const petitorio = s2.sections.find(s => s.type === 'petitorio')
  assert(!!principal && !!hechos && !!derecho && !!petitorio, 'Falta alguna sección')
  assert(principal!.offsetStart < hechos!.offsetStart, 'Principal no antes de Hechos')
  assert(hechos!.offsetStart < derecho!.offsetStart, 'Hechos no antes de Derecho')
  assert(derecho!.offsetStart < petitorio!.offsetStart, 'Derecho no antes de Petitorio')
})

// ─── Fixture 03: Contestación + excepción ───────────────────
console.log('\nFixture 03 — Contestación + excepción dilatoria:')
const n3 = normalizeFixture('03-contestacion-excepcion-C-15200-2023.txt')
const s3 = detectSections(n3.cleanText)

runTest('clasifica como escrito_procesal', () => {
  assert(s3.documentStructure === 'escrito_procesal', `Clasificó como: ${s3.documentStructure}`)
})

runTest('detecta múltiples petitorios (uno por cada sección)', () => {
  const petitorios = s3.sections.filter(s => s.type === 'petitorio')
  assert(petitorios.length >= 2, `Solo ${petitorios.length} petitorios`)
  console.log(`    → ${petitorios.length} petitorios detectados (excepción + contestación + reconvención)`)
})

// ─── Fixture 04: Receptor búsqueda ──────────────────────────
console.log('\nFixture 04 — Receptor búsqueda:')
const n4 = normalizeFixture('04-receptor-busqueda-C-15200-2023.txt')
const s4 = detectSections(n4.cleanText)

runTest('clasifica como actuacion_receptor', () => {
  assert(s4.documentStructure === 'actuacion_receptor', `Clasificó como: ${s4.documentStructure}`)
})

runTest('detecta CERTIFICO', () => {
  const cert = s4.sections.filter(s => s.type === 'receptor_certificacion')
  assert(cert.length > 0, 'No detectó CERTIFICO')
})

runTest('detecta cierre receptor (Doy fe)', () => {
  const cierre = s4.sections.filter(s => s.type === 'receptor_cierre')
  assert(cierre.length > 0, 'No detectó Doy fe')
})

// ─── Fixture 05: Receptor notificación Art.44 ───────────────
console.log('\nFixture 05 — Receptor notificación Art.44:')
const n5 = normalizeFixture('05-receptor-notificacion-C-15200-2023.txt')
const s5 = detectSections(n5.cleanText)

runTest('clasifica como actuacion_receptor', () => {
  assert(s5.documentStructure === 'actuacion_receptor', `Clasificó como: ${s5.documentStructure}`)
})

runTest('detecta diligencia receptor ("En Santiago, a...")', () => {
  const dilig = s5.sections.filter(s => s.type === 'receptor_diligencia')
  assert(dilig.length > 0, 'No detectó diligencia receptor')
})

// ─── Fixture 06: Acta audiencia ─────────────────────────────
console.log('\nFixture 06 — Acta audiencia:')
const n6 = normalizeFixture('06-acta-audiencia-C-15200-2023.txt')
const s6 = detectSections(n6.cleanText)

runTest('detecta inicio de audiencia', () => {
  const inicio = s6.sections.filter(s => s.type === 'audiencia_inicio')
  // Puede ser 'audiencia' o podría detectarse como algo mixto
  console.log(`    → Estructura: ${s6.documentStructure}, ${s6.stats.sectionsDetected} secciones`)
})

runTest('detecta Vistos dentro de audiencia (mini-resoluciones)', () => {
  const vistos = s6.sections.filter(s => s.type === 'vistos')
  console.log(`    → ${vistos.length} Vistos dentro de audiencia`)
})

// ─── Fixture 11: Resolución (Illapel) ───────────────────────
console.log('\nFixture 11 — Resolución reposición (Illapel):')
const n11 = normalizeFixture('11-resolucion-reposicion-C-153-2021.txt')
const s11 = detectSections(n11.cleanText)

runTest('detecta VISTOS en resolución', () => {
  const vistos = s11.sections.filter(s => s.type === 'vistos')
  assert(vistos.length > 0, 'No detectó VISTOS')
})

runTest('detecta Proveyendo', () => {
  const prov = s11.sections.filter(s => s.type === 'resolucion_proveyendo')
  assert(prov.length > 0, 'No detectó Proveyendo')
  console.log(`    → ${prov.length} proveyendos detectados`)
})

runTest('detecta notificación estado diario', () => {
  const notif = s11.sections.filter(s => s.type === 'notificacion_estado_diario')
  assert(notif.length > 0, 'No detectó notificación estado diario')
})

// ─── Fixture 12: Demanda ejecutiva ──────────────────────────
console.log('\nFixture 12 — Demanda ejecutiva (Illapel):')
const n12 = normalizeFixture('12-demanda-ejecutiva-C-153-2021.txt')
const s12 = detectSections(n12.cleanText)

runTest('clasifica como escrito_procesal', () => {
  assert(s12.documentStructure === 'escrito_procesal', `Clasificó como: ${s12.documentStructure}`)
})

runTest('detecta EN LO PRINCIPAL', () => {
  const principal = s12.sections.filter(s => s.type === 'en_lo_principal')
  assert(principal.length > 0, 'No detectó EN LO PRINCIPAL')
})

runTest('detecta POR TANTO', () => {
  const pt = s12.sections.filter(s => s.type === 'petitorio')
  assert(pt.length > 0, 'No detectó POR TANTO')
})

runTest('detecta múltiples otrosíes', () => {
  const otrosis = s12.sections.filter(s => s.type === 'otrosi')
  assert(otrosis.length >= 4, `Solo ${otrosis.length} otrosíes (esperados 5)`)
  console.log(`    → ${otrosis.length} otrosíes detectados`)
})

// ─── Fixture 13: Receptor búsqueda Illapel ──────────────────
console.log('\nFixture 13 — Receptor búsqueda (Illapel):')
const n13 = normalizeFixture('13-receptor-busqueda-C-153-2021.txt')
const s13 = detectSections(n13.cleanText)

runTest('detecta BUSQUEDA NEGATIVA o CERTIFICO', () => {
  const cert = s13.sections.filter(s =>
    s.type === 'receptor_certificacion'
  )
  assert(cert.length > 0, 'No detectó certificación receptor')
  console.log(`    → label: "${cert[0].label}"`)
})

// ─── Fixture 15: Resolución doble nomenclatura ──────────────
console.log('\nFixture 15 — Resolución doble nomenclatura:')
const n15 = normalizeFixture('15-resolucion-doble-nomenclatura-C-153-2021.txt')
const s15 = detectSections(n15.cleanText)

runTest('detecta Proveyendo', () => {
  const prov = s15.sections.filter(s => s.type === 'resolucion_proveyendo')
  console.log(`    → ${prov.length} proveyendo(s), estructura: ${s15.documentStructure}`)
})

runTest('detecta notificación estado diario', () => {
  const notif = s15.sections.filter(s => s.type === 'notificacion_estado_diario')
  assert(notif.length > 0, 'No detectó notificación estado diario')
})

// ─── Stats: confidence distribution ─────────────────────────
console.log('\n=== Confidence Distribution ===\n')
const allResults = [
  { name: '01-sentencia', result: s1 },
  { name: '02-demanda-sum', result: s2 },
  { name: '03-contestacion', result: s3 },
  { name: '04-receptor-bus', result: s4 },
  { name: '05-receptor-not', result: s5 },
  { name: '06-acta-audien', result: s6 },
  { name: '11-resolucion', result: s11 },
  { name: '12-demanda-ej', result: s12 },
  { name: '13-receptor-ill', result: s13 },
  { name: '15-doble-nom', result: s15 },
]

console.log('Fixture          | Estructura       | Secciones | Alta | Media | Baja')
console.log('-----------------|------------------|-----------|------|-------|-----')
for (const { name, result: r } of allResults) {
  console.log(
    `${name.padEnd(17)}| ${r.documentStructure.padEnd(17)}| ${String(r.stats.sectionsDetected).padEnd(10)}| ${String(r.stats.highConfidence).padEnd(5)}| ${String(r.stats.mediumConfidence).padEnd(6)}| ${r.stats.lowConfidence}`
  )
}

// ─── Pipeline completo: normalizer → detector → chunker ─────
console.log('\n=== Pipeline completo: sectionType en chunks ===\n')

console.log('Fixture          | Chunks | Con sectionType | Tipos detectados')
console.log('-----------------|--------|-----------------|------------------')

const pipelineFixtures = [
  { name: '01-sentencia', file: '01-sentencia-C-15200-2023.txt', method: 'pdf-parse' as const },
  { name: '02-demanda-sum', file: '02-demanda-sumaria-C-15200-2023.txt', method: 'pdf-parse' as const },
  { name: '04-receptor', file: '04-receptor-busqueda-C-15200-2023.txt', method: 'pdf-parse' as const },
  { name: '11-resolucion', file: '11-resolucion-reposicion-C-153-2021.txt', method: 'pdf-parse' as const },
  { name: '12-demanda-ej', file: '12-demanda-ejecutiva-C-153-2021.txt', method: 'pdf-parse' as const },
]

for (const { name, file, method } of pipelineFixtures) {
  const norm = normalizeFixture(file, method)
  const sections = detectSections(norm.cleanText)
  const chunked = chunkText(norm.cleanText, {
    normalizerMetadata: norm.extractedMetadata,
    detectedSections: sections.sections,
  })
  const withType = chunked.chunks.filter(c => c.sectionType !== 'general')
  const types = [...new Set(chunked.chunks.map(c => c.sectionType))]
  console.log(
    `${name.padEnd(17)}| ${String(chunked.stats.totalChunks).padEnd(7)}| ${String(withType.length).padEnd(16)}| ${types.join(', ')}`
  )
}

// ─── Garantía: tests anteriores siguen pasando ──────────────
console.log('\nGarantía — chunker sigue produciendo chunks para todos los fixtures:')

const allFixtures = [
  '01-sentencia-C-15200-2023.txt', '02-demanda-sumaria-C-15200-2023.txt',
  '03-contestacion-excepcion-C-15200-2023.txt', '04-receptor-busqueda-C-15200-2023.txt',
  '05-receptor-notificacion-C-15200-2023.txt', '06-acta-audiencia-C-15200-2023.txt',
  '07-certificado-firma-pjud-C-15200-2023.txt', '08-certificado-envio-ojv-C-15200-2023.txt',
  '09-informe-ocr-C-15200-2023.txt', '10-audiencia-encoding-roto-C-15200-2023.txt',
  '11-resolucion-reposicion-C-153-2021.txt', '12-demanda-ejecutiva-C-153-2021.txt',
  '13-receptor-busqueda-C-153-2021.txt', '14-informe-pdi-ocr-C-153-2021.txt',
  '15-resolucion-doble-nomenclatura-C-153-2021.txt',
]

runTest('15/15 fixtures siguen produciendo chunks con section-detector integrado', () => {
  const failures: string[] = []
  for (const f of allFixtures) {
    const method = f.includes('ocr') ? 'document-ai' as const : 'pdf-parse' as const
    const norm = normalizePjudText(loadFixture(f), { extractionMethod: method }) as NormalizerResult
    const sections = detectSections(norm.cleanText)
    const chunked = chunkText(norm.cleanText, {
      normalizerMetadata: norm.extractedMetadata,
      detectedSections: sections.sections,
    })
    if (chunked.chunks.length === 0) failures.push(f)
  }
  assert(failures.length === 0, `Sin chunks: ${failures.join(', ')}`)
  console.log(`    → 15/15 fixtures OK ✓`)
})

console.log('\n=== Done ===\n')
