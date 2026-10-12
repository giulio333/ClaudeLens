import { describe, expect, it } from 'vitest';
import { buildProcessedMessages } from '../src/components/project/chat/utils';
import {
  isViewToggleKey,
  lensTypedChar,
  sentPromptIds,
} from '../src/components/project/terminal/view-keys';
import type { ChatMessage } from '../src/types';

const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
  repeat: false,
  ...mods,
});

describe('isViewToggleKey', () => {
  it('is ⌘J on macOS and nothing else there', () => {
    expect(isViewToggleKey(key('j', { metaKey: true }), true)).toBe(true);
    expect(isViewToggleKey(key('J', { metaKey: true, shiftKey: true }), true)).toBe(false);
    expect(isViewToggleKey(key('j', { ctrlKey: true }), true)).toBe(false);
    expect(isViewToggleKey(key('j', { metaKey: true, repeat: true }), true)).toBe(false);
  });

  it('is Ctrl+Shift+J elsewhere, never a bare Ctrl+J (the CLI newline)', () => {
    expect(isViewToggleKey(key('J', { ctrlKey: true, shiftKey: true }), false)).toBe(true);
    expect(isViewToggleKey(key('j', { ctrlKey: true }), false)).toBe(false);
    expect(isViewToggleKey(key('j', { metaKey: true }), false)).toBe(false);
  });
});

describe('lensTypedChar', () => {
  const body = { closest: () => null } as unknown as EventTarget;
  const field = { closest: () => ({}) } as unknown as EventTarget;

  it('returns a printable character typed on the page', () => {
    expect(lensTypedChar(key('a'), body)).toBe('a');
    expect(lensTypedChar(key('A', { shiftKey: true }), body)).toBe('A');
    expect(lensTypedChar(key('è'), body)).toBe('è');
  });

  it('keeps characters typed through Option or AltGr', () => {
    expect(lensTypedChar(key('@', { altKey: true }), body)).toBe('@');
    expect(lensTypedChar(key('@', { altKey: true, ctrlKey: true }), body)).toBe('@');
  });

  it('ignores shortcuts, non-text keys, space, composition and repeats', () => {
    expect(lensTypedChar(key('c', { metaKey: true }), body)).toBeNull();
    expect(lensTypedChar(key('c', { ctrlKey: true }), body)).toBeNull();
    expect(lensTypedChar(key('Enter'), body)).toBeNull();
    expect(lensTypedChar(key('Dead'), body)).toBeNull();
    expect(lensTypedChar(key(' '), body)).toBeNull();
    expect(lensTypedChar(key('a', { isComposing: true }), body)).toBeNull();
    expect(lensTypedChar(key('a', { repeat: true }), body)).toBeNull();
  });

  it('leaves a key typed into a field or a menu where it is', () => {
    expect(lensTypedChar(key('a'), field)).toBeNull();
  });
});

describe('sentPromptIds', () => {
  const row = (uuid: string, text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
    uuid,
    role: 'user',
    timestamp: '2026-01-01T00:00:00.000Z',
    content: [{ type: 'text', text }],
    ...extra,
  });

  it('counts typed prompts and skills, not commands, replies or notices', () => {
    const turns = buildProcessedMessages([
      row('p1', 'fix the build'),
      row('a1', 'done', { role: 'assistant' }),
      row('c1', '<command-name>/model</command-name><command-args></command-args>'),
      row('s1', '<command-name>/tidy</command-name><command-args></command-args>', {
        skillPath: '/skills/tidy',
      }),
      row(
        't1',
        '<task-notification><task-id>x</task-id><status>completed</status></task-notification>'
      ),
    ]);
    expect(sentPromptIds(turns)).toEqual(['p1', 's1']);
  });
});
