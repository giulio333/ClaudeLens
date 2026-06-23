import { describe, it, expect } from 'vitest'
import { buildChatExportDocument } from '../src/components/project/chat/export'
import type { SessionSummary, ChatMessage } from '../src/types'
import type { ProcessedMessage } from '../src/components/project/chat/utils'
import type { Highlight } from '../src/components/project/chat/highlights'

// Integration coverage for the react-markdown-backed HTML export: confirms
// renderToStaticMarkup runs and that GFM features (tables, italic) + highlights
// (incl. inline code) render correctly end-to-end.

const session: SessionSummary = {
  filename: 'sess-1.jsonl',
  date: '2026-06-23T10:30:00Z',
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  totalTokens: 0,
  estimatedCost: 0,
  cacheSavings: 0,
  messageCount: 1,
  models: {},
}

function assistantTurn(uuid: string, text: string): ProcessedMessage {
  const msg: ChatMessage = {
    uuid,
    role: 'assistant',
    timestamp: '2026-06-23T10:30:38Z',
    model: 'claude-opus-4-8',
    content: [{ type: 'text', text }],
  }
  return { msg, toolGroups: [] }
}

function hl(messageUuid: string, quote: string, color: Highlight['color'] = 'amber'): Highlight {
  return {
    id: `hl-${quote}`,
    messageUuid,
    blockIndex: 0,
    start: 0,
    end: quote.length,
    quote,
    color,
    createdAt: '2026-06-23T10:30:00Z',
  }
}

describe('buildChatExportDocument (react-markdown HTML)', () => {
  it('renders GFM tables instead of leaving raw pipes', () => {
    const md = ['| Aspetto | Prima | Ora |', '|---|---|---|', '| Chi | dubbio | broker |'].join('\n')
    const doc = buildChatExportDocument({
      session,
      processed: [assistantTurn('u1', md)],
      preset: 'message',
    })
    expect(doc.html).toContain('<table>')
    expect(doc.html).toContain('<th>Aspetto</th>')
    expect(doc.html).toContain('<td>broker</td>')
    expect(doc.html).not.toContain('| Aspetto |')
  })

  it('renders italic with single asterisks (the reported broken case)', () => {
    const doc = buildChatExportDocument({
      session,
      processed: [assistantTurn('u1', 'nella sezione *Configurazione* del file')],
      preset: 'message',
    })
    expect(doc.html).toContain('<em>Configurazione</em>')
    expect(doc.html).not.toContain('*Configurazione*')
  })

  it('bakes a highlight spanning inline code into a <mark> with <code> inside', () => {
    const doc = buildChatExportDocument({
      session,
      processed: [assistantTurn('u1', 'routing per `lms_id` ora')],
      preset: 'message',
      highlights: [hl('u1', 'routing per lms_id ora')],
    })
    expect(doc.html).toContain('<mark class="cl-hl cl-hl-amber">')
    expect(doc.html).toContain('<code>lms_id</code>')
    // The mark must wrap the code, not the other way around.
    expect(doc.html).toMatch(/<mark[^>]*>[^<]*<code>lms_id<\/code>/)
  })

  it('also bakes highlights into the markdown export', () => {
    const doc = buildChatExportDocument({
      session,
      processed: [assistantTurn('u1', 'plain highlighted text')],
      preset: 'message',
      highlights: [hl('u1', 'highlighted')],
    })
    expect(doc.markdown).toContain('<mark class="cl-hl cl-hl-amber">highlighted</mark>')
  })
})
