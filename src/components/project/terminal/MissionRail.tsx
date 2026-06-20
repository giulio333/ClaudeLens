import { CSSProperties, ReactNode, useCallback, useMemo, useState } from 'react';
import {
  useChatSession,
  useEffectiveConfig,
  useProjectTasks,
  useSessionList,
  useSessionSubagents,
} from '../../../hooks/useIPC';
import type { ChatMessage, InitInfo } from '../../../types';
import {
  buildProcessedMessages,
  correlateSessionAgents,
  fileExt,
  AGENT_TOOLS,
  ToolGroup,
  SessionAgent,
} from '../chat/utils';
import { FileIcon } from '../chat/fileIcons';
import { QueryError } from '../../QueryError';
import { fmtCost, fmt } from '../utils';

/**
 * The scrolling Mission Control rail beside the unified Terminal/Lens view.
 *
 * Not a flat tool feed (the TUI already prints every `⏺ Bash…` line — repeating
 * it would be a mirror), but the session's *meaningful units*, laid out as a
 * "bento" of cards (design: the "Chat display variants exploration", 03 · Bento):
 * a pinned vitals band of gauge cards — CONTEXT WINDOW ("how full is my
 * context?"), SPEND (cost + cache-savings ring) and TASKS (done/total ring) —
 * then a scrolling flow of AGENTS (violet card, rows click → full transcript),
 * SKILLS (pills, click → output), file CHANGES **grouped by repo area** with
 * proportional diff bars, the detailed TASKS list, and ENVIRONMENT (the session's
 * read-only setup from the SDK init — permission mode + capability counts, plus
 * any failed MCP). Empty sections are dropped; if everything is empty the rail
 * says so in one line.
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

/** A 1M-context variant, detected by the `[1m]`/`1m` marker on the model id or
 *  the raw `model` setting (e.g. `opus[1m]`). */
function isOneMillion(model: string | undefined): boolean {
  return !!model && /\[1m\]|\b1m\b/i.test(model);
}

