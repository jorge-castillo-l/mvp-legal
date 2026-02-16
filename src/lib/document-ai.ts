import { DocumentProcessorServiceClient } from '@google-cloud/documentai'
import { PDFDocument } from 'pdf-lib'

export const DOCUMENT_AI_BATCH_PAGE_SIZE = 15

type DocumentAiStatus = 'completed' | 'failed'

interface DocumentAiCredentials {
  client_email: string
  private_key: string
}

interface DocumentAiConfig {
  projectId: string
  location: string
  processorId: string
  credentials?: DocumentAiCredentials
}

interface PdfBatch {
  bytes: Uint8Array
  pageOffset: number
  pageCount: number
}

export interface OcrPageMetadata {
  pageNumber: number
  textLength: number
}

export interface DocumentAiExtractionResult {
  fullText: string
  pageCount: number
  extractionMethod: 'document-ai'
  status: DocumentAiStatus
  pages: OcrPageMetadata[]
  batchCount: number
  errorMessage?: string
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\u0000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseCredentialsFromEnv(): DocumentAiCredentials | undefined {
  const credentialsBase64 = process.env.GOOGLE_DOCUMENT_AI_CREDENTIALS_BASE64
  if (!credentialsBase64) return undefined

  try {
    const decoded = Buffer.from(credentialsBase64, 'base64').toString('utf8')
    const parsed = JSON.parse(decoded) as Partial<DocumentAiCredentials>
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error('credentials_missing_fields')
    }

    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid_credentials_payload'
    throw new Error(`GOOGLE_DOCUMENT_AI_CREDENTIALS_BASE64 inválida: ${message}`)
  }
}

function getDocumentAiConfig(): DocumentAiConfig | null {
  const projectId = process.env.GOOGLE_DOCUMENT_AI_PROJECT_ID
  const location = process.env.GOOGLE_DOCUMENT_AI_LOCATION
  const processorId = process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID

  if (!projectId || !location || !processorId) {
    return null
  }

  return {
    projectId,
    location,
    processorId,
    credentials: parseCredentialsFromEnv(),
  }
}

export function isDocumentAiConfigured(): boolean {
  return getDocumentAiConfig() !== null
}

function getTextFromTextAnchor(
  fullText: string,
  textAnchor?: { textSegments?: Array<{ startIndex?: string | number | null; endIndex?: string | number | null }> } | null
): string {
  if (!textAnchor?.textSegments?.length) return ''

  return textAnchor.textSegments
    .map((segment) => {
      const start = Number(segment.startIndex ?? 0)
      const end = Number(segment.endIndex ?? 0)
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return ''
      }
      return fullText.slice(start, end)
    })
    .join('')
}

async function createPdfBatches(buffer: Buffer, batchSize: number): Promise<PdfBatch[]> {
  const source = await PDFDocument.load(buffer, { ignoreEncryption: true })
  const totalPages = source.getPageCount()

  if (totalPages === 0) {
    return []
  }

  const batches: PdfBatch[] = []
  for (let start = 0; start < totalPages; start += batchSize) {
    const end = Math.min(start + batchSize, totalPages)
    const target = await PDFDocument.create()
    const pageIndexes = Array.from({ length: end - start }, (_, index) => start + index)
    const copiedPages = await target.copyPages(source, pageIndexes)

    copiedPages.forEach((page) => target.addPage(page))
    const bytes = await target.save({ useObjectStreams: false })

    batches.push({
      bytes,
      pageOffset: start,
      pageCount: end - start,
    })
  }

  return batches
}

async function processBatch(
  client: DocumentProcessorServiceClient,
  processorName: string,
  batch: PdfBatch
): Promise<{ text: string; pages: OcrPageMetadata[] }> {
  const [result] = await client.processDocument({
    name: processorName,
    rawDocument: {
      content: Buffer.from(batch.bytes).toString('base64'),
      mimeType: 'application/pdf',
    },
  })

  const document = result.document
  const rawText = document?.text || ''
  const normalizedText = normalizeExtractedText(rawText)

  const pages = (document?.pages || []).map((page, index) => {
    const pageText = normalizeExtractedText(
      getTextFromTextAnchor(rawText, page.layout?.textAnchor as { textSegments?: Array<{ startIndex?: string | number | null; endIndex?: string | number | null }> } | undefined)
    )

    return {
      pageNumber: batch.pageOffset + index + 1,
      textLength: pageText.length,
    }
  })

  return { text: normalizedText, pages }
}

export async function extractScannedPdfTextWithDocumentAi(buffer: Buffer): Promise<DocumentAiExtractionResult> {
  const config = getDocumentAiConfig()
  if (!config) {
    return {
      fullText: '',
      pageCount: 0,
      extractionMethod: 'document-ai',
      status: 'failed',
      pages: [],
      batchCount: 0,
      errorMessage:
        'Document AI no configurado. Faltan variables GOOGLE_DOCUMENT_AI_PROJECT_ID / LOCATION / PROCESSOR_ID.',
    }
  }

  const client = new DocumentProcessorServiceClient({
    apiEndpoint: `${config.location}-documentai.googleapis.com`,
    ...(config.credentials ? { credentials: config.credentials } : {}),
  })

  const processorName = `projects/${config.projectId}/locations/${config.location}/processors/${config.processorId}`

  try {
    const batches = await createPdfBatches(buffer, DOCUMENT_AI_BATCH_PAGE_SIZE)
    if (batches.length === 0) {
      return {
        fullText: '',
        pageCount: 0,
        extractionMethod: 'document-ai',
        status: 'failed',
        pages: [],
        batchCount: 0,
        errorMessage: 'El PDF no contiene páginas procesables.',
      }
    }

    const textParts: string[] = []
    const pages: OcrPageMetadata[] = []

    for (const batch of batches) {
      const parsedBatch = await processBatch(client, processorName, batch)
      if (parsedBatch.text) {
        textParts.push(parsedBatch.text)
      }

      if (parsedBatch.pages.length > 0) {
        pages.push(...parsedBatch.pages)
      } else {
        // Si Document AI no entrega metadata por página, mantenemos conteo mínimo por lote.
        for (let i = 0; i < batch.pageCount; i += 1) {
          pages.push({
            pageNumber: batch.pageOffset + i + 1,
            textLength: 0,
          })
        }
      }
    }

    const fullText = normalizeExtractedText(textParts.join('\n\n'))
    if (!fullText) {
      return {
        fullText: '',
        pageCount: pages.length,
        extractionMethod: 'document-ai',
        status: 'failed',
        pages,
        batchCount: batches.length,
        errorMessage: 'Document AI devolvió texto vacío.',
      }
    }

    return {
      fullText,
      pageCount: pages.length,
      extractionMethod: 'document-ai',
      status: 'completed',
      pages,
      batchCount: batches.length,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'document_ai_unknown_error'
    return {
      fullText: '',
      pageCount: 0,
      extractionMethod: 'document-ai',
      status: 'failed',
      pages: [],
      batchCount: 0,
      errorMessage,
    }
  }
}
