// @vitest-environment jsdom
//
// The plan an `ExitPlanMode` presented (#278). The card said `presented` for
// every plan whatever the user decided, printed 280 characters of the body,
// and opened the generic tool panel — the plan as a JSON input. Now the card
// is the title and the outcome read off the call's own result, and every way
// in — the click, FULL density's window, the detail panel — draws the plan as
// the markdown document it is.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { StrictMode } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { MessageBubble } from '../src/components/project/chat/MessageBubble';
import { ToolDetailPanel } from '../src/components/project/chat/ToolDetailPanel';
import { buildProcessedMessages } from '../src/components/project/chat/utils';
import type { ChatDetailsFilter, ToolGroup } from '../src/components/project/chat/utils';
import type { ChatMessage } from '../src/types';

afterEach(cleanup);

const PLAN =
  '# Split the reader into two passes\n\n' +
  '## Context\n\nThe reader walks the file twice.\n\n' +
  '## Steps\n\n1. Read the rows\n2. Merge the extras\n';

// Claude Code's own words when the user refuses a tool call, as they sit in
// the transcript (the same text `isQuestionDismissed` reads for a question).
const CLI_REJECTION =
  "The user doesn't want to proceed with this tool use. The tool use was rejected " +
  '(eg. if it was a file edit, the new_string was NOT written to the file). ' +
  'To tell you how to proceed, the user said:\nkeep the single pass';

type Result = { content: string; isError?: boolean };

let input: Record<string, unknown>;

beforeEach(() => {
  input = { plan: PLAN, planFilePath: '/home/u/.claude/plans/quiet-river-fox.md' };
});

/** The assistant turn that called ExitPlanMode, plus the user row carrying
 *  its result when there is one — what `buildProcessedMessages` folds into a
 *  single tool group. */
function transcript(result?: Result): ChatMessage[] {
  return [
    {
      uuid: 'a1',
      role: 'assistant',
      timestamp: '2026-09-28T10:00:00.000Z',
      content: [{ type: 'tool_use', id: 'toolu_plan', name: 'ExitPlanMode', input }],
    },
    ...(result
      ? [
          {
            uuid: 'u1',
            role: 'user' as const,
            timestamp: '2026-09-28T10:01:00.000Z',
            content: [
              {
                type: 'tool_result' as const,
                toolUseId: 'toolu_plan',
                content: result.content,
                isError: result.isError ?? false,
              },
            ],
          },
        ]
      : []),
  ];
}

/** Mounted the way the app mounts (`src/main.tsx`): inside `StrictMode`. */
function mount(
  result: Result | undefined,
  detailsFilter: ChatDetailsFilter = 'minimal',
  onOpenToolDetail: (group: ToolGroup) => void = () => {}
) {
  const [processed] = buildProcessedMessages(transcript(result));
  return render(
    <StrictMode>
      <MessageBubble
        processed={processed}
        detailsFilter={detailsFilter}
        onOpenToolDetail={onOpenToolDetail}
      />
    </StrictMode>
  );
}

function group(result?: Result): ToolGroup {
  return buildProcessedMessages(transcript(result))[0].toolGroups[0];
}

describe('the plan card', () => {
  it('is the plan title and "Approved" once the user approved it — no body', () => {
    const { container } = mount({
      content: 'User has approved your plan. You can now start coding.',
    });

    const card = container.querySelector('.cl-plan-card');
    expect(card?.querySelector('.title')?.textContent).toBe('Split the reader into two passes');
    expect(card?.querySelector('.chip')?.textContent).toBe('Approved');
    expect(card?.textContent).not.toContain('The reader walks the file twice');
  });

  it('stays "Approved" when the plan the approval repeats quotes a refusal', () => {
    // An approval echoes the whole plan after `## Approved Plan:`; a plan about
    // permission handling carries the refusal's own words in its body.
    input = {
      ...input,
      plan: PLAN + '\n3. When the tool use was rejected, say "Denied by the user."\n',
    };
    const { container } = mount({
      content: `User has approved your plan. You can now start coding.\n\n## Approved Plan:\n${input.plan}`,
    });
    expect(container.querySelector('.cl-plan-card .chip')?.textContent).toBe('Approved');
  });

  it('says "Rejected" for the refusal Claude Code writes', () => {
    const { container } = mount({ content: CLI_REJECTION, isError: true });
    expect(container.querySelector('.cl-plan-card .chip')?.textContent).toBe('Rejected');
  });

  it('says "Rejected" for the SDK chat\'s own deny', () => {
    const { container } = mount({ content: 'Denied by the user.', isError: true });
    expect(container.querySelector('.cl-plan-card .chip')?.textContent).toBe('Rejected');
  });

  it('says "Not approved" for any other error, without naming who stopped it', () => {
    const { container } = mount({ content: 'Not in plan mode.', isError: true });
    expect(container.querySelector('.cl-plan-card .chip')?.textContent).toBe('Not approved');
  });

  it('says "Awaiting approval" while the call has no answer', () => {
    const { container } = mount(undefined);
    expect(container.querySelector('.cl-plan-card .chip')?.textContent).toBe('Awaiting approval');
  });

  it('opens the call it stands for', () => {
    const open = vi.fn();
    const { container } = mount({ content: 'User has approved your plan.' }, 'minimal', open);

    fireEvent.click(container.querySelector('.cl-plan-card')!);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0].use.id).toBe('toolu_plan');
  });
});

describe('the plan in FULL density', () => {
  it('is an editor window opened on the rendered document', () => {
    const { container } = mount({ content: 'User has approved your plan.' }, 'all');

    const win = container.querySelector('.cl-term--file');
    expect(win?.querySelector('.cl-term-kind')?.textContent).toBe('Plan');
    expect(win?.querySelector('.cl-term-title b')?.textContent).toBe('quiet-river-fox.md');
    expect(win?.querySelector('.cl-file-preview h1')?.textContent).toBe(
      'Split the reader into two passes'
    );
    expect(win?.querySelector('.cl-term-state')?.textContent).toBe('approved · 10 lines');
  });

  it('keeps the document for a rejected plan and prints what the user said under it', () => {
    const { container } = mount({ content: CLI_REJECTION, isError: true }, 'all');

    const win = container.querySelector('.cl-term--file');
    expect(win?.querySelector('.cl-file-preview h1')).not.toBeNull();
    expect(win?.querySelector('.cl-term-out')?.textContent).toContain('keep the single pass');
    expect(win?.querySelector('.cl-term-state')?.textContent).toBe('rejected · 10 lines');
  });
});

describe('the plan detail panel', () => {
  it('draws the plan as its document and states the outcome in the bar', () => {
    const { container } = render(
      <StrictMode>
        <ToolDetailPanel
          group={group({ content: CLI_REJECTION, isError: true })}
          onBack={() => {}}
        />
      </StrictMode>
    );

    expect(container.querySelector('.cl-file-preview h1')?.textContent).toBe(
      'Split the reader into two passes'
    );
    expect(container.querySelector('.cl-tool-detail-badges .cl-tool-status')?.textContent).toBe(
      'Rejected'
    );
  });
});
