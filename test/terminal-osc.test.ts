// OSC 52 and OSC 8 as the terminal pane takes them (#293): what a program in
// the pane — on a remote host, a program on another machine — may hand to this
// one, and what it may not.
import { describe, it, expect, vi } from 'vitest';
import {
  OSC52_MAX_BYTES,
  isWebLink,
  makeLinkHandler,
  parseOsc52,
} from '../src/components/project/terminal/terminal-osc';

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

describe('parseOsc52', () => {
  it('copies the decoded text, UTF-8 included, whatever the target', () => {
    const url =
      'https://claude.ai/oauth/authorize?code=true&redirect_uri=https%3A%2F%2Fx%2Fcallback';
    expect(parseOsc52(`c;${b64(url)}`)).toEqual({ kind: 'copy', text: url });
    expect(parseOsc52(`p;${b64('città ✓')}`)).toEqual({ kind: 'copy', text: 'città ✓' });
    expect(parseOsc52(`;${b64('no target')}`)).toEqual({ kind: 'copy', text: 'no target' });
  });

  it('never answers a request to read the clipboard', () => {
    expect(parseOsc52('c;?')).toEqual({ kind: 'ignore', reason: 'query' });
  });

  it('does not let a remote program clear the clipboard', () => {
    expect(parseOsc52('c;')).toEqual({ kind: 'ignore', reason: 'clear' });
  });

  it('drops what is not base64, or not UTF-8', () => {
    expect(parseOsc52('no-separator')).toEqual({ kind: 'ignore', reason: 'invalid' });
    expect(parseOsc52('c;***')).toEqual({ kind: 'ignore', reason: 'invalid' });
    expect(parseOsc52('c;/w==')).toEqual({ kind: 'ignore', reason: 'invalid' }); // byte 0xff
  });

  it('refuses a payload larger than the cap before decoding it', () => {
    const big = 'A'.repeat(Math.ceil(OSC52_MAX_BYTES / 3) * 4 + 4);
    expect(parseOsc52(`c;${big}`)).toEqual({ kind: 'ignore', reason: 'too-large' });
  });
});

describe("the pane's hyperlinks", () => {
  it('opens a web link and nothing else', () => {
    expect(isWebLink('https://claude.ai/oauth/authorize?x=1')).toBe(true);
    expect(isWebLink('http://localhost:5173/')).toBe(true);
    expect(isWebLink('file:///etc/passwd')).toBe(false);
    expect(isWebLink('javascript:alert(1)')).toBe(false);
    expect(isWebLink('not a url')).toBe(false);

    const open = vi.fn();
    const handler = makeLinkHandler(open);
    handler.activate({} as MouseEvent, 'https://example.test/a', {} as never);
    handler.activate({} as MouseEvent, 'file:///etc/passwd', {} as never);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('https://example.test/a');
    expect(handler.allowNonHttpProtocols).toBe(false);
  });
});
