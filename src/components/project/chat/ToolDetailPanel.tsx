import Markdown from '../../Markdown'
import type { ReactNode } from 'react'
import { ToolGroup, isMemoryFile, resolveToolIcon, stripLineNumbers, fileExt } from './utils'
import { PathChip, SectionLabel, CodeBlock } from './atoms'

function BackChevron() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 3 5 8l5 5" />
    </svg>
  )
}

function OpenBoxIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 5 8 2.4 13.5 5 8 7.6 2.5 5Z" />
      <path d="M2.5 5v6L8 13.6 13.5 11V5" />
      <path d="M8 7.6v6" />
    </svg>
  )
}

function ResultIcon({ error }: { error: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {error ? (
        <>
          <path d="M8 2.4 14 13H2L8 2.4Z" />
          <path d="M8 6.2v3.1" />
          <path d="M8 11.5h.01" />
        </>
      ) : (
        <>
          <path d="M13.3 4.5 6.8 11 3.4 7.6" />
          <path d="M2.3 8a5.7 5.7 0 1 0 2-4.3" />
        </>
      )}
    </svg>
  )
}

function outputLineCount(result: ToolGroup['result']): number {
  if (!result?.content) return 0
  return result.content.split('\n').length
}

function formatDuration(ms?: number): string | null {
  if (ms === undefined) return null
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
}

function formatDurationParts(ms?: number): { value: string; unit: string } | null {
  if (ms === undefined) return null
  if (ms < 1000) return { value: String(ms), unit: 'ms' }
  return { value: (ms / 1000).toFixed(ms < 10_000 ? 1 : 0), unit: 's' }
}

function agentGlyph(name: string): string {
  const parts = name.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'AG'
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return parts[0].slice(0, 2).toUpperCase()
}

function parseAgentResult(content: string) {
  const usageMatch = content.match(/<usage>([\s\S]*?)<\/usage>/)
  const usage = usageMatch?.[1] ?? ''
  const readNumber = (key: string) => {
    const match = usage.match(new RegExp(`${key}:\\s*(\\d+)`))
    return match ? Number(match[1]) : undefined
  }

  return {
    cleanContent: content.replace(/\s*<usage>[\s\S]*?<\/usage>\s*/g, '').trim(),
    totalTokens: readNumber('total_tokens'),
    toolUses: readNumber('tool_uses'),
    durationMs: readNumber('duration_ms'),
    agentId: content.match(/agentId:\s*([A-Za-z0-9_-]+)/)?.[1],
  }
}

function ToolDetailShell({
  icon,
  name,
  title,
  subtitle,
  result,
  isMemory,
  onBack,
  children,
  variant,
  noHero,
  noBar,
}: {
  icon: string
  name: string
  title: string
  subtitle?: string
  result: ToolGroup['result']
  isMemory: boolean
  onBack: () => void
  children: ReactNode
  variant?: 'default' | 'agent'
  noHero?: boolean
  noBar?: boolean
}) {
  const status = result ? (result.isError ? 'Error' : 'Complete') : 'Pending'
  const statusClass = result ? (result.isError ? 'is-error' : 'is-ok') : 'is-pending'

  return (
    <div className={`cl-tool-detail${variant === 'agent' ? ' cl-tool-detail--agent' : ''}`}>
      {!noBar && (
        <div className="cl-tool-detail-bar">
          <button type="button" onClick={onBack} className="cl-tool-detail-back">
            <BackChevron />
            <span>Back to chat</span>
          </button>
          <span className="cl-tool-detail-sep">/</span>
          <span className="cl-tool-detail-mini-icon">{icon}</span>
          <span className="cl-tool-detail-mini-title">{name}</span>
        </div>
      )}

      <div className="cl-tool-detail-scroll">
        {!noHero && (
          <header className="cl-tool-detail-hero">
            <div className="cl-tool-detail-title">
              <span className="cl-tool-detail-kicker">Tool detail</span>
              <h2>{title}</h2>
              {subtitle && <p>{subtitle}</p>}
            </div>
            <div className="cl-tool-detail-badges">
              <span className={`cl-tool-status ${statusClass}`}>{status}</span>
              {isMemory && <span className="cl-tool-status is-memory">Memory</span>}
            </div>
          </header>
        )}
        {children}
      </div>
    </div>
  )
}

function StatChip({ label, value, unit, variant }: {
  label: string
  value: string
  unit?: string
  variant?: 'id'
}) {
  return (
    <div className={`cl-agent-v1-chip${variant === 'id' ? ' is-id' : ''}`}>
      <span className="ll">{label}</span>
      <div className="vv">{value}{unit && <small>{unit}</small>}</div>
    </div>
  )
}

