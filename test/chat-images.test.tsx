// @vitest-environment jsdom
//
// Images in the transcript, which used to render as nothing at all, twice over:
//
//  - the `image` block Claude Code writes for a pasted screenshot (and the one
//    inside a `Read`'s result for a `.png`) was dropped by the reader, so a
//    prompt that was only a picture was a turn that did not exist and a Read
//    of an image was an "empty file";
//  - a picture Claude linked by path — `![seg](/private/tmp/…/seg.png)` —
//    became an `<img>` resolved against the app's origin, never against the
//    disk: a broken glyph, in every session that rendered a screenshot.
//
// Now the block is drawn from its base64, and the path is read through the
// main process and answered with the picture, "gone", or why not — never the
// glyph.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Markdown from '../src/components/Markdown';
import { localImagePath } from '../src/components/image-src';
import { VaultLinksProvider } from '../src/components/VaultLinks';
import { MessageBubble } from '../src/components/project/chat/MessageBubble';
import { buildProcessedMessages } from '../src/components/project/chat/utils';
import { installFakeElectronAPI, ok, type FakeBridge } from './helpers/fake-electron-api';
import type { ChatMessage, LocalImageAnswer } from '../src/types';

const PNG = { mediaType: 'image/png', data: 'iVBORw0KGgo=' };
const DATA_URI = 'data:image/png;base64,iVBORw0KGgo=';
const ROOT = '/Users/tester/Project';

let bridge: FakeBridge;

beforeEach(() => {
  bridge = installFakeElectronAPI();
});

afterEach(() => {
  cleanup();
  bridge.restore();
});

/** Mounted the way `src/main.tsx` mounts: inside `StrictMode`. */
function mountTurn(messages: ChatMessage[], detailsFilter: 'all' | 'minimal' = 'all') {
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

function mountMarkdown(markdown: string, root: string | null = ROOT) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const body = <Markdown>{markdown}</Markdown>;
  return render(
    <StrictMode>
      <QueryClientProvider client={client}>
        {root ? <VaultLinksProvider root={root}>{body}</VaultLinksProvider> : body}
      </QueryClientProvider>
    </StrictMode>
  );
}

describe('an image block on a message', () => {
  it('draws a pasted screenshot beside the prompt it came with', () => {
    const { container } = mountTurn([
      {
        uuid: 'u1',
        role: 'user',
        timestamp: '2026-09-21T19:54:07.570Z',
        content: [
          { type: 'text', text: '[Image #1] the dot is off-centre' },
          { type: 'image', ...PNG },
        ],
      },
    ]);
    const img = container.querySelector<HTMLImageElement>('.cl-image img');
    expect(img?.getAttribute('src')).toBe(DATA_URI);
    expect(container.querySelector('.cl-message-text--user')?.textContent).toContain('[Image #1]');
  });

  it('keeps a turn that is only a picture, in both densities', () => {
    const message: ChatMessage = {
      uuid: 'u1',
      role: 'user',
      timestamp: '2026-09-21T19:54:07.570Z',
      content: [{ type: 'image', ...PNG }],
    };
    for (const density of ['all', 'minimal'] as const) {
      const { container, unmount } = mountTurn([message], density);
      expect(container.querySelector('.cl-turn')).not.toBeNull();
      expect(container.querySelector('.cl-image img')).not.toBeNull();
      unmount();
    }
  });

  it('opens whole on a click and closes again', () => {
    const { container } = mountTurn([
      {
        uuid: 'u1',
        role: 'user',
        timestamp: '2026-09-21T19:54:07.570Z',
        content: [{ type: 'image', ...PNG }],
      },
    ]);
    fireEvent.click(container.querySelector('.cl-image-open')!);
    const full = document.body.querySelector('.cl-image-full img');
    expect(full?.getAttribute('src')).toBe(DATA_URI);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.body.querySelector('.cl-image-full')).toBeNull();
  });
});

