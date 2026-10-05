// @vitest-environment jsdom
//
// The pages a turn fetched and the searches it ran, at its foot in MIN density.
//
// MIN hides every tool without a strip of its own, and the web tools had none:
// a run of fifteen fetches read `tools hidden ×15` and not one source. These are
// the claims about the strip that keeps them on screen — on a turn's own calls,
// on a run folded into the turn above, and on the standalone badge of a run that
// follows a user turn (the shape the bug was reported on) — and about what each
// line says came back.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { StrictMode } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { MessageBubble, ToolsHiddenBadge } from '../src/components/project/chat/MessageBubble';
import {
  buildProcessedMessages,
  buildRenderItems,
  describeTurn,
} from '../src/components/project/chat/utils';
import type { ChatDetailsFilter } from '../src/components/project/chat/utils';
import type { ChatMessage, ChatContentBlock } from '../src/types';

afterEach(cleanup);

type Use = Extract<ChatContentBlock, { type: 'tool_use' }>;
type Result = Extract<ChatContentBlock, { type: 'tool_result' }>;

const fetchUse = (id: string, url: string): Use => ({
  type: 'tool_use',
  id,
  name: 'WebFetch',
  input: { url, prompt: 'Summarise the page' },
});
const searchUse = (id: string, query: string): Use => ({
  type: 'tool_use',
  id,
  name: 'WebSearch',
  input: { query },
});
const result = (toolUseId: string, content: string): Result => ({
  type: 'tool_result',
  toolUseId,
  content,
  isError: false,
});

const PAGE = 'https://docs.example.com/guide/install.html';
const GONE = 'https://example.org/missing.html';

const at = (s: number) => `2026-10-05T10:00:${String(s).padStart(2, '0')}.000Z`;
const row = (uuid: string, role: 'user' | 'assistant', s: number, content: ChatContentBlock[]) =>
  ({ uuid, role, timestamp: at(s), content }) as ChatMessage;

/** The lines as words: verb, source, where from, then any count. */
const lines = (el: ParentNode) =>
  [...el.querySelectorAll('.cl-web-source')].map(b =>
    [
      ...b.querySelectorAll(
        '.cl-web-source-verb, .cl-web-source-title, .cl-web-source-meta, .cl-web-source-times, .cl-web-source-count'
      ),
    ]
      .map(c => c.textContent?.trim() ?? '')
      .join(' | ')
  );

/** Mount the transcript the way ChatView does: render items, then a badge or a
 *  bubble per item. */
function mountStream(msgs: ChatMessage[], filter: ChatDetailsFilter = 'minimal') {
  const processed = buildProcessedMessages(msgs);
  const items = buildRenderItems(
    processed,
    processed.map(p => describeTurn(p, filter))
  );
  const onOpen = vi.fn();
  const view = render(
    <StrictMode>
      {items.map(item =>
        item.kind === 'tools' ? (
          <ToolsHiddenBadge
            key={item.key}
            count={item.count}
            files={item.files}
            web={item.web}
            onOpenTool={onOpen}
          />
        ) : item.kind === 'turn' ? (
          <MessageBubble
            key={item.idx}
            processed={processed[item.idx]}
            detailsFilter={filter}
            onOpenToolDetail={onOpen}
            hiddenToolCount={item.hiddenCount}
            hiddenFiles={item.hiddenFiles}
            hiddenWeb={item.hiddenWeb}
          />
        ) : null
      )}
    </StrictMode>
  );
  return { ...view, onOpen };
}

describe('WebSourcesStrip in MIN', () => {
  it('lists the sources of a tool-only run that follows a user turn', () => {
    const msgs = [
      row('u0', 'user', 0, [{ type: 'text', text: 'Check the install guide' }]),
      row('a1', 'assistant', 1, [fetchUse('f1', PAGE)]),
      row('u1', 'user', 2, [result('f1', '# Install\nRun the installer.')]),
      row('a2', 'assistant', 3, [fetchUse('f2', GONE)]),
      row('u2', 'user', 4, [
        result('f2', 'The server returned HTTP 404 Not Found. Try another tool.'),
      ]),
    ];
    const { container } = mountStream(msgs);
    expect(container.querySelector('.cl-turn-tools-hidden-badge')?.textContent).toContain(
      'tools hidden'
    );
    expect(lines(container)).toEqual([
      'Fetched | install.html | docs.example.com',
      'Failed | missing.html | example.org · HTTP 404 Not Found',
    ]);
    expect(container.querySelector('[data-outcome="failed"]')).not.toBeNull();
  });

  it('carries a run folded into the assistant turn above onto that turn', () => {
    const msgs = [
      row('a0', 'assistant', 0, [{ type: 'text', text: 'Let me look that up.' }]),
      row('a1', 'assistant', 1, [searchUse('s1', 'install guide')]),
      row('u1', 'user', 2, [
        result(
          's1',
          'Web search results for query: "install guide"\n\nLinks: [{"title":"Guide","url":"https://docs.example.com/guide"},{"title":"FAQ","url":"https://example.net/faq"}]\n\nThe guide says…'
        ),
      ]),
    ];
    const { container } = mountStream(msgs);
    expect(container.querySelectorAll('.cl-turn')).toHaveLength(1);
    expect(lines(container)).toEqual([
      'Searched | install guide | docs.example.com · example.net | 2 links',
    ]);
  });

  it("shows a turn's own fetch next to its text, and opens the call on click", () => {
    const msgs = [
      row('a1', 'assistant', 1, [
        { type: 'text', text: 'Reading the guide.' },
        fetchUse('f1', PAGE),
      ]),
      row('u1', 'user', 2, [result('f1', '# Install')]),
    ];
    const { container, onOpen } = mountStream(msgs);
    expect(lines(container)).toEqual(['Fetched | install.html | docs.example.com']);
    fireEvent.click(container.querySelector('.cl-web-source')!);
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ use: expect.objectContaining({ id: 'f1' }) })
    );
  });

  it('says a fetch with no result yet is pending, never fetched', () => {
    const msgs = [
      row('a1', 'assistant', 1, [{ type: 'text', text: 'Fetching.' }, fetchUse('f1', PAGE)]),
    ];
    const { container } = mountStream(msgs);
    expect(lines(container)).toEqual(['Pending | install.html | docs.example.com']);
  });

  it('draws no strip in FULL, where the calls themselves are on screen', () => {
    const msgs = [
      row('a1', 'assistant', 1, [
        { type: 'text', text: 'Reading the guide.' },
        fetchUse('f1', PAGE),
      ]),
      row('u1', 'user', 2, [result('f1', '# Install')]),
    ];
    const { container } = mountStream(msgs, 'all');
    expect(container.querySelector('.cl-web-sources')).toBeNull();
  });

  it('draws nothing for a turn that used no web tool', () => {
    const msgs = [
      row('a1', 'assistant', 1, [
        { type: 'text', text: 'Listing.' },
        { type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'ls' } },
      ]),
      row('u1', 'user', 2, [result('b1', 'a\nb')]),
    ];
    const { container } = mountStream(msgs);
    expect(container.querySelector('.cl-web-sources')).toBeNull();
  });
});