/** Compact token count for the gauge: 156_312 → "156k", 1_240_000 → "1.2M". */
function kTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1000)}k`;
}

type ContextState = { used: number; max: number; pct: number };
type SkillRun = {
  key: string;
  name: string;
  args?: string;
  description?: string;
  /** true = invoked agentically as a `Skill` tool_use; false = a custom slash command. */
  viaTool: boolean;
  /** For agentic skills: the tool group, so the row can open the produced output. */
  group?: ToolGroup;
};

/** CONTEXT occupancy from the latest assistant turn's usage (input + both cache
 *  tiers ≈ the prompt size sent). The transcript records only the bare model id
 *  (`claude-opus-4-8`); the 1M window is opt-in and visible only in the raw `model`
 *  setting (`opus[1m]`, from useEffectiveConfig), so trust either marker — and bump
 *  to 1M anyway if usage already exceeds 200k. */
function deriveContext(
  messages: ChatMessage[] | undefined,
  rawModel: string | undefined
): ContextState | null {
  if (!messages) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'assistant' || !m.usage) continue;
    const used = m.usage.inputTokens + m.usage.cacheReadTokens + m.usage.cacheWriteTokens;
    const oneM = isOneMillion(m.model) || isOneMillion(rawModel) || used > 200_000;
    const max = oneM ? 1_000_000 : 200_000;
    return { used, max, pct: Math.min(100, Math.round((used / max) * 100)) };
  }
  return null;
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

/** Sticky section eyebrow: LABEL  n ───────── extra. */
function RailEyebrow({ label, n, extra }: { label: string; n?: ReactNode; extra?: ReactNode }) {
  return (
    <div
      className="font-mono"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 3,
        background: 'var(--cl-paper)',
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
        padding: '14px 0 8px',
      }}
    >
      <span
        style={{
          fontSize: 9.5,
          fontWeight: 600,
          letterSpacing: '0.2em',
          color: 'var(--cl-ink-3)',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      {n != null && (
        <span
          style={{
            fontSize: 9.5,
            color: 'var(--cl-accent-ink)',
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
      <RailEyebrow label="ENVIRONMENT" />
      {/* permission mode + capability counts */}
      <div className="flex items-center" style={{ gap: 10, flexWrap: 'wrap', paddingBottom: 6 }}>
        <span
          className="font-mono"
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.12em',
            padding: '3px 8px',
            borderRadius: 6,
            color: danger ? 'var(--cl-on-accent)' : 'var(--cl-ink-2)',
            background: danger ? 'var(--cl-danger)' : 'var(--cl-paper-2)',
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
            style={{ fontSize: 9, letterSpacing: '0.1em', color: 'var(--cl-ink-4)', whiteSpace: 'nowrap' }}
          >
            <b style={{ fontWeight: 700, color: 'var(--cl-ink-2)' }}>{c.n}</b> {c.label}
          </span>
        ))}
      </div>
      {/* Only broken MCP connections earn a row — the one actionable MCP signal. */}
      {failedMcp.map(s => (
        <div
          key={s.name}
          className="flex items-center gap-2.5"
          style={{ padding: '5px 0', borderBottom: '1px solid var(--cl-line-soft)' }}
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
    </>
  );
}

/* ── Bento mosaic (variant 03) ────────────────────────────────────────────
 * The rail's headline is a bento of cards adapted from the "Chat display
 * variants exploration" design (03 · Bento): a full-width CONTEXT WINDOW card,
 * a SPEND + TASKS gauge pair, then full-width AGENTS and SKILLS cards. The
 * gauges are pinned (vitals stay visible while the detail below scrolls); the
 * AGENTS/SKILLS cards keep the rail's interactivity (rows open a transcript /
 * skill output). The file-CHANGES section is kept below the bento, restyled. */

const bentoCard: CSSProperties = {
  border: '1px solid var(--cl-line)',
  borderRadius: 14,
  padding: '15px 16px',
  background: 'var(--cl-paper)',
};

/** Ring gauge (the bento's spend/tasks donut). `pct` 0–100 fills the ring;
 *  `label` is the centred caption. r=19 → circumference ≈ 119.4. */
function Donut({
  pct,
  color,
  label,
  labelSize = 11,
}: {
  pct: number;
  color: string;
  label: string;
  labelSize?: number;
}) {
  const r = 19;
  const circ = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(100, pct)) / 100) * circ;
  return (
    <svg viewBox="0 0 48 48" style={{ width: 46, height: 46, flexShrink: 0 }} aria-hidden>
      <circle cx="24" cy="24" r={r} style={{ fill: 'none', stroke: 'var(--cl-paper-3)', strokeWidth: 6 }} />
      {pct > 0 && (
        <circle
          cx="24"
          cy="24"
          r={r}
          style={{
            fill: 'none',
            stroke: color,
            strokeWidth: 6,
            strokeDasharray: `${dash} 999`,
            strokeLinecap: 'round',
            transform: 'rotate(-90deg)',
            transformOrigin: '24px 24px',
          }}
        />
      )}
      <text
        x="24"
        y="27.5"
        textAnchor="middle"
        style={{ font: `600 ${labelSize}px var(--font-sans)`, fill: 'var(--cl-ink)' }}
      >
        {label}
      </text>
    </svg>
  );
}

/** Full-width CONTEXT WINDOW card — striped fill, "used · left · total" footer. */
function ContextCard({ ctx }: { ctx: ContextState | null }) {
  const pct = ctx?.pct ?? 0;
  const danger = !!ctx && pct >= 90;
  return (
    <div
      style={{
        ...bentoCard,
        gridColumn: '1 / -1',
        background:
          'radial-gradient(70% 120% at 100% 0%, var(--cl-accent-soft), transparent 60%), var(--cl-paper)',
      }}
    >
      <div className="flex items-baseline justify-between">
        <span
          className="font-mono"
          style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--cl-ink-4)' }}
        >
          CONTEXT WINDOW
        </span>
        <span
          style={{
            font: '700 24px/1 var(--font-sans)',
            letterSpacing: '-0.02em',
            fontVariantNumeric: 'tabular-nums',
            color: danger ? 'var(--cl-danger)' : 'var(--cl-ink)',
          }}
        >
          {ctx ? pct : '—'}
          <span style={{ fontSize: 13, color: 'var(--cl-ink-3)' }}>%</span>
        </span>
      </div>
      <div
        style={{
          marginTop: 11,
          height: 14,
          borderRadius: 4,
          background: 'var(--cl-paper-3)',
          border: '1px solid var(--cl-line)',
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
              : 'repeating-linear-gradient(90deg, var(--cl-accent) 0 7px, color-mix(in oklch, var(--cl-accent) 55%, var(--cl-paper)) 7px 10px)',
          }}
        />
      </div>
      <div
        className="font-mono"
        style={{
          marginTop: 8,
          fontSize: 9.5,
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--cl-ink-4)',
        }}
      >
        {ctx ? (
          <>
            {kTok(ctx.used)} used · <span style={{ color: 'var(--cl-ok)' }}>{kTok(Math.max(0, ctx.max - ctx.used))} left</span> · {kTok(ctx.max)} total
          </>
        ) : (
          'waiting for the first turn…'
        )}
      </div>
    </div>
  );
}

/** Compact gauge card (SPEND / TASKS) — donut left, stacked caption right. */
function GaugeCard({
  donut,
  label,
  value,
  valueColor,
  sub,
  subColor,
}: {
  donut: ReactNode;
  label: string;
  value: string;
  valueColor: string;
  sub: string;
  subColor: string;
}) {
  return (
    <div style={{ ...bentoCard, display: 'flex', alignItems: 'center', gap: 14 }}>
      {donut}
      <div className="min-w-0">
        <div
          className="font-mono"
          style={{ fontSize: 9, letterSpacing: '0.18em', color: 'var(--cl-ink-4)' }}
        >
          {label}
        </div>
        <div
          style={{
            font: '700 21px/1 var(--font-sans)',
            fontVariantNumeric: 'tabular-nums',
            color: valueColor,
            marginTop: 4,
          }}
        >
          {value}
        </div>
        <div className="font-mono truncate" style={{ fontSize: 8.5, color: subColor, marginTop: 4 }}>
          {sub}
        </div>
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
            borderRadius: 6,
            background: i === 0 ? 'var(--cl-violet)' : 'color-mix(in oklch, var(--cl-violet) 70%, black)',
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

/** One agent row inside the AGENTS bento card — opens the full transcript when
 *  one exists on disk, else is disabled. */
function AgentRow({ a, onOpen }: { a: SessionAgent; onOpen: () => void }) {
  const failed = a.isError;
  return (
    <button
      type="button"
      className="tmc-row w-full text-left disabled:opacity-60"
      disabled={!a.agentId}
      title={a.agentId ? 'Open the agent transcript' : 'Transcript not on disk yet'}
      onClick={onOpen}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 11,
        padding: '8px 0',
        borderTop: '1px solid color-mix(in oklch, var(--cl-violet-soft) 60%, transparent)',
        cursor: a.agentId ? 'pointer' : 'default',
      }}
    >
      <span
        aria-hidden
        className="font-mono shrink-0 inline-flex items-center justify-center"
        style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--cl-violet)', color: '#fff', font: '700 12px/1 var(--font-mono)' }}
      >
        A
      </span>
      <span className="min-w-0 flex-1">
        <span style={{ display: 'block', font: '600 13.5px/1.2 var(--font-sans)', color: 'var(--cl-ink)' }}>
          {a.subagentType}
        </span>
        <span
          className="font-mono truncate"
          style={{ display: 'block', fontSize: 10, color: failed ? 'var(--cl-danger)' : 'var(--cl-ink-3)' }}
        >
          {a.description || a.prompt}
        </span>
      </span>
      {a.messageCount != null && (
        <span
          className="font-mono shrink-0"
          style={{ fontSize: 9, letterSpacing: '0.1em', color: 'var(--cl-ink-4)', whiteSpace: 'nowrap' }}
        >
          <b style={{ fontWeight: 700, color: 'var(--cl-ink-2)' }}>{a.messageCount}</b> MSGS
        </span>
      )}
      <span
        className="font-mono shrink-0"
        style={{ fontSize: 10, fontWeight: 700, color: failed ? 'var(--cl-danger)' : 'var(--cl-accent-ink)' }}
      >
        {failed ? 'FAILED' : a.agentId ? '→' : ''}
      </span>
    </button>
  );
}

/** Full-width AGENTS card — violet-tinted, header cluster + interactive rows. */
function AgentsCard({
  agents,
  onOpenAgent,
}: {
  agents: SessionAgent[];
  onOpenAgent: (agent: SessionAgent) => void;
}) {
  return (
    <div
      style={{
        ...bentoCard,
        marginTop: 14,
        padding: '14px 16px',
        borderColor: 'var(--cl-violet-soft)',
        background: 'color-mix(in oklch, var(--cl-violet-soft) 28%, var(--cl-paper))',
      }}
    >
      <div className="flex items-center" style={{ gap: 10, marginBottom: 4 }}>
        <span
          className="font-mono"
          style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.18em', color: 'var(--cl-violet-ink)' }}
        >
          AGENTS
        </span>
        <span style={{ font: '700 13px/1 var(--font-sans)', color: 'var(--cl-violet-ink)' }}>
          {agents.length}
        </span>
        <span style={{ flex: 1 }} />
        <AgentAvatars n={agents.length} />
      </div>
      {agents.map(a => (
        <AgentRow key={a.key} a={a} onOpen={() => onOpenAgent(a)} />
      ))}
    </div>
  );
}

/** One skill pill inside the SKILLS card — opens the produced output when the
 *  skill ran agentically (a `Skill` tool_use), else is inert. */
function SkillPill({ s, onOpen }: { s: SkillRun; onOpen: () => void }) {
  const clickable = !!s.group;
  return (
    <button
      type="button"
      disabled={!clickable}
      title={clickable ? 'View skill output' : s.description || undefined}
      onClick={onOpen}
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
        style={{ width: 16, height: 16, borderRadius: 4, background: 'var(--cl-accent)', color: '#fff', font: '700 9px/1 var(--font-mono)' }}
      >
        {s.viaTool ? '✦' : '/'}
      </span>
      {s.name}
      {clickable && <span style={{ color: 'var(--cl-accent-ink)', fontSize: 9 }}>→</span>}
    </button>
  );
}

/** Full-width SKILLS card — a wrap of pills. */
function SkillsCard({ skills, onOpenTool }: { skills: SkillRun[]; onOpenTool: (g: ToolGroup) => void }) {
  return (
    <div style={{ ...bentoCard, marginTop: 14, padding: '14px 16px' }}>
      <div
        className="font-mono"
        style={{ fontSize: 9, letterSpacing: '0.18em', color: 'var(--cl-ink-4)', marginBottom: 11 }}
      >
        SKILLS <span style={{ color: 'var(--cl-accent-ink)', fontWeight: 700 }}>{skills.length}</span>
      </div>
      <div className="flex flex-wrap" style={{ gap: 8 }}>
        {skills.map(s => (
          <SkillPill key={s.key} s={s} onOpen={() => s.group && onOpenTool(s.group)} />
        ))}
      </div>
    </div>
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
  // SKILLS = real skills only. Two sources, both excluding built-in slash commands
  // (/model, /clear, …): a `Skill` tool_use (skills run agentically — these never
  // appear as <command-name>, so the old command-only read missed them) and custom
  // slash commands the user typed that are flagged isSkill.
  const skillRuns = useMemo<SkillRun[]>(() => {
    const out: SkillRun[] = [];
    processed.forEach((p, i) => {
      for (const g of p.toolGroups) {
        if (g.use.name === 'Skill') {
          const input = g.use.input as Record<string, unknown>;
          out.push({ key: g.use.id || `skill-${i}`, name: String(input.skill ?? 'skill'), viaTool: true, group: g });
        }
      }
      const c = p.command;
      if (c?.isSkill) {
        out.push({
          key: p.msg.uuid || `cmd-${i}`,
          name: c.command,
          args: c.args,
          description: c.description,
          viaTool: false,
        });
      }
    });
    return out.reverse();
  }, [processed]);
  const changes = useMemo(
    () =>
      buildFileChanges(
        processed.flatMap(p => p.toolGroups).filter(g => !AGENT_TOOLS.has(g.use.name))
      ),
    [processed]
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
    agents.length === 0 && skillRuns.length === 0 && changes.length === 0 && tasks.length === 0;

  const railWrap: CSSProperties = {
    width,
    flexShrink: 0,
    position: 'relative',
    borderLeft: '1px solid var(--cl-line)',
    background: 'var(--cl-paper)',
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

      {/* fixed header */}
      <div className="shrink-0 flex items-center gap-2" style={{ padding: '16px 22px 12px' }}>
        <span
          aria-hidden
          className="cl-live-dot"
          style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--cl-ok)' }}
        />
        <span
          className="font-mono"
          style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.22em', color: 'var(--cl-ink)' }}
        >
          MISSION CONTROL
        </span>
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

      {/* Bento vitals — CONTEXT + SPEND + TASKS gauges, pinned above the flow */}
      <div
        className="shrink-0"
        style={{
          borderTop: '1.5px solid var(--cl-ink)',
          borderBottom: '1px solid var(--cl-line)',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          padding: '16px 22px',
        }}
      >
        <ContextCard ctx={ctx} />
        <GaugeCard
          donut={<Donut pct={savingsPct} color="var(--cl-ok)" label={`${savingsPct}%`} />}
          label="SPEND"
          value={summary ? fmtCost(summary.estimatedCost) : '—'}
          valueColor="var(--cl-accent-ink)"
          sub={savings > 0 ? `cache −${fmtCost(savings)}` : 'cache savings'}
          subColor="var(--cl-ok)"
        />
        <GaugeCard
          donut={
            <Donut
              pct={tasks.length > 0 ? Math.round((doneTasks / tasks.length) * 100) : 0}
              color="var(--cl-ink)"
              label={tasks.length > 0 ? `${doneTasks}/${tasks.length}` : '—'}
            />
          }
          label="TASKS"
          value={tasks.length > 0 ? `${Math.round((doneTasks / tasks.length) * 100)}%` : '—'}
          valueColor="var(--cl-ink)"
          sub={
            runningTasks > 0
              ? `${runningTasks} running`
              : tasks.length > 0
                ? `${tasks.length - doneTasks} left`
                : 'no tasks yet'
          }
          subColor="var(--cl-ink-4)"
        />
      </div>

      {/* scrolling flow */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 22px 22px' }}>
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

        {/* AGENTS — bento card, interactive rows (→ transcript) */}
        {agents.length > 0 && <AgentsCard agents={agents} onOpenAgent={onOpenAgent} />}

        {/* SKILLS — bento card, pills (→ output) */}
        {skillRuns.length > 0 && <SkillsCard skills={skillRuns} onOpenTool={onOpenTool} />}

        {/* CHANGES — grouped by repo area (comfortable) or a flat list (compact) */}
        {changes.length > 0 && (
          <>
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
          </>
        )}

        {/* TASKS */}
        {tasks.length > 0 && (
          <>
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
                        <span
                          style={{ fontSize: fs, lineHeight: 1.5, color: 'var(--cl-ink-2)' }}
                        >
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
          </>
        )}

        {/* ENVIRONMENT — read-only session setup, kept below the bento + changes */}
        <EnvironmentSection init={init} />
      </div>
    </aside>
  );
}
