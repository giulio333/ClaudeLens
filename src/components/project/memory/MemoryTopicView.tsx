import { useState } from 'react'
import Markdown from '../../Markdown'
import { MemoryTopic } from '../../../hooks/useIPC'
import { BackButton } from '../shared/BackButton'
import { parseMemoryContent, readingTime, formatDate, Heading } from './utils'

const TYPE_META: Record<string, { label: string; bg: string; text: string; dot: string; border: string }> = {
  user:      { label: 'User',      bg: 'bg-blue-950/20',    text: 'text-blue-400',    dot: 'bg-blue-400',    border: 'border-blue-700/40' },
  feedback:  { label: 'Feedback',  bg: 'bg-amber-950/20',   text: 'text-amber-400',   dot: 'bg-amber-400',   border: 'border-amber-700/40' },
  project:   { label: 'Project',   bg: 'bg-emerald-950/20', text: 'text-emerald-400', dot: 'bg-emerald-400', border: 'border-emerald-700/40' },
  reference: { label: 'Reference', bg: 'bg-violet-950/20',  text: 'text-violet-400',  dot: 'bg-violet-400',  border: 'border-violet-700/40' },
}

function SidebarLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">{children}</p>
}

function SidebarRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <SidebarLabel>{label}</SidebarLabel>
      <p className="text-[13px] text-[#9096b0] leading-snug">{value}</p>
    </div>
  )
}

export function MemoryTopicView({
  topic,
  content,
  onBack,
}: {
  topic: MemoryTopic
  content: string
  onBack: () => void
}) {
  const [showRaw, setShowRaw] = useState(false)
  const [showOutline, setShowOutline] = useState(false)
  const [copied, setCopied] = useState(false)
  const { body, wordCount, charCount, linkCount, headings } = parseMemoryContent(content)
  const meta = TYPE_META[topic.type] ?? TYPE_META.user
  const createdAt = topic.createdAt ?? null
  const updatedAt = topic.updatedAt ?? null
  const sameDate = createdAt && updatedAt
    ? createdAt.slice(0, 10) === updatedAt.slice(0, 10)
    : true

  const handleCopy = () => {
    navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="h-full overflow-hidden" style={{ display: 'grid', gridTemplateRows: 'auto 1fr' }}>
      <div className="bg-[#0d0f14]/95 backdrop-blur-sm border-b border-[#252836] px-8 py-4">
        <div className="flex items-center gap-4 mb-2">
          <BackButton label="Overview" onClick={onBack} />
        </div>
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${meta.bg} ${meta.text} ring-1 ${meta.border}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
            {meta.label}
          </span>
          <h1 className="text-[17px] font-semibold text-[#e0e2f0]">{topic.name}</h1>
        </div>
        {topic.description && (
          <p className="text-[13px] text-zinc-500 mt-1.5 ml-[1px]">{topic.description}</p>
        )}
      </div>

      <div className="overflow-hidden flex">
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="flex items-center gap-0.5 border-b border-[#252836] bg-[#161a26] px-8 h-10 shrink-0">
            <button
              onClick={() => setShowRaw(false)}
              className={`px-3 py-2 text-[13px] font-medium transition-colors border-b-2 ${
                !showRaw
                  ? 'text-[#e0e2f0] border-zinc-900'
                  : 'text-zinc-400 border-transparent hover:text-[#787e98]'
              }`}
            >
              View
            </button>
            <button
              onClick={() => setShowRaw(true)}
              className={`px-3 py-2 text-[13px] font-medium transition-colors border-b-2 ${
                showRaw
                  ? 'text-[#e0e2f0] border-zinc-900'
                  : 'text-zinc-400 border-transparent hover:text-[#787e98]'
              }`}
            >
              Raw
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-8 py-7">
            {!showRaw ? (
              <div className="prose prose-zinc prose-sm max-w-none prose-lens">
                <Markdown>{body}</Markdown>
              </div>
            ) : (
              <pre className="bg-zinc-900 text-zinc-100 p-4 rounded-lg font-mono text-[11px] leading-relaxed overflow-x-auto">
                <code>{content}</code>
              </pre>
            )}
          </div>
        </div>

        <aside className="w-[220px] shrink-0 border-l border-[#252836] bg-[#0d0f14] overflow-y-auto px-5 py-6 space-y-5">
          <div className="space-y-4">
            {createdAt && <SidebarRow label="Created" value={formatDate(createdAt)} />}
            {updatedAt && !sameDate && (
              <SidebarRow label="Updated" value={formatDate(updatedAt)} />
            )}
          </div>

          <div className="border-t border-[#252836]" />

          <div className="space-y-4">
            <SidebarRow label="Reading" value={readingTime(wordCount)} />
            <SidebarRow label="Words" value={String(wordCount)} />
            <SidebarRow label="Characters" value={String(charCount)} />
            <SidebarRow label="Links" value={String(linkCount)} />
            <div>
              <SidebarLabel>File</SidebarLabel>
              <p className="text-[11px] text-zinc-500 font-mono break-all leading-relaxed">{topic.filename}</p>
            </div>
          </div>

          <div className="border-t border-[#252836]" />

          <div className="space-y-2">
            <button
              onClick={handleCopy}
              className="w-full text-[12px] font-medium px-3 py-2 rounded-md bg-[#1c2133] hover:bg-zinc-200 text-[#9096b0] transition-colors"
            >
              {copied ? '✓ Copied' : 'Copy raw'}
            </button>
            {headings.length > 0 && (
              <button
                onClick={() => setShowOutline(!showOutline)}
                className="w-full text-[12px] font-medium px-3 py-2 rounded-md bg-[#1c2133] hover:bg-zinc-200 text-[#9096b0] transition-colors"
              >
                {showOutline ? 'Close' : 'Outline'}
              </button>
            )}
          </div>

          {showOutline && headings.length > 0 && (
            <>
              <div className="border-t border-[#252836]" />
              <div>
                <SidebarLabel>Outline</SidebarLabel>
                <div className="space-y-1 text-[11px] text-[#787e98]">
                  {headings.map((h: Heading, idx: number) => (
                    <div
                      key={idx}
                      className="truncate"
                      style={{ paddingLeft: `${(h.level - 1) * 10}px` }}
                    >
                      <span className="text-zinc-400">{'▸'.repeat(1)}</span> <span className="truncate">{h.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
