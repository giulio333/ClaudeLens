import { useMemo, useState } from 'react';

import { useSessionArtifacts, useDeleteSession } from '../../../hooks/useIPC';
import type { ArtifactOutcome, DeleteSessionResult, SessionArtifact } from '../../../types';
import { trackEvent } from '../../../lib/telemetry';

interface DeleteSessionDialogProps {
  hash: string;
  sessionFilename: string;
  /** Titolo leggibile della sessione, mostrato nell'intestazione. */
  title?: string;
  onCancel: () => void;
  onDeleted: () => void;
}

// Descrizione secondaria di una voce (conteggio file o avviso "shared").
function artifactDetail(a: SessionArtifact): string | null {
  if (a.kind === 'subagents') return `${a.count ?? 0} transcript${a.count === 1 ? '' : 's'}`;
  if (a.kind === 'tasks') return `${a.count ?? 0} task${a.count === 1 ? '' : 's'}`;
  if (a.kind === 'plan') {
    const n = a.referencedBy ?? 1;
    return n > 1 ? `shared · referenced by ${n} sessions` : 'shared plan file';
  }
  return null;
}

// Le quattro parole con cui il report nomina un esito. `absent` non dice
// "deleted": la voce non c'era, e questa chiamata non ha fatto niente su di essa.
const STATUS_WORD: Record<ArtifactOutcome['status'], string> = {
  deleted: 'deleted',
  absent: 'already gone',
  refused: 'refused',
  failed: 'still there',
};

function isGone(o: ArtifactOutcome): boolean {
  return o.status === 'deleted' || o.status === 'absent';
}

