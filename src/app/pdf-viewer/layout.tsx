export const metadata = {
  title: 'Visor PDF — MVP Legal',
}

export default function PdfViewerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen w-full overflow-hidden">
      {children}
    </div>
  )
}
