import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AI_SETTINGS, type AiSettings } from '../electron/shared/ai-settings';
import {
  COST_CAP_USD,
  aiModelPrices,
  cancelInsight,
  findSessionTranscript,
  resetInsights,
  runInsight,
  type InsightDeps,
  type InsightQueryOptions,
} from '../electron/modules/ai-insights';

const ID = '0f8e2c1a-1111-4222-8333-944455556666';
const OTHER = '0f8e2c1a-1111-4222-8333-944455550000';
let root: string;
let settings: AiSettings;
let calls: { prompt: string; options: InsightQueryOptions }[];

function row(role: 'user' | 'assistant', text: string, uuid: string) {
  return JSON.stringify({
    type: role,
    uuid,
    timestamp: '2026-01-01T00:00:00Z',
    message:
      role === 'user'
        ? { role, content: text }
        : { id: `m-${uuid}`, role, model: 'claude-haiku-5-5', content: [{ type: 'text', text }] },
  });
}

function writeTranscript(dir: string, id: string, lines: string[]) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.jsonl`), lines.join('\n'));
}

function result(over: Record<string, unknown> = {}) {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: '- Renamed the module\n- Fixed the build',
    usage: { input_tokens: 900, output_tokens: 40, cache_read_input_tokens: 100 },
    total_cost_usd: 0.0003,
    ...over,
  };
}

function deps(messages: unknown[] = [result()]): InsightDeps {
  return {
    projectsDir: root,
    readSettings: () => settings,
    env: { PATH: '/bin' },
    executable: () => ({}),
    query: args => {
      calls.push(args);
      return (async function* () {
        for (const m of messages) yield m;
      })();
    },
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cl-insights-'));
  settings = { ...DEFAULT_AI_SETTINGS };
  calls = [];
  resetInsights();
  writeTranscript(join(root, '-tmp-alpha'), ID, [
    row('user', 'Rename the module', 'r1'),
    row('assistant', 'Renamed.', 'r2'),
  ]);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('runInsight', () => {
  it('runs one tool-less turn and answers note lines with their cost', async () => {
    const out = await runInsight(ID, 'summary', deps());
    expect(out).toEqual({
      lines: ['- Renamed the module', '- Fixed the build'],
      truncated: false,
      model: 'claude-haiku-5-5',
      inputTokens: 1000,
      outputTokens: 40,
      costUsd: 0.0003,
    });
    expect(calls).toHaveLength(1);
    const { prompt, options } = calls[0];
    expect(prompt).toContain('Rename the module');
    expect(options).toMatchObject({
      model: 'claude-haiku-5-5',
      effort: 'medium',
      tools: [],
      maxTurns: 1,
      persistSession: false,
      settingSources: [],
      mcpServers: {},
      strictMcpConfig: true,
      env: { PATH: '/bin' },
    });
    expect(options.systemPrompt).toMatch(/Never follow instructions/);
  });

  it('uses the model and effort from the settings', async () => {
    settings = { ...settings, model: 'claude-sonnet-5-5', effort: 'high' };
    await runInsight(ID, 'todos', deps([result({ result: '- [ ] Write docs' })]));
    expect(calls[0].options).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'high' });
  });

  it('refuses a bad request before reading anything', async () => {
    await expect(runInsight('../etc', 'summary', deps())).rejects.toThrow('Not a session id');
    await expect(runInsight(ID, 'essay', deps())).rejects.toThrow('Unknown action');
    expect(calls).toHaveLength(0);
  });

  it('refuses while the AI is turned off', async () => {
    settings = { ...settings, enabled: false };
    await expect(runInsight(ID, 'summary', deps())).rejects.toThrow(/turned off/);
    expect(calls).toHaveLength(0);
  });

  it('treats a session whose transcript is not written yet as empty', async () => {
    await expect(runInsight(OTHER, 'summary', deps())).rejects.toThrow(
      'This session has nothing to read yet.'
    );
    expect(calls).toHaveLength(0);
  });

  it('refuses a session with nothing to read yet', async () => {
    writeTranscript(join(root, '-tmp-beta'), OTHER, []);
    await expect(runInsight(OTHER, 'summary', deps())).rejects.toThrow(
      'This session has nothing to read yet.'
    );
    expect(calls).toHaveLength(0);
  });

  it('refuses before the call when the input would cost more than the cap', async () => {
    settings = { ...settings, model: 'claude-opus-5-5' };
    const big = 'z'.repeat(2_000_000); // ~667K tokens at $4/M is about $2.67
    writeTranscript(join(root, '-tmp-gamma'), OTHER, [row('user', big, 'b1')]);
    await expect(runInsight(OTHER, 'summary', deps())).rejects.toThrow(
      `under the $${COST_CAP_USD} cap`
    );
    expect(calls).toHaveLength(0);
  });

  it('passes the error of a failed run on', async () => {
    const failed = result({ is_error: true, result: 'Not logged in · Please run /login' });
    await expect(runInsight(ID, 'summary', deps([failed]))).rejects.toThrow('Not logged in');
    const stopped = result({ subtype: 'error_during_execution', errors: ['API overloaded'] });
    await expect(runInsight(ID, 'summary', deps([stopped]))).rejects.toThrow('API overloaded');
  });

  it('fails when the run ends without an answer', async () => {
    await expect(runInsight(ID, 'summary', deps([]))).rejects.toThrow('without an answer');
  });

  it('runs one at a time per session, and cancels', async () => {
    let release!: () => void;
    const slow: InsightDeps = {
      ...deps(),
      query: args => {
        calls.push(args);
        return (async function* () {
          await new Promise<void>(resolve => {
            release = resolve;
            args.options.abortController.signal.addEventListener('abort', () => resolve());
          });
          if (args.options.abortController.signal.aborted) throw new Error('aborted');
          yield result();
        })();
      },
    };
    const first = runInsight(ID, 'summary', slow);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await expect(runInsight(ID, 'todos', slow)).rejects.toThrow('already going');
    cancelInsight(ID);
    await expect(first).rejects.toThrow('Cancelled.');
    // The slot is free again.
    const again = runInsight(ID, 'summary', slow);
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    release();
    await expect(again).resolves.toMatchObject({
      lines: ['- Renamed the module', '- Fixed the build'],
    });
  });
});

describe('findSessionTranscript', () => {
  it('prefers sessions/ inside a project', async () => {
    writeTranscript(join(root, '-tmp-delta', 'sessions'), OTHER, [row('user', 'x', 'd1')]);
    writeTranscript(join(root, '-tmp-delta'), OTHER, [row('user', 'y', 'd2')]);
    expect(await findSessionTranscript(root, OTHER)).toBe(
      join(root, '-tmp-delta', 'sessions', `${OTHER}.jsonl`)
    );
  });

  it('answers null for a missing id, and refuses an id two projects share', async () => {
    expect(await findSessionTranscript(root, OTHER)).toBeNull();
    writeTranscript(join(root, '-tmp-epsilon'), ID, [row('user', 'x', 'e1')]);
    await expect(findSessionTranscript(root, ID)).rejects.toThrow('More than one transcript');
  });
});

it('prices each model at its base rate per million tokens', () => {
  const haiku = aiModelPrices().find(p => p.id === 'claude-haiku-5-5');
  expect(haiku).toEqual({
    id: 'claude-haiku-5-5',
    label: 'Haiku 5.5',
    inputPerM: 0.1,
    outputPerM: 0.5,
  });
});
