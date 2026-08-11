import { CSSProperties, ReactNode, useCallback, useMemo, useState } from 'react';
import {
  useActiveSessions,
  useAllSkills,
  useChatSession,
  useEffectiveConfig,
  useGlobalAgents,
  useMemoryProject,
  useProjectAgents,
  useProjectTasks,
  useProjectTeams,
  usePlugins,
  useSessionList,
  useSessionSubagents,
} from '../../../hooks/useIPC';
import type { Agent, MemoryTopic, Skill } from '../../../hooks/useIPC';
import type { ActiveSession, InitInfo, TeamSummary } from '../../../types';
import { fmtRelative, liveLeadSession, memberColor, minutesSince, teamLabel } from '../teams/utils';
import {
  buildMemoryActivity,
  buildProcessedMessages,
  correlateSessionAgents,
  correlateSessionSkills,
  fileExt,
  isMemoryFile,
  skillHasViewableOutput,
  AGENT_TOOLS,
  MEMORY_TYPE_TAG,
  MEMORY_TYPE_TINT,
  MemoryAction,
  MemoryActivity,
  MemoryTouch,
  ToolGroup,
  SessionAgent,
  SessionSkill,
} from '../chat/utils';
import { FileIcon } from '../chat/fileIcons';
import { QueryError } from '../../QueryError';
import { fmtCost, fmt } from '../utils';
import { deriveContext } from './context-window';
import type { ContextState } from './context-window';

/**
 * The scrolling Mission Control rail beside the unified Terminal/Lens view.
 *
 * Not a flat tool feed (the TUI already prints every `⏺ Bash…` line — repeating
 * it would be a mirror), but the session's *meaningful units*, laid out as
 * **container-less blocks** (design handoff "Lens variants" · nastro): flat
 * paper, no cards and no glass — each block is separated from the one above by
 * a single hairline (`railSection`) and emphasis is carried by the size of a
 * number, not by a box. A pinned vitals band leads: the CONTEXT WINDOW block
 * ("how full is my context?", 52px % over a 3px fill) and a SPEND/TASKS pair
 * (the donut rings are gone with the cards — the ratios they encoded are spelled
 * out in the captions). Then a scrolling flow of TEAMS (project-wide agent teams,
 * live-first, rows click → team detail overlay), AGENTS (rows click → full
 * transcript; violet now only where it encodes something — avatars, running dot,
 * row status), SKILLS (pills, click → output), file CHANGES **grouped by repo
 * area** with proportional diff bars, the detailed TASKS list, and ENVIRONMENT
 * (a slim strip with the session's read-only setup from the SDK init —
 * permission mode + capability counts — plus any failed MCP). Empty sections
 * are dropped; if everything is empty the rail says so in one line.
 *
 * Note this rail is chrome shared with the Terminal view, not just the Lens —
 * its look follows the chat's, so the two halves of Mission Control read as one
 * surface whichever tab is up.
 *
 * All of it derives from data the watcher already refreshes
 * (`sessions:chat`, `sessions:subagents`, `tasks:project`, `sessions:project`),
 * so the rail is live without any dedicated IPC. The CONTEXT gauge reads the
 * latest assistant turn's `usage` (input + cache read + cache write ≈ the prompt
 * size sent), now exposed per-message by `session-reader`.
 */

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const RAIL_MIN = 380;
const RAIL_MAX = 560;

