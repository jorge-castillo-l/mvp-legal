import { extractNativePdfText, type NativeExtractionStatus } from '@/lib/pdf-extract'
import { extractScannedPdfTextWithDocumentAi, isDocumentAiConfigured } from '@/lib/document-ai'
import { extractWithTesseract } from '@/lib/tesseract-ocr'

type ExtractionMethod = 'pdf-parse' | 'document-ai' | 'tesseract'
type ExtractionStatus = 'completed' | 'needs_ocr' | 'failed'

export interface PdfExtractionWithFallbackResult {
  fullText: string
  pageCount: number
  charsPerPage: number
  extractionMethod: ExtractionMethod
  status: ExtractionStatus
  ocrAttempted: boolean
  ocrBatchCount: number
  nativeStatus: NativeExtractionStatus
  tesseractAttempted: boolean
  errorMessage?: string
}

function calculateCharsPerPage(fullText: string, pageCount: number): number {
  if (pageCount <= 0) return 0
  return Math.floor(fullText.length / pageCount)
}

export async function extractPdfTextWithFallback(buffer: Buffer): Promise<PdfExtractionWithFallbackResult> {
  // ── Paso 1: pdf-parse (texto nativo, gratis) ──
  const native = await extractNativePdfText(buffer)

  if (native.status === 'completed') {
    return {
      fullText: native.fullText,
      pageCount: native.pageCount,
      charsPerPage: native.charsPerPage,
      extractionMethod: native.extractionMethod,
      status: native.status,
      ocrAttempted: false,
      ocrBatchCount: 0,
      nativeStatus: native.status,
      tesseractAttempted: false,
    }
  }

  // ── Paso 2: Document AI (OCR Google, pagado) ──
  if (isDocumentAiConfigured()) {
    const ocr = await extractScannedPdfTextWithDocumentAi(buffer)
    if (ocr.status === 'completed') {
      return {
        fullText: ocr.fullText,
        pageCount: ocr.pageCount,
        charsPerPage: calculateCharsPerPage(ocr.fullText, ocr.pageCount),
        extractionMethod: ocr.extractionMethod,
        status: ocr.status,
        ocrAttempted: true,
        ocrBatchCount: ocr.batchCount,
        nativeStatus: native.status,
        tesseractAttempted: false,
      }
    }

    console.warn('[Pipeline] Document AI falló, intentando Tesseract como último recurso…')
  } else {
    console.warn('[Pipeline] Document AI no configurado, intentando Tesseract…')
  }

  // ── Paso 3: Tesseract.js (OCR clásico, gratis, local) ──
  try {
    const tess = await extractWithTesseract(buffer)
    if (tess.status === 'completed') {
      return {
        fullText: tess.fullText,
        pageCount: tess.pageCount,
        charsPerPage: calculateCharsPerPage(tess.fullText, tess.pageCount),
        extractionMethod: tess.extractionMethod,
        status: 'completed',
        ocrAttempted: true,
        ocrBatchCount: 0,
        nativeStatus: native.status,
        tesseractAttempted: true,
      }
    }

    console.error(`[Pipeline] Tesseract también falló: ${tess.errorMessage}`)
  } catch (tessError) {
    console.error('[Pipeline] Error inesperado en Tesseract:', tessError)
  }

  // ── Los 3 métodos fallaron ──
  return {
    fullText: native.fullText,
    pageCount: native.pageCount,
    charsPerPage: native.charsPerPage,
    extractionMethod: 'tesseract',
    status: 'failed',
    ocrAttempted: true,
    ocrBatchCount: 0,
    nativeStatus: native.status,
    tesseractAttempted: true,
    errorMessage: 'Los 3 métodos de extracción fallaron (pdf-parse, Document AI, Tesseract).',
  }
}
