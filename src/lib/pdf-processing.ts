import { extractNativePdfText, type NativeExtractionStatus } from '@/lib/pdf-extract'
import { extractScannedPdfTextWithDocumentAi, isDocumentAiConfigured } from '@/lib/document-ai'

type ExtractionMethod = 'pdf-parse' | 'document-ai'
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
  errorMessage?: string
}

function calculateCharsPerPage(fullText: string, pageCount: number): number {
  if (pageCount <= 0) return 0
  return Math.floor(fullText.length / pageCount)
}

export async function extractPdfTextWithFallback(buffer: Buffer): Promise<PdfExtractionWithFallbackResult> {
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
    }
  }

  if (!isDocumentAiConfigured()) {
    const status: ExtractionStatus = native.status === 'needs_ocr' ? 'needs_ocr' : 'failed'
    return {
      fullText: native.fullText,
      pageCount: native.pageCount,
      charsPerPage: native.charsPerPage,
      extractionMethod: native.extractionMethod,
      status,
      ocrAttempted: false,
      ocrBatchCount: 0,
      nativeStatus: native.status,
      errorMessage:
        native.errorMessage ||
        (status === 'needs_ocr'
          ? 'PDF escaneado detectado, pero Document AI no está configurado.'
          : 'Extracción nativa falló y Document AI no está configurado.'),
    }
  }

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
    }
  }

  return {
    fullText: native.fullText,
    pageCount: native.pageCount || ocr.pageCount,
    charsPerPage: native.charsPerPage,
    extractionMethod: ocr.extractionMethod,
    status: 'failed',
    ocrAttempted: true,
    ocrBatchCount: ocr.batchCount,
    nativeStatus: native.status,
    errorMessage: ocr.errorMessage || native.errorMessage,
  }
}
