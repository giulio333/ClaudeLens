/**
 * Marker for the buttons that open the unified search popover (the top-bar lens
 * and every "switch project" affordance).
 *
 * The popover closes on a `mousedown` outside itself, which fires *before* the
 * trigger's own `click`: without this marker the second click on a trigger read
 * as close-then-reopen, so the popover looked like it never toggled shut. The
 * popover skips marked triggers and leaves the toggle to their `onClick`.
 */
export const SEARCH_TRIGGER_ATTR = 'data-cl-search-trigger';

/** Spread onto a trigger button: `<button {...searchTriggerProps} …>`. */
export const searchTriggerProps = { [SEARCH_TRIGGER_ATTR]: '' } as const;

/** True when `target` sits inside a marked trigger. */
export function isSearchTrigger(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest(`[${SEARCH_TRIGGER_ATTR}]`);
}
