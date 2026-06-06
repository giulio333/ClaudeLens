import { useMemo, useState } from 'react'

import { useSessionArtifacts, useDeleteSession } from '../../../hooks/useIPC'
import type { SessionArtifact } from '../../../types'

interface DeleteSessionDialogProps {
  hash: string
  sessionFilename: string
  /** Titolo leggibile della sessione, mostrato nell'intestazione. */
  title?: string
  onCancel: () => void
  onDeleted: () => void
}

// Descrizione secondaria di una voce (conteggio file o avviso "shared").
function artifactDetail(a: SessionArtifact): string | null {
  if (a.kind === 'subagents') return `${a.count ?? 0} transcript${a.count === 1 ? '' : 's'}`
  if (a.kind === 'tasks') return `${a.count ?? 0} task${a.count === 1 ? '' : 's'}`
  if (a.kind === 'plan') {
    const n = a.referencedBy ?? 1
    return n > 1 ? `shared · referenced by ${n} sessions` : 'shared plan file'
  }
  return null
}

export function DeleteSessionDialog({
  hash,
  sessionFilename,
  title,
  onCancel,
  onDeleted,
}: DeleteSessionDialogProps) {
  const { data, isLoading, error } = useSessionArtifacts(hash, sessionFilename)
  const del = useDeleteSession(hash)
  const [selected, setSelected] = useState<Record<string, boolean>>({})

  const artifacts = useMemo(() => data?.artifacts ?? [], [data])

  // Seed the checkboxes from the backend defaults as soon as the artifacts
  // arrive (React's "adjust state during render" pattern — no effect needed).
  const [lastData, setLastData] = useState(data)
  if (data && data !== lastData) {
    setLastData(data)
    const init: Record<string, boolean> = {}
    for (const a of data.artifacts) init[a.path] = a.locked ? true : a.defaultSelected
    setSelected(init)
  }

  const toggle = (a: SessionArtifact) => {
    if (a.locked) return
    setSelected(s => ({ ...s, [a.path]: !s[a.path] }))
  }

  const selectedPaths = useMemo(
    () => artifacts.filter(a => a.locked || selected[a.path]).map(a => a.path),
    [artifacts, selected],
  )

  const busy = del.isPending
  const mutationError = del.error instanceof Error ? del.error.message : null

  const onConfirm = async () => {
    try {
      await del.mutateAsync(selectedPaths)
      onDeleted()
    } catch {
      // l'errore è esposto via del.error: il dialog resta aperto
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[var(--cl-paper-2)] rounded-lg shadow-lg p-6 max-w-md w-full mx-4">
        <h3 className="text-[15px] font-semibold text-[var(--cl-ink)] mb-2">Delete session?</h3>
        <p className="text-[13px] text-[var(--cl-ink-3)] mb-4">
          {title ? (
            <>
              This will permanently delete <span className="font-medium text-[var(--cl-ink)]">{title}</span> and
              the selected artifacts. This cannot be undone.
            </>
          ) : (
            'This will permanently delete the session and the selected artifacts. This cannot be undone.'
          )}
        </p>

        {isLoading && (
          <div className="text-[13px] text-[var(--cl-ink-3)] py-4">Scanning artifacts…</div>
        )}

        {error && (
          <div className="text-[13px] text-[var(--cl-danger)] py-4">
            Failed to read artifacts: {error instanceof Error ? error.message : String(error)}
          </div>
        )}

        {!isLoading && !error && (
          <div className="flex flex-col gap-1.5 mb-5">
            {artifacts.map(a => {
              const checked = a.locked || !!selected[a.path]
              const detail = artifactDetail(a)
              return (
                <label
                  key={a.path}
                  title={a.path}
                  className={`flex items-start gap-2.5 rounded-lg border border-[var(--cl-line)] px-3 py-2 transition-colors ${
                    a.locked ? 'opacity-90' : 'cursor-pointer hover:bg-[var(--cl-paper-3)]'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={a.locked || busy}
                    onChange={() => toggle(a)}
                    className="mt-0.5"
                    style={{ accentColor: 'var(--cl-accent)' }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="text-[13px] font-medium text-[var(--cl-ink)] truncate">{a.label}</span>
                      {a.locked && (
                        <span className="text-[10px] uppercase tracking-wide text-[var(--cl-ink-4)]">always</span>
                      )}
                      {a.shared && (
                        <span className="text-[10px] uppercase tracking-wide text-[var(--cl-ink-4)]">shared</span>
                      )}
                    </span>
                    {detail && (
                      <span className="block text-[11px] text-[var(--cl-ink-4)]">{detail}</span>
                    )}
                  </span>
                </label>
              )
            })}
          </div>
        )}

        {mutationError && (
          <div className="text-[12px] text-[var(--cl-danger)] mb-3">{mutationError}</div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 px-4 py-2 rounded-lg border border-[var(--cl-line)] hover:bg-[var(--cl-paper-3)] disabled:opacity-50 transition-colors text-[13px] font-medium text-[var(--cl-ink-3)]"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy || isLoading || !!error}
            className="flex-1 px-4 py-2 rounded-lg bg-[var(--cl-danger)] hover:bg-[var(--cl-danger)] disabled:opacity-50 transition-colors text-[13px] font-medium text-white"
          >
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
