import { useState } from 'react'

export type FrontmatterFieldDef<T> = {
  key: string
  label: string
  hint: string
  isArray?: boolean
  isBool?: boolean
  resolve: (entity: T) => string | string[] | null
}

interface FrontmatterPanelProps<T> {
  entity: T
  fields: FrontmatterFieldDef<T>[]
  /** Filename hint shown in the footer (e.g. "SKILL.md", "{name}.md") */
  filenameHint: string
}

export function FrontmatterPanel<T>({ entity, fields, filenameHint }: FrontmatterPanelProps<T>) {
  const [showEmpty, setShowEmpty] = useState(false)
  const filled = fields.filter(f => f.resolve(entity) !== null)
  const empty  = fields.filter(f => f.resolve(entity) === null)

  const renderValue = (field: FrontmatterFieldDef<T>) => {
    const val = field.resolve(entity)
    if (val === null) return null

    if (field.isArray && Array.isArray(val)) {
      return (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {val.map(item => (
            <code key={item} className="px-1.5 py-0.5 rounded-md bg-[var(--cl-paper-3)] text-[var(--cl-violet)] text-[10px] font-mono font-medium ring-1 ring-[var(--cl-violet)]">
              {item}
            </code>
          ))}
        </div>
      )
    }

    if (field.isBool) {
      return (
        <div className="mt-1.5">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold ring-1"
            style={{
              background: 'var(--cl-paper-2)',
              color: 'var(--cl-accent)',
              boxShadow: 'inset 0 0 0 1px var(--cl-accent)',
            }}>
            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: 'var(--cl-accent)' }} />
            {val}
          </span>
        </div>
      )
    }

    return (
      <code className="mt-1.5 block text-[11px] font-mono text-[var(--cl-ink-3)] bg-[var(--cl-paper-2)] px-2 py-1 rounded-md ring-1 ring-[var(--cl-line)]">
        {val}
      </code>
    )
  }

  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <div className="flex items-center justify-between pb-3" style={{ borderBottom: '1px solid var(--cl-line)' }}>
        <span className="text-[10px] font-mono font-bold tracking-[0.18em] uppercase" style={{ color: 'var(--cl-ink-3)' }}>
          Frontmatter
        </span>
        {filled.length > 0 && (
          <span className="text-[10px] font-mono" style={{ color: 'var(--cl-ink-3)' }}>
            {filled.length}/{fields.length}
          </span>
        )}
      </div>

      <div className="flex-1">
        {filled.length === 0 ? (
          <div className="py-5 text-center">
            <p className="text-[11px] leading-snug" style={{ color: 'var(--cl-ink-3)' }}>
              No fields configured in frontmatter
            </p>
          </div>
        ) : (
          <div className="py-3">
            {filled.map(field => (
              <div key={field.key} className="py-2.5">
                <div className="text-[9px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--cl-ink-3)' }}>
                  {field.label}
                </div>
                {renderValue(field)}
              </div>
            ))}
          </div>
        )}

        {empty.length > 0 && (
          <>
            <div style={{ borderTop: '1px solid var(--cl-line)' }} />
            <button
              onClick={() => setShowEmpty(v => !v)}
              className="w-full py-2.5 flex items-center justify-between text-left hover:opacity-75 transition-opacity"
            >
              <span className="text-[9px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--cl-ink-3)' }}>
                Available options
              </span>
              <span className="text-[9px]" style={{ color: 'var(--cl-ink-3)' }}>{showEmpty ? '▲' : '▼'}</span>
            </button>
            {showEmpty && (
              <div className="pb-2">
                {empty.map(field => (
                  <div key={field.key} className="py-2">
                    <div className="text-[9px] font-semibold uppercase tracking-[0.12em] mb-0.5" style={{ color: 'var(--cl-ink-3)' }}>
                      {field.label}
                    </div>
                    <p className="text-[10px] leading-snug" style={{ color: 'var(--cl-ink-3)' }}>{field.hint}</p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="pt-3" style={{ borderTop: '1px solid var(--cl-line)' }}>
        <p className="text-[10px] leading-snug" style={{ color: 'var(--cl-ink-3)' }}>
          Edit{' '}
          <code className="font-mono">{filenameHint}</code>{' '}
          to configure fields
        </p>
      </div>
    </div>
  )
}
