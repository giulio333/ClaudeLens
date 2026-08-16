import { useProjectPurgePlan, usePurgeProject, useActiveSessions } from '../../../hooks/useIPC';
import type { ActiveSession, PurgePlanItem } from '../../../types';

// Confirmation dialog for deleting a project's Claude Code state.
//
// The plan is NOT rebuilt here: it is the output of `claude project purge
// --dry-run`, i.e. the inventory written by whoever owns the format. A list
// hand-compiled in this file would already have been incomplete — it would miss
// `file-history/` and the line-by-line filter over `history.jsonl` — and it
// would fall behind every new folder Claude Code adds.

interface DeleteProjectDialogProps {
  project: { hash: string; realPath: string };
  onConfirm: () => void;
  onCancel: () => void;
}

// Entries grouped per session (`tasks`, `file-history`) carry a count; the rest
// show their target, which is the useful detail.
function itemDetail(item: PurgePlanItem): string {
  return item.count > 1 ? `${item.count} entries` : item.target;
}

// Named, so a session that blocks the delete can be checked against what the
// user actually has open instead of being a bare count.
function sessionLabel(s: ActiveSession): string {
  const id = s.sessionId ? s.sessionId.slice(0, 8) : 'no session id';
  return `pid ${s.pid} · ${id}${s.status && s.status !== 'unknown' ? ` · ${s.status}` : ''}`;
}