function AgentDetailBody({
  name,
  input,
  result,
  onBack,
}: {
  name: string
  input: Record<string, unknown>
  result: ToolGroup['result']
  onBack: () => void
}) {
  const subtype = (input.subagent_type as string | undefined) || (name === 'Task' ? 'task' : 'general-purpose')
  const description = (input.description as string | undefined) || 'Agent dispatch'
  const prompt = (input.prompt as string | undefined) || ''
  const parsed = parseAgentResult(result?.content ?? '')
  const cleanOutput = parsed.cleanContent || result?.content || ''
  const isError = Boolean(result?.isError)
  const isPending = !result
  const statusLabel = isPending ? 'Pending' : isError ? 'Error' : 'Complete'
  const statusClass = isPending ? 'is-pending' : isError ? 'is-error' : 'is-ok'
  const lineCount = result ? cleanOutput.split('\n').filter(Boolean).length : 0
  const totalLineCount = result ? outputLineCount(result) : 0
  const durationParts = formatDurationParts(parsed.durationMs)
  const durationFull = formatDuration(parsed.durationMs)
  const glyph = agentGlyph(subtype)

  return (
    <div className="cl-agent-v1">
      <nav className="cl-agent-v1-subbread">
        <button type="button" onClick={onBack} className="cl-agent-v1-back-pill">
          <span className="ico"><BackChevron /></span>
          Back to chat
        </button>
        <span className="sep">/</span>
        <span>Agent · Tool detail</span>
      </nav>

      <section className="cl-agent-v1-hero">
        <div className={`cl-agent-v1-orb ${statusClass}`}>{glyph}</div>
        <div className="cl-agent-v1-meta">
          <div className="cl-agent-v1-eyebrow">
            <span className="pip" /> Sub-agent · {subtype}
          </div>
          <h1>{description}</h1>
          <div className="cl-agent-v1-sub">
            <span className="cl-agent-v1-agent-pill">{subtype}</span>
            {(durationFull || lineCount > 0) && <span className="sep">·</span>}
            {durationFull && <span>{durationFull}</span>}
            {durationFull && lineCount > 0 && <span className="sep">·</span>}
            {lineCount > 0 && <span>{lineCount} {lineCount === 1 ? 'line' : 'lines'}</span>}
          </div>
        </div>
        <div className="cl-agent-v1-status-col">
          <span className={`cl-agent-v1-status-pill ${statusClass}`}>
            <span className="led" /> {statusLabel}
          </span>
          {parsed.agentId && <span className="cl-agent-v1-id">{parsed.agentId}</span>}
        </div>
      </section>

      <div className="cl-agent-v1-statline">
        {totalLineCount > 0 && (
          <StatChip
            label="Output"
            value={String(totalLineCount)}
            unit={totalLineCount === 1 ? 'line' : 'lines'}
          />
        )}
        {parsed.toolUses !== undefined && (
          <StatChip label="Tool uses" value={String(parsed.toolUses)} />
        )}
        {parsed.totalTokens !== undefined && (
          <StatChip label="Tokens" value={String(parsed.totalTokens)} />
        )}
        {durationParts && (
          <StatChip label="Duration" value={durationParts.value} unit={durationParts.unit} />
        )}
      </div>

      <div className="cl-agent-v1-io">
        <section className="cl-agent-v1-card prompt">
          <div className="cl-agent-v1-card-head">
            <span className="ico"><OpenBoxIcon /></span>
            <span className="lbl">Input · <b>Prompt</b></span>
            <span className="meta">{prompt.length} chars</span>
          </div>
          {prompt ? (
            <div className="cl-agent-v1-prompt-body">{prompt}</div>
          ) : (
            <p className="cl-agent-v1-empty">No prompt provided.</p>
          )}
        </section>

        <section className={`cl-agent-v1-card output${isError ? ' is-error' : ''}`}>
          <div className="cl-agent-v1-card-head">
            <span className="ico"><ResultIcon error={isError} /></span>
            <span className="lbl">
              {isError ? 'Error' : 'Output'}
              {totalLineCount > 0 && (
                <>
                  {' · '}<b>{totalLineCount} {totalLineCount === 1 ? 'line' : 'lines'}</b>
                </>
              )}
            </span>
            <span className="meta">{isError ? 'stderr' : 'stdout'}</span>
          </div>
          {isPending ? (
            <p className="cl-agent-v1-empty">No result available.</p>
          ) : isError ? (
            <pre className="cl-agent-v1-error">{cleanOutput || '(no output)'}</pre>
          ) : (
            <div className="cl-agent-v1-output-body">
              <Markdown>{cleanOutput || '(no output)'}</Markdown>
            </div>
          )}
          {parsed.agentId && !isError && !isPending && (
            <div className="cl-agent-v1-notice">
              <b>Continue this agent:</b> use <code>SendMessage</code> with <code>to: '{parsed.agentId}'</code>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function ToolInput({ name, input }: { name: string; input: Record<string, unknown> }) {
  if (name === 'Read') {
    const fp = input.file_path as string
    const ext = fileExt(fp)
    return (
      <div className="space-y-3">
        <PathChip path={fp} />
        {ext && <span className="inline-block text-[10px] font-mono bg-[var(--cl-accent-soft)]/20 text-[var(--cl-accent-ink)] border border-[var(--cl-accent)]/40 rounded px-2 py-0.5">.{ext}</span>}
      </div>
    )
  }

  if (name === 'Write' || name === 'Edit') {
    const fp = input.file_path as string
    const content = input.content as string | undefined
    const oldStr = input.old_string as string | undefined
    const newStr = input.new_string as string | undefined
    return (
      <div className="space-y-3">
        <PathChip path={fp} />
        {content !== undefined && (
          <>
            <SectionLabel label="Written content" meta={`${content.split('\n').length} lines`} />
            <CodeBlock code={content} dark={false} />
          </>
        )}
        {oldStr !== undefined && (
          <>
            <SectionLabel label="Replaced text" />
            <CodeBlock code={oldStr} dark={false} className="border-[var(--cl-danger)] opacity-75" />
            <SectionLabel label="New text" />
            <CodeBlock code={newStr ?? ''} dark={false} className="border-[var(--cl-ok)]" />
          </>
        )}
      </div>
    )
  }

  if (name === 'Bash') {
    const cmd = input.command as string
    const desc = input.description as string | undefined
    return (
      <div className="space-y-3">
        {desc && <p className="text-[12px] text-[var(--cl-ink-3)] italic">{desc}</p>}
        <div className="rounded-lg bg-[var(--cl-paper-2)] border border-[var(--cl-line)] overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-[var(--cl-paper-3)] border-b border-[var(--cl-line)]">
            <span className="w-2.5 h-2.5 rounded-full bg-[var(--cl-danger-soft)]/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-[var(--cl-ok)]" />
            <span className="text-[10px] text-[var(--cl-ink-3)] ml-1">shell</span>
          </div>
          <pre className="px-4 py-3 text-[12px] font-mono text-[var(--cl-ok)] whitespace-pre-wrap break-words">
            <span className="text-[var(--cl-ink-3)] select-none">$ </span>{cmd}
          </pre>
        </div>
      </div>
    )
  }

  if (name === 'Grep') {
    const pattern = input.pattern as string
    const path = input.path as string | undefined
    const mode = input.output_mode as string | undefined
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-[var(--cl-ink-3)]">Pattern:</span>
          <code className="bg-[var(--cl-warn-soft)] border border-[var(--cl-warn)] text-[var(--cl-warn)] rounded px-2 py-0.5 text-[12px] font-mono">{pattern}</code>
          {mode && <span className="text-[10px] bg-[var(--cl-paper-3)] border border-[var(--cl-line)] text-[var(--cl-ink-3)] rounded px-2 py-0.5 font-mono">{mode}</span>}
        </div>
        {path && <PathChip path={path} />}
      </div>
    )
  }

  if (name === 'Glob') {
    const pattern = input.pattern as string
    const path = input.path as string | undefined
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--cl-ink-3)]">Pattern:</span>
          <code className="bg-[var(--cl-warn-soft)] border border-[var(--cl-warn)] text-[var(--cl-warn)] rounded px-2 py-0.5 text-[12px] font-mono">{pattern}</code>
        </div>
        {path && <PathChip path={path} />}
      </div>
    )
  }

  if (name === 'Agent') {
    const prompt = input.prompt as string
    const subtype = input.subagent_type as string | undefined
    const desc = input.description as string | undefined
    return (
      <div className="space-y-3">
        {subtype && (
          <span className="inline-block text-[11px] font-semibold bg-[var(--cl-accent-soft)]/20 text-[var(--cl-accent-ink)] border border-[var(--cl-accent)]/40 rounded-full px-3 py-1">
            {subtype}
          </span>
        )}
        {desc && <p className="text-[13px] font-medium text-[var(--cl-ink-3)]">{desc}</p>}
        <div className="rounded-lg bg-[var(--cl-paper-3)] border border-[var(--cl-line)] px-4 py-3">
          <p className="text-[12px] text-[var(--cl-ink-3)] whitespace-pre-wrap leading-relaxed">{prompt}</p>
        </div>
      </div>
    )
  }

  if (name === 'memory:createTopic') {
    const topicName = input.name as string | undefined
    const type = input.type as string | undefined
    const desc = input.description as string | undefined
    const content = input.content as string | undefined
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {type && (
            <span className={`text-[10px] font-semibold px-2 py-1 rounded-full ${
              type === 'user' ? 'bg-[var(--cl-paper-3)] text-[var(--cl-cyan)] border border-[var(--cl-cyan)]' :
              type === 'feedback' ? 'bg-[var(--cl-warn-soft)] text-[var(--cl-warn)] border border-[var(--cl-warn)]' :
              type === 'project' ? 'bg-[var(--cl-paper-3)] text-[var(--cl-ok)] border border-[var(--cl-ok)]' :
              'bg-[var(--cl-paper-3)] text-[var(--cl-violet)] border border-[var(--cl-violet)]'
            }`}>{type}</span>
          )}
          {topicName && <span className="text-[12px] font-semibold text-[var(--cl-ink-2)] font-mono">{topicName}</span>}
        </div>
        {desc && <p className="text-[12px] text-[var(--cl-ink-3)]">{desc}</p>}
        {content && (
          <>
            <SectionLabel label="Content" meta={`${content.split('\n').length} lines`} />
            <CodeBlock code={content.split('\n').slice(0, 15).join('\n') + (content.split('\n').length > 15 ? '\n...' : '')} dark={false} />
          </>
        )}
      </div>
    )
  }

  if (name === 'memory:updateTopic') {
    const filename = input.filename as string | undefined
    const topicName = input.name as string | undefined
    const content = input.content as string | undefined
    return (
      <div className="space-y-3">
        {filename && <PathChip path={filename} />}
        {topicName && <span className="text-[12px] font-semibold text-[var(--cl-ink-2)] font-mono">{topicName}</span>}
        {content && (
          <>
            <SectionLabel label="New content" meta={`${content.split('\n').length} lines`} />
            <CodeBlock code={content.split('\n').slice(0, 15).join('\n') + (content.split('\n').length > 15 ? '\n...' : '')} dark={false} />
          </>
        )}
      </div>
    )
  }

  if (name === 'memory:deleteTopic') {
    const filename = input.filename as string | undefined
    return (
      <div className="space-y-2">
        {filename ? <PathChip path={filename} /> : <p className="text-[12px] text-[var(--cl-ink-3)]">No filename</p>}
      </div>
    )
  }

  return <CodeBlock code={JSON.stringify(input, null, 2)} dark={false} />
}

