import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { FolderOpen, CreditCard, FileText } from 'lucide-react'

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days = Math.floor(diff / 86_400_000)
  if (mins < 1) return 'Ahora'
  if (mins < 60) return `Hace ${mins} min`
  if (hours < 24) return `Hace ${hours}h`
  if (days === 1) return 'Ayer'
  if (days < 7) return `Hace ${days} días`
  if (days < 30) return `Hace ${Math.floor(days / 7)} sem`
  return new Date(dateStr).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })
}

function getSyncDotColor(lastSyncedAt: string | null): string {
  if (!lastSyncedAt) return 'bg-gray-300'
  const hours = (Date.now() - new Date(lastSyncedAt).getTime()) / 3_600_000
  if (hours < 24) return 'bg-green-500'
  if (hours < 72) return 'bg-yellow-500'
  return 'bg-gray-300'
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: cases } = await supabase
    .from('cases')
    .select('id, rol, tribunal, caratula, document_count, last_synced_at')
    .order('updated_at', { ascending: false })
    .limit(50)

  const caseList = cases ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Mis Causas</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {caseList.length} causa{caseList.length !== 1 ? 's' : ''} sincronizada{caseList.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Link
          href="/dashboard/suscripcion"
          className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          <CreditCard className="h-4 w-4" />
          Suscripción
        </Link>
      </div>

      {caseList.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <FolderOpen className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <h3 className="text-lg font-semibold mb-1">Sin causas sincronizadas</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            Usa la extensión de Chrome para navegar a una causa en PJUD y sincronizarla.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-hidden">
          {/* Desktop table header */}
          <div className="hidden sm:grid grid-cols-[1fr_1fr_5rem_7rem] gap-4 px-4 py-3 border-b bg-muted/50 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            <span>Causa</span>
            <span>Tribunal</span>
            <span className="text-center">Docs</span>
            <span className="text-right">Última sync</span>
          </div>

          {caseList.map((c, idx) => {
            const dotColor = getSyncDotColor(c.last_synced_at)
            const docCount = c.document_count ?? 0
            return (
              <div
                key={c.id}
                className={`px-4 py-3 hover:bg-muted/30 transition-colors ${idx < caseList.length - 1 ? 'border-b' : ''}`}
              >
                {/* Desktop row */}
                <div className="hidden sm:grid grid-cols-[1fr_1fr_5rem_7rem] gap-4 items-center">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full flex-shrink-0 ${dotColor}`} />
                      <span className="text-sm font-medium truncate">{c.rol}</span>
                    </div>
                    {c.caratula && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5 pl-4">{c.caratula}</p>
                    )}
                  </div>
                  <span className="text-sm text-muted-foreground truncate">
                    {c.tribunal ?? '—'}
                  </span>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground justify-center">
                    <FileText className="h-3 w-3" />
                    <span>{docCount}</span>
                  </div>
                  <span className="text-xs text-muted-foreground text-right">
                    {c.last_synced_at ? getTimeAgo(c.last_synced_at) : '—'}
                  </span>
                </div>

                {/* Mobile row */}
                <div className="sm:hidden">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`h-2 w-2 rounded-full flex-shrink-0 ${dotColor}`} />
                      <span className="text-sm font-medium truncate">{c.rol}</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0">
                      <FileText className="h-3 w-3" />
                      <span>{docCount}</span>
                    </div>
                  </div>
                  {c.caratula && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5 pl-4">{c.caratula}</p>
                  )}
                  <div className="flex items-center justify-between mt-1 pl-4">
                    <span className="text-[11px] text-muted-foreground truncate">
                      {c.tribunal ?? '—'}
                    </span>
                    <span className="text-[11px] text-muted-foreground flex-shrink-0">
                      {c.last_synced_at ? getTimeAgo(c.last_synced_at) : '—'}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
