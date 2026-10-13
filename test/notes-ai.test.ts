import { describe, expect, it } from 'vitest';
import {
  appendInsight,
  insightMeta,
  insightTitle,
} from '../src/components/project/terminal/notes-ai';
import {
  newBlock,
  parseNotes,
  serializeNotes,
} from '../src/components/project/terminal/session-notes';

const AT = new Date(2026, 9, 13, 15, 40);

it('titles a run with its action and an en-US time', () => {
  expect(insightTitle('summary', AT)).toBe('Summary · Oct 13, 3:40 PM');
  expect(insightTitle('todos', AT)).toBe('To-dos · Oct 13, 3:40 PM');
});

describe('appendInsight', () => {
  it('fills an empty sheet instead of leaving a blank line on top', () => {
    const out = appendInsight([newBlock()], 'todos', ['- [ ] Write docs', '- [x] Fix build'], AT);
    expect(serializeNotes(out)).toBe(
      'To-dos · Oct 13, 3:40 PM\n- [ ] Write docs\n- [x] Fix build\n'
    );
  });

  it('goes after what is there, dropping trailing blank lines', () => {
    const out = appendInsight(parseNotes('mine\n\n'), 'summary', ['- One point'], AT);
    expect(serializeNotes(out)).toBe('mine\nSummary · Oct 13, 3:40 PM\n- One point\n');
  });
});

describe('insightMeta', () => {
  it('says the model, the tokens and the cost at API rates', () => {
    expect(
      insightMeta({
        lines: [],
        truncated: false,
        model: 'claude-haiku-5-5',
        inputTokens: 84_300,
        outputTokens: 612,
        costUsd: 0.0089,
      })
    ).toBe('Haiku 5.5 · 84K in · 0.6K out · $0.009 at API rates');
  });

  it('notes a digest that dropped the start of the session', () => {
    expect(
      insightMeta({
        lines: [],
        truncated: true,
        model: 'claude-sonnet-5-5',
        inputTokens: 5_200,
        outputTokens: 90,
        costUsd: 1.234,
      })
    ).toBe(
      'Sonnet 5.5 · 5.2K in · 0.1K out · $1.23 at API rates · from the latest part of the session'
    );
  });
});
