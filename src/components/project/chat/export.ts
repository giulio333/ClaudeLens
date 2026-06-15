import { ChatContentBlock, SessionSummary } from '../../../types'
import { fmt, fmtCost, fmtDate, fmtModel, sessionTitle } from '../utils'
import { ProcessedMessage, ToolGroup } from './utils'

export type ChatExportFormat = 'markdown' | 'pdf'
export type ChatExportPreset = 'team' | 'docs' | 'audit'

export const CHAT_EXPORT_PRESETS: Array<{
  value: ChatExportPreset
  label: string
  description: string
}> = [
  {
    value: 'team',
    label: 'Team',
    description: 'Conversation only, with compact tool notes.',
  },
  {
    value: 'docs',
    label: 'Docs',
    description: 'Readable transcript with tool summary and errors.',
  },
  {
    value: 'audit',
    label: 'Audit',
    description: 'Full transcript with thinking, tool inputs, and results.',
  },
]

type ExportOptions = {
  includeThinking: boolean
  includeToolInputs: boolean
  includeToolResults: boolean
  includeToolErrors: boolean
  includeCompactToolNotes: boolean
}

type BuildChatExportInput = {
  projectPath: string
  session: SessionSummary
  processed: ProcessedMessage[]
  preset: ChatExportPreset
}

export type ChatExportDocument = {
  title: string
  defaultBaseName: string
  markdown: string
  html: string
}

const PRESET_LABEL: Record<ChatExportPreset, string> = {
  team: 'Team summary',
  docs: 'Documentation',
  audit: 'Full audit',
}

function optionsForPreset(preset: ChatExportPreset): ExportOptions {
  return {
    includeThinking: preset === 'audit',
    includeToolInputs: preset === 'audit',
    includeToolResults: preset === 'audit',
    includeToolErrors: preset !== 'team',
    includeCompactToolNotes: preset !== 'audit',
  }
}

function turnTime(timestamp: string): string {
  const d = new Date(timestamp)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function safeSlug(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return (normalized || 'untitled-session').slice(0, 72)
}

function previewValue(value: unknown, max = 96): string {
  const text = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value)
  return text.replace(/\s+/g, ' ').trim().slice(0, max)
}

function toolPreview(input: Record<string, unknown>): string {
  return (
    previewValue(input.file_path) ||
    previewValue(input.command) ||
    previewValue(input.pattern) ||
    previewValue(input.description) ||
    previewValue(input.url) ||
    previewValue(input.prompt)
  )
}

function jsonFence(value: unknown): string {
  return fence(JSON.stringify(value, null, 2), 'json')
}

function fence(value: string, lang = 'text'): string {
  const cleaned = value.trimEnd()
  const marker = cleaned.includes('```') ? '~~~' : '```'
  return `${marker}${lang}\n${cleaned}\n${marker}`
}

function roleLabel(role: 'user' | 'assistant'): string {
  return role === 'user' ? 'User' : 'Claude'
}

function toolStatus(group: ToolGroup): string {
  if (!group.result) return 'no result'
  return group.result.isError ? 'error' : 'ok'
}

function toolLine(group: ToolGroup): string {
  const preview = toolPreview(group.use.input as Record<string, unknown>)
  const suffix = preview ? ` - ${preview}` : ''
  return `- \`${group.use.name}\`${suffix} (${toolStatus(group)})`
}

function summarizeTools(groups: ToolGroup[]): string {
  const counts = new Map<string, number>()
  groups.forEach(g => counts.set(g.use.name, (counts.get(g.use.name) ?? 0) + 1))
  return [...counts.entries()]
    .map(([name, count]) => `${name} x${count}`)
    .join(', ')
}

function allToolGroups(processed: ProcessedMessage[]): ToolGroup[] {
  return processed.flatMap(p => p.toolGroups)
}

function buildToolSummaryMarkdown(processed: ProcessedMessage[]): string[] {
  const groups = allToolGroups(processed)
  if (groups.length === 0) return []

  const counts = new Map<string, number>()
  groups.forEach(g => counts.set(g.use.name, (counts.get(g.use.name) ?? 0) + 1))

  return [
    '## Tool Summary',
    '',
    ...[...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `- \`${name}\`: ${count}`),
    '',
  ]
}

function textBlocks(blocks: ChatContentBlock[]) {
  return blocks.filter((b): b is Extract<ChatContentBlock, { type: 'text' }> => b.type === 'text')
}

function thinkingBlocks(blocks: ChatContentBlock[]) {
  return blocks.filter((b): b is Extract<ChatContentBlock, { type: 'thinking' }> => b.type === 'thinking')
}

