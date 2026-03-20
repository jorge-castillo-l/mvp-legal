'use client'

/**
 * ============================================================
 * Chat Page — Tarea 3.08
 * ============================================================
 * Embeddable en el sidepanel via iframe o accesible desde /chat.
 * Acepta ?caseId=xxx como query param.
 * Minimalista: modo selector + quick actions + messages + input.
 * ============================================================
 */

import { useState, useRef, useEffect, useCallback, useMemo, type FormEvent } from 'react'
import { createClient } from '@/lib/supabase/client'
import { createBrowserClient } from '@supabase/ssr'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { getQuickActions, type QuickAction } from '@/lib/ai/prompts/quick-actions'
import type { AIMode, AIStreamEvent, AIExpedienteCitation, AIWebCitation } from '@/lib/ai/types'

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations?: AIExpedienteCitation[]
  webSources?: AIWebCitation[]
  thinkingContent?: string
  isStreaming?: boolean
}

interface CaseInfo {
  id: string
  rol: string
  tribunal: string | null
  procedimiento: string | null
  caratula: string | null
}

// ─────────────────────────────────────────────────────────────
// Mode config
// ─────────────────────────────────────────────────────────────

const MODES: { value: AIMode; label: string; icon: string; description: string }[] = [
  { value: 'fast_chat', label: 'Chat Rápido', icon: '⚡', description: 'Gemini Flash' },
  { value: 'full_analysis', label: 'Análisis Completo', icon: '🔍', description: 'Claude Sonnet' },
  { value: 'deep_thinking', label: 'Pensamiento Profundo', icon: '🧠', description: 'Claude Opus' },
]

const PROCEDURE_LABELS: Record<string, string> = {
  ordinario: 'Ordinario',
  ejecutivo: 'Ejecutivo',
  sumario: 'Sumario',
  monitorio: 'Monitorio',
  voluntario: 'Voluntario',
}

// ─────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────

