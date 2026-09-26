// A `canUseTool` ask on its way to the renderer, and the answer on its way back.
// The rule that must hold whatever the dialog does: when the SDK says the
// "Always allow" rule would grant more than the ask, nothing persistent is
// written — not offered, and not accepted if it arrives anyway.
import { describe, it, expect } from 'vitest';
import { toPermissionRequest, toPermissionResult } from '../electron/modules/chat-permissions';

const signal = new AbortController().signal;
const suggestions = [
  {
    type: 'addRules' as const,
    rules: [{ toolName: 'Bash' }],
    behavior: 'allow' as const,
    destination: 'localSettings' as const,
  },
];
const input = { command: 'npm test' };
/** The options every ask carries, plus what a case adds. */
const ask = <T extends object>(over: T) => ({
  signal,
  toolUseID: 'tu1',
  requestId: 'control-1',
  ...over,
});

describe('toPermissionRequest', () => {
  it('forwards the ask as the SDK wrote it', () => {
    const req = toPermissionRequest(
      'r1',
      's1',
      'Bash',
      input,
      ask({ title: 'Claude wants to run npm test', suggestions })
    );
    expect(req).toMatchObject({
      requestId: 'r1',
      sessionId: 's1',
      toolName: 'Bash',
      title: 'Claude wants to run npm test',
      suggestions,
      toolUseID: 'tu1',
    });
    expect(req.suppressAlwaysAllowRule).toBeUndefined();
    expect(req.defaultToNo).toBeUndefined();
  });

  it('withholds the suggestions when the rule would grant more than the ask', () => {
    const req = toPermissionRequest(
      'r1',
      's1',
      'Bash',
      input,
      ask({ suggestions, suppressAlwaysAllowRule: true })
    );
    expect(req.suggestions).toBeUndefined();
    expect(req.suppressAlwaysAllowRule).toBe(true);
  });

  it('carries defaultToNo and the MCP server behind an mcp__ tool', () => {
    const req = toPermissionRequest(
      'r1',
      's1',
      'mcp__acme__run',
      {},
      ask({ defaultToNo: true, mcpServer: { name: 'acme', source: 'plugin' } })
    );
    expect(req.defaultToNo).toBe(true);
    expect(req.mcpServer).toEqual({ name: 'acme', source: 'plugin' });
  });
});

describe('toPermissionResult', () => {
  it('writes the rules of an "Always allow"', () => {
    expect(toPermissionResult({ kind: 'always', input, suggestions })).toEqual({
      behavior: 'allow',
      updatedInput: input,
      updatedPermissions: suggestions,
    });
  });

  it('answers an "Always allow" to a suppressed ask as "allow once"', () => {
    const result = toPermissionResult(
      { kind: 'always', input, suggestions },
      { suppressAlwaysAllowRule: true }
    );
    expect(result).toEqual({ behavior: 'allow', updatedInput: input });
  });

  it('gives a denial a message Claude can read', () => {
    expect(toPermissionResult({ kind: 'deny' })).toEqual({
      behavior: 'deny',
      message: 'Denied by the user.',
    });
    expect(toPermissionResult({ kind: 'deny', message: 'not on main' })).toEqual({
      behavior: 'deny',
      message: 'not on main',
    });
  });
});
