import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { SessionSummary } from '../../../hooks/useIPC';
import { ChatDetailsFilter, ModelRun } from './utils';
import { fmtCost, fmtModel, modelColor } from '../utils';
import type { ContextState } from '../terminal/context-window';
import { ContextPopover, SpendPopover } from '../terminal/VitalsPopover';
import { CHAT_EXPORT_PRESETS, ChatExportFormat, ChatExportPreset } from './export';
import {
  ChevronUpGlyph,
  DiffGlyph,
  DockCaretGlyph,
  FindGlyph,
  FindStepGlyph,
  LocateGlyph,
  TrashGlyph,
} from './icons';
import { ThoughtLine } from './ThoughtLine';
import { Thought } from './thoughts';

/** Inline style that paints an orb with a model run's identity color, falling
 *  back to the default violet (handled in CSS) when there is none. */
function orbStyle(color?: string): CSSProperties {
  return color ? ({ '--orb-color': color } as CSSProperties) : {};
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

/**
 * Floating glass control pill (Focus layout) — bottom-centre.
 *
 * **Its anatomy is fixed**: the same cells, in the same order, in every session.
 * It did not use to be. Agents, skills and questions were drawn only when the
 * session happened to have some, so the bar grew a dock here and a chip there
 * and wrapped onto a second row on a busy transcript — the one surface that has
 * to be in the same place every time was the one that moved. Those three are
 * **inventories**, not controls: what this session used, what it asked. They
 * belong to Mission Control's event feed, which already dates and orders exactly
 * that, and all three are species there now.
 *
 * The turn filters went with them, for the same reason one step further. A chip
 * that reads `THINKING 0` is a control for nothing, and one that only appears
 * when the count is non-zero is the moving anatomy again — there is no third
 * option, so the filter is gone from the app entirely (`TurnFilter`, the dimming
 * of non-matching turns, the minimap's dim) rather than kept as a cell that is
 * wrong in one of the two ways.
 *
 * What stays is what a reader acts on: what the conversation is (model, context,
 * spend) and the three controls — find, density, and the "more" trigger that
 * raises the export / delete sheet. What the session did to the working tree
 * is not here any more: Mission Control shows it, as a total and file by file,
 * and the diffs themselves sit under the turns. The cells that can read zero
 * say so, the way the context cell prints `—` rather than a zero it has not
 * measured.
 *
 * One sheet at a time above the pill: the model runs, or export.
 */
export function ChatControlPill({
  showTranscriptControls,
  density,
  setDensity,
  diffsOpen,
  onToggleDiffs,
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
  exportable = true,
  modelRuns,
  onLocateModel,
  vitals,
  find,
  thought,
}: {
  /** Whether this host renders the density toggle — the pill's one transcript
   *  control. False in a mode with no transcript to thin out. */
  showTranscriptControls: boolean;
  density: ChatDetailsFilter;
  setDensity: (d: ChatDetailsFilter) => void;
  /** The diffs at the foot of the turns, all at once: on shows them, off folds
   *  them to their one-line header. */
  diffsOpen: boolean;
  onToggleDiffs: () => void;
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
  /** Absent, the sheet offers no delete: the session is not on this machine. */
  onDelete?: () => void;
  /** False drops the export/delete sheet and its button altogether — a session
   *  read from another machine is neither saved nor deleted from here (#294). */
  exportable?: boolean;
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
  // Only one sheet is raised above the pill at a time: the model runs, or the
  // export/delete menu.
  const [sheet, setSheet] = useState<'export' | 'models' | null>(null);
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
  const toggleModels = () => {
    clearVitals();
    setSheet(s => (s === 'models' ? null : 'models'));
  };

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

  return (
    <div className="cl-pill-wrap" ref={rootRef}>
      {/* Keyed by the call, so each sentence enters on its own rather than
          cross-fading into the next one mid-read. */}
      {thought && !readout && <ThoughtLine key={thought.id} thought={thought} />}
      {readout === 'ctx' && <ContextPopover ctx={vitals?.ctx ?? null} placement="pill" />}
      {readout === 'spend' && <SpendPopover summary={vitals?.session} placement="pill" />}
      {sheet === 'models' && switched && (
        <ModelDockSheet
          runs={modelRuns}
          onLocate={turnN => {
            setSheet(null);
            onLocateModel(turnN);
          }}
        />
      )}
      {sheet === 'export' && exportable && (
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
          {onDelete && (
            <>
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
            </>
          )}
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
              {/* The diffs switch lives in the segment: it thins the transcript
                  the way the density does, one kind of content at a time. A
                  glyph, not a word — it is a switch, not a third density. */}
              <button
                type="button"
                className={`cl-seg-icon${diffsOpen ? ' on' : ''}`}
                aria-pressed={diffsOpen}
                title={diffsOpen ? 'Fold the file diffs' : 'Show the file diffs'}
                aria-label={diffsOpen ? 'Fold the file diffs' : 'Show the file diffs'}
                onClick={onToggleDiffs}
              >
                <DiffGlyph />
              </button>
            </div>
            {exportable && <span className="cl-pill-div" />}
          </>
        )}
        {exportable && (
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
        )}
      </div>
    </div>
  );
}
