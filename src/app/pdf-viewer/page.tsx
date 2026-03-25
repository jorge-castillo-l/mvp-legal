'use client'

/**
 * ============================================================
 * PDF Viewer — Tarea 3.11
 * ============================================================
 * Visor de PDF embebido. Recibe documentId y page como params.
 * Obtiene signed URL del API y renderiza con react-pdf.
 *
 * URL: /pdf-viewer?documentId=xxx&page=5
 *
 * Usa dynamic import con ssr:false para evitar que pdfjs-dist
 * se cargue en Node.js (donde DOMMatrix no existe).
 * ============================================================
 */

import dynamic from 'next/dynamic'
import { Skeleton } from '@/components/ui/skeleton'

const PdfViewerContent = dynamic(
  () => import('./pdf-viewer-content'),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-col items-center justify-center h-screen bg-background gap-3">
        <Skeleton className="h-[500px] w-[350px]" />
        <p className="text-xs text-muted-foreground">Cargando visor...</p>
      </div>
    ),
  },
)

export default function PdfViewerPage() {
  return <PdfViewerContent />
}
