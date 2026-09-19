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

// #279: an export used to know two roles, so a message another session sent
// printed under the same "User" heading as something the user typed, and a
// harness notice printed as if the user had said that too. The view has told
// them apart since #274; these pin that the export does as well.
describe('buildChatExportDocument (inbound messages and notices)', () => {
  // Both go through `buildProcessedMessages`, like the command and notification
  // fixtures: an inbound row is a user row with a text block, and the claim is
  // that the real path hands it to the export with its origin intact.
  function inboundTurn(
    origin: ChatMessage['inbound'],
    text = 'please also run the linter'
  ): ProcessedMessage[] {
    return buildProcessedMessages([
      {
        uuid: 'in-1',
        role: 'user',
        timestamp: '2026-06-23T10:32:00Z',
        content: [{ type: 'text', text }],
        inbound: origin,
      },
    ]);
  }

  function noticeTurn(notice: NonNullable<ChatMessage['notice']>): ProcessedMessage[] {
    return buildProcessedMessages([
      {
        uuid: 'no-1',
        role: 'user',
        timestamp: '2026-06-23T10:33:00Z',
        content: [{ type: 'text', text: notice.text }],
        notice,
      },
    ]);
  }

  it('reaches the export as one turn with its origin intact', () => {
    const processed = inboundTurn({ from: 'session', name: 'alice-7c' });
    expect(processed).toHaveLength(1);
    expect(processed[0].msg.inbound?.name).toBe('alice-7c');
    expect(processed[0].command).toBeUndefined();
    expect(processed[0].notification).toBeUndefined();
  });

  it('attributes a message from another session to its sender, never to the user', () => {
    const doc = buildChatExportDocument({
      session,
      processed: inboundTurn({ from: 'session', name: 'alice-7c', pid: 4242 }),
      preset: 'message',
    });
    expect(doc.markdown).toContain('### 01 From alice-7c (another session)');
    expect(doc.markdown).not.toContain('### 01 User');
    expect(doc.markdown).toContain('please also run the linter');
    expect(doc.html).toContain('class="turn is-inbound"');
    expect(doc.html).toContain('alice-7c');
    expect(doc.html).toContain('<span class="turn-from">another session</span>');
    expect(doc.html).not.toContain('class="turn is-user"');
    expect(doc.html).not.toContain('<span class="turn-who">User</span>');
  });

  it('says when the sender was an agent inside this session', () => {
    const doc = buildChatExportDocument({
      session,
      processed: inboundTurn({ from: 'agent', name: 'reviewer' }),
      preset: 'message',
    });
    expect(doc.markdown).toContain('From reviewer (agent in this session)');
    expect(doc.html).toContain('<span class="turn-from">agent in this session</span>');
  });

  it('names the origin alone when the sender carried no name', () => {
    const doc = buildChatExportDocument({
      session,
      processed: inboundTurn({ from: 'session' }),
      preset: 'message',
    });
    expect(doc.markdown).toContain('### 01 From another session');
    expect(doc.html).toContain('another session</span>');
    expect(doc.html).not.toContain('<span class="turn-from">');
  });

  it('marks an inbound message that arrived mid-turn — the flag is on the origin, not the row', () => {
    const doc = buildChatExportDocument({
      session,
      processed: inboundTurn({ from: 'session', name: 'alice-7c', queued: true }),
      preset: 'message',
    });
    expect(doc.markdown).toContain('From alice-7c (another session) (sent mid-turn)');
    expect(doc.html).toContain('<span class="turn-queued">sent mid-turn</span>');
  });

  it('renders an inbound body as markdown, like the view, and escapes the sender name', () => {
    const doc = buildChatExportDocument({
      session,
      processed: inboundTurn({ from: 'session', name: '<b>x</b>' }, 'run *all* of them'),
      preset: 'message',
    });
    expect(doc.html).toContain('<em>all</em>');
    expect(doc.html).not.toContain('<b>x</b>');
    expect(doc.html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(doc.markdown).not.toContain('From <b>x</b>');
  });

  it('skips a harness notice in the "message" preset, like a task notification', () => {
    const doc = buildChatExportDocument({
      session,
      processed: noticeTurn({
        kind: 'session-idle',
        subject: 'alice-7c',
        text: 'alice-7c went idle',
      }),
      preset: 'message',
    });
    expect(doc.markdown).not.toContain('went idle');
    expect(doc.markdown).not.toContain('User');
    expect(doc.html).not.toContain('went idle');
  });

  it('renders a notice as a one-line session event in tool-showing presets, never as the user', () => {
    const doc = buildChatExportDocument({
      session,
      processed: noticeTurn({
        kind: 'session-idle',
        subject: 'alice-7c',
        text: 'alice-7c went idle',
      }),
      preset: 'docs',
    });
    expect(doc.markdown).toContain('### 01 Session event');
    expect(doc.markdown).toContain('*Session event (session idle · alice-7c): alice-7c went idle*');
    expect(doc.markdown).not.toContain('### 01 User');
    // The row's text block IS the notice, so it prints once, not twice.
    expect(doc.markdown.match(/went idle/g)).toHaveLength(1);
    expect(doc.html).toContain('class="turn is-notice"');
    expect(doc.html).toContain('<span class="turn-who">Session event</span>');
    expect(doc.html).toContain('session idle');
    expect(doc.html.match(/went idle/g)).toHaveLength(1);
    expect(doc.html).not.toContain('class="turn is-user"');
  });

  it('labels the other notice kinds the way the view does', () => {
    const docs = (kind: 'agent-idle' | 'auto-continuation') =>
      buildChatExportDocument({
        session,
        processed: noticeTurn({ kind, text: 'the harness did a thing' }),
        preset: 'audit',
      });
    expect(docs('agent-idle').markdown).toContain('*Session event (agent done): the harness');
    expect(docs('auto-continuation').markdown).toContain('*Session event (resumed): the harness');
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