function buildTurnMarkdown(
  processed: ProcessedMessage,
  index: number,
  options: ExportOptions,
): string[] {
  const { msg, toolGroups } = processed
  const heading = `### ${String(index + 1).padStart(2, '0')} ${roleLabel(msg.role)}${turnTime(msg.timestamp) ? ` - ${turnTime(msg.timestamp)}` : ''}`
  const lines = [heading, '']

  if (options.includeThinking) {
    for (const block of thinkingBlocks(msg.content)) {
      if (!block.thinking.trim()) continue
      lines.push('#### Thinking', '', fence(block.thinking), '')
    }
  }

  for (const block of textBlocks(msg.content)) {
    lines.push(block.text.trim(), '')
  }

  if (toolGroups.length > 0 && options.includeCompactToolNotes) {
    lines.push('#### Tool Activity', '')
    for (const group of toolGroups) {
      lines.push(toolLine(group))
      if (options.includeToolErrors && group.result?.isError) {
        lines.push(`  - Error: ${previewValue(group.result.content, 180)}`)
      }
    }
    lines.push('')
  }

  if (toolGroups.length > 0 && (options.includeToolInputs || options.includeToolResults)) {
    lines.push('#### Tool Audit', '')
    for (const group of toolGroups) {
      // Escape the tool name before embedding it in raw <summary> HTML — a tool
      // name carrying markup would otherwise inject into the Markdown export.
      lines.push(`<details>`, `<summary>${escapeHtml(group.use.name)} - ${toolStatus(group)}</summary>`, '')
      if (options.includeToolInputs) {
        lines.push('Input:', '', jsonFence(group.use.input), '')
      }
      if (options.includeToolResults && group.result) {
        lines.push(group.result.isError ? 'Error result:' : 'Result:', '', fence(group.result.content), '')
      }
      lines.push('</details>', '')
    }
  }

  return lines
}

