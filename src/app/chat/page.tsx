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

import { useState, useRef, useEffect, useCallback, type FormEvent } from 'react'
import { createClient } from '@/lib/supabase/client'
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

  useEffect(() => {
    loadCases()
    const params = new URLSearchParams(window.location.search)
    const caseIdParam = params.get('caseId')
    if (caseIdParam) {
      loadCases().then(loadedCases => {
        const found = loadedCases?.find(c => c.id === caseIdParam)
        if (found) setSelectedCase(found)
      })
    }
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
    const supabase = createClient()
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
    const supabase = createClient()
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
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
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
            setMessages(prev => {
              const updated = [...prev]
              const last = updated[updated.length - 1]
              if (!last || last.role !== 'assistant') return prev

              switch (event.type) {
                case 'text_delta':
                  last.content += event.delta ?? ''
                  break
                case 'citation':
                  if (event.citation) last.citations = [...(last.citations ?? []), event.citation]
                  break
                case 'web_source':
                  if (event.webSource) last.webSources = [...(last.webSources ?? []), event.webSource]
                  break
                case 'thinking_delta':
                  last.thinkingContent = (last.thinkingContent ?? '') + (event.delta ?? '')
                  break
                case 'done':
                  last.isStreaming = false
                  break
                case 'error':
                  last.content += `\n\n⚠️ Error: ${event.error}`
                  last.isStreaming = false
                  break
              }
              return updated
            })
          } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      setMessages(prev => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        if (last?.role === 'assistant') {
          last.content = `⚠️ Error: ${err instanceof Error ? err.message : 'Error de conexión'}`
          last.isStreaming = false
        }
        return updated
      })
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
      <ScrollArea className="flex-1 px-4 py-3" ref={scrollRef}>
        {messages.length === 0 ? (
          <EmptyState actions={quickActions} onAction={sendMessage} disabled={isLoading} />
        ) : (
          <div className="space-y-4">
            {messages.map(msg => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            {messages.length > 0 && !isLoading && (
              <div className="pt-2">
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
      </ScrollArea>

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

        <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>

        {message.isStreaming && message.content && (
          <span className="inline-block w-1.5 h-3 bg-foreground/50 animate-pulse ml-0.5" />
        )}

        {/* Dual Citation System — formato forense chileno */}
        {hasSources && !message.isStreaming && (
          <div className="mt-2.5 pt-2 border-t border-border/50 space-y-2">

            {/* Fuentes del Expediente — formato "a fojas" */}
            {hasCitations && (
              <ExpedienteCitations citations={message.citations!} />
            )}

            {/* Jurisprudencia — agrupada por tribunal */}
            {hasWebSources && (
              <JurisprudenciaCitations sources={message.webSources!} />
            )}
          </div>
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