export function DeleteProjectDialog({ project, onConfirm, onCancel }: DeleteProjectDialogProps) {
  const purge = usePurgeProject();
  // Once the purge succeeds the plan has no subject left: the mutation invalidates
  // every query, and without this the dialog would re-read the dry-run of the
  // project it just deleted in the instant before closing — reporting its outcome
  // over an operation that had actually succeeded.
  const {
    data: plan,
    isLoading,
    error,
  } = useProjectPurgePlan(purge.isSuccess ? null : project.hash);
  const { data: active } = useActiveSessions();

  // A session live on this cwd is writing the very files being deleted: the CLI
  // would recreate them mid-purge. Block, don't merely warn.
  //
  // Only registry entries block, though. Those come from
  // `~/.claude/sessions/<pid>.json`, written by the CLI itself, and carry a
  // sessionId — the CLI said it is running here. A `process-scan` entry is the
  // legacy fallback's inference from `ps`, has no sessionId, and used to be
  // wrong in the direction that costs the most: it counted any process whose
  // command line mentions claude (a `git clone …/claude-plugins.git`, a Bash
  // tool's shell) as a session in that folder, disabling the delete over
  // nothing. The scanner is stricter now; it still doesn't get a veto.
  const inProject = (active ?? []).filter(s => s.cwd === project.realPath);
  const liveSessions = inProject.filter(s => s.source === 'registry');
  const scannedProcs = inProject.filter(s => s.source !== 'registry');
  const isLive = liveSessions.length > 0;

  // A declared total with no recognised entries means the CLI's format moved
  // under us: raw output beats an empty dialog, which would collect approval for
  // a deletion it never showed.
  const unparsed = !!plan && plan.items.length === 0 && (plan.totalItems ?? 0) > 0;
  const nothingToPurge = !!plan && plan.items.length === 0 && !unparsed;

  const busy = purge.isPending;
  const purgeError = purge.error instanceof Error ? purge.error.message : null;
  const planError = error instanceof Error ? error.message : error ? String(error) : null;

  const onDelete = async () => {
    try {
      await purge.mutateAsync(project.hash);
      onConfirm();
    } catch {
      // the error stays exposed through purge.error: the dialog does not close
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--cl-paper-2)] rounded-lg shadow-lg p-6 max-w-lg w-full max-h-[86vh] overflow-y-auto">
        <h3 className="text-[15px] font-semibold text-[var(--cl-ink)] mb-1">
          Delete this project&rsquo;s Claude Code state?
        </h3>
        <p className="text-[13px] text-[var(--cl-ink-3)] mb-4">
          Your code is never touched — only what Claude Code stored about this project under{' '}
          <span className="font-mono text-[11px]">~/.claude</span>. Runs{' '}
          <span className="font-mono text-[11px]">claude project purge</span>.
        </p>

        <div className="bg-[var(--cl-paper-3)] border border-[var(--cl-line)] rounded-lg p-3 mb-4 font-mono text-[11px] text-[var(--cl-ink-3)] break-words">
          {plan?.projectPath ?? project.realPath}
        </div>

        {isLoading && (
          <div className="text-[13px] text-[var(--cl-ink-3)] py-4">Reading the purge plan…</div>
        )}

        {planError && (
          <div className="text-[13px] text-[var(--cl-danger)] py-4">
            Could not read the purge plan: {planError}
          </div>
        )}

        {isLive && (
          <div className="text-[12px] text-[var(--cl-danger)] border border-[var(--cl-danger)] rounded-lg px-3 py-2 mb-4">
            {liveSessions.length === 1
              ? 'A Claude Code session is running in this project. Close it first — '
              : `${liveSessions.length} Claude Code sessions are running in this project. Close them first — `}
            deleting now would race the CLI writing to the same files.
            <ul className="mt-1.5 font-mono text-[11px] opacity-80">
              {liveSessions.map(s => (
                <li key={s.pid}>{sessionLabel(s)}</li>
              ))}
            </ul>
          </div>
        )}

        {scannedProcs.length > 0 && (
          <div className="text-[12px] text-[var(--cl-ink-3)] border border-[var(--cl-line)] bg-[var(--cl-warn-soft)] rounded-lg px-3 py-2 mb-4">
            <span className="font-semibold text-[var(--cl-warn)]">Heads up</span> —{' '}
            {scannedProcs.length === 1
              ? 'one process looks'
              : `${scannedProcs.length} processes look`}{' '}
            like Claude Code running in this folder, but carry no session id: they were guessed from{' '}
            <span className="font-mono">ps</span>, not reported by the CLI. Nothing is blocked —
            check them if one is a real session.
            <ul className="mt-1.5 font-mono text-[11px] opacity-80">
              {scannedProcs.map(s => (
                <li key={s.pid}>{sessionLabel(s)}</li>
              ))}
            </ul>
          </div>
        )}

        {plan && !unparsed && plan.items.length > 0 && (
          <>
            <div className="text-[10px] uppercase tracking-wide text-[var(--cl-ink-4)] mb-2">
              Will be deleted{plan.totalItems !== null ? ` · ${plan.totalItems} items` : ''}
            </div>
            <div className="flex flex-col gap-1.5 mb-4">
              {plan.items.map(item => (
                <div
                  key={`${item.kind}:${item.detail}`}
                  title={item.targets.join('\n')}
                  className="flex items-start gap-2.5 rounded-lg border border-[var(--cl-line)] px-3 py-2"
                >
                  <span className="text-[10px] uppercase tracking-wide text-[var(--cl-ink-4)] mt-0.5 shrink-0 w-[42px]">
                    {item.kind}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-[var(--cl-ink)]">{item.detail}</span>
                    <span className="block text-[11px] text-[var(--cl-ink-4)] font-mono truncate">
                      {itemDetail(item)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {nothingToPurge && (
          <div className="text-[13px] text-[var(--cl-ink-3)] py-3">
            Claude Code reports no stored state for this project — there is nothing to delete.
          </div>
        )}

        {unparsed && (
          <>
            <div className="text-[10px] uppercase tracking-wide text-[var(--cl-ink-4)] mb-2">
              Purge plan (raw output)
            </div>
            <pre className="bg-[var(--cl-paper-3)] border border-[var(--cl-line)] rounded-lg p-3 mb-4 font-mono text-[11px] text-[var(--cl-ink-3)] whitespace-pre-wrap max-h-52 overflow-y-auto">
              {plan.raw.trim()}
            </pre>
          </>
        )}

        {plan && plan.items.length > 0 && (
          <div className="text-[11px] text-[var(--cl-ink-4)] mb-4 leading-relaxed">
            <span className="uppercase tracking-wide">Kept</span> — your source files, this
            project&rsquo;s <span className="font-mono">.claude/</span> folder (memory, agents,
            skills, local workflows), and its teams and plans, which{' '}
            <span className="font-mono">purge</span> does not cover.
            {plan.notes.map(note => (
              <span key={note} className="block mt-1">
                {note}
              </span>
            ))}
          </div>
        )}

        {purgeError && <div className="text-[12px] text-[var(--cl-danger)] mb-3">{purgeError}</div>}

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 px-4 py-2 rounded-lg border border-[var(--cl-line)] hover:bg-[var(--cl-paper-3)] disabled:opacity-50 transition-colors text-[13px] font-medium text-[var(--cl-ink-3)]"
          >
            Cancel
          </button>
          <button
            onClick={onDelete}
            disabled={busy || isLoading || !!planError || isLive || nothingToPurge}
            className="flex-1 px-4 py-2 rounded-lg bg-[var(--cl-danger)] hover:bg-[var(--cl-danger)] disabled:opacity-50 transition-colors text-[13px] font-medium text-white"
          >
            {busy ? 'Deleting…' : 'Delete state'}
          </button>
        </div>
      </div>
    </div>
  );
}
