import { useState } from 'react';
import type { InitInfo } from '../../../types';
import { ReadoutRule, ReadoutShell } from '../shared/ReadoutCard';
import { homeRelativePath } from '../shared/projectName';
import { branchLabel, shortCommit, shownBranch, type SessionGitState } from '../chat/git-state';
import { failedMcpGroups } from './mcp-health';
import type { McpFailureGroup } from './mcp-health';

const PERM_LABEL: Record<string, string> = {
  default: 'DEFAULT',
  acceptEdits: 'ACCEPT EDITS',
  plan: 'PLAN MODE',
  bypassPermissions: 'BYPASS',
};

/** `PLUGIN · ACME`, `CONFIGURED · USER` — where to go to fix the group. */
function groupLabel(g: McpFailureGroup): string {
  if (g.plugin !== null) return `PLUGIN · ${g.plugin.toUpperCase()}`;
  if (!g.source) return 'CONFIGURED';
  if (g.source === 'plugin') return 'PLUGIN';
  return `CONFIGURED · ${g.source === 'claudeai' ? 'CLAUDE.AI' : g.source.toUpperCase()}`;
}

/** The failed servers behind the strip's MCP count. It rises from the strip,
 *  which sits at the bottom of the rail, over the feed above it. */
function McpFailureCard({ groups, count }: { groups: McpFailureGroup[]; count: number }) {
  return (
    <ReadoutShell
      title="MCP SERVERS"
      meta={`${count} failed`}
      className="cl-vitals-pop--up"
      style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: 20, right: 20 }}
    >
      <div style={{ marginTop: 9, fontSize: 11.5, lineHeight: 1.45, color: 'var(--cl-ink-3)' }}>
        Failed to connect when this project&apos;s configuration was read.
      </div>
      {groups.map(g => (
        <div key={`${g.plugin ?? ''}|${g.source ?? ''}`} style={{ marginTop: 11 }}>
          <div
            className="font-mono"
            style={{ fontSize: 8.5, letterSpacing: '0.16em', color: 'var(--cl-ink-4)' }}
          >
            {groupLabel(g)}
          </div>
          <div style={{ marginTop: 3, fontSize: 12, lineHeight: 1.45, color: 'var(--cl-ink)' }}>
            {g.servers.join(' · ')}
          </div>
        </div>
      ))}
      <ReadoutRule />
      <div className="font-mono" style={{ marginTop: 8, fontSize: 9.5, color: 'var(--cl-ink-4)' }}>
        /mcp in the terminal lists them and can retry the connection
      </div>
    </ReadoutShell>
  );
}

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
  fontSize: 8.5,
  letterSpacing: '0.16em',
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
              fontSize: 10,
              color: 'var(--cl-ink-3)',
              overflowWrap: 'anywhere',
            }}
          >
            {homeRelativePath(w.path)}
          </div>
          {w.originalBranch && (
            <div
              className="font-mono"
              style={{ marginTop: 2, fontSize: 10, color: 'var(--cl-ink-3)' }}
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
              style={{ marginTop: 3, fontSize: 10, color: 'var(--cl-ink-4)' }}
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
                fontSize: 10,
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
      <div className="font-mono" style={{ marginTop: 8, fontSize: 9.5, color: 'var(--cl-ink-4)' }}>
        the branch the last turn ran on — a checkout made outside the session shows once it writes
        again
      </div>
    </ReadoutShell>
  );
}

/**
 * Read-only session environment from the Agent SDK init handshake — captured by
 * aborting a one-turn query *before* any model turn, so it costs zero tokens
 * (see config-reader.ts). Surfaces what the TUI never shows: the resolved
 * permission mode and how much capability is wired up (tools/skills/agents
 * available, not just what happened to run).
 *
 * It is pinned under the feed rather than dropped into it: none of this is an
 * event — it is the session's standing setup, true for every row above it.
 *
 * MCP is deliberately *not* counted: the globally-configured gateway servers
 * (claude.ai/*) sit pending/needs-auth in every project and never get used, so
 * a total is the same noise everywhere. Only `failed` servers earn a mark, since
 * a connection that broke is the one MCP signal actually worth acting on — and
 * the mark is ONE line's worth: a count on the strip's own row, the servers in
 * the card it raises on hover or focus. They used to be listed under the row by
 * full name, which is three wrapped lines of `plugin:<name>:` for four servers
 * in a rail that has no room for a list.
 *
 * The git branch sits on the same row, read from the transcript (`git`): it is
 * standing setup too, and it does not wait for the handshake — that one is slow
 * and answers nothing for an untrusted folder, while the branch is already on
 * every turn. A remote pane passes no `init` and still gets its branch, read off
 * the host's transcript.
 */