export default function ChatPage() {
  const [cases, setCases] = useState<CaseInfo[]>([])
  const [selectedCase, setSelectedCase] = useState<CaseInfo | null>(null)
  const [mode, setMode] = useState<AIMode>('fast_chat')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [loadingCases, setLoadingCases] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const authTokenRef = useRef<string | null>(null)

  const getAuthToken = useCallback((): string | null => {
    if (authTokenRef.current) return authTokenRef.current
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const token = params.get('token')
      if (token) {
        authTokenRef.current = token
        return token
      }
    }
    return null
  }, [])

  const getSupabaseForQuery = useCallback(() => {
    const token = getAuthToken()
    if (token) {
      return createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { global: { headers: { Authorization: `Bearer ${token}` } } },
      )
    }
    return createClient()
  }, [getAuthToken])

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'auth_token' && event.data.token) {
        authTokenRef.current = event.data.token
        loadCases()
      }
    }
    window.addEventListener('message', handleMessage)

    loadCases()
    const params = new URLSearchParams(window.location.search)
    const caseIdParam = params.get('caseId')
    if (caseIdParam) {
      loadCases().then(loadedCases => {
        const found = loadedCases?.find(c => c.id === caseIdParam)
        if (found) setSelectedCase(found)
      })
    }
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  useEffect(() => {
    if (selectedCase) {
      loadHistory(selectedCase.id, mode)
    }
  }, [selectedCase, mode])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  async function loadCases(): Promise<CaseInfo[] | undefined> {
    const supabase = getSupabaseForQuery()
    const { data } = await supabase
      .from('cases')
      .select('id, rol, tribunal, procedimiento, caratula')
      .order('updated_at', { ascending: false })
      .limit(50)

    if (data) {
      setCases(data)
      setLoadingCases(false)
      return data
    }
    setLoadingCases(false)
    return undefined
  }

  async function loadHistory(caseId: string, currentMode: AIMode) {
    const supabase = getSupabaseForQuery()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: conv } = await (supabase as any)
      .from('conversations')
      .select('id')
      .eq('case_id', caseId)
      .eq('mode', currentMode)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single()

    if (!conv) {
      setMessages([])
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: msgs } = await (supabase as any)
      .from('chat_messages')
      .select('id, role, content, sources_cited, web_sources_cited, thinking_content')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: true })
      .limit(100)

    if (msgs) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setMessages((msgs as any[]).map((m: any) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        citations: m.sources_cited as AIExpedienteCitation[] ?? [],
        webSources: m.web_sources_cited as AIWebCitation[] ?? [],
        thinkingContent: m.thinking_content ?? undefined,
      })))
    }
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    })
  }

  const sendMessage = useCallback(async (query: string) => {
    if (!selectedCase || !query.trim() || isLoading) return

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: query.trim(),
    }

    const assistantMsg: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
      citations: [],
      webSources: [],
      isStreaming: true,
    }

    setMessages(prev => [...prev, userMsg, assistantMsg])
    setInput('')
    setIsLoading(true)

    try {
      let token = getAuthToken()
      if (!token) {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        token = session?.access_token ?? null
      }

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          caseId: selectedCase.id,
          query: query.trim(),
          mode,
        }),
      })

      if (!res.ok || !res.body) {
        throw new Error(await res.text())
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const json = line.slice(6)
          try {
            const event: AIStreamEvent = JSON.parse(json)
            setMessages(prev => prev.map((msg, idx) => {
              if (idx !== prev.length - 1 || msg.role !== 'assistant') return msg

              switch (event.type) {
                case 'text_delta':
                  return { ...msg, content: msg.content + (event.delta ?? '') }
                case 'citation':
                  return event.citation
                    ? { ...msg, citations: [...(msg.citations ?? []), event.citation] }
                    : msg
                case 'web_source':
                  return event.webSource
                    ? { ...msg, webSources: [...(msg.webSources ?? []), event.webSource] }
                    : msg
                case 'thinking_delta':
                  return { ...msg, thinkingContent: (msg.thinkingContent ?? '') + (event.delta ?? '') }
                case 'done':
                  return { ...msg, isStreaming: false }
                case 'error':
                  return { ...msg, content: msg.content + `\n\n⚠️ Error: ${event.error}`, isStreaming: false }
                default:
                  return msg
              }
            }))
          } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      setMessages(prev => prev.map((msg, idx) =>
        idx === prev.length - 1 && msg.role === 'assistant'
          ? { ...msg, content: `⚠️ Error: ${err instanceof Error ? err.message : 'Error de conexión'}`, isStreaming: false }
          : msg,
      ))
    } finally {
      setIsLoading(false)
      inputRef.current?.focus()
    }
  }, [selectedCase, mode, isLoading])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    sendMessage(input)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  const quickActions = getQuickActions(selectedCase?.procedimiento)

  // ─── Case selector (no case selected) ───

  if (!selectedCase) {
    return (
      <div className="flex flex-col h-screen bg-background">
        <header className="border-b px-4 py-3">
          <h1 className="text-sm font-semibold">Selecciona una causa</h1>
        </header>
        <ScrollArea className="flex-1 p-4">
          {loadingCases ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : cases.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center mt-8">
              No hay causas sincronizadas. Sincroniza una causa desde PJUD primero.
            </p>
          ) : (
            <div className="space-y-2">
              {cases.map(c => (
                <button
                  key={c.id}
                  onClick={() => setSelectedCase(c)}
                  className="w-full text-left p-3 rounded-md border hover:bg-accent transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{c.rol}</span>
                    {c.procedimiento && (
                      <Badge variant="secondary" className="text-[10px]">
                        {PROCEDURE_LABELS[c.procedimiento] ?? c.procedimiento}
                      </Badge>
                    )}
                  </div>
                  {c.caratula && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{c.caratula}</p>
                  )}
                  {c.tribunal && (
                    <p className="text-[10px] text-muted-foreground truncate">{c.tribunal}</p>
                  )}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
    )
  }

  // ─── Main chat view ───

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <header className="border-b px-4 py-2.5 flex-shrink-0">
        <div className="flex items-center justify-between">
          <button onClick={() => setSelectedCase(null)} className="text-xs text-muted-foreground hover:text-foreground">
            ← Causas
          </button>
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium">{selectedCase.rol}</span>
            {selectedCase.procedimiento && (
              <Badge variant="outline" className="text-[10px]">
                {PROCEDURE_LABELS[selectedCase.procedimiento] ?? selectedCase.procedimiento}
              </Badge>
            )}
          </div>
        </div>

        {/* Mode selector */}
        <div className="flex gap-1 mt-2">
          {MODES.map(m => (
            <button
              key={m.value}
              onClick={() => setMode(m.value)}
              className={`flex-1 text-center py-1.5 px-2 rounded-md text-[11px] transition-colors ${
                mode === m.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              <span className="mr-1">{m.icon}</span>{m.label}
            </button>
          ))}
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0" ref={scrollRef}>
        {messages.length === 0 ? (
          <EmptyState actions={quickActions} onAction={sendMessage} disabled={isLoading} />
        ) : (
          <div className="space-y-4">
            {messages.map(msg => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            {messages.length > 0 && !isLoading && (
              <div className="pt-2 pb-2">
                <p className="text-[10px] text-muted-foreground mb-1.5">Acciones rápidas</p>
                <div className="flex flex-wrap gap-1">
                  {quickActions.slice(0, 5).map(a => (
                    <button
                      key={a.id}
                      onClick={() => sendMessage(a.query)}
                      className="text-[10px] px-2 py-1 rounded-md bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t p-3 flex-shrink-0">
        <div className="flex gap-2">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Pregunta sobre esta causa..."
            disabled={isLoading}
            rows={1}
            className="resize-none text-sm min-h-[38px] max-h-[120px]"
          />
          <Button type="submit" size="sm" disabled={isLoading || !input.trim()} className="self-end">
            {isLoading ? '...' : '→'}
          </Button>
        </div>
      </form>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Empty state with quick actions grid
// ─────────────────────────────────────────────────────────────

function EmptyState({
  actions,
  onAction,
  disabled,
}: {
  actions: QuickAction[]
  onAction: (query: string) => void
  disabled: boolean
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-8">
      <p className="text-sm text-muted-foreground mb-4">¿Qué quieres saber sobre esta causa?</p>
      <div className="grid grid-cols-2 gap-2 w-full max-w-sm">
        {actions.map(a => (
          <button
            key={a.id}
            onClick={() => onAction(a.query)}
            disabled={disabled}
            className="text-left text-xs p-2.5 rounded-md border hover:bg-accent transition-colors disabled:opacity-50"
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Message bubble
// ─────────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  const hasCitations = !isUser && message.citations && message.citations.length > 0
  const hasWebSources = !isUser && message.webSources && message.webSources.length > 0
  const hasSources = hasCitations || hasWebSources

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-lg px-3 py-2 ${
        isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'
      }`}>
        {message.isStreaming && !message.content && (
          <div className="flex gap-1 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-pulse" />
            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-pulse delay-150" />
            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-pulse delay-300" />
          </div>
        )}

        <div className="text-sm whitespace-pre-wrap break-words">
          <RenderTextWithFootnotes
            text={message.content}
            citations={message.citations}
          />
        </div>

        {message.isStreaming && message.content && (
          <span className="inline-block w-1.5 h-3 bg-foreground/50 animate-pulse ml-0.5" />
        )}

        {/* Footnotes — notas al pie numeradas con link a PDF */}
        {hasCitations && !message.isStreaming && message.citations!.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border/50">
            <Footnotes citations={message.citations!} />
          </div>
        )}

        {/* Jurisprudencia — acordeón colapsado */}
        {hasWebSources && !message.isStreaming && (
          <details className="mt-1.5">
            <summary className="text-[10px] font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
              🌐 Ver {message.webSources!.length} fuente{message.webSources!.length !== 1 ? 's' : ''} de jurisprudencia
            </summary>
            <div className="mt-1">
              <JurisprudenciaCitations sources={message.webSources!} />
            </div>
          </details>
        )}

        {/* Thinking content (collapsible) */}
        {!isUser && message.thinkingContent && (
          <details className="mt-2 pt-2 border-t border-border/50">
            <summary className="text-[10px] text-muted-foreground cursor-pointer">
              🧠 Ver razonamiento
            </summary>
            <p className="text-[10px] text-muted-foreground mt-1 whitespace-pre-wrap">
              {message.thinkingContent}
            </p>
          </details>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Expediente Citations — formato "a fojas" agrupadas por tipo
// ─────────────────────────────────────────────────────────────

const DOC_TYPE_DISPLAY: Record<string, string> = {
  sentencia: 'Sentencias',
  resolucion: 'Resoluciones',
  resolución: 'Resoluciones',
  escrito: 'Escritos',
  actuacion: 'Actuaciones',
  actuación: 'Actuaciones',
  demanda: 'Demanda',
  contestacion: 'Contestación',
  contestación: 'Contestación',
  mandamiento: 'Mandamiento',
  auto_prueba: 'Auto de Prueba',
  acta_embargo: 'Acta de Embargo',
  acta_audiencia: 'Acta de Audiencia',
}

function ExpedienteCitations({ citations }: { citations: AIExpedienteCitation[] }) {
  const grouped = new Map<string, AIExpedienteCitation[]>()

  for (const c of citations) {
    const type = c.documentType ?? 'documento'
    const existing = grouped.get(type) ?? []
    existing.push(c)
    grouped.set(type, existing)
  }

  return (
    <div>
      <p className="text-[10px] font-semibold text-muted-foreground mb-1">📄 FUENTES DEL EXPEDIENTE</p>
      {Array.from(grouped.entries()).map(([type, cites]) => (
        <div key={type} className="mb-1.5">
          <p className="text-[10px] font-medium text-muted-foreground/80">
            {DOC_TYPE_DISPLAY[type.toLowerCase()] ?? capitalize(type)}
          </p>
          {cites.map((c, i) => (
            <div key={i} className="pl-2 mb-0.5">
              <div className="flex items-center gap-1">
                <p className="text-[10px] text-muted-foreground">
                  {formatFojaCitation(c)}
                </p>
                {c.documentId && (
                  <a
                    href={`/pdf-viewer?documentId=${c.documentId}${c.pageNumber ? `&page=${c.pageNumber}` : ''}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[9px] text-blue-500 hover:underline flex-shrink-0"
                  >
                    Ver PDF →
                  </a>
                )}
              </div>
              {c.citedText && (
                <p className="text-[10px] text-muted-foreground/60 italic pl-1 truncate">
                  &ldquo;{c.citedText.slice(0, 120)}{c.citedText.length > 120 ? '...' : ''}&rdquo;
                </p>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function formatFojaCitation(c: AIExpedienteCitation): string {
  const parts: string[] = []

  if (c.foja != null) {
    parts.push(`A fojas ${c.foja}`)
  }

  if (c.cuaderno) {
    parts.push(`cuaderno ${c.cuaderno}`)
  }

  if (c.fechaTramite) {
    parts.push(`(${c.fechaTramite})`)
  } else if (c.folioNumero != null) {
    parts.push(`folio ${c.folioNumero}`)
  }

  if (parts.length === 0) {
    const fallback = [
      c.documentType,
      c.folioNumero != null ? `folio ${c.folioNumero}` : null,
      c.fechaTramite,
    ].filter(Boolean)
    return fallback.join(', ') || 'Documento del expediente'
  }

  return parts.join(', ')
}

// ─────────────────────────────────────────────────────────────
// Jurisprudencia Citations — agrupadas por tribunal/dominio
// ─────────────────────────────────────────────────────────────

function JurisprudenciaCitations({ sources }: { sources: AIWebCitation[] }) {
  const grouped = new Map<string, AIWebCitation[]>()

  for (const ws of sources) {
    const tribunal = inferTribunal(ws)
    const existing = grouped.get(tribunal) ?? []
    existing.push(ws)
    grouped.set(tribunal, existing)
  }

  return (
    <div>
      <p className="text-[10px] font-semibold text-muted-foreground mb-1">🌐 JURISPRUDENCIA</p>
      {Array.from(grouped.entries()).map(([tribunal, cites]) => (
        <div key={tribunal} className="mb-1.5">
          <p className="text-[10px] font-medium text-muted-foreground/80">{tribunal}</p>
          {cites.map((ws, i) => (
            <div key={i} className="pl-2 mb-0.5">
              <a
                href={ws.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-blue-500 hover:underline"
              >
                {ws.title || 'Ver sentencia →'}
              </a>
              {ws.snippet && (
                <p className="text-[10px] text-muted-foreground/60 italic pl-1 truncate">
                  &ldquo;{ws.snippet.slice(0, 120)}{ws.snippet.length > 120 ? '...' : ''}&rdquo;
                </p>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function inferTribunal(ws: AIWebCitation): string {
  const text = `${ws.title} ${ws.url}`.toLowerCase()
  if (text.includes('suprema')) return 'Corte Suprema'
  if (text.includes('apelaciones') || text.includes('corte de')) return 'Corte de Apelaciones'
  if (text.includes('vlex')) return 'Doctrina (vLex)'
  if (text.includes('pjud') || text.includes('juris')) return 'Poder Judicial'
  return 'Fuentes web'
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ─────────────────────────────────────────────────────────────
// Footnote system — superíndices clickeables + notas al pie
// ─────────────────────────────────────────────────────────────

function RenderTextWithFootnotes({
  text,
  citations,
}: {
  text: string
  citations?: AIExpedienteCitation[]
}) {
  if (!citations?.length || !text.includes('[')) {
    return <>{text}</>
  }

  const parts = text.split(/(\[\d+\])/)

  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/^\[(\d+)\]$/)
        if (match) {
          const num = parseInt(match[1], 10)
          const cite = citations[num - 1]
          if (!cite) return <span key={i}>{part}</span>

          const pdfLink = cite.documentId
            ? `/pdf-viewer?documentId=${cite.documentId}${cite.pageNumber ? `&page=${cite.pageNumber}` : ''}`
            : null

          return pdfLink ? (
            <a
              key={i}
              href={pdfLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center w-4 h-4 text-[9px] font-medium bg-blue-100 text-blue-700 rounded-full hover:bg-blue-200 transition-colors cursor-pointer ml-0.5 no-underline align-super"
              title={formatFootnoteTooltip(cite)}
            >
              {num}
            </a>
          ) : (
            <span
              key={i}
              className="inline-flex items-center justify-center w-4 h-4 text-[9px] font-medium bg-muted text-muted-foreground rounded-full ml-0.5 align-super"
              title={formatFootnoteTooltip(cite)}
            >
              {num}
            </span>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </>
  )
}

function formatFootnoteTooltip(c: AIExpedienteCitation): string {
  const parts = [
    c.foja != null ? `A fojas ${c.foja}` : null,
    c.cuaderno ? `cuaderno ${c.cuaderno}` : null,
    c.fechaTramite ? `(${c.fechaTramite})` : null,
    c.documentType,
  ].filter(Boolean)
  return parts.join(', ') || 'Fuente del expediente'
}

function Footnotes({ citations }: { citations: AIExpedienteCitation[] }) {
  if (citations.length === 0) return null

  return (
    <details>
      <summary className="text-[10px] font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
        📄 {citations.length} fuente{citations.length !== 1 ? 's' : ''} del expediente
      </summary>
      <div className="mt-1 space-y-0.5">
        {citations.map((c, i) => {
          const pdfLink = c.documentId
            ? `/pdf-viewer?documentId=${c.documentId}${c.pageNumber ? `&page=${c.pageNumber}` : ''}`
            : null

          return (
            <div key={i} className="flex items-start gap-1.5 pl-1">
              <span className="inline-flex items-center justify-center w-4 h-4 text-[9px] font-medium bg-muted text-muted-foreground rounded-full flex-shrink-0 mt-0.5">
                {i + 1}
              </span>
              <div className="min-w-0">
                <span className="text-[10px] text-muted-foreground">
                  {formatFojaCitation(c)}
                </span>
                {pdfLink && (
                  <a
                    href={pdfLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[9px] text-blue-500 hover:underline ml-1"
                  >
                    Ver PDF →
                  </a>
                )}
                {c.citedText && (
                  <p className="text-[10px] text-muted-foreground/60 italic truncate">
                    &ldquo;{c.citedText.slice(0, 100)}{c.citedText.length > 100 ? '...' : ''}&rdquo;
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </details>
  )
}
