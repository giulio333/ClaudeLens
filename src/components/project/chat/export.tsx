import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ChatContentBlock, SessionSummary } from '../../../types'
import { fmt, fmtCost, fmtDate, fmtModel, sessionTitle } from '../utils'
import { ProcessedMessage, ToolGroup } from './utils'
import {
  Highlight,
  exportHighlightCss,
  materializeHighlightSentinels,
  wrapHighlightsWithSentinels,
} from './highlights'

export type ChatExportFormat = 'markdown' | 'pdf'
export type ChatExportPreset = 'message' | 'team' | 'docs' | 'audit'

export const CHAT_EXPORT_PRESETS: Array<{
  value: ChatExportPreset
  label: string
  description: string
}> = [
  {
    value: 'message',
    label: 'Message',
    description: 'Message text only — no tools, thinking, or agents.',
  },
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
  session: SessionSummary
  processed: ProcessedMessage[]
  preset: ChatExportPreset
  /** Persistent text highlights to bake into the export as <mark>. */
  highlights?: Highlight[]
}

export type ChatExportDocument = {
  title: string
  defaultBaseName: string
  markdown: string
  html: string
}

const PRESET_LABEL: Record<ChatExportPreset, string> = {
  message: 'Message only',
  team: 'Team summary',
  docs: 'Documentation',
  audit: 'Full audit',
}

