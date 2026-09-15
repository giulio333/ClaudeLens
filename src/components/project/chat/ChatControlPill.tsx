import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { SessionSummary, Skill } from '../../../hooks/useIPC';
import {
  ChatDetailsFilter,
  ModelRun,
  SessionAgent,
  SessionSkill,
  ToolGroup,
  TurnFilter,
  TurnFilterCounts,
  skillHasViewableOutput,
  skillInitial,
} from './utils';
import { fmtCost, fmtModel, modelColor } from '../utils';
import type { ContextState } from '../terminal/context-window';
import { ContextPopover, SpendPopover } from '../terminal/VitalsPopover';
import { CHAT_EXPORT_PRESETS, ChatExportFormat, ChatExportPreset } from './export';
import {
  ChevronUpGlyph,
  DockCaretGlyph,
  FindGlyph,
  FindStepGlyph,
  LocateGlyph,
  TrashGlyph,
} from './icons';
import { ThoughtLine } from './ThoughtLine';
import { Thought } from './thoughts';

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
  onOpenOutput,
  onLocate,
}: {
  skills: SessionSkill[];
  activeKey: string | null;
  onOpen: (skill: Skill) => void;
  /** Agentic skills (a `Skill` tool_use) open the output they produced. */
  onOpenOutput: (group: ToolGroup) => void;
  onLocate: (turnN: number) => void;
}) {
  return (
    <div className="cl-sheet cl-sheet--agents" role="menu">
      <div className="cl-sheet-head">
        <span className="cl-dock-sheet-label">Skills used · {skills.length}</span>
      </div>
      <div className="cl-dock-rows">
        {skills.map(s => {
          // An agentic skill that produced a real result opens it; a "launch-only"
          // skill (output is just "Launching skill: …") has nothing to show, so it
          // falls through to its definition or a locate, like a slash-command skill.
          const canOpenOutput = skillHasViewableOutput(s.group);
          const canOpenDef = s.skill !== null;
          const title = canOpenOutput
            ? 'View skill output'
            : canOpenDef
              ? 'View skill'
              : 'Locate invocation in chat';
          return (
            <div key={s.key} className="cl-dock-row" data-active={activeKey === s.key || undefined}>
              <button
                type="button"
                className="cl-dock-row-main"
                onClick={() =>
                  canOpenOutput
                    ? onOpenOutput(s.group!)
                    : canOpenDef
                      ? onOpen(s.skill!)
                      : onLocate(s.turnN)
                }
                title={title}
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
                  {!canOpenDef && !canOpenOutput && (
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

/** The model dock sheet — raised when a session did not run on one setting
 *  throughout. One row per run, oldest first, each locating the turn the change
 *  took effect on. Without it the pill's chip would name the current model and
 *  say nothing about the switch that produced it.
 *
 *  A run breaks on the model OR the effort — both change mid-chat, and on this
 *  machine three transcripts change effort with the model standing still — so
 *  what is counted here is runs, and the label must not call them models. */
function ModelDockSheet({
  runs,
  onLocate,
}: {
  runs: ModelRun[];
  onLocate: (turnN: number) => void;
}) {
  return (
    <div className="cl-sheet cl-sheet--agents" role="menu">
      <div className="cl-sheet-head">
        <span className="cl-dock-sheet-label">Model &amp; effort · {runs.length} runs</span>
      </div>
      <div className="cl-dock-rows">
        {runs.map(run => (
          <div key={run.key} className="cl-dock-row">
            <button
              type="button"
              className="cl-dock-row-main"
              onClick={() => onLocate(run.turnN)}
              title="Jump to the first turn on this model"
            >
              <span className="orb" aria-hidden style={orbStyle(modelColor(run.model))}>
                {fmtModel(run.model)[0]}
              </span>
              <span className="body">
                <span className="r1">
                  <span className="name">{fmtModel(run.model)}</span>
                  {run.effort && <span className="status">{run.effort}</span>}
                </span>
                <span className="meta">
                  <span className="steps">
                    from turn {run.turnN} · {run.turns} turn{run.turns === 1 ? '' : 's'}
                  </span>
                </span>
              </span>
            </button>
            <button
              type="button"
              className="cl-dock-row-locate"
              onClick={() => onLocate(run.turnN)}
              title="Jump to the first turn on this model"
              aria-label="Jump to the first turn on this model"
            >
              <LocateGlyph />
            </button>
          </div>
        ))}
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
export function ChatControlPill({
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
  onOpenSheet,
  openExportRef,
  selectionMode,
  selectedCount,
  onToggleSelectionMode,
  onClearSelection,
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
  onOpenSkillOutput,
  onLocateSkill,
  modelRuns,
  onLocateModel,
  vitals,
  changes,
  find,
  thought,
}: {
  showTranscriptControls: boolean;
  filter: TurnFilter;
  setFilter: (f: TurnFilter) => void;
  counts: TurnFilterCounts;
  showThinking: boolean;
  density: ChatDetailsFilter;
  setDensity: (d: ChatDetailsFilter) => void;
  canExport: boolean;
  exporting: ChatExportFormat | null;
  exportPreset: ChatExportPreset;
  exportMessage: string | null;
  exportError: string | null;
  onOpenSheet: () => void;
  /** ChatControlPill registers an imperative "open export sheet" fn here, so the
   *  per-turn export button can raise the sheet from the transcript. */
  openExportRef: { current: (() => void) | null };
  selectionMode: boolean;
  selectedCount: number;
  onToggleSelectionMode: () => void;
  onClearSelection: () => void;
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
  onOpenSkillOutput: (group: ToolGroup) => void;
  onLocateSkill: (turnN: number) => void;
  /** Every model+effort stretch of the transcript, oldest first. The last one is
   *  what the chip prints; more than one is what makes it a dock. */
  modelRuns: ModelRun[];
  onLocateModel: (turnN: number) => void;
  /** Context occupancy and session spend — Mission Control's two headline
   *  figures, which live here whenever this transcript is on screen. `ctx` is
   *  null until a turn has reported usage; the cell prints an em dash rather
   *  than a zero, because "no reading yet" and "empty window" are not the same
   *  claim. Absent altogether (no `vitals`) the two cells simply do not exist —
   *  a host that has no session row to read them off says nothing. */
  vitals?: { ctx: ContextState | null; session: SessionSummary } | null;
  /** What the session did to the working tree: lines added, lines removed, and
   *  how many files carry them. Absent (or all-zero) the cell is not drawn —
   *  a reading session that touched nothing should not print three zeros. */
  changes?: { added: number; removed: number; files: number } | null;
  /** Find-in-transcript. The reading column is windowed, so the browser's own
   *  Ctrl+F sees only the rows around the viewport; this is its replacement and
   *  the pill is where it lives. Navigation is by TURN, not by match — see
   *  `find.ts` for why — so `hits` is how many turns contain the query and
   *  `position` is which of them is being read, 1-based, or 0 before the first
   *  step. Absent, the control is not drawn. */
  find?: {
    query: string;
    setQuery: (q: string) => void;
    hits: number;
    position: number;
    onStep: (direction: 1 | -1) => void;
  } | null;
  /** The sentence currently being narrated, or null when there is nothing to
   *  say. Rendered above the pill; see `ThoughtLine`. */
  thought?: Thought | null;
}) {
  // Only one sheet is raised above the pill at a time: the agent dock list, the
  // skill dock list, or the export/delete menu.
  const [sheet, setSheet] = useState<'export' | 'agents' | 'skills' | 'models' | null>(null);
  // Which vitals figure is showing its readout card (one at a time), hover- and
  // focus-driven like Mission Control's. It shares the slot above the pill with
  // the narrated sentence and cannot share it with a sheet, so it is suppressed
  // while one is raised — see where it is rendered.
  //
  // Hover and focus are tracked APART, which the rail does not need to do: there
  // the triggers are 21px figures in a static band, here they are 9px chips in a
  // bar the pointer crosses constantly on its way to the filters. With one state
  // and an `onMouseLeave` clear, sweeping over a chip the keyboard had opened
  // would close its card with no way back short of blurring and re-focusing.
  const [vitalHover, setVitalHover] = useState<'ctx' | 'spend' | null>(null);
  const [vitalFocus, setVitalFocus] = useState<'ctx' | 'spend' | null>(null);
  const clearVitals = () => {
    setVitalHover(null);
    setVitalFocus(null);
  };
  const rootRef = useRef<HTMLDivElement | null>(null);
  // The find collapses to a magnifier when it has nothing to say. It stays open
  // while a query stands, so stepping through hits never closes the box the
  // reader is stepping with.
  const [findOpen, setFindOpen] = useState(false);
  const findInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!sheet) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setSheet(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [sheet]);

  // Register the imperative opener so the per-turn export button can raise this
  // sheet. The setSheet call lives in a deferred closure (an event handler), not
  // the effect body, so it doesn't violate set-state-in-effect.
  useEffect(() => {
    openExportRef.current = () => {
      onOpenSheet();
      setSheet('export');
    };
    return () => {
      openExportRef.current = null;
    };
  }, [openExportRef, onOpenSheet]);

  // Raising a sheet drops any hovered readout: they share the slot above the
  // pill, and a card left armed would pop the moment the sheet closed.
  const toggleExport = () => {
    clearVitals();
    setSheet(s => {
      const next = s === 'export' ? null : 'export';
      if (next === 'export') onOpenSheet();
      return next;
    });
  };
  const raise = (which: 'agents' | 'skills' | 'models') => () => {
    clearVitals();
    setSheet(s => (s === which ? null : which));
  };
  const toggleAgents = raise('agents');
  const toggleSkills = raise('skills');
  const toggleModels = raise('models');

  // The run the conversation is on now. `/model` rewrites this mid-chat, so it
  // is the LAST run and never the first.
  const currentRun = modelRuns.length > 0 ? modelRuns[modelRuns.length - 1] : null;
  const switched = modelRuns.length > 1;

  // Same threshold Mission Control used, and the same two consequences: the
  // figure turns and so does its gauge. A window this full is the one thing in
  // the pill that is about to cost the reader something.
  const ctxDanger = !!vitals?.ctx && vitals.ctx.pct >= 90;
  // The readout shares the slot above the pill with the narrated sentence and
  // sits under whatever sheet is raised, so it yields to a sheet and takes the
  // slot from the sentence while it is up.
  const readout = sheet ? null : (vitalHover ?? vitalFocus);

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
      {/* Keyed by the call, so each sentence enters on its own rather than
          cross-fading into the next one mid-read. */}
      {thought && !readout && <ThoughtLine key={thought.id} thought={thought} />}
      {readout === 'ctx' && <ContextPopover ctx={vitals?.ctx ?? null} placement="pill" />}
      {readout === 'spend' && <SpendPopover summary={vitals?.session} placement="pill" />}
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
          onOpenOutput={group => {
            setSheet(null);
            onOpenSkillOutput(group);
          }}
          onLocate={turnN => {
            setSheet(null);
            onLocateSkill(turnN);
          }}
        />
      )}
      {sheet === 'models' && switched && (
        <ModelDockSheet
          runs={modelRuns}
          onLocate={turnN => {
            setSheet(null);
            onLocateModel(turnN);
          }}
        />
      )}
      {sheet === 'export' && (
        <div className="cl-sheet cl-sheet--export" role="menu">
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
          <div className="cl-export-scope">
            <span className="cl-export-scope-text">
              {selectedCount > 0
                ? `Exporting ${selectedCount} selected turn${selectedCount === 1 ? '' : 's'}`
                : 'Exporting full chat'}
            </span>
            {selectedCount > 0 ? (
              <button type="button" className="cl-export-scope-action" onClick={onClearSelection}>
                Full chat
              </button>
            ) : (
              <button
                type="button"
                className="cl-export-scope-action"
                data-on={selectionMode || undefined}
                onClick={onToggleSelectionMode}
              >
                {selectionMode ? 'Done selecting' : 'Select turns'}
              </button>
            )}
          </div>
          {selectionMode && selectedCount === 0 && (
            <p className="cl-export-desc">Pick turns in the transcript, then export.</p>
          )}
          <div className="cl-export-list" role="radiogroup" aria-label="Export preset">
            {CHAT_EXPORT_PRESETS.map(preset => (
              <button
                key={preset.value}
                type="button"
                role="radio"
                aria-checked={exportPreset === preset.value}
                className={`cl-export-option${exportPreset === preset.value ? ' is-active' : ''}`}
                onClick={() => onExportPreset(preset.value)}
              >
                <span className="cl-export-option-dot" aria-hidden="true" />
                <span className="cl-export-option-body">
                  <span className="cl-export-option-name">{preset.label}</span>
                  <span className="cl-export-option-desc">{preset.description}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="cl-export-actions">
            <button
              type="button"
              disabled={!canExport || exporting !== null || (selectionMode && selectedCount === 0)}
              onClick={() => onExport('markdown')}
            >
              {exporting === 'markdown' ? 'Saving...' : 'Markdown'}
            </button>
            <button
              type="button"
              disabled={!canExport || exporting !== null || (selectionMode && selectedCount === 0)}
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
        {currentRun && (
          <>
            {switched ? (
              <button
                type="button"
                className="cl-pill-model"
                aria-haspopup="menu"
                aria-expanded={sheet === 'models'}
                data-on={sheet === 'models' || undefined}
                style={{ '--mt': modelColor(currentRun.model) } as CSSProperties}
                title={`On ${fmtModel(currentRun.model)}${
                  currentRun.effort ? ` · ${currentRun.effort}` : ''
                } since turn ${currentRun.turnN} — model or effort changed ${
                  modelRuns.length - 1
                } time${modelRuns.length === 2 ? '' : 's'} in this chat`}
                onClick={toggleModels}
              >
                <span className="cl-pill-model-dot" aria-hidden />
                <span className="cl-pill-model-name">{fmtModel(currentRun.model)}</span>
                {currentRun.effort && (
                  <span className="cl-pill-model-effort">{currentRun.effort}</span>
                )}
                <span className="cl-pill-model-switched">+{modelRuns.length - 1}</span>
                <DockCaretGlyph open={sheet === 'models'} />
              </button>
            ) : (
              <span
                className="cl-pill-model"
                style={{ '--mt': modelColor(currentRun.model) } as CSSProperties}
                title={
                  currentRun.effort
                    ? `Model in use — reasoning effort ${currentRun.effort}`
                    : 'Model in use'
                }
              >
                <span className="cl-pill-model-dot" aria-hidden />
                <span className="cl-pill-model-name">{fmtModel(currentRun.model)}</span>
                {currentRun.effort && (
                  <span className="cl-pill-model-effort">{currentRun.effort}</span>
                )}
              </span>
            )}
            <span className="cl-pill-div" />
          </>
        )}
        {vitals && (
          <>
            {/* Context and spend read as ONE cell with the model chip: what this
                session is, and what it is costing to be it. Everything to the
                right of the divider is a control. The gauge is the only
                quantitative graphic in the pill and it earns the exception —
                the percentage is the one figure here with a ceiling, and a bare
                number says nothing about how close to it the session is. */}
            <span
              className="cl-vitals-trigger cl-pill-ctx"
              data-danger={ctxDanger || undefined}
              tabIndex={0}
              aria-label="Context window detail"
              onMouseEnter={() => setVitalHover('ctx')}
              onMouseLeave={() => setVitalHover(null)}
              onFocus={() => setVitalFocus('ctx')}
              onBlur={() => setVitalFocus(null)}
            >
              <span className="cl-pill-gauge" aria-hidden>
                <i style={{ width: `${vitals.ctx?.pct ?? 0}%` }} />
              </span>
              <span className="cl-pill-ctx-n">
                {vitals.ctx ? vitals.ctx.pct : '—'}
                <em>%</em>
              </span>
              <span className="cl-pill-ctx-u">ctx</span>
            </span>
            <span
              className="cl-vitals-trigger cl-pill-spend"
              tabIndex={0}
              aria-label="Session spend detail"
              onMouseEnter={() => setVitalHover('spend')}
              onMouseLeave={() => setVitalHover(null)}
              onFocus={() => setVitalFocus('spend')}
              onBlur={() => setVitalFocus(null)}
            >
              {fmtCost(vitals.session.estimatedCost)}
            </span>
            <span className="cl-pill-div" />
          </>
        )}
        {changes && (changes.added > 0 || changes.removed > 0) && (
          <>
            {/* What the session DID, next to what it is and what it cost. It
                lived over Mission Control's feed, where it read as a heading for
                a list of events; it is neither — it is the session's product. No
                readout card: the rail's feed already lists the files one by one,
                and inventing a second place to see them would be two lists. */}
            <span
              className="cl-pill-diff"
              title={`${changes.added} lines added, ${changes.removed} removed across ${changes.files} file${changes.files === 1 ? '' : 's'}`}
            >
              <b className="add">+{changes.added}</b>
              <b className="del">−{changes.removed}</b>
              <span className="files">
                {changes.files} <span>{changes.files === 1 ? 'file' : 'files'}</span>
              </span>
            </span>
            <span className="cl-pill-div" />
          </>
        )}
        {find && (
          <>
            {findOpen || find.query ? (
              <span className="cl-pill-find" role="search">
                <FindGlyph />
                <input
                  ref={findInputRef}
                  type="text"
                  value={find.query}
                  spellCheck={false}
                  // Says what it searches. The scan reads the prose, not tool
                  // output, and a placeholder that promised the whole session
                  // would make every miss look like a bug.
                  placeholder="Find in prose"
                  aria-label="Find in transcript"
                  onChange={e => find.setQuery(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      find.onStep(e.shiftKey ? -1 : 1);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      find.setQuery('');
                      setFindOpen(false);
                    }
                  }}
                />
                {/* "12 turns", never a bare "2/12": that reads as "match 2 of
                    12" to everyone, and this find counts turns. */}
                <span className="cl-pill-find-count">
                  {find.query.trim() === ''
                    ? ''
                    : find.hits === 0
                      ? 'none'
                      : `${find.position > 0 ? `${find.position}/` : ''}${find.hits} turn${
                          find.hits === 1 ? '' : 's'
                        }`}
                </span>
                <button
                  type="button"
                  className="cl-pill-find-step"
                  disabled={find.hits === 0}
                  title="Previous turn with a match (⇧⏎)"
                  aria-label="Previous turn with a match"
                  onClick={() => find.onStep(-1)}
                >
                  <FindStepGlyph up />
                </button>
                <button
                  type="button"
                  className="cl-pill-find-step"
                  disabled={find.hits === 0}
                  title="Next turn with a match (⏎)"
                  aria-label="Next turn with a match"
                  onClick={() => find.onStep(1)}
                >
                  <FindStepGlyph up={false} />
                </button>
                <button
                  type="button"
                  className="cl-pill-find-close"
                  title="Close find (Esc)"
                  aria-label="Close find"
                  onClick={() => {
                    find.setQuery('');
                    setFindOpen(false);
                  }}
                >
                  ✕
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="cl-pill-more"
                title="Find in transcript"
                aria-label="Find in transcript"
                onClick={() => {
                  setFindOpen(true);
                  // The box is not in the DOM until this render commits.
                  requestAnimationFrame(() => findInputRef.current?.focus());
                }}
              >
                <FindGlyph />
              </button>
            )}
            <span className="cl-pill-div" />
          </>
        )}
        {showTranscriptControls && (
          <>
            {/* No "All" chip: a second click on the active one already clears
                the filter, so a chip whose only job was to undo the others was a
                cell spent on a gesture the others already carry. */}
            <div className="cl-pill-filters" role="group" aria-label="Filter turns by type">
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
