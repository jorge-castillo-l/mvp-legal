'use client'

/**
 * ============================================================
 * Chat Page — Tarea 3.08 (v3: multi-conversación por causa)
 * ============================================================
 * Embeddable en el sidepanel via iframe o accesible desde /chat.
 * Acepta ?caseId=xxx como query param.
 *
 * v3 changes:
 *   - Multiple conversations per case (thread-based)
 *   - Three-level navigation: Cases → Conversations → Chat
 *   - Create / delete conversations from UI
 *   - Auto-title from first user query (server-side)
 *
 * v2 changes:
 *   - Compact mode selector next to send button
 *   - Renamed modes: Rápido / Avanzado / Experto
 *   - Model badge on assistant messages
 *   - AbortController for stream cancellation
 * ============================================================
 */

import { useState, useRef, useEffect, useCallback, useMemo, type FormEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { createClient } from '@/lib/supabase/client'
import { createBrowserClient } from '@supabase/ssr'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import type { AIMode, AIStreamEvent, AIExpedienteCitation, AIWebCitation } from '@/lib/ai/types'
import { getQuickActions, type QuickAction } from '@/lib/ai/prompts/quick-actions'

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
  modelUsed?: string | null
}

interface CaseInfo {
  id: string
  rol: string
  tribunal: string | null
  procedimiento: string | null
  caratula: string | null
  document_count: number | null
  last_synced_at: string | null
}

interface ConversationInfo {
  id: string
  title: string | null
  mode: string
  created_at: string
  updated_at: string
}

// ─────────────────────────────────────────────────────────────
// Mode config
// ─────────────────────────────────────────────────────────────

const MODES: { value: AIMode; label: string; icon: string; hint: string }[] = [
  { value: 'fast_chat', label: 'Rápido', icon: '⚡', hint: 'Consultas ágiles' },
  { value: 'full_analysis', label: 'Avanzado', icon: '◆', hint: 'Análisis detallado' },
  { value: 'deep_thinking', label: 'Experto', icon: '◈', hint: 'Razonamiento profundo' },
]

const MODEL_BADGE: Record<string, { label: string; icon: string }> = {
  'gemini-3-flash-preview': { label: 'Rápido', icon: '⚡' },
  'claude-sonnet-4-20250514': { label: 'Avanzado', icon: '◆' },
  'claude-opus-4-20250514': { label: 'Experto', icon: '◈' },
  'claude-sonnet-4-6': { label: 'Avanzado', icon: '◆' },
  'claude-opus-4-6': { label: 'Experto', icon: '◈' },
}

function getModeBadge(modelUsed: string | null | undefined): { label: string; icon: string } | null {
  if (!modelUsed) return null
  return MODEL_BADGE[modelUsed] ?? null
}

const MODE_TO_MODEL: Record<AIMode, string> = {
  fast_chat: 'gemini-3-flash-preview',
  full_analysis: 'claude-sonnet-4-6',
  deep_thinking: 'claude-opus-4-6',
}


// ─────────────────────────────────────────────────────────────
// Freshness & time helpers
// ─────────────────────────────────────────────────────────────

