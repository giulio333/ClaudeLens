// @vitest-environment jsdom
//
// The pill folds to what the session is — model, context, spend — and opens to
// its controls on hover or focus. These are the claims about when it is open:
// a control the reader is using never folds away under them.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { StrictMode, useState } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { ChatControlPill } from '../src/components/project/chat/ChatControlPill';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Harness() {
  const [query, setQuery] = useState('');
  return (
    <ChatControlPill
      showTranscriptControls
      density="minimal"
      setDensity={() => {}}
      diffsOpen={false}
      onToggleDiffs={() => {}}
      canExport
      exporting={null}
      exportPreset="message"
      exportMessage={null}
      exportError={null}
      onOpenSheet={() => {}}
      openExportRef={{ current: null }}
      selectionMode={false}
      selectedCount={0}
      onToggleSelectionMode={() => {}}
      onClearSelection={() => {}}
      onExportPreset={() => {}}
      onExport={() => {}}
      modelRuns={[{ key: 't1', turnN: 1, model: 'claude-opus-5-5', effort: 'xhigh', turns: 3 }]}
      onLocateModel={() => {}}
      vitals={{ ctx: null, session: null }}
      find={{ query, setQuery, hits: 0, position: 0, onStep: () => {} }}
    />
  );
}

function mount() {
  const view = render(
    <StrictMode>
      <Harness />
    </StrictMode>
  );
  const pill = view.container.querySelector('.cl-pill') as HTMLElement;
  return { view, pill };
}

describe('ChatControlPill fold', () => {
  it('is folded at rest', () => {
    const { pill } = mount();
    expect(pill.hasAttribute('data-folded')).toBe(true);
  });

  it('opens on hover and folds only after the pointer has been gone a beat', () => {
    const { pill } = mount();
    fireEvent.mouseEnter(pill);
    expect(pill.hasAttribute('data-folded')).toBe(false);

    fireEvent.mouseLeave(pill);
    act(() => vi.advanceTimersByTime(100));
    expect(pill.hasAttribute('data-folded')).toBe(false);

    act(() => vi.advanceTimersByTime(400));
    expect(pill.hasAttribute('data-folded')).toBe(true);
  });

  it('stays open when the pointer comes back before the fold', () => {
    const { pill } = mount();
    fireEvent.mouseEnter(pill);
    fireEvent.mouseLeave(pill);
    act(() => vi.advanceTimersByTime(100));
    fireEvent.mouseEnter(pill);
    act(() => vi.advanceTimersByTime(1000));
    expect(pill.hasAttribute('data-folded')).toBe(false);
  });

  it('opens while focus is inside it', () => {
    const { pill } = mount();
    const ctx = pill.querySelector('.cl-pill-ctx') as HTMLElement;
    act(() => ctx.focus());
    expect(pill.hasAttribute('data-folded')).toBe(false);
    act(() => ctx.blur());
    expect(pill.hasAttribute('data-folded')).toBe(true);
  });

  it('keeps model and effort on the folded pill, with the effort as ticks', () => {
    const { pill } = mount();
    expect(pill.querySelector('.cl-pill-model-name')?.textContent).toBe('Opus 5.5');
    expect(pill.querySelector('.cl-pill-model-effort')?.textContent).toBe('xhigh');
    expect(pill.querySelectorAll('.cl-pill-ticks i[data-on]')).toHaveLength(4);
  });

  it('opens the context readout on hover only after the pointer has rested', () => {
    const { view, pill } = mount();
    const ctx = pill.querySelector('.cl-pill-ctx') as HTMLElement;
    fireEvent.mouseEnter(pill);
    fireEvent.mouseEnter(ctx);
    act(() => vi.advanceTimersByTime(300));
    expect(view.container.querySelector('.cl-vitals-pop--up')).toBeNull();
    act(() => vi.advanceTimersByTime(400));
    expect(view.container.querySelector('.cl-vitals-pop--up')).not.toBeNull();
  });

  it('drops a pending readout when the pointer moves on', () => {
    const { view, pill } = mount();
    const ctx = pill.querySelector('.cl-pill-ctx') as HTMLElement;
    fireEvent.mouseEnter(ctx);
    act(() => vi.advanceTimersByTime(300));
    fireEvent.mouseLeave(ctx);
    act(() => vi.advanceTimersByTime(1000));
    expect(view.container.querySelector('.cl-vitals-pop--up')).toBeNull();
  });

  it('stays open while a find query stands, pointer gone and focus elsewhere', () => {
    const { pill } = mount();
    fireEvent.mouseEnter(pill);
    fireEvent.click(pill.querySelector('[aria-label="Find in transcript"]') as HTMLElement);
    act(() => vi.runOnlyPendingTimers());
    const input = pill.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'parser' } });
    act(() => input.blur());
    fireEvent.mouseLeave(pill);
    act(() => vi.advanceTimersByTime(1000));
    expect(pill.hasAttribute('data-folded')).toBe(false);
  });
});
