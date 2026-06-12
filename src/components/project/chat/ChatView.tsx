import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  saveMarkdownExport,
  savePdfExport,
  useActiveSessions,
  useChatSession,
  useSessionSubagents,
  useGlobalAgents,
  useProjectAgents,
  useAllSkills,
} from '../../../hooks/useIPC';
import { SessionSummary, Skill, Agent, ChatMessage, ToolActivity } from '../../../hooks/useIPC';
import { sessionTitle } from '../utils';
import {
  buildProcessedMessages,
  correlateSessionAgents,
  correlateSessionSkills,
  describeTurn,
  touchedFiles,
  skillInitial,
  ChatDetailsFilter,
  SessionAgent,
  SessionSkill,
  ToolGroup,
  TouchedFile,
  TurnDescriptor,
} from './utils';
import {
  buildChatExportDocument,
  CHAT_EXPORT_PRESETS,
  ChatExportFormat,
  ChatExportPreset,
} from './export';
import { useChatAutoScroll } from './useAutoScroll';
import { ToolDetailPanel } from './ToolDetailPanel';
import { SubagentTranscriptPanel } from './SubagentTranscriptPanel';
import { MessageBubble } from './MessageBubble';
import { ChatComposer } from './ChatComposer';
import { agentTintColor } from '../shared/entityOptions';
import { TopBar } from '../shared/TopBar';
import { DeleteSessionDialog } from '../shared/DeleteSessionDialog';
import { SessionGraphView } from './graph/SessionGraphView';
import { QueryError } from '../../QueryError';
import Markdown from '../../Markdown';

type ViewMode = 'chat' | 'timeline';

function TrashGlyph() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    </svg>
  );
}

function ChevronUpGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 15l6-6 6 6" />
    </svg>
  );
}

/** Caret on the agent dock — points up when collapsed (the sheet opens upward),
 *  flips down once the sheet is open. */
function DockCaretGlyph({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.18s' }}
    >
      <path d="M6 15l6-6 6 6" />
    </svg>
  );
}

function LocateGlyph() {
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
      <path d="M8 2v9" />
      <path d="M4.5 7.5 8 11l3.5-3.5" />
      <path d="M3 13h10" />
    </svg>
  );
}