describe('the image a Read returned', () => {
  it('is the picture in the editor window, not an empty file', () => {
    const { container } = mountTurn([
      {
        uuid: 'a1',
        role: 'assistant',
        timestamp: '2026-09-21T20:07:30.000Z',
        content: [
          { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/tmp/seg.png' } },
        ],
      },
      {
        uuid: 'u1',
        role: 'user',
        timestamp: '2026-09-21T20:07:33.895Z',
        content: [
          { type: 'tool_result', toolUseId: 'toolu_1', content: '', isError: false, images: [PNG] },
        ],
      },
    ]);
    const window = container.querySelector('.cl-term--file')!;
    expect(window.querySelector('.cl-file-image img')?.getAttribute('src')).toBe(DATA_URI);
    expect(window.textContent).not.toContain('empty file');
    expect(window.querySelector('.cl-term-state')?.textContent).toBe('image/png');
  });
});

describe('an image linked by path', () => {
  it('is read through the main process and drawn from its answer', async () => {
    bridge.api.images.read.mockResolvedValue(
      ok<LocalImageAnswer>({ status: 'ok', dataUri: DATA_URI, bytes: 8 })
    );
    const { container } = mountMarkdown('Rendered:\n\n![seg](/private/tmp/scratch/seg.png)');
    await waitFor(() =>
      expect(container.querySelector('.cl-image img')?.getAttribute('src')).toBe(DATA_URI)
    );
    expect(bridge.api.images.read).toHaveBeenCalledWith('/private/tmp/scratch/seg.png', ROOT);
    expect(container.querySelector('.cl-image-caption')?.textContent).toBe('seg.png');
  });

  it('says the file is gone rather than drawing a broken image', async () => {
    const { container } = mountMarkdown('![seg](/private/tmp/scratch/seg.png)');
    await waitFor(() =>
      expect(container.querySelector('.cl-image-note.is-missing')?.textContent).toBe(
        'seg.png — file is gone'
      )
    );
    expect(container.querySelector('img')).toBeNull();
  });

  it('repeats the reason a read was refused', async () => {
    bridge.api.images.read.mockResolvedValue(
      ok<LocalImageAnswer>({ status: 'refused', reason: 'not a raster image' })
    );
    const { container } = mountMarkdown('![key](/Users/tester/.ssh/id_rsa)');
    await waitFor(() =>
      expect(container.querySelector('.cl-image-note')?.textContent).toBe(
        'id_rsa — not a raster image'
      )
    );
  });

  it('resolves a relative path against the project root, inside a chat only', async () => {
    mountMarkdown('![shot](docs/shot.png)');
    await waitFor(() =>
      expect(bridge.api.images.read).toHaveBeenCalledWith(`${ROOT}/docs/shot.png`, ROOT)
    );
    bridge.api.images.read.mockClear();

    const { container } = mountMarkdown('![shot](docs/shot.png)', null);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('docs/shot.png');
    expect(bridge.api.images.read).not.toHaveBeenCalled();
  });

  it('leaves an inline data URI alone', () => {
    const { container } = mountMarkdown(`![inline](${DATA_URI})`);
    expect(container.querySelector('.cl-image img')?.getAttribute('src')).toBe(DATA_URI);
    expect(bridge.api.images.read).not.toHaveBeenCalled();
  });
});

describe('localImagePath', () => {
  it('tells a file on disk from everything else', () => {
    expect(localImagePath('/a/b.png', null)).toBe('/a/b.png');
    expect(localImagePath('file:///a/b%20c.png', null)).toBe('/a/b c.png');
    expect(localImagePath('docs/x.png', ROOT)).toBe(`${ROOT}/docs/x.png`);
    expect(localImagePath('docs/x.png', null)).toBeNull();
    expect(localImagePath('https://x.test/a.png', ROOT)).toBeNull();
    expect(localImagePath('data:image/png;base64,AA==', ROOT)).toBeNull();
  });
});
