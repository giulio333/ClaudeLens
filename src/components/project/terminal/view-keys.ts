/** Rules for Mission Control's Terminal ↔ Lens switch. Pure, so the layout
 *  cases (AltGr, dead keys, IME) are pinned by tests rather than by hand. */

import type { ProcessedMessage } from '../chat/utils';

type Key = Pick<
  KeyboardEvent,
  'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'isComposing' | 'repeat'
>;

export const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

/** What the toggle is called in a tooltip. */
export const VIEW_TOGGLE_LABEL = IS_MAC ? '⌘J' : 'Ctrl+Shift+J';

/** ⌘J on macOS, Ctrl+Shift+J elsewhere. A bare Ctrl+J would never do: the
 *  terminal sends it to the CLI as a newline. */
export function isViewToggleKey(e: Key, isMac = IS_MAC): boolean {
  if (e.key.toLowerCase() !== 'j' || e.altKey || e.repeat) return false;
  return isMac ? e.metaKey && !e.ctrlKey && !e.shiftKey : e.ctrlKey && e.shiftKey && !e.metaKey;
}

// Where a keystroke already has a job: a field, or a menu/dialog/list the
// user is steering with the keyboard.
const KEYED =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], ' +
  '[role="dialog"], [role="menu"], [role="listbox"], [role="combobox"]';

/** The character a keystroke in the Lens would type, or null when the key is
 *  not text or already belongs to something on screen. Space is left out on
 *  purpose: it is how a reader pages down the transcript. */
export function lensTypedChar(e: Key, target: EventTarget | null): string | null {
  if (e.isComposing || e.repeat || e.metaKey) return null;
  // Ctrl alone is a shortcut; Ctrl+Alt is AltGr on Windows, which types text.
  if (e.ctrlKey && !e.altKey) return null;
  if ([...e.key].length !== 1 || e.key === ' ') return null;
  const el = target as Element | null;
  if (el && typeof el.closest === 'function' && el.closest(KEYED)) return null;
  return e.key;
}

/** The prompts the user sent in a session, by uuid: user rows that are neither
 *  a harness notice, a message from elsewhere, nor a built-in `/command` (a
 *  skill is a prompt). A new id here is what "the message went out" means — a
 *  bare Enter also answers permissions and picks menu items. */
export function sentPromptIds(turns: ProcessedMessage[]): string[] {
  return turns.flatMap(({ msg, notification, command }) =>
    msg.role === 'user' &&
    !notification &&
    !msg.inbound &&
    !msg.notice &&
    (!command || command.isSkill)
      ? [msg.uuid]
      : []
  );
}
