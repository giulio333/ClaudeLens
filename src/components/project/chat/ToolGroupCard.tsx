import { useState } from 'react'
import type { CSSProperties } from 'react'
import { ToolGroup, isMemoryFile, toolMonogram, TOOL_TINT, AGENT_TOOLS } from './utils'

export function ToolGroupCard({ group, showDetails, onOpenDetail, tint: tintOverride }: {
  group: ToolGroup
  showDetails: boolean
  onOpenDetail: () => void
  /** Explicit tint color (e.g. a dispatched agent's identity color) overriding
   *  the tool-name default. */
  tint?: string
}) {
  const [open, setOpen] = useState(false)
  const { use, result } = group
  const isMemory = isMemoryFile(use.input as Record<string, unknown>)
  const monogram = isMemory
    ? 'M'
    : AGENT_TOOLS.has(use.name)
      ? ((use.input.subagent_type as string)?.[0] ?? 'A').toUpperCase()
      : toolMonogram(use.name)
  const tint = tintOverride ?? (isMemory ? 'var(--cl-violet)' : (TOOL_TINT[use.name] ?? 'var(--cl-ink-3)'))
  // For an agent dispatch ("Agent"/"Task") the tool name carries no signal —
  // surface the delegated sub-agent type instead (e.g. "git-committer").
  const displayName = AGENT_TOOLS.has(use.name)
    ? ((use.input.subagent_type as string) || use.name)
    : use.name
  const inputPreview = (
    use.input.description as string ??
    use.input.command as string ??
    use.input.file_path as string ??
    use.input.pattern as string ??
    use.input.prompt as string ??
    ''
  )
  const resultPreview = result ? result.content.split('\n')[0]?.slice(0, 120) ?? '' : null
  const hasExpandable = showDetails || (result && result.content.length > 80)
  // Right-edge status glyph: resolved result → ✓/✕, otherwise a hint that the
  // row expands (caret when open, arrow when collapsed).
  const status = result ? (result.isError ? '✕' : '✓') : (hasExpandable ? (open ? '▾' : '→') : '')

  return (
    <div
      className={`cl-tool-card${isMemory ? ' cl-tool-card--memory' : ''}${open ? ' is-open' : ''}`}
      style={{ '--tint': tint } as CSSProperties}
    >
      <div className="cl-tool-card-row">
        <button
          type="button"
          onClick={() => hasExpandable && setOpen(o => !o)}
          className={`cl-tool-card-main ${!hasExpandable ? 'is-static' : ''}`}
          aria-label={`${use.name} tool — ${open ? 'collapse' : 'expand'} details`}
          aria-expanded={hasExpandable ? open : undefined}
        >
          <span className="cl-tool-card-mono" aria-hidden>{monogram}</span>
          <span className="cl-tool-card-id">
            <span className="cl-tool-card-name">{displayName}</span>
            {inputPreview && (
              <span className="cl-tool-card-preview">{String(inputPreview)}</span>
            )}
          </span>
          {status && (
            <span className={`cl-tool-card-status ${result ? (result.isError ? 'is-error' : 'is-ok') : ''}`}>
              {status}
            </span>
          )}
        </button>
        {showDetails && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onOpenDetail() }}
            className="cl-tool-card-detail"
            title="Open detail"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M6 3H3a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1v-3" strokeLinecap="round"/>
              <path d="M10 2h4v4" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M14 2L8 8" strokeLinecap="round"/>
            </svg>
          </button>
        )}
      </div>

      {result && result.isError && !open && (
        <div className="cl-tool-card-result is-error">
          <span>Error</span>
          <code>{resultPreview}</code>
        </div>
      )}

      {open && (
        <div className="cl-tool-card-expanded">
          {showDetails && (
            <div className="cl-tool-card-section">
              <div className="cl-tool-card-section-title">Input</div>
              <pre>
                {JSON.stringify(use.input, null, 2)}
              </pre>
            </div>
          )}
          {result && (
            <div className={`cl-tool-card-section ${result.isError ? 'is-error' : ''}`}>
              <div className={`cl-tool-card-section-title ${result.isError ? 'is-error' : 'is-ok'}`}>
                {result.isError ? 'Error' : 'Result'}
              </div>
              <pre>
                {result.content}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
