/**
 * Test de validación del módulo de embeddings contra API real de Google.
 * Ejecutar con: npx tsx src/lib/embeddings.test.ts
 *
 * REQUIERE: GOOGLE_API_KEY configurada en .env.local
 */
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { generateQueryEmbedding } from './embeddings'

function runTest(name: string, fn: () => Promise<void>) {
  return fn()
    .then(() => console.log(`  ✓ ${name}`))
    .catch((e) => {
      console.error(`  ✗ ${name}`)
      console.error(`    ${(e as Error).message}`)
    })
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg)
}

async function main() {
  console.log('\n=== Embedding Generation — Validation Tests ===\n')

  const apiKey = process.env.GOOGLE_API_KEY
  if (!apiKey) {
    console.error('  ✗ GOOGLE_API_KEY no encontrada en .env.local')
    console.log('\n=== Abortado ===\n')
    return
  }
  console.log(`  API Key: ${apiKey.slice(0, 10)}...${apiKey.slice(-4)}`)

  await runTest('genera embedding de query legal en español', async () => {
    const query = '¿Se notificó correctamente al demandado en la causa?'
    const vector = await generateQueryEmbedding(query)

    assert(Array.isArray(vector), 'El resultado no es un array')
    assert(vector.length === 768, `Dimensión incorrecta: ${vector.length} (esperado 768)`)
    assert(typeof vector[0] === 'number', 'Los valores no son números')
    assert(vector.some(v => v !== 0), 'El vector es todo ceros')

    console.log(`    → Dimensión: ${vector.length}`)
    console.log(`    → Primeros 5 valores: [${vector.slice(0, 5).map(v => v.toFixed(6)).join(', ')}]`)
    console.log(`    → Norma L2: ${Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)).toFixed(4)}`)
  })

  await runTest('genera embedding de chunk con prefijo contextual', async () => {
    const enrichedInput = '[Folio | Sentencia | Considerando 6 | Sumario | Folio 31 | Principal] Que, en orden de acreditar lo correspondiente, el demandante acompañó como medios de prueba la siguiente prueba instrumental.'
    const vector = await generateQueryEmbedding(enrichedInput)

    assert(vector.length === 768, `Dimensión: ${vector.length}`)
    console.log(`    → Dimensión: ${vector.length}`)
  })

  await runTest('dos queries similares producen vectores cercanos (cosine similarity)', async () => {
    const q1 = '¿Se opusieron excepciones en el juicio ejecutivo?'
    const q2 = '¿El ejecutado interpuso excepciones al mandamiento?'
    const q3 = '¿Cuál es el valor de arriendo mensual del departamento?'

    const [v1, v2, v3] = await Promise.all([
      generateQueryEmbedding(q1),
      generateQueryEmbedding(q2),
      generateQueryEmbedding(q3),
    ])

    const cosineSim = (a: number[], b: number[]) => {
      let dot = 0, normA = 0, normB = 0
      for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i]
        normA += a[i] * a[i]
        normB += b[i] * b[i]
      }
      return dot / (Math.sqrt(normA) * Math.sqrt(normB))
    }

    const simSimilar = cosineSim(v1, v2)
    const simDifferent = cosineSim(v1, v3)

    assert(simSimilar > simDifferent,
      `Queries similares (${simSimilar.toFixed(4)}) deberían ser más cercanas que las diferentes (${simDifferent.toFixed(4)})`)

    console.log(`    → Similitud (excepciones ↔ excepciones): ${simSimilar.toFixed(4)}`)
    console.log(`    → Similitud (excepciones ↔ arriendo):    ${simDifferent.toFixed(4)}`)
    console.log(`    → Diferencia: ${(simSimilar - simDifferent).toFixed(4)} (positivo = correcto)`)
  })

  console.log('\n=== Done ===\n')
}

main().catch(console.error)
