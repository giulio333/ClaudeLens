import { describe, it, expect } from 'vitest';
import { buildChatExportDocument } from '../src/components/project/chat/export';
import type { SessionSummary, ChatMessage } from '../src/types';
import {
  buildProcessedMessages,
  type ProcessedMessage,
} from '../src/components/project/chat/utils';
import type { Highlight } from '../src/components/project/chat/highlights';

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
};

function assistantTurn(uuid: string, text: string): ProcessedMessage {
  const msg: ChatMessage = {
    uuid,
    role: 'assistant',
    timestamp: '2026-06-23T10:30:38Z',
    model: 'claude-opus-4-8',
    content: [{ type: 'text', text }],
  };
  return { msg, toolGroups: [] };
}

function userTurn(uuid: string, text: string): ProcessedMessage {
  const msg: ChatMessage = {
    uuid,
    role: 'user',
    timestamp: '2026-06-23T10:30:00Z',
    content: [{ type: 'text', text }],
  };
  return { msg, toolGroups: [] };
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
  };
}

describe('buildChatExportDocument (react-markdown HTML)', () => {
  it('renders GFM tables instead of leaving raw pipes', () => {
    const md = ['| Aspetto | Prima | Ora |', '|---|---|---|', '| Chi | dubbio | broker |'].join(
      '\n'
    );
    const doc = buildChatExportDocument({
      session,
      processed: [assistantTurn('u1', md)],
      preset: 'message',
    });
    expect(doc.html).toContain('<table>');
    expect(doc.html).toContain('<th>Aspetto</th>');
    expect(doc.html).toContain('<td>broker</td>');
    expect(doc.html).not.toContain('| Aspetto |');
  });

  it('renders italic with single asterisks (the reported broken case)', () => {
    const doc = buildChatExportDocument({
      session,
      processed: [assistantTurn('u1', 'nella sezione *Configurazione* del file')],
      preset: 'message',
    });
    expect(doc.html).toContain('<em>Configurazione</em>');
    expect(doc.html).not.toContain('*Configurazione*');
  });

  it('bakes a highlight spanning inline code into a <mark> with <code> inside', () => {
    const doc = buildChatExportDocument({
      session,
      processed: [assistantTurn('u1', 'routing per `lms_id` ora')],
      preset: 'message',
      highlights: [hl('u1', 'routing per lms_id ora')],
    });
    expect(doc.html).toContain('<mark class="cl-hl cl-hl-amber">');
    expect(doc.html).toContain('<code>lms_id</code>');
    // The mark must wrap the code, not the other way around.
    expect(doc.html).toMatch(/<mark[^>]*>[^<]*<code>lms_id<\/code>/);
  });

  it('also bakes highlights into the markdown export', () => {
    const doc = buildChatExportDocument({
      session,
      processed: [assistantTurn('u1', 'plain highlighted text')],
      preset: 'message',
      highlights: [hl('u1', 'highlighted')],
    });
    expect(doc.markdown).toContain('<mark class="cl-hl cl-hl-amber">highlighted</mark>');
  });

  it('soft-degrades a highlight inside a fenced code block (Markdown), keeps it in HTML', () => {
    const md = ['Run this:', '', '```bash', 'npm test', '```'].join('\n');
    const doc = buildChatExportDocument({
      session,
      processed: [assistantTurn('u1', md)],
      preset: 'audit',
      highlights: [hl('u1', 'npm test')],
    });
    // Markdown can't carry a <mark> inside a ``` fence (it would print literally),
    // so the highlight is dropped there — the code stays intact.
    expect(doc.markdown).not.toContain('<mark');
    expect(doc.markdown).toContain('npm test');
    // The HTML/PDF export renders <mark> inside <pre><code> just fine, so the
    // highlighted code is preserved there.
    expect(doc.html).toContain('<mark class="cl-hl cl-hl-amber">');
  });

  it('renders user prompts as plain text in HTML (no markdown interpretation)', () => {
    const doc = buildChatExportDocument({
      session,
      processed: [userTurn('u1', 'use *stars* and a # hash literally')],
      preset: 'message',
    });
    // Mirrors the live view: a user prompt is verbatim, not markdown.
    expect(doc.html).toContain('use *stars* and a # hash literally');
    expect(doc.html).not.toContain('<em>stars</em>');
  });

  it('still renders assistant text as markdown in HTML', () => {
    const doc = buildChatExportDocument({
      session,
      processed: [assistantTurn('a1', 'this is *emphasised* text')],
      preset: 'message',
    });
    expect(doc.html).toContain('<em>emphasised</em>');
  });

  it('renders math formulas as native MathML (no raw TeX, no KaTeX CSS needed)', () => {
    const doc = buildChatExportDocument({
      session,
      processed: [assistantTurn('a1', 'la formula $E = mc^2$ è famosa')],
      preset: 'message',
    });
    expect(doc.html).toContain('<math');
    expect(doc.html).not.toContain('$E = mc^2$');
  });

  it('emits a separate well-formed mark per paragraph (no mark across <p>)', () => {
    const doc = buildChatExportDocument({
      session,
      processed: [assistantTurn('a1', 'Para uno qui.\n\nPara due qui.')],
      preset: 'message',
      // The quote concatenates both paragraphs (range.toString drops the break).
      highlights: [hl('a1', 'Para uno qui.Para due qui.')],
    });
    expect(doc.html).toContain('<mark class="cl-hl cl-hl-amber">Para uno qui.</mark>');
    expect(doc.html).toContain('<mark class="cl-hl cl-hl-amber">Para due qui.</mark>');
    // No <mark> left open when a </p> closes (the malformed multi-block case).
    expect(doc.html).not.toMatch(/<mark[^>]*>[^<]*<\/p>/);
  });

  it('bakes a highlight spanning inline math, keeping the formula inside the mark', () => {
    const doc = buildChatExportDocument({
      session,
      processed: [assistantTurn('a1', 'la formula $E = mc^2$ qui')],
      preset: 'message',
      // exportQuote carries the TeX so the highlight relocates across the $…$.
      highlights: [
        { ...hl('a1', 'la formula E = mc^2 qui'), exportQuote: 'la formula E = mc^2 qui' },
      ],
    });
    expect(doc.html).toContain('<mark class="cl-hl cl-hl-amber">');
    expect(doc.html).toContain('<math'); // formula rendered as MathML
    expect(doc.html).not.toContain('$E = mc^2$'); // not left as raw TeX
    // The mark opens before the math and isn't closed by an intervening tag.
    expect(doc.html).toMatch(/<mark[^>]*>[^]*?<math/);
  });

  it('renders display math ($$) as MathML too', () => {
    const doc = buildChatExportDocument({
      session,
      processed: [assistantTurn('a1', 'ecco:\n\n$$i_{\\text{entra}} = i_{\\text{esce}}$$')],
      preset: 'message',
    });
    expect(doc.html).toContain('<math');
    expect(doc.html).not.toContain('$$i_{\\text{entra}}');
  });
});

