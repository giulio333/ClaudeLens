// @vitest-environment jsdom
//
// The files a session read, on the left edge of Lens — where the turn
// navigator used to be. The claims: at rest it is dots and a count, nothing to
// read; the files read in the turn being read are the lit ones; hover opens the
// names by folder, a name's hover the lines that were read — kept above the
// pill whatever its height; a click opens the file's own window, every read in
// it and the jump to its turn; closing waits out the crossing from capsule to
// panel and leaves both mounted so they can fade, but shut and inert; and a
// session that read nothing has no rail.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { StrictMode } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ContextRail } from '../src/components/project/chat/ContextRail';
import { contextFiles } from '../src/components/project/chat/context-files';
import { buildProcessedMessages } from '../src/components/project/chat/utils';
import type { ChatContentBlock, ChatMessage } from '../src/types';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const CWD = '/w/acme';

type Use = Extract<ChatContentBlock, { type: 'tool_use' }>;
type Result = Extract<ChatContentBlock, { type: 'tool_result' }>;

const use = (id: string, name: string, input: Record<string, unknown>): Use => ({
  type: 'tool_use',
  id,
  name,
  input,
});
const ok = (toolUseId: string, content: string): Result => ({
  type: 'tool_result',
  toolUseId,
  content,
  isError: false,
});

/** Turn i (1-based: i + 1) makes call i. */
function session(calls: [Use, Result][]) {
  const messages = calls.flatMap(([u, r], i): ChatMessage[] => [
    {
      uuid: `a${i}`,
      role: 'assistant',
      timestamp: `2026-09-22T10:00:0${i}.000Z`,
      content: [{ type: 'text', text: `step ${i}` }, u],
    },
    { uuid: `u${i}`, role: 'user', timestamp: `2026-09-22T10:00:0${i}.500Z`, content: [r] },
  ]);
  return contextFiles(buildProcessedMessages(messages), CWD);
}

const FILES = () =>
  session([
    [
      use('r1', 'Read', { file_path: '/w/acme/src/chat/utils.ts' }),
      ok('r1', '  1268\texport function touchedFiles() {\n  1269\t  return [];\n'),
    ],
    [use('b1', 'Bash', { command: "sed -n '40,41p' src/chat/View.tsx" }), ok('b1', 'a\nb\n')],
    [use('b2', 'Bash', { command: 'cat package.json' }), ok('b2', '{}\n')],
    [
      use('r2', 'Read', { file_path: '/w/acme/src/chat/utils.ts' }),
      ok('r2', '     1\timport x;\n'),
    ],
  ]);

function mount(activeTurn: number | null = null, onJump = vi.fn()) {
  const utils = render(
    <StrictMode>
      <ContextRail
        files={FILES()}
        cwd={CWD}
        turnOf={idx => idx + 1}
        activeTurn={activeTurn}
        onJump={onJump}
      />
    </StrictMode>
  );
  const anchor = utils.container.querySelector('.cl-ctx-anchor')!;
  return { ...utils, anchor, onJump };
}

const lnOf = (root: ParentNode) =>
  [...root.querySelectorAll('.cl-ctx-code-row .ln')].map(n => n.textContent);
const panelOf = (root: ParentNode) => root.querySelector('.cl-ctx-panel')!;
const isOpen = (el: Element | null) => el?.classList.contains('is-open') ?? false;

/** A file's row in the open panel, by the name it shows. */
const rowFor = (root: ParentNode, name: string) =>
  [...root.querySelectorAll('.cl-ctx-row')].find(r => r.textContent === name)!;

const rowNames = (root: ParentNode) =>
  [...root.querySelectorAll('.cl-ctx-row .name')].map(n => n.textContent);