function getFreshness(lastSyncedAt: string | null): { className: string; textClass: string } {
  if (!lastSyncedAt) return { className: 'bg-muted text-muted-foreground', textClass: 'text-muted-foreground' }
  const hours = (Date.now() - new Date(lastSyncedAt).getTime()) / 3_600_000
  if (hours < 24) return { className: 'bg-green-50 text-green-700 border-green-200', textClass: 'text-green-600' }
  if (hours < 72) return { className: 'bg-yellow-50 text-yellow-700 border-yellow-200', textClass: 'text-yellow-600' }
  return { className: 'bg-muted text-muted-foreground', textClass: 'text-muted-foreground' }
}

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
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<CaseInfo | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [conversations, setConversations] = useState<ConversationInfo[]>([])
  const [selectedConversation, setSelectedConversation] = useState<ConversationInfo | null>(null)
  const [loadingConversations, setLoadingConversations] = useState(false)
  const [deleteConvTarget, setDeleteConvTarget] = useState<ConversationInfo | null>(null)
  const [isDeletingConv, setIsDeletingConv] = useState(false)
  const [isCreatingConv, setIsCreatingConv] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; conv: ConversationInfo } | null>(null)
  const [renamingConvId, setRenamingConvId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const authTokenRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const currentMode = MODES.find(m => m.value === mode)!
  const quickActions = useMemo(
    () => getQuickActions(selectedCase?.procedimiento),
    [selectedCase?.procedimiento],
  )

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
    let initialLoadDone = false
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'auth_token' && event.data.token) {
        authTokenRef.current = event.data.token
        if (!initialLoadDone) {
          initialLoadDone = true
          loadCases()
        }
      }
      if (event.data?.type === 'case_deleted' && event.data.caseId) {
        const deletedCaseId = event.data.caseId
        setCases(prev => prev.filter(c => c.id !== deletedCaseId))
        setSelectedCase(prev => {
          if (prev?.id === deletedCaseId) {
            setSelectedConversation(null)
            setConversations([])
            setMessages([])
            return null
          }
          return prev
        })
      }
      if (event.data?.type === 'cases_updated') {
        loadCases()
      }
    }
    window.addEventListener('message', handleMessage)

    loadCases().then(() => { initialLoadDone = true })
    const params = new URLSearchParams(window.location.search)
    const caseIdParam = params.get('caseId')
    if (caseIdParam) {
      loadCases().then(loadedCases => {
        initialLoadDone = true
        const found = loadedCases?.find(c => c.id === caseIdParam)
        if (found) setSelectedCase(found)
      })
    }
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (selectedCase) {
      setSelectedConversation(null)
      setMessages([])
      loadConversations(selectedCase.id)
    }
  }, [selectedCase])

  useEffect(() => {
    if (selectedConversation) {
      loadHistory(selectedConversation.id)
    }
  }, [selectedConversation])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (modeMenuOpen) setModeMenuOpen(false)
    }
    if (modeMenuOpen) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [modeMenuOpen])

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    document.addEventListener('click', close)
    document.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('scroll', close, true)
    }
  }, [contextMenu])

  async function loadCases(): Promise<CaseInfo[] | undefined> {
    const supabase = getSupabaseForQuery()
    const { data } = await supabase
      .from('cases')
      .select('id, rol, tribunal, procedimiento, caratula, document_count, last_synced_at')
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

  async function loadConversations(caseId: string) {
    setLoadingConversations(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = getSupabaseForQuery() as any
    const { data, error } = await supabase
      .from('conversations')
      .select('id, title, mode, created_at, updated_at')
      .eq('case_id', caseId)
      .order('updated_at', { ascending: false })
      .limit(50)

    if (error) {
      console.error('[Chat] loadConversations error:', error.message)
    }
    setConversations(data ?? [])
    setLoadingConversations(false)
  }

  async function loadHistory(conversationId: string, retryCount = 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = getSupabaseForQuery() as any

    const { data: msgs, error: msgsError } = await supabase
      .from('chat_messages')
      .select('id, role, content, sources_cited, web_sources_cited, thinking_content, model_used')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(100)

    if (msgsError) {
      console.error('[Chat] loadHistory error:', msgsError.message)
      if (msgsError.message?.includes('JWT') || msgsError.code === '401') {
        window.parent?.postMessage({ type: 'request_fresh_token' }, '*')
      }
      setMessages([])
      return
    }

    if (msgs && msgs.length > 0) {
      const lastMsg = msgs[msgs.length - 1]
      const pendingResponse = lastMsg && lastMsg.role === 'user'

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const loaded: ChatMessage[] = (msgs as any[]).map((m: any) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        citations: m.sources_cited as AIExpedienteCitation[] ?? [],
        webSources: m.web_sources_cited as AIWebCitation[] ?? [],
        thinkingContent: m.thinking_content ?? undefined,
        modelUsed: m.model_used ?? null,
      }))

      if (pendingResponse) {
        loaded.push({
          id: `pending-${Date.now()}`,
          role: 'assistant',
          content: '',
          isStreaming: true,
        })
      }

      setMessages(loaded)

      if (pendingResponse && retryCount < 3) {
        const delay = (retryCount + 1) * 2000
        setTimeout(() => {
          if (selectedConversation?.id === conversationId) {
            loadHistory(conversationId, retryCount + 1)
          }
        }, delay)
      }
    } else {
      setMessages([])
    }
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    })
  }

  const refreshConversationTitle = useCallback(async (conversationId: string) => {
    await new Promise(resolve => setTimeout(resolve, 2_000))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = getSupabaseForQuery() as any
    const { data } = await supabase
      .from('conversations')
      .select('title')
      .eq('id', conversationId)
      .single()

    if (data?.title) {
      setConversations(prev => prev.map(c =>
        c.id === conversationId ? { ...c, title: data.title } : c,
      ))
      setSelectedConversation(prev =>
        prev && prev.id === conversationId ? { ...prev, title: data.title } : prev,
      )
    }
  }, [getSupabaseForQuery])

  const sendMessage = useCallback(async (query: string, modeOverride?: AIMode) => {
    if (!selectedCase || !selectedConversation || !query.trim() || isLoading) return

    const effectiveMode = modeOverride ?? mode
    const shouldRefreshTitle = !selectedConversation.title

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
      modelUsed: MODE_TO_MODEL[effectiveMode],
    }

    setMessages(prev => [...prev, userMsg, assistantMsg])
    setInput('')
    setIsLoading(true)

    const controller = new AbortController()
    abortRef.current = controller

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
          conversationId: selectedConversation.id,
          query: query.trim(),
          mode: effectiveMode,
        }),
        signal: controller.signal,
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
      if (err instanceof DOMException && err.name === 'AbortError') return
      setMessages(prev => prev.map((msg, idx) =>
        idx === prev.length - 1 && msg.role === 'assistant'
          ? { ...msg, content: `⚠️ Error: ${err instanceof Error ? err.message : 'Error de conexión'}`, isStreaming: false }
          : msg,
      ))
    } finally {
      setIsLoading(false)
      abortRef.current = null
      inputRef.current?.focus()

      if (shouldRefreshTitle && selectedConversation) {
        refreshConversationTitle(selectedConversation.id)
      }
    }
  }, [selectedCase, selectedConversation, mode, isLoading, refreshConversationTitle])

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

  function handleSelectCase(c: CaseInfo) {
    setSelectedCase(c)
  }

  function handleBackToCases() {
    abortRef.current?.abort()
    setSelectedConversation(null)
    setConversations([])
    setMessages([])
    setSelectedCase(null)
  }

  function handleSelectConversation(conv: ConversationInfo) {
    abortRef.current?.abort()
    setSelectedConversation(conv)
  }

  function handleBackToConversations() {
    abortRef.current?.abort()
    setSelectedConversation(null)
    setMessages([])
    if (selectedCase) loadConversations(selectedCase.id)
  }

  async function handleNewConversation() {
    if (!selectedCase || isCreatingConv) return
    setIsCreatingConv(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const supabase = getSupabaseForQuery() as any
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Sin sesión')

      const { data: conv, error } = await supabase
        .from('conversations')
        .insert({ user_id: user.id, case_id: selectedCase.id, mode: 'fast_chat' })
        .select('id, title, mode, created_at, updated_at')
        .single()

      if (error || !conv) throw error ?? new Error('Error al crear conversación')
      setConversations(prev => [conv, ...prev])
      setSelectedConversation(conv)
    } catch (err) {
      console.error('[Chat] New conversation error:', err)
    } finally {
      setIsCreatingConv(false)
    }
  }

  async function handleDeleteConversation() {
    if (!deleteConvTarget) return
    setIsDeletingConv(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const supabase = getSupabaseForQuery() as any
      const { error } = await supabase
        .from('conversations')
        .delete()
        .eq('id', deleteConvTarget.id)

      if (error) throw error

      const deletedId = deleteConvTarget.id
      setConversations(prev => prev.filter(c => c.id !== deletedId))
      if (selectedConversation?.id === deletedId) {
        setSelectedConversation(null)
        setMessages([])
      }
      setDeleteConvTarget(null)
    } catch (err) {
      console.error('[Chat] Delete conversation error:', err)
    } finally {
      setIsDeletingConv(false)
    }
  }

  function handleConvContextMenu(e: React.MouseEvent, conv: ConversationInfo) {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, conv })
  }

  function handleStartRename(conv: ConversationInfo) {
    setRenamingConvId(conv.id)
    setRenameValue(conv.title || '')
    setContextMenu(null)
  }

  async function handleRenameConversation(convId: string) {
    const trimmed = renameValue.trim()
    if (!trimmed) {
      setRenamingConvId(null)
      return
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const supabase = getSupabaseForQuery() as any
      const { error } = await supabase
        .from('conversations')
        .update({ title: trimmed })
        .eq('id', convId)

      if (error) throw error
      setConversations(prev => prev.map(c => c.id === convId ? { ...c, title: trimmed } : c))
    } catch (err) {
      console.error('[Chat] Rename error:', err)
    }
    setRenamingConvId(null)
  }

  async function handleDeleteCase() {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      let token = getAuthToken()
      if (!token) {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        token = session?.access_token ?? null
      }
      if (!token) throw new Error('Sin sesión activa')

      const res = await fetch('/api/cases', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ case_id: deleteTarget.id }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }

      const deletedId = deleteTarget.id
      const deletedRol = deleteTarget.rol
      setCases(prev => prev.filter(c => c.id !== deletedId))
      if (selectedCase?.id === deletedId) {
        abortRef.current?.abort()
        setSelectedCase(null)
      }
      setDeleteTarget(null)
      setConversations([])
      setSelectedConversation(null)

      window.parent?.postMessage({ type: 'case_deleted_from_chat', caseId: deletedId, rol: deletedRol }, '*')
    } catch (err) {
      console.error('[Chat] Delete error:', err)
    } finally {
      setIsDeleting(false)
    }
  }

  // ─── Case selector (no case selected) ───

  if (!selectedCase) {
    return (
      <div className="flex flex-col h-screen bg-background">
        <header className="border-b px-4 py-3">
          <h1 className="text-sm font-semibold">Mis Causas</h1>
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
              {cases.map(c => {
                const docCount = c.document_count ?? 0
                const freshness = getFreshness(c.last_synced_at)
                return (
                  <div
                    key={c.id}
                    className="group relative w-full text-left p-3 rounded-md border hover:border-blue-400 hover:shadow-sm transition-all cursor-pointer"
                    onClick={() => handleSelectCase(c)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium">{c.rol}</span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <Badge variant="outline" className={`text-[10px] ${freshness.className}`}>
                          {docCount} doc{docCount !== 1 ? 's' : ''}
                        </Badge>
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget(c) }}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all text-xs px-1 cursor-pointer"
                          title="Eliminar causa"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    {c.caratula && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{c.caratula}</p>
                    )}
                    <div className="flex items-center justify-between mt-1">
                      {c.tribunal && (
                        <p className="text-[10px] text-muted-foreground truncate">{c.tribunal}</p>
                      )}
                      {c.last_synced_at && (
                        <p className={`text-[10px] flex-shrink-0 ml-2 ${freshness.textClass}`}>
                          {getTimeAgo(c.last_synced_at)}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </ScrollArea>

        {deleteTarget && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !isDeleting && setDeleteTarget(null)}>
            <div className="bg-background rounded-lg p-5 w-full max-w-xs shadow-xl" onClick={e => e.stopPropagation()}>
              <p className="text-sm font-semibold mb-1">Eliminar causa {deleteTarget.rol}?</p>
              <p className="text-xs text-muted-foreground mb-1">
                {(deleteTarget.document_count ?? 0) > 0
                  ? `Se eliminarán ${deleteTarget.document_count} documento${deleteTarget.document_count !== 1 ? 's' : ''} y todo su historial.`
                  : 'Se eliminará la causa y todo su historial.'}
              </p>
              <p className="text-[10px] text-destructive mb-4">Esta acción no se puede deshacer.</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setDeleteTarget(null)} disabled={isDeleting}>
                  Cancelar
                </Button>
                <Button variant="destructive" size="sm" className="flex-1" onClick={handleDeleteCase} disabled={isDeleting}>
                  {isDeleting ? 'Eliminando...' : 'Eliminar'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ─── Conversation list (case selected, no conversation selected) ───

  if (!selectedConversation) {
    return (
      <div className="flex flex-col h-screen bg-background">
        <header className="border-b px-4 py-2.5 flex-shrink-0">
          <div className="flex items-center justify-between">
            <button onClick={handleBackToCases} className="text-xs text-muted-foreground hover:text-foreground cursor-pointer">
              ← Causas
            </button>
            {selectedCase.tribunal && (
              <span className="text-xs text-muted-foreground truncate max-w-[50%]">{selectedCase.tribunal}</span>
            )}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium">{selectedCase.rol}</span>
            </div>
          </div>
        </header>

        <div className="px-4 pt-3 pb-2">
          <button
            onClick={handleNewConversation}
            disabled={isCreatingConv}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border border-dashed border-blue-300 text-blue-600 hover:bg-blue-50 hover:border-blue-400 transition-all text-sm font-medium disabled:opacity-50 cursor-pointer"
          >
            {isCreatingConv ? 'Creando...' : '+ Nuevo chat'}
          </button>
        </div>

        <ScrollArea className="flex-1 px-4 pb-4">
          {loadingConversations ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center pt-12 text-center">
              <p className="text-sm text-muted-foreground mb-1">Sin conversaciones aún</p>
              <p className="text-xs text-muted-foreground">Crea un nuevo chat para consultar sobre esta causa</p>
            </div>
          ) : (
            <div className="space-y-2">
              {conversations.map(conv => (
                <div
                  key={conv.id}
                  className="group relative w-full text-left p-3 rounded-md border hover:border-blue-400 hover:shadow-sm transition-all cursor-pointer"
                  onClick={() => renamingConvId !== conv.id && handleSelectConversation(conv)}
                  onContextMenu={(e) => handleConvContextMenu(e, conv)}
                >
                  <div className="flex items-center justify-between gap-2">
                    {renamingConvId === conv.id ? (
                      <input
                        type="text"
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleRenameConversation(conv.id)
                          if (e.key === 'Escape') setRenamingConvId(null)
                        }}
                        onBlur={() => handleRenameConversation(conv.id)}
                        autoFocus
                        className="text-sm font-medium w-full bg-transparent border-b border-blue-400 outline-none py-0 flex-1 min-w-0"
                        onClick={e => e.stopPropagation()}
                      />
                    ) : (
                      <p className="text-sm font-medium truncate flex-1 min-w-0">
                        {conv.title || 'Nuevo chat'}
                      </p>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteConvTarget(conv) }}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all text-xs px-1 flex-shrink-0 cursor-pointer"
                      title="Eliminar chat"
                    >
                      ✕
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {getTimeAgo(conv.updated_at)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        {contextMenu && (
          <div
            className="fixed z-50 bg-popover border rounded-lg shadow-lg py-1 min-w-[150px]"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={e => e.stopPropagation()}
          >
            <button
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors"
              onClick={() => handleStartRename(contextMenu.conv)}
            >
              Renombrar
            </button>
            <button
              className="w-full text-left px-3 py-1.5 text-xs text-destructive hover:bg-muted transition-colors"
              onClick={() => { setDeleteConvTarget(contextMenu.conv); setContextMenu(null) }}
            >
              Eliminar
            </button>
          </div>
        )}

        {deleteConvTarget && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !isDeletingConv && setDeleteConvTarget(null)}>
            <div className="bg-background rounded-lg p-5 w-full max-w-xs shadow-xl" onClick={e => e.stopPropagation()}>
              <p className="text-sm font-semibold mb-1">Eliminar conversación?</p>
              <p className="text-xs text-muted-foreground mb-1">
                Se eliminarán todos los mensajes de esta conversación.
              </p>
              <p className="text-[10px] text-destructive mb-4">Esta acción no se puede deshacer.</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setDeleteConvTarget(null)} disabled={isDeletingConv}>
                  Cancelar
                </Button>
                <Button variant="destructive" size="sm" className="flex-1" onClick={handleDeleteConversation} disabled={isDeletingConv}>
                  {isDeletingConv ? 'Eliminando...' : 'Eliminar'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ─── Main chat view ───

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header — compact, just case info */}
      <header className="border-b px-4 py-2.5 flex-shrink-0">
        <div className="flex items-center justify-between">
          <button onClick={handleBackToConversations} className="text-xs text-muted-foreground hover:text-foreground cursor-pointer">
            ← Chats
          </button>
          {selectedCase.tribunal && (
            <span className="text-xs text-muted-foreground truncate max-w-[50%]">{selectedCase.tribunal}</span>
          )}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium">{selectedCase.rol}</span>
          </div>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 px-2">
            <p className="text-sm text-muted-foreground">¿Qué quieres saber sobre esta causa?</p>
            <div className="w-full max-w-md flex flex-wrap gap-1.5 justify-center">
              {quickActions.map(action => {
                const upgradeMode = action.recommendedMode
                  ? MODES.find(m => m.value === action.recommendedMode)
                  : null
                const willUpgrade = upgradeMode && action.recommendedMode !== mode
                const tooltipText = willUpgrade
                  ? `Cambiará a modo ${upgradeMode.label} para mejor análisis`
                  : `Se ejecutará en modo ${currentMode.label}`

                return (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => {
                      if (willUpgrade && action.recommendedMode) {
                        setMode(action.recommendedMode)
                        sendMessage(action.query, action.recommendedMode)
                      } else {
                        sendMessage(action.query)
                      }
                    }}
                    disabled={isLoading}
                    title={tooltipText}
                    className={`text-[11px] px-2.5 py-1.5 rounded-full border transition-all cursor-pointer disabled:opacity-50 ${
                      action.id === 'plazos-fatales'
                        ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 hover:border-amber-400 font-medium'
                        : 'border-border text-muted-foreground hover:text-foreground hover:border-blue-300 hover:bg-blue-50'
                    }`}
                  >
                    {action.id === 'plazos-fatales' && <span className="mr-0.5">⏱</span>}
                    {action.label}
                    {willUpgrade && (
                      <span className="ml-1 opacity-60" title={`Requiere modo ${upgradeMode.label}`}>
                        {upgradeMode.icon}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            <p className="text-[10px] text-muted-foreground/60">
              Modo actual: {currentMode.icon} {currentMode.label} · <button type="button" onClick={() => setModeMenuOpen(true)} className="underline hover:text-foreground transition-colors cursor-pointer">cambiar</button>
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map(msg => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
          </div>
        )}
      </div>

      {/* Input + compact mode selector */}
      <form onSubmit={handleSubmit} className="border-t p-3 flex-shrink-0">
        <div className="flex gap-2 items-end">
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
          {/* Mode selector button */}
          <div className="relative">
            {modeMenuOpen && (
              <div
                className="absolute bottom-full right-0 mb-1 w-48 bg-popover border rounded-lg shadow-lg py-1 z-50"
                onClick={e => e.stopPropagation()}
              >
                {MODES.map(m => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => { setMode(m.value); setModeMenuOpen(false) }}
                    className={`w-full text-left px-3 py-2 transition-colors cursor-pointer ${
                      mode === m.value
                        ? 'bg-accent text-accent-foreground'
                        : 'hover:bg-muted text-foreground'
                    }`}
                  >
                    <span className="text-xs font-medium"><span style={{ filter: 'grayscale(1) brightness(0)' }}>{m.icon}</span> {m.label}</span>
                    {mode === m.value && <span className="float-right text-xs">✓</span>}
                    <p className="text-[10px] text-muted-foreground">{m.hint}</p>
                  </button>
                ))}
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={e => { e.stopPropagation(); setModeMenuOpen(prev => !prev) }}
              className="h-[38px] px-2.5 text-xs whitespace-nowrap gap-1"
              disabled={isLoading}
              title="Cambiar nivel de análisis"
            >
              <span style={{ filter: 'grayscale(1) brightness(0)' }}>{currentMode.icon}</span>
              <span className="hidden sm:inline text-[11px]">{currentMode.label}</span>
              <span className="inline">▾</span>
            </Button>
          </div>
          <Button type="submit" size="sm" disabled={isLoading || !input.trim()} className="h-[38px]">
            {isLoading ? '...' : '→'}
          </Button>
        </div>
      </form>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Markdown renderer with clickable footnotes
// ─────────────────────────────────────────────────────────────

const FOOTNOTE_LINK_PREFIX = '#cite-'

function preprocessFootnotes(
  text: string,
  citations?: AIExpedienteCitation[],
  webSources?: AIWebCitation[],
): string {
  const hasCitations = citations && citations.length > 0
  const hasWebSources = webSources && webSources.length > 0
  if (!hasCitations && !hasWebSources) return text

  return text.replace(/\[(\d+)\]/g, (match, num) => {
    const idx = parseInt(num, 10) - 1

    if (hasCitations) {
      const cite = citations[idx]
      if (cite) {
        const href = cite.documentId
          ? `/pdf-viewer?documentId=${cite.documentId}${cite.pageNumber ? `&page=${cite.pageNumber}` : ''}`
          : `${FOOTNOTE_LINK_PREFIX}${num}`
        return `[⁽${num}⁾](${href})`
      }
    }

    if (hasWebSources) {
      const ws = webSources[idx]
      if (ws?.url) {
        return `[⁽${num}⁾](${ws.url})`
      }
    }

    return match
  })
}

function MarkdownWithFootnotes({ content, citations, webSources }: { content: string; citations?: AIExpedienteCitation[]; webSources?: AIWebCitation[] }) {
  const processed = preprocessFootnotes(content, citations, webSources)

  return (
    <div className="text-sm break-words prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h3 className="text-sm font-bold mt-3 mb-1.5">{children}</h3>,
          h2: ({ children }) => <h3 className="text-sm font-bold mt-3 mb-1.5">{children}</h3>,
          h3: ({ children }) => <h4 className="text-[13px] font-semibold mt-2.5 mb-1">{children}</h4>,
          h4: ({ children }) => <h4 className="text-xs font-semibold mt-2 mb-1">{children}</h4>,
          p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          blockquote: ({ children }) => <blockquote className="border-l-2 border-border pl-3 my-2 italic text-muted-foreground">{children}</blockquote>,
          code: ({ children, className }) => {
            const isBlock = className?.includes('language-')
            return isBlock
              ? <pre className="bg-background/50 rounded p-2 my-2 text-xs overflow-x-auto"><code>{children}</code></pre>
              : <code className="bg-background/50 rounded px-1 py-0.5 text-xs">{children}</code>
          },
          hr: () => <hr className="my-3 border-border/50" />,
          table: ({ children }) => <div className="overflow-x-auto my-2"><table className="text-xs border-collapse w-full">{children}</table></div>,
          th: ({ children }) => <th className="border border-border/50 px-2 py-1 font-semibold text-left bg-background/50">{children}</th>,
          td: ({ children }) => <td className="border border-border/50 px-2 py-1">{children}</td>,
          a: ({ href, children }) => {
            const text = String(children)
            const isFootnote = text.match(/^⁽(\d+)⁾$/)
            if (isFootnote) {
              const num = isFootnote[1]
              const isClickable = href && !href.startsWith(FOOTNOTE_LINK_PREFIX)
              return isClickable ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center w-4 h-4 text-[9px] font-medium bg-blue-100 text-blue-700 rounded-full hover:bg-blue-200 transition-colors cursor-pointer ml-0.5 no-underline align-super"
                  title={`Fuente ${num}`}
                >
                  {num}
                </a>
              ) : (
                <span className="inline-flex items-center justify-center w-4 h-4 text-[9px] font-medium bg-muted text-muted-foreground rounded-full ml-0.5 align-super">
                  {num}
                </span>
              )
            }
            return <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">{children}</a>
          },
        }}
      >
        {processed}
      </ReactMarkdown>
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
  const badge = !isUser ? getModeBadge(message.modelUsed) : null

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-lg px-3 py-2 ${
        isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'
      }`}>
        {/* Model badge */}
        {badge && !message.isStreaming && (
          <span className="inline-flex items-center gap-0.5 text-[9px] font-medium text-muted-foreground mb-1">
            <span style={{ filter: 'grayscale(1) brightness(0)' }}>{badge.icon}</span> {badge.label}
          </span>
        )}

        {message.isStreaming && !message.content && (
          <div className="flex gap-1 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-pulse" />
            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-pulse delay-150" />
            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-pulse delay-300" />
          </div>
        )}

        {isUser ? (
          <div className="text-sm whitespace-pre-wrap break-words">{message.content}</div>
        ) : (
          <MarkdownWithFootnotes content={message.content} citations={message.citations} webSources={message.webSources} />
        )}

        {message.isStreaming && message.content && (
          <span className="inline-block w-1.5 h-3 bg-foreground/50 animate-pulse ml-0.5" />
        )}

        {hasCitations && !message.isStreaming && message.citations!.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border/50">
            <Footnotes citations={message.citations!} />
          </div>
        )}

        {hasWebSources && !message.isStreaming && (
          <div className="mt-2 pt-2 border-t border-border/50">
            <details>
              <summary className="text-[10px] font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
                🌐 {message.webSources!.length} fuente{message.webSources!.length !== 1 ? 's' : ''} web
              </summary>
              <div className="mt-1">
                <WebSourcesCitations sources={message.webSources!} />
              </div>
            </details>
          </div>
        )}

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

const CITE_DOC_LABELS: Record<string, string> = {
  folio_principal: 'Documento principal',
  folio_certificado: 'Certificado de envío',
  folio_anexo: 'Anexo de solicitud',
  folio: 'Documento del expediente',
  directo: 'Escrito presentado',
  sentencia: 'Sentencia',
  resolucion: 'Resolución',
  resolución: 'Resolución',
  escrito: 'Escrito',
  actuacion: 'Actuación',
  actuación: 'Actuación',
  demanda: 'Demanda',
  contestacion: 'Contestación',
  contestación: 'Contestación',
  mandamiento: 'Mandamiento',
  auto_prueba: 'Auto de prueba',
  acta_embargo: 'Acta de embargo',
  acta_audiencia: 'Acta de audiencia',
  receptor: 'Diligencia de receptor',
}

function humanizeDocType(raw: string): string {
  return CITE_DOC_LABELS[raw] ?? raw.replace(/_/g, ' ')
}

function formatFojaCitation(c: AIExpedienteCitation): string {
  const docLabel = c.documentType ? humanizeDocType(c.documentType) : null
  const sectionLabel = c.sectionType && c.sectionType !== 'general'
    ? c.sectionType.replace(/_/g, ' ')
    : null

  const parts: string[] = []

  if (docLabel) parts.push(docLabel)
  if (c.foja != null) parts.push(`fojas ${c.foja}`)
  if (c.folioNumero != null) parts.push(`folio ${c.folioNumero}`)
  if (c.cuaderno) parts.push(`cuaderno ${c.cuaderno}`)
  if (c.fechaTramite) parts.push(c.fechaTramite)
  if (sectionLabel && !parts.some(p => p.toLowerCase().includes(sectionLabel.toLowerCase()))) {
    parts.push(sectionLabel)
  }
  if (c.pageNumber != null && parts.length < 3) parts.push(`pág. ${c.pageNumber}`)

  return parts.length > 0 ? parts.join(' · ') : 'Documento del expediente'
}

// ─────────────────────────────────────────────────────────────
// Jurisprudencia Citations — agrupadas por tribunal/dominio
// ─────────────────────────────────────────────────────────────

function safeHostname(url: string): string {
  try { return new URL(url).hostname } catch { return 'Ver fuente' }
}

function WebSourcesCitations({ sources }: { sources: AIWebCitation[] }) {
  return (
    <div className="space-y-1">
      {sources.map((ws, i) => (
        <div key={i} className="flex items-start gap-1.5">
          <span className="inline-flex items-center justify-center w-4 h-4 text-[9px] font-medium bg-blue-100 text-blue-700 rounded-full flex-shrink-0 mt-0.5">
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <a
              href={ws.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-blue-500 hover:underline font-medium break-all"
            >
              {ws.title || safeHostname(ws.url)}
            </a>
            {ws.snippet && (
              <p className="text-[10px] text-muted-foreground/60 italic truncate">
                &ldquo;{ws.snippet.slice(0, 120)}{ws.snippet.length > 120 ? '...' : ''}&rdquo;
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
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
  return formatFojaCitation(c)
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
