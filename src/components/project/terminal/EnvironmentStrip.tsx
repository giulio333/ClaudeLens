import { useState } from 'react';
import { ReadoutRule, ReadoutShell } from '../shared/ReadoutCard';
import { homeRelativePath } from '../shared/projectName';
import { branchLabel, shortCommit, shownBranch, type SessionGitState } from '../chat/git-state';

/** A branch: two commits on one line and a third forking off it. */
function BranchGlyph() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      style={{ flex: 'none' }}
    >
      <circle cx="4.5" cy="3.5" r="1.8" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="4.5" cy="12.5" r="1.8" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="11.5" cy="5.5" r="1.8" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M4.5 5.3v5.4M11.5 7.3c0 2.4-2.2 3-5.2 3.9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Older runs past this collapse into a count: the card is a readout, not a log. */
const RUNS_SHOWN = 6;

const SECTION_LABEL = {
  marginTop: 11,
  fontSize: 9.5,
  letterSpacing: '0.1em',
  color: 'var(--cl-ink-4)',
} as const;

function clock(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** What the transcript says about git, raised from the branch chip. */
function GitCard({ git }: { git: SessionGitState }) {
  const branch = shownBranch(git);
  const runs = git.runs.slice(-RUNS_SHOWN);
  const earlier = git.runs.length - runs.length;
  const w = git.worktree;
  return (
    <ReadoutShell
      title="GIT"
      meta="from the transcript"
      className="cl-vitals-pop--up"
      style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: 20, right: 20 }}
    >
      {branch && (
        <div
          className="font-mono"
          style={{ marginTop: 9, fontSize: 12, color: 'var(--cl-ink)', overflowWrap: 'anywhere' }}
        >
          {branchLabel(branch)}
        </div>
      )}
      {w && (
        <>
          <div className="font-mono" style={SECTION_LABEL}>
            WORKTREE
          </div>
          <div style={{ marginTop: 3, fontSize: 12, color: 'var(--cl-ink)' }}>{w.name}</div>
          <div
            className="font-mono"
            style={{
              marginTop: 2,
              fontSize: 10.5,
              color: 'var(--cl-ink-3)',
              overflowWrap: 'anywhere',
            }}
          >
            {homeRelativePath(w.path)}
          </div>
          {w.originalBranch && (
            <div
              className="font-mono"
              style={{ marginTop: 2, fontSize: 10.5, color: 'var(--cl-ink-3)' }}
            >
              cut from {branchLabel(w.originalBranch)}
              {w.originalHeadCommit && ` @ ${shortCommit(w.originalHeadCommit)}`}
            </div>
          )}
        </>
      )}
      {git.runs.length > 1 && (
        <>
          <div className="font-mono" style={SECTION_LABEL}>
            BRANCHES THIS SESSION
          </div>
          {earlier > 0 && (
            <div
              className="font-mono"
              style={{ marginTop: 3, fontSize: 10.5, color: 'var(--cl-ink-4)' }}
            >
              +{earlier} earlier
            </div>
          )}
          {runs.map((r, i) => (
            <div
              key={r.uuid}
              className="font-mono flex"
              style={{
                marginTop: 3,
                gap: 8,
                fontSize: 10.5,
                color: i === runs.length - 1 ? 'var(--cl-ink)' : 'var(--cl-ink-3)',
              }}
            >
              <span style={{ color: 'var(--cl-ink-4)' }}>{clock(r.timestamp)}</span>
              <span style={{ overflowWrap: 'anywhere' }}>{branchLabel(r.branch)}</span>
            </div>
          ))}
        </>
      )}
      <ReadoutRule />
      <div className="font-mono" style={{ marginTop: 8, fontSize: 10, color: 'var(--cl-ink-4)' }}>
        the branch the last turn ran on — a checkout made outside the session shows once it writes
        again
      </div>
    </ReadoutShell>
  );
}

/**
 * The git branch the session runs on, pinned under the feed: standing setup,
 * true for every row above it, so not an event in it. Read from the
 * transcript, so it does not wait for the SDK handshake, and a remote pane
 * gets its branch off the host's own transcript.
 *
 * The strip used to carry the permission mode, the failed MCP servers and
 * bare counts of tools, skills and agents too — four kinds of fact on one line.
 * The mode came from the project's settings, not the running session, so it
 * went stale on the first shift+tab; the rest is a list, and lives in the
 * rail's TOOLKIT panel (`ToolkitRailPanel`).
 */
export function EnvironmentStrip({ git }: { git: SessionGitState | null }) {
  const [card, setCard] = useState(false);
  const branch = shownBranch(git);
  if (!git || !branch) return null;
  return (
    <div
      className="shrink-0"
      style={{ position: 'relative', borderTop: '1px solid var(--cl-line)', padding: '10px 20px' }}
    >
      <div className="flex items-center" style={{ whiteSpace: 'nowrap' }}>
        {/* A worktree branch runs to thirty characters: it truncates at the
            rail's minimum width, and the whole name is in the card. */}
        <span
          className="cl-vitals-trigger font-mono inline-flex items-center"
          tabIndex={0}
          aria-label={`Git branch ${branchLabel(branch)}`}
          onMouseEnter={() => setCard(true)}
          onMouseLeave={() => setCard(false)}
          onFocus={() => setCard(true)}
          onBlur={() => setCard(false)}
          style={{
            gap: 5,
            minWidth: 0,
            fontSize: 10,
            letterSpacing: '0.02em',
            color: 'var(--cl-ink-2)',
          }}
        >
          <BranchGlyph />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {branchLabel(branch)}
          </span>
        </span>
      </div>
      {card && <GitCard git={git} />}
    </div>
  );
}
