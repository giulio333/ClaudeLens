import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fmtModel } from '../utils';
import { PermissionRequestDialog } from './PermissionRequestDialog';
import { useEffectiveConfig } from '../../../hooks/useIPC';
import type { PermissionRequest, PermissionDecision } from '../../../hooks/useIPC';

/** The four permission modes Claude Code accepts, labelled for what they do
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
] as const;

type PermissionMode = (typeof PERMISSION_OPTIONS)[number]['value'];

/** Permission modes that need an explicit confirmation before sending. With real
 *  in-app prompts only `bypassPermissions` auto-approves *everything* with no
 *  further asking, so it's the only one gated. `acceptEdits` still routes shell
 *  through `canUseTool`, and `default`/`plan` ask for each action. */
const CONFIRM_MODES: PermissionMode[] = ['bypassPermissions'];

/** Model aliases the CLI resolves on `--model`. The empty value means "send no
 *  --model flag" → Claude Code falls back to its configured default. */
const MODEL_ALIASES = ['sonnet', 'opus', 'haiku'] as const;

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
  label: string;
  value: T;
  options: { value: T; label: string; danger?: boolean; hint?: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const current = options.find(o => o.value === value);

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
                onChange(o.value);
                setOpen(false);
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
  );
}

/** Bottom composer for the Focus chat layout — a purely presentational input
 *  bar. All chat state (the IPC subscriptions, the in-flight turn, the
 *  permission queue, the transcript) lives in `useLiveChat`; this component
 *  owns only what belongs to the input itself: the draft, the slash-command
 *  autocomplete, the Model / Permission pickers and the pre-send confirmation
 *  for risky permission modes. Send hands the text plus the picked options to
 *  the owner (`onSend`); Stop is `onStop`; the pending tool-approval request
 *  arrives as a prop and is answered through `onRespondPermission`.
 *
 *  `model` is the model inherited from the session (its last assistant turn);
 *  it seeds the model picker so a reply defaults to the same model the chat
 *  was on. */
