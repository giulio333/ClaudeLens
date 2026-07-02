import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Skill } from '../../../hooks/useIPC';
import {
  ChatDetailsFilter,
  SessionAgent,
  SessionSkill,
  ToolGroup,
  TurnFilter,
  TurnFilterCounts,
  skillHasViewableOutput,
  skillInitial,
} from './utils';
import {
  CHAT_EXPORT_PRESETS,
  ChatExportFormat,
  ChatExportPreset,
} from './export';
import { ChevronUpGlyph, DockCaretGlyph, LocateGlyph, TrashGlyph } from './icons';

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