describe('buildChatExportDocument (command / notification turns)', () => {
  const commandMessages: ChatMessage[] = [
    {
      uuid: 'c1',
      role: 'user',
      timestamp: '2026-06-23T10:30:00Z',
      content: [
        {
          type: 'text',
          text: '<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args>focus on tests</command-args>',
        },
      ],
    },
    {
      uuid: 'c2',
      role: 'user',
      timestamp: '2026-06-23T10:30:05Z',
      content: [
        {
          type: 'text',
          text: '<local-command-stdout>Compacted successfully</local-command-stdout>',
        },
      ],
    },
  ];

  it('renders a slash-command turn as the command chip, never the raw XML framing', () => {
    const doc = buildChatExportDocument({
      session,
      processed: buildProcessedMessages(commandMessages),
      preset: 'message',
    });
    expect(doc.markdown).toContain('`/compact` focus on tests');
    expect(doc.markdown).not.toContain('<command-name>');
    expect(doc.html).toContain('/compact');
    expect(doc.html).not.toContain('&lt;command-name&gt;');
    // The "message" preset strips the command's stdout along with tool detail.
    expect(doc.markdown).not.toContain('Compacted successfully');
  });

  it('includes the command output in presets that show tool activity', () => {
    const doc = buildChatExportDocument({
      session,
      processed: buildProcessedMessages(commandMessages),
      preset: 'docs',
    });
    expect(doc.markdown).toContain('Compacted successfully');
    expect(doc.html).toContain('Compacted successfully');
  });

  const notificationMessages: ChatMessage[] = [
    {
      uuid: 'n1',
      role: 'user',
      timestamp: '2026-06-23T10:31:00Z',
      content: [
        {
          type: 'text',
          text: '<task-notification><task-id>t1</task-id><status>completed</status><summary>Background agent finished</summary></task-notification>',
        },
      ],
    },
  ];

  it('skips task notifications in the "message" preset', () => {
    const doc = buildChatExportDocument({
      session,
      processed: buildProcessedMessages(notificationMessages),
      preset: 'message',
    });
    expect(doc.markdown).not.toContain('task-notification');
    expect(doc.markdown).not.toContain('Background agent finished');
    expect(doc.html).not.toContain('task-notification');
  });

  it('renders task notifications compactly (no raw XML) in tool-showing presets', () => {
    const doc = buildChatExportDocument({
      session,
      processed: buildProcessedMessages(notificationMessages),
      preset: 'docs',
    });
    expect(doc.markdown).toContain('Task event (completed): Background agent finished');
    expect(doc.markdown).not.toContain('<task-notification>');
    expect(doc.html).toContain('Background agent finished');
    expect(doc.html).not.toContain('&lt;task-notification&gt;');
  });
});