function ToolOutput({ name, input, result }: {
  name: string
  input: Record<string, unknown>
  result: ToolGroup['result']
}) {
  if (!result) return <p className="text-[12px] text-[var(--cl-ink-3)] italic">No result available</p>

  const raw = result.content
  if (!raw) return <p className="text-[12px] text-[var(--cl-ink-3)] italic">(no output)</p>

  if (result.isError) {
    return (
      <div className="rounded-lg bg-[var(--cl-danger-soft)] border border-[var(--cl-danger)] px-4 py-3">
        <pre className="text-[12px] text-[var(--cl-danger)] font-mono whitespace-pre-wrap break-words leading-relaxed">{raw}</pre>
      </div>
    )
  }

  if (name === 'Read' && raw.match(/^\s*\d+→/m)) {
    const stripped = stripLineNumbers(raw)
    const fp = input.file_path as string
    const ext = fileExt(fp)
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          {ext && <span className="text-[10px] font-mono bg-[var(--cl-paper-3)] border border-[var(--cl-line)] text-[var(--cl-ink-3)] rounded px-2 py-0.5">.{ext}</span>}
        </div>
        <CodeBlock code={stripped} dark={false} />
      </div>
    )
  }

  if (name === 'Bash') {
    return (
      <div className="rounded-lg bg-[var(--cl-paper-2)] border border-[var(--cl-line)] overflow-hidden">
        <div className="px-3 py-1.5 bg-[var(--cl-paper-3)] border-b border-[var(--cl-line)] text-[10px] text-[var(--cl-ink-3)]">output</div>
        <pre className="px-4 py-3 text-[12px] font-mono text-[var(--cl-ink-2)] whitespace-pre-wrap break-words leading-relaxed max-h-[400px] overflow-y-auto">
          {raw || '(no output)'}
        </pre>
      </div>
    )
  }

  if (name === 'Agent') {
    return (
      <div className="bg-[var(--cl-paper-2)] border border-[var(--cl-line)] rounded-lg px-5 py-4">
        <div className="prose prose-sm prose-zinc max-w-none">
          <Markdown>{raw}</Markdown>
        </div>
      </div>
    )
  }

  if (name === 'Glob') {
    const paths = raw.split('\n').filter(Boolean)
    return (
      <div className="space-y-1">
        {paths.map((p, i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--cl-paper-3)] border border-[var(--cl-line-soft)] text-[12px] font-mono text-[var(--cl-ink-3)] hover:bg-[var(--cl-paper-3)] transition-colors">
            <span className="text-[var(--cl-ink-3)] shrink-0 text-[10px]">{i + 1}</span>
            <span className="truncate">{p}</span>
          </div>
        ))}
        {paths.length === 0 && <p className="text-[12px] text-[var(--cl-ink-3)] italic">No files found</p>}
      </div>
    )
  }

  if (name === 'Grep') {
    const lines = raw.split('\n').filter(Boolean)
    return (
      <div className="rounded-lg bg-[var(--cl-paper-3)] border border-[var(--cl-line)] overflow-hidden">
        {lines.map((line, i) => (
          <div key={i} className="flex items-start gap-3 px-3 py-1.5 border-b border-[var(--cl-line-soft)] last:border-0 hover:bg-[var(--cl-paper-2)] transition-colors">
            <span className="text-[var(--cl-ink-2)] text-[10px] font-mono shrink-0 pt-0.5">{i + 1}</span>
            <pre className="text-[11px] font-mono text-[var(--cl-ink-3)] whitespace-pre-wrap break-words flex-1">{line}</pre>
          </div>
        ))}
        {lines.length === 0 && <p className="px-3 py-2 text-[12px] text-[var(--cl-ink-3)] italic">No results</p>}
      </div>
    )
  }

  if (name.startsWith('memory:')) {
    try {
      const json = JSON.parse(raw)
      if (name === 'memory:createTopic' || name === 'memory:updateTopic') {
        const filename = json.data?.filename || json.filename
        return filename ? (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-[var(--cl-paper-3)] border border-[var(--cl-ok)]">
            <span className="text-[var(--cl-ok)] text-[13px]">✓</span>
            <span className="text-[12px] text-[var(--cl-ok)] font-mono">{filename}</span>
          </div>
        ) : (
          <p className="text-[12px] text-[var(--cl-ink-3)]">Operation completed.</p>
        )
      }
      if (name === 'memory:deleteTopic') {
        return (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-[var(--cl-paper-3)] border border-[var(--cl-ok)]">
            <span className="text-[var(--cl-ok)] text-[13px]">✓</span>
            <span className="text-[12px] text-[var(--cl-ok)]">Topic deleted.</span>
          </div>
        )
      }
    } catch {
      // Se non è JSON, fallback
    }
  }

  return <CodeBlock code={raw} dark={false} />
}

