import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectCost } from '../../../types'

type Project = { hash: string; realPath: string }

function LensIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden>
      <circle cx="7" cy="7" r="4.5" />
      <line x1="10.5" y1="10.5" x2="14" y2="14" />
    </svg>
  )
}

function PinIcon({ filled }: { filled?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" aria-hidden>
      <path d="M10.5 1.7 14.3 5.5 12.5 7.3 12 11l-2.5-2.5L5 13l-1-1 4.5-4.5L6 5l3.7-.5z" />
    </svg>
  )
}

export function SearchPopover({
  open,
  anchorRect,
  projects,
  costByHash,
  currentHash,
  pinned,
  onTogglePin,
  onSelect,
  onClose,
}: {
  open: boolean
  anchorRect: DOMRect | null
  projects: Project[]
  costByHash: Map<string, ProjectCost>
  currentHash?: string | null
  pinned: Set<string>
  onTogglePin: (hash: string) => void
  onSelect: (p: Project) => void
  onClose: () => void
}) {
  const popRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [hl, setHl] = useState(0)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setHl(0)
    setTimeout(() => inputRef.current?.focus(), 10)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (popRef.current?.contains(e.target as Node)) return
      onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  const { pinnedList, otherList, flat } = useMemo(() => {
    const q = query.trim().toLowerCase()
    const nameOf = (p: Project) => (p.realPath.split('/').pop() ?? p.realPath).toLowerCase()
    const filtered = q
      ? projects.filter(p => nameOf(p).includes(q) || p.realPath.toLowerCase().includes(q))
      : projects
    const byName = (a: Project, b: Project) => nameOf(a).localeCompare(nameOf(b))
    const pinnedList = filtered.filter(p => pinned.has(p.hash)).sort(byName)
    const otherList = filtered.filter(p => !pinned.has(p.hash)).sort(byName)
    const flat = [...pinnedList, ...otherList]
    return { pinnedList, otherList, flat }
  }, [projects, pinned, query])

  useEffect(() => {
    if (hl >= flat.length) setHl(Math.max(0, flat.length - 1))
  }, [flat.length, hl])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHl(h => Math.min(flat.length - 1, h + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHl(h => Math.max(0, h - 1)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const p = flat[hl]
      if (p) { onSelect(p); onClose() }
    }
  }

  if (!open) return null

  // Position: anchored under the lens button, right-aligned to a max width
  const popWidth = 380
  let top = 60
  let left = window.innerWidth - popWidth - 24
  if (anchorRect) {
    top = anchorRect.bottom + 8
    left = Math.max(12, Math.min(window.innerWidth - popWidth - 12, anchorRect.right - popWidth))
  }

  return (
    <div ref={popRef} className="cl-search-pop" style={{ top, left }} onClick={e => e.stopPropagation()}>
      <div className="cl-search-row">
        <LensIcon />
        <input
          ref={inputRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setHl(0) }}
          onKeyDown={onKeyDown}
          placeholder="Search projects"
          autoComplete="off"
          spellCheck={false}
        />
        <button type="button" className="esc-key" onClick={onClose}>esc</button>
      </div>

      <div className="cl-search-list">
        {flat.length === 0 ? (
          <div style={{ padding: '28px 18px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--cl-ink-4)' }}>
            No projects match &ldquo;{query}&rdquo;
          </div>
        ) : (
          <>
            {pinnedList.length > 0 && (
              <>
                <div className="cl-search-section">Pinned <span className="ct">· {pinnedList.length}</span></div>
                {pinnedList.map((p, i) => (
                  <SearchItem
                    key={p.hash}
                    project={p}
                    cost={costByHash.get(p.hash)}
                    flatIdx={i}
                    hl={hl}
                    setHl={setHl}
                    isPinned
                    isCurrent={p.hash === currentHash}
                    onTogglePin={onTogglePin}
                    onSelect={() => { onSelect(p); onClose() }}
                  />
                ))}
              </>
            )}
            {otherList.length > 0 && (
              <>
                <div className="cl-search-section">All projects <span className="ct">· {otherList.length}</span></div>
                {otherList.map((p, i) => (
                  <SearchItem
                    key={p.hash}
                    project={p}
                    cost={costByHash.get(p.hash)}
                    flatIdx={pinnedList.length + i}
                    hl={hl}
                    setHl={setHl}
                    isPinned={false}
                    isCurrent={p.hash === currentHash}
                    onTogglePin={onTogglePin}
                    onSelect={() => { onSelect(p); onClose() }}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>

      <div className="cl-search-foot">
        <span><kbd>↑↓</kbd>navigate</span>
        <span><kbd>↵</kbd>open</span>
        <span><kbd>⌘P</kbd>pin</span>
      </div>
    </div>
  )
}

function SearchItem({
  project, cost, flatIdx, hl, setHl, isPinned, isCurrent, onTogglePin, onSelect,
}: {
  project: Project
  cost?: ProjectCost
  flatIdx: number
  hl: number
  setHl: (n: number) => void
  isPinned: boolean
  isCurrent: boolean
  onTogglePin: (hash: string) => void
  onSelect: () => void
}) {
  const name = project.realPath.split('/').pop() ?? project.realPath
  const sessions = cost?.sessionsCount ?? 0
  return (
    <button
      type="button"
      className={`cl-search-item${isCurrent ? ' active' : ''}${flatIdx === hl ? ' hl' : ''}`}
      onMouseEnter={() => setHl(flatIdx)}
      onClick={onSelect}
    >
      <span className="pname-line">
        <span className="pname">{name}</span>
        <span className="pdot" />
        <span className="ppath">{project.realPath}</span>
      </span>
      <span className="pmeta"><b>{sessions}</b> sessions</span>
      <button
        type="button"
        className={`cl-pin-toggle${isPinned ? ' pinned' : ''}`}
        title={isPinned ? 'Unpin project' : 'Pin project'}
        aria-label={isPinned ? 'Unpin project' : 'Pin project'}
        onClick={e => { e.stopPropagation(); onTogglePin(project.hash) }}
      >
        <PinIcon filled={isPinned} />
      </button>
    </button>
  )
}

export function LensTriggerIcon() {
  return <LensIcon />
}

export { PinIcon }
