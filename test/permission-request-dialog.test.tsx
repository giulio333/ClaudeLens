// @vitest-environment jsdom
//
// The approval dialog of the SDK chat, for the three things the Agent SDK now
// states about an ask instead of leaving the app to guess (#292):
//
//   - `suppressAlwaysAllowRule`: no persistent "Always allow", even with
//     suggestions in hand — the rule would grant more than the ask;
//   - `defaultToNo`: the dialog opens on its decline option, so Enter denies;
//   - `mcpServer`: who serves an `mcp__*` tool, printed as text.
//
// Mounted the way ChatComposer mounts it: one dialog per request, keyed on the
// request id, inside StrictMode.
import { StrictMode } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { PermissionRequestDialog } from '../src/components/project/chat/PermissionRequestDialog';
import type { PermissionRequest } from '../src/types';

const suggestions = [{ type: 'addRules', rules: [{ toolName: 'Bash' }] }];

function request(over: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    requestId: 'r1',
    sessionId: 's1',
    toolName: 'Bash',
    title: 'Claude wants to run a command',
    input: { command: 'npm test' },
    suggestions,
    toolUseID: 'tu1',
    ...over,
  };
}

function mount(req: PermissionRequest, onRespond = vi.fn()) {
  const ui = (r: PermissionRequest) => (
    <StrictMode>
      <PermissionRequestDialog
        key={r.requestId}
        request={r}
        pendingCount={0}
        onRespond={onRespond}
      />
    </StrictMode>
  );
  const view = render(ui(req));
  return { ...view, onRespond, next: (r: PermissionRequest) => view.rerender(ui(r)) };
}

afterEach(cleanup);

describe('PermissionRequestDialog', () => {
  it('offers "Always allow" when the SDK sent the rules to save', () => {
    mount(request());
    expect(screen.getByRole('button', { name: 'Always allow' })).toBeTruthy();
  });

  it('does not offer it when the rule would grant more than the ask, and says why', () => {
    mount(request({ suppressAlwaysAllowRule: true }));
    expect(screen.queryByRole('button', { name: 'Always allow' })).toBeNull();
    expect(screen.getByText(/covers more than this request/)).toBeTruthy();
  });

  it('opens on Deny when the ask must not be approved by a stray keystroke', () => {
    mount(request({ defaultToNo: true }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Deny…' }));
  });

  it('puts nothing in focus by default', () => {
    mount(request());
    const focused = document.activeElement;
    expect(focused === document.body || focused === null).toBe(true);
  });

  it('starts the next queued request clean: its own focus, no leftover denial', () => {
    const { next } = mount(request());
    fireEvent.click(screen.getByRole('button', { name: 'Deny…' }));
    fireEvent.change(screen.getByPlaceholderText(/tell Claude why/), {
      target: { value: 'half-typed reason' },
    });

    next(request({ requestId: 'r2', defaultToNo: true }));
    expect(screen.queryByPlaceholderText(/tell Claude why/)).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Deny…' }));
  });

  it("prints the MCP server's name as text, with where it is configured", () => {
    mount(
      request({
        toolName: 'mcp__acme__run',
        input: {},
        mcpServer: { name: '<b>acme</b>', source: 'plugin' },
      })
    );
    const line = screen.getByTestId('perm-mcp-server');
    expect(line.textContent).toBe('via <b>acme</b> · plugin');
    expect(line.querySelector('b')).toBeNull();
  });
});
