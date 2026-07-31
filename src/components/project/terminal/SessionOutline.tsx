import { CSSProperties, useMemo } from 'react';
import {
  useAllSkills,
  useChatSession,
  usePlugins,
  useSessionSubagents,
} from '../../../hooks/useIPC';
import type { Skill } from '../../../hooks/useIPC';
import type { ChatContentBlock, ChatMessage } from '../../../types';
import {
  buildProcessedMessages,
  correlateSessionAgents,
  correlateSessionSkills,
  skillHasViewableOutput,
  type ProcessedMessage,
  type SessionAgent,
  type SessionSkill,
  type ToolGroup,
} from '../chat/utils';

/**
 * The v2 "Outline + Focus" navigator — the left column of the unified
 * Terminal/Lens view (design: "Chat — 3 nuove varianti", 02 · Outline + Focus).
 *
 * Not the flat 119-turn list (that's the Lens's own edge minimap) but the
 * session's *meaningful* units in chronological order: user prompts, agentic
 * skills, sub-agent dispatches and per-file edit runs, with the latest Claude
 * turn pinned as "◂ qui". Clicking a row navigates: a skill/agent/edit opens its
 * artifact (the same overlays the Mission Control rail opens), a prompt/Claude
 * row scrolls the Lens transcript to that turn (`onJump`, a no-op in Terminal
 * mode where no transcript is mounted).
 *
 * Derives from the same watcher-refreshed data the rail uses (React Query dedupes
 * the shared queries), so the outline is live without any dedicated IPC.
 */

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

type OutlineRow =
  | { kind: 'prompt'; turnN: number; title: string }
  | { kind: 'claude'; turnN: number; title: string; current: boolean }
  | { kind: 'skill'; turnN: number; skill: SessionSkill }
  | { kind: 'agent'; turnN: number; agent: SessionAgent }
  | { kind: 'edit'; turnN: number; name: string; count: number; added: number; removed: number }
  | { kind: 'notification'; turnN: number; summary: string; status: string };

/** First non-empty text line of a message — the outline row's title. */
function firstLine(m: ChatMessage): string {
  const t = m.content.find(b => b.type === 'text') as
    Extract<ChatContentBlock, { type: 'text' }> | undefined;
  const line = (t?.text ?? '')
    .split('\n')
    .map(s => s.trim())
    .find(Boolean);
  return line ?? '';
}

function lines(s: unknown): number {
  return typeof s === 'string' && s.length > 0 ? s.split('\n').length : 0;
}

/** +added/−removed for an edit tool, from its input alone (mirrors MissionRail). */
function editStats(g: ToolGroup): { added: number; removed: number } {
  const input = g.use.input as Record<string, unknown>;
  if (g.use.name === 'Write') return { added: lines(input.content), removed: 0 };
  if (g.use.name === 'Edit')
    return { added: lines(input.new_string), removed: lines(input.old_string) };
  if (g.use.name === 'MultiEdit' && Array.isArray(input.edits)) {
    let added = 0;
    let removed = 0;
    for (const e of input.edits as Array<Record<string, unknown>>) {
      added += lines(e.new_string);
      removed += lines(e.old_string);
    }
    return { added, removed };
  }
  return { added: 0, removed: 0 };
}

/** The per-file edit run carrying the turn it was last touched on. */
type EditRow = { name: string; turnN: number; count: number; added: number; removed: number };

/** Aggregate file mutations per path, keeping the latest turn each was touched. */
function buildEditRows(processed: ProcessedMessage[]): EditRow[] {
  const byPath = new Map<string, EditRow>();
  processed.forEach((p, idx) => {
    for (const g of p.toolGroups) {
      if (!EDIT_TOOLS.has(g.use.name)) continue;
      const input = g.use.input as Record<string, unknown>;
      const path = (input.file_path || input.notebook_path) as string | undefined;
      if (!path) continue;
      const name = path.split(/[\\/]/).pop() || path;
      const stats = editStats(g);
      const row = byPath.get(path);
      if (row) {
        row.count += 1;
        row.added += stats.added;
        row.removed += stats.removed;
        row.turnN = idx + 1;
      } else {
        byPath.set(path, {
          name,
          turnN: idx + 1,
          count: 1,
          added: stats.added,
          removed: stats.removed,
        });
      }
    }
  });
  return [...byPath.values()];
}

