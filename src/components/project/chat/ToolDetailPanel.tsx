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
}: {
  icon: string
  name: string
  title: string
  subtitle?: string
  result: ToolGroup['result']
  isMemory: boolean
  onBack: () => void
  children: ReactNode
}) {
  const status = result ? (result.isError ? 'Error' : 'Complete') : 'Pending'
  const statusClass = result ? (result.isError ? 'is-error' : 'is-ok') : 'is-pending'

  return (
    <div className="cl-tool-detail">
      <div className="cl-tool-detail-bar">
        <button type="button" onClick={onBack} className="cl-tool-detail-back">
          <BackChevron />
          <span>Back to chat</span>
        </button>
        <span className="cl-tool-detail-sep">/</span>
        <span className="cl-tool-detail-mini-icon">{icon}</span>
        <span className="cl-tool-detail-mini-title">{name}</span>
      </div>

      <div className="cl-tool-detail-scroll">
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
        {children}
      </div>
    </div>
  )
}

function AgentDetailBody({
  name,
  input,
  result,
}: {
  name: string
  input: Record<string, unknown>
  result: ToolGroup['result']
}) {
  const subtype = (input.subagent_type as string | undefined) || (name === 'Task' ? 'task' : 'general-purpose')
  const description = (input.description as string | undefined) || 'Agent dispatch'
  const prompt = (input.prompt as string | undefined) || ''
  const parsed = parseAgentResult(result?.content ?? '')
  const cleanOutput = parsed.cleanContent || result?.content || ''
  const duration = formatDuration(parsed.durationMs)
  const facts = [
    { label: 'Status', value: result?.isError ? 'Error' : result ? 'Complete' : 'Pending', tone: result?.isError ? 'is-error' : 'is-ok' },
    { label: 'Output', value: result ? `${outputLineCount(result)} lines` : '-' },
    ...(parsed.toolUses !== undefined ? [{ label: 'Tool uses', value: String(parsed.toolUses) }] : []),
    ...(parsed.totalTokens !== undefined ? [{ label: 'Tokens', value: String(parsed.totalTokens) }] : []),
    ...(duration ? [{ label: 'Duration', value: duration }] : []),
    ...(parsed.agentId ? [{ label: 'Agent ID', value: `${parsed.agentId.slice(0, 10)}...`, title: parsed.agentId }] : []),
  ]

  return (
    <div className="cl-agent-run-sheet">
      <div className="cl-agent-run-strip">
        <div className="cl-agent-run-id">
          <span>Agent</span>
          <strong>{subtype}</strong>
        </div>
        <div className="cl-agent-run-facts">
          {facts.map(fact => (
            <div key={fact.label}>
              <span>{fact.label}</span>
              <strong className={fact.tone} title={fact.title}>{fact.value}</strong>
            </div>
          ))}
        </div>
      </div>

      <div className="cl-agent-sheet-grid">
        <section className="cl-agent-sheet cl-agent-sheet--prompt">
          <div className="cl-agent-sheet-head">
            <OpenBoxIcon />
            <div>
              <span>Input brief</span>
              <strong>{description}</strong>
            </div>
          </div>
          {prompt && (
            <div className="cl-agent-prompt">
              <div className="cl-agent-prompt-label">Prompt</div>
              <pre>{prompt}</pre>
            </div>
          )}
        </section>

        <section className={`cl-agent-sheet cl-agent-sheet--output ${result?.isError ? 'is-error' : ''}`}>
          <div className="cl-agent-sheet-head">
            <ResultIcon error={Boolean(result?.isError)} />
            <div>
              <span>{result?.isError ? 'Error' : 'Output'}</span>
              <strong>{result ? `${outputLineCount(result)} lines` : 'No result'}</strong>
            </div>
          </div>
          {!result ? (
            <p className="cl-agent-empty">No result available.</p>
          ) : result.isError ? (
            <pre className="cl-agent-error">{cleanOutput || '(no output)'}</pre>
          ) : (
            <div className="cl-agent-markdown">
              <Markdown>{cleanOutput || '(no output)'}</Markdown>
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
    >
      {isAgent ? (
        <AgentDetailBody name={name} input={input} result={result} />
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
