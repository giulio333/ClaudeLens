import { useState } from 'react';
import type { CSSProperties } from 'react';
import { ToolGroup, isMemoryFile, toolMonogram, TOOL_TINT, AGENT_TOOLS } from './utils';
import { ToolInput, ToolOutput } from './ToolDetailPanel';
import { CommandSheet } from './CommandBlock';
import { FileSheet } from './FileWindow';
import { isFileTool } from './file-view';
import { ownsToolBody, ownsOutputHead } from './shell';

/**
 * A tool call and its result, in the transcript.
 *
 * Open by default: the run is what the reader came to see, and a row that had
 * to be clicked to show it was a menu in front of every tool. A shell run is
 * drawn as its terminal window and a file tool as an editor window — the window
 * IS the card, with no header row above it saying the same name the title bar
 * says. Every other tool keeps the header (monogram · name · what it was asked)
 * with its input and result under it.
 *
 * `collapsible` is for the strips MIN density keeps on screen (agent dispatches,
 * skills): there the card is a chip that opens on click, because MIN is the
 * density that hides tool bodies.
 */
export function ToolGroupCard({
  group,
  showDetails,
  tint: tintOverride,
  detailLabel,
  onViewDetail,
  collapsible,
}: {
  group: ToolGroup;
  showDetails: boolean;
  /** Explicit tint color (e.g. a dispatched agent's identity color) overriding
   *  the tool-name default. */
  tint?: string;
  /** Optional deep-link shown at the foot of the card (e.g. "View agent" on an
   *  agent dispatch). */
  detailLabel?: string;
  onViewDetail?: () => void;
  /** Closed until clicked, as a chip. Default: always open. */
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { use, result } = group;

  // The window tools own their whole body — title bar, content, status strip —
  // so a card header on top would say "Bash" above a window titled "bash".
  if (!collapsible && ownsToolBody(use.name)) {
    return (
      <div className="cl-tool-window">
        <CommandSheet
          input={use.input as Record<string, unknown>}
          result={result}
          showCommand={showDetails}
          showDescription
        />
      </div>
    );
  }
  if (!collapsible && isFileTool(use.name)) {
    return (
      <div className="cl-tool-window">
        <FileSheet name={use.name} input={use.input as Record<string, unknown>} result={result} />
      </div>
    );
  }

  const isMemory = isMemoryFile(use.input as Record<string, unknown>);
  const monogram = isMemory
    ? 'M'
    : AGENT_TOOLS.has(use.name)
      ? ((use.input.subagent_type as string)?.[0] ?? 'A').toUpperCase()
      : toolMonogram(use.name);
  const tint =
    tintOverride ?? (isMemory ? 'var(--cl-violet)' : (TOOL_TINT[use.name] ?? 'var(--cl-ink-3)'));
  // For an agent dispatch ("Agent"/"Task") the tool name carries no signal —
  // surface the delegated sub-agent type instead (e.g. "git-committer").
  const displayName = AGENT_TOOLS.has(use.name)
    ? (use.input.subagent_type as string) || use.name
    : use.name;
  const inputPreview =
    (use.input.description as string) ??
    (use.input.command as string) ??
    (use.input.file_path as string) ??
    (use.input.pattern as string) ??
    (use.input.prompt as string) ??
    '';
  const resultPreview = result ? (result.content.split('\n')[0]?.slice(0, 120) ?? '') : null;
  const hasBody = showDetails || !!result || !!onViewDetail;
  const expanded = collapsible ? open && hasBody : hasBody;
  const toggles = collapsible && hasBody;
  // Right-edge status glyph: resolved result → ✓/✕; a chip that can open hints
  // so instead (caret when open, arrow when collapsed).
  const status = result ? (result.isError ? '✕' : '✓') : toggles ? (open ? '▾' : '→') : '';
  const header = (
    <>
      <span className="cl-tool-card-mono" aria-hidden>
        {monogram}
      </span>
      <span className="cl-tool-card-id">
        <span className="cl-tool-card-name">{displayName}</span>
        {inputPreview && <span className="cl-tool-card-preview">{String(inputPreview)}</span>}
      </span>
      {status && (
        <span
          className={`cl-tool-card-status ${result ? (result.isError ? 'is-error' : 'is-ok') : ''}`}
        >
          {status}
        </span>
      )}
    </>
  );

  return (
    <div
      className={`cl-tool-card${isMemory ? ' cl-tool-card--memory' : ''}${collapsible ? ' cl-tool-card--chip' : ''}${expanded ? ' is-open' : ''}`}
      style={{ '--tint': tint } as CSSProperties}
    >
      <div className="cl-tool-card-row">
        {/* A header that toggles is a button; one that does not is a plain
            row — a focusable control that does nothing is worse than none. */}
        {toggles ? (
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className="cl-tool-card-main"
            aria-label={`${use.name} tool — ${open ? 'collapse' : 'expand'} details`}
            aria-expanded={open}
          >
            {header}
          </button>
        ) : (
          <div className="cl-tool-card-main is-static">{header}</div>
        )}
      </div>

      {result && result.isError && !expanded && (
        <div className="cl-tool-card-result is-error">
          <span>Error</span>
          <code>{resultPreview}</code>
        </div>
      )}

      {expanded && (
        <div className="cl-tool-card-expanded">
          {/* A shell tool is one unit — command and its output in a single
              section, no per-side heads (see `ownsToolBody`). Reached only
              from a collapsible chip; the open card renders the window alone. */}
          {ownsToolBody(use.name) ? (
            <div className="cl-tool-card-section">
              <CommandSheet
                input={use.input as Record<string, unknown>}
                result={result}
                showCommand={showDetails}
                showDescription={false}
              />
            </div>
          ) : isFileTool(use.name) ? (
            <div className="cl-tool-card-section">
              <FileSheet
                name={use.name}
                input={use.input as Record<string, unknown>}
                result={result}
              />
            </div>
          ) : (
            <>
              {showDetails && (
                <div className="cl-tool-card-section">
                  <div className="cl-tool-card-section-title">Input</div>
                  <ToolInput name={use.name} input={use.input as Record<string, unknown>} inline />
                </div>
              )}
              {result && (
                <div className={`cl-tool-card-section ${result.isError ? 'is-error' : ''}`}>
                  {(!ownsOutputHead(use.name) || result.isError) && (
                    <div
                      className={`cl-tool-card-section-title ${result.isError ? 'is-error' : 'is-ok'}`}
                    >
                      {result.isError ? 'Error' : 'Result'}
                    </div>
                  )}
                  <ToolOutput name={use.name} result={result} />
                </div>
              )}
            </>
          )}
          {onViewDetail && (
            <div className="cl-tool-card-section cl-entity-link-row">
              <button type="button" className="cl-entity-link" onClick={onViewDetail}>
                {detailLabel ?? 'View detail'} →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