/** Build the chronological outline of meaningful units. */
function buildOutline(
  processed: ProcessedMessage[],
  agents: SessionAgent[],
  skills: SessionSkill[]
): OutlineRow[] {
  const rows: OutlineRow[] = [];

  // User prompts (real turns; command cards are surfaced as skills; notifications separately).
  processed.forEach((p, idx) => {
    if (p.notification) {
      rows.push({
        kind: 'notification',
        turnN: idx + 1,
        summary: p.notification.summary,
        status: p.notification.status,
      });
      return;
    }
    if (p.msg.role !== 'user' || p.command) return;
    const title = firstLine(p.msg);
    if (!title) return;
    rows.push({ kind: 'prompt', turnN: idx + 1, title });
  });

  for (const s of skills) rows.push({ kind: 'skill', turnN: s.turnN, skill: s });
  for (const a of agents) rows.push({ kind: 'agent', turnN: a.turnN, agent: a });
  for (const e of buildEditRows(processed))
    rows.push({
      kind: 'edit',
      turnN: e.turnN,
      name: e.name,
      count: e.count,
      added: e.added,
      removed: e.removed,
    });

  // The latest real Claude turn (skipping synthetic slash-command notes) is
  // pinned as the current position — the "◂ qui" marker in the design.
  let lastTurn = -1;
  processed.forEach((p, idx) => {
    if (p.msg.role === 'assistant' && p.msg.model !== '<synthetic>') lastTurn = idx;
  });
  if (lastTurn >= 0) {
    const title = firstLine(processed[lastTurn].msg) || 'Risposta di Claude';
    rows.push({ kind: 'claude', turnN: lastTurn + 1, title, current: true });
  }

  return rows.sort((a, b) => a.turnN - b.turnN);
}

/* ── presentational atoms ─────────────────────────────────────────────── */

const rowBase: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '20px 1fr',
  gap: 9,
  padding: '7px 9px',
  borderRadius: 7,
  alignItems: 'start',
  width: '100%',
  textAlign: 'left',
  background: 'none',
  border: 0,
  cursor: 'pointer',
};

const titleStyle: CSSProperties = {
  display: 'block',
  font: '500 12px/1.3 var(--font-sans)',
  color: 'var(--cl-ink)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const metaStyle = (color: string): CSSProperties => ({
  fontFamily: 'var(--font-mono)',
  fontSize: 8.5,
  color,
});

function PromptGlyph() {
  return (
    <span
      aria-hidden
      style={{
        width: 14,
        height: 14,
        borderRadius: '50%',
        background: 'var(--cl-ink)',
        marginTop: 1,
      }}
    />
  );
}

function SquareGlyph({ bg, children }: { bg: string; children: string }) {
  return (
    <span
      aria-hidden
      className="font-mono inline-flex items-center justify-center"
      style={{
        width: 16,
        height: 16,
        borderRadius: 4,
        background: bg,
        color: '#fff',
        font: '700 9px/1 var(--font-mono)',
        marginTop: 1,
      }}
    >
      {children}
    </span>
  );
}

function DiamondGlyph() {
  return (
    <span
      aria-hidden
      style={{
        width: 11,
        height: 11,
        background: 'var(--cl-cyan)',
        transform: 'rotate(45deg)',
        margin: '2px 0 0 2px',
      }}
    />
  );
}

function NotifGlyph({ status }: { status: string }) {
  const color =
    status === 'completed'
      ? 'var(--cl-ok)'
      : status === 'failed' || status === 'error'
        ? 'var(--cl-danger)'
        : 'var(--cl-ink-3)';
  return (
    <span
      aria-hidden
      style={{
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: color,
        margin: '3px 0 0 3px',
        display: 'block',
        flexShrink: 0,
      }}
    />
  );
}

/* ── the outline ──────────────────────────────────────────────────────── */

