import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChatMessage,
  ChatTurnSummary,
  PermissionDecision,
  PermissionRequest,
  ToolActivity,
} from '../../../hooks/useIPC'
import { trackEvent } from '../../../lib/telemetry'

/** Hook: the single owner of an in-app SDK chat's state.
 *
 *  Everything about the live conversation lives here — the IPC subscriptions,
 *  the in-flight turn (text deltas, fully-formed messages, tool indicator,
 *  permission queue), the committed transcript and the optimistic user bubble.
 *  `LiveChatView` renders what the hook exposes and `ChatComposer` is a purely
 *  presentational input bar: neither holds stream state anymore.
 *
 *  This replaces the old shape where `ChatComposer` subscribed to the IPC
 *  channels and lifted five callbacks up to the view, which then mirrored the
 *  values into refs to dodge one-render-stale closures at turn commit — the
 *  exact seam where a just-streamed reply could be dropped. With one owner
 *  there is no cross-component hop: the commit reads this hook's own refs.
 *
 *  The transcript is stream-only (the deliberate LiveChatView design): it
 *  starts empty and grows only from what the SDK emits — the `.jsonl` the SDK
 *  writes is never read back here. The one exception is `resume`: continuing
 *  an existing session seeds the transcript with an imperative disk read at
 *  mount (NOT a watched query — a watcher-driven refetch mid-turn is exactly
 *  the reconcile bug this design removed), after which the conversation grows
 *  from the stream like a new chat. With `followDisk` (session live in a
 *  terminal, composer locked) the seed is re-run on watcher events between
 *  turns, so the terminal's conversation stays visible until it ends. */
