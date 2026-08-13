import { useState } from 'react';
import {
  useDuplicateProjects,
  useExecuteMerge,
  planMerge,
  type DuplicateFolder,
  type MergePlan,
  type MergeResult,
} from '../../../hooks/useIPC';
import { View } from '../types';
import { TopBar } from '../shared/TopBar';
import { Lens } from './Lens';
import { MergeConfirmDialog } from '../shared/MergeConfirmDialog';
import { projectDisplayName, sharedPathPrefix } from '../shared/projectName';

function shortWhen(iso: string | null): string {
  if (!iso) return 'no sessions';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', { day: '2-digit', month: 'short', year: '2-digit' });
}

/**
 * One candidate folder, as a panel of the group's comparison. Both sides carry
 * the same three figures in the same slots so sessions/memory/last activity can
 * be compared by eye — that comparison *is* the decision on this page.
 */
function FolderPanel({
  folder,
  primary,
  sharedPrefix,
  onMerge,
}: {
  folder: DuplicateFolder;
  primary: boolean;
  sharedPrefix: string;
  onMerge?: () => void;
}) {
  const tail = folder.realPath.startsWith(sharedPrefix)
    ? folder.realPath.slice(sharedPrefix.length)
    : folder.realPath;

  return (
    <div className={`cl-dup-panel${primary ? ' is-primary' : ''}`}>
      <div className="cl-dup-role">
        <span className="tag">{primary ? '● primary' : '○ duplicate'}</span>
        <span className="fate">{primary ? 'kept' : 'can be merged'}</span>
      </div>

      <div className="cl-dup-path" title={folder.realPath}>
        {sharedPrefix && <span className="dir">{sharedPrefix}</span>}
        {tail}
      </div>

      {!folder.realPathAuthoritative && <div className="cl-dup-est">· estimated path</div>}

      <div className="cl-dup-tape">
        <div className="cell">
          <div className="k">Sessions</div>
          <div className="v">{folder.sessionCount}</div>
        </div>
        <div className="cell">
          <div className="k">Memory</div>
          <div className="v">
            {folder.memoryTopicCount}
            {folder.hasMemoryIndex && <small>+index</small>}
          </div>
        </div>
        <div className="cell">
          <div className="k">Last</div>
          <div className="v date">{shortWhen(folder.lastActivity)}</div>
        </div>
      </div>

      {onMerge && (
        <div className="cl-dup-act">
          <button type="button" onClick={onMerge}>
            Merge into primary
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Compact signal shown in the global home: a clickable row that opens the
 * dedicated view. Renders nothing when there are no duplicates.
 */
export function DuplicateProjectsBadge({ onNavigate }: { onNavigate: (v: View) => void }) {
  const { data: groups = [] } = useDuplicateProjects();
  if (groups.length === 0) return null;

  return (
    <button
      type="button"
      onClick={() => onNavigate({ type: 'duplicates' })}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '8px 14px',
        margin: '0 0 18px',
        borderRadius: 8,
        border: '1px solid var(--cl-line)',
        background: 'var(--cl-warn-soft)',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <span style={{ color: 'var(--cl-warn)', fontSize: 13 }}>⚠</span>
      <span style={{ fontSize: 13, color: 'var(--cl-ink)', flex: 1 }}>
        {groups.length} possible duplicate {groups.length === 1 ? 'project' : 'projects'} detected
      </span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--cl-ink)',
          opacity: 0.55,
        }}
      >
        details →
      </span>
    </button>
  );
}

/** Dedicated view: short explanation + the intercepted duplicates. */
export function DuplicateProjectsView({ onBack }: { onBack: () => void }) {
  const { data: groups = [] } = useDuplicateProjects();
  const executeMerge = useExecuteMerge();
  const [dialog, setDialog] = useState<{
    plan: MergePlan;
    source: DuplicateFolder;
    dest: DuplicateFolder;
    sourceName: string;
    destName: string;
  } | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [result, setResult] = useState<MergeResult | null>(null);

  function name(realPath: string): string {
    return projectDisplayName(realPath);
  }

  async function openMerge(source: DuplicateFolder, dest: DuplicateFolder) {
    setPlanError(null);
    try {
      const plan = await planMerge(source.hash, dest.hash);
      setDialog({
        plan,
        source,
        dest,
        sourceName: name(source.realPath),
        destName: name(dest.realPath),
      });
    } catch (e) {
      setPlanError(e instanceof Error ? e.message : String(e));
    }
  }

  async function confirmMerge() {
    if (!dialog) return;
    try {
      const res = await executeMerge.mutateAsync({
        sourceHash: dialog.source.hash,
        destHash: dialog.dest.hash,
      });
      setDialog(null);
      setResult(res);
    } catch (e) {
      setPlanError(e instanceof Error ? e.message : String(e));
      setDialog(null);
    }
  }

  const folderCount = groups.reduce((s, g) => s + g.folders.length, 0);
  // what a full clean-up would move: everything held by the non-primary folders
  const dupFolders = groups.flatMap(g => g.folders.slice(1));
  const sessionsToMove = dupFolders.reduce((s, f) => s + f.sessionCount, 0);
  const memoryToMove = dupFolders.reduce((s, f) => s + f.memoryTopicCount, 0);

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>
      <TopBar onBack={onBack} backLabel="Global" crumbs={[{ label: 'Duplicates', accent: true }]} />

      <div className="flex-1 overflow-y-auto">
        <section className="cl-hero">
          <Lens />
          <div className="cl-eyebrow">
            <span className="pip" />
            <span>Global · ~/.claude/projects</span>
          </div>
          <h1 className="cl-h-name static">
            <span className="label-name">Duplicates</span>
            <span className="glyph">.</span>
          </h1>

          <div className="cl-hband">
            <div className="cl-hcell">
              <div className="lbl">Projects</div>
              <div className="num">{groups.length}</div>
              <div className="sub">in multiple paths</div>
            </div>
            <div className="cl-hcell">
              <div className="lbl">Folders</div>
              <div className="num">{folderCount}</div>
              <div className="sub">
                {groups.length} primary · {dupFolders.length} duplicate
              </div>
            </div>
            <div className="cl-hcell">
              <div className="lbl">Sessions to move</div>
              <div className="num">{sessionsToMove}</div>
              <div className="sub">held by duplicate folders</div>
            </div>
            <div className="cl-hcell">
              <div className="lbl">Memory to merge</div>
              <div className="num">{memoryToMove}</div>
              <div className="sub">topics in duplicate folders</div>
            </div>
          </div>

          <details className="set-disc">
            <summary>Why does this happen?</summary>
            <div
              style={{
                fontSize: 13,
                lineHeight: 1.55,
                color: 'var(--cl-ink-2)',
                marginTop: 10,
                maxWidth: 760,
              }}
            >
              Claude Code identifies projects by <b>absolute path</b>: the same project opened from
              different folders (e.g. moved from Desktop to Projects) produces separate histories.
              The old folder often keeps only its{' '}
              <code style={{ fontFamily: 'var(--font-mono)' }}>memory/</code>, because sessions get
              removed by Claude Code's retention. ClaudeLens <b>flags them</b> — nothing is moved
              until you choose to merge a folder into the primary one.
            </div>
          </details>
        </section>

        <section className="cl-section">
          {planError && (
            <div
              style={{
                fontSize: 12,
                color: 'var(--cl-danger)',
                margin: '0 0 18px',
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid var(--cl-danger)',
                background: 'var(--cl-danger-soft)',
                maxWidth: 720,
              }}
            >
              Failed to compute merge plan: {planError}
            </div>
          )}

          {groups.length === 0 ? (
            <div className="cl-empty">No duplicates detected.</div>
          ) : (
            groups.map(group => {
              const [primary, ...dups] = group.folders;
              const sharedPrefix = sharedPathPrefix(group.folders.map(f => f.realPath));
              return (
                <div key={group.key} className="cl-dup-group">
                  <div className="cl-dup-head">
                    <span className="nm">{group.name}</span>
                    <span className="ct">{group.folders.length} folders</span>
                  </div>
                  <div className="cl-dup-compare">
                    <FolderPanel folder={primary} primary sharedPrefix={sharedPrefix} />
                    <div className="cl-dup-gutter" aria-hidden="true">
                      <span className="arrow">←</span>
                    </div>
                    <div className="cl-dup-stack">
                      {dups.map(folder => (
                        <FolderPanel
                          key={folder.hash}
                          folder={folder}
                          primary={false}
                          sharedPrefix={sharedPrefix}
                          onMerge={() => openMerge(folder, primary)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </section>
      </div>

      {dialog && (
        <MergeConfirmDialog
          plan={dialog.plan}
          sourceName={dialog.sourceName}
          destName={dialog.destName}
          isLoading={executeMerge.isPending}
          canExecute={true}
          onConfirm={confirmMerge}
          onCancel={() => setDialog(null)}
        />
      )}

      {result && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--cl-paper-2)] rounded-lg shadow-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-[15px] font-semibold text-[var(--cl-ink)] mb-3">Merge complete</h3>
            <ul className="text-[13px] text-[var(--cl-ink-3)] space-y-1 mb-4">
              <li>
                {result.movedSessions} sessions moved
                {result.renamedSessions > 0 ? ` (${result.renamedSessions} renamed)` : ''}
              </li>
              <li>{result.movedSidecars} session data folders moved</li>
              <li>{result.cwdRewrittenFiles} sessions had their cwd rewritten</li>
              <li>
                {result.memoryCopied} memory copied · {result.memoryRenamed} renamed ·{' '}
                {result.memorySkipped} identical
              </li>
              <li>{result.sourceDeleted ? 'Source folder deleted' : 'Source folder kept'}</li>
            </ul>
            <div className="bg-[var(--cl-paper-3)] border border-[var(--cl-line)] rounded-lg p-3 mb-4 font-mono text-[11px] text-[var(--cl-ink-3)] break-all">
              backup: {result.backupPath}
            </div>
            {result.warnings.length > 0 && (
              <ul className="text-[12px] text-[var(--cl-warn)] list-disc pl-4 space-y-1 mb-4">
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            <button
              onClick={() => setResult(null)}
              className="w-full px-4 py-2 rounded-lg bg-[var(--cl-accent)] text-[var(--cl-on-accent)] text-[13px] font-medium"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
