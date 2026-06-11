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

/** One of Claude's clarifying questions, as carried by the AskUserQuestion
 *  tool input (`questions[]`). Options are multiple-choice; `multiSelect`
 *  allows picking more than one. */
interface AskQuestion {
  question: string
  header?: string
  options: { label: string; description?: string }[]
  multiSelect?: boolean
}

/** Extracts the `questions` array from an AskUserQuestion input, dropping any
 *  malformed entries. An empty result makes the dialog fall back to the
 *  generic Allow/Deny rendering rather than an unanswerable form. */
function parseQuestions(input: Record<string, unknown>): AskQuestion[] {
  const raw = input?.questions
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (q): q is AskQuestion =>
      !!q &&
      typeof q === 'object' &&
      typeof (q as { question?: unknown }).question === 'string' &&
      Array.isArray((q as { options?: unknown }).options)
  )
}

/** Form for Claude's clarifying questions (the AskUserQuestion tool). The SDK
 *  expects the *answers* back inside the allowed input — `{ questions, answers }`
 *  where each key is the question text and each value the chosen label(s) (or
 *  the user's free text) — so a plain "Allow" passing the input through would
 *  leave every question unanswered. Single-select questions pick one option,
 *  multi-select toggle several (joined with ", "); an "Other" field accepts a
 *  custom answer and, on single-select, supersedes the picked option. */
function QuestionForm({
  request,
  questions,
  onRespond,
}: {
  request: PermissionRequest
  questions: AskQuestion[]
  onRespond: (decision: PermissionDecision) => void
}) {
  const [picks, setPicks] = useState<Record<number, string[]>>({})
  const [others, setOthers] = useState<Record<number, string>>({})

  function toggle(qi: number, label: string, multi: boolean) {
    setPicks(prev => {
      const cur = prev[qi] ?? []
      if (multi) {
        return {
          ...prev,
          [qi]: cur.includes(label) ? cur.filter(l => l !== label) : [...cur, label],
        }
      }
      return { ...prev, [qi]: [label] }
    })
    // On single-select, picking an option supersedes any free-text answer.
    if (!multi) setOthers(prev => ({ ...prev, [qi]: '' }))
  }

  function setOther(qi: number, value: string, multi: boolean) {
    setOthers(prev => ({ ...prev, [qi]: value }))
    // Free text replaces the picked option on single-select questions.
    if (!multi && value.trim()) setPicks(prev => ({ ...prev, [qi]: [] }))
  }

  function answerOf(qi: number): string {
    const parts = [...(picks[qi] ?? [])]
    const other = (others[qi] ?? '').trim()
    if (other) parts.push(other)
    return parts.join(', ')
  }

  const complete = questions.every((_q, qi) => answerOf(qi) !== '')

  function submit() {
    const answers: Record<string, string> = {}
    questions.forEach((q, qi) => {
      answers[q.question] = answerOf(qi)
    })
    onRespond({ kind: 'allow', input: { questions: request.input.questions, answers } })
  }

  return (
    <>
      <div className="flex flex-col gap-4 mb-4 max-h-[55vh] overflow-auto">
        {questions.map((q, qi) => (
          <div key={qi}>
            {q.header && (
              <span className="text-[11px] font-mono uppercase tracking-wide text-[var(--cl-ink-4)]">
                {q.header}
              </span>
            )}
            <p className="text-[13px] font-medium text-[var(--cl-ink)] mb-2">{q.question}</p>
            <div className="flex flex-col gap-1.5">
              {q.options.map(opt => {
                const on = (picks[qi] ?? []).includes(opt.label)
                return (
                  <button
                    key={opt.label}
                    type="button"
                    role={q.multiSelect ? 'checkbox' : 'radio'}
                    aria-checked={on}
                    onClick={() => toggle(qi, opt.label, !!q.multiSelect)}
                    className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                      on
                        ? 'border-[var(--cl-accent)] bg-[var(--cl-paper-3)]'
                        : 'border-[var(--cl-line)] hover:bg-[var(--cl-paper-3)]'
                    }`}
                  >
                    <span className="block text-[13px] font-medium text-[var(--cl-ink)]">
                      {opt.label}
                    </span>
                    {opt.description && (
                      <span className="block text-[12px] text-[var(--cl-ink-3)]">
                        {opt.description}
                      </span>
                    )}
                  </button>
                )
              })}
              <input
                type="text"
                className="w-full text-[13px] rounded-lg border border-[var(--cl-line)] bg-[var(--cl-paper)] px-3 py-2 text-[var(--cl-ink)]"
                placeholder="Other…"
                value={others[qi] ?? ''}
                onChange={e => setOther(qi, e.target.value, !!q.multiSelect)}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => onRespond({ kind: 'deny', message: 'User dismissed the questions.' })}
          className="flex-1 px-4 py-2 rounded-lg border border-[var(--cl-line)] hover:bg-[var(--cl-paper-3)] transition-colors text-[13px] font-medium text-[var(--cl-ink-3)]"
        >
          Dismiss
        </button>
        <button
          type="button"
          disabled={!complete}
          onClick={submit}
          className="flex-1 px-4 py-2 rounded-lg bg-[var(--cl-accent)] hover:bg-[var(--cl-accent)] transition-colors text-[13px] font-medium text-white disabled:opacity-50"
        >
          Answer
        </button>
      </div>
    </>
  )
}

/** Interactive tool-approval dialog — the in-app equivalent of the terminal's
 *  permission prompt. Shown when the Agent SDK's `canUseTool` fires in the main
 *  process and forwards the request here. The user picks Allow (this once),
 *  Always allow (persists the SDK's suggested rule), or Deny (with an optional
 *  message Claude sees). The choice round-trips back to the SDK via
 *  `respondPermission`. AskUserQuestion requests render a dedicated answer form
 *  instead (see QuestionForm). Styled after `SendConfirmDialog`. */
export function PermissionRequestDialog({
  request,
  pendingCount = 0,
  onRespond,
}: {
  request: PermissionRequest
  /** How many further requests are queued behind this one (shown as a hint). */
  pendingCount?: number
  onRespond: (decision: PermissionDecision) => void
}) {
  const [denying, setDenying] = useState(false)
  const [denyMessage, setDenyMessage] = useState('')

  const questions = request.toolName === 'AskUserQuestion' ? parseQuestions(request.input) : []
  const isQuestion = questions.length > 0

  const heading = isQuestion
    ? 'Claude has a question'
    : request.title || `Allow ${request.displayName || request.toolName}?`
  const detail = isQuestion ? null : describeInput(request)
  const canAlways = (request.suggestions?.length ?? 0) > 0

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[var(--cl-paper-2)] rounded-lg shadow-lg p-6 max-w-md w-full mx-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[11px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--cl-paper-3)] text-[var(--cl-ink-3)]">
            {request.toolName}
          </span>
          {pendingCount > 0 && (
            <span className="text-[11px] text-[var(--cl-ink-4)]">+{pendingCount} more pending</span>
          )}
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

        {isQuestion ? (
          <QuestionForm request={request} questions={questions} onRespond={onRespond} />
        ) : denying ? (
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
                onClick={() =>
                  onRespond({ kind: 'deny', message: denyMessage.trim() || undefined })
                }
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