export function useLiveChat(
  realPath: string,
  /** Continue an existing session: its transcript seeds the view once, and the
   *  first send resumes it (`sendMessage`) instead of starting a new one. */
  resume?: { hash: string; sessionId: string },
  /** While true (resume mode only), the transcript keeps following the `.jsonl`
   *  on disk between turns — used when the session is live in a terminal, where
   *  the composer is locked and the CLI is the one writing the transcript. Safe
   *  with the stream-only rule: re-seeds are skipped while a turn is in flight. */
  followDisk = false
) {
  // The SDK session id. Known up front when resuming; for a new chat it stays
  // null until the first turn starts. Turns 2+ push into the live session.
  const [sessionId, setSessionId] = useState<string | null>(resume?.sessionId ?? null)
  // The committed transcript — seeded once when resuming, grown from the stream.
  const [messages, setMessages] = useState<ChatMessage[]>([])
  // True while the one-time resume seed is still loading from disk.
  const [seedLoading, setSeedLoading] = useState(Boolean(resume))
  // The just-sent prompt, shown optimistically (the SDK doesn't echo it back).
  const [pendingUser, setPendingUser] = useState<{
    text: string
    at: string
    uuid: string
  } | null>(null)
  // The in-flight turn, straight from the stream.
  const [liveMessages, setLiveMessages] = useState<ChatMessage[]>([])
  const [streamText, setStreamText] = useState('')
  const [liveTool, setLiveTool] = useState<ToolActivity | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  // Running cost/token/model summary from the SDK's `result` (session cumulative).
  const [summary, setSummary] = useState<ChatTurnSummary | null>(null)
  // Tool-approval requests forwarded from the SDK's canUseTool, oldest first.
  // A queue, not a single slot: parallel tools can fire several canUseTool
  // calls at once, and overwriting the visible one would leave the hidden
  // request pending forever — deadlocking the turn.
  const [permQueue, setPermQueue] = useState<PermissionRequest[]>([])

  // Refs mirror the pieces the mount-only subscriptions and the turn commit
  // must read synchronously (state would be one render stale there).
  const sessionIdRef = useRef<string | null>(resume?.sessionId ?? null)
  const pendingRef = useRef<{ text: string; at: string; uuid: string } | null>(null)
  const liveMessagesRef = useRef<ChatMessage[]>([])
  const realPathRef = useRef(realPath)
  useEffect(() => {
    realPathRef.current = realPath
  })

  const clearInFlight = useCallback(() => {
    pendingRef.current = null
    liveMessagesRef.current = []
    setPendingUser(null)
    setLiveMessages([])
  }, [])

  // Commit the finished turn to the transcript, straight from the refs: the
  // optimistic user bubble (same uuid) + the streamed messages, deduped by uuid.
  // `chatDone` is the authoritative turn-end signal; a chatDone without a
  // pending send (e.g. the final one after a fatal close) commits nothing.
  const commitTurn = useCallback(() => {
    const pending = pendingRef.current
    if (!pending) return
    const userMsg: ChatMessage = {
      uuid: pending.uuid,
      role: 'user',
      timestamp: pending.at,
      content: [{ type: 'text', text: pending.text }],
    }
    const streamed = liveMessagesRef.current
    setMessages(prev => {
      const seen = new Set(prev.map(m => m.uuid))
      const turn = [userMsg, ...streamed].filter(m => !seen.has(m.uuid))
      return [...prev, ...turn]
    })
    clearInFlight()
  }, [clearInFlight])

  // Subscribe to the streaming channels once, on mount. The handlers read only
  // refs and functional setState, so nothing here can go one-render stale and
  // no re-subscribe gap can drop a chunk mid-stream.
  useEffect(() => {
    // Every stream event is enveloped with the id of the session that produced
    // it (see shared/chat-types.ts). Events from a session this hook doesn't
    // own — e.g. the final chatDone of a superseded session arriving after a
    // fresh view mounted — are dropped instead of trusted by arrival order.
    // The id is adopted from chatStarted, which the main process emits before
    // any stream event of the first turn, so `null` here only ever coincides
    // with foreign traffic.
    const isMine = (eventSessionId: string) => sessionIdRef.current === eventSessionId
    const api = window.electronAPI.sessions
    const disposers = [
      api.onChatStarted(id => {
        // Adopt the id only while unset (the first turn of a new chat); a
        // resumed session re-reports the same id, and anything else is stale.
        if (sessionIdRef.current === null) {
          sessionIdRef.current = id
          setSessionId(id)
        }
      }),
      api.onChatChunk(ev => {
        if (isMine(ev.sessionId)) setStreamText(prev => prev + ev.text)
      }),
      api.onChatToolActivity(ev => {
        if (isMine(ev.sessionId)) setLiveTool(ev.activity)
      }),
      api.onChatMessage(ev => {
        if (!isMine(ev.sessionId)) return
        liveMessagesRef.current = [...liveMessagesRef.current, ev.message]
        setLiveMessages(liveMessagesRef.current)
        // A completed assistant message absorbs the partial text streamed so
        // far; clear it so the trailing live turn doesn't echo it twice.
        if (ev.message.role === 'assistant') setStreamText('')
        // A tool_result-bearing user message means the running tool finished.
        if (ev.message.role === 'user') setLiveTool(null)
      }),
      api.onChatError(ev => {
        if (isMine(ev.sessionId)) setErrorText(prev => (prev ? prev + '\n' : '') + ev.error)
      }),
      // Approval requests are modal for the one live session; only a definite
      // mismatch is dropped ('' means the request raced a teardown — show it,
      // an unanswered dialog would deadlock the turn either way).
      api.onPermissionRequest(req => {
        if (req.sessionId && !isMine(req.sessionId)) return
        setPermQueue(prev => [...prev, req])
      }),
      api.onChatDone(ev => {
        if (!isMine(ev.sessionId)) return
        if (ev.summary) setSummary(ev.summary)
        commitTurn()
        setStreaming(false)
        setStreamText('')
        setLiveTool(null)
        // A turn can't end with requests still on screen (the SDK denied any
        // pending ones on teardown); clear the stale queue.
        setPermQueue([])
      }),
    ]
    return () => disposers.forEach(dispose => dispose())
  }, [commitTurn])

  // Resume seed: an imperative read of the existing transcript — deliberately
  // not a React Query (the data:changed watcher would refetch it mid-turn and
  // fight the stream). Prepended so a turn sent before the read resolves keeps
  // its place; dedup by uuid in case the stream already re-delivered a seeded
  // message. `surfaceError` is true only for the mount seed: a failed follow-up
  // re-read (see the followDisk effect) must not spam the error banner.
  const resumeRef = useRef(resume)
  const seedFromDisk = useCallback((surfaceError: boolean) => {
    const r = resumeRef.current
    if (!r) return Promise.resolve()
    return window.electronAPI.sessions
      .getChat(r.hash, `${r.sessionId}.jsonl`)
      .then(res => {
        if (res.error && surfaceError) setErrorText(prev => (prev ? prev + '\n' : '') + res.error)
        const seed = res.data ?? []
        if (seed.length === 0) return
        setMessages(prev => {
          const seeded = new Set(seed.map(m => m.uuid))
          return [...seed, ...prev.filter(m => !seeded.has(m.uuid))]
        })
      })
      .catch((e: unknown) => {
        if (surfaceError) setErrorText(e instanceof Error ? e.message : String(e))
      })
  }, [])
  useEffect(() => {
    if (!resumeRef.current) return
    void seedFromDisk(true).finally(() => setSeedLoading(false))
  }, [seedFromDisk])

  // Follow mode: while the session is live in a terminal (composer locked), the
  // CLI keeps appending to the `.jsonl` — re-seed on watcher events so the user
  // watches the terminal conversation flow here. Subscribed only while
  // followDisk holds (it flips rarely: when the terminal session ends).
  // Guarded by pendingRef: never re-read disk while an SDK turn is in flight
  // (the stream owns the view then).
  useEffect(() => {
    if (!followDisk || !resumeRef.current) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = window.electronAPI.onDataChanged(() => {
      if (pendingRef.current !== null) return
      // Trailing debounce: a turn in the terminal appends the .jsonl in bursts.
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        if (pendingRef.current === null) void seedFromDisk(false)
      }, 300)
    })
    return () => {
      if (timer) clearTimeout(timer)
      unsubscribe()
    }
  }, [followDisk, seedFromDisk])

  // Tear the persistent SDK session down when the owning view unmounts; the
  // next send in any view resumes from disk into a fresh session.
  useEffect(() => {
    return () => {
      void window.electronAPI.sessions.endChat()
    }
  }, [])

  /** Send a turn: first send starts a new session (`startMessage`), later ones
   *  push into the warm live session (`sendMessage`). Resolves false when the
   *  send failed before a turn ever started (the optimistic bubble is rolled
   *  back and the error surfaced in `errorText`). */
  const send = useCallback(
    async (text: string, opts: { model?: string; permissionMode: string }): Promise<boolean> => {
      const startingNew = sessionIdRef.current === null
      pendingRef.current = { text, at: new Date().toISOString(), uuid: crypto.randomUUID() }
      liveMessagesRef.current = []
      setPendingUser(pendingRef.current)
      setLiveMessages([])
      setStreamText('')
      setLiveTool(null)
      setErrorText(null)
      setPermQueue([])
      setStreaming(true)
      try {
        const api = window.electronAPI.sessions
        const res = startingNew
          ? await api.startMessage(realPathRef.current, text, opts.model, opts.permissionMode)
          : await api.sendMessage(
              realPathRef.current,
              sessionIdRef.current as string,
              text,
              opts.model,
              opts.permissionMode
            )
        if (res.error) throw new Error(res.error)
        if (startingNew) trackEvent('chat_started')
        return true
      } catch (e) {
        // The send never became a turn — drop the optimistic bubble; the
        // committed transcript is untouched.
        clearInFlight()
        setStreaming(false)
        setErrorText(e instanceof Error ? e.message : String(e))
        return false
      }
    },
    [clearInFlight]
  )

  /** Stop the in-flight turn (native SDK interrupt — the session stays warm).
   *  The interrupted turn still ends with a `result`, whose chatDone commits
   *  whatever streamed before the stop. */
  const stop = useCallback(() => {
    void window.electronAPI.sessions.stopMessage()
    setStreaming(false)
    setStreamText('')
    setLiveTool(null)
    setPermQueue([])
  }, [])

  /** Answer the tool-approval request at the head of the queue; the next
   *  pending one (if any) takes its place. */
  const respondPermission = useCallback(
    (decision: PermissionDecision) => {
      const head = permQueue[0]
      if (!head) return
      void window.electronAPI.sessions.respondPermission(head.requestId, decision)
      setPermQueue(prev => prev.slice(1))
    },
    [permQueue]
  )

  // What the view renders: the committed transcript, plus — while a turn is in
  // flight — the optimistic prompt and the streamed messages.
  const displayMessages = useMemo<ChatMessage[]>(() => {
    if (pendingUser === null) return messages
    const optimisticUser: ChatMessage = {
      uuid: pendingUser.uuid,
      role: 'user',
      timestamp: pendingUser.at,
      content: [{ type: 'text', text: pendingUser.text }],
    }
    return [...messages, optimisticUser, ...liveMessages]
  }, [messages, pendingUser, liveMessages])

  return {
    sessionId,
    displayMessages,
    /** True while the resume seed is still loading (always false for a new chat). */
    seedLoading,
    /** True once the conversation has anything to show (optimistic included). */
    hasConversation: pendingUser !== null || messages.length > 0,
    liveMessages,
    streamText,
    liveTool,
    streaming,
    errorText,
    summary,
    permRequest: permQueue[0] ?? null,
    permPendingCount: Math.max(0, permQueue.length - 1),
    send,
    stop,
    respondPermission,
  }
}
