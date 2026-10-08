// @vitest-environment jsdom
//
// The reading column both transcripts share (#304). `ChatView` feeds it from
// disk — the Lens — and these tests pin what the Lens shows, so moving the
// column into `TranscriptBody` cannot change it: a tool-only Edit folds into
// the turn before it with its diff at the foot, a skill run is handed to the
// host frame, and the pill states the session's spend — `—` when there is no
// session row to read it from, never a zero nobody measured.

import { StrictMode, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeContext } from '../src/hooks/useTheme';
import { ChatView } from '../src/components/project/chat/ChatView';
import { TranscriptBody } from '../src/components/project/chat/TranscriptBody';
import type { ChatMessage } from '../src/types';
import {
  installFakeElectronAPI,
  ok,
  sessionSummary,
  type FakeBridge,
} from './helpers/fake-electron-api';

const PROJECT = { hash: '-projects-acme', realPath: '/projects/acme' };
const AT = '2026-10-08T10:00:00.000Z';
const MODEL = 'claude-sonnet-5';

/** A turn that says what it will do, the Edit it then makes on a row of its
 *  own (the way Claude Code persists it), the Edit's result, and a skill run. */
const CONVERSATION: ChatMessage[] = [
  { uuid: 'u1', role: 'user', timestamp: AT, content: [{ type: 'text', text: 'Fix the import.' }] },
  {
    uuid: 'a1',
    role: 'assistant',
    timestamp: AT,
    model: MODEL,
    content: [{ type: 'text', text: 'I will fix the import.' }],
  },
  {
    uuid: 'a2',
    role: 'assistant',
    timestamp: AT,
    model: MODEL,
    content: [
      {
        type: 'tool_use',
        id: 'toolu_edit1',
        name: 'Edit',
        input: { file_path: '/projects/acme/src/a.ts', old_string: 'b', new_string: 'c' },
      },
    ],
  },
  {
    uuid: 'r1',
    role: 'user',
    timestamp: AT,
    content: [
      { type: 'tool_result', toolUseId: 'toolu_edit1', content: 'updated', isError: false },
    ],
  },
  {
    uuid: 'a3',
    role: 'assistant',
    timestamp: AT,
    model: MODEL,
    content: [{ type: 'tool_use', id: 'toolu_skill1', name: 'Skill', input: { skill: 'deploy' } }],
  },
  {
    uuid: 'r2',
    role: 'user',
    timestamp: AT,
    content: [
      {
        type: 'tool_result',
        toolUseId: 'toolu_skill1',
        content: 'Launching skill: deploy',
        isError: false,
      },
    ],
  },
];

let bridge: FakeBridge;
let queryClient: QueryClient;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  // The windowed transcript sizes itself off its scroll box, which jsdom does not lay out.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: 900,
    right: 1200,
    width: 1200,
    height: 900,
    toJSON: () => ({}),
  } as DOMRect);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(900);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1200);
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  localStorage.clear();
  bridge = installFakeElectronAPI();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  Object.assign(bridge.api, {
    skills: { getAll: vi.fn(async () => ok([])) },
    plugins: { getAll: vi.fn(async () => ok([])) },
    agents: { getGlobal: vi.fn(async () => ok([])), getByProject: vi.fn(async () => ok([])) },
  });
  bridge.api.sessions.getChat.mockResolvedValue(ok(CONVERSATION));
});