export function EnvironmentStrip({
  init,
  git = null,
}: {
  init: InitInfo | null;
  git?: SessionGitState | null;
}) {
  const [card, setCard] = useState<'mcp' | 'git' | null>(null);
  const branch = shownBranch(git);
  if (!init && !branch) return null;
  const perm = init ? (PERM_LABEL[init.permissionMode] ?? init.permissionMode.toUpperCase()) : '';
  const danger = init?.permissionMode === 'bypassPermissions';
  const mcpGroups = init ? failedMcpGroups(init.mcpServers) : [];
  const failed = mcpGroups.reduce((n, g) => n + g.servers.length, 0);
  const caps = init
    ? [
        { label: 'TOOLS', n: init.tools.length },
        { label: 'SKILLS', n: init.skills.length },
        { label: 'AGENTS', n: init.agents.length },
      ].filter(c => c.n > 0)
    : [];
  const hover = (which: 'mcp' | 'git') => ({
    onMouseEnter: () => setCard(which),
    onMouseLeave: () => setCard(null),
    onFocus: () => setCard(which),
    onBlur: () => setCard(null),
  });
  return (
    <div
      className="shrink-0"
      style={{ position: 'relative', borderTop: '1px solid var(--cl-line)', padding: '10px 20px' }}
    >
      <div className="flex items-center" style={{ gap: 10, whiteSpace: 'nowrap' }}>
        {init && (
          <span
            className="font-mono"
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.12em',
              padding: '3px 8px',
              borderRadius: 999,
              color: danger ? 'var(--cl-on-accent)' : 'var(--cl-ink-2)',
              background: danger ? 'var(--cl-danger)' : 'transparent',
              border: `1px solid ${danger ? 'var(--cl-danger)' : 'var(--cl-line)'}`,
            }}
            title="Resolved permission mode for this session"
          >
            {perm}
          </span>
        )}
        {branch && git && (
          // Shrinks before anything else on the row: a worktree branch runs to
          // thirty characters, and the row has no width to give at the rail's
          // minimum. The whole name is in the card.
          <span
            className="cl-vitals-trigger font-mono inline-flex items-center"
            tabIndex={0}
            aria-label={`Git branch ${branchLabel(branch)}`}
            {...hover('git')}
            style={{
              gap: 5,
              minWidth: 0,
              flex: '0 1 auto',
              fontSize: 9.5,
              letterSpacing: '0.02em',
              color: 'var(--cl-ink-2)',
            }}
          >
            <BranchGlyph />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {branchLabel(branch)}
            </span>
          </span>
        )}
        {failed > 0 && (
          <span
            className="cl-vitals-trigger font-mono inline-flex items-center"
            tabIndex={0}
            aria-label={`${failed} MCP ${failed === 1 ? 'server' : 'servers'} failed to connect`}
            {...hover('mcp')}
            style={{
              gap: 5,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.1em',
              color: 'var(--cl-danger)',
            }}
          >
            <span
              aria-hidden
              style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--cl-danger)' }}
            />
            {failed} MCP
          </span>
        )}
        {/* `margin-left: auto` rather than a spacer: a spacer is one more flex
            gap, and at the rail's minimum width the row has none to give. */}
        <span className="flex items-center" style={{ gap: 10, marginLeft: 'auto' }}>
          {caps.map(c => (
            <span
              key={c.label}
              className="font-mono"
              style={{ fontSize: 9, letterSpacing: '0.1em', color: 'var(--cl-ink-4)' }}
            >
              <b style={{ fontWeight: 700, color: 'var(--cl-ink-2)' }}>{c.n}</b> {c.label}
            </span>
          ))}
        </span>
      </div>
      {card === 'mcp' && failed > 0 && <McpFailureCard groups={mcpGroups} count={failed} />}
      {card === 'git' && git && branch && <GitCard git={git} />}
    </div>
  );
}
