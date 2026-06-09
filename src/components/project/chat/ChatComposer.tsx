import { useEffect, useMemo, useRef, useState } from 'react'
import { fmtModel } from '../utils'
import { PermissionRequestDialog } from './PermissionRequestDialog'
import { useEffectiveConfig } from '../../../hooks/useIPC'
import type { PermissionRequest, PermissionDecision, ChatMessage } from '../../../hooks/useIPC'

/** The four permission modes Claude Code accepts, labelled for what they now do
 *  with *interactive* approvals: the chat runs through the Agent SDK's
 *  `canUseTool`, so a tool that isn't auto-approved pops an in-app Allow / Always
 *  / Deny dialog instead of being silently denied. The labels reflect that.
 *
 *  Default is `default` (see RESUME_PERMISSION_MODE in main.ts) — every action
 *  asks, matching the live terminal chat. */
const PERMISSION_OPTIONS = [
  {
    value: 'default',
    label: 'Ask in app',
    hint: 'Every action asks for approval in a dialog',
  },
  {
    value: 'acceptEdits',
    label: 'Accept edits',
    hint: 'Auto-approves file edits; other tools still ask',
  },
  {
    value: 'plan',
    label: 'Plan only',
    hint: 'Proposes a plan without touching files or running commands',
  },
  {
    value: 'bypassPermissions',
    label: 'Bypass all',
    danger: true,
    hint: 'Runs every tool — edits and shell — with no approval',
  },
] as const

type PermissionMode = (typeof PERMISSION_OPTIONS)[number]['value']

/** Permission modes that need an explicit confirmation before sending. With real
 *  in-app prompts only `bypassPermissions` auto-approves *everything* with no
 *  further asking, so it's the only one gated. `acceptEdits` still routes shell
 *  through `canUseTool`, and `default`/`plan` ask for each action. */
