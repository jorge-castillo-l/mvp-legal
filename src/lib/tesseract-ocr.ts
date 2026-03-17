/**
 * Tesseract.js OCR — Fallback de último recurso
 *
 * Convierte cada página del PDF a imagen PNG y aplica OCR clásico
 * con Tesseract (motor local, gratis). Más lento que Document AI
 * pero más resiliente con fotocopias degradadas de inscripciones
 * conservatorias, escrituras notariales y documentos escaneados
 * de baja calidad típicos del PJUD.
 *
 * Renderizado: pdfjs-dist (con workers deshabilitados para Node.js)
 *              + canvas (prebuilt native, sin workers problemáticos)
 */

import Tesseract from 'tesseract.js'
import { createCanvas } from 'canvas'

export interface TesseractExtractionResult {
  fullText: string
  pageCount: number
  extractionMethod: 'tesseract'
  status: 'completed' | 'failed'
  pagesExtracted: number
  errorMessage?: string
}

const TESSERACT_LANG = 'spa+eng'
const RENDER_SCALE = 2

async function pdfToImages(buffer: Buffer): Promise<Buffer[]> {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjsLib.GlobalWorkerOptions.workerSrc = ''

  const uint8 = new Uint8Array(buffer)
  const doc = await pdfjsLib.getDocument({
    data: uint8,
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
  }).promise

  const images: Buffer[] = []

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const viewport = page.getViewport({ scale: RENDER_SCALE })

    const canvas = createCanvas(
      Math.floor(viewport.width),
      Math.floor(viewport.height)
    )
    const ctx = canvas.getContext('2d')

    await page.render({
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise

    const pngBuffer = canvas.toBuffer('image/png')
    images.push(pngBuffer)
    page.cleanup()
  }

  doc.destroy()
  return images
}

export async function extractWithTesseract(buffer: Buffer): Promise<TesseractExtractionResult> {
  try {
    const images = await pdfToImages(buffer)

    if (images.length === 0) {
      return {
        fullText: '',
        pageCount: 0,
        extractionMethod: 'tesseract',
        status: 'failed',
        pagesExtracted: 0,
        errorMessage: 'No se pudieron renderizar páginas del PDF.',
      }
    }

    const textParts: string[] = []
    let pagesExtracted = 0

    for (let i = 0; i < images.length; i++) {
      try {
        const { data } = await Tesseract.recognize(images[i], TESSERACT_LANG)
        const pageText = (data.text || '').trim()

        if (pageText.length > 10) {
          textParts.push(pageText)
          pagesExtracted++
        } else {
          console.warn(`[Tesseract] Página ${i + 1}/${images.length}: texto insuficiente (${pageText.length} chars)`)
        }
      } catch (pageErr) {
        console.error(`[Tesseract] Error en página ${i + 1}:`, pageErr)
      }
    }

    const fullText = textParts.join('\n\n').trim()

    if (!fullText) {
      return {
        fullText: '',
        pageCount: images.length,
        extractionMethod: 'tesseract',
        status: 'failed',
        pagesExtracted: 0,
        errorMessage: `Tesseract no pudo extraer texto de ${images.length} página(s).`,
      }
    }

    if (pagesExtracted < images.length) {
      console.warn(
        `[Tesseract] Extracción parcial: ${pagesExtracted}/${images.length} páginas con texto.` +
        ` Se descarta resultado parcial.`
      )
      return {
        fullText: '',
        pageCount: images.length,
        extractionMethod: 'tesseract',
        status: 'failed',
        pagesExtracted,
        errorMessage: `Solo ${pagesExtracted}/${images.length} páginas con texto — descartado para evitar contexto incompleto.`,
      }
    }

    console.log(`[Tesseract] OCR exitoso: ${images.length} páginas, ${fullText.length} chars`)

    return {
      fullText,
      pageCount: images.length,
      extractionMethod: 'tesseract',
      status: 'completed',
      pagesExtracted,
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido en Tesseract OCR'
    console.error('[Tesseract] Error:', msg)

    return {
      fullText: '',
      pageCount: 0,
      extractionMethod: 'tesseract',
      status: 'failed',
      pagesExtracted: 0,
      errorMessage: msg,
    }
  }
}