afterEach(() => {
  cleanup();
  bridge.restore();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function framed(node: ReactNode) {
  return (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeContext.Provider
          value={{ preference: 'light', resolved: 'light', setPreference: vi.fn() }}
        >
          {node}
        </ThemeContext.Provider>
      </QueryClientProvider>
    </StrictMode>
  );
}

function mount(node: ReactNode) {
  return render(framed(node));
}

const spend = () => screen.getByLabelText('Session spend detail').textContent;

describe('the Lens, fed from disk', () => {
  it('folds a tool-only Edit into the turn before it, with its diff at the foot', async () => {
    mount(
      <ChatView
        embedded
        project={PROJECT}
        session={sessionSummary()}
        onBack={vi.fn()}
        onOpenTool={vi.fn()}
      />
    );
    expect(await screen.findByText('Updated')).toBeTruthy();
    expect(screen.getByText('a.ts')).toBeTruthy();
  });

  it('hands a skill run to the host frame', async () => {
    const onOpenTool = vi.fn();
    mount(
      <ChatView
        embedded
        project={PROJECT}
        session={sessionSummary()}
        onBack={vi.fn()}
        onOpenTool={onOpenTool}
      />
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Skill tool — expand details' }));
    fireEvent.click(screen.getByRole('button', { name: /View output/ }));
    expect(onOpenTool).toHaveBeenCalledWith(
      expect.objectContaining({ use: expect.objectContaining({ name: 'Skill' }) })
    );
  });

  it("states the session's spend in the pill", async () => {
    mount(
      <ChatView
        embedded
        project={PROJECT}
        session={sessionSummary({ estimatedCost: 0.42 })}
        onBack={vi.fn()}
        onOpenTool={vi.fn()}
      />
    );
    await screen.findByText('Updated');
    expect(spend()).toBe('$0.42');
  });
});

describe('the column without a session row', () => {
  it('prints a dash for spend, not a zero', () => {
    mount(
      <TranscriptBody
        project={PROJECT}
        messages={CONVERSATION}
        scrollKey="new-chat"
        sessionId={null}
        summary={null}
        onOpenTool={vi.fn()}
      />
    );
    expect(spend()).toBe('—');
  });

  it('prints a measured zero as one', () => {
    mount(
      <TranscriptBody
        project={PROJECT}
        messages={CONVERSATION}
        scrollKey="new-chat"
        sessionId={null}
        summary={sessionSummary()}
        onOpenTool={vi.fn()}
      />
    );
    expect(spend()).toBe('$0.00');
  });
});

describe('a detail over the column', () => {
  // A box that is not rendered reads 0 for its scroll metrics, as in a browser
  // (an element with `display: none` has no layout box). jsdom lays nothing
  // out, so the feed's metrics are stubbed per element here: a scroll position
  // it keeps while shown, and zeros while an ancestor hides it.
  const scrollTops = new WeakMap<Element, number>();
  const isShown = (el: Element) => {
    for (let n: HTMLElement | null = el as HTMLElement; n; n = n.parentElement) {
      if (n.style?.display === 'none') return false;
    }
    return true;
  };
  let scrolledTo: number[];

  beforeEach(() => {
    scrolledTo = [];
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
      this: HTMLElement
    ) {
      return isShown(this) ? 900 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (
      this: HTMLElement
    ) {
      return isShown(this) ? 20000 : 0;
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
      configurable: true,
      get(this: HTMLElement) {
        return isShown(this) ? (scrollTops.get(this) ?? 0) : 0;
      },
      set(this: HTMLElement, v: number) {
        scrollTops.set(this, v);
      },
    });
    HTMLElement.prototype.scrollTo = function (this: HTMLElement, opts?: ScrollToOptions | number) {
      const top = typeof opts === 'object' ? (opts.top ?? 0) : 0;
      scrolledTo.push(top);
      this.scrollTop = top;
    } as typeof HTMLElement.prototype.scrollTo;
  });

  afterEach(() => {
    delete (HTMLElement.prototype as { scrollTop?: number }).scrollTop;
    delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
  });

  const turns = (n: number): ChatMessage[] =>
    Array.from({ length: n }, (_, i) => ({
      uuid: `t${i + 1}`,
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      timestamp: AT,
      ...(i % 2 === 0 ? {} : { model: MODEL }),
      content: [{ type: 'text' as const, text: `Turn ${i + 1}` }],
    }));

  it('gives a reader who scrolled up their place back, even if turns arrived meanwhile', () => {
    const column = (messages: ChatMessage[], hidden: boolean) =>
      framed(
        <TranscriptBody
          project={PROJECT}
          messages={messages}
          scrollKey="live"
          sessionId={null}
          summary={null}
          hidden={hidden}
          onOpenTool={vi.fn()}
        />
      );
    const before = turns(12);
    const { container, rerender } = render(column(before, false));
    const feed = container.querySelector('.cl-chat-feed') as HTMLElement;

    // The reader wheels up into the middle of the conversation.
    fireEvent.wheel(feed, { deltaY: -120 });
    feed.scrollTop = 4500;
    fireEvent.scroll(feed);

    // A detail covers the column, and the stream appends a turn under it.
    rerender(column(before, true));
    rerender(column([...before, ...turns(13).slice(12)], true));

    // The detail closes: the reader is put back where they were reading.
    scrolledTo = [];
    rerender(column([...before, ...turns(13).slice(12)], false));
    expect(scrolledTo.length).toBeGreaterThan(0);
    expect(scrolledTo[0]).toBeGreaterThan(0);
  });
});
