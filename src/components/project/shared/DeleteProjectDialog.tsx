import { useProjectPurgePlan, usePurgeProject, useActiveSessions } from '../../../hooks/useIPC';
import type { ActiveSession, PurgePlanItem, PurgePlanProject, PurgeResult } from '../../../types';

// Confirmation dialog for deleting a project's Claude Code state.
//
// The plan is NOT rebuilt here: it is the output of `claude project purge
// --dry-run`, i.e. the inventory written by whoever owns the format. A list
// hand-compiled in this file would already have been incomplete — it would miss
// `file-history/` and the line-by-line filter over `history.jsonl` — and it
// would fall behind every new folder Claude Code adds.
//
// Since #224 this dialog also has to survive the fact that the CLI's unit is a
// path SUBTREE, not a project: a plan can name projects the user never selected.
// Three rules follow, and each one failed silently before:
//
//   1. the projects in the plan are listed one row each, named — the count is of
//      projects, not only of items. `groupItems` used to fold them into a single
//      `×3` row headed by the one path the user recognised;
//   2. more than one project, or a plan we could not parse, DISABLES the button.
//      The same guard runs in `project-purger.ts`, so a purge cannot be reached
//      by a UI that forgot to check;
//   3. the outcome is read, not assumed. Only `status: 'clean'` closes the
//      dialog; anything else keeps it open on a report of what is gone and what
//      is still there, because a partial deletion is irreversible and used to be
//      shown as a plain red failure.

interface DeleteProjectDialogProps {
  project: { hash: string; realPath: string };
  onConfirm: () => void;
  onCancel: () => void;
}

// Named, so a session that blocks the delete can be checked against what the
// user actually has open instead of being a bare count.
function sessionLabel(s: ActiveSession): string {
  const id = s.sessionId ? s.sessionId.slice(0, 8) : 'no session id';
  return `pid ${s.pid} · ${id}${s.status && s.status !== 'unknown' ? ` · ${s.status}` : ''}`;
}

/** A project row's own name, or the folder when the registry could not name it. */
function projectLabel(p: PurgePlanProject): string {
  return p.path ?? p.hash;
}

const SECTION_LABEL = 'text-[10px] uppercase tracking-wide text-[var(--cl-ink-4)]';

/**
 * The projects the plan would delete, one row each.
 *
 * This block is the fix for the part that was ours: the plan's project entries
 * all carry the identical detail `project transcripts (.jsonl) and memory/`, so
 * whichever way they are summarised, the summary omits the subject. Here the
 * subject is the row.
 */
