// @vitest-environment jsdom
//
// The `Artifact` tool in the transcript. A call that PUBLISHED a page is drawn
// as that page — its own title, a real link, which version this was — and a
// call that published nothing (a quickstart, a listing) stays a chip, because
// its answer is a kilobyte of prose written for the harness. The claims here
// are what a reader sees without touching anything, and that nothing is
// invented where the transcript is silent.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { StrictMode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { MessageBubble } from '../src/components/project/chat/MessageBubble';
import { buildProcessedMessages } from '../src/components/project/chat/utils';
import type { ChatDetailsFilter } from '../src/components/project/chat/utils';
import type { ArtifactPublish, ChatMessage } from '../src/types';

afterEach(cleanup);

const PUBLISH_PROSE =
  'Published /tmp/scratch/page.html at https://claude.ai/artifact/AbCdEf (Version 2)\n\n' +
  'Live subscription: arming in the background — not connected yet, so this is not a watch ' +
  'until `status` shows it connected.';

const page = (over: Partial<ArtifactPublish> = {}): ArtifactPublish => ({
  id: '0a1b2c3d',
  url: 'https://claude.ai/artifact/AbCdEf',
  title: 'Release checklist',
  updated: true,
  seq: 2,
  audience: 'owner',
  path: '/tmp/scratch/page.html',
  ...over,
});

/** The assistant turn that called the tool, plus the user row carrying its
 *  result — with the page stamped on the result block, the way the transcript
 *  readers stamp it from `toolUseResult`. */
function transcript(
  input: Record<string, unknown>,
  result: { content: string; isError?: boolean; artifact?: ArtifactPublish }
): ChatMessage[] {
  return [
    {
      uuid: 'a1',
      role: 'assistant',
      timestamp: '2026-09-18T18:41:00.000Z',
      content: [{ type: 'tool_use', id: 'toolu_1', name: 'Artifact', input }],
    },
    {
      uuid: 'u1',
      role: 'user',
      timestamp: '2026-09-18T18:41:02.000Z',
      content: [
        {
          type: 'tool_result',
          toolUseId: 'toolu_1',
          content: result.content,
          isError: result.isError ?? false,
          ...(result.artifact ? { artifact: result.artifact } : {}),
        },
      ],
    },
  ];
}

/** Mounted the way the app mounts (`src/main.tsx`): inside `StrictMode`. */
function mount(messages: ChatMessage[], detailsFilter: ChatDetailsFilter = 'all') {
  const [processed] = buildProcessedMessages(messages);
  return render(
    <StrictMode>
      <MessageBubble
        processed={processed}
        detailsFilter={detailsFilter}
        onOpenToolDetail={() => {}}
      />
    </StrictMode>
  );
}

describe('a published page', () => {
  it('is drawn as the page, with its title and a link that leaves the app', () => {
    const { container } = mount(
      transcript(
        { action: 'publish', description: 'Before and after' },
        { content: PUBLISH_PROSE, artifact: page() }
      )
    );

    const card = container.querySelector('.cl-artifact-card');
    expect(card).not.toBeNull();
    // Not the generic tool card, whose name would have been "Artifact".
    expect(container.querySelector('.cl-tool-card')).toBeNull();
    expect(card?.querySelector('.cl-artifact-title')?.textContent).toBe('Release checklist');
    expect(card?.querySelector('.cl-artifact-desc')?.textContent).toBe('Before and after');
    expect(card?.querySelector('.cl-artifact-status')?.textContent).toBe('UPDATED');
    expect(card?.querySelector('.cl-artifact-ver')?.textContent).toBe('v2');

    const link = card?.querySelector('a.cl-artifact-link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://claude.ai/artifact/AbCdEf');
    expect(link.textContent).toContain('claude.ai/artifact/AbCdEf');
  });

  it('opens the link in the system browser, never inside the renderer', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { container } = mount(
      transcript({ action: 'publish' }, { content: PUBLISH_PROSE, artifact: page() })
    );
    const link = container.querySelector('a.cl-artifact-link') as HTMLAnchorElement;
    act(() => link.click());
    expect(open).toHaveBeenCalledWith('https://claude.ai/artifact/AbCdEf', '_blank', 'noopener');
    open.mockRestore();
  });

  it('keeps the tool prose out of the way until it is asked for', () => {
    const { container } = mount(
      transcript({ action: 'publish' }, { content: PUBLISH_PROSE, artifact: page() })
    );
    // The boilerplate is what made a publish unreadable: it is behind the fold.
    expect(container.textContent).not.toContain('Live subscription');

    const head = container.querySelector('button.cl-artifact-head') as HTMLButtonElement;
    act(() => head.click());
    expect(container.textContent).toContain('Live subscription');
    expect(container.querySelector('.cl-artifact-body')?.textContent).toContain(
      '/tmp/scratch/page.html'
    );
  });

  it('tells the publish that created the page from a republish', () => {
    const { container } = mount(
      transcript(
        { action: 'publish' },
        { content: PUBLISH_PROSE, artifact: page({ updated: false, seq: 1, icon: 'checklist' }) }
      )
    );
    expect(container.querySelector('.cl-artifact-status')?.textContent).toBe('CREATED');
  });

  it('says nothing about the version or the sharing the transcript does not state', () => {
    // Older transcripts carry no `seq` and no `audience`. A "v1" invented here
    // would be wrong on the pages published most often, and a "private" would
    // be a claim about who can open a link.
    const { container } = mount(
      transcript(
        { action: 'publish' },
        { content: PUBLISH_PROSE, artifact: page({ seq: undefined, audience: undefined }) }
      )
    );
    expect(container.querySelector('.cl-artifact-ver')).toBeNull();
    expect(container.querySelector('.cl-artifact-share')).toBeNull();
    expect(container.querySelector('.cl-artifact-title')?.textContent).toBe('Release checklist');
  });

  it("says whether the page is still the owner's alone", () => {
    const { container } = mount(
      transcript({ action: 'publish' }, { content: PUBLISH_PROSE, artifact: page() })
    );
    expect(container.querySelector('.cl-artifact-share')?.textContent).toBe('private');

    cleanup();
    const shared = mount(
      transcript(
        { action: 'publish' },
        { content: PUBLISH_PROSE, artifact: page({ audience: 'users' }) }
      )
    );
    expect(shared.container.querySelector('.cl-artifact-share')?.textContent).toBe('shared');
  });
});

