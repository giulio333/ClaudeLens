import { ReactNode, useState } from 'react'
import Markdown from '../../Markdown'
import { TopBar } from './TopBar'

interface MarkdownDocViewProps {
  /** Navigation back handler */
  onBack: () => void
  /** Label of the back action (e.g. "Back", "Skills", "Agents") */
  backLabel?: string
  /** Breadcrumb segment after "← Back /", uppercased in the topbar (e.g. "Global · CLAUDE.md") */
  crumb: string

  /** Eyebrow text under the pip (top of hero) */
  eyebrow: ReactNode
  /** Main title label (rendered in ink color) */
  titleLabel: string
  /** Title trailing glyph (rendered in accent color) — e.g. ".md" */
  titleGlyph?: string
  /**
   * When true, the title wraps onto multiple lines instead of truncating with
   * an ellipsis, and its font-size scales down as the text grows (stays large
   * for short titles). Use for titles that can be full sentences (e.g. plans).
   */
  titleFluid?: boolean
  /** Optional editorial "standfirst" rendered under the title (e.g. skill/agent description). */
  lead?: ReactNode

  /** Current persisted markdown content */
  content: string
  /** Loading flag — shows placeholder text */
  isLoading?: boolean
  /** Shown in View mode when content is empty */
  emptyMessage?: string

  /**
   * Optional save handler. When provided, the View/Edit toggle and Save/Cancel
   * controls are rendered. The promise resolves on successful save; the
   * component then exits edit mode and updates its internal "current" state.
   */
  onSave?: (newContent: string) => Promise<void>

  /** Optional right-side sidebar (e.g. properties panel) */
  sidebar?: ReactNode
  /** Width in px of the sidebar (default 260) */
  sidebarWidth?: number

  /** Extra actions rendered next to View/Edit in the hero (e.g. delete button) */
  extraActions?: ReactNode

  /** Optional notice banner rendered between the hero and the content (e.g. validation warnings) */
  notice?: ReactNode
}

// Per i titoli "fluid" (frasi intere): resta grande quando corto, rimpicciolisce
// in scaglioni man mano che cresce, sempre con clamp sul viewport.
function fluidTitleSize(label: string): string {
  const len = label.length
  if (len <= 16) return 'clamp(54px, 8.5vw, 120px)'
  if (len <= 28) return 'clamp(46px, 6.5vw, 88px)'
  if (len <= 44) return 'clamp(38px, 5vw, 64px)'
  if (len <= 64) return 'clamp(30px, 4vw, 50px)'
  return 'clamp(26px, 3.2vw, 40px)'
}

function Editor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      spellCheck={false}
      className="font-mono w-full"
      style={{
        background: 'var(--cl-paper-2)',
        color: 'var(--cl-ink)',
        border: '1px solid var(--cl-line)',
        borderRadius: 4,
        padding: '16px 18px',
        fontSize: 12.5,
        lineHeight: 1.6,
        minHeight: 480,
        outline: 'none',
        resize: 'vertical',
        maxWidth: 820,
      }}
    />
  )
}