const CONFIRM_MODES: PermissionMode[] = ['bypassPermissions']

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
  options: { value: T; label: string; danger?: boolean; hint?: string }[]
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
              <span className="cl-composer-menu-item-label">{o.label}</span>
              {o.hint && <span className="cl-composer-menu-item-hint">{o.hint}</span>}
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
  onStreamChange,
  onStreamingChange,
  onLiveMessagesChange,
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
  /** Lifts the live assistant text up so the parent can render it inline in the
   *  transcript (instead of the composer's own preview strip). */
  onStreamChange?: (text: string) => void
  /** Lifts the streaming on/off state up for the same inline rendering. */
  onStreamingChange?: (active: boolean) => void
  /** Lifts up the fully-formed messages the SDK emits during the turn (assistant
   *  turns + tool results), so the parent can render the live turn — tools and
   *  all — without re-reading the half-written transcript from disk. */
  onLiveMessagesChange?: (messages: ChatMessage[]) => void
}) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [stream, setStream] = useState('')
  // Fully-formed messages received from the SDK during the in-flight turn.
  const [liveMessages, setLiveMessages] = useState<ChatMessage[]>([])
  const [errorText, setErrorText] = useState<string | null>(null)
  // Empty string = inherit the session's model (or the configured default when
  // the session recorded none). Seeded from the inherited model so the first
  // reply stays on the same model the chat was using.
  const [selectedModel, setSelectedModel] = useState<string>(model ?? '')
  const [permission, setPermission] = useState<PermissionMode>('default')
  // The pending tool-approval request forwarded from the SDK's canUseTool, if any.
  const [permReq, setPermReq] = useState<PermissionRequest | null>(null)
  // The risky permission mode the user has already confirmed for this composer;
  // re-asked whenever they switch to a *different* risky mode. null = none yet.
  const [confirmedMode, setConfirmedMode] = useState<PermissionMode | null>(null)
  // Holds the drafted text while the confirmation dialog is open; non-null = open.
  const [pendingText, setPendingText] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  // Slash-command autocomplete. The available commands come from the project's
  // resolved Claude Code config (`init.slashCommands`, cached); sending one is
  // native — the Agent SDK runs a slash command passed in the prompt string.
  const { data: config } = useEffectiveConfig(realPath)
  const slashCommands = useMemo(() => config?.init?.slashCommands ?? [], [config])
  const [slashIndex, setSlashIndex] = useState(0)
  // Set when the user presses Esc; cleared on the next keystroke so the menu
  // reappears as they keep typing.
  const [slashDismissed, setSlashDismissed] = useState(false)

  // The menu shows only while the draft is a single leading-slash token (no
  // space yet) — i.e. the command name is still being typed, not its arguments.
  const slashQuery = useMemo(() => {
    const m = /^\/(\S*)$/.exec(draft)
    return m ? m[1].toLowerCase() : null
  }, [draft])
  const slashMatches = useMemo(() => {
    if (slashQuery === null) return []
    return slashCommands.filter(c => c.toLowerCase().startsWith(slashQuery)).slice(0, 8)
  }, [slashQuery, slashCommands])
  // Clamp the highlight in case the candidate set shrank as the user typed.
  const activeSlash = Math.min(slashIndex, slashMatches.length - 1)
  const showSlash = slashMatches.length > 0 && !slashDismissed && !sending

  // Fill the draft with the picked command (trailing space so args can follow)
  // and keep focus in the textarea. The trailing space closes the menu.
  function applySlash(cmd: string) {
    setDraft(`/${cmd} `)
    setSlashIndex(0)
    textareaRef.current?.focus()
  }

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
    window.electronAPI.sessions.onChatMessage(message => {
      setLiveMessages(prev => [...prev, message])
      // A completed assistant message absorbs the partial text we were streaming
      // into the preview; clear it so the next message's deltas start fresh and
      // the trailing LiveTurn doesn't echo text now shown as a real bubble.
      if (message.role === 'assistant') setStream('')
    })
    window.electronAPI.sessions.onChatError(message =>
      setErrorText(prev => (prev ? prev + '\n' : '') + message)
    )
    window.electronAPI.sessions.onPermissionRequest(req => setPermReq(req))
    window.electronAPI.sessions.onChatDone(() => {
      setSending(false)
      setStream('')
      // A turn can't end with a request still on screen (the SDK denied it on
      // teardown); clear any stale dialog.
      setPermReq(null)
      // The watcher has likely refetched mid-stream already; refetch again so the
      // final turn is on screen the instant the run closes.
      onTurnComplete()
    })
    return () => {
      window.electronAPI.sessions.onChatStarted(() => {})
      window.electronAPI.sessions.onChatChunk(() => {})
      window.electronAPI.sessions.onChatMessage(() => {})
      window.electronAPI.sessions.onChatError(() => {})
      window.electronAPI.sessions.onPermissionRequest(() => {})
      window.electronAPI.sessions.onChatDone(() => {})
    }
  }, [onTurnComplete, onStarted])

  // Answer a tool-approval request and close the dialog.
  function respondPermission(decision: PermissionDecision) {
    if (!permReq) return
    void window.electronAPI.sessions.respondPermission(permReq.requestId, decision)
    setPermReq(null)
  }

  // Lift the live text + streaming state up so the parent renders the assistant's
  // partial reply inline in the transcript, where the final message will land —
  // no detached preview window that closes and re-appears.
  useEffect(() => {
    onStreamChange?.(stream)
  }, [stream, onStreamChange])
  useEffect(() => {
    onStreamingChange?.(sending)
  }, [sending, onStreamingChange])
  useEffect(() => {
    onLiveMessagesChange?.(liveMessages)
  }, [liveMessages, onLiveMessagesChange])

  // Gate: a risky permission mode (auto-approves edits/bash) needs an explicit
  // confirmation before the first send, and again if the user switches to a
  // different risky mode. Safe modes send straight through.
  function handleSend() {
    const text = draft.trim()
    if (!text || sending) return
    if (CONFIRM_MODES.includes(permission) && confirmedMode !== permission) {
      setPendingText(text)
      return
    }
    void doSend(text)
  }

  function confirmAndSend() {
    const text = pendingText
    if (text == null) return
    setConfirmedMode(permission)
    setPendingText(null)
    void doSend(text)
  }

  async function doSend(text: string) {
    setStream('')
    setLiveMessages([])
    setErrorText(null)
    setSending(true)
    setDraft('')
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
    setPermReq(null)
  }

  return (
    <div className="cl-composer">
      <div className="cl-composer-inner">
        {errorText && <div className="cl-composer-error">{errorText}</div>}

        <div className="cl-composer-row">
          {showSlash && (
            <div className="cl-slash-menu" role="listbox" aria-label="Slash commands">
              <span className="cl-composer-menu-label">Slash commands</span>
              {slashMatches.map((cmd, i) => (
                <button
                  key={cmd}
                  type="button"
                  role="option"
                  aria-selected={i === activeSlash}
                  className={i === activeSlash ? 'is-active' : ''}
                  onMouseEnter={() => setSlashIndex(i)}
                  // mousedown (not click) + preventDefault: pick before the
                  // textarea loses focus, so the caret stays put.
                  onMouseDown={e => {
                    e.preventDefault()
                    applySlash(cmd)
                  }}
                >
                  <span className="cl-slash-name">/{cmd}</span>
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            className="cl-composer-input"
            value={draft}
            onChange={e => {
              setDraft(e.target.value)
              setSlashDismissed(false)
              setSlashIndex(0)
            }}
            onKeyDown={e => {
              if (showSlash) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setSlashIndex((activeSlash + 1) % slashMatches.length)
                  return
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setSlashIndex((activeSlash - 1 + slashMatches.length) % slashMatches.length)
                  return
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault()
                  applySlash(slashMatches[activeSlash])
                  return
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setSlashDismissed(true)
                  return
                }
              }
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
              options={PERMISSION_OPTIONS.map(o => ({
                value: o.value,
                label: o.label,
                danger: 'danger' in o ? o.danger : undefined,
                hint: o.hint,
              }))}
              onChange={setPermission}
              disabled={sending}
            />
          </span>
        </div>
      </div>

      {pendingText !== null && (
        <SendConfirmDialog
          mode={permission}
          realPath={realPath}
          onCancel={() => setPendingText(null)}
          onConfirm={confirmAndSend}
        />
      )}

      {permReq && <PermissionRequestDialog request={permReq} onRespond={respondPermission} />}
    </div>
  )
}

/** Confirmation gate shown before sending in a permission mode that lets the
 *  agent act on disk without asking. Spells out exactly what the agent may do in
 *  the real project directory, so a send is a deliberate choice — not a stray
 *  Enter. `bypassPermissions` gets the stronger, danger-styled warning. */
function SendConfirmDialog({
  mode,
  realPath,
  onCancel,
  onConfirm,
}: {
  mode: PermissionMode
  realPath: string
  onCancel: () => void
  onConfirm: () => void
}) {
  const bypass = mode === 'bypassPermissions'
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[var(--cl-paper-2)] rounded-lg shadow-lg p-6 max-w-md w-full mx-4">
        <h3 className="text-[15px] font-semibold text-[var(--cl-ink)] mb-2">
          {bypass ? 'Run with all permissions bypassed?' : 'Run with edits auto-approved?'}
        </h3>
        <p className="text-[13px] text-[var(--cl-ink-3)] mb-3">
          {bypass ? (
            <>
              Claude will run <span className="font-medium text-[var(--cl-ink)]">every tool</span> —
              file edits <span className="font-medium text-[var(--cl-ink)]">and shell commands</span> —
              without asking for approval.
            </>
          ) : (
            <>
              Claude will <span className="font-medium text-[var(--cl-ink)]">auto-approve file edits</span>{' '}
              while running. The riskiest shell commands still require interaction.
            </>
          )}
        </p>
        <p className="text-[12px] text-[var(--cl-ink-4)] mb-5 break-all">
          Working directory: <span className="font-mono text-[var(--cl-ink-3)]">{realPath}</span>
        </p>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-4 py-2 rounded-lg border border-[var(--cl-line)] hover:bg-[var(--cl-paper-3)] transition-colors text-[13px] font-medium text-[var(--cl-ink-3)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`flex-1 px-4 py-2 rounded-lg transition-colors text-[13px] font-medium text-white ${
              bypass ? 'bg-[var(--cl-danger)] hover:bg-[var(--cl-danger)]' : 'bg-[var(--cl-accent)] hover:bg-[var(--cl-accent)]'
            }`}
          >
            {bypass ? 'Bypass & send' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
