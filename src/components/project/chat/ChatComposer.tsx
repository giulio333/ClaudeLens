import { useEffect, useRef, useState } from 'react'
import { fmtModel } from '../utils'

/** The four permission modes Claude Code accepts on `--permission-mode`. The
 *  resume default is `acceptEdits` (see RESUME_PERMISSION_MODE in main.ts): file
 *  edits auto-approved, riskiest bash still gated — closest to the live chat. */
const PERMISSION_OPTIONS = [
  { value: 'default', label: 'Ask each time' },
  { value: 'acceptEdits', label: 'Accept edits' },
  { value: 'plan', label: 'Plan mode' },
  { value: 'bypassPermissions', label: 'Bypass all', danger: true },
] as const

type PermissionMode = (typeof PERMISSION_OPTIONS)[number]['value']

/** Model aliases the CLI resolves on `--model`. The empty value means "send no
 *  --model flag" → Claude Code falls back to its configured default. */
const MODEL_ALIASES = ['sonnet', 'opus', 'haiku'] as const

/** A small upward popover anchored to a chip in the composer meta-row. Renders a
 *  trigger showing the current selection; clicking opens a menu of options above
 *  it. Closes on outside click or after a pick. */
function ComposerSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string
  value: T
  options: { value: T; label: string; danger?: boolean }[]
  onChange: (value: T) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const current = options.find(o => o.value === value)

  return (
    <span className="cl-composer-select" ref={rootRef}>
      {open && (
        <div className="cl-composer-menu" role="menu">
          <span className="cl-composer-menu-label">{label}</span>
          {options.map(o => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === value}
              className={[o.value === value ? 'is-active' : '', o.danger ? 'is-danger' : '']
                .filter(Boolean)
                .join(' ')}
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className="cl-composer-chip"
        data-on={open || undefined}
        data-danger={current?.danger || undefined}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        {current?.label ?? value}
        <span className="cl-composer-chip-caret" aria-hidden />
      </button>
    </span>
  )
}

/** Bottom composer for the Focus chat layout — lets the user continue an existing
 *  session straight from ClaudeLens. On send it resumes the real Claude Code
 *  session (`claude -p --resume <id>`), so the new turns append to the same
 *  `.jsonl` the terminal reads: the two stay interchangeable. The assistant's text
 *  streams live into a preview strip; once the turn closes the file watcher
 *  refetches the transcript and the full turn renders through the normal pipeline.
 *
 *  `model` is the model inherited from the session (its last assistant turn); it
 *  seeds the model picker so a reply defaults to the same model the chat was on.
 *  The picker lets the user switch model and permission mode per turn before
 *  sending; both flow through to `claude -p --model/--permission-mode`.
 *
 *  Two modes, keyed by `sessionId`: present → resume that session
 *  (`sessions:sendMessage`); absent → start a brand-new session
 *  (`sessions:startMessage`), in which the new id arrives on `onChatStarted` and
 *  is surfaced to the parent via `onStarted`. */
export function ChatComposer({
  realPath,
  sessionId,
  model,
  onTurnComplete,
  onStarted,
  onSend,
}: {
  realPath: string
  /** Resume mode when set; new-chat mode when omitted. */
  sessionId?: string
  model?: string
  /** Fired when a turn finishes so the parent can refetch the transcript. */
  onTurnComplete: () => void
  /** New-chat mode: the freshly-minted session id, as soon as Claude reports it. */
  onStarted?: (sessionId: string) => void
  /** Fired with the message text at send time (used by the new-chat view to
   *  title the session before its transcript exists). */
  onSend?: (text: string) => void
}) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [stream, setStream] = useState('')
  const [errorText, setErrorText] = useState<string | null>(null)
  // Empty string = inherit the session's model (or the configured default when
  // the session recorded none). Seeded from the inherited model so the first
  // reply stays on the same model the chat was using.
  const [selectedModel, setSelectedModel] = useState<string>(model ?? '')
  const [permission, setPermission] = useState<PermissionMode>('acceptEdits')
  const streamRef = useRef<HTMLDivElement>(null)

  // Build the model options: the inherited concrete id (if any) on top, then the
  // CLI aliases, then "Default" (no --model flag). De-duplicated by value.
  const modelOptions: { value: string; label: string }[] = [
    ...(model ? [{ value: model, label: fmtModel(model) }] : []),
    ...MODEL_ALIASES.filter(a => a !== model).map(a => ({
      value: a,
      label: a[0].toUpperCase() + a.slice(1),
    })),
    { value: '', label: 'Default' },
  ]

  // Subscribe to the streaming channels. Only one composer is mounted at a time,
  // so claiming the listeners (the preload resets them on each subscribe) is safe.
  useEffect(() => {
    window.electronAPI.sessions.onChatStarted(id => onStarted?.(id))
    window.electronAPI.sessions.onChatChunk(chunk => setStream(prev => prev + chunk))
    window.electronAPI.sessions.onChatError(message =>
      setErrorText(prev => (prev ? prev + '\n' : '') + message)
    )
    window.electronAPI.sessions.onChatDone(() => {
      setSending(false)
      setStream('')
      // The watcher has likely refetched mid-stream already; refetch again so the
      // final turn is on screen the instant the run closes.
      onTurnComplete()
    })
    return () => {
      window.electronAPI.sessions.onChatStarted(() => {})
      window.electronAPI.sessions.onChatChunk(() => {})
      window.electronAPI.sessions.onChatError(() => {})
      window.electronAPI.sessions.onChatDone(() => {})
    }
  }, [onTurnComplete, onStarted])

  // Keep the streaming preview pinned to its latest tokens.
  useEffect(() => {
    if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight
  }, [stream])

  async function handleSend() {
    const text = draft.trim()
    if (!text || sending) return
    setDraft('')
    setStream('')
    setErrorText(null)
    setSending(true)
    onSend?.(text)
    try {
      const res = sessionId
        ? await window.electronAPI.sessions.sendMessage(
            realPath,
            sessionId,
            text,
            selectedModel || undefined,
            permission
          )
        : await window.electronAPI.sessions.startMessage(
            realPath,
            text,
            selectedModel || undefined,
            permission
          )
      if (res.error) {
        setErrorText(res.error)
        setSending(false)
      }
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : String(e))
      setSending(false)
    }
  }

  function handleStop() {
    window.electronAPI.sessions.stopMessage()
    setSending(false)
    setStream('')
  }

  return (
    <div className="cl-composer">
      <div className="cl-composer-inner">
        {sending && stream && (
          <div className="cl-composer-stream" ref={streamRef}>
            {stream}
            <span className="cl-composer-caret" aria-hidden />
          </div>
        )}
        {sending && !stream && (
          <div className="cl-composer-stream is-waiting">
            <span className="cl-composer-caret" aria-hidden /> Claude is responding…
          </div>
        )}
        {errorText && <div className="cl-composer-error">{errorText}</div>}

        <div className="cl-composer-row">
          <textarea
            className="cl-composer-input"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            disabled={sending}
            placeholder={
              sessionId
                ? 'Continue this session…  (Enter to send · Shift+Enter for newline)'
                : 'Start a new conversation…  (Enter to send · Shift+Enter for newline)'
            }
            rows={1}
          />
          {sending ? (
            <button type="button" className="cl-composer-btn is-stop" onClick={handleStop}>
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="cl-composer-btn"
              onClick={handleSend}
              disabled={!draft.trim()}
            >
              Send
            </button>
          )}
        </div>

        <div className="cl-composer-meta">
          <span>
            {sessionId
              ? 'Resumes this session · appends to the same transcript'
              : 'Starts a new session · a fresh transcript in this project'}
          </span>
          <span className="cl-composer-meta-tags">
            <ComposerSelect
              label="Model"
              value={selectedModel}
              options={modelOptions}
              onChange={setSelectedModel}
              disabled={sending}
            />
            <ComposerSelect
              label="Permission"
              value={permission}
              options={PERMISSION_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
              onChange={setPermission}
              disabled={sending}
            />
          </span>
        </div>
      </div>
    </div>
  )
}
