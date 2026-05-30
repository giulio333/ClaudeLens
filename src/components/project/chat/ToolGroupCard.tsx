import { useState } from 'react'
import { ToolGroup, isMemoryFile, resolveToolIcon } from './utils'

export function ToolGroupCard({ group, showDetails, onOpenDetail }: {
  group: ToolGroup
  showDetails: boolean
  onOpenDetail: () => void
}) {
  const [open, setOpen] = useState(false)
  const { use, result } = group
  const isMemory = isMemoryFile(use.input as Record<string, unknown>)
  const icon = resolveToolIcon(use.name, use.input as Record<string, unknown>)
  const inputPreview = (
    use.input.description as string ??
    use.input.command as string ??
    use.input.file_path as string ??
    use.input.pattern as string ??
    use.input.prompt as string ??
    ''
  )
  const resultPreview = result ? result.content.split('\n')[0]?.slice(0, 80) ?? '' : null
  const hasExpandable = showDetails || (result && result.content.length > 80)

  return (
    <div className={`cl-tool-card ${isMemory ? 'cl-tool-card--memory' : ''}`}>
      <div className="cl-tool-card-row">
        <button
          type="button"
          onClick={() => hasExpandable && setOpen(o => !o)}
          className={`cl-tool-card-main ${!hasExpandable ? 'is-static' : ''}`}
          aria-label={`${use.name} tool — ${open ? 'collapse' : 'expand'} details`}
          aria-expanded={hasExpandable ? open : undefined}
        >
          <span className="cl-tool-card-icon">{icon}</span>
          <span className="cl-tool-card-name">{use.name}</span>
          {inputPreview && !open && (
            <span className="cl-tool-card-preview">{String(inputPreview).slice(0, 80)}</span>
          )}
          {isMemory && (
            <span className="cl-tool-card-badge">Memory</span>
          )}
          {hasExpandable && (
            <span className="cl-tool-card-toggle">{open ? 'Close' : 'Open'}</span>
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

      {result && !open && (
        <div className={`cl-tool-card-result ${result.isError ? 'is-error' : 'is-ok'}`}>
          <span>{result.isError ? 'Error' : 'Result'}</span>
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