export function ToolDetailPanel({ group, onBack }: { group: ToolGroup; onBack: () => void }) {
  const { use, result } = group
  const icon = resolveToolIcon(use.name, use.input as Record<string, unknown>)
  const isMemory = isMemoryFile(use.input as Record<string, unknown>)
  const name = use.name
  const input = use.input as Record<string, unknown>
  const isAgent = name === 'Agent' || name === 'Task'
  const detailTitle = isAgent
    ? ((input.description as string | undefined) || 'Agent dispatch')
    : name
  const detailSubtitle = isAgent
    ? ((input.subagent_type as string | undefined) || 'general-purpose')
    : isMemory
      ? 'Memory operation'
      : 'Tool execution'

  return (
    <ToolDetailShell
      icon={icon}
      name={name}
      title={detailTitle}
      subtitle={detailSubtitle}
      result={result}
      isMemory={isMemory}
      onBack={onBack}
      variant={isAgent ? 'agent' : 'default'}
      noHero={isAgent}
      noBar={isAgent}
    >
      {isAgent ? (
        <AgentDetailBody name={name} input={input} result={result} onBack={onBack} />
      ) : (
        <div className="cl-tool-detail-grid">
          <section className="cl-tool-detail-panel">
            <SectionLabel label="Input" />
            <ToolInput name={name} input={input} />
          </section>

          <section className={`cl-tool-detail-panel ${result?.isError ? 'is-error' : ''}`}>
            <SectionLabel
              label={result?.isError ? 'Error' : 'Output'}
              meta={result ? `${result.content.split('\n').length} lines` : undefined}
            />
            <ToolOutput name={name} input={input} result={result} />
          </section>
        </div>
      )}
    </ToolDetailShell>
  )
}
