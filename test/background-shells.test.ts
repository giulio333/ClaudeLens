// The shell commands a session left running in the background.
//
// Fed through `buildProcessedMessages`, the way the top bar reads them, so the
// notification parsing is part of the claim. The row shapes are the ones on
// disk: the `Bash` result names the task id in prose (two phrasings, one per
// way into the background), the ending is a `<task-notification>` carrying the
// call's `tool-use-id`, and a `TaskStop` writes no notification at all.

import { describe, it, expect } from 'vitest';
import {
  buildBackgroundShells,
  spanLabel,
  visibleShells,
  RECENT_WINDOW_MS,
} from '../src/components/project/terminal/background-shells';
import { buildProcessedMessages } from '../src/components/project/chat/utils';
import type { ChatMessage } from '../src/types';

const T0 = Date.parse('2026-08-11T10:00:00.000Z');
const iso = (m: number) => new Date(T0 + m * 60_000).toISOString();

let seq = 0;
function row(m: number, role: 'user' | 'assistant', content: unknown[]): ChatMessage {
  return { uuid: `r${seq++}`, role, timestamp: iso(m), content } as ChatMessage;
}

function bashCall(m: number, id: string, input: Record<string, unknown>): ChatMessage {
  return row(m, 'assistant', [{ type: 'tool_use', id, name: 'Bash', input }]);
}

function result(m: number, id: string, content: string, isError = false): ChatMessage {
  return row(m, 'user', [{ type: 'tool_result', toolUseId: id, content, isError }]);
}

const launched = (task: string) =>
  `Command running in background with ID: ${task}. Output is being written to: /tmp/x/tasks/${task}.output. You will be notified when it completes.`;
const movedByTimeout = (task: string) =>
  `Command did not complete within its 120s timeout and was moved to the background (ID: ${task}). Output is being written to: /tmp/x/tasks/${task}.output.`;

function notification(
  m: number,
  task: string,
  toolUseId: string,
  status: string,
  summary: string
): ChatMessage {
  const text = `<task-notification>\n<task-id>${task}</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<output-file>/tmp/x/tasks/${task}.output</output-file>\n<status>${status}</status>\n<summary>${summary}</summary>\n</task-notification>`;
  return row(m, 'user', [{ type: 'text', text }]);
}

function taskStop(m: number, id: string, task: string, isError = false): ChatMessage[] {
  return [
    row(m, 'assistant', [{ type: 'tool_use', id, name: 'TaskStop', input: { task_id: task } }]),
    result(
      m,
      id,
      isError ? 'No task found' : `{"message":"Successfully stopped task: ${task}"}`,
      isError
    ),
  ];
}

const shellsOf = (messages: ChatMessage[]) =>
  buildBackgroundShells(buildProcessedMessages(messages));