function buildMarkdown(input: BuildChatExportInput, options: ExportOptions): string {
  const { projectPath, session, processed, preset } = input
  const title = sessionTitle(session, 120)
  const primaryModel = session.models ? Object.keys(session.models).filter(k => k !== '<synthetic>')[0] : session.model
  const lines = [
    `# ${title}`,
    '',
    `> Exported from ClaudeLens on ${fmtDate(new Date().toISOString())}`,
    `> Project: \`${projectPath}\``,
    `> Session: \`${session.filename}\``,
    `> Date: ${fmtDate(session.date)}`,
    `> Preset: ${PRESET_LABEL[preset]}`,
    primaryModel ? `> Model: ${fmtModel(primaryModel)}` : null,
    `> Tokens: ${fmt(session.totalTokens)} | Estimated cost: ${fmtCost(session.estimatedCost)}`,
    '',
  ].filter((line): line is string => line !== null)

  lines.push(...buildToolSummaryMarkdown(processed))
  lines.push('## Conversation', '')

  processed.forEach((p, i) => {
    lines.push(...buildTurnMarkdown(p, i, options))
  })

  return lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trimEnd() + '\n'
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function inlineMarkdownToHtml(line: string): string {
  return escapeHtml(line)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

function markdownSegmentToHtml(value: string): string {
  return value.split('\n').map(line => {
    const trimmed = line.trim()
    if (!trimmed) return '<div class="spacer"></div>'

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      const level = Math.min(heading[1].length + 1, 5)
      return `<h${level}>${inlineMarkdownToHtml(heading[2])}</h${level}>`
    }

    const unordered = trimmed.match(/^[-*]\s+(.+)$/)
    if (unordered) return `<div class="md-list">- ${inlineMarkdownToHtml(unordered[1])}</div>`

    const ordered = trimmed.match(/^(\d+)\.\s+(.+)$/)
    if (ordered) return `<div class="md-list">${ordered[1]}. ${inlineMarkdownToHtml(ordered[2])}</div>`

    return `<p>${inlineMarkdownToHtml(line)}</p>`
  }).join('')
}

function markdownToHtml(value: string): string {
  const fenceRe = /```([^\n`]*)\n([\s\S]*?)```/g
  let html = ''
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = fenceRe.exec(value)) !== null) {
    html += markdownSegmentToHtml(value.slice(cursor, match.index))
    const lang = match[1].trim()
    html += `<pre><span>${escapeHtml(lang || 'text')}</span><code>${escapeHtml(match[2].trimEnd())}</code></pre>`
    cursor = fenceRe.lastIndex
  }

  html += markdownSegmentToHtml(value.slice(cursor))
  return html
}

function renderToolHtml(group: ToolGroup, options: ExportOptions): string {
  const preview = toolPreview(group.use.input as Record<string, unknown>)
  const status = toolStatus(group)
  const statusClass = status === 'error' ? 'is-error' : status === 'ok' ? 'is-ok' : ''

  if (options.includeToolInputs || options.includeToolResults) {
    return `
      <section class="tool-audit">
        <div class="tool-head">
          <strong>${escapeHtml(group.use.name)}</strong>
          <span class="${statusClass}">${escapeHtml(status)}</span>
        </div>
        ${options.includeToolInputs ? `<h5>Input</h5><pre><code>${escapeHtml(JSON.stringify(group.use.input, null, 2))}</code></pre>` : ''}
        ${options.includeToolResults && group.result ? `<h5>${group.result.isError ? 'Error result' : 'Result'}</h5><pre><code>${escapeHtml(group.result.content)}</code></pre>` : ''}
      </section>
    `
  }

  const error = options.includeToolErrors && group.result?.isError
    ? `<div class="tool-error">${escapeHtml(previewValue(group.result.content, 220))}</div>`
    : ''

  return `
    <div class="tool-note">
      <span>${escapeHtml(group.use.name)}</span>
      ${preview ? `<em>${escapeHtml(preview)}</em>` : ''}
      <b class="${statusClass}">${escapeHtml(status)}</b>
      ${error}
    </div>
  `
}

function renderTurnHtml(processed: ProcessedMessage, index: number, options: ExportOptions): string {
  const { msg, toolGroups } = processed
  const time = turnTime(msg.timestamp)
  const role = roleLabel(msg.role)
  const textHtml = textBlocks(msg.content)
    .map(block => `<div class="message-text">${markdownToHtml(block.text)}</div>`)
    .join('')
  const thinkingHtml = options.includeThinking
    ? thinkingBlocks(msg.content)
      .filter(block => block.thinking.trim())
      .map(block => `<div class="thinking"><strong>Thinking</strong>${markdownToHtml(block.thinking)}</div>`)
      .join('')
    : ''
  const toolsHtml = toolGroups.length > 0
    ? `<div class="turn-tools">${toolGroups.map(group => renderToolHtml(group, options)).join('')}</div>`
    : ''

  return `
    <article class="turn ${msg.role === 'user' ? 'is-user' : 'is-assistant'}">
      <aside>
        <strong>${String(index + 1).padStart(2, '0')}</strong>
        <span>${escapeHtml(role)}</span>
        ${time ? `<small>${escapeHtml(time)}</small>` : ''}
      </aside>
      <main>
        ${thinkingHtml}
        ${textHtml || '<p class="muted">No visible message text.</p>'}
        ${toolsHtml}
      </main>
    </article>
  `
}

function buildHtml(input: BuildChatExportInput, options: ExportOptions): string {
  const { projectPath, session, processed, preset } = input
  const title = sessionTitle(session, 120)
  const toolGroups = allToolGroups(processed)
  const toolSummary = summarizeTools(toolGroups)
  const primaryModel = session.models ? Object.keys(session.models).filter(k => k !== '<synthetic>')[0] : session.model

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4; margin: 18mm 16mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #2f2b27;
      background: #ffffff;
      font: 13px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    h1, h2, h3, h4, h5, p { margin: 0; }
    h1 { font-size: 28px; line-height: 1.08; letter-spacing: -0.02em; margin-bottom: 14px; }
    h2 { font-size: 18px; margin: 28px 0 12px; border-bottom: 1px solid #d9d5cb; padding-bottom: 8px; }
    h3 { font-size: 15px; margin: 18px 0 8px; }
    h4, h5 { font-size: 12px; margin: 12px 0 6px; text-transform: uppercase; letter-spacing: 0.08em; color: #756f65; }
    p { margin: 0 0 9px; }
    code, pre { font-family: "SFMono-Regular", Consolas, monospace; }
    code { background: #f4f3ee; padding: 1px 4px; border-radius: 3px; }
    pre {
      position: relative;
      margin: 8px 0 12px;
      padding: 13px 14px;
      border: 1px solid #d9d5cb;
      background: #f4f3ee;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      break-inside: auto;
    }
    pre span {
      position: absolute;
      top: 5px;
      right: 8px;
      color: #8e887f;
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }
    pre code { display: block; background: transparent; padding: 0; border-radius: 0; }
    .cover {
      border-bottom: 3px solid #2f2b27;
      padding-bottom: 18px;
      margin-bottom: 22px;
    }
    .eyebrow {
      color: #c15f3c;
      font: 700 10px/1 "SFMono-Regular", Consolas, monospace;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      margin-bottom: 11px;
    }
    .meta {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px 22px;
      color: #5f5a52;
      font-size: 11px;
    }
    .meta b { color: #2f2b27; }
    .stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      border-top: 1px solid #2f2b27;
      border-bottom: 1px solid #d9d5cb;
      margin: 18px 0 16px;
    }
    .stat { padding: 10px 12px; border-left: 1px solid #d9d5cb; }
    .stat:first-child { border-left: 0; }
    .stat span { display: block; color: #756f65; font: 700 9px/1 "SFMono-Regular", Consolas, monospace; letter-spacing: 0.16em; text-transform: uppercase; }
    .stat strong { display: block; margin-top: 6px; font-size: 18px; line-height: 1; }
    .tool-strip {
      background: #f4f3ee;
      border: 1px solid #d9d5cb;
      padding: 9px 11px;
      color: #5f5a52;
      font-family: "SFMono-Regular", Consolas, monospace;
      font-size: 10px;
    }
    .turn {
      display: grid;
      grid-template-columns: 68px minmax(0, 1fr);
      border-top: 1px solid #d9d5cb;
    }
    .turn aside {
      padding: 14px 8px;
      border-right: 1px solid #d9d5cb;
      background: #2f2b27;
      color: #ffffff;
      text-align: center;
    }
    .turn.is-user aside { background: #c15f3c; }
    .turn aside strong { display: block; font-size: 20px; line-height: 1; }
    .turn aside span { display: block; margin-top: 8px; font: 700 9px/1 "SFMono-Regular", Consolas, monospace; letter-spacing: 0.12em; text-transform: uppercase; }
    .turn aside small { display: block; margin-top: 8px; opacity: 0.72; font-size: 9px; }
    .turn main { padding: 15px 18px 18px; }
    .message-text { margin-bottom: 10px; }
    .md-list { margin: 0 0 4px 12px; }
    .spacer { height: 7px; }
    .muted { color: #8e887f; font-style: italic; }
    .thinking {
      border-left: 3px solid #b1ada1;
      background: #f4f3ee;
      color: #5f5a52;
      padding: 10px 12px;
      margin-bottom: 12px;
    }
    .thinking strong { display: block; margin-bottom: 6px; color: #756f65; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; }
    .turn-tools { margin-top: 12px; display: grid; gap: 7px; }
    .tool-note, .tool-audit {
      border: 1px solid #d9d5cb;
      background: #faf9f6;
      padding: 9px 10px;
    }
    .tool-note span, .tool-head strong { font-family: "SFMono-Regular", Consolas, monospace; font-weight: 700; }
    .tool-note em { color: #756f65; font-style: normal; margin-left: 8px; }
    .tool-note b, .tool-head span { float: right; color: #756f65; font-size: 10px; text-transform: uppercase; }
    .tool-note .is-ok, .tool-head .is-ok { color: #3f7c55; }
    .tool-note .is-error, .tool-head .is-error, .tool-error { color: #a9432a; }
    .tool-error { clear: both; margin-top: 6px; font-family: "SFMono-Regular", Consolas, monospace; font-size: 11px; }
    .tool-head { overflow: hidden; margin-bottom: 8px; }
    .footer {
      margin-top: 24px;
      padding-top: 10px;
      border-top: 1px solid #d9d5cb;
      color: #8e887f;
      font-size: 10px;
    }
  </style>
</head>
<body>
  <section class="cover">
    <div class="eyebrow">ClaudeLens Export</div>
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">
      <div><b>Project</b> ${escapeHtml(projectPath)}</div>
      <div><b>Session</b> ${escapeHtml(session.filename)}</div>
      <div><b>Date</b> ${escapeHtml(fmtDate(session.date))}</div>
      <div><b>Preset</b> ${escapeHtml(PRESET_LABEL[preset])}</div>
      ${primaryModel ? `<div><b>Model</b> ${escapeHtml(fmtModel(primaryModel))}</div>` : ''}
      <div><b>Exported</b> ${escapeHtml(fmtDate(new Date().toISOString()))}</div>
    </div>
    <div class="stats">
      <div class="stat"><span>Messages</span><strong>${fmt(processed.length)}</strong></div>
      <div class="stat"><span>Tokens</span><strong>${fmt(session.totalTokens)}</strong></div>
      <div class="stat"><span>Cost</span><strong>${fmtCost(session.estimatedCost)}</strong></div>
    </div>
    ${toolSummary ? `<div class="tool-strip">Tools: ${escapeHtml(toolSummary)}</div>` : ''}
  </section>
  <h2>Conversation</h2>
  ${processed.map((p, i) => renderTurnHtml(p, i, options)).join('')}
  <div class="footer">Generated by ClaudeLens. Review exports before sharing outside your organization.</div>
</body>
</html>`
}

export function buildChatExportDocument(input: BuildChatExportInput): ChatExportDocument {
  const options = optionsForPreset(input.preset)
  const title = sessionTitle(input.session, 120)
  const base = [
    'claudelens',
    safeSlug(title),
    input.session.filename.replace(/\.jsonl$/i, ''),
    input.preset,
  ].filter(Boolean).join('-')

  return {
    title,
    defaultBaseName: base,
    markdown: buildMarkdown(input, options),
    html: buildHtml(input, options),
  }
}
