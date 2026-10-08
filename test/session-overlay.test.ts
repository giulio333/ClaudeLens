// What the frame's top bar calls the detail that covers a session (#304). The
// panels render chromeless, so this crumb is the only place the frame says
// which of the session's units is on screen — in Mission Control and in the SDK
// chat alike, from the same function.

import { describe, expect, it } from 'vitest';
import { overlayCrumb } from '../src/components/project/shared/session-overlay';
import type { ToolGroup } from '../src/components/project/chat/utils';
import type { Skill } from '../src/types';

const bash = {
  use: { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } },
  result: null,
} as unknown as ToolGroup;

describe('overlayCrumb', () => {
  it('says nothing when no detail is open', () => {
    expect(overlayCrumb(null)).toBeNull();
  });

  it("names a tool by its name, with the tool's icon", () => {
    const crumb = overlayCrumb({ kind: 'tool', group: bash });
    expect(crumb?.kind).toBe('tool');
    expect(crumb?.label).toBe('Bash');
    expect(crumb?.icon).toBeTruthy();
  });

  it('names a skill definition as a skill', () => {
    const skill = { name: 'deploy' } as Skill;
    expect(overlayCrumb({ kind: 'skill-def', skill })).toEqual({ kind: 'skill', label: 'deploy' });
  });

  it('leaves a file to name itself in its own head', () => {
    expect(overlayCrumb({ kind: 'file', rel: 'src/a.ts' })).toBeNull();
  });
});
