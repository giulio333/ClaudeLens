import Markdown from '../../Markdown'
import { ToolGroup, isMemoryFile, resolveToolIcon, stripLineNumbers, fileExt } from './utils'
import { PathChip, SectionLabel, CodeBlock } from './atoms'

function ToolInput({ name, input }: { name: string; input: Record<string, unknown> }) {
  if (name === 'Read') {
    const fp = input.file_path as string
    const ext = fileExt(fp)
    return (
      <div className="space-y-3">
        <PathChip path={fp} />
        {ext && <span className="inline-block text-[10px] font-mono bg-indigo-950/20 text-indigo-400 border border-indigo-700/40 rounded px-2 py-0.5">.{ext}</span>}
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
            <CodeBlock code={oldStr} dark={false} className="border-red-700/40 opacity-75" />
            <SectionLabel label="New text" />
            <CodeBlock code={newStr ?? ''} dark={false} className="border-emerald-700/40" />
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
        {desc && <p className="text-[12px] text-[#787e98] italic">{desc}</p>}
        <div className="rounded-lg bg-zinc-900 border border-zinc-700 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800 border-b border-zinc-700">
            <span className="w-2.5 h-2.5 rounded-full bg-red-950/200/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-green-500/70" />
            <span className="text-[10px] text-zinc-400 ml-1">shell</span>
          </div>
          <pre className="px-4 py-3 text-[12px] font-mono text-emerald-400 whitespace-pre-wrap break-words">
            <span className="text-zinc-500 select-none">$ </span>{cmd}
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
          <span className="text-[11px] text-zinc-500">Pattern:</span>
          <code className="bg-amber-950/20 border border-amber-700/40 text-amber-800 rounded px-2 py-0.5 text-[12px] font-mono">{pattern}</code>
          {mode && <span className="text-[10px] bg-[#1c2133] border border-[#252836] text-[#787e98] rounded px-2 py-0.5 font-mono">{mode}</span>}
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
          <span className="text-[11px] text-zinc-500">Pattern:</span>
          <code className="bg-amber-950/20 border border-amber-700/40 text-amber-800 rounded px-2 py-0.5 text-[12px] font-mono">{pattern}</code>
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
          <span className="inline-block text-[11px] font-semibold bg-indigo-950/20 text-indigo-400 border border-indigo-700/40 rounded-full px-3 py-1">
            {subtype}
          </span>
        )}
        {desc && <p className="text-[13px] font-medium text-[#9096b0]">{desc}</p>}
        <div className="rounded-lg bg-[#0d0f14] border border-[#252836] px-4 py-3">
          <p className="text-[12px] text-[#787e98] whitespace-pre-wrap leading-relaxed">{prompt}</p>
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
              type === 'user' ? 'bg-blue-950/20 text-blue-400 border border-blue-700/40' :
              type === 'feedback' ? 'bg-amber-950/20 text-amber-400 border border-amber-700/40' :
              type === 'project' ? 'bg-emerald-950/20 text-emerald-400 border border-emerald-700/40' :
              'bg-violet-950/20 text-violet-400 border border-violet-700/40'
            }`}>{type}</span>
          )}
          {topicName && <span className="text-[12px] font-semibold text-[#c4c8e0] font-mono">{topicName}</span>}
        </div>
        {desc && <p className="text-[12px] text-[#787e98]">{desc}</p>}
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
        {topicName && <span className="text-[12px] font-semibold text-[#c4c8e0] font-mono">{topicName}</span>}
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
        {filename ? <PathChip path={filename} /> : <p className="text-[12px] text-zinc-400">No filename</p>}
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
  if (!result) return <p className="text-[12px] text-zinc-400 italic">No result available</p>

  const raw = result.content
  if (!raw) return <p className="text-[12px] text-zinc-400 italic">(no output)</p>

  if (result.isError) {
    return (
      <div className="rounded-lg bg-red-950/20 border border-red-700/40 px-4 py-3">
        <pre className="text-[12px] text-red-800 font-mono whitespace-pre-wrap break-words leading-relaxed">{raw}</pre>
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
          {ext && <span className="text-[10px] font-mono bg-[#1c2133] border border-[#252836] text-[#787e98] rounded px-2 py-0.5">.{ext}</span>}
        </div>
        <CodeBlock code={stripped} dark={false} />
      </div>
    )
  }

  if (name === 'Bash') {
    return (
      <div className="rounded-lg bg-zinc-900 border border-zinc-700 overflow-hidden">
        <div className="px-3 py-1.5 bg-zinc-800 border-b border-zinc-700 text-[10px] text-zinc-400">output</div>
        <pre className="px-4 py-3 text-[12px] font-mono text-zinc-200 whitespace-pre-wrap break-words leading-relaxed max-h-[400px] overflow-y-auto">
          {raw || '(no output)'}
        </pre>
      </div>
    )
  }

  if (name === 'Agent') {
    return (
      <div className="bg-[#161a26] border border-[#252836] rounded-lg px-5 py-4">
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
          <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#0d0f14] border border-[#1c2030] text-[12px] font-mono text-[#9096b0] hover:bg-[#1c2133] transition-colors">
            <span className="text-zinc-400 shrink-0 text-[10px]">{i + 1}</span>
            <span className="truncate">{p}</span>
          </div>
        ))}
        {paths.length === 0 && <p className="text-[12px] text-zinc-400 italic">No files found</p>}
      </div>
    )
  }

  if (name === 'Grep') {
    const lines = raw.split('\n').filter(Boolean)
    return (
      <div className="rounded-lg bg-[#0d0f14] border border-[#252836] overflow-hidden">
        {lines.map((line, i) => (
          <div key={i} className="flex items-start gap-3 px-3 py-1.5 border-b border-[#1c2030] last:border-0 hover:bg-[#161a26] transition-colors">
            <span className="text-zinc-300 text-[10px] font-mono shrink-0 pt-0.5">{i + 1}</span>
            <pre className="text-[11px] font-mono text-[#9096b0] whitespace-pre-wrap break-words flex-1">{line}</pre>
          </div>
        ))}
        {lines.length === 0 && <p className="px-3 py-2 text-[12px] text-zinc-400 italic">No results</p>}
      </div>
    )
  }

  if (name.startsWith('memory:')) {
    try {
      const json = JSON.parse(raw)
      if (name === 'memory:createTopic' || name === 'memory:updateTopic') {
        const filename = json.data?.filename || json.filename
        return filename ? (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-950/20 border border-emerald-700/40">
            <span className="text-emerald-400 text-[13px]">✓</span>
            <span className="text-[12px] text-emerald-800 font-mono">{filename}</span>
          </div>
        ) : (
          <p className="text-[12px] text-[#787e98]">Operation completed.</p>
        )
      }
      if (name === 'memory:deleteTopic') {
        return (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-950/20 border border-emerald-700/40">
            <span className="text-emerald-400 text-[13px]">✓</span>
            <span className="text-[12px] text-emerald-800">Topic deleted.</span>
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

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 flex items-center gap-3 px-8 py-3 border-b border-[#252836] bg-[#0d0f14]/80">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-[12px] text-zinc-500 hover:text-[#c4c8e0] transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10 3L5 8l5 5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back to chat
        </button>
        <span className="text-zinc-300">·</span>
        <span className="text-base">{icon}</span>
        <span className="text-[13px] font-mono font-semibold text-[#9096b0]">{name}</span>
        {isMemory && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-400 border border-violet-700/40 uppercase tracking-wide">Memory</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6 max-w-4xl mx-auto w-full">
        <div>
          <SectionLabel label="Input" />
          <ToolInput name={name} input={input} />
        </div>

        <div className="border-t border-[#252836]" />

        <div>
          <SectionLabel
            label={result?.isError ? '⚠️ Error' : 'Output'}
            meta={result ? `${result.content.split('\n').length} lines` : undefined}
          />
          <ToolOutput name={name} input={input} result={result} />
        </div>
      </div>
    </div>
  )
}
