import { PDFParse } from 'pdf-parse'

export const MIN_NATIVE_TEXT_CHARS_PER_PAGE = 50

export type NativeExtractionStatus = 'completed' | 'needs_ocr' | 'failed'

export interface NativePdfExtractionResult {
  fullText: string
  pageCount: number
  charsPerPage: number
  extractionMethod: 'pdf-parse'
  status: NativeExtractionStatus
  errorMessage?: string
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\u0000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function calculateCharsPerPage(fullText: string, pageCount: number): number {
  if (pageCount <= 0) return 0
  return Math.floor(fullText.length / pageCount)
}

export async function extractNativePdfText(buffer: Buffer): Promise<NativePdfExtractionResult> {
  const parser = new PDFParse({ data: buffer })

  try {
    const textResult = await parser.getText()
    const fallbackText = textResult.pages.map((page) => page.text || '').join('\n\n')
    const fullText = normalizeExtractedText(textResult.text || fallbackText)
    const pageCount = textResult.total || textResult.pages.length || 0
    const charsPerPage = calculateCharsPerPage(fullText, pageCount)
    const status: NativeExtractionStatus =
      charsPerPage < MIN_NATIVE_TEXT_CHARS_PER_PAGE ? 'needs_ocr' : 'completed'

    return {
      fullText,
      pageCount,
      charsPerPage,
      extractionMethod: 'pdf-parse',
      status,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'unknown_pdf_parse_error'

    return {
      fullText: '',
      pageCount: 0,
      charsPerPage: 0,
      extractionMethod: 'pdf-parse',
      status: 'failed',
      errorMessage,
    }
  } finally {
    await parser.destroy().catch(() => undefined)
  }
}