export function MarkdownDocView({
  onBack,
  backLabel = 'Back',
  crumb,
  eyebrow,
  titleLabel,
  titleGlyph,
  titleFluid,
  lead,
  content,
  isLoading,
  emptyMessage = 'No content yet.',
  onSave,
  sidebar,
  sidebarWidth = 260,
  extraActions,
  notice,
}: MarkdownDocViewProps) {
  const editable = typeof onSave === 'function'
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [current, setCurrent] = useState(content)
  const [draft, setDraft] = useState(content)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Re-seed local state when the source content prop changes (React's
  // "adjust state during render" pattern — no effect needed).
  const [lastContent, setLastContent] = useState(content)
  if (content !== lastContent) {
    setLastContent(content)
    setCurrent(content)
    setDraft(content)
  }

  const dirty = mode === 'edit' && draft !== current

  function cancel() {
    setDraft(current)
    setMode('view')
    setError(null)
  }

  async function save() {
    if (!onSave || !dirty) return
    try {
      setSaving(true)
      setError(null)
      await onSave(draft)
      setCurrent(draft)
      setMode('view')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>
      <TopBar onBack={onBack} backLabel={backLabel} crumbs={[{ label: crumb }]} />

      <div className="flex-1 overflow-y-auto">
        <section className="cl-hero">
          <div className="cl-eyebrow">
            <span className="pip" />
            <span>{eyebrow}</span>
          </div>
          <h1
            className={`cl-h-name static${titleFluid ? ' fluid' : ''}`}
            style={titleFluid ? { fontSize: fluidTitleSize(titleLabel) } : undefined}
          >
            <span className="label-name">{titleLabel}</span>
            {titleGlyph && <span className="glyph">{titleGlyph}</span>}
          </h1>

          {lead && (
            <p
              style={{
                marginTop: 22,
                maxWidth: 720,
                fontSize: 19,
                lineHeight: 1.45,
                letterSpacing: '-0.005em',
                color: 'var(--cl-ink-2)',
                position: 'relative',
                zIndex: 2,
                paddingLeft: 18,
                borderLeft: '2px solid var(--cl-accent)',
              }}
            >
              {lead}
            </p>
          )}

          {(editable || extraActions) && (
            <div className="cl-h-meta" style={{ marginTop: 28, gap: 10, flexWrap: 'wrap' }}>
              {editable && (
                <>
                  <button
                    type="button"
                    className={`cl-btn ${mode === 'view' ? 'cl-btn--primary' : ''}`}
                    onClick={() => (mode === 'edit' && dirty ? cancel() : setMode('view'))}
                  >
                    View
                  </button>
                  <button
                    type="button"
                    className={`cl-btn ${mode === 'edit' ? 'cl-btn--primary' : ''}`}
                    onClick={() => setMode('edit')}
                  >
                    Edit
                  </button>
                </>
              )}
              {extraActions}
              {editable && mode === 'edit' && (
                <>
                  <span style={{ flex: 1 }} />
                  {error && (
                    <span
                      className="font-mono"
                      style={{ fontSize: 11, letterSpacing: '0.06em', color: 'var(--cl-warn, #d97757)' }}
                    >
                      ✕ {error}
                    </span>
                  )}
                  <span
                    className="font-mono"
                    style={{
                      fontSize: 11,
                      letterSpacing: '0.06em',
                      color: dirty ? 'var(--cl-accent)' : 'var(--cl-ink-4)',
                    }}
                  >
                    {dirty ? '● unsaved' : '○ no changes'}
                  </span>
                  <button type="button" className="cl-btn" onClick={cancel} disabled={saving}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="cl-btn cl-btn--primary"
                    onClick={save}
                    disabled={!dirty || saving}
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </>
              )}
            </div>
          )}
        </section>

        {notice && (
          <div className="cl-section" style={{ paddingTop: 24, paddingBottom: 0 }}>
            {notice}
          </div>
        )}

        <section className="cl-section">
          <div style={{ display: 'flex', gap: 36, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {isLoading ? (
                <p style={{ color: 'var(--cl-ink-3)', fontSize: 13 }}>Loading…</p>
              ) : mode === 'edit' ? (
                <Editor value={draft} onChange={setDraft} />
              ) : !current ? (
                <p style={{ color: 'var(--cl-ink-3)', fontSize: 13, fontStyle: 'italic' }}>
                  {emptyMessage}
                </p>
              ) : (
                <div style={{ maxWidth: 820 }}>
                  <Markdown>{current}</Markdown>
                </div>
              )}
            </div>
            {sidebar && (
              <aside
                style={{
                  width: sidebarWidth,
                  flexShrink: 0,
                  borderLeft: '1px solid var(--cl-line)',
                  paddingLeft: 28,
                  alignSelf: 'stretch',
                }}
              >
                {sidebar}
              </aside>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
