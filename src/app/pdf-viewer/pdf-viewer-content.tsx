'use client'

import { useState, useEffect, useCallback } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { createClient } from '@/lib/supabase/client'

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`

export default function PdfViewerContent() {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [containerWidth, setContainerWidth] = useState(400)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const documentId = params.get('documentId')
    const page = parseInt(params.get('page') ?? '1', 10)

    if (!documentId) {
      setError('Falta parámetro documentId')
      setLoading(false)
      return
    }

    if (page > 0) setCurrentPage(page)
    fetchPdfUrl(documentId)
  }, [])

  useEffect(() => {
    function handleResize() {
      setContainerWidth(Math.min(window.innerWidth - 32, 600))
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  async function fetchPdfUrl(documentId: string) {
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()

      const res = await fetch(`/api/documents/${documentId}/url`, {
        headers: session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {},
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Error desconocido' }))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }

      const { url } = await res.json()
      setPdfUrl(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando PDF')
    } finally {
      setLoading(false)
    }
  }

  const onDocumentLoadSuccess = useCallback(({ numPages: total }: { numPages: number }) => {
    setNumPages(total)
  }, [])

  function goToPage(page: number) {
    if (page >= 1 && page <= numPages) setCurrentPage(page)
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background gap-3">
        <Skeleton className="h-[500px] w-[350px]" />
        <p className="text-xs text-muted-foreground">Cargando documento...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="flex items-center justify-between border-b px-3 py-2 flex-shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => goToPage(currentPage - 1)}
          disabled={currentPage <= 1}
          className="text-xs h-7 px-2"
        >
          ← Anterior
        </Button>

        <span className="text-xs text-muted-foreground">
          {currentPage} / {numPages || '...'}
        </span>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => goToPage(currentPage + 1)}
          disabled={currentPage >= numPages}
          className="text-xs h-7 px-2"
        >
          Siguiente →
        </Button>
      </header>

      <div className="flex-1 overflow-auto flex justify-center py-2 bg-muted/30">
        {pdfUrl && (
          <Document
            file={pdfUrl}
            onLoadSuccess={onDocumentLoadSuccess}
            loading={
              <div className="flex flex-col items-center gap-2 pt-8">
                <Skeleton className="h-[600px] w-[350px]" />
              </div>
            }
            error={
              <p className="text-sm text-destructive text-center pt-8">
                Error renderizando el PDF
              </p>
            }
          >
            <Page
              pageNumber={currentPage}
              width={containerWidth}
              loading={<Skeleton className="h-[600px]" style={{ width: containerWidth }} />}
            />
          </Document>
        )}
      </div>

      {numPages > 1 && (
        <footer className="border-t px-3 py-2 flex-shrink-0">
          <div className="flex items-center gap-2 justify-center">
            <span className="text-[10px] text-muted-foreground">Ir a página:</span>
            <input
              type="number"
              min={1}
              max={numPages}
              value={currentPage}
              onChange={e => {
                const p = parseInt(e.target.value, 10)
                if (!isNaN(p)) goToPage(p)
              }}
              className="w-14 text-center text-xs border rounded px-1 py-0.5 bg-background"
            />
          </div>
        </footer>
      )}
    </div>
  )
}
