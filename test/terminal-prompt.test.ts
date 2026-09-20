// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Terminal as XtermTerminal } from '@xterm/xterm';
import { createTerminalPromptController } from '../src/components/project/terminal/terminal-prompt';

describe('terminal prompt insertion with the real xterm parser', () => {
  let term: XtermTerminal;
  let controller: ReturnType<typeof createTerminalPromptController>;
  let data: string[];
  let host: HTMLDivElement;

  beforeEach(async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
    }));
    host = document.createElement('div');
    document.body.append(host);
    const { Terminal } = await import('@xterm/xterm');
    term = new Terminal();
    term.open(host);
    data = [];
    term.onData(chunk => data.push(chunk));
    controller = createTerminalPromptController(term);
  });

  afterEach(() => {
    controller.dispose();
    term.dispose();
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const write = (value: string) => new Promise<void>(resolve => term.write(value, resolve));

  it('waits for parsed bracketed-paste mode, then inserts one multiline editable draft', async () => {
    controller.setState('running');
    const pasted = controller.pastePrompt('Review this:\n\tfirst line\nsecond line\n');
    await write('Starting Claude Code…\r\n');
    expect(data).toEqual([]);
    await write('\x1b[?2004h');
    await pasted;
    expect(data).toEqual(['\x1b[200~Review this:\r\tfirst line\rsecond line\r\x1b[201~']);
    expect(document.activeElement).toBe(term.textarea);
    await write('\r\nMore startup output');
    expect(data).toHaveLength(1);
  });

  it('waits for the PTY create result when mode output arrived first', async () => {
    await write('\x1b[?2004h');
    const pasted = controller.pastePrompt('Check status');
    expect(data).toEqual([]);
    controller.setState('running');
    await pasted;
    expect(data).toEqual(['\x1b[200~Check status\x1b[201~']);
  });

  it('times out even a single line without submitting anything later', async () => {
    vi.useFakeTimers();
    controller.setState('running');
    const failed = expect(controller.pastePrompt('One line')).rejects.toThrow('not ready');
    await vi.advanceTimersByTimeAsync(15_000);
    await failed;
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
    await write('\x1b[?2004h');
    expect(data).toEqual([]);
  });

  it('cancels a pending insertion without later pasting or focusing, then accepts a new draft', async () => {
    controller.setState('running');
    const abort = new AbortController();
    const removeListener = vi.spyOn(abort.signal, 'removeEventListener');
    const focus = vi.spyOn(term, 'focus');
    const failed = expect(controller.pastePrompt('Cancelled', abort.signal)).rejects.toThrow(
      'cancelled'
    );
    abort.abort();
    await failed;
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    await write('\x1b[?2004h');
    expect(data).toEqual([]);
    expect(focus).not.toHaveBeenCalled();
    await controller.pastePrompt('New draft');
    expect(data).toEqual(['\x1b[200~New draft\x1b[201~']);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('refuses an already cancelled request even if the terminal is ready', async () => {
    controller.setState('running');
    await write('\x1b[?2004h');
    const abort = new AbortController();
    abort.abort();
    const focus = vi.spyOn(term, 'focus');
    await expect(controller.pastePrompt('Cancelled', abort.signal)).rejects.toThrow('cancelled');
    expect(data).toEqual([]);
    expect(focus).not.toHaveBeenCalled();
  });

  it.each(['success', 'dispose'] as const)('removes abort listeners on %s', async outcome => {
    const abort = new AbortController();
    const removeListener = vi.spyOn(abort.signal, 'removeEventListener');
    const pasted = controller.pastePrompt('Draft', abort.signal);
    if (outcome === 'dispose') {
      const failed = expect(pasted).rejects.toThrow('closed');
      controller.dispose();
      await failed;
    } else {
      controller.setState('running');
      await write('\x1b[?2004h');
      await pasted;
    }
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it.each(['exited', 'error'] as const)('rejects queued and new drafts after %s', async state => {
    const failed = expect(controller.pastePrompt('Queued')).rejects.toThrow('ended');
    controller.setState(state);
    await failed;
    await expect(controller.pastePrompt('Later')).rejects.toThrow('unavailable');
    await write('\x1b[?2004h');
    expect(data).toEqual([]);
  });

  it('does not replay a cancelled request after a StrictMode-style remount', async () => {
    const failed = expect(controller.pastePrompt('Old mount')).rejects.toThrow('closed');
    controller.dispose();
    await failed;
    const old = controller;
    controller = createTerminalPromptController(term);
    controller.setState('running');
    await write('\x1b[?2004h');
    expect(data).toEqual([]);
    await expect(old.pastePrompt('Stale callback')).rejects.toThrow('unavailable');
    await controller.pastePrompt('Current mount');
    expect(data).toEqual(['\x1b[200~Current mount\x1b[201~']);
  });

  it.each(['\x1b[201~\r', '\x03', '\x00', '\x7f', '\x85'])(
    'refuses control characters %j without changing the draft',
    async control => {
      controller.setState('running');
      await write('\x1b[?2004h');
      await expect(controller.pastePrompt(`Keep${control}this`)).rejects.toThrow(
        'control characters'
      );
      expect(data).toEqual([]);
    }
  );

  it('rejects a concurrent insertion rather than replacing or duplicating it', async () => {
    controller.setState('running');
    const first = controller.pastePrompt('First');
    await expect(controller.pastePrompt('Second')).rejects.toThrow('already waiting');
    await write('\x1b[?2004h');
    await first;
    expect(data).toEqual(['\x1b[200~First\x1b[201~']);
  });
});