function ProjectsBlock({ projects }: { projects: PurgePlanProject[] }) {
  const extra = projects.length - 1;
  return (
    <div className="text-[12px] text-[var(--cl-danger)] border border-[var(--cl-danger)] rounded-lg px-3 py-2 mb-4">
      This plan reaches <span className="font-semibold">{projects.length} projects</span>, not one.{' '}
      <span className="font-mono text-[11px]">claude project purge</span> deletes every project at
      or below the path it is given, and it has no flag to narrow that. Purge{' '}
      {extra === 1 ? 'the one' : `the ${extra}`} underneath individually first.
      <ul className="mt-1.5 font-mono text-[11px] opacity-90">
        {projects.map(p => (
          <li key={p.hash} title={p.target}>
            {projectLabel(p)}
            {p.requested && <span className="opacity-70"> — the one you selected</span>}
            {!p.path && <span className="opacity-70"> — folder name only, cwd unknown</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One plan entry. Grouped entries (the per-session sidecars) show their count;
 * everything else shows its target, which is the only thing identifying it — and
 * for a project folder we show the resolved cwd instead of the hash, since that
 * is the name the user knows the project by.
 */
function PlanRow({ item, projects }: { item: PurgePlanItem; projects: PurgePlanProject[] }) {
  const project = projects.find(p => p.target === item.target);
  const line = item.count > 1 ? `${item.count} entries` : (project?.path ?? item.target);
  return (
    <div
      title={item.targets.join('\n')}
      className="flex items-start gap-2.5 rounded-lg border border-[var(--cl-line)] px-3 py-2"
    >
      <span className="text-[10px] uppercase tracking-wide text-[var(--cl-ink-4)] mt-0.5 shrink-0 w-[42px]">
        {item.kind}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] text-[var(--cl-ink)]">{item.detail}</span>
        <span className="block text-[11px] text-[var(--cl-ink-4)] font-mono truncate">{line}</span>
      </span>
    </div>
  );
}

const REPORT: Record<string, { title: string; body: string }> = {
  partial: {
    title: 'Part of the plan was deleted, part of it is still there',
    body: 'This cannot be undone, and it did not finish. What the CLI printed is below; the paths it left behind are listed with it.',
  },
  unknown: {
    title: 'The purge is still running — the outcome is not known yet',
    body: 'It stopped answering, so ClaudeLens stopped waiting; the CLI was deliberately left alive rather than killed mid-delete. Some of the plan is likely already gone. Reopen this dialog in a moment to see where it got to.',
  },
  failed: {
    title: 'The purge failed, and nothing in the plan appears to be gone',
    body: 'Nothing verifiable was removed — but the filter over history.jsonl cannot be checked from here, so treat this as "probably nothing happened", not as a guarantee.',
  },
  'multiple-projects': {
    title: 'Refused: the plan named more than one project',
    body: 'Nothing was deleted. The plan changed between reading it and confirming, or it always reached further than this project.',
  },
  'unreadable-plan': {
    title: 'Refused: the purge plan could not be read',
    body: 'Nothing was deleted. The CLI declared items ClaudeLens could not parse, so the projects in the plan cannot be counted — and that count is the guard.',
  },
};

/** What actually happened, verified on disk. Shown instead of closing the dialog. */
function PurgeReport({ result }: { result: PurgeResult }) {
  const copy = REPORT[result.refusal ?? result.status];
  const remaining = result.paths.filter(p => p.status === 'remaining');
  const gone = result.paths.filter(p => p.status === 'gone').length;

  return (
    <div className="mb-4">
      <div className="text-[13px] font-semibold text-[var(--cl-danger)] mb-1">{copy?.title}</div>
      <p className="text-[12px] text-[var(--cl-ink-3)] leading-relaxed mb-2">{copy?.body}</p>

      {result.paths.length > 0 && (
        <p className="text-[12px] text-[var(--cl-ink-3)] mb-2">
          {gone} of {result.paths.length} folders in the plan are gone
          {remaining.length > 0 ? `, ${remaining.length} still on disk:` : '.'}
        </p>
      )}

      {remaining.length > 0 && (
        <ul className="font-mono text-[11px] text-[var(--cl-ink-4)] mb-2 max-h-32 overflow-y-auto">
          {remaining.map(p => (
            <li key={p.path} className="truncate" title={p.path}>
              {p.path}
            </li>
          ))}
        </ul>
      )}

      {result.projects.length > 1 && (
        <ul className="font-mono text-[11px] text-[var(--cl-ink-4)] mb-2">
          {result.projects.map(p => (
            <li key={p.hash} className="truncate" title={p.target}>
              {projectLabel(p)}
            </li>
          ))}
        </ul>
      )}

      {(result.error || result.output.trim()) && (
        <pre className="bg-[var(--cl-paper-3)] border border-[var(--cl-line)] rounded-lg p-3 font-mono text-[11px] text-[var(--cl-ink-3)] whitespace-pre-wrap max-h-40 overflow-y-auto">
          {[result.error, result.output.trim()].filter(Boolean).join('\n\n')}
        </pre>
      )}
    </div>
  );
}

export function DeleteProjectDialog({ project, onConfirm, onCancel }: DeleteProjectDialogProps) {
  const purge = usePurgeProject();
  const result: PurgeResult | null = purge.data ?? null;

  // Once the purge succeeds the plan has no subject left: the mutation invalidates
  // every query, and without this the dialog would re-read the dry-run of the
  // project it just deleted in the instant before closing — reporting its outcome
  // over an operation that had actually succeeded. A non-clean result keeps the
  // plan loaded, since the report is about that plan.
  const {
    data: plan,
    isLoading,
    error,
  } = useProjectPurgePlan(result?.status === 'clean' ? null : project.hash);
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
  // a deletion it never showed. It also blocks the button — the project count is
  // the guard, and a plan we cannot parse is a plan we cannot count.
  const unparsed = !!plan && plan.items.length === 0 && (plan.totalItems ?? 0) > 0;
  const nothingToPurge = !!plan && plan.items.length === 0 && !unparsed;
  const projects: PurgePlanProject[] = plan?.projects ?? [];
  const multiProject = projects.length > 1;

  const busy = purge.isPending;
  const purgeError = purge.error instanceof Error ? purge.error.message : null;
  const planError = error instanceof Error ? error.message : error ? String(error) : null;

  const onDelete = async () => {
    try {
      const outcome = await purge.mutateAsync(project.hash);
      // Only a verified clean purge is over. Everything else stays on screen: the
      // user reads what happened and presses the button themselves.
      if (outcome.status === 'clean') onConfirm();
    } catch {
      // the error stays exposed through purge.error: the dialog does not close
    }
  };

  // A run that removed something — or one still going — leaves this project's
  // views reading a state that no longer exists, so closing navigates away as a
  // successful delete would. A refusal or an outright failure changed nothing.
  const closeReport = () => {
    const touched =
      result?.status === 'unknown' || (result?.paths ?? []).some(p => p.status === 'gone');
    if (touched) onConfirm();
    else onCancel();
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

        {result && result.status !== 'clean' && <PurgeReport result={result} />}

        {isLoading && (
          <div className="text-[13px] text-[var(--cl-ink-3)] py-4">Reading the purge plan…</div>
        )}

        {planError && (
          <div className="text-[13px] text-[var(--cl-danger)] py-4">
            Could not read the purge plan: {planError}
          </div>
        )}

        {multiProject && <ProjectsBlock projects={projects} />}

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
            <div className={`${SECTION_LABEL} mb-2`}>
              Will be deleted{plan.totalItems !== null ? ` · ${plan.totalItems} items` : ''}
              {projects.length > 0 &&
                ` · ${projects.length === 1 ? '1 project' : `${projects.length} projects`}`}
            </div>
            <div className="flex flex-col gap-1.5 mb-4">
              {plan.items.map(item => (
                <PlanRow key={`${item.kind}:${item.target}`} item={item} projects={projects} />
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
            <div className={`${SECTION_LABEL} mb-2`}>Purge plan (raw output)</div>
            <p className="text-[12px] text-[var(--cl-ink-3)] mb-2">
              Claude Code declared {plan.totalItems} items in a shape ClaudeLens could not read, so
              the projects in it cannot be counted. Nothing will be deleted from here — run{' '}
              <span className="font-mono text-[11px]">claude project purge</span> in a terminal if
              this is what you want.
            </p>
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
            onClick={result && result.status !== 'clean' ? closeReport : onCancel}
            disabled={busy}
            className="flex-1 px-4 py-2 rounded-lg border border-[var(--cl-line)] hover:bg-[var(--cl-paper-3)] disabled:opacity-50 transition-colors text-[13px] font-medium text-[var(--cl-ink-3)]"
          >
            {result && result.status !== 'clean' ? 'Close' : 'Cancel'}
          </button>
          <button
            onClick={onDelete}
            disabled={
              busy ||
              isLoading ||
              !!planError ||
              isLive ||
              nothingToPurge ||
              multiProject ||
              unparsed ||
              result?.status === 'unknown'
            }
            className="flex-1 px-4 py-2 rounded-lg bg-[var(--cl-danger)] hover:bg-[var(--cl-danger)] disabled:opacity-50 transition-colors text-[13px] font-medium text-white"
          >
            {busy
              ? 'Deleting…'
              : result && result.status !== 'clean'
                ? 'Try again'
                : 'Delete state'}
          </button>
        </div>
      </div>
    </div>
  );
}
