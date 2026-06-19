import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { TagChip } from './TagChip'

// The single tag affordance used everywhere (overview filter bar, topic/session
// sidebars). Clicking the chip opens ONE shared actions menu; the actions shown
// are driven by which callbacks the caller passes — filtering in the list,
// "remove from this item" in a topic/session, plus rename/delete-everywhere
// wherever they're available. One gesture, one menu, context-aware actions.
export function ManagedTagChip({
  name,
  count,
  active = false,
  onFilter,
  onRemoveFromItem,
  removeLabel = 'Remove from item',
  onRename,
  onDelete,
}: {
  name: string
  count?: number
  active?: boolean
  onFilter?: () => void
  onRemoveFromItem?: () => void
  removeLabel?: string
  onRename?: (oldName: string, newName: string) => boolean
  onDelete?: () => void
}) {
  const [menuRect, setMenuRect] = useState<DOMRect | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [value, setValue] = useState(name)
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
    setValue(name)
    setError(false)
    sealedRef.current = false
    setMenuRect(null)
    setRenaming(true)
  }

  // Returns true when there is nothing to do or the rename succeeded.
  const tryCommit = (): boolean => {
    const next = value.trim()
    if (!next || next === name) return true
    return onRename?.(name, next) ?? false
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
          aria-label={`Rename tag ${name}`}
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
    <span className={`cl-tagchip-wrap${menuRect ? ' is-open' : ''}`}>
      <TagChip
        name={name}
        count={count}
        tone={active ? 'on' : 'muted'}
        onClick={e => setMenuRect((e.currentTarget as HTMLElement).getBoundingClientRect())}
        title={`Manage #${name}`}
      />
      {menuRect && (
        <TagActionsMenu
          anchorRect={menuRect}
          name={name}
          active={active}
          onFilter={onFilter}
          onRemoveFromItem={onRemoveFromItem}
          removeLabel={removeLabel}
          onRename={onRename ? startRename : undefined}
          onDelete={onDelete}
          onClose={() => setMenuRect(null)}
        />
      )}
    </span>
  )
}

function TagActionsMenu({
  anchorRect,
  name,
  active,
  onFilter,
  onRemoveFromItem,
  removeLabel,
  onRename,
  onDelete,
  onClose,
}: {
  anchorRect: DOMRect
  name: string
  active: boolean
  onFilter?: () => void
  onRemoveFromItem?: () => void
  removeLabel: string
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
  const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - 208))

  const run = (fn?: () => void) => () => {
    fn?.()
    onClose()
  }

  return createPortal(
    <div
      id="cl-tag-menu-root"
      className="cl-tag-menu"
      style={{ position: 'fixed', top, left, zIndex: 1000 }}
      onMouseDown={e => e.stopPropagation()}
    >
      <div className="cl-tag-menu-head">#{name}</div>
      {onFilter && (
        <button type="button" className="cl-tag-menu-item" onClick={run(onFilter)}>
          <span className="ic" aria-hidden>
            {active ? '✕' : '⦿'}
          </span>
          {active ? 'Clear filter' : 'Filter by this tag'}
        </button>
      )}
      {onRemoveFromItem && (
        <button type="button" className="cl-tag-menu-item" onClick={run(onRemoveFromItem)}>
          <span className="ic" aria-hidden>
            ✕
          </span>
          {removeLabel}
        </button>
      )}
      {onRename && (
        <button type="button" className="cl-tag-menu-item" onClick={run(onRename)}>
          <span className="ic" aria-hidden>
            ✎
          </span>
          Rename everywhere
        </button>
      )}
      {onDelete &&
        (confirmDelete ? (
          <button
            type="button"
            className="cl-tag-menu-item danger confirm"
            onClick={run(onDelete)}
          >
            Delete tag everywhere?
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
            Delete everywhere
          </button>
        ))}
    </div>,
    document.body,
  )
}