describe('buildChatExportDocument (fidelity)', () => {
  it('preserves blank-line runs inside a fenced code block in the Markdown export', () => {
    const code = ['```python', 'a = 1', '', '', '', 'b = 2', '```'].join('\n');
    const doc = buildChatExportDocument({
      session,
      processed: [assistantTurn('a1', `Ecco il codice:\n\n${code}`)],
      preset: 'message',
    });
    expect(doc.markdown).toContain('a = 1\n\n\n\nb = 2');
  });

  it('wraps tool results containing both ``` and ~~~ in a longer backtick fence', () => {
    const content = 'uses ```js fences\nand ~~~ too';
    const msg: ChatMessage = {
      uuid: 'a2',
      role: 'assistant',
      timestamp: '2026-06-23T10:32:00Z',
      model: 'claude-opus-4-8',
      content: [
        { type: 'text', text: 'ran a tool' },
        { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'cat file' } },
      ],
    };
    const resultMsg: ChatMessage = {
      uuid: 'u9',
      role: 'user',
      timestamp: '2026-06-23T10:32:05Z',
      content: [{ type: 'tool_result', toolUseId: 't1', content, isError: false }],
    };
    const doc = buildChatExportDocument({
      session,
      processed: buildProcessedMessages([msg, resultMsg]),
      preset: 'audit',
    });
    // The fence must be longer than any backtick run inside the content, so the
    // embedded ``` can't close it early.
    expect(doc.markdown).toContain('````text\nuses ```js fences\nand ~~~ too\n````');
  });

  it('falls back to session.model for the Model line when the models map is empty', () => {
    const doc = buildChatExportDocument({
      session: { ...session, models: {}, model: 'claude-opus-4-8' },
      processed: [assistantTurn('a1', 'ciao')],
      preset: 'message',
    });
    expect(doc.markdown).toContain('> Model:');
  });
});
