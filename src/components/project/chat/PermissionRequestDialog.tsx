import { useState } from 'react'
import type { PermissionRequest, PermissionDecision } from '../../../hooks/useIPC'

/** Pretty-prints the most relevant slice of a tool input for the dialog body.
 *  Bash shows its `command`; file tools show their `file_path`/`path`; anything
 *  else falls back to a compact JSON of the input. */
function describeInput(req: PermissionRequest): string | null {
  const input = req.input ?? {}
  if (typeof input.command === 'string') return input.command
  if (typeof input.file_path === 'string') return input.file_path
  if (typeof input.path === 'string') return input.path
  const keys = Object.keys(input)
  if (keys.length === 0) return null
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return null
  }
}

/** Interactive tool-approval dialog — the in-app equivalent of the terminal's
 *  permission prompt. Shown when the Agent SDK's `canUseTool` fires in the main
 *  process and forwards the request here. The user picks Allow (this once),
 *  Always allow (persists the SDK's suggested rule), or Deny (with an optional
 *  message Claude sees). The choice round-trips back to the SDK via
 *  `respondPermission`. Styled after `SendConfirmDialog`. */
export function PermissionRequestDialog({
  request,
  onRespond,
}: {
  request: PermissionRequest
  onRespond: (decision: PermissionDecision) => void
}) {
  const [denying, setDenying] = useState(false)
  const [denyMessage, setDenyMessage] = useState('')

  const heading =
    request.title || `Allow ${request.displayName || request.toolName}?`
  const detail = describeInput(request)
  const canAlways = (request.suggestions?.length ?? 0) > 0

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[var(--cl-paper-2)] rounded-lg shadow-lg p-6 max-w-md w-full mx-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[11px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--cl-paper-3)] text-[var(--cl-ink-3)]">
            {request.toolName}
          </span>
        </div>
        <h3 className="text-[15px] font-semibold text-[var(--cl-ink)] mb-2">{heading}</h3>

        {request.description && (
          <p className="text-[13px] text-[var(--cl-ink-3)] mb-3">{request.description}</p>
        )}

        {detail && (
          <pre className="text-[12px] font-mono text-[var(--cl-ink)] bg-[var(--cl-paper-3)] rounded-md p-3 mb-3 max-h-48 overflow-auto whitespace-pre-wrap break-all">
            {detail}
          </pre>
        )}

        {request.blockedPath && (
          <p className="text-[12px] text-[var(--cl-ink-4)] mb-3 break-all">
            Path: <span className="font-mono text-[var(--cl-ink-3)]">{request.blockedPath}</span>
          </p>
        )}

        {denying ? (
          <>
            <textarea
              className="w-full text-[13px] rounded-lg border border-[var(--cl-line)] bg-[var(--cl-paper)] p-2 mb-4 text-[var(--cl-ink)] resize-none"
              rows={2}
              autoFocus
              placeholder="Optional: tell Claude why (it sees this)…"
              value={denyMessage}
              onChange={e => setDenyMessage(e.target.value)}
            />
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setDenying(false)}
                className="flex-1 px-4 py-2 rounded-lg border border-[var(--cl-line)] hover:bg-[var(--cl-paper-3)] transition-colors text-[13px] font-medium text-[var(--cl-ink-3)]"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => onRespond({ kind: 'deny', message: denyMessage.trim() || undefined })}
                className="flex-1 px-4 py-2 rounded-lg bg-[var(--cl-danger)] hover:bg-[var(--cl-danger)] transition-colors text-[13px] font-medium text-white"
              >
                Deny
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => onRespond({ kind: 'allow', input: request.input })}
              className="w-full px-4 py-2 rounded-lg bg-[var(--cl-accent)] hover:bg-[var(--cl-accent)] transition-colors text-[13px] font-medium text-white"
            >
              Allow once
            </button>
            {canAlways && (
              <button
                type="button"
                onClick={() =>
                  onRespond({
                    kind: 'always',
                    input: request.input,
                    suggestions: request.suggestions,
                  })
                }
                className="w-full px-4 py-2 rounded-lg border border-[var(--cl-line)] hover:bg-[var(--cl-paper-3)] transition-colors text-[13px] font-medium text-[var(--cl-ink)]"
              >
                Always allow
              </button>
            )}
            <button
              type="button"
              onClick={() => setDenying(true)}
              className="w-full px-4 py-2 rounded-lg border border-[var(--cl-line)] hover:bg-[var(--cl-paper-3)] transition-colors text-[13px] font-medium text-[var(--cl-ink-3)]"
            >
              Deny…
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
