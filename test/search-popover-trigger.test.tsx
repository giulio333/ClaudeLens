// @vitest-environment jsdom
//
// The unified search popover closes on a `mousedown` anywhere outside itself.
// That listener and the trigger button's own `onClick` fire on the *same*
// physical click, in that order — so before the trigger was marked, a second
// click on "switch project" closed the popover on mousedown and reopened it on
// click: it looked like the popover simply refused to toggle shut, and the only
// way out was clicking somewhere else entirely.
//
// These tests pin the seam: a marked trigger is left alone by the outside-click
// handler (its onClick owns the toggle), everything else still closes.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { SearchPopover } from '../src/components/project/shared/SearchPopover';
import {
  SEARCH_TRIGGER_ATTR,
  isSearchTrigger,
} from '../src/components/project/shared/searchTrigger';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

function renderPopover(onClose: () => void) {
  return render(
    <SearchPopover
      open
      mode="projects"
      anchorRect={null}
      projects={[{ hash: '-Users-foo-bar', realPath: '/Users/foo/bar' }]}
      costByHash={new Map()}
      pinned={new Set<string>()}
      onTogglePin={() => {}}
      onSelectProject={() => {}}
      onClose={onClose}
    />
  );
}

/** Appends a button to the document body, optionally marked as a trigger. */
function addButton(marked: boolean): HTMLButtonElement {
  const btn = document.createElement('button');
  if (marked) btn.setAttribute(SEARCH_TRIGGER_ATTR, '');
  document.body.appendChild(btn);
  return btn;
}

describe('search popover outside-click', () => {
  it('leaves a marked trigger to its own toggle', () => {
    const onClose = vi.fn();
    renderPopover(onClose);
    const trigger = addButton(true);

    trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('still closes on a mousedown that is not a trigger', () => {
    const onClose = vi.fn();
    renderPopover(onClose);
    const elsewhere = addButton(false);

    elsewhere.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('recognizes a descendant of a trigger (the icon inside the button)', () => {
    const trigger = addButton(true);
    const icon = document.createElement('span');
    trigger.appendChild(icon);

    expect(isSearchTrigger(icon)).toBe(true);
    expect(isSearchTrigger(addButton(false))).toBe(false);
    expect(isSearchTrigger(null)).toBe(false);
  });
});
