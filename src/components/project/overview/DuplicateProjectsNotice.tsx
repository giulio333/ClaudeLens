import {
  useDuplicateProjects,
  type DuplicateFolder,
  type DuplicateGroup,
} from '../../../hooks/useIPC';
import { View } from '../types';
import { TopBar } from '../shared/TopBar';
import { Lens } from './Lens';
import { homeRelativePath, sharedPathPrefix } from '../shared/projectName';

function lastActive(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  // with the year: a duplicate folder's last activity is often months old
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * One folder of a group: only the part of its path the group does not share —
 * the shared head is printed once, beside the project name — then the
 * sessions it holds, and its memory when it has any. The full path and the
 * last activity are the tooltip.
 */
function FolderLine({
  folder,
  primary,
  sharedPrefix,
}: {
  folder: DuplicateFolder;
  primary: boolean;
  sharedPrefix: string;
}) {
  const tail =
    sharedPrefix && folder.realPath.startsWith(sharedPrefix)
      ? folder.realPath.slice(sharedPrefix.length)
      : homeRelativePath(folder.realPath);
  const sessions = `${folder.sessionCount} ${folder.sessionCount === 1 ? 'session' : 'sessions'}`;

  return (
    <li className="cl-dup-folder">
      <span
        className="path"
        title={`${folder.realPath}\nlast activity: ${lastActive(folder.lastActivity)}`}
      >
        {tail}
      </span>
      {primary && <span className="note is-primary">primary</span>}
      {!folder.realPathAuthoritative && (
        <span
          className="note"
          title="No transcript in this folder records its working directory: the path is rebuilt from the folder name"
        >
          estimated
        </span>
      )}
      <span className="figs">
        {sessions}
        {folder.memoryTopicCount > 0 && ` · ${folder.memoryTopicCount} memory`}
      </span>
    </li>
  );
}

function DuplicateGroupList({ group }: { group: DuplicateGroup }) {
  const sharedPrefix = sharedPathPrefix(group.folders.map(f => f.realPath));
  return (
    <div className="cl-dup-group">
      <div className="cl-dup-head">
        <h2 className="cl-dup-name">{group.name}</h2>
        {sharedPrefix && <span className="cl-dup-prefix">{homeRelativePath(sharedPrefix)}</span>}
      </div>
      <ul className="cl-dup-folders">
        {group.folders.map((folder, i) => (
          <FolderLine
            key={folder.hash}
            folder={folder}
            primary={i === 0}
            sharedPrefix={sharedPrefix}
          />
        ))}
      </ul>
    </div>
  );
}

/**
 * Compact signal shown in the global home: a notification pill — count badge
 * and one line — sized to its content instead of the full-width filled band it
 * used to be. The pill *is* the button, so it carries no separate action word. It is the only entry point to `DuplicateProjectsView`, so
 * it stays mounted; it renders nothing when there are no duplicates.
 */
export function DuplicateProjectsBadge({ onNavigate }: { onNavigate: (v: View) => void }) {
  const { data: groups = [] } = useDuplicateProjects();
  if (groups.length === 0) return null;

  return (
    <button
      type="button"
      className="cl-ghome-dup"
      onClick={() => onNavigate({ type: 'duplicates' })}
    >
      <span className="count">{groups.length}</span>
      <span className="txt">possible duplicate {groups.length === 1 ? 'project' : 'projects'}</span>
    </button>
  );
}

/**
 * Dedicated view: the intercepted duplicates, one section per project, in the
 * catalogue pages' chrome (TopBar, hero with a meta line), then each project
 * as its name and the path head its folders share, over the part of each
 * folder's path that differs — no table, no tags. Read-only on purpose — it used to merge a duplicate into the
 * primary, and that moved and rewrote transcripts inside `~/.claude/projects`
 * on a match that is only a guess (same basename). Consolidating stays a
 * manual job.
 */
export function DuplicateProjectsView({ onBack }: { onBack: () => void }) {
  const { data: groups = [], isLoading, error } = useDuplicateProjects();

  const folderCount = groups.reduce((s, g) => s + g.folders.length, 0);
  // what the non-primary folders hold, i.e. the history the primary does not show
  const dupFolders = groups.flatMap(g => g.folders.slice(1));
  const sessionsHeld = dupFolders.reduce((s, f) => s + f.sessionCount, 0);
  const memoryHeld = dupFolders.reduce((s, f) => s + f.memoryTopicCount, 0);

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>
      <TopBar onBack={onBack} crumbs={[{ label: 'Global · Duplicates' }]} />

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
          <p className="cl-dup-lede">
            Claude Code files a project&rsquo;s history under its absolute path, so the same project
            opened from two folders ends up with two histories. The primary is the folder with the
            most recent activity. ClaudeLens only points them out: it never moves, merges or deletes
            a folder.
          </p>
          {!isLoading && groups.length > 0 && (
            <div className="cl-h-meta">
              <span>
                <b>{groups.length}</b> {groups.length === 1 ? 'project' : 'projects'} in{' '}
                <b>{folderCount}</b> folders
              </span>
              <span className="sep">·</span>
              <span>
                <b>{sessionsHeld}</b> {sessionsHeld === 1 ? 'session' : 'sessions'} ·{' '}
                <b>{memoryHeld}</b> memory {memoryHeld === 1 ? 'topic' : 'topics'} outside the
                primary
              </span>
            </div>
          )}
        </section>

        {isLoading ? (
          <section className="cl-section">
            <p style={{ color: 'var(--cl-ink-3)', fontSize: 13 }}>Loading…</p>
          </section>
        ) : error ? (
          <section className="cl-section">
            <div className="cl-empty">
              Could not scan ~/.claude/projects:{' '}
              {error instanceof Error ? error.message : String(error)}
            </div>
          </section>
        ) : groups.length === 0 ? (
          <section className="cl-section">
            <div className="cl-empty">No duplicates detected.</div>
          </section>
        ) : (
          <section className="cl-section">
            {groups.map(group => (
              <DuplicateGroupList key={group.key} group={group} />
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
