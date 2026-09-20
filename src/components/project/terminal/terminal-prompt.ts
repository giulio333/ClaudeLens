import type { Terminal } from '@xterm/xterm';

export interface TerminalPromptHandle {
  /** Insert an editable draft after the CLI enables bracketed paste. Never submits. */
  pastePrompt(text: string, signal?: AbortSignal): Promise<void>;
}

type PromptTerminal = Pick<Terminal, 'modes' | 'onWriteParsed' | 'paste' | 'focus'>;
type SessionState = 'starting' | 'running' | 'exited' | 'error';
const READY_TIMEOUT_MS = 15_000;

export function createTerminalPromptController(term: PromptTerminal) {
  let state: SessionState = 'starting';
  let disposed = false;
  let pending: {
    text: string;
    resolve: () => void;
    reject: (error: Error) => void;
    removeAbortListener: () => void;
  } | null = null;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  function finish(error?: Error) {
    const request = pending;
    pending = null;
    request?.removeAbortListener();
    clearTimeout(timeout);
    timeout = undefined;
    if (error) request?.reject(error);
    else request?.resolve();
  }

  function tryPaste() {
    if (!pending || disposed || state !== 'running' || !term.modes.bracketedPasteMode) return;
    const text = pending.text;
    // Consume before calling xterm: onData can synchronously invoke other handlers.
    const request = pending;
    pending = null;
    request.removeAbortListener();
    clearTimeout(timeout);
    timeout = undefined;
    try {
      term.paste(text);
      term.focus();
      request.resolve();
    } catch (error) {
      request.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  const parsed = term.onWriteParsed(tryPaste);
  return {
    pastePrompt(text: string, signal?: AbortSignal): Promise<void> {
      if (signal?.aborted) return Promise.reject(new Error('Prompt insertion cancelled.'));
      if (disposed || state === 'exited' || state === 'error')
        return Promise.reject(
          new Error('The terminal is unavailable. Start a session and try again.')
        );
      // Newlines and tabs are draft content; terminal controls (especially ESC,
      // which could close bracketed paste) must never be silently stripped.
      if (
        [...text].some(char => {
          const code = char.charCodeAt(0);
          return (
            (code < 32 && code !== 9 && code !== 10 && code !== 13) || (code >= 127 && code <= 159)
          );
        })
      )
        return Promise.reject(
          new Error('The prompt contains unsupported terminal control characters.')
        );
      if (pending)
        return Promise.reject(new Error('A prompt is already waiting for the terminal.'));
      return new Promise((resolve, reject) => {
        const abort = () => finish(new Error('Prompt insertion cancelled.'));
        pending = {
          text,
          resolve,
          reject,
          removeAbortListener: () => signal?.removeEventListener('abort', abort),
        };
        signal?.addEventListener('abort', abort, { once: true });
        timeout = setTimeout(
          () =>
            finish(
              new Error(
                'Claude Code is not ready to accept a prompt. Complete any terminal setup, then try again.'
              )
            ),
          READY_TIMEOUT_MS
        );
        tryPaste();
      });
    },
    setState(next: SessionState) {
      state = next;
      if (next === 'exited' || next === 'error')
        finish(new Error('The terminal session ended before the prompt could be inserted.'));
      else tryPaste();
    },
    dispose() {
      disposed = true;
      parsed.dispose();
      finish(new Error('The terminal closed before the prompt could be inserted.'));
    },
  };
}
