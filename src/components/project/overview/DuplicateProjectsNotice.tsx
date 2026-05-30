import { useState } from 'react'
import {
  useDuplicateProjects,
  useExecuteMerge,
  planMerge,
  type DuplicateFolder,
  type MergePlan,
  type MergeResult,
} from '../../../hooks/useIPC'
import { View } from '../types'
import { BackButton } from '../shared/BackButton'
import { MergeConfirmDialog } from '../shared/MergeConfirmDialog'

function shortWhen(iso: string | null): string {
  if (!iso) return 'no sessions'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-US', { day: '2-digit', month: 'short', year: '2-digit' })
}

function FolderRow({
  folder,
  primary,
  onMerge,
}: {
  folder: DuplicateFolder
  primary: boolean
  onMerge?: () => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px',
        borderRadius: 8,
        border: '1px solid var(--cl-line)',
        background: primary ? 'var(--cl-ok-soft, transparent)' : 'transparent',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: primary ? 'var(--cl-ok)' : 'var(--cl-warn)',
          minWidth: 84,
        }}
      >
        {primary ? '● primary' : '○ duplicate'}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--cl-ink)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={folder.realPath}
        >
          {folder.realPath}
          {!folder.realPathAuthoritative && (
            <span style={{ color: 'var(--cl-warn)', marginLeft: 8 }}>· estimated path</span>
          )}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--cl-ink-2, var(--cl-ink))', opacity: 0.6 }}>
          {folder.sessionCount} sessions · {folder.memoryTopicCount} memory
          {folder.hasMemoryIndex ? ' (+index)' : ''} · last {shortWhen(folder.lastActivity)}
        </div>
      </div>
      {onMerge && (
        <button
          type="button"
          onClick={onMerge}
          style={{
            flexShrink: 0,
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            fontWeight: 600,
            padding: '5px 10px',
            borderRadius: 6,
            border: '1px solid var(--cl-line)',
            background: 'transparent',
            color: 'var(--cl-ink)',
            cursor: 'pointer',
          }}
        >
          Merge into primary →
        </button>
      )}
    </div>
  )
}

/**
 * Compact signal shown in the global home: a clickable row that opens the
 * dedicated view. Renders nothing when there are no duplicates.
 */
export function DuplicateProjectsBadge({ onNavigate }: { onNavigate: (v: View) => void }) {
  const { data: groups = [] } = useDuplicateProjects()
  if (groups.length === 0) return null

  return (
    <button
      type="button"
      onClick={() => onNavigate({ type: 'duplicates' })}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '8px 14px',
        margin: '0 0 18px',
        borderRadius: 8,
        border: '1px solid var(--cl-line)',
        background: 'var(--cl-warn-soft)',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <span style={{ color: 'var(--cl-warn)', fontSize: 13 }}>⚠</span>
      <span style={{ fontSize: 13, color: 'var(--cl-ink)', flex: 1 }}>
        {groups.length} possible duplicate {groups.length === 1 ? 'project' : 'projects'} detected
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--cl-ink)', opacity: 0.55 }}>
        details →
      </span>
    </button>
  )
}

