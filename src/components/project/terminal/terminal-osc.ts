import type { ILinkHandler } from '@xterm/xterm';

/**
 * The two escape sequences a program running in the pane uses to hand
 * something to the machine the pane is on (#293).
 *
 * Over ssh, Claude Code's `c to copy` writes OSC 52 (`ESC ]52;c;<base64> BEL`)
 * — it cannot reach this machine's clipboard any other way — and it prints a
 * URL as an OSC 8 hyperlink. The pane handled neither: the copy was dropped,
 * and a click on a link raised xterm's own `confirm()` and then a blank
 * `window.open()` the app refuses, so nothing opened. A first sign-in on a
 * remote host was impossible from the pane.
 *
 * Both sequences come from whatever runs in the pane — on a remote host, a
 * program on another machine — so each is taken for the one thing it is
 * needed for and nothing more.
 */

/** The most an OSC 52 copy may put on the clipboard, in decoded bytes. */
export const OSC52_MAX_BYTES = 1024 * 1024;

export type Osc52 =
  | { kind: 'copy'; text: string }
  | { kind: 'ignore'; reason: 'query' | 'clear' | 'invalid' | 'too-large' };

const ignore = (reason: 'query' | 'clear' | 'invalid' | 'too-large'): Osc52 => ({
  kind: 'ignore',
  reason,
});

/**
 * What an OSC 52 payload (`<targets>;<data>`, as xterm hands it over) asks for.
 *
 * - A copy: base64 of UTF-8 text, decoded strictly. Every target (`c`, `p`,
 *   `s`, …) goes to the one clipboard the app has.
 * - `?` asks to READ the clipboard. It is never answered: a reply would let
 *   the host read what the user copied on this machine.
 * - An empty payload asks to clear the clipboard. Ignored: a remote program
 *   has no business wiping it.
 * - Anything malformed or over `OSC52_MAX_BYTES` is dropped.
 */
export function parseOsc52(data: string): Osc52 {
  const semi = data.indexOf(';');
  if (semi < 0) return ignore('invalid');
  const payload = data.slice(semi + 1).replace(/\s+/g, '');
  if (payload === '?') return ignore('query');
  if (payload === '') return ignore('clear');
  // Four base64 characters carry three bytes: refuse before decoding anything.
  if (payload.length > Math.ceil(OSC52_MAX_BYTES / 3) * 4) return ignore('too-large');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(payload) || payload.length % 4 === 1) {
    return ignore('invalid');
  }
  try {
    const binary = atob(payload);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return { kind: 'copy', text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return ignore('invalid');
  }
}

/** Whether a hyperlink's target is a web page — the only kind the pane opens. */
export function isWebLink(uri: string): boolean {
  try {
    const { protocol } = new URL(uri);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * The pane's OSC 8 handler: a click opens a web link through `open` — in the
 * app, `window.open`, which the main process turns into `shell.openExternal`
 * — and does nothing for any other scheme. No confirmation dialog: the link is
 * opened in the user's browser, where the address bar shows where it went.
 */
export function makeLinkHandler(open: (uri: string) => void): ILinkHandler {
  return {
    activate: (_event, uri) => {
      if (isWebLink(uri)) open(uri);
    },
    allowNonHttpProtocols: false,
  };
}
