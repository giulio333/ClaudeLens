// @vitest-environment jsdom
//
// The kebab that replaced the three labelled buttons on a session row. Two
// rules are worth pinning: the trigger must not reach the row behind it (the
// row is itself a button that opens the session — a menu that opened the
// session while opening was the whole reason the actions used to carry
// stopPropagation), and a second click on the trigger must close the menu
// rather than close-and-reopen it, which is what happens when the
// outside-mousedown listener does not exclude its own trigger.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SessionRowMenu } from '../src/components/project/sessions/SessionRowMenu';

afterEach(cleanup);

function renderInRow(over: { pinned?: boolean } = {}) {
  const handlers = {
    onRowClick: vi.fn(),
    onOpenChat: vi.fn(),
    onAddTag: vi.fn(),
    onTogglePin: vi.fn(),
    onDelete: vi.fn(),
  };
  render(
    <div role="button" tabIndex={0} onClick={handlers.onRowClick}>
      <SessionRowMenu
        title="Dispatch the cl-probe subagent"
        pinned={over.pinned ?? false}
        pickerOpen={false}
        onOpenChat={handlers.onOpenChat}
        onAddTag={handlers.onAddTag}
        onTogglePin={handlers.onTogglePin}
        onDelete={handlers.onDelete}
      />
    </div>
  );
  const trigger = screen.getByLabelText('Actions for Dispatch the cl-probe subagent');
  return { ...handlers, trigger };
}

describe('SessionRowMenu', () => {
  it('opens the menu without opening the session behind it', () => {
    const { trigger, onRowClick } = renderInRow();
    expect(screen.queryByText('Open in chat')).toBeNull();

    fireEvent.click(trigger);

    expect(screen.getByText('Open in chat')).toBeTruthy();
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('closes on a second click of the trigger', () => {
    const { trigger } = renderInRow();
    fireEvent.click(trigger);
    // The real gesture is mousedown (which the outside-click listener sees)
    // followed by click; the listener has to ignore its own trigger for the
    // toggle to land on "closed".
    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByText('Open in chat')).toBeNull();
  });

  it('closes on an outside mousedown and on Escape', () => {
    const { trigger } = renderInRow();

    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('Open in chat')).toBeNull();

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Open in chat')).toBeNull();
  });

  it('runs each action once and closes the menu', () => {
    const { trigger, onOpenChat, onAddTag, onTogglePin, onDelete, onRowClick } = renderInRow();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByText('Open in chat'));
    expect(onOpenChat).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Open in chat')).toBeNull();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByText('Add tag…'));
    // The picker anchors to the kebab, so the action carries its rect.
    expect(onAddTag).toHaveBeenCalledTimes(1);
    expect(onAddTag.mock.calls[0][0]).toBeTruthy();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByText('Pin session'));
    expect(onTogglePin).toHaveBeenCalledTimes(1);

    fireEvent.click(trigger);
    fireEvent.click(screen.getByText('Delete session…'));
    expect(onDelete).toHaveBeenCalledTimes(1);

    // None of it reached the row.
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('names the pin action after the session state', () => {
    const { trigger } = renderInRow({ pinned: true });
    fireEvent.click(trigger);
    expect(screen.getByText('Unpin session')).toBeTruthy();
  });
});