function optionsForPreset(preset: ChatExportPreset): ExportOptions {
  // "Message only" strips everything but the visible message text — the export
  // equivalent of the per-turn copy button.
  if (preset === 'message') {
    return {
      includeThinking: false,
      includeToolInputs: false,
      includeToolResults: false,
      includeToolErrors: false,
      includeCompactToolNotes: false,
    }
  }
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

function allToolGroups(processed: ProcessedMessage[]): ToolGroup[] {
  return processed.flatMap(p => p.toolGroups)
}

/** Whether the chosen options surface any tool content at all (false for the
 *  "Message only" preset) — used to drop the tool summary / strip from headers. */
function showsTools(options: ExportOptions): boolean {
  return (
    options.includeCompactToolNotes ||
    options.includeToolInputs ||
    options.includeToolResults ||
    options.includeToolErrors
  )
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

/** Highlights belonging to one text block of a message (same indexing as the
 *  rendered MessageBubble: position within the message's text blocks). */
function blockHighlights(highlights: Highlight[], uuid: string, blockIndex: number): Highlight[] {
  return highlights.filter(h => h.messageUuid === uuid && h.blockIndex === blockIndex)
}

function buildTurnMarkdown(
  processed: ProcessedMessage,
  index: number,
  options: ExportOptions,
  highlights: Highlight[],
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

  textBlocks(msg.content).forEach((block, blockIndex) => {
    const hls = blockHighlights(highlights, msg.uuid, blockIndex)
    // Highlights bake in as inline <mark> (renders on GitHub & most viewers); a
    // quote that can't be located literally is dropped, text left intact.
    const text = hls.length > 0
      ? materializeHighlightSentinels(wrapHighlightsWithSentinels(block.text, hls))
      : block.text
    lines.push(text.trim(), '')
  })

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
  const { session, processed, preset } = input
  const title = sessionTitle(session, 120)
  const primaryModel = session.models ? Object.keys(session.models).filter(k => k !== '<synthetic>')[0] : session.model
  // The absolute project path is deliberately omitted — it can leak the username
  // and internal directory structure into a shared export.
  const lines = [
    `# ${title}`,
    '',
    `> Exported from ClaudeLens on ${fmtDate(new Date().toISOString())}`,
    `> Session: \`${session.filename}\``,
    `> Date: ${fmtDate(session.date)}`,
    `> Preset: ${PRESET_LABEL[preset]}`,
    primaryModel ? `> Model: ${fmtModel(primaryModel)}` : null,
    `> Tokens: ${fmt(session.totalTokens)} | Estimated cost: ${fmtCost(session.estimatedCost)}`,
    '',
  ].filter((line): line is string => line !== null)

  if (showsTools(options)) lines.push(...buildToolSummaryMarkdown(processed))
  lines.push('## Conversation', '')

  const highlights = input.highlights ?? []
  processed.forEach((p, i) => {
    lines.push(...buildTurnMarkdown(p, i, options, highlights))
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

// Render markdown to a static HTML string using the SAME react-markdown pipeline
// as the live chat view (GFM: tables, strikethrough, autolinks, task lists), so
// the export matches what's on screen — no hand-rolled mini-parser to keep in
// sync. rehype-highlight / katex are intentionally omitted: their output needs
// external CSS this standalone document doesn't ship, so we keep plain <pre><code>.
// Highlight sentinels (PUA chars) injected into `value` pass through untouched and
// are materialized into <mark> by the caller.
function markdownToHtml(value: string): string {
  return renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>,
  )
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

function renderTurnHtml(
  processed: ProcessedMessage,
  _index: number,
  options: ExportOptions,
  highlights: Highlight[],
): string {
  const { msg, toolGroups } = processed
  const time = turnTime(msg.timestamp)
  const role = roleLabel(msg.role)
  const textHtml = textBlocks(msg.content)
    .map((block, blockIndex) => {
      const hls = blockHighlights(highlights, msg.uuid, blockIndex)
      // Sentinels are injected into the raw text, pass through react-markdown as
      // plain text (PUA chars), then become real <mark> tags.
      const html = hls.length > 0
        ? materializeHighlightSentinels(markdownToHtml(wrapHighlightsWithSentinels(block.text, hls)))
        : markdownToHtml(block.text)
      return `<div class="message-text">${html}</div>`
    })
    .join('')
  const thinkingHtml = options.includeThinking
    ? thinkingBlocks(msg.content)
      .filter(block => block.thinking.trim())
      .map(block => `<div class="thinking"><strong>Thinking</strong>${markdownToHtml(block.thinking)}</div>`)
      .join('')
    : ''
  const toolsHtml = toolGroups.length > 0 && showsTools(options)
    ? `<div class="turn-tools">${toolGroups.map(group => renderToolHtml(group, options)).join('')}</div>`
    : ''
  const model = msg.role === 'assistant' && msg.model && msg.model !== '<synthetic>'
    ? `<span class="turn-model">${escapeHtml(fmtModel(msg.model))}</span>`
    : ''

  // Clean reading column matching the ClaudeLens chat view: a small textual
  // header (role · time · model) over the message body — no colored rail.
  return `
    <article class="turn ${msg.role === 'user' ? 'is-user' : 'is-assistant'}">
      <header class="turn-head">
        <span class="turn-who">${escapeHtml(role)}</span>
        ${time ? `<span class="turn-sep">·</span><time>${escapeHtml(time)}</time>` : ''}
        ${model ? `<span class="turn-sep">·</span>${model}` : ''}
      </header>
      ${thinkingHtml}
      ${textHtml || '<p class="muted">No visible message text.</p>'}
      ${toolsHtml}
    </article>
  `
}

function buildHtml(input: BuildChatExportInput, options: ExportOptions): string {
  const { session, processed } = input
  const title = sessionTitle(session, 120)
  const primaryModel = session.models ? Object.keys(session.models).filter(k => k !== '<synthetic>')[0] : session.model

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4; margin: 20mm 18mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #2f2b27;
      background: #ffffff;
      font: 13.5px/1.62 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .sheet { max-width: 660px; margin: 0 auto; }
    h1, h2, h3, h4, h5, p { margin: 0; }
    h1 { font-size: 24px; line-height: 1.12; letter-spacing: -0.02em; }
    h2 { font-size: 17px; margin: 20px 0 9px; }
    h3 { font-size: 15px; margin: 16px 0 7px; }
    h4, h5 { font-size: 11px; margin: 12px 0 6px; text-transform: uppercase; letter-spacing: 0.08em; color: #7c7669; }
    p { margin: 0 0 10px; }
    a { color: #a9462a; }
    code, pre { font-family: "SFMono-Regular", Consolas, monospace; }
    code { background: #f4f3ee; padding: 1px 5px; border-radius: 4px; font-size: 0.92em; }
    pre {
      position: relative;
      margin: 10px 0 14px;
      padding: 13px 14px;
      border: 1px solid #e2ded4;
      border-radius: 8px;
      background: #f7f6f1;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      break-inside: auto;
    }
    pre code { display: block; background: transparent; padding: 0; border-radius: 0; }
    /* Slim masthead — title + one hairline meta line, no report cover. */
    .masthead { border-bottom: 1px solid #e2ded4; padding-bottom: 16px; margin-bottom: 8px; }
    .eyebrow {
      color: #c15f3c;
      font: 700 10px/1 "SFMono-Regular", Consolas, monospace;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      margin-bottom: 10px;
    }
    .submeta { margin-top: 10px; color: #7c7669; font-size: 10.5px; font-family: "SFMono-Regular", Consolas, monospace; }
    .submeta span { white-space: nowrap; }
    .submeta i { color: #c9c3b6; font-style: normal; margin: 0 7px; }
    /* Reading column: one turn after another, hairline separated, no rail. */
    .turn { padding: 18px 0; border-top: 1px solid #efece4; }
    .turn:first-of-type { border-top: 0; }
    .turn-head {
      display: flex;
      align-items: center;
      gap: 7px;
      margin-bottom: 9px;
      font-family: "SFMono-Regular", Consolas, monospace;
      font-size: 10.5px;
    }
    .turn-who { font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; }
    .turn.is-assistant .turn-who { color: #a9462a; }
    .turn.is-user .turn-who { color: #2f2b27; }
    .turn-sep { color: #c9c3b6; }
    .turn-head time { color: #9a948a; }
    .turn-model { color: #7c7669; }
    .message-text { margin-bottom: 8px; }
    .message-text > :first-child { margin-top: 0; }
    .message-text > :last-child { margin-bottom: 0; }
    ${exportHighlightCss()}
    /* Markdown body elements (react-markdown + GFM output). */
    em { font-style: italic; }
    strong { font-weight: 700; }
    ul, ol { margin: 0 0 10px; padding-left: 22px; }
    li { margin: 0 0 3px; }
    li > p { margin: 0; }
    blockquote {
      margin: 10px 0;
      padding: 2px 14px;
      border-left: 3px solid #d6d1c5;
      color: #5f5a52;
    }
    hr { border: 0; border-top: 1px solid #e2ded4; margin: 16px 0; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 10px 0 14px;
      font-size: 12.5px;
    }
    th, td {
      border: 1px solid #e2ded4;
      padding: 6px 9px;
      text-align: left;
      vertical-align: top;
    }
    th { background: #f4f3ee; font-weight: 700; }
    .muted { color: #a39d92; font-style: italic; }
    .thinking {
      border-left: 3px solid #d6d1c5;
      background: #f7f6f1;
      color: #5f5a52;
      padding: 10px 13px;
      border-radius: 0 8px 8px 0;
      margin-bottom: 12px;
    }
    .thinking strong { display: block; margin-bottom: 6px; color: #7c7669; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; }
    .turn-tools { margin-top: 12px; display: grid; gap: 7px; }
    .tool-note, .tool-audit {
      border: 1px solid #e2ded4;
      border-radius: 8px;
      background: #faf9f6;
      padding: 9px 11px;
    }
    .tool-note span, .tool-head strong { font-family: "SFMono-Regular", Consolas, monospace; font-weight: 700; }
    .tool-note em { color: #7c7669; font-style: normal; margin-left: 8px; }
    .tool-note b, .tool-head span { float: right; color: #7c7669; font-size: 10px; text-transform: uppercase; }
    .tool-note .is-ok, .tool-head .is-ok { color: #3f7c55; }
    .tool-note .is-error, .tool-head .is-error, .tool-error { color: #a9432a; }
    .tool-error { clear: both; margin-top: 6px; font-family: "SFMono-Regular", Consolas, monospace; font-size: 11px; }
    .tool-head { overflow: hidden; margin-bottom: 8px; }
    .footer {
      margin-top: 26px;
      padding-top: 11px;
      border-top: 1px solid #e2ded4;
      color: #a39d92;
      font-size: 10px;
    }
  </style>
</head>
<body>
  <div class="sheet">
    <section class="masthead">
      <div class="eyebrow">ClaudeLens</div>
      <h1>${escapeHtml(title)}</h1>
      <div class="submeta">
        <span>${escapeHtml(fmtDate(session.date))}</span>
        ${primaryModel ? `<i>·</i><span>${escapeHtml(fmtModel(primaryModel))}</span>` : ''}
      </div>
    </section>
    ${processed.map((p, i) => renderTurnHtml(p, i, options, input.highlights ?? [])).join('')}
    <div class="footer">Exported from ClaudeLens on ${escapeHtml(fmtDate(new Date().toISOString()))}. Review before sharing outside your organization.</div>
  </div>
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