/** Compact token count for the gauge: 156_312 → "156k", 1_240_000 → "1.2M". */
function kTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1000)}k`;
}

function lines(s: unknown): number {
  return typeof s === 'string' && s.length > 0 ? s.split('\n').length : 0;
}

/** +added/−removed estimate for a file-mutating tool, from its input alone. */
function editStats(g: ToolGroup): { added: number; removed: number } | null {
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
  return null;
}

type FileChange = {
  path: string;
  name: string;
  items: ToolGroup[];
  added: number;
  removed: number;
  hasError: boolean;
};

/** Per-file aggregate of every mutating tool run — the session's work product. */
function buildFileChanges(groups: ToolGroup[]): FileChange[] {
  const byPath = new Map<string, FileChange>();
  for (const g of groups) {
    if (!EDIT_TOOLS.has(g.use.name)) continue;
    const input = g.use.input as Record<string, unknown>;
    const path = (input.file_path || input.notebook_path) as string | undefined;
    if (!path) continue;
    let fc = byPath.get(path);
    if (!fc) {
      fc = {
        path,
        name: path.split(/[\\/]/).pop() || path,
        items: [],
        added: 0,
        removed: 0,
        hasError: false,
      };
      byPath.set(path, fc);
    }
    fc.items.push(g);
    const stats = editStats(g);
    if (stats) {
      fc.added += stats.added;
      fc.removed += stats.removed;
    }
    fc.hasError ||= !!g.result?.isError;
  }
  return [...byPath.values()];
}

/** Directory of a file relative to the project root — the rail's "area". Files
 *  outside the project (e.g. global memory under ~/.claude) group by their
 *  parent dir name; repo-root files group under "(root)". */
function areaOf(path: string, realPath: string): string {
  const norm = path.replace(/\\/g, '/');
  const root = realPath.replace(/\\/g, '/').replace(/\/+$/, '');
  if (norm.startsWith(root + '/')) {
    const rel = norm.slice(root.length + 1);
    const slash = rel.lastIndexOf('/');
    return slash === -1 ? '(root)' : rel.slice(0, slash);
  }
  const parts = norm.split('/').filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : 'external';
}

type AreaGroup = { dir: string; files: FileChange[]; added: number; removed: number };

/** Group changes by repo area, preserving the order each area is first touched. */
function groupByArea(changes: FileChange[], realPath: string): AreaGroup[] {
  const byDir = new Map<string, AreaGroup>();
  for (const fc of changes) {
    const dir = areaOf(fc.path, realPath);
    let g = byDir.get(dir);
    if (!g) {
      g = { dir, files: [], added: 0, removed: 0 };
      byDir.set(dir, g);
    }
    g.files.push(fc);
    g.added += fc.added;
    g.removed += fc.removed;
  }
  return [...byDir.values()];
}

/* ── presentational atoms ─────────────────────────────────────────────── */

/** The rail's block primitive (design "Lens variants · nastro"): not a card at
 *  all — a container-less section on paper, separated from the one above by a
 *  single hairline. Blocks abut (the flow has no gap), so the rule *is* the
 *  boundary; anything that needs to stand out does it with a number, not a box. */
const railSection: CSSProperties = {
  position: 'relative',
  borderTop: '1px solid var(--cl-line)',
  padding: '18px 0',
  background: 'none',
};

/** +N −N, tabular. */
function DiffNum({
  added,
  removed,
  size = 9.5,
}: {
  added: number;
  removed: number;
  size?: number;
}) {
  return (
    <span
      className="font-mono shrink-0"
      style={{
        fontSize: size,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
        display: 'inline-flex',
        gap: 7,
      }}
    >
      <span style={{ color: 'var(--cl-ok)' }}>+{fmt(added)}</span>
      <span style={{ color: 'var(--cl-danger)' }}>−{fmt(removed)}</span>
    </span>
  );
}

/** Proportional diff bar (≈√ scale so a 2000-line file isn't 100× a 20-line one). */
function RailBar({ added, removed, max = 56 }: { added: number; removed: number; max?: number }) {
  const tot = added + removed;
  if (tot === 0) return <span style={{ display: 'inline-block', width: max }} />;
  const w = Math.max(8, Math.min(max, Math.round(Math.sqrt(tot) * 2.1)));
  const aw = Math.max(2, Math.round(w * (added / tot)));
  return (
    <span
      style={{
        display: 'inline-flex',
        width: max,
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'flex-end',
      }}
    >
      <span style={{ display: 'inline-flex' }}>
        <span
          style={{
            width: aw,
            height: 3.5,
            background: 'var(--cl-ok)',
            borderRadius: '2px 0 0 2px',
          }}
        />
        <span
          style={{
            width: w - aw,
            height: 3.5,
            background: 'var(--cl-danger)',
            borderRadius: '0 2px 2px 0',
            opacity: 0.7,
          }}
        />
      </span>
    </span>
  );
}

/** Island section eyebrow: LABEL  n ───────── extra. */
function RailEyebrow({ label, n, extra }: { label: string; n?: ReactNode; extra?: ReactNode }) {
  return (
    <div
      className="font-mono"
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
        padding: '0 0 8px',
      }}
    >
      <span
        style={{
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: '0.2em',
          color: 'var(--cl-ink-4)',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      {n != null && (
        <span
          style={{
            fontSize: 9.5,
            color: 'var(--cl-ink-4)',
            fontWeight: 700,
            whiteSpace: 'nowrap',
          }}
        >
          {n}
        </span>
      )}
      <span
        style={{ flex: 1, height: 1, background: 'var(--cl-line-soft)', alignSelf: 'center' }}
      />
      {extra}
    </div>
  );
}

const PERM_LABEL: Record<string, string> = {
  default: 'DEFAULT',
  acceptEdits: 'ACCEPT EDITS',
  plan: 'PLAN MODE',
  bypassPermissions: 'BYPASS',
};

/**
 * Read-only session environment from the Agent SDK init handshake — captured by
 * aborting a one-turn query *before* any model turn, so it costs zero tokens
 * (see config-reader.ts). Surfaces what the TUI never shows: the resolved
 * permission mode and how much capability is wired up (tools/skills/agents
 * available, not just what happened to run).
 *
 * MCP is deliberately *not* counted: the globally-configured gateway servers
 * (claude.ai/*) sit pending/needs-auth in every project and never get used, so
 * a total is the same noise everywhere. Only `failed` servers earn a row, since
 * a connection that broke is the one MCP signal actually worth acting on.
 */
function EnvironmentSection({ init }: { init: InitInfo | null }) {
  if (!init) return null;
  const perm = PERM_LABEL[init.permissionMode] ?? init.permissionMode.toUpperCase();
  const danger = init.permissionMode === 'bypassPermissions';
  const failedMcp = init.mcpServers.filter(s => {
    const s2 = s.status.toLowerCase();
    return s2 === 'failed' || s2.includes('error');
  });
  const caps = [
    { label: 'TOOLS', n: init.tools.length },
    { label: 'SKILLS', n: init.skills.length },
    { label: 'AGENTS', n: init.agents.length },
  ].filter(c => c.n > 0);
  return (
    <>
      {/* slim env strip — permission mode + capability counts */}
      <div className="flex items-center" style={{ ...railSection, gap: 10, padding: '13px 0' }}>
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
        <span style={{ flex: 1 }} />
        {caps.map(c => (
          <span
            key={c.label}
            className="font-mono"
            style={{
              fontSize: 9,
              letterSpacing: '0.1em',
              color: 'var(--cl-ink-4)',
              whiteSpace: 'nowrap',
            }}
          >
            <b style={{ fontWeight: 700, color: 'var(--cl-ink-2)' }}>{c.n}</b> {c.label}
          </span>
        ))}
      </div>
      {/* Only broken MCP connections earn a row — the one actionable MCP signal. */}
      {failedMcp.length > 0 && (
        <div style={{ ...railSection, padding: '12px 0' }}>
          {failedMcp.map(s => (
            <div
              key={s.name}
              className="flex items-center gap-2.5"
              style={{ padding: '5px 0' }}
              title={`MCP server "${s.name}" failed to connect`}
            >
              <span
                aria-hidden
                className="shrink-0"
                style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--cl-danger)' }}
              />
              <span
                className="font-mono truncate min-w-0"
                style={{ fontSize: 11.5, color: 'var(--cl-ink-2)' }}
              >
                {s.name}
              </span>
              <span
                className="font-mono ml-auto shrink-0"
                style={{ fontSize: 9, letterSpacing: '0.1em', color: 'var(--cl-danger)' }}
              >
                MCP FAILED
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ── Rail blocks (nastro) ─────────────────────────────────────────────────
 * The rail's headline is a stack of container-less blocks: a full-width CONTEXT
 * WINDOW block, one band pairing SPEND and TASKS, then full-width AGENTS and
 * SKILLS. The vitals are pinned (they stay visible while the detail below
 * scrolls); AGENTS/SKILLS keep the rail's interactivity (rows open a transcript
 * / skill output). The file-CHANGES and TASKS sections follow below. */

/** Full-width CONTEXT WINDOW block — the rail's headline number: a 52px %, a
 *  3px flat fill, and a "used · left · total" footer. No aura, no glass: in this
 *  variant the size of the number is the emphasis. */
function ContextCard({ ctx }: { ctx: ContextState | null }) {
  const pct = ctx?.pct ?? 0;
  const danger = !!ctx && pct >= 90;
  return (
    <div style={{ ...railSection, overflow: 'hidden' }}>
      <div className="flex items-baseline justify-between" style={{ position: 'relative' }}>
        <span
          className="font-mono"
          style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--cl-ink-4)' }}
        >
          CONTEXT WINDOW
        </span>
        <span
          style={{
            font: '700 52px/0.9 var(--font-sans)',
            letterSpacing: '-0.04em',
            fontVariantNumeric: 'tabular-nums',
            color: danger ? 'var(--cl-danger)' : 'var(--cl-ink)',
          }}
        >
          {ctx ? pct : '—'}
          <span style={{ fontSize: 21, color: 'var(--cl-ink-3)' }}>%</span>
        </span>
      </div>
      <div
        style={{
          position: 'relative',
          marginTop: 12,
          height: 3,
          background: 'var(--cl-line-soft)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            transition: 'width 0.4s ease',
            background: danger
              ? 'var(--cl-danger)'
              : 'linear-gradient(90deg, color-mix(in oklch, var(--cl-accent) 70%, white), var(--cl-accent))',
          }}
        />
      </div>
      <div
        className="font-mono"
        style={{
          position: 'relative',
          marginTop: 9,
          fontSize: 9.5,
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--cl-ink-4)',
        }}
      >
        {ctx ? (
          <>
            {kTok(ctx.used)} used ·{' '}
            <span style={{ color: 'var(--cl-ok)' }}>
              {kTok(Math.max(0, ctx.max - ctx.used))} left
            </span>{' '}
            · {kTok(ctx.max)} total
          </>
        ) : (
          'waiting for the first turn…'
        )}
      </div>
    </div>
  );
}

/** One half of the vitals band (SPEND / TASKS) — eyebrow, big number, caption.
 *  `divided` adds the hairline that splits the band in two.
 *
 *  The donut rings this used to carry are gone with the cards: in this variant
 *  the ratio they encoded is spelled out in the caption instead (cache-savings %
 *  for SPEND, completion % for TASKS), so nothing the ring said is lost. */
function GaugeCard({
  label,
  value,
  valueColor,
  sub,
  subColor,
  divided = false,
}: {
  label: string;
  value: string;
  valueColor: string;
  sub: string;
  subColor: string;
  divided?: boolean;
}) {
  return (
    <div
      style={{
        minWidth: 0,
        ...(divided ? { borderLeft: '1px solid var(--cl-line-soft)', paddingLeft: 16 } : {}),
      }}
    >
      <div
        className="font-mono"
        style={{ fontSize: 9, letterSpacing: '0.18em', color: 'var(--cl-ink-4)' }}
      >
        {label}
      </div>
      <div
        style={{
          font: '700 22px/1 var(--font-sans)',
          letterSpacing: '-0.03em',
          fontVariantNumeric: 'tabular-nums',
          color: valueColor,
          marginTop: 6,
        }}
      >
        {value}
      </div>
      <div className="font-mono truncate" style={{ fontSize: 8.5, color: subColor, marginTop: 5 }}>
        {sub}
      </div>
    </div>
  );
}

/** Overlapping agent avatars for the AGENTS card header (caps at 3). */
function AgentAvatars({ n }: { n: number }) {
  const shown = Math.min(n, 3);
  return (
    <span className="inline-flex">
      {Array.from({ length: shown }).map((_, i) => (
        <span
          key={i}
          aria-hidden
          className="font-mono inline-flex items-center justify-center"
          style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            background:
              i === 0 ? 'var(--cl-violet)' : 'color-mix(in oklch, var(--cl-violet) 70%, black)',
            color: '#fff',
            font: '700 11px/1 var(--font-mono)',
            border: '1.5px solid var(--cl-paper)',
            marginLeft: i === 0 ? 0 : -7,
          }}
        >
          A
        </span>
      ))}
    </span>
  );
}

/** Small "open definition" glyph (go-to / open-in-detail) for the secondary
 *  action that deep-links an agent row to its definition. */
function OpenDefGlyph() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 3.5H4.5A1.5 1.5 0 0 0 3 5v6.5A1.5 1.5 0 0 0 4.5 13H11a1.5 1.5 0 0 0 1.5-1.5V10" />
      <path d="M9 3.5h3.5V7" />
      <path d="M12.5 3.5 7.5 8.5" />
    </svg>
  );
}

/** One agent row inside the AGENTS island. The row opens the full transcript
 *  (when one exists on disk); a trailing button deep-links to the agent's
 *  definition when its `subagent_type` resolves to a known agent.
 *
 *  State (a.runState): a *backgrounded* agent shows `running` (violet pulse) from
 *  dispatch until its harness completion notification arrives, then flips to
 *  `done`/`failed`. A synchronous agent is done/failed from its result. (Detail:
 *  the foreground dispatch tool_use + its tool_result are persisted in one flush,
 *  so for an async agent the result is only the "launched" ack — the real
 *  completion is the matched <task-notification>.) */
function AgentRow({
  a,
  def,
  onOpenTranscript,
  onOpenDef,
}: {
  a: SessionAgent;
  def: Agent | undefined;
  onOpenTranscript: () => void;
  onOpenDef: (agent: Agent) => void;
}) {
  const running = a.runState === 'running';
  const failed = a.runState === 'failed';
  const canTranscript = !!a.agentId;
  const statusColor = running ? 'var(--cl-violet)' : failed ? 'var(--cl-danger)' : 'var(--cl-ok)';
  return (
    <div
      className="tmc-row flex items-center"
      style={{
        gap: 11,
        padding: '8px 0',
        borderTop: '1px solid color-mix(in oklch, var(--cl-violet-soft) 60%, transparent)',
      }}
    >
      <button
        type="button"
        className="flex items-center min-w-0 flex-1 text-left disabled:opacity-60"
        disabled={!canTranscript}
        title={
          canTranscript
            ? 'Open the agent transcript'
            : running
              ? 'Agent is running…'
              : 'Transcript not on disk yet'
        }
        onClick={onOpenTranscript}
        style={{
          gap: 11,
          background: 'none',
          border: 0,
          padding: 0,
          cursor: canTranscript ? 'pointer' : 'default',
        }}
      >
        {/* avatar + status pip: pip pulses while running, solid when done/failed */}
        <span className="shrink-0 relative inline-flex" style={{ width: 26, height: 26 }}>
          <span
            aria-hidden
            className="font-mono inline-flex items-center justify-center"
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              background: 'var(--cl-violet)',
              color: '#fff',
              font: '700 12px/1 var(--font-mono)',
            }}
          >
            A
          </span>
          <span
            aria-hidden
            className={running ? 'cl-run-dot' : undefined}
            style={{
              position: 'absolute',
              right: -3,
              bottom: -3,
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: statusColor,
              border: '2px solid var(--cl-paper)',
            }}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span
            style={{
              display: 'block',
              font: '600 13.5px/1.2 var(--font-sans)',
              color: 'var(--cl-ink)',
            }}
          >
            {a.subagentType}
          </span>
          <span
            className="font-mono truncate"
            style={{
              display: 'block',
              fontSize: 10,
              color: failed ? 'var(--cl-danger)' : 'var(--cl-ink-3)',
            }}
          >
            {a.description || a.prompt}
          </span>
        </span>
        {running ? (
          <span
            className="font-mono shrink-0 inline-flex items-center"
            style={{
              gap: 5,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.12em',
              color: 'var(--cl-violet-ink)',
              whiteSpace: 'nowrap',
              marginLeft: 8,
            }}
          >
            <span
              className="cl-run-dot"
              aria-hidden
              style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--cl-violet)' }}
            />
            WORKING
          </span>
        ) : failed ? (
          <span
            className="font-mono shrink-0"
            style={{ fontSize: 10, fontWeight: 700, color: 'var(--cl-danger)', marginLeft: 8 }}
          >
            FAILED
          </span>
        ) : (
          <span
            className="font-mono shrink-0 inline-flex items-center"
            style={{
              gap: 6,
              fontSize: 9,
              letterSpacing: '0.1em',
              color: 'var(--cl-ink-4)',
              whiteSpace: 'nowrap',
              marginLeft: 8,
            }}
          >
            <span style={{ color: 'var(--cl-ok)', fontWeight: 700 }}>✓ DONE</span>
            {a.messageCount != null && (
              <span>
                <b style={{ fontWeight: 700, color: 'var(--cl-ink-2)' }}>{a.messageCount}</b> MSGS
              </span>
            )}
          </span>
        )}
      </button>
      {def && (
        <button
          type="button"
          onClick={() => onOpenDef(def)}
          title={`View ${a.subagentType} definition`}
          aria-label="View agent definition"
          className="shrink-0 inline-flex items-center justify-center transition-colors"
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            border: '1px solid color-mix(in oklch, var(--cl-violet-soft) 70%, var(--cl-line))',
            background: 'var(--cl-paper)',
            color: 'var(--cl-violet-ink)',
          }}
        >
          <OpenDefGlyph />
        </button>
      )}
    </div>
  );
}

/** Full-width AGENTS block — header cluster + interactive rows. The violet that
 *  used to tint the whole card now lives only where it encodes something: the
 *  avatars, the running dot and the row status. */
function AgentsCard({
  agents,
  agentDefOf,
  onOpenAgent,
  onOpenAgentDef,
}: {
  agents: SessionAgent[];
  agentDefOf: (subagentType: string) => Agent | undefined;
  onOpenAgent: (agent: SessionAgent) => void;
  onOpenAgentDef: (agent: Agent) => void;
}) {
  const runningCount = agents.filter(a => a.runState === 'running').length;
  return (
    <div style={railSection}>
      <div className="flex items-center" style={{ gap: 10, marginBottom: 4 }}>
        <span
          className="font-mono"
          style={{
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: '0.2em',
            color: 'var(--cl-ink-4)',
          }}
        >
          AGENTS
        </span>
        <span
          className="font-mono"
          style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--cl-ink-4)' }}
        >
          {agents.length}
        </span>
        {runningCount > 0 && (
          <span
            className="font-mono inline-flex items-center"
            style={{
              gap: 5,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.1em',
              color: 'var(--cl-violet-ink)',
            }}
          >
            <span
              className="cl-run-dot"
              aria-hidden
              style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--cl-violet)' }}
            />
            {runningCount} WORKING
          </span>
        )}
        <span style={{ flex: 1 }} />
        <AgentAvatars n={agents.length} />
      </div>
      {agents.map(a => (
        <AgentRow
          key={a.key}
          a={a}
          def={agentDefOf(a.subagentType)}
          onOpenTranscript={() => onOpenAgent(a)}
          onOpenDef={onOpenAgentDef}
        />
      ))}
    </div>
  );
}

/** One skill pill inside the SKILLS card — smart-routes on click: an agentic
 *  skill that produced a real result opens that output; otherwise the pill
 *  deep-links to the skill's definition (project/global/plugin) when it resolves;
 *  a "launch-only" agentic skill with neither falls back to its bare tool call. */
function SkillPill({
  s,
  onOpenOutput,
  onOpenDef,
}: {
  s: SessionSkill;
  onOpenOutput: (g: ToolGroup) => void;
  onOpenDef: (skill: Skill) => void;
}) {
  const hasOutput = skillHasViewableOutput(s.group);
  const canDef = s.skill !== null;
  // Priority: this run's produced artifact > the static definition > the bare
  // launch tool call (last resort, only when nothing better resolves).
  const route: 'output' | 'def' | 'launch' | null = hasOutput
    ? 'output'
    : canDef
      ? 'def'
      : s.group
        ? 'launch'
        : null;
  const clickable = route !== null;
  const title =
    route === 'output'
      ? 'View skill output'
      : route === 'def'
        ? 'View skill'
        : route === 'launch'
          ? 'Skill launched — view tool call'
          : s.description || undefined;
  return (
    <button
      type="button"
      disabled={!clickable}
      title={title}
      onClick={() => {
        if (route === 'output' || route === 'launch') onOpenOutput(s.group!);
        else if (route === 'def') onOpenDef(s.skill!);
      }}
      className="inline-flex items-center"
      style={{
        gap: 7,
        padding: '6px 11px',
        borderRadius: 999,
        border: '1px solid color-mix(in oklch, var(--cl-accent) 32%, var(--cl-line))',
        background: 'var(--cl-paper)',
        font: '500 12px/1 var(--font-mono)',
        color: 'var(--cl-ink-2)',
        cursor: clickable ? 'pointer' : 'default',
      }}
    >
      <span
        aria-hidden
        className="inline-flex items-center justify-center"
        style={{
          width: 16,
          height: 16,
          borderRadius: 4,
          background: 'var(--cl-accent)',
          color: '#fff',
          font: '700 9px/1 var(--font-mono)',
        }}
      >
        {s.group ? '✦' : '/'}
      </span>
      {s.name}
      {clickable && <span style={{ color: 'var(--cl-accent-ink)', fontSize: 9 }}>→</span>}
    </button>
  );
}

/** Full-width SKILLS block — a wrap of pills. */
function SkillsCard({
  skills,
  onOpenTool,
  onOpenSkillDef,
}: {
  skills: SessionSkill[];
  onOpenTool: (g: ToolGroup) => void;
  onOpenSkillDef: (skill: Skill) => void;
}) {
  return (
    <div style={railSection}>
      <div
        className="font-mono"
        style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--cl-ink-4)', marginBottom: 11 }}
      >
        SKILLS <span style={{ fontWeight: 700 }}>{skills.length}</span>
      </div>
      <div className="flex flex-wrap" style={{ gap: 8 }}>
        {skills.map(s => (
          <SkillPill key={s.key} s={s} onOpenOutput={onOpenTool} onOpenDef={onOpenSkillDef} />
        ))}
      </div>
    </div>
  );
}

/* ── MEMORY island ────────────────────────────────────────────────────── */

const MEMORY_ACTION_LABEL: Record<MemoryAction, string> = {
  new: 'NEW',
  revised: 'REVISED',
  wrote: 'WROTE',
  read: 'READ',
};

/** A remembered fact is the rail's one durable outcome — it outlives the session
 *  — so its label is the only one that takes the accent. A consultation is
 *  context, not an outcome: muted. */
const MEMORY_ACTION_TINT: Record<MemoryAction, string> = {
  new: 'var(--cl-accent-ink)',
  revised: 'var(--cl-ink-2)',
  wrote: 'var(--cl-ink-2)',
  read: 'var(--cl-ink-4)',
};

/** One topic row in the MEMORY block: a colour-coded type tag, the topic's own
 *  name, and what happened to it — one line, no rule under it.
 *
 *  The description is deliberately NOT printed: a memory's `name` is often
 *  already a sentence, so name-over-description printed the same fact twice and
 *  made a two-topic block as tall as the AGENTS list. It rides the tooltip
 *  instead, with the path. No diff bars either — +12/−0 on a memory file
 *  measures nothing a reader cares about. */
function MemoryRow({
  touch,
  compact,
  onOpenTool,
}: {
  touch: MemoryTouch;
  compact: boolean;
  onOpenTool: (g: ToolGroup) => void;
}) {
  const [open, setOpen] = useState(false);
  const many = touch.items.length > 1;
  const count = touch.writes > 0 ? touch.writes : touch.reads;
  const tint = MEMORY_TYPE_TINT[touch.type] ?? MEMORY_TYPE_TINT.user;

  return (
    <div>
      <button
        type="button"
        className="tmc-row w-full text-left grid items-baseline"
        title={[touch.title, touch.description, touch.path].filter(Boolean).join('\n')}
        onClick={() => (many ? setOpen(v => !v) : onOpenTool(touch.items[0]))}
        style={{
          gridTemplateColumns: '34px minmax(0,1fr) auto',
          gap: 9,
          padding: `${compact ? 4 : 5}px 4px`,
          margin: '0 -4px',
          borderRadius: 6,
          cursor: 'pointer',
        }}
      >
        <span
          className="font-mono"
          style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: tint }}
        >
          {MEMORY_TYPE_TAG[touch.type] ?? MEMORY_TYPE_TAG.user}
        </span>
        <span
          className="truncate min-w-0"
          style={{
            fontSize: compact ? 11 : 11.5,
            color: touch.hasError ? 'var(--cl-danger)' : 'var(--cl-ink-2)',
          }}
        >
          {touch.title}
          {touch.scope === 'project' && (
            <span className="font-mono" style={{ fontSize: 8.5, color: 'var(--cl-ink-4)' }}>
              {' '}
              repo
            </span>
          )}
          {many && <span style={{ color: 'var(--cl-ink-4)' }}> {open ? '▾' : '▸'}</span>}
        </span>
        <span
          className="font-mono shrink-0"
          style={{
            fontSize: 8.5,
            fontWeight: 700,
            letterSpacing: '0.06em',
            whiteSpace: 'nowrap',
            color: touch.hasError ? 'var(--cl-danger)' : MEMORY_ACTION_TINT[touch.action],
          }}
        >
          {touch.hasError ? 'FAILED' : MEMORY_ACTION_LABEL[touch.action]}
          {count > 1 && <span style={{ fontWeight: 400 }}> ×{count}</span>}
        </span>
      </button>
      {open &&
        [...touch.items].reverse().map((g, i) => (
          <button
            key={g.use.id || i}
            type="button"
            className="tmc-row w-full text-left flex items-center gap-2"
            onClick={() => onOpenTool(g)}
            style={{ padding: '3px 4px 3px 43px', margin: '0 -4px', fontSize: 10.5 }}
          >
            <span style={{ color: 'var(--cl-ink-3)' }}>{g.use.name}</span>
            {g.result?.isError && (
              <span className="font-mono" style={{ fontSize: 9, color: 'var(--cl-danger)' }}>
                ERROR
              </span>
            )}
          </button>
        ))}
    </div>
  );
}

/** Full-width MEMORY block — the session's memory activity, kept apart from
 *  CHANGES. On disk a remembered fact is always a `Write` of `<slug>.md` plus an
 *  `Edit` of `MEMORY.md`, so inside a file list it read as two rows of
 *  bookkeeping (`feedback_no_manual_app_launch.md +12 −0`, `MEMORY.md +1 −1`)
 *  that never said what was learned. Reads sit here too: they are the only
 *  visible trace of which memories informed the session (an automatic recall
 *  arrives as a `<system-reminder>` and passes through no tool at all). The
 *  index edits degrade to one muted footnote. */
function MemoryCard({
  activity,
  compact,
  onOpenTool,
}: {
  activity: MemoryActivity;
  compact: boolean;
  onOpenTool: (g: ToolGroup) => void;
}) {
  const { touches, indexOps } = activity;
  // Counted per topic, not per operation, so the caption matches the row badges:
  // a topic both written and read counts once, under its write. Only worth
  // printing once the rows outgrow a glance — beside two rows reading NEW and
  // READ, "1 new · 1 read" is the same sentence twice.
  const tally =
    touches.length > 3
      ? (['new', 'revised', 'wrote'] as MemoryAction[])
          .map(a => ({ a, n: touches.filter(t => t.writes > 0 && t.action === a).length }))
          .concat([{ a: 'read' as MemoryAction, n: touches.filter(t => t.writes === 0).length }])
          .filter(x => x.n > 0)
          .map(x => `${x.n} ${MEMORY_ACTION_LABEL[x.a].toLowerCase()}`)
          .join(' · ')
      : '';

  return (
    <section style={railSection}>
      <RailEyebrow
        label="MEMORY"
        n={touches.length}
        extra={
          <span
            className="font-mono shrink-0"
            style={{ fontSize: 9, color: 'var(--cl-ink-4)', whiteSpace: 'nowrap' }}
          >
            {tally}
          </span>
        }
      />
      {touches.map(t => (
        <MemoryRow key={t.path} touch={t} compact={compact} onOpenTool={onOpenTool} />
      ))}
      {indexOps.length > 0 && (
        <button
          type="button"
          className="tmc-row w-full text-left font-mono"
          // Bookkeeping: one click opens the most recent index edit, which is the
          // only one that reflects the index as it now stands.
          onClick={() => onOpenTool(indexOps[indexOps.length - 1])}
          title="MEMORY.md — the index Claude keeps in sync with the topics"
          style={{
            padding: '5px 4px 0 43px',
            margin: '0 -4px',
            fontSize: 8.5,
            letterSpacing: '0.04em',
            color: 'var(--cl-ink-4)',
          }}
        >
          index MEMORY.md{indexOps.length > 1 ? ` ×${indexOps.length}` : ''}
        </button>
      )}
    </section>
  );
}

/* ── TEAMS island ─────────────────────────────────────────────────────── */

type TeamRailRow = { team: TeamSummary; lead: ActiveSession | undefined };

/** One team row inside the TEAMS island — triage-grade: title, honest lead
 *  status, size/recency strip, member chips. The whole row is the single click
 *  target (→ team detail overlay); the jump to the lead session lives inside
 *  the detail, where its consequences can be made explicit.
 *
 *  Status semantics: LEAD LIVE (+ WORKING/WAITING from the registry) describes
 *  the *lead session*, not the teammates' work — the label says so. The real
 *  team-activity signal is `lastActivity` (teammate-transcript mtime): a live
 *  team gone quiet for minutes is the stuck signature, surfaced as "quiet Nm". */
function TeamRow({
  team,
  lead,
  title,
  onOpen,
}: {
  team: TeamSummary;
  lead: ActiveSession | undefined;
  title: string;
  onOpen: () => void;
}) {
  const live = !!lead;
  const quietMins = live ? minutesSince(team.lastActivity) : 0;
  const quiet = live && quietMins >= 5;
  const visibleMembers = team.memberNames.slice(0, 4);
  const hiddenCount = team.memberNames.length - visibleMembers.length;
  const statusStyle = (color: string): CSSProperties => ({
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.12em',
    color,
    whiteSpace: 'nowrap',
  });
  return (
    <button
      type="button"
      className="tmc-row w-full text-left"
      title="Open team detail"
      onClick={onOpen}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 7,
        padding: '9px 4px',
        margin: '0 -4px',
        borderTop: '1px solid var(--cl-line-soft)',
        borderRadius: 6,
        cursor: 'pointer',
      }}
    >
      <span className="flex items-center w-full" style={{ gap: 8 }}>
        <span
          className="truncate min-w-0"
          style={{ font: '600 13.5px/1.2 var(--font-sans)', color: 'var(--cl-ink)' }}
        >
          {title}
        </span>
        <span style={{ flex: 1 }} />
        {live ? (
          <span
            className="font-mono shrink-0 inline-flex items-center"
            style={{ gap: 6 }}
            title="The team's lead session is alive in the session registry — this reflects the lead session, not each teammate"
          >
            <span
              className="cl-live-dot"
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--cl-ok)',
                boxShadow: '0 0 8px var(--cl-ok)',
              }}
            />
            <span style={statusStyle('var(--cl-ok)')}>LEAD LIVE</span>
            {lead.status === 'busy' && (
              <span style={statusStyle('var(--cl-violet-ink)')}>WORKING</span>
            )}
            {lead.status === 'waiting' && (
              <span style={statusStyle('var(--cl-accent-ink)')}>WAITING</span>
            )}
          </span>
        ) : team.hasConfig ? (
          <span className="font-mono shrink-0" style={statusStyle('var(--cl-ink-4)')}>
            ENDED
          </span>
        ) : (
          <span
            className="font-mono shrink-0"
            style={statusStyle('var(--cl-ink-4)')}
            title="Team configuration is unavailable; transcript history is preserved"
          >
            HISTORICAL
          </span>
        )}
      </span>
      <span
        className="font-mono w-full truncate"
        style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums', color: 'var(--cl-ink-3)' }}
      >
        {team.memberCount} {team.memberCount === 1 ? 'member' : 'members'} · {team.transcriptCount}{' '}
        {team.transcriptCount === 1 ? 'transcript' : 'transcripts'}
        {team.sessionIds.length > 1 && ` · ${team.sessionIds.length} sessions`}
        {team.lastActivity > 0 &&
          (quiet ? (
            <>
              {' · '}
              <span
                style={{ color: 'var(--cl-accent-ink)', fontWeight: 700 }}
                title="Lead session is alive but no teammate transcript has changed for a while — the team may be stuck"
              >
                quiet {quietMins}m
              </span>
            </>
          ) : (
            ` · last activity ${fmtRelative(team.lastActivity)}`
          ))}
      </span>
      <span className="flex flex-wrap w-full" style={{ gap: 6 }}>
        {visibleMembers.map((name, i) => (
          <span
            key={name}
            className="cl-team-chip font-mono"
            style={{ fontSize: 10, padding: '1px 7px' }}
          >
            <i style={{ background: memberColor(team.memberColors[i] ?? '') }} />
            {name}
          </span>
        ))}
        {hiddenCount > 0 && (
          <span
            className="cl-team-chip font-mono"
            style={{ fontSize: 10, padding: '1px 7px', color: 'var(--cl-ink-4)' }}
          >
            +{hiddenCount}
          </span>
        )}
      </span>
    </button>
  );
}

/** Full-width TEAMS island — the focused session's agent teams, live-first.
 *  Session-scoped: Claude Code launches a team inside one session (the lead
 *  *is* the session), so only teams whose rotated lead ids include the focused
 *  session are listed. The island still renders whenever the project has teams
 *  at all, with an explicit "No teams in this session" state — so "no teams in
 *  the project" (island hidden) and "no teams in this session" stay
 *  distinguishable. List-level data only (TeamSummary never opens member
 *  transcripts). */
function TeamsCard({
  rows,
  projectTeamCount,
  titleOf,
  onOpenTeam,
}: {
  rows: TeamRailRow[];
  projectTeamCount: number;
  titleOf: (team: TeamSummary) => string;
  onOpenTeam: (teamName: string) => void;
}) {
  const liveCount = rows.filter(r => r.lead).length;
  return (
    <section style={railSection}>
      <RailEyebrow
        label="TEAMS"
        n={rows.length}
        extra={
          liveCount > 0 ? (
            <span
              className="font-mono inline-flex items-center"
              style={{
                gap: 5,
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.1em',
                color: 'var(--cl-ok)',
              }}
            >
              <span
                className="cl-live-dot"
                aria-hidden
                style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--cl-ok)' }}
              />
              {liveCount} LIVE
            </span>
          ) : undefined
        }
      />
      {rows.length === 0 ? (
        <p
          className="font-mono"
          style={{ fontSize: 10.5, color: 'var(--cl-ink-4)', margin: 0, padding: '10px 0 2px' }}
        >
          No teams in this session · {projectTeamCount} in the project
        </p>
      ) : (
        rows.map(({ team, lead }) => (
          <TeamRow
            key={team.teamName}
            team={team}
            lead={lead}
            title={titleOf(team)}
            onOpen={() => onOpenTeam(team.teamName)}
          />
        ))
      )}
    </section>
  );
}

/* ── the rail ─────────────────────────────────────────────────────────── */

export function MissionRail({
  hash,
  sessionId,
  realPath,
  width,
  onWidthChange,
  onOpenTool,
  onOpenAgent,
  onOpenSkillDef,
  onOpenAgentDef,
  onOpenTeam,
}: {
  hash: string;
  /** Null until the CLI registers itself in `~/.claude/sessions/` (a few seconds). */
  sessionId: string | null;
  realPath: string;
  width: number;
  onWidthChange: (w: number) => void;
  /** Detail views need width: the parent opens them as a wide overlay. */
  onOpenTool: (group: ToolGroup) => void;
  onOpenAgent: (agent: SessionAgent) => void;
  /** Deep-link a skill row to its definition (read-only overlay in the parent). */
  onOpenSkillDef: (skill: Skill) => void;
  /** Deep-link an agent row to its definition (read-only overlay in the parent). */
  onOpenAgentDef: (agent: Agent) => void;
  /** Open a team's detail (the existing TeamDetailView, hosted in the parent's overlay). */
  onOpenTeam: (teamName: string) => void;
}) {
  const filename = sessionId ? `${sessionId}.jsonl` : null;
  const { data: messages, isError, error, refetch } = useChatSession(hash, filename);
  const { data: subagentMetas } = useSessionSubagents(hash, filename);
  const { data: taskGroups } = useProjectTasks(hash);
  const { data: sessionList } = useSessionList(hash);
  // The raw `model` setting (e.g. `opus[1m]`) carries the 1M-context marker the
  // transcript's resolved id drops — used only to size the CONTEXT gauge.
  const { data: effectiveConfig } = useEffectiveConfig(realPath);
  const rawModel =
    typeof effectiveConfig?.effective?.model === 'string'
      ? (effectiveConfig.effective.model as string)
      : undefined;
  // The SDK init handshake (zero token cost) — surfaced read-only in ENVIRONMENT.
  const init = effectiveConfig?.init ?? null;
  // The skills registry — lets a typed `/foo` skill be recognised by a name match
  // even when its post-command expansion marker isn't visible (same source the
  // Lens footer dock uses, so the rail and the dock stay in agreement).
  const { data: allSkills } = useAllSkills(realPath);
  // Plugins resolve namespaced agentic skills (`document-skills:pdf`) to their
  // definition; the agent registries resolve a sub-agent's `subagent_type` to its
  // definition so each row can deep-link past the transcript to the agent config.
  const { data: plugins } = usePlugins();
  const { data: globalAgents } = useGlobalAgents();
  const { data: projectAgents } = useProjectAgents(realPath);
  const agentDefOf = useMemo(() => {
    const byName = new Map<string, Agent>();
    for (const a of globalAgents ?? []) byName.set(a.name, a);
    for (const a of projectAgents ?? []) byName.set(a.name, a);
    return (subagentType: string) => byName.get(subagentType);
  }, [globalAgents, projectAgents]);

  // Live activity of *this* CLI session, from the registry (busy/idle/waiting) —
  // the one signal that updates in real time. The persisted transcript records a
  // sub-agent only once it has finished (dispatch + result share one flush), so
  // it can't say "working now"; the parent session's status can. Shown in the
  // header so the user sees "a session is working / waiting / idle" live.
  const { data: activeSessions } = useActiveSessions();
  const liveStatus = useMemo(
    () => activeSessions?.find(s => s.sessionId === sessionId)?.status,
    [activeSessions, sessionId]
  );

  // Agent teams — scoped to the focused session (a team is launched inside one
  // session: the lead *is* the session; see TeamsCard). Matching spans every
  // rotated lead sessionId; the stale-prone config lead id is only a secondary
  // signal, never the sole anchor. Live teams float first (the reader already
  // sorts by lastActivity desc, so each partition keeps recency order).
  const { data: teams } = useProjectTeams(hash);
  const projectTeamCount = teams?.length ?? 0;
  const teamRows = useMemo(() => {
    if (!sessionId) return [];
    const rows = (teams ?? [])
      .filter(
        team => team.sessionIds.includes(sessionId) || team.leadSessionIdFromConfig === sessionId
      )
      .map(team => ({
        team,
        lead: liveLeadSession(team, activeSessions ?? []),
      }));
    return [...rows.filter(r => r.lead), ...rows.filter(r => !r.lead)];
  }, [teams, activeSessions, sessionId]);
  const teamTitleOf = useCallback(
    (team: TeamSummary) =>
      teamLabel(
        team,
        sessionList?.find(s => s.filename === team.filename)
      ),
    [sessionList]
  );

  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [compact, setCompact] = useState<boolean>(
    () => localStorage.getItem('tmc-density') !== 'comfortable'
  );
  const toggleCompact = useCallback(() => {
    setCompact(v => {
      localStorage.setItem('tmc-density', v ? 'comfortable' : 'compact');
      return !v;
    });
  }, []);

  const onResizeStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const handle = e.currentTarget;
      handle.setPointerCapture(e.pointerId);
      const onMove = (ev: PointerEvent) => {
        onWidthChange(
          Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.round(window.innerWidth - ev.clientX)))
        );
      };
      const onUp = () => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
    },
    [onWidthChange]
  );

  const processed = useMemo(() => (messages ? buildProcessedMessages(messages) : []), [messages]);
  const agents = useMemo(
    () => correlateSessionAgents(processed, subagentMetas ?? []),
    [processed, subagentMetas]
  );
  // SKILLS — the same correlation the Lens footer dock uses, so the rail and the
  // dock never disagree. Catches agentic `Skill` tool_uses and slash-command
  // skills; the latter are matched by the post-command skill-expansion marker OR
  // a name hit against the skills registry (the marker alone missed skills whose
  // expansion message we don't see — the bug where the rail dropped skills the
  // dock still listed). Reversed to show the most recent first.
  const skills = useMemo(
    () => correlateSessionSkills(processed, allSkills ?? [], plugins ?? []).reverse(),
    [processed, allSkills, plugins]
  );
  const ownTools = useMemo(
    () => processed.flatMap(p => p.toolGroups).filter(g => !AGENT_TOOLS.has(g.use.name)),
    [processed]
  );
  // MEMORY — the session's memory activity, its own block (below). An `Edit` of a
  // topic carries no frontmatter, so the on-disk index supplies the name and
  // description; the query is already mounted by the memory views and the
  // watcher keeps it fresh.
  const { data: memory } = useMemoryProject(hash);
  const memoryLookup = useMemo(() => {
    const byFilename = new Map<string, MemoryTopic>();
    for (const t of memory?.index ?? []) byFilename.set(t.filename, t);
    for (const t of memory?.projectLevelIndex ?? []) byFilename.set(t.filename, t);
    return (path: string) => byFilename.get(path.replace(/\\/g, '/').split('/').pop() ?? path);
  }, [memory]);
  const memoryActivity = useMemo(
    () => buildMemoryActivity(ownTools, memoryLookup),
    [ownTools, memoryLookup]
  );
  // CHANGES excludes the memory files: they are a topic each, not a diff, and
  // reporting them twice would double-count the session's line totals.
  const changes = useMemo(
    () =>
      buildFileChanges(ownTools.filter(g => !isMemoryFile(g.use.input as Record<string, unknown>))),
    [ownTools]
  );
  const areas = useMemo(() => groupByArea(changes, realPath), [changes, realPath]);
  const totals = useMemo(
    () =>
      changes.reduce(
        (acc, c) => ({ added: acc.added + c.added, removed: acc.removed + c.removed }),
        { added: 0, removed: 0 }
      ),
    [changes]
  );
  const tasks = useMemo(
    () => taskGroups?.find(g => g.sessionId === sessionId)?.tasks ?? [],
    [taskGroups, sessionId]
  );
  const summary = useMemo(
    () => sessionList?.find(s => s.filename === filename),
    [sessionList, filename]
  );

  const ctx = useMemo(() => deriveContext(messages, rawModel), [messages, rawModel]);

  // Assistant turns, excluding the synthetic notes Claude Code persists for local
  // slash-command output (not real model turns).
  const turns = useMemo(
    () => messages?.filter(m => m.role === 'assistant' && m.model !== '<synthetic>').length ?? 0,
    [messages]
  );

  // Cache savings as a share of the bill that would have been paid without cache.
  const savings = summary?.cacheSavings ?? 0;
  const savingsPct =
    summary && summary.estimatedCost + savings > 0
      ? Math.round((savings / (summary.estimatedCost + savings)) * 100)
      : 0;

  const rowPad = compact ? 5 : 7;
  const fs = compact ? 11 : 11.5;
  const doneTasks = tasks.filter(t => t.status === 'completed').length;
  const runningTasks = tasks.filter(t => t.status === 'in_progress').length;
  const empty =
    agents.length === 0 &&
    skills.length === 0 &&
    changes.length === 0 &&
    memoryActivity.touches.length === 0 &&
    tasks.length === 0 &&
    projectTeamCount === 0;

  // Nastro: flat paper, no accent wash. With the cards gone the rail needs its
  // own edge against the workspace, so it takes a hairline on the left.
  const railWrap: CSSProperties = {
    width,
    flexShrink: 0,
    position: 'relative',
    background: 'var(--cl-paper)',
    borderLeft: '1px solid var(--cl-line)',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  };

  // A single file row + its expanded per-edit detail. Shared by the grouped
  // (comfortable) layout and the flat (compact) list.
  const renderFileRow = (fc: FileChange) => {
    const isOpen = expandedFiles.has(fc.path);
    return (
      <div key={fc.path}>
        <button
          type="button"
          className="tmc-row w-full text-left grid items-center"
          title={fc.path}
          onClick={() =>
            fc.items.length === 1
              ? onOpenTool(fc.items[0])
              : setExpandedFiles(prev => {
                  const next = new Set(prev);
                  if (next.has(fc.path)) next.delete(fc.path);
                  else next.add(fc.path);
                  return next;
                })
          }
          style={{
            gridTemplateColumns: 'auto minmax(0,1fr) auto 56px',
            gap: 9,
            padding: `${rowPad}px 4px`,
            margin: '0 -4px',
            borderBottom: '1px solid var(--cl-line-soft)',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          <span
            aria-hidden
            className="shrink-0 inline-flex items-center justify-center"
            style={{
              width: 16,
              color: fc.hasError ? 'var(--cl-danger)' : 'var(--cl-ink-3)',
            }}
          >
            <FileIcon ext={fileExt(fc.name)} />
          </span>
          <span
            className="font-mono truncate min-w-0"
            style={{
              fontSize: fs,
              color: fc.hasError ? 'var(--cl-danger)' : 'var(--cl-ink-2)',
            }}
          >
            {fc.name}
            {fc.items.length > 1 && (
              <span style={{ color: 'var(--cl-ink-4)' }}>
                {' '}
                {isOpen ? '▾' : '▸'}×{fc.items.length}
              </span>
            )}
            {fc.hasError && (
              <span
                className="font-mono"
                style={{ fontSize: 8.5, color: 'var(--cl-danger)', marginLeft: 6 }}
              >
                1 FAILED
              </span>
            )}
          </span>
          <DiffNum added={fc.added} removed={fc.removed} size={9.5} />
          <RailBar added={fc.added} removed={fc.removed} />
        </button>
        {isOpen &&
          [...fc.items].reverse().map((g2, i) => {
            const stats = editStats(g2);
            return (
              <button
                key={g2.use.id || i}
                type="button"
                className="tmc-row w-full text-left flex items-center gap-2"
                onClick={() => onOpenTool(g2)}
                style={{
                  padding: '3px 4px 3px 28px',
                  margin: '0 -4px',
                  fontSize: 11,
                }}
              >
                <span style={{ color: 'var(--cl-ink-3)' }}>{g2.use.name}</span>
                {g2.result?.isError && (
                  <span className="font-mono" style={{ fontSize: 9, color: 'var(--cl-danger)' }}>
                    ERROR
                  </span>
                )}
                {stats && (
                  <span className="ml-auto">
                    <DiffNum added={stats.added} removed={stats.removed} size={9} />
                  </span>
                )}
              </button>
            );
          })}
      </div>
    );
  };

  return (
    <aside style={railWrap}>
      {/* drag-to-resize handle on the left edge */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        onPointerDown={onResizeStart}
        className="absolute top-0 h-full"
        style={{ left: -3, width: 7, cursor: 'col-resize', zIndex: 10 }}
      />

      {/* fixed header — the live-status dot + label reflect THIS session's
          registry status (the only real-time "is it working now" signal): busy →
          violet working pulse, waiting → terracotta, idle → green, offline → grey. */}
      <div className="shrink-0 flex items-center gap-2" style={{ padding: '16px 20px 12px' }}>
        <span
          aria-hidden
          className={liveStatus === 'busy' ? 'cl-run-dot' : liveStatus ? 'cl-live-dot' : undefined}
          style={(() => {
            const c =
              liveStatus === 'busy'
                ? 'var(--cl-violet)'
                : liveStatus === 'waiting'
                  ? 'var(--cl-accent)'
                  : liveStatus
                    ? 'var(--cl-ok)'
                    : 'var(--cl-ink-4)';
            return {
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: c,
              // the design's glowing status LED — unlit when the session is offline
              boxShadow: liveStatus ? `0 0 8px ${c}` : undefined,
            };
          })()}
        />
        <span
          className="font-mono"
          style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.22em', color: 'var(--cl-ink)' }}
        >
          MISSION CONTROL
        </span>
        {liveStatus && (
          <span
            className="font-mono"
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.14em',
              color:
                liveStatus === 'busy'
                  ? 'var(--cl-violet-ink)'
                  : liveStatus === 'waiting'
                    ? 'var(--cl-accent-ink)'
                    : 'var(--cl-ink-4)',
            }}
          >
            {liveStatus === 'busy' ? 'WORKING' : liveStatus === 'waiting' ? 'WAITING' : 'IDLE'}
          </span>
        )}
        {sessionId && (
          <span
            className="font-mono"
            style={{ fontSize: 10, letterSpacing: '0.08em', color: 'var(--cl-ink-4)' }}
          >
            {sessionId.slice(0, 8)}
            {turns > 0 && ` · ${turns} turns`}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="font-mono transition-colors"
          onClick={toggleCompact}
          aria-pressed={compact}
          title="Toggle density"
          style={{
            fontSize: 9,
            letterSpacing: '0.12em',
            color: compact ? 'var(--cl-accent-ink)' : 'var(--cl-ink-4)',
          }}
        >
          {compact ? 'COMPACT' : 'COMFY'}
        </button>
      </div>

      {/* pinned vitals — the CONTEXT block + the SPEND/TASKS band above the flow.
          `gap: 0` throughout: every block carries its own top rule, and a gap
          would leave the rules floating instead of dividing. */}
      <div
        className="shrink-0"
        style={{
          display: 'grid',
          gap: 0,
          padding: '0 20px',
        }}
      >
        <ContextCard ctx={ctx} />
        <div
          style={{
            ...railSection,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 16,
          }}
        >
          <GaugeCard
            label="SPEND"
            value={summary ? fmtCost(summary.estimatedCost) : '—'}
            valueColor="var(--cl-accent-ink)"
            sub={savings > 0 ? `cache −${fmtCost(savings)} · ${savingsPct}%` : 'cache savings'}
            subColor="var(--cl-ok)"
          />
          <GaugeCard
            label="TASKS"
            value={tasks.length > 0 ? `${doneTasks}/${tasks.length}` : '—'}
            valueColor="var(--cl-ink)"
            sub={
              tasks.length === 0
                ? 'no tasks yet'
                : `${Math.round((doneTasks / tasks.length) * 100)}% · ${
                    runningTasks > 0
                      ? `${runningTasks} running`
                      : `${tasks.length - doneTasks} left`
                  }`
            }
            subColor="var(--cl-ink-4)"
            divided
          />
        </div>
      </div>

      {/* scrolling flow — a stack of container-less blocks, divided by their rules */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '0 20px 22px',
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
        }}
      >
        {!sessionId && (
          <p className="cl-transcript-state">Waiting for the CLI session to register…</p>
        )}

        {sessionId && isError && (
          <QueryError title="Failed to load session data" error={error} onRetry={() => refetch()} />
        )}

        {sessionId && !isError && empty && (
          <p className="cl-transcript-state">
            Agents, skills and file changes will appear here as Claude works.
          </p>
        )}

        {/* TEAMS — session-scoped, session-scoped, rows → team detail overlay */}
        {sessionId && projectTeamCount > 0 && (
          <TeamsCard
            rows={teamRows}
            projectTeamCount={projectTeamCount}
            titleOf={teamTitleOf}
            onOpenTeam={onOpenTeam}
          />
        )}

        {/* AGENTS — rows → transcript, trailing button → definition */}
        {agents.length > 0 && (
          <AgentsCard
            agents={agents}
            agentDefOf={agentDefOf}
            onOpenAgent={onOpenAgent}
            onOpenAgentDef={onOpenAgentDef}
          />
        )}

        {/* SKILLS — pills → output / definition / tool call */}
        {skills.length > 0 && (
          <SkillsCard skills={skills} onOpenTool={onOpenTool} onOpenSkillDef={onOpenSkillDef} />
        )}

        {/* MEMORY island — topics read/created/revised, ahead of CHANGES: what the
            session learned reads before what it touched */}
        {memoryActivity.touches.length > 0 && (
          <MemoryCard activity={memoryActivity} compact={compact} onOpenTool={onOpenTool} />
        )}

        {/* CHANGES island — grouped by repo area (comfortable) or a flat list (compact) */}
        {changes.length > 0 && (
          <section style={railSection}>
            <RailEyebrow
              label="CHANGES"
              n={changes.length}
              extra={<DiffNum added={totals.added} removed={totals.removed} size={10} />}
            />
            {compact
              ? changes.map(renderFileRow)
              : areas.map(g => (
                  <div key={g.dir} style={{ marginBottom: 4 }}>
                    <div
                      className="flex items-baseline gap-2"
                      style={{ padding: '7px 0 4px', borderBottom: '1px solid var(--cl-line)' }}
                    >
                      <span
                        className="font-mono truncate"
                        style={{ fontSize: 10, fontWeight: 600, color: 'var(--cl-ink-2)' }}
                      >
                        {g.dir}/
                      </span>
                      <span
                        className="font-mono shrink-0"
                        style={{ fontSize: 9, color: 'var(--cl-ink-4)', whiteSpace: 'nowrap' }}
                      >
                        {g.files.length} FILE
                      </span>
                      <span style={{ flex: 1 }} />
                      <DiffNum added={g.added} removed={g.removed} size={9.5} />
                    </div>
                    {g.files.map(renderFileRow)}
                  </div>
                ))}
          </section>
        )}

        {/* TASKS island */}
        {tasks.length > 0 && (
          <section style={railSection}>
            <RailEyebrow label="TASKS" n={`${doneTasks}/${tasks.length}`} />
            {tasks.map(t => {
              // Extra detail the dedicated Tasks page shows: live activeForm,
              // description, and dependency links. Only rows that carry any of
              // these are expandable (a click would otherwise toggle nothing).
              const liveForm = t.status === 'in_progress' ? t.activeForm?.trim() : '';
              const hasDeps = t.blockedBy.length > 0 || t.blocks.length > 0;
              const hasDetail = Boolean(liveForm) || Boolean(t.description?.trim()) || hasDeps;
              const isOpen = expandedTasks.has(t.id);
              const Row = hasDetail ? 'button' : 'div';
              return (
                <div key={t.id}>
                  <Row
                    {...(hasDetail
                      ? {
                          type: 'button' as const,
                          onClick: () =>
                            setExpandedTasks(prev => {
                              const next = new Set(prev);
                              if (next.has(t.id)) next.delete(t.id);
                              else next.add(t.id);
                              return next;
                            }),
                        }
                      : {})}
                    className="flex items-center gap-2.5 w-full text-left"
                    title={hasDetail ? (isOpen ? 'Hide details' : 'Show details') : undefined}
                    style={{
                      padding: `${rowPad}px 0`,
                      borderBottom: '1px solid var(--cl-line-soft)',
                      cursor: hasDetail ? 'pointer' : 'default',
                    }}
                  >
                    <span
                      aria-hidden
                      className="shrink-0 inline-flex justify-center"
                      style={{ width: 14 }}
                    >
                      {t.status === 'completed' ? (
                        <span style={{ color: 'var(--cl-ok)', fontSize: 11 }}>✓</span>
                      ) : t.status === 'in_progress' ? (
                        <span
                          className="cl-live-dot"
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: '50%',
                            background: 'var(--cl-ok)',
                          }}
                        />
                      ) : (
                        <span style={{ color: 'var(--cl-ink-4)', fontSize: 11 }}>○</span>
                      )}
                    </span>
                    <span
                      className="min-w-0 flex-1"
                      style={{
                        fontSize: fs + 0.5,
                        lineHeight: 1.4,
                        color:
                          t.status === 'completed'
                            ? 'var(--cl-ink-4)'
                            : t.status === 'in_progress'
                              ? 'var(--cl-ink)'
                              : 'var(--cl-ink-2)',
                        fontWeight: t.status === 'in_progress' ? 600 : 400,
                        textDecoration: t.status === 'completed' ? 'line-through' : 'none',
                      }}
                    >
                      {t.subject}
                    </span>
                    {hasDetail && (
                      <span
                        aria-hidden
                        className="shrink-0"
                        style={{ fontSize: 9, color: 'var(--cl-ink-4)' }}
                      >
                        {isOpen ? '▾' : '▸'}
                      </span>
                    )}
                  </Row>
                  {hasDetail && isOpen && (
                    <div
                      style={{
                        padding: `${rowPad}px 0 ${rowPad + 2}px 24px`,
                        borderBottom: '1px solid var(--cl-line-soft)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      {liveForm && (
                        <span
                          style={{
                            fontSize: fs,
                            lineHeight: 1.45,
                            color: 'var(--cl-ok)',
                            fontWeight: 600,
                          }}
                        >
                          ⟳ {liveForm}…
                        </span>
                      )}
                      {t.description?.trim() && (
                        <span style={{ fontSize: fs, lineHeight: 1.5, color: 'var(--cl-ink-2)' }}>
                          {t.description}
                        </span>
                      )}
                      {hasDeps && (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          {t.blockedBy.length > 0 && (
                            <span
                              className="font-mono"
                              style={{ fontSize: 9.5, color: 'var(--cl-ink-4)' }}
                            >
                              <span style={{ color: 'var(--cl-danger)', letterSpacing: '0.06em' }}>
                                BLOCKED BY
                              </span>{' '}
                              {t.blockedBy.map(id => `#${id}`).join(' ')}
                            </span>
                          )}
                          {t.blocks.length > 0 && (
                            <span
                              className="font-mono"
                              style={{ fontSize: 9.5, color: 'var(--cl-ink-4)' }}
                            >
                              <span style={{ letterSpacing: '0.06em' }}>BLOCKS</span>{' '}
                              {t.blocks.map(id => `#${id}`).join(' ')}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        )}

        {/* ENVIRONMENT — slim strip with the read-only session setup */}
        <EnvironmentSection init={init} />
      </div>
    </aside>
  );
}