describe('an Artifact call that published nothing', () => {
  const QUICKSTART_PROSE =
    'Quickstart for a design. This one result stands in for listing the Artifact types.\n' +
    'The Artifact type to start from: Design [core] — Design canvas for websites, landing pages.';

  it('is a chip naming what it asked, not a page and not a wall of prose', () => {
    const { container } = mount(
      transcript({ action: 'quickstart', intent: 'design' }, { content: QUICKSTART_PROSE })
    );
    expect(container.querySelector('.cl-artifact-card')).toBeNull();

    const chip = container.querySelector('.cl-tool-card--chip');
    expect(chip).not.toBeNull();
    expect(chip?.querySelector('.cl-tool-card-name')?.textContent).toBe('Artifact');
    expect(chip?.querySelector('.cl-tool-card-preview')?.textContent).toBe('quickstart');
    expect(container.textContent).not.toContain('Design canvas for websites');
  });

  it('opens on click, like every other chip', () => {
    const { container } = mount(
      transcript({ action: 'list', scope: 'mine' }, { content: QUICKSTART_PROSE })
    );
    const head = container.querySelector('.cl-tool-card-main') as HTMLButtonElement;
    act(() => head.click());
    expect(container.textContent).toContain('Design canvas for websites');
  });

  it('is what a refused publish falls back to — the failure stays in place', () => {
    const { container } = mount(
      transcript(
        { action: 'publish', file_path: '/tmp/scratch/page.html' },
        { content: 'Refused: a newer version was published from the page.', isError: true }
      )
    );
    expect(container.querySelector('.cl-artifact-card')).toBeNull();
    expect(container.querySelector('.cl-tool-card')).not.toBeNull();
    expect(container.textContent).toContain('Refused');
  });
});

describe('minimal density', () => {
  it('keeps a published page on screen as one line with its link', () => {
    const { container } = mount(
      transcript(
        { action: 'publish', description: 'Before and after' },
        { content: PUBLISH_PROSE, artifact: page() }
      ),
      'minimal'
    );
    const card = container.querySelector('.cl-artifact-card.is-compact');
    expect(card).not.toBeNull();
    expect(card?.querySelector('.cl-artifact-title')?.textContent).toBe('Release checklist');
    expect(card?.querySelector('a.cl-artifact-link')).not.toBeNull();
    // One line: no status strip, no fold, no second sentence.
    expect(card?.querySelector('.cl-artifact-strip')).toBeNull();
    expect(card?.querySelector('.cl-artifact-desc')).toBeNull();
  });

  it('drops a call that published nothing', () => {
    const { container } = mount(
      transcript(
        { action: 'quickstart', intent: 'design' },
        { content: 'Quickstart for a design.' }
      ),
      'minimal'
    );
    expect(container.querySelector('.cl-artifact-card')).toBeNull();
    expect(container.querySelector('.cl-tool-card')).toBeNull();
  });
});