/** Dedicated view: short explanation + the intercepted duplicates. */
export function DuplicateProjectsView({ onBack }: { onBack: () => void }) {
  const { data: groups = [] } = useDuplicateProjects()
  const executeMerge = useExecuteMerge()
  const [dialog, setDialog] = useState<
    { plan: MergePlan; source: DuplicateFolder; dest: DuplicateFolder; sourceName: string; destName: string } | null
  >(null)
  const [planError, setPlanError] = useState<string | null>(null)
  const [result, setResult] = useState<MergeResult | null>(null)

  function name(realPath: string): string {
    return realPath.split('/').pop() || realPath
  }

  async function openMerge(source: DuplicateFolder, dest: DuplicateFolder) {
    setPlanError(null)
    try {
      const plan = await planMerge(source.hash, dest.hash)
      setDialog({ plan, source, dest, sourceName: name(source.realPath), destName: name(dest.realPath) })
    } catch (e) {
      setPlanError(e instanceof Error ? e.message : String(e))
    }
  }

  async function confirmMerge() {
    if (!dialog) return
    try {
      const res = await executeMerge.mutateAsync({
        sourceHash: dialog.source.hash,
        destHash: dialog.dest.hash,
      })
      setDialog(null)
      setResult(res)
    } catch (e) {
      setPlanError(e instanceof Error ? e.message : String(e))
      setDialog(null)
    }
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '20px 28px' }}>
      <BackButton label="Global" onClick={onBack} />

      <div className="cl-sec-head" style={{ marginTop: 12 }}>
        <h2>Possible duplicates</h2>
        <span className="ct">
          {groups.length} {groups.length === 1 ? 'project' : 'projects'} appear in multiple paths
        </span>
      </div>

      <div
        style={{
          fontSize: 13,
          lineHeight: 1.5,
          color: 'var(--cl-ink)',
          opacity: 0.8,
          margin: '14px 0 22px',
          padding: '12px 16px',
          borderRadius: 8,
          background: 'var(--cl-warn-soft)',
          border: '1px solid var(--cl-line)',
          maxWidth: 720,
        }}
      >
        Claude Code identifies projects by <b>absolute path</b>: the same project opened from
        different folders (e.g. moved from Desktop to Projects) produces separate histories. The
        old folder often keeps only its <code style={{ fontFamily: 'var(--font-mono)' }}>memory/</code>,
        because sessions get removed by Claude Code's retention. ClaudeLens{' '}
        <b>flags them</b> — nothing is moved until you choose to merge a folder into the primary one.
      </div>

      {planError && (
        <div
          style={{
            fontSize: 12,
            color: 'var(--cl-danger)',
            margin: '0 0 16px',
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid var(--cl-danger)',
            background: 'var(--cl-danger-soft)',
            maxWidth: 720,
          }}
        >
          Failed to compute merge plan: {planError}
        </div>
      )}

      {groups.length === 0 ? (
        <div className="cl-empty">No duplicates detected.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 860 }}>
          {groups.map(group => (
            <div key={group.key}>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  color: 'var(--cl-ink)',
                  marginBottom: 8,
                }}
              >
                {group.name}{' '}
                <span style={{ opacity: 0.5, fontWeight: 400 }}>· {group.folders.length} folders</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {group.folders.map((folder, i) => (
                  <FolderRow
                    key={folder.hash}
                    folder={folder}
                    primary={i === 0}
                    onMerge={i === 0 ? undefined : () => openMerge(folder, group.folders[0])}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {dialog && (
        <MergeConfirmDialog
          plan={dialog.plan}
          sourceName={dialog.sourceName}
          destName={dialog.destName}
          isLoading={executeMerge.isPending}
          canExecute={true}
          onConfirm={confirmMerge}
          onCancel={() => setDialog(null)}
        />
      )}

      {result && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--cl-paper-2)] rounded-lg shadow-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-[15px] font-semibold text-[var(--cl-ink)] mb-3">Merge complete</h3>
            <ul className="text-[13px] text-[var(--cl-ink-3)] space-y-1 mb-4">
              <li>{result.movedSessions} sessions moved{result.renamedSessions > 0 ? ` (${result.renamedSessions} renamed)` : ''}</li>
              <li>{result.movedSidecars} session data folders moved</li>
              <li>{result.cwdRewrittenFiles} sessions had their cwd rewritten</li>
              <li>{result.memoryCopied} memory copied · {result.memoryRenamed} renamed · {result.memorySkipped} identical</li>
              <li>{result.sourceDeleted ? 'Source folder deleted' : 'Source folder kept'}</li>
            </ul>
            <div className="bg-[var(--cl-paper-3)] border border-[var(--cl-line)] rounded-lg p-3 mb-4 font-mono text-[11px] text-[var(--cl-ink-3)] break-all">
              backup: {result.backupPath}
            </div>
            {result.warnings.length > 0 && (
              <ul className="text-[12px] text-[var(--cl-warn)] list-disc pl-4 space-y-1 mb-4">
                {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}
            <button
              onClick={() => setResult(null)}
              className="w-full px-4 py-2 rounded-lg bg-[var(--cl-accent)] text-[var(--cl-on-accent)] text-[13px] font-medium"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