describe('ContextRail', () => {
  it('is dots and a count at rest, with no names on screen', () => {
    const { container } = mount();
    expect(container.querySelectorAll('.cl-ctx-dot')).toHaveLength(3);
    expect(container.querySelector('.cl-ctx-total')?.textContent).toBe('3');
    // Mounted so it can animate, but shut: invisible, and out of reach.
    expect(isOpen(panelOf(container))).toBe(false);
    expect(panelOf(container).hasAttribute('inert')).toBe(true);
  });

  it('lights the files read in the turn being read', () => {
    // Turn 4 is the second read of utils.ts, which is the first file.
    const { container } = mount(4);
    const dots = [...container.querySelectorAll('.cl-ctx-dot')];
    expect(dots.map(d => d.classList.contains('is-active'))).toEqual([true, false, false]);
  });

  it('opens the names on hover, grouped by folder', () => {
    const { anchor, container } = mount();
    fireEvent.mouseEnter(anchor);
    expect(isOpen(panelOf(container))).toBe(true);
    expect(panelOf(container).hasAttribute('inert')).toBe(false);
    const labels = [...container.querySelectorAll('.cl-ctx-group-label')].map(l => l.textContent);
    expect(labels).toEqual(['src/chat', 'acme']);
    expect(rowNames(container)).toEqual(['utils.ts', 'View.tsx', 'package.json']);
  });

  it('shows the lines of the last read when a name is hovered', () => {
    const { anchor, container } = mount();
    fireEvent.mouseEnter(anchor);
    fireEvent.mouseEnter(rowFor(container, 'utils.ts'));
    const peek = container.querySelector('.cl-ctx-peek')!;
    expect(isOpen(peek)).toBe(true);
    // Name, lines, turn — and nothing at its foot.
    expect(peek.querySelector('.cl-ctx-peek-span')?.textContent).toBe('line 1');
    expect(peek.querySelector('.cl-ctx-peek-turn')?.textContent).toBe('turn 4');
    expect(lnOf(peek)).toEqual(['1']);
    expect(peek.textContent).not.toContain('read 2 times');
  });

  it('says a shell read came from a command, numbered from where it started', () => {
    const { anchor, container } = mount();
    fireEvent.mouseEnter(anchor);
    fireEvent.mouseEnter(rowFor(container, 'View.tsx'));
    const peek = container.querySelector('.cl-ctx-peek')!;
    expect(lnOf(peek)).toEqual(['40', '41']);
    // The command is the file window's to show, not the glance's.
    expect(peek.textContent).not.toContain('sed -n');
  });

  it('opens the file on click: every read, the one selected, the jump to its turn', () => {
    const { anchor, container, onJump } = mount();
    fireEvent.mouseEnter(anchor);
    fireEvent.click(rowFor(container, 'utils.ts'));
    // The window covers the page, so the hover panel behind it is shut.
    expect(isOpen(panelOf(container))).toBe(false);
    const sheet = document.body.querySelector('.cl-ctx-sheet')!;
    expect(sheet.querySelector('.cl-ctx-sheet-path')?.textContent).toBe(
      '/w/acme/src/chat/utils.ts'
    );
    const reads = [...sheet.querySelectorAll<HTMLButtonElement>('.cl-ctx-read')];
    expect(reads.map(r => r.querySelector('.t')?.textContent)).toEqual(['turn 1', 'turn 4']);
    // It opens on the last read, the one the peek was showing.
    expect(reads.map(r => r.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    const lines = () => lnOf(sheet);
    expect(lines()).toEqual(['1']);
    fireEvent.click(reads[0]);
    expect(lines()).toEqual(['1268', '1269']);
    expect(sheet.querySelector('.cl-ctx-sheet-foot')?.textContent).toContain(
      'lines 1, 1268–1269 read in all'
    );
    fireEvent.click(sheet.querySelector('.cl-ctx-jump')!);
    expect(onJump).toHaveBeenCalledWith(1);
    expect(document.body.querySelector('.cl-ctx-sheet')).toBeNull();
  });

  it('previews a compound command too, unnumbered: its output is not the file', () => {
    const files = session([
      [
        use('b1', 'Bash', { command: "wc -l src/a.ts; sed -n '1,2p' src/a.ts" }),
        ok('b1', '  90 src/a.ts\nx\ny\n'),
      ],
    ]);
    const { container } = render(
      <StrictMode>
        <ContextRail
          files={files}
          cwd={CWD}
          turnOf={i => i + 1}
          activeTurn={null}
          onJump={() => {}}
        />
      </StrictMode>
    );
    fireEvent.mouseEnter(container.querySelector('.cl-ctx-anchor')!);
    fireEvent.mouseEnter(rowFor(container, 'a.ts'));
    const peek = container.querySelector('.cl-ctx-peek')!;
    expect([...peek.querySelectorAll('.cl-ctx-code-row code')].map(c => c.textContent)).toEqual([
      '  90 src/a.ts',
      'x',
      'y',
    ]);
    expect(lnOf(peek)).toEqual(['', '', '']);
    fireEvent.click(rowFor(container, 'a.ts'));
    const sheet = document.body.querySelector('.cl-ctx-sheet')!;
    expect(sheet.querySelector('.cl-ctx-sheet-cmd code')?.textContent).toBe(
      "wc -l src/a.ts; sed -n '1,2p' src/a.ts"
    );
    // The window says what the output is.
    expect(sheet.querySelector('.cl-ctx-sheet-cmd .note')).not.toBeNull();
  });

  it('closes the file window on Escape', () => {
    const { anchor, container } = mount();
    fireEvent.mouseEnter(anchor);
    fireEvent.click(rowFor(container, 'View.tsx'));
    expect(document.body.querySelector('.cl-ctx-sheet')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.body.querySelector('.cl-ctx-sheet')).toBeNull();
  });

  it('keeps the peek above the pill, by its measured height', () => {
    // The rail runs 0–600 with the anchor at 100; the peek is 300 tall.
    const rect = (top: number, bottom = top) =>
      ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top }) as DOMRect;
    let rowTop = 0;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      if (this.classList.contains('cl-ctx-rail')) return rect(0, 600);
      if (this.classList.contains('cl-ctx-anchor')) return rect(100);
      return rect(rowTop);
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement
    ) {
      return this.classList.contains('cl-ctx-peek') ? 300 : 0;
    });
    const { anchor, container } = mount();
    fireEvent.mouseEnter(anchor);
    const peekTop = () => container.querySelector<HTMLElement>('.cl-ctx-peek')!.style.top;
    // A row near the top: the peek sits beside it.
    rowTop = 150;
    fireEvent.mouseEnter(rowFor(container, 'utils.ts'));
    expect(peekTop()).toBe('44px');
    // A row near the bottom: beside it would run past 600, so it rises to end there.
    rowTop = 500;
    fireEvent.mouseEnter(rowFor(container, 'View.tsx'));
    expect(peekTop()).toBe('200px');
  });

  it('closes on Escape and hands focus back to the capsule', () => {
    const { anchor, container } = mount();
    const capsule = container.querySelector<HTMLButtonElement>('.cl-ctx-capsule')!;
    fireEvent.click(capsule);
    expect(isOpen(panelOf(container))).toBe(true);
    fireEvent.keyDown(anchor, { key: 'Escape' });
    expect(isOpen(panelOf(container))).toBe(false);
    expect(document.activeElement).toBe(capsule);
  });

  it('closes after the crossing delay, fading the peek where it is', () => {
    vi.useFakeTimers();
    const { anchor, container } = mount();
    fireEvent.mouseEnter(anchor);
    fireEvent.mouseEnter(rowFor(container, 'utils.ts'));
    fireEvent.mouseLeave(anchor);
    // Still open while the pointer could be crossing from capsule to panel.
    expect(isOpen(panelOf(container))).toBe(true);
    act(() => vi.advanceTimersByTime(200));
    expect(isOpen(panelOf(container))).toBe(false);
    // The peek stays mounted with the file it showed, shut, so it fades out.
    const peek = container.querySelector('.cl-ctx-peek');
    expect(peek).not.toBeNull();
    expect(isOpen(peek)).toBe(false);
    expect(peek?.querySelector('.cl-ctx-peek-name')?.textContent).toBe('utils.ts');
  });

  it('re-entering before the delay keeps it open', () => {
    vi.useFakeTimers();
    const { anchor, container } = mount();
    fireEvent.mouseEnter(anchor);
    fireEvent.mouseLeave(anchor);
    act(() => vi.advanceTimersByTime(100));
    fireEvent.mouseEnter(anchor);
    act(() => vi.advanceTimersByTime(400));
    expect(isOpen(panelOf(container))).toBe(true);
  });

  it('draws nothing for a session that read nothing', () => {
    const { container } = render(
      <StrictMode>
        <ContextRail files={[]} cwd={CWD} turnOf={() => 1} activeTurn={null} onJump={() => {}} />
      </StrictMode>
    );
    expect(container.querySelector('.cl-ctx-rail')).toBeNull();
  });
});