export function SessionOutline({
  hash,
  sessionId,
  realPath,
  width,
  onJump,
  onOpenTool,
  onOpenAgent,
  onOpenSkillDef,
}: {
  hash: string;
  /** Null until the CLI registers the session in `~/.claude/sessions/`. */
  sessionId: string | null;
  realPath: string;
  width: number;
  /** Scroll the embedded Lens transcript to a 1-based turn (no-op in Terminal). */
  onJump: (turnN: number) => void;
  onOpenTool: (group: ToolGroup) => void;
  onOpenAgent: (agent: SessionAgent) => void;
  onOpenSkillDef: (skill: Skill) => void;
}) {
  const filename = sessionId ? `${sessionId}.jsonl` : null;
  const { data: messages } = useChatSession(hash, filename);
  const { data: subagentMetas } = useSessionSubagents(hash, filename);
  const { data: allSkills } = useAllSkills(realPath);
  const { data: plugins } = usePlugins();

  const processed = useMemo(() => (messages ? buildProcessedMessages(messages) : []), [messages]);
  const agents = useMemo(
    () => correlateSessionAgents(processed, subagentMetas ?? []),
    [processed, subagentMetas]
  );
  const skills = useMemo(
    () => correlateSessionSkills(processed, allSkills ?? [], plugins ?? []),
    [processed, allSkills, plugins]
  );
  const outline = useMemo(
    () => buildOutline(processed, agents, skills),
    [processed, agents, skills]
  );

  // Real Claude turns (the footer count, matching the Lens header / rail).
  const turns = useMemo(
    () => messages?.filter(m => m.role === 'assistant' && m.model !== '<synthetic>').length ?? 0,
    [messages]
  );

  // A skill row routes like the rail's SkillPill: produced output > definition >
  // bare launch tool call. Falls back to a Lens jump when nothing resolves.
  const onSkillClick = (s: SessionSkill) => {
    if (skillHasViewableOutput(s.group)) onOpenTool(s.group!);
    else if (s.skill) onOpenSkillDef(s.skill);
    else if (s.group) onOpenTool(s.group);
    else onJump(s.turnN);
  };

  const wrap: CSSProperties = {
    width,
    flexShrink: 0,
    borderRight: '1px solid var(--cl-line)',
    background: 'var(--cl-paper-2)',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  };

  return (
    <aside style={wrap}>
      <div
        className="shrink-0 flex items-center gap-2"
        style={{ padding: '14px 16px 11px', borderBottom: '1px solid var(--cl-line)' }}
      >
        <span
          className="font-mono"
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: '0.2em',
            color: 'var(--cl-ink-2)',
          }}
        >
          OUTLINE
        </span>
        {turns > 0 && (
          <span className="font-mono" style={{ fontSize: 9, color: 'var(--cl-ink-4)' }}>
            {turns} turns
          </span>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 8px 16px' }}>
        {!sessionId && (
          <p className="cl-transcript-state" style={{ padding: '8px 9px' }}>
            Waiting for the CLI session…
          </p>
        )}
        {sessionId && outline.length === 0 && (
          <p className="cl-transcript-state" style={{ padding: '8px 9px' }}>
            Prompts, skills and agents will be indexed here.
          </p>
        )}

        {outline.map((r, i) => {
          if (r.kind === 'prompt') {
            return (
              <button
                key={`p${i}`}
                type="button"
                className="cl-otrow"
                style={rowBase}
                onClick={() => onJump(r.turnN)}
              >
                <PromptGlyph />
                <span className="min-w-0">
                  <span style={titleStyle}>{r.title}</span>
                  <span style={metaStyle('var(--cl-ink-4)')}>PROMPT · t{r.turnN}</span>
                </span>
              </button>
            );
          }
          if (r.kind === 'skill') {
            const route = skillHasViewableOutput(r.skill.group)
              ? 'output'
              : r.skill.skill
                ? 'def'
                : 'launch';
            return (
              <button
                key={`s${i}`}
                type="button"
                className="cl-otrow"
                style={rowBase}
                onClick={() => onSkillClick(r.skill)}
              >
                <SquareGlyph bg="var(--cl-accent)">✦</SquareGlyph>
                <span className="min-w-0">
                  <span style={titleStyle}>{r.skill.name}</span>
                  <span style={metaStyle('var(--cl-accent-ink)')}>SKILL · {route}</span>
                </span>
              </button>
            );
          }
          if (r.kind === 'agent') {
            return (
              <button
                key={`a${i}`}
                type="button"
                className="cl-otrow"
                style={rowBase}
                onClick={() => onOpenAgent(r.agent)}
              >
                <SquareGlyph bg="var(--cl-violet)">A</SquareGlyph>
                <span className="min-w-0">
                  <span style={titleStyle}>{r.agent.subagentType}</span>
                  <span style={metaStyle('var(--cl-violet-ink)')}>
                    AGENT{r.agent.messageCount != null ? ` · ${r.agent.messageCount} msgs` : ''}
                  </span>
                </span>
              </button>
            );
          }
          if (r.kind === 'edit') {
            return (
              <button
                key={`e${i}`}
                type="button"
                className="cl-otrow"
                style={rowBase}
                onClick={() => onJump(r.turnN)}
              >
                <DiamondGlyph />
                <span className="min-w-0">
                  <span style={{ ...titleStyle, color: 'var(--cl-ink-2)' }}>{r.name}</span>
                  <span style={metaStyle('var(--cl-ink-4)')}>
                    EDIT ×{r.count} · <span style={{ color: 'var(--cl-ok)' }}>+{r.added}</span>{' '}
                    <span style={{ color: 'var(--cl-danger)' }}>−{r.removed}</span>
                  </span>
                </span>
              </button>
            );
          }
          if (r.kind === 'notification') {
            const metaColor =
              r.status === 'completed'
                ? 'var(--cl-ok)'
                : r.status === 'failed' || r.status === 'error'
                  ? 'var(--cl-danger)'
                  : 'var(--cl-ink-4)';
            return (
              <button
                key={`n${i}`}
                type="button"
                className="cl-otrow"
                style={rowBase}
                onClick={() => onJump(r.turnN)}
              >
                <NotifGlyph status={r.status} />
                <span className="min-w-0">
                  <span style={{ ...titleStyle, color: 'var(--cl-ink-2)' }}>{r.summary}</span>
                  <span style={metaStyle(metaColor)}>NOTIFY · t{r.turnN}</span>
                </span>
              </button>
            );
          }
          // current Claude turn — boxed "◂ qui"
          return (
            <button
              key={`c${i}`}
              type="button"
              className="cl-otrow"
              style={{
                ...rowBase,
                padding: '8px 9px',
                background: 'var(--cl-paper)',
                boxShadow:
                  'inset 0 0 0 1px color-mix(in oklch, var(--cl-accent) 30%, var(--cl-line))',
              }}
              onClick={() => onJump(r.turnN)}
            >
              <SquareGlyph bg="var(--cl-accent)">C</SquareGlyph>
              <span className="min-w-0">
                <span style={{ ...titleStyle, fontWeight: 600 }}>{r.title}</span>
                <span style={metaStyle('var(--cl-accent-ink)')}>CLAUDE · t{r.turnN} ◂ qui</span>
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