describe('buildBackgroundShells', () => {
  it('finds a shell Claude sent to the background, titled by its description', () => {
    const [shell] = shellsOf([
      bashCall(0, 'toolu_a', {
        command: 'for i in $(seq 1 60); do gh pr checks 12; sleep 20; done',
        description: 'Wait for the PR checks',
        run_in_background: true,
      }),
      result(0, 'toolu_a', launched('bgaaa111')),
    ]);
    expect(shell).toMatchObject({
      toolUseId: 'toolu_a',
      taskId: 'bgaaa111',
      title: 'Wait for the PR checks',
      state: 'running',
      startedAt: T0,
      via: 'requested',
    });
  });

  it('finds a shell the harness moved to the background when it outran its timeout', () => {
    const shells = shellsOf([
      bashCall(0, 'toolu_b', { command: 'npm run build\nnpm test' }),
      result(2, 'toolu_b', movedByTimeout('bbbb2222')),
    ]);
    expect(shells).toHaveLength(1);
    expect(shells[0]).toMatchObject({ taskId: 'bbbb2222', via: 'timeout', timeoutS: 120 });
    // No description: the command's first line stands in.
    expect(shells[0].title).toBe('npm run build');
  });

  it('ignores a Bash call that finished in the foreground, or failed', () => {
    const shells = shellsOf([
      bashCall(0, 'toolu_c', { command: 'ls' }),
      result(0, 'toolu_c', 'a\nb'),
      bashCall(1, 'toolu_d', { command: 'sleep 999', run_in_background: true }),
      result(1, 'toolu_d', 'permission denied', true),
    ]);
    expect(shells).toEqual([]);
  });

  it('ignores a command that only printed the sentence, as a grep over transcripts does', () => {
    // No notification would ever end these: counted, they read "running" for
    // the rest of the process.
    const shells = shellsOf([
      bashCall(0, 'toolu_g', { command: 'grep -h "in background" transcripts/*.jsonl' }),
      result(0, 'toolu_g', `{"type":"user","content":"${launched('bggg')}"}`),
      bashCall(1, 'toolu_h', { command: 'python3 count_results.py' }),
      result(1, 'toolu_h', `2 '${movedByTimeout('bhhh')}'`),
    ]);
    expect(shells).toEqual([]);
  });

  it('ends a shell on its notification, matched by tool-use-id, with the exit code', () => {
    const [ok, bad] = shellsOf([
      bashCall(0, 'toolu_e', { command: 'a', run_in_background: true }),
      result(0, 'toolu_e', launched('beee')),
      bashCall(1, 'toolu_f', { command: 'b', run_in_background: true }),
      result(1, 'toolu_f', launched('bfff')),
      notification(
        14,
        'beee',
        'toolu_e',
        'completed',
        'Background command "a" completed (exit code 0)'
      ),
      notification(
        3,
        'bfff',
        'toolu_f',
        'failed',
        'Background command "b" failed with exit code 1'
      ),
    ]);
    expect(ok).toMatchObject({ state: 'done', exitCode: 0, endedAt: T0 + 14 * 60_000 });
    expect(bad).toMatchObject({ state: 'failed', exitCode: 1 });
  });

  it('reads the exit code the harness appended, not one the description mentions', () => {
    const [ok, bad] = shellsOf([
      bashCall(0, 'toolu_i', { command: 'a', run_in_background: true }),
      result(0, 'toolu_i', launched('biii')),
      bashCall(1, 'toolu_j', { command: 'b', run_in_background: true }),
      result(1, 'toolu_j', launched('bjjj')),
      notification(
        5,
        'biii',
        'toolu_i',
        'completed',
        'Background command "Retry until exit code 1 stops" completed (exit code 0)'
      ),
      notification(
        6,
        'bjjj',
        'toolu_j',
        'failed',
        'Background command "Check the exit code 0 path" failed with exit code 2'
      ),
    ]);
    expect(ok).toMatchObject({ state: 'done', exitCode: 0 });
    expect(bad).toMatchObject({ state: 'failed', exitCode: 2 });
  });

  it('reads a non-zero exit under a "completed" status as a failure', () => {
    const [shell] = shellsOf([
      bashCall(0, 'toolu_g', { command: 'a', run_in_background: true }),
      result(0, 'toolu_g', launched('bggg')),
      notification(
        1,
        'bggg',
        'toolu_g',
        'completed',
        'Background command "a" completed (exit code -1)'
      ),
    ]);
    expect(shell).toMatchObject({ state: 'failed', exitCode: -1 });
  });

  it('reads stopped and killed as stopped, not as a failure', () => {
    const shells = shellsOf([
      bashCall(0, 'toolu_h', { command: 'a', run_in_background: true }),
      result(0, 'toolu_h', launched('bhhh')),
      bashCall(0, 'toolu_i', { command: 'b', run_in_background: true }),
      result(0, 'toolu_i', launched('biii')),
      notification(1, 'bhhh', 'toolu_h', 'stopped', 'Background command "a" was stopped'),
      notification(1, 'biii', 'toolu_i', 'killed', 'Background command "b" was killed'),
    ]);
    expect(shells.map(s => s.state)).toEqual(['stopped', 'stopped']);
  });

  it('ends a shell on a successful TaskStop, which writes no notification', () => {
    const [shell] = shellsOf([
      bashCall(0, 'toolu_j', { command: 'npm run dev', run_in_background: true }),
      result(0, 'toolu_j', launched('bjjj')),
      ...taskStop(9, 'toolu_stop', 'bjjj'),
    ]);
    expect(shell).toMatchObject({
      state: 'stopped',
      stoppedByClaude: true,
      endedAt: T0 + 9 * 60_000,
    });
  });

  it('leaves a shell running when the TaskStop failed or named another task', () => {
    const shells = shellsOf([
      bashCall(0, 'toolu_k', { command: 'a', run_in_background: true }),
      result(0, 'toolu_k', launched('bkkk')),
      ...taskStop(1, 'toolu_s1', 'bkkk', true),
      ...taskStop(2, 'toolu_s2', 'bother'),
    ]);
    expect(shells[0].state).toBe('running');
  });
});

describe('visibleShells', () => {
  const now = T0 + 60 * 60_000;
  const base = {
    toolUseId: 'x',
    taskId: 'x',
    title: 't',
    command: 'c',
    startedAt: T0,
    via: 'requested' as const,
  };

  it('shows nothing when no CLI process runs the session', () => {
    const shells = [
      { ...base, state: 'running' as const },
      { ...base, toolUseId: 'y', state: 'done' as const, endedAt: now - 60_000 },
    ];
    expect(visibleShells(shells, null, now)).toEqual({ running: [], ended: [] });
  });

  it('counts only the shells the live process started, not a resumed session’s old ones', () => {
    // The session was resumed at +30: the shell from +0 belonged to the process
    // that exited, and has no ending on disk because nothing recorded one.
    const shells = [
      { ...base, toolUseId: 'old', state: 'running' as const, startedAt: T0 },
      { ...base, toolUseId: 'new', state: 'running' as const, startedAt: T0 + 40 * 60_000 },
    ];
    const { running } = visibleShells(shells, T0 + 30 * 60_000, now);
    expect(running.map(s => s.toolUseId)).toEqual(['new']);
  });

  it('keeps an ended shell for the recent window, newest first', () => {
    const shells = [
      { ...base, toolUseId: 'old', state: 'done' as const, endedAt: now - RECENT_WINDOW_MS - 1 },
      { ...base, toolUseId: 'a', state: 'done' as const, endedAt: now - 5 * 60_000 },
      { ...base, toolUseId: 'b', state: 'failed' as const, endedAt: now - 60_000 },
    ];
    expect(visibleShells(shells, T0, now).ended.map(s => s.toolUseId)).toEqual(['b', 'a']);
  });
});

describe('spanLabel', () => {
  it('says minutes and hours in words', () => {
    expect(spanLabel(20_000)).toBe('under a minute');
    expect(spanLabel(12 * 60_000 + 59_000)).toBe('12 min');
    expect(spanLabel(60 * 60_000)).toBe('1 h');
    expect(spanLabel(65 * 60_000)).toBe('1 h 5 min');
    expect(spanLabel(-5_000)).toBe('under a minute');
  });
});
