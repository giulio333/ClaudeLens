import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { TagChip } from './TagChip'
import type { SessionTag } from '../../../hooks/useSessionTags'

export function TagBar({
  tags,
  counts,
  activeTag,
  totalCount,
  onSelect,
  onRename,
  onDelete,
}: {
  tags: SessionTag[]
  counts: Record<string, number>
  activeTag: string | null
  totalCount: number
  onSelect: (tag: string | null) => void
  onRename?: (oldName: string, newName: string) => boolean
  onDelete?: (name: string) => void
}) {
  if (tags.length === 0) return null
  const manageable = !!(onRename || onDelete)
  return (
    <div className="cl-tagbar">
      <button
        type="button"
        className={`cl-tagbar-all${activeTag === null ? ' on' : ''}`}
        onClick={() => onSelect(null)}
      >
        All <span className="ct">{totalCount}</span>
      </button>
      <span className="cl-tagbar-sep" />
      <div className="cl-tagbar-list">
        {tags.map(t =>
          manageable ? (
            <ManageableTag
              key={t.name}
              tag={t}
              count={counts[t.name] ?? 0}
              active={activeTag === t.name}
              onSelect={() => onSelect(activeTag === t.name ? null : t.name)}
              onRename={onRename}
              onDelete={onDelete}
            />
          ) : (
            <TagChip
              key={t.name}
              name={t.name}
              count={counts[t.name] ?? 0}
              tone={activeTag === t.name ? 'on' : 'muted'}
              onClick={() => onSelect(activeTag === t.name ? null : t.name)}
            />
          ),
        )}
      </div>
    </div>
  )
}

function ManageableTag({
  tag,
  count,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  tag: SessionTag
  count: number
  active: boolean
  onSelect: () => void
  onRename?: (oldName: string, newName: string) => boolean
  onDelete?: (name: string) => void
}) {
  const [menuRect, setMenuRect] = useState<DOMRect | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [value, setValue] = useState(tag.name)
  const [error, setError] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // Guards a stray onBlur commit after Enter/Escape already closed the editor.
  const sealedRef = useRef(false)

  useEffect(() => {
    if (renaming) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [renaming])

  const startRename = () => {
    setValue(tag.name)
    setError(false)
    sealedRef.current = false
    setRenaming(true)
    setMenuRect(null)
  }

  // Returns true when there is nothing to do or the rename succeeded.
  const tryCommit = (): boolean => {
    const next = value.trim()
    if (!next || next === tag.name) return true
    return onRename?.(tag.name, next) ?? false
  }

  if (renaming) {
    return (
      <span className={`cl-tagbar-rename${error ? ' is-error' : ''}`}>
        <span className="hash" aria-hidden>
          #
        </span>
        <input
          ref={inputRef}
          value={value}
          spellCheck={false}
          autoComplete="off"
          aria-label={`Rename tag ${tag.name}`}
          style={{ width: `${Math.max(40, value.length * 7 + 6)}px` }}
          onChange={e => {
            setValue(e.target.value)
            setError(false)
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (tryCommit()) {
                sealedRef.current = true
                setRenaming(false)
              } else {
                setError(true)
              }
            } else if (e.key === 'Escape') {
              e.preventDefault()
              sealedRef.current = true
              setRenaming(false)
            }
          }}
          onBlur={() => {
            if (sealedRef.current) return
            sealedRef.current = true
            tryCommit()
            setRenaming(false)
          }}
        />
      </span>
    )
  }

  return (
    <span className={`cl-tagbar-chip${menuRect ? ' is-open' : ''}`}>
      <TagChip
        name={tag.name}
        count={count}
        tone={active ? 'on' : 'muted'}
        onClick={onSelect}
      />
      <button
        type="button"
        className="cl-tag-menu-btn"
        aria-label={`Manage tag ${tag.name}`}
        title="Manage tag"
        onClick={e => {
          e.stopPropagation()
          setMenuRect((e.currentTarget as HTMLElement).getBoundingClientRect())
        }}
      >
        ⋯
      </button>
      {menuRect && (
        <TagMenu
          anchorRect={menuRect}
          count={count}
          onRename={onRename ? startRename : undefined}
          onDelete={onDelete ? () => onDelete(tag.name) : undefined}
          onClose={() => setMenuRect(null)}
        />
      )}
    </span>
  )
}

function TagMenu({
  anchorRect,
  count,
  onRename,
  onDelete,
  onClose,
}: {
  anchorRect: DOMRect
  count: number
  onRename?: () => void
  onDelete?: () => void
  onClose: () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node | null
      const menu = document.getElementById('cl-tag-menu-root')
      if (menu && target && !menu.contains(target)) onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const top = anchorRect.bottom + 6
  const left = Math.max(8, Math.min(anchorRect.left - 60, window.innerWidth - 196))

  return createPortal(
    <div
      id="cl-tag-menu-root"
      className="cl-tag-menu"
      style={{ position: 'fixed', top, left, zIndex: 1000 }}
      onMouseDown={e => e.stopPropagation()}
    >
      {onRename && (
        <button
          type="button"
          className="cl-tag-menu-item"
          onClick={() => {
            onRename()
            onClose()
          }}
        >
          <span className="ic" aria-hidden>
            ✎
          </span>
          Rename
        </button>
      )}
      {onDelete &&
        (confirmDelete ? (
          <button
            type="button"
            className="cl-tag-menu-item danger confirm"
            onClick={() => {
              onDelete()
              onClose()
            }}
          >
            Delete from {count} {count === 1 ? 'session' : 'sessions'}?
          </button>
        ) : (
          <button
            type="button"
            className="cl-tag-menu-item danger"
            onClick={() => setConfirmDelete(true)}
          >
            <span className="ic" aria-hidden>
              ⌫
            </span>
            Delete
          </button>
        ))}
    </div>,
    document.body,
  )
}