export function DeleteSessionDialog({
  hash,
  sessionFilename,
  title,
  onCancel,
  onDeleted,
}: DeleteSessionDialogProps) {
  const { data, isLoading, error } = useSessionArtifacts(hash, sessionFilename);
  const del = useDeleteSession(hash);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  // L'esito, quando c'è qualcosa da dire su di esso. Una cancellazione
  // interamente riuscita non passa da qui: chiude e naviga, come prima.
  const [report, setReport] = useState<DeleteSessionResult | null>(null);

  const artifacts = useMemo(() => data?.artifacts ?? [], [data]);

  // Seed the checkboxes from the backend defaults as soon as the artifacts
  // arrive (React's "adjust state during render" pattern — no effect needed).
  const [lastData, setLastData] = useState(data);
  if (data && data !== lastData) {
    setLastData(data);
    const init: Record<string, boolean> = {};
    for (const a of data.artifacts) init[a.path] = a.locked ? true : a.defaultSelected;
    setSelected(init);
  }

  const toggle = (a: SessionArtifact) => {
    if (a.locked) return;
    setSelected(s => ({ ...s, [a.path]: !s[a.path] }));
  };

  // `required` viaggia con ogni path: è ciò che permette al main di dire se la
  // cancellazione è servita a qualcosa. `locked` è il transcript della sessione,
  // l'unico artefatto la cui sopravvivenza rende falsa l'intera operazione.
  const requests = useMemo(
    () =>
      artifacts
        .filter(a => a.locked || selected[a.path])
        .map(a => ({ path: a.path, required: a.locked === true })),
    [artifacts, selected]
  );

  // Nel report i path tornano dal main: qui si rimappano sull'etichetta che
  // l'utente ha appena letto nella checklist, non su un path assoluto.
  const labelOf = (path: string): string =>
    artifacts.find(a => a.path === path)?.label ?? path.split('/').pop() ?? path;

  const busy = del.isPending;
  const mutationError = del.error instanceof Error ? del.error.message : null;

  const onConfirm = async () => {
    try {
      const result = await del.mutateAsync(requests);
      // Il transcript è andato: la sessione è cancellata, e va contata come tale
      // anche se un artefatto opzionale è rimasto indietro.
      if (result.succeeded) trackEvent('session_deleted');
      if (result.succeeded && result.warnings.length === 0) {
        onDeleted();
        return;
      }
      // Qualcosa non è andato come chiesto: si dice quale, invece di navigare
      // via lasciando l'utente convinto che sia tutto sparito.
      setReport(result);
    } catch {
      // l'errore è esposto via del.error: il dialog resta aperto
    }
  };

  const requiredFailed = report !== null && !report.succeeded;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[var(--cl-paper-2)] rounded-lg shadow-lg p-6 max-w-md w-full mx-4">
        <h3 className="text-[15px] font-semibold text-[var(--cl-ink)] mb-2">
          {report === null
            ? 'Delete session?'
            : requiredFailed
              ? 'The session was not deleted'
              : 'Session deleted, with leftovers'}
        </h3>
        <p className="text-[13px] text-[var(--cl-ink-3)] mb-4">
          {report === null ? (
            title ? (
              <>
                This will permanently delete{' '}
                <span className="font-medium text-[var(--cl-ink)]">{title}</span> and the selected
                artifacts. This cannot be undone.
              </>
            ) : (
              'This will permanently delete the session and the selected artifacts. This cannot be undone.'
            )
          ) : requiredFailed ? (
            'Its transcript is still on disk, so the session is still there. Anything listed as deleted below is gone for good.'
          ) : (
            'The transcript is gone. These artifacts were selected but could not be removed — they are still on disk.'
          )}
        </p>

        {report === null && isLoading && (
          <div className="text-[13px] text-[var(--cl-ink-3)] py-4">Scanning artifacts…</div>
        )}

        {report === null && error && (
          <div className="text-[13px] text-[var(--cl-danger)] py-4">
            Failed to read artifacts: {error instanceof Error ? error.message : String(error)}
          </div>
        )}

        {report === null && !isLoading && !error && (
          <div className="flex flex-col gap-1.5 mb-5">
            {artifacts.map(a => {
              const checked = a.locked || !!selected[a.path];
              const detail = artifactDetail(a);
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
                      <span className="text-[13px] font-medium text-[var(--cl-ink)] truncate">
                        {a.label}
                      </span>
                      {a.locked && (
                        <span className="text-[10px] uppercase tracking-wide text-[var(--cl-ink-4)]">
                          always
                        </span>
                      )}
                      {a.shared && (
                        <span className="text-[10px] uppercase tracking-wide text-[var(--cl-ink-4)]">
                          shared
                        </span>
                      )}
                    </span>
                    {detail && (
                      <span className="block text-[11px] text-[var(--cl-ink-4)]">{detail}</span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        )}

        {report !== null && (
          <div className="flex flex-col gap-1.5 mb-5">
            {report.outcomes.map(o => {
              const gone = isGone(o);
              return (
                <div
                  key={o.path}
                  title={o.path}
                  className="flex items-start gap-2.5 rounded-lg border border-[var(--cl-line)] px-3 py-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="text-[13px] font-medium text-[var(--cl-ink)] truncate">
                        {labelOf(o.path)}
                      </span>
                      {o.required && (
                        <span className="text-[10px] uppercase tracking-wide text-[var(--cl-ink-4)]">
                          required
                        </span>
                      )}
                    </span>
                    {o.reason && (
                      <span className="block text-[11px] text-[var(--cl-ink-4)]">{o.reason}</span>
                    )}
                  </span>
                  <span
                    className="text-[10px] uppercase tracking-wide shrink-0 mt-0.5"
                    style={{ color: gone ? 'var(--cl-ink-4)' : 'var(--cl-danger)' }}
                  >
                    {STATUS_WORD[o.status]}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {mutationError && (
          <div className="text-[12px] text-[var(--cl-danger)] mb-3">{mutationError}</div>
        )}

        <div className="flex gap-3">
          <button
            onClick={report !== null && !requiredFailed ? onDeleted : onCancel}
            disabled={busy}
            className="flex-1 px-4 py-2 rounded-lg border border-[var(--cl-line)] hover:bg-[var(--cl-paper-3)] disabled:opacity-50 transition-colors text-[13px] font-medium text-[var(--cl-ink-3)]"
          >
            {report === null ? 'Cancel' : requiredFailed ? 'Close' : 'Done'}
          </button>
          {(report === null || requiredFailed) && (
            <button
              onClick={onConfirm}
              disabled={busy || isLoading || !!error}
              className="flex-1 px-4 py-2 rounded-lg bg-[var(--cl-danger)] hover:bg-[var(--cl-danger)] disabled:opacity-50 transition-colors text-[13px] font-medium text-white"
            >
              {busy ? 'Deleting…' : report === null ? 'Delete' : 'Try again'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