export function ChatComposer({
  realPath,
  sessionId,
  model,
  sending,
  errorText,
  permRequest,
  permPendingCount = 0,
  onRespondPermission,
  onSend,
  onStop,
  lockNotice,
}: {
  realPath: string;
  /** Resume mode when set; new-chat mode when omitted. Drives copy only. */
  sessionId?: string;
  model?: string;
  /** True while a turn is in flight — disables input, shows Stop. */
  sending: boolean;
  /** Error from the current/last turn, shown above the input. */
  errorText?: string | null;
  /** The tool-approval request at the head of the owner's queue, if any. */
  permRequest?: PermissionRequest | null;
  /** How many more requests are queued behind the visible one. */
  permPendingCount?: number;
  /** Answers the visible request; the owner advances its queue. */
  onRespondPermission?: (decision: PermissionDecision) => void;
  /** Fired with the drafted text and the picked options when the user sends. */
  onSend: (text: string, opts: { model?: string; permissionMode: string }) => void;
  /** Stops the in-flight turn (the session stays alive). */
  onStop: () => void;
  /** When set, sending is disabled and this message is shown instead — used
   *  while the session is live in a terminal, where replying here would both
   *  race the CLI on the same transcript and silently spend SDK credits. */
  lockNotice?: string | null;
}) {
  const [draft, setDraft] = useState('');
  // The user's explicit model pick; null = follow the session's inherited model
  // (the `model` prop). Derived rather than seeded once because the prop resolves
  // asynchronously — the transcript may still be loading when the composer
  // mounts — so a one-shot `useState(model)` would lock in '' on first open.
  // Empty string = "Default" (send no model → Claude Code's configured default).
  const [chosenModel, setChosenModel] = useState<string | null>(null);
  const selectedModel = chosenModel !== null ? chosenModel : (model ?? '');
  const [permission, setPermission] = useState<PermissionMode>('default');
  // The risky permission mode the user has already confirmed for this composer;
  // re-asked whenever they switch to a *different* risky mode. null = none yet.
  const [confirmedMode, setConfirmedMode] = useState<PermissionMode | null>(null);
  // Holds the drafted text while the confirmation dialog is open; non-null = open.
  const [pendingText, setPendingText] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // The scrollable slash popover — keyboard nav scrolls its active row into view.
  const slashMenuRef = useRef<HTMLDivElement | null>(null);

  // Slash-command autocomplete. The available commands come from the project's
  // resolved Claude Code config (`init.slashCommands`, cached); sending one is
  // native — the Agent SDK runs a slash command passed in the prompt string.
  const { data: config } = useEffectiveConfig(realPath);
  const slashCommands = useMemo(() => config?.init?.slashCommands ?? [], [config]);
  const [slashIndex, setSlashIndex] = useState(0);
  // Set when the user presses Esc; cleared on the next keystroke so the menu
  // reappears as they keep typing.
  const [slashDismissed, setSlashDismissed] = useState(false);

  // The menu shows only while the draft is a single leading-slash token (no
  // space yet) — i.e. the command name is still being typed, not its arguments.
  const slashQuery = useMemo(() => {
    const m = /^\/(\S*)$/.exec(draft);
    return m ? m[1].toLowerCase() : null;
  }, [draft]);
  // The full prefix-filtered list — no cap. Typing `/` alone shows every command,
  // scrollable within the menu's max-height (see the active-row auto-scroll below).
  const slashMatches = useMemo(() => {
    if (slashQuery === null) return [];
    return slashCommands.filter(c => c.toLowerCase().startsWith(slashQuery));
  }, [slashQuery, slashCommands]);
  // Clamp the highlight in case the candidate set shrank as the user typed.
  const activeSlash = Math.min(slashIndex, slashMatches.length - 1);
  const showSlash = slashMatches.length > 0 && !slashDismissed && !sending;

  // Fill the draft with the picked command (trailing space so args can follow)
  // and keep focus in the textarea. The trailing space closes the menu.
  function applySlash(cmd: string) {
    setDraft(`/${cmd} `);
    setSlashIndex(0);
    textareaRef.current?.focus();
  }

  // Keep the highlighted row visible while arrowing through the full list — the
  // menu scrolls at its max-height. `block: 'nearest'` only nudges the popover
  // when the active row is off-screen, so it's a no-op when it's already visible.
  useEffect(() => {
    if (!showSlash) return;
    slashMenuRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [activeSlash, showSlash]);

  // Build the model options: the inherited concrete id (if any) on top, then the
  // CLI aliases, then "Default" (no --model flag). De-duplicated by value.
  const modelOptions: { value: string; label: string }[] = [
    ...(model ? [{ value: model, label: fmtModel(model) }] : []),
    ...MODEL_ALIASES.filter(a => a !== model).map(a => ({
      value: a,
      label: a[0].toUpperCase() + a.slice(1),
    })),
    { value: '', label: 'Default' },
  ];

  // Gate: a risky permission mode (auto-approves edits/bash) needs an explicit
  // confirmation before the first send, and again if the user switches to a
  // different risky mode. Safe modes send straight through.
  function handleSend() {
    const text = draft.trim();
    if (!text || sending || lockNotice) return;
    if (CONFIRM_MODES.includes(permission) && confirmedMode !== permission) {
      setPendingText(text);
      return;
    }
    doSend(text);
  }

  function confirmAndSend() {
    const text = pendingText;
    if (text == null) return;
    setConfirmedMode(permission);
    setPendingText(null);
    doSend(text);
  }

  function doSend(text: string) {
    setDraft('');
    onSend(text, { model: selectedModel || undefined, permissionMode: permission });
  }

  return (
    <div className="cl-composer">
      <div className="cl-composer-inner">
        {errorText && <div className="cl-composer-error">{errorText}</div>}
        {lockNotice && !sending && (
          <div className="cl-composer-lock">
            <span className="led" aria-hidden />
            {lockNotice}
          </div>
        )}

        <div className="cl-composer-sheet">
          <div className="cl-composer-row">
            {showSlash && (
              <div
                className="cl-slash-menu"
                role="listbox"
                aria-label="Slash commands"
                ref={slashMenuRef}
              >
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
                      e.preventDefault();
                      applySlash(cmd);
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
                setDraft(e.target.value);
                setSlashDismissed(false);
                setSlashIndex(0);
              }}
              onKeyDown={e => {
                if (showSlash) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSlashIndex((activeSlash + 1) % slashMatches.length);
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSlashIndex((activeSlash - 1 + slashMatches.length) % slashMatches.length);
                    return;
                  }
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    applySlash(slashMatches[activeSlash]);
                    return;
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setSlashDismissed(true);
                    return;
                  }
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              disabled={sending || !!lockNotice}
              placeholder={
                lockNotice
                  ? 'This session is live in your terminal'
                  : sessionId
                    ? 'Continue this session…   ⏎ send · ⇧⏎ newline'
                    : 'Start a new conversation…   ⏎ send · ⇧⏎ newline'
              }
              rows={1}
            />
            {sending ? (
              <button type="button" className="cl-composer-btn is-stop" onClick={onStop}>
                Stop
              </button>
            ) : (
              <button
                type="button"
                className="cl-composer-btn"
                onClick={handleSend}
                disabled={!draft.trim() || !!lockNotice}
              >
                Send
                <span className="arrow" aria-hidden>
                  →
                </span>
              </button>
            )}
          </div>

          {/* control rail — inside the sheet, so the pickers read as settings of
              this input rather than three loose badges under it */}
          <div className="cl-composer-meta">
            <span
              className="cl-composer-meta-note"
              title={
                sessionId
                  ? 'Appends to the same transcript this session already has'
                  : 'Starts a fresh transcript in this project'
              }
            >
              <span
                className="cl-composer-billing"
                title="Replies here run through the Agent SDK and are billed to Agent SDK credits — separate from your subscription plan. Sessions in your terminal use the plan."
              >
                <span className="dot" aria-hidden />
                agent sdk credits
              </span>
              <span className="sep" aria-hidden>
                ·
              </span>
              {sessionId ? 'resumes this session' : 'starts a new session'}
            </span>
            <span className="cl-composer-meta-tags">
              <ComposerSelect
                label="Model"
                value={selectedModel}
                options={modelOptions}
                onChange={setChosenModel}
                disabled={sending}
              />
              <span className="sep" aria-hidden>
                ·
              </span>
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
      </div>

      {/* Dialogs ride a portal to <body>: the composer can sit inside a hidden
          (display:none) workspace while an overlay — tool detail, sub-agent
          transcript, Timeline — is up, and an approval request arriving then
          must still be visible and answerable, or the turn deadlocks. */}
      {pendingText !== null &&
        createPortal(
          <SendConfirmDialog
            mode={permission}
            realPath={realPath}
            onCancel={() => setPendingText(null)}
            onConfirm={confirmAndSend}
          />,
          document.body
        )}

      {permRequest &&
        onRespondPermission &&
        createPortal(
          <PermissionRequestDialog
            key={permRequest.requestId}
            request={permRequest}
            pendingCount={permPendingCount}
            onRespond={onRespondPermission}
          />,
          document.body
        )}
    </div>
  );
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
  mode: PermissionMode;
  realPath: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const bypass = mode === 'bypassPermissions';
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
              file edits{' '}
              <span className="font-medium text-[var(--cl-ink)]">and shell commands</span> — without
              asking for approval.
            </>
          ) : (
            <>
              Claude will{' '}
              <span className="font-medium text-[var(--cl-ink)]">auto-approve file edits</span>{' '}
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
              bypass
                ? 'bg-[var(--cl-danger)] hover:bg-[var(--cl-danger)]'
                : 'bg-[var(--cl-accent)] hover:bg-[var(--cl-accent)]'
            }`}
          >
            {bypass ? 'Bypass & send' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