function fmtAgentSpan(startedAt?: string, endedAt?: string): string | null {
  if (!startedAt || !endedAt) return null;
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

function fmtAgentClock(ts?: string): string {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

type TurnFilter = 'all' | 'tools' | 'thinking' | 'questions' | 'plan';

type MinimapItem = TurnDescriptor & { n: number; time: string };

/** One row in the transcript stream: either a real message turn, or a run of
 *  consecutive tool-only turns collapsed into a single "tools hidden" badge. */
type RenderItem =
  | { kind: 'turn'; idx: number }
  | { kind: 'tools'; key: string; count: number; files: TouchedFile[] };

/** Right-edge timeline minimap (Focus layout). A hairline vertical track with
 *  one proportionally-placed dot per message turn — accent-coloured & larger for
 *  Claude/agent turns, muted & small for user turns. Labels surface on hover only
 *  so the chrome stays out of the way; click jumps, active dot is emphasised.
 *
 *  Adaptive ruler: the track height is measured live, so when a session has many
 *  turns the per-dot spacing shrinks. Dot diameters and accent/active rings scale
 *  with that spacing (one dot per turn is always kept) — at high density the rail
 *  reads as a fine, evenly-gapped ruler instead of a crowded blob; at low density
 *  the dots stay full-size. */
function FocusMinimap({
  items,
  active,
  matches,
  onJump,
}: {
  items: MinimapItem[];
  active: number | null;
  matches: (d: TurnDescriptor) => boolean;
  onJump: (n: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [trackH, setTrackH] = useState(0);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => setTrackH(entries[0].contentRect.height));
    ro.observe(el);
    setTrackH(el.getBoundingClientRect().height);
    return () => ro.disconnect();
  }, []);

  if (items.length === 0) return null;

  // Density factor t: 0 = cramped, 1 = roomy. The threshold is the *effective*
  // dot width including its ring — a full accent dot is 9px + 3px ring/side = 15px,
  // so we only reach full size once the gap clears ~18px; below that, dots and
  // rings shrink so a visible gap always remains. Until the track is measured we
  // assume roomy so dots never flash tiny on first paint.
  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
  const spacing = trackH > 0 && items.length > 1 ? trackH / (items.length - 1) : Infinity;
  const t = clamp01((spacing - 3) / (18 - 3));
  const lerp = (a: number, b: number, f = t) => +(a + (b - a) * f).toFixed(2);
  // Rings are the main source of the "solid blob": only fade them in once the
  // track is genuinely roomy (t > 0.5), so dense views stay ring-free dots.
  const tr = clamp01((t - 0.5) * 2);
  const railVars = {
    '--dot': `${lerp(2, 7)}px`,
    '--dot-accent': `${lerp(2.5, 9)}px`,
    '--dot-active': `${lerp(7, 11)}px`, // floored at 7px so the cursor stays legible
    '--ring': `${lerp(0, 3, tr)}px`,
    '--ring-active': `${lerp(1, 3, tr)}px`,
  } as CSSProperties;

  return (
    <nav className="cl-focus-rail" aria-label="Turn index">
      <div ref={trackRef} className="cl-focus-rail-track" style={railVars}>
        {items.map((it, i) => {
          const top = items.length <= 1 ? 50 : (i / (items.length - 1)) * 100;
          return (
            <button
              key={it.n}
              type="button"
              className="cl-focus-dot"
              style={{ top: `${top}%`, '--c': it.color } as CSSProperties}
              data-accent={it.variant !== 'user' || undefined}
              data-active={active === it.n || undefined}
              data-dim={!matches(it) || undefined}
              onClick={() => onJump(it.n)}
              title={`${String(it.n).padStart(2, '0')} · ${it.label} · ${it.time}`}
              aria-label={`Jump to turn ${it.n}, ${it.label}`}
            >
              <span className="lbl">
                {String(it.n).padStart(2, '0')} {it.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/** Inline style that paints an orb with a sub-agent's identity color, falling
 *  back to the default violet (handled in CSS) when the agent has no color. */
function orbStyle(color?: string): CSSProperties {
  return color ? ({ '--orb-color': color } as CSSProperties) : {};
}

/** Overlapping avatar cluster shown on the footer agent dock — the collapsed
 *  representation of every sub-agent this session spawned. Caps at four orbs and
 *  spills the remainder into a "+N" chip so a busy session stays compact. Each
 *  orb wears its sub-agent's identity color. */
function AgentOrbCluster({
  agents,
  colorOf,
}: {
  agents: SessionAgent[];
  colorOf: (agent: SessionAgent) => string | undefined;
}) {
  const shown = agents.slice(0, 4);
  const overflow = agents.length - shown.length;
  return (
    <span className="cl-dock-orbs">
      {shown.map((a, i) => (
        <span
          key={a.key}
          className="cl-dock-orb"
          style={{ zIndex: shown.length - i, ...orbStyle(colorOf(a)) }}
        >
          {(a.subagentType?.[0] ?? 'A').toUpperCase()}
        </span>
      ))}
      {overflow > 0 && (
        <span className="cl-dock-orb cl-dock-orb--more" style={{ zIndex: 0 }}>
          +{overflow}
        </span>
      )}
    </span>
  );
}

/** Skill counterpart of AgentOrbCluster — overlapping first-letter orbs (all in
 *  the brand accent, skills carry no per-identity color) for the footer dock. */
function SkillOrbCluster({ skills }: { skills: SessionSkill[] }) {
  const shown = skills.slice(0, 4);
  const overflow = skills.length - shown.length;
  return (
    <span className="cl-dock-orbs">
      {shown.map((s, i) => (
        <span
          key={s.key}
          className="cl-dock-orb"
          style={{ zIndex: shown.length - i, ...orbStyle('var(--cl-accent)') }}
        >
          {skillInitial(s.name)}
        </span>
      ))}
      {overflow > 0 && (
        <span className="cl-dock-orb cl-dock-orb--more" style={{ zIndex: 0 }}>
          +{overflow}
        </span>
      )}
    </span>
  );
}

/** The skill dock sheet — sibling of AgentDockSheet. Lists every skill invoked in
 *  the session; a row deep-links to the skill detail when the definition resolves,
 *  otherwise it just locates the invocation in the transcript. The locate button
 *  always jumps to the invocation card. */
function SkillDockSheet({
  skills,
  activeKey,
  onOpen,
  onLocate,
}: {
  skills: SessionSkill[];
  activeKey: string | null;
  onOpen: (skill: Skill) => void;
  onLocate: (turnN: number) => void;
}) {
  return (
    <div className="cl-sheet cl-sheet--agents" role="menu">
      <div className="cl-sheet-head">
        <span className="cl-dock-sheet-label">Skills used · {skills.length}</span>
      </div>
      <div className="cl-dock-rows">
        {skills.map(s => {
          const canOpen = s.skill !== null;
          return (
            <div key={s.key} className="cl-dock-row" data-active={activeKey === s.key || undefined}>
              <button
                type="button"
                className="cl-dock-row-main"
                onClick={() => (canOpen ? onOpen(s.skill!) : onLocate(s.turnN))}
                title={canOpen ? 'View skill' : 'Locate invocation in chat'}
              >
                <span className="orb" aria-hidden style={orbStyle('var(--cl-accent)')}>
                  {skillInitial(s.name)}
                </span>
                <span className="body">
                  <span className="r1">
                    <span className="name">{s.name}</span>
                    {s.scope && <span className="status">{s.scope}</span>}
                  </span>
                  {s.description && <span className="desc">{s.description}</span>}
                  {!canOpen && (
                    <span className="meta">
                      <span className="steps">no definition</span>
                    </span>
                  )}
                </span>
              </button>
              <button
                type="button"
                className="cl-dock-row-locate"
                onClick={() => onLocate(s.turnN)}
                title="Jump to invocation in chat"
                aria-label="Jump to invocation in chat"
              >
                <LocateGlyph />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The agent dock that lives inside the control pill (Focus layout, variant 4):
 *  an overlapping avatar cluster + count that toggles a sheet listing every
 *  sub-agent. The sheet is rendered by ChatControlPill above the pill; this just
 *  owns the trigger and the row list. Replaces the old right-hand AgentRail so
 *  the transcript keeps the full width. */
function AgentDockSheet({
  agents,
  activeKey,
  colorOf,
  onOpen,
  onLocate,
}: {
  agents: SessionAgent[];
  activeKey: string | null;
  colorOf: (agent: SessionAgent) => string | undefined;
  onOpen: (agent: SessionAgent) => void;
  onLocate: (turnN: number) => void;
}) {
  const failed = agents.filter(a => a.isError).length;
  return (
    <div className="cl-sheet cl-sheet--agents" role="menu">
      <div className="cl-sheet-head">
        <span className="cl-dock-sheet-label">
          Agents used · {agents.length}
          {failed > 0 && <em className="cl-dock-sheet-fail"> · {failed} failed</em>}
        </span>
      </div>
      <div className="cl-dock-rows">
        {agents.map(a => {
          const span = fmtAgentSpan(a.startedAt, a.endedAt);
          const hasTranscript = a.agentId !== null;
          return (
            <div
              key={a.key}
              className="cl-dock-row"
              data-active={activeKey === a.key || undefined}
              data-error={a.isError || undefined}
            >
              <button
                type="button"
                className="cl-dock-row-main"
                onClick={() => (hasTranscript ? onOpen(a) : onLocate(a.turnN))}
                title={hasTranscript ? 'View agent transcript' : 'Locate dispatch in chat'}
              >
                <span className="orb" aria-hidden style={orbStyle(colorOf(a))}>
                  {(a.subagentType?.[0] ?? 'A').toUpperCase()}
                </span>
                <span className="body">
                  <span className="r1">
                    <span className="name">{a.subagentType}</span>
                    <span className="status">{a.isError ? 'failed' : 'done'}</span>
                  </span>
                  {a.description && <span className="desc">{a.description}</span>}
                  <span className="meta">
                    {a.startedAt && (
                      <span className="time">
                        {fmtAgentClock(a.startedAt)}
                        {span && <> · {span}</>}
                      </span>
                    )}
                    {typeof a.messageCount === 'number' && (
                      <span className="steps">{a.messageCount} steps</span>
                    )}
                    {!hasTranscript && <span className="steps">no transcript</span>}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="cl-dock-row-locate"
                onClick={() => onLocate(a.turnN)}
                title="Jump to dispatch in chat"
                aria-label="Jump to dispatch in chat"
              >
                <LocateGlyph />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Floating glass control pill (Focus layout) — bottom-centre. Holds the
 *  transcript filters + density toggle (chat mode only), the agent dock, and a
 *  "more" trigger that raises the export / delete sheet above the pill. Only
 *  one sheet (agents or export) is open at a time. */
function ChatControlPill({
  showTranscriptControls,
  filter,
  setFilter,
  counts,
  showThinking,
  density,
  setDensity,
  canExport,
  exporting,
  exportPreset,
  exportMessage,
  exportError,
  selectedExportPreset,
  onOpenSheet,
  onExportPreset,
  onExport,
  onDelete,
  agents,
  activeAgentKey,
  agentColorOf,
  onOpenAgent,
  onLocateAgent,
  skills,
  activeSkillKey,
  onOpenSkill,
  onLocateSkill,
}: {
  showTranscriptControls: boolean;
  filter: TurnFilter;
  setFilter: (f: TurnFilter) => void;
  counts: { all: number; tools: number; thinking: number; questions: number; plan: number };
  showThinking: boolean;
  density: ChatDetailsFilter;
  setDensity: (d: ChatDetailsFilter) => void;
  canExport: boolean;
  exporting: ChatExportFormat | null;
  exportPreset: ChatExportPreset;
  exportMessage: string | null;
  exportError: string | null;
  selectedExportPreset: (typeof CHAT_EXPORT_PRESETS)[number];
  onOpenSheet: () => void;
  onExportPreset: (preset: ChatExportPreset) => void;
  onExport: (format: ChatExportFormat) => void;
  onDelete: () => void;
  agents: SessionAgent[];
  activeAgentKey: string | null;
  agentColorOf: (agent: SessionAgent) => string | undefined;
  onOpenAgent: (agent: SessionAgent) => void;
  onLocateAgent: (turnN: number) => void;
  skills: SessionSkill[];
  activeSkillKey: string | null;
  onOpenSkill: (skill: Skill) => void;
  onLocateSkill: (turnN: number) => void;
}) {
  // Only one sheet is raised above the pill at a time: the agent dock list, the
  // skill dock list, or the export/delete menu.
  const [sheet, setSheet] = useState<'export' | 'agents' | 'skills' | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!sheet) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setSheet(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [sheet]);

  const toggleExport = () => {
    setSheet(s => {
      const next = s === 'export' ? null : 'export';
      if (next === 'export') onOpenSheet();
      return next;
    });
  };
  const toggleAgents = () => setSheet(s => (s === 'agents' ? null : 'agents'));
  const toggleSkills = () => setSheet(s => (s === 'skills' ? null : 'skills'));

  const chip = (id: TurnFilter, label: string, c: number) => (
    <button
      key={id}
      type="button"
      className="cl-pill-filter"
      data-on={filter === id || undefined}
      onClick={() => setFilter(filter === id ? 'all' : id)}
    >
      {label}
      <b>{c}</b>
    </button>
  );

  return (
    <div className="cl-pill-wrap" ref={rootRef}>
      {sheet === 'agents' && agents.length > 0 && (
        <AgentDockSheet
          agents={agents}
          activeKey={activeAgentKey}
          colorOf={agentColorOf}
          onOpen={agent => {
            setSheet(null);
            onOpenAgent(agent);
          }}
          onLocate={turnN => {
            setSheet(null);
            onLocateAgent(turnN);
          }}
        />
      )}
      {sheet === 'skills' && skills.length > 0 && (
        <SkillDockSheet
          skills={skills}
          activeKey={activeSkillKey}
          onOpen={skill => {
            setSheet(null);
            onOpenSkill(skill);
          }}
          onLocate={turnN => {
            setSheet(null);
            onLocateSkill(turnN);
          }}
        />
      )}
      {sheet === 'export' && (
        <div className="cl-sheet" role="menu">
          <div className="cl-sheet-head">
            <span className="cl-export-label">Export</span>
            <button
              type="button"
              className="cl-sheet-close"
              aria-label="Close"
              onClick={() => setSheet(null)}
            >
              ✕
            </button>
          </div>
          <div className="cl-export-presets">
            {CHAT_EXPORT_PRESETS.map(preset => (
              <button
                key={preset.value}
                type="button"
                className={exportPreset === preset.value ? 'is-active' : ''}
                onClick={() => onExportPreset(preset.value)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <p className="cl-export-desc">{selectedExportPreset.description}</p>
          <div className="cl-export-actions">
            <button
              type="button"
              disabled={!canExport || exporting !== null}
              onClick={() => onExport('markdown')}
            >
              {exporting === 'markdown' ? 'Saving...' : 'Markdown'}
            </button>
            <button
              type="button"
              disabled={!canExport || exporting !== null}
              onClick={() => onExport('pdf')}
            >
              {exporting === 'pdf' ? 'Saving...' : 'PDF'}
            </button>
          </div>
          {exportMessage && <p className="cl-export-status is-ok">{exportMessage}</p>}
          {exportError && <p className="cl-export-status is-error">{exportError}</p>}
          <div className="cl-sheet-sep" />
          <button
            type="button"
            role="menuitem"
            className="cl-sheet-item is-danger"
            onClick={() => {
              setSheet(null);
              onDelete();
            }}
          >
            <TrashGlyph />
            <span>Delete session</span>
          </button>
        </div>
      )}

      <div className="cl-pill" role="toolbar" aria-label="Transcript controls">
        {showTranscriptControls && (
          <>
            <div className="cl-pill-filters" role="group" aria-label="Filter turns by type">
              {chip('all', 'All', counts.all)}
              {counts.tools > 0 && chip('tools', 'Tools', counts.tools)}
              {showThinking && counts.thinking > 0 && chip('thinking', 'Thinking', counts.thinking)}
              {counts.questions > 0 && chip('questions', 'Questions', counts.questions)}
              {counts.plan > 0 && chip('plan', 'Plan', counts.plan)}
            </div>
            <span className="cl-pill-div" />
            <div className="cl-seg" aria-label="Transcript detail">
              {(['minimal', 'all'] as ChatDetailsFilter[]).map(v => (
                <button
                  key={v}
                  type="button"
                  className={density === v ? 'on' : ''}
                  onClick={() => setDensity(v)}
                >
                  {v === 'minimal' ? 'Min' : 'Full'}
                </button>
              ))}
            </div>
            <span className="cl-pill-div" />
          </>
        )}
        {agents.length > 0 && (
          <>
            <button
              type="button"
              className="cl-pill-dock"
              aria-haspopup="menu"
              aria-expanded={sheet === 'agents'}
              data-on={sheet === 'agents' || undefined}
              title={`${agents.length} sub-agent${agents.length > 1 ? 's' : ''} used`}
              onClick={toggleAgents}
            >
              <AgentOrbCluster agents={agents} colorOf={agentColorOf} />
              <span className="cl-dock-count">
                {agents.length} <span>agents</span>
              </span>
              {agents.some(a => a.isError) && <span className="cl-dock-fail" aria-hidden />}
              <DockCaretGlyph open={sheet === 'agents'} />
            </button>
            <span className="cl-pill-div" />
          </>
        )}
        {skills.length > 0 && (
          <>
            <button
              type="button"
              className="cl-pill-dock"
              aria-haspopup="menu"
              aria-expanded={sheet === 'skills'}
              data-on={sheet === 'skills' || undefined}
              title={`${skills.length} skill${skills.length > 1 ? 's' : ''} used`}
              onClick={toggleSkills}
            >
              <SkillOrbCluster skills={skills} />
              <span className="cl-dock-count">
                {skills.length} <span>skills</span>
              </span>
              <DockCaretGlyph open={sheet === 'skills'} />
            </button>
            <span className="cl-pill-div" />
          </>
        )}
        <button
          type="button"
          className="cl-pill-more"
          aria-haspopup="menu"
          aria-expanded={sheet === 'export'}
          data-on={sheet === 'export' || undefined}
          title="Export & more"
          onClick={toggleExport}
        >
          <ChevronUpGlyph />
        </button>
      </div>
    </div>
  );
}

/** Provisional assistant turn shown while the SDK streams the reply. Mirrors the
 *  real assistant-turn markup (`cl-turn--claude`) so the live text appears inline
 *  in the reading column, exactly where the final message will render once the
 *  turn closes and the transcript refetches. Plain text + a blinking caret keeps
 *  the typing feel without mid-stream markdown reflow. While a tool call's input
 *  is being generated or the tool runs (`tool`), no text streams — the caret
 *  gives way to a "Using X…" chip (with the elapsed time once the SDK reports
 *  `tool_progress` heartbeats). */
export function LiveTurn({
  text,
  tool,
  turnNumber,
}: {
  text: string;
  tool?: ToolActivity | null;
  turnNumber: number;
}) {
  return (
    <article className="cl-turn cl-turn--claude cl-turn--live" aria-live="polite">
      <aside className="cl-turn-rail">
        <span className="cl-turn-orb">C</span>
        <span className="cl-turn-index">{String(turnNumber).padStart(2, '0')}</span>
        <span className="cl-turn-spine" aria-hidden />
      </aside>
      <section className="cl-turn-body">
        <header className="cl-turn-head">
          <span className="cl-turn-who">Claude</span>
          <span className="cl-turn-sep">·</span>
          <time>{tool ? 'working…' : text ? 'responding…' : 'thinking…'}</time>
        </header>
        <div className="cl-turn-content">
          <div className="cl-message-text cl-message-text--assistant cl-live-text">
            {text && <Markdown>{text}</Markdown>}
            {tool ? (
              <span className="cl-live-tool">
                <span className="dot" aria-hidden />
                Using <b>{tool.toolName}</b>
                {tool.elapsedSeconds != null && (
                  <span className="s">· {Math.round(tool.elapsedSeconds)}s</span>
                )}
              </span>
            ) : (
              <span className="cl-live-caret" aria-hidden />
            )}
          </div>
        </div>
      </section>
    </article>
  );
}

// The bare command name from a slash prompt the user sent (e.g. "/context …" →
// "context"); null when the prompt isn't a slash command.
function slashCommandOf(prompt: string): string | null {
  const m = /^\/([\w:-]+)/.exec(prompt.trim());
  return m ? m[1] : null;
}

// The bare command name from a persisted command-card user message (the message
// Claude Code writes as `<command-name>/context</command-name> …`); null otherwise.
function cardCommandOf(msg: ChatMessage): string | null {
  if (msg.role !== 'user') return null;
  const text = msg.content.find(b => b.type === 'text');
  if (!text || text.type !== 'text') return null;
  const m = /<command-name>\s*\/?\s*([\w:-]+)\s*<\/command-name>/.exec(text.text);
  return m ? m[1] : null;
}

export function ChatView({
  project,
  session,
  onBack,
  onOpenSkill,
  onOpenAgent,
}: {
  project: { hash: string; realPath: string };
  session: SessionSummary;
  onBack: () => void;
  /** Deep-link to a skill detail view (from an inline skill card or the dock). */
  onOpenSkill?: (skill: Skill) => void;
  /** Deep-link to an agent detail view (from an inline agent card). */
  onOpenAgent?: (agent: Agent) => void;
}) {
  const {
    data: messages,
    isLoading,
    isError,
    error,
    refetch,
  } = useChatSession(project.hash, session.filename);
  const { data: subagentMetas } = useSessionSubagents(project.hash, session.filename);
  const { data: globalAgents } = useGlobalAgents();
  const { data: projectAgents } = useProjectAgents(project.realPath);
  const { data: allSkills } = useAllSkills(project.realPath);

  // Resolve a dispatched sub-agent's identity color from its definition
  // (`subagent_type` → agent.color). Project agents win over globals on name
  // clash. Returns undefined when the agent is unknown or has no color, so the
  // cards fall back to their default tint.
  const agentColorOf = useMemo(() => {
    const byName = new Map<string, string>();
    for (const a of globalAgents ?? []) if (a.color) byName.set(a.name, a.color);
    for (const a of projectAgents ?? []) if (a.color) byName.set(a.name, a.color);
    return (subagentType: string) => byName.get(subagentType);
  }, [globalAgents, projectAgents]);

  // Resolve a sub-agent's full definition by name (project wins on clash) so an
  // expanded agent card can deep-link to its detail view.
  const agentOf = useMemo(() => {
    const byName = new Map<string, Agent>();
    for (const a of globalAgents ?? []) byName.set(a.name, a);
    for (const a of projectAgents ?? []) byName.set(a.name, a);
    return (subagentType: string) => byName.get(subagentType);
  }, [globalAgents, projectAgents]);

  // Resolve a skill's full definition by name (the slash-command id) — feeds both
  // the inline skill card link and the footer skill dock.
  const skillOf = useMemo(() => {
    const byName = new Map<string, Skill>();
    for (const s of allSkills ?? []) byName.set(s.name, s);
    return (name: string) => byName.get(name);
  }, [allSkills]);
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  const [detailsFilter, setDetailsFilter] = useState<ChatDetailsFilter>('minimal');
  const [selectedTool, setSelectedTool] = useState<ToolGroup | null>(null);
  const [transcriptAgent, setTranscriptAgent] = useState<SessionAgent | null>(null);
  const [exportPreset, setExportPreset] = useState<ChatExportPreset>('team');
  const [exporting, setExporting] = useState<ChatExportFormat | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  // Live streaming, lifted from the composer: the assistant's partial reply is
  // rendered inline as a provisional turn at the foot of the transcript (where the
  // final message will land), instead of a detached preview strip in the composer.
  const [liveText, setLiveText] = useState('');
  const [streaming, setStreaming] = useState(false);
  // The tool currently being prepared/executed in the live turn (null = none).
  const [liveTool, setLiveTool] = useState<ToolActivity | null>(null);
  // In-flight turn rendering, driven entirely from the SDK stream (not a
  // mid-stream disk re-read). When a turn is active (`pendingUser !== null`) we
  // render the transcript from: the pre-turn history snapshot (`frozenMessages`),
  // an optimistic bubble for the prompt (`pendingUser`), and the fully-formed
  // messages the SDK emits as it works (`liveMessages` — assistant turns + tool
  // results). The file watcher still refetches `messages` in the background, but
  // we ignore it for display until the turn closes, so the persisted reply can't
  // double the live one. On completion we reconcile to the canonical disk read.
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [pendingAt, setPendingAt] = useState('');
  const pendingBaseCount = useRef(0);
  const [frozenMessages, setFrozenMessages] = useState<ChatMessage[] | null>(null);
  const [liveMessages, setLiveMessages] = useState<ChatMessage[]>([]);
  // Real output of built-in slash commands (/context, /usage, /compact, …) is
  // streamed live as a `<synthetic>`-model assistant message but never persisted —
  // Claude Code writes only a placeholder we filter out (session-reader). To keep
  // it on screen after we reconcile to the disk read, we pin each turn's synthetic
  // output keyed by the UUID of the on-disk command-card that produced it, bound
  // at reconcile time (when that card is on disk), and weave it back in right
  // after that exact card. Keying by card UUID — not command name + positional
  // consumption — means repeated calls and pre-existing cards never misalign the
  // output. Lives only while this view is mounted (the data isn't on disk).
  const [pinnedSlash, setPinnedSlash] = useState<Record<string, ChatMessage[]>>({});

  // Lift live messages from the composer. The synthetic slash-command output they
  // may carry is pinned later, at reconcile time, when the command-card it belongs
  // to is on disk and can be addressed by UUID (see the reconcile effect below).
  const handleLiveMessages = useCallback((msgs: ChatMessage[]) => {
    setLiveMessages(msgs);
  }, []);
  const [turnFilter, setTurnFilter] = useState<TurnFilter>('all');
  const [activeTurn, setActiveTurn] = useState<number | null>(null);
  const turnRefs = useRef<Record<number, HTMLElement | null>>({});
  // Bottom-pinning scroll: open at the bottom, follow every content growth
  // (stream, tool cards, density, late reflows) while anchored, detach on user
  // scroll-up, re-attach near the bottom — see useAutoScroll.ts.
  const {
    feedRef,
    innerRef: transcriptInnerRef,
    followRef,
    pin,
    onScroll: onFeedScroll,
    onWheel: onFeedWheel,
  } = useChatAutoScroll(session.filename);
  // Ref mirror of activeTurn so the density-change layout effect can read
  // the current turn without listing activeTurn as a dependency (which would
  // cause it to fire on every scroll-spy update, fighting user scrolling).
  const activeTurnRef = useRef<number | null>(null);

  // Reconcile to the canonical disk read once the turn has ended AND the refetch
  // contains it (length grew past the count captured at send time). We gate on
  // `!streaming` so background mid-stream refetches never tear down the live turn.
  // When both hold, the persisted transcript already has the full turn, so
  // dropping the optimistic state is seamless.
  useEffect(() => {
    if (streaming) return;
    if (pendingUser === null) return;
    if ((messages?.length ?? 0) > pendingBaseCount.current) {
      // If the just-finished turn was a built-in slash command, its real output
      // streamed as `<synthetic>` messages that Claude Code never persists. Bind
      // them to the command-card now on disk so they survive the reconcile,
      // anchored under the exact card that produced them. The card we just created
      // is the last command-card matching this command name.
      const cmd = slashCommandOf(pendingUser);
      const synth = cmd ? liveMessages.filter(m => m.model === '<synthetic>') : [];
      if (cmd && synth.length) {
        const base = messages ?? [];
        let cardUuid: string | null = null;
        for (let i = base.length - 1; i >= 0; i--) {
          if (cardCommandOf(base[i]) === cmd) {
            cardUuid = base[i].uuid;
            break;
          }
        }
        if (cardUuid) {
          const key = cardUuid;
          // Reconcile-time state sync (the turn just landed on disk), not a render
          // loop: pin once, guarded by the existing key.
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setPinnedSlash(prev => (prev[key] ? prev : { ...prev, [key]: synth }));
        }
      }
      setPendingUser(null);
      setFrozenMessages(null);
      setLiveMessages([]);
    }
  }, [streaming, messages, pendingUser, liveMessages]);

  // The messages actually rendered. Idle: the live disk transcript. In-flight: the
  // pre-turn snapshot + an optimistic prompt bubble + the streamed messages —
  // assembled here and run through the SAME processing pipeline as history, so
  // tools/thinking render live and correctly structured. Both branches weave the
  // pinned slash-command output back in right after the command-card that
  // produced it (addressed by that card's UUID, set at reconcile time), so a
  // pinned `/context` doesn't vanish for the duration of the next turn.
  const displayMessages = useMemo<ChatMessage[]>(() => {
    const weave = (base: ChatMessage[]): ChatMessage[] => {
      if (Object.keys(pinnedSlash).length === 0) return base;
      const woven: ChatMessage[] = [];
      for (const m of base) {
        woven.push(m);
        const pinned = pinnedSlash[m.uuid];
        if (pinned) woven.push(...pinned);
      }
      return woven;
    };
    if (pendingUser === null) return weave(messages ?? []);
    const synthetic: ChatMessage = {
      uuid: '__pending_user__',
      role: 'user',
      timestamp: pendingAt,
      content: [{ type: 'text', text: pendingUser }],
    };
    return [...weave(frozenMessages ?? messages ?? []), synthetic, ...liveMessages];
  }, [pendingUser, pendingAt, frozenMessages, messages, liveMessages, pinnedSlash]);

  // Heavy: rebuild the processed transcript only when the displayed messages change.
  const processed = useMemo(() => buildProcessedMessages(displayMessages), [displayMessages]);
  const canExport = processed.length > 0 && !isLoading;

  // Model the session is already on — its last assistant turn that recorded one.
  // The composer reuses it so a reply from ClaudeLens stays on the same model the
  // chat was using; undefined falls back to the configured default. `<synthetic>`
  // turns (persisted local-command output) aren't a real model — sending that
  // string as a model id would error, so skip past them.
  const inheritedModel = useMemo(() => {
    for (let i = (messages?.length ?? 0) - 1; i >= 0; i--) {
      const m = messages![i];
      if (m.role === 'assistant' && m.model && m.model !== '<synthetic>') return m.model;
    }
    return undefined;
  }, [messages]);

  const sessionId = useMemo(() => session.filename.replace(/\.jsonl$/, ''), [session.filename]);

  // Live in a terminal right now? (Active-sessions registry; SDK-spawned
  // sessions — including this view's own composer — are excluded from it.)
  const { data: activeSessions = [] } = useActiveSessions();
  const liveInTerminal = activeSessions.some(a => a.sessionId === sessionId);

  // Sub-agents dispatched in this session, correlated to their internal
  // transcript files. Drives the right-hand activity rail.
  const agents = useMemo(
    () => correlateSessionAgents(processed, subagentMetas ?? []),
    [processed, subagentMetas]
  );

  // Skills invoked in this session, linked to their definitions — drives the
  // footer skill dock (sibling of the agent dock).
  const skills = useMemo(
    () => correlateSessionSkills(processed, allSkills ?? []),
    [processed, allSkills]
  );

  // The detail filter (Minimal/Full) drives which turns are visible — Minimal
  // hides thinking/tools — so the navigation descriptors depend on it too.
  const descriptors = useMemo(
    () => processed.map(p => describeTurn(p, detailsFilter, t => agentTintColor(agentColorOf(t)))),
    [processed, detailsFilter, agentColorOf]
  );
  const fmtTurnTime = useCallback(
    (ts: string | undefined) =>
      ts
        ? new Date(ts).toLocaleTimeString('it-IT', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
          })
        : '',
    []
  );
  // Every turn that renders something — drives the type-filter counts so
  // "Tools" still reflects the collapsed tool-only turns.
  const visibleItems = useMemo<MinimapItem[]>(
    () =>
      descriptors
        .map((d, i) => ({ ...d, n: i + 1, time: fmtTurnTime(processed[i]?.msg.timestamp) }))
        .filter(d => d.visible),
    [descriptors, processed, fmtTurnTime]
  );
  // The navigation rail shows one dot per *message* turn: tool-only turns
  // collapse into a single in-stream badge, so they don't earn a dot.
  const minimapItems = useMemo(() => visibleItems.filter(d => !d.toolsOnly), [visibleItems]);
  // Collapse runs of consecutive tool-only turns into one badge. Non-rendering
  // turns are skipped without breaking a run (nothing shows between them).
  const renderItems = useMemo<RenderItem[]>(() => {
    const items: RenderItem[] = [];
    let run: { count: number; firstIdx: number; files: TouchedFile[] } | null = null;
    const flush = () => {
      if (run) {
        items.push({
          kind: 'tools',
          key: `tools-${run.firstIdx}`,
          count: run.count,
          files: run.files,
        });
        run = null;
      }
    };
    descriptors.forEach((d, idx) => {
      if (d.toolsOnly) {
        // toolsOnly guarantees the turn holds only standard tools (no question/agent).
        const groups = processed[idx].toolGroups;
        const files = touchedFiles(groups);
        if (run) {
          run.count += groups.length;
          run.files.push(...files);
        } else run = { count: groups.length, firstIdx: idx, files };
      } else if (d.visible) {
        flush();
        items.push({ kind: 'turn', idx });
      }
    });
    flush();
    return items;
  }, [processed, descriptors]);

  const filterCounts = useMemo(
    () => ({
      all: visibleItems.length,
      tools: visibleItems.filter(d => d.hasTools).length,
      thinking: visibleItems.filter(d => d.hasThinking).length,
      questions: visibleItems.filter(d => d.hasQuestion).length,
      plan: visibleItems.filter(d => d.hasPlan).length,
    }),
    [visibleItems]
  );

  // Derived (not stored) so it can never get stuck: the active filter falls back
  // to "All" when it no longer has matching turns — e.g. Thinking in minimal
  // mode, or any chip that just dropped to 0 (and is now hidden) — otherwise the
  // transcript would stay fully dimmed with no way back.
  const activeFilter: TurnFilter =
    turnFilter !== 'all' &&
    ((turnFilter === 'thinking' && detailsFilter === 'minimal') || filterCounts[turnFilter] === 0)
      ? 'all'
      : turnFilter;

  // Per-turn match against the active type filter (non-matching turns are dimmed,
  // never removed, so the conversation thread stays continuous).
  const matchesFilter = useCallback(
    (d: TurnDescriptor) => {
      switch (activeFilter) {
        case 'tools':
          return d.hasTools;
        case 'thinking':
          return d.hasThinking && detailsFilter === 'all';
        case 'questions':
          return d.hasQuestion;
        case 'plan':
          return d.hasPlan;
        default:
          return true;
      }
    },
    [activeFilter, detailsFilter]
  );

  // Stable ref setter (keyed by the turn's data-n) so MessageBubble's memo holds.
  const setTurnRef = useCallback((el: HTMLElement | null) => {
    const n = el?.dataset.n;
    if (el && n) turnRefs.current[Number(n)] = el;
  }, []);

  // Scroll-spy: highlight the turn nearest the viewport centre.
  useEffect(() => {
    const root = feedRef.current;
    if (!root || minimapItems.length === 0) return;
    setActiveTurn(prev => prev ?? minimapItems[0].n);
    const io = new IntersectionObserver(
      entries => {
        entries.forEach(e => {
          if (e.isIntersecting) setActiveTurn(Number((e.target as HTMLElement).dataset.n));
        });
      },
      { root, rootMargin: '-45% 0px -45% 0px', threshold: 0 }
    );
    Object.values(turnRefs.current).forEach(el => el && io.observe(el));
    return () => io.disconnect();
  }, [minimapItems, viewMode, feedRef]);

  // Keep activeTurnRef in sync so layout effects can read it without deps.
  useEffect(() => {
    activeTurnRef.current = activeTurn;
  }, [activeTurn]);

  // Anchor the feed after a density change: if anchored to the bottom, snap
  // back to bottom; otherwise keep the scroll-spy turn in view. useLayoutEffect
  // fires after DOM mutations but before paint, so the corrected position never
  // flashes.
  useLayoutEffect(() => {
    if (followRef.current) {
      pin();
    } else {
      const turn = activeTurnRef.current;
      if (turn !== null) turnRefs.current[turn]?.scrollIntoView({ block: 'nearest' });
    }
  }, [detailsFilter, followRef, pin]);

  // The feed hides (display:none) behind overlays (tool detail, sub-agent
  // transcript) and in Timeline mode — it stays mounted so the composer keeps
  // the SDK session alive, but a hidden scroller collapses and loses its scroll
  // offset anyway. On return, an anchored view is re-pinned by the resize
  // observer; a detached one gets its active turn back instead of silently
  // restarting at the top.
  useLayoutEffect(() => {
    if (selectedTool || transcriptAgent || viewMode !== 'chat') return;
    if (!followRef.current) {
      const turn = activeTurnRef.current;
      if (turn !== null) turnRefs.current[turn]?.scrollIntoView({ block: 'start' });
    }
  }, [selectedTool, transcriptAgent, viewMode, followRef]);

  const jumpToTurn = useCallback((n: number) => {
    const el = turnRefs.current[n];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveTurn(n);
  }, []);

  // The rail's "active" agent = the latest dispatch at or above the current
  // scroll position. As you scroll past one agent's card toward the next, the
  // highlight advances — the recorded-session echo of Claude Code's live pill.
  const activeAgentKey = useMemo(() => {
    if (agents.length === 0) return null;
    if (activeTurn === null) return agents[0].key;
    let key: string | null = null;
    for (const a of agents) {
      if (a.turnN <= activeTurn) key = a.key;
      else break;
    }
    return key ?? agents[0].key;
  }, [agents, activeTurn]);

  const activeSkillKey = useMemo(() => {
    if (skills.length === 0) return null;
    if (activeTurn === null) return skills[0].key;
    let key: string | null = null;
    for (const s of skills) {
      if (s.turnN <= activeTurn) key = s.key;
      else break;
    }
    return key ?? skills[0].key;
  }, [skills, activeTurn]);

  const title = sessionTitle(session);
  const selectedExportPreset =
    CHAT_EXPORT_PRESETS.find(p => p.value === exportPreset) ?? CHAT_EXPORT_PRESETS[0];
  // Whether an overlay / alternate mode is covering the chat workspace. The
  // workspace is then hidden (display:none) but never unmounted — see the
  // comment at the render site.
  const chatHidden =
    Boolean(selectedTool) ||
    Boolean(transcriptAgent && transcriptAgent.agentId) ||
    isError ||
    viewMode !== 'chat';

  async function handleExport(format: ChatExportFormat) {
    if (!canExport) return;
    setExporting(format);
    setExportError(null);
    setExportMessage(null);

    try {
      const doc = buildChatExportDocument({
        projectPath: project.realPath,
        session,
        processed,
        preset: exportPreset,
      });
      const result =
        format === 'markdown'
          ? await saveMarkdownExport(`${doc.defaultBaseName}.md`, doc.markdown)
          : await savePdfExport(`${doc.defaultBaseName}.pdf`, doc.html);

      if (!result.canceled) {
        setExportMessage(
          `Saved ${format === 'markdown' ? 'Markdown' : 'PDF'}${result.filePath ? ` to ${result.filePath}` : ''}`
        );
      }
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(null);
    }
  }

  const controlPill = (showTranscriptControls: boolean) => (
    <ChatControlPill
      showTranscriptControls={showTranscriptControls && processed.length > 0}
      filter={activeFilter}
      setFilter={setTurnFilter}
      counts={filterCounts}
      showThinking={detailsFilter === 'all'}
      density={detailsFilter}
      setDensity={setDetailsFilter}
      canExport={canExport}
      exporting={exporting}
      exportPreset={exportPreset}
      exportMessage={exportMessage}
      exportError={exportError}
      selectedExportPreset={selectedExportPreset}
      onOpenSheet={() => {
        setExportError(null);
        setExportMessage(null);
      }}
      onExportPreset={setExportPreset}
      onExport={handleExport}
      onDelete={() => setShowDelete(true)}
      agents={agents}
      activeAgentKey={activeAgentKey}
      agentColorOf={a => agentTintColor(agentColorOf(a.subagentType))}
      onOpenAgent={setTranscriptAgent}
      onLocateAgent={jumpToTurn}
      skills={skills}
      activeSkillKey={activeSkillKey}
      onOpenSkill={skill => onOpenSkill?.(skill)}
      onLocateSkill={jumpToTurn}
    />
  );

  return (
    <div className="cl-chat">
      <TopBar
        onBack={onBack}
        backLabel="Sessions"
        crumbs={[{ label: title, accent: true }]}
        right={
          <>
            {liveInTerminal && (
              <span
                title="This session is running in your terminal right now"
                className="flex items-center gap-1.5 font-mono uppercase"
                style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--cl-ok)' }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: 'var(--cl-ok)',
                  }}
                />
                Live in terminal
              </span>
            )}
            <div className="cl-view-mode" aria-label="View mode">
              {(['chat', 'timeline'] as ViewMode[]).map(v => (
                <button
                  key={v}
                  type="button"
                  className={viewMode === v ? 'on' : ''}
                  onClick={() => setViewMode(v)}
                  title={
                    v === 'timeline'
                      ? 'Session timeline (swimlanes by file/tool)'
                      : 'Linear transcript'
                  }
                >
                  {v === 'chat' ? 'Chat' : 'Timeline'}
                </button>
              ))}
            </div>
          </>
        }
      />

      {showDelete && (
        <DeleteSessionDialog
          hash={project.hash}
          sessionFilename={session.filename}
          title={title}
          onCancel={() => setShowDelete(false)}
          onDeleted={() => {
            setShowDelete(false);
            onBack();
          }}
        />
      )}

      {/* Overlays and alternate modes visually replace the chat workspace, but
          the workspace below stays MOUNTED (hidden via display:none): the
          composer inside it owns the persistent SDK session and the stream
          listeners, so unmounting it mid-turn would dispose the session and
          silently abort whatever Claude is doing. The composer's dialogs
          (permission requests) render through a portal, so they stay visible
          and answerable even while the workspace is hidden. */}
      {selectedTool ? (
        <ToolDetailPanel group={selectedTool} onBack={() => setSelectedTool(null)} />
      ) : transcriptAgent && transcriptAgent.agentId ? (
        <SubagentTranscriptPanel
          hash={project.hash}
          sessionFilename={session.filename}
          agentId={transcriptAgent.agentId}
          subagentType={transcriptAgent.subagentType}
          description={transcriptAgent.description}
          onBack={() => setTranscriptAgent(null)}
        />
      ) : isError ? (
        <div className="cl-chat-workspace">
          <QueryError title="Failed to load transcript" error={error} onRetry={() => refetch()} />
        </div>
      ) : viewMode === 'timeline' ? (
        <div className="cl-chat-workspace cl-chat-workspace--tl">
          {isLoading ? (
            <p className="cl-transcript-state">Loading transcript…</p>
          ) : (
            <SessionGraphView processed={processed} onSelectTool={setSelectedTool} />
          )}
          {controlPill(false)}
        </div>
      ) : null}

      <div
        className="cl-chat-workspace cl-chat-workspace--focus"
        data-composer
        style={chatHidden ? { display: 'none' } : undefined}
      >
        <main className="cl-chat-feed" ref={feedRef} onScroll={onFeedScroll} onWheel={onFeedWheel}>
          {isLoading && <p className="cl-transcript-state">Loading transcript…</p>}
          {messages?.length === 0 && !isLoading && (
            <p className="cl-transcript-state">No messages found in this session.</p>
          )}

          {processed.length > 0 && (
            <div className="cl-chat-reading">
              <div className="cl-transcript-inner" ref={transcriptInnerRef}>
                {(() => {
                  let prevRole: string | null = null;
                  let pendingHidden = 0;
                  let pendingFiles: TouchedFile[] = [];
                  return renderItems.map(item => {
                    if (item.kind !== 'turn') {
                      prevRole = null;
                      pendingHidden = item.count;
                      pendingFiles = item.files;
                      return null;
                    }
                    const curRole = processed[item.idx].msg.role;
                    const hasText = processed[item.idx].msg.content.some(b => b.type === 'text');
                    const isContinuation =
                      !hasText && curRole === prevRole && curRole === 'assistant';
                    prevRole = curRole;
                    const hiddenToolCount = pendingHidden;
                    const hiddenFiles = pendingFiles;
                    pendingHidden = 0;
                    pendingFiles = [];
                    return (
                      <MessageBubble
                        key={`${item.idx}:${processed[item.idx].msg.uuid}`}
                        processed={processed[item.idx]}
                        detailsFilter={detailsFilter}
                        onOpenToolDetail={setSelectedTool}
                        agentColorOf={agentColorOf}
                        skillOf={skillOf}
                        onOpenSkill={onOpenSkill}
                        agentOf={agentOf}
                        onOpenAgent={onOpenAgent}
                        turnIndex={item.idx + 1}
                        dimmed={
                          activeFilter !== 'all' &&
                          descriptors[item.idx]?.visible &&
                          !matchesFilter(descriptors[item.idx])
                        }
                        isContinuation={isContinuation}
                        innerRef={setTurnRef}
                        hiddenToolCount={hiddenToolCount}
                        hiddenFiles={hiddenFiles}
                      />
                    );
                  });
                })()}
                {streaming &&
                  (liveText !== '' || liveTool !== null || liveMessages.length === 0) && (
                    <LiveTurn text={liveText} tool={liveTool} turnNumber={processed.length + 1} />
                  )}
              </div>
            </div>
          )}
        </main>

        <FocusMinimap
          items={minimapItems}
          active={activeTurn}
          matches={matchesFilter}
          onJump={jumpToTurn}
        />

        {controlPill(true)}

        <ChatComposer
          key={sessionId}
          realPath={project.realPath}
          sessionId={sessionId}
          model={inheritedModel}
          lockNotice={
            liveInTerminal
              ? 'This session is running in your terminal — reply there, or wait for it to end. Replying here would run a parallel turn on Agent SDK credits.'
              : null
          }
          onTurnComplete={refetch}
          onSend={text => {
            pendingBaseCount.current = messages?.length ?? 0;
            setPendingAt(new Date().toISOString());
            setFrozenMessages(messages ?? []);
            setLiveMessages([]);
            setPendingUser(text);
          }}
          onSendFailed={() => {
            // The send never became a turn — roll back the optimistic bubble
            // and the frozen snapshot so the transcript shows the disk truth.
            setPendingUser(null);
            setFrozenMessages(null);
            setLiveMessages([]);
          }}
          onStreamChange={setLiveText}
          onStreamingChange={setStreaming}
          onLiveMessagesChange={handleLiveMessages}
          onLiveToolChange={setLiveTool}
        />
      </div>
    </div>
  );
}
