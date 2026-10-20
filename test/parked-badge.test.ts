// The background badge's words: the one session that needs the user, by name —
// a wait first, then a turn that ended out of sight — and none while sessions
// only work.
import { expect, it } from 'vitest';
import { badgeLine, type BadgeRow } from '../src/components/project/terminal/parked-badge';

const row = (title: string, patch: Partial<BadgeRow> = {}): BadgeRow => ({
  title,
  tone: 'idle',
  question: false,
  unseen: false,
  ...patch,
});

it('names a session that asks a question, and one that waits on anything else', () => {
  expect(badgeLine([row('Docs', { tone: 'waiting', question: true })])).toEqual({
    tone: 'waiting',
    name: 'Docs',
    verb: 'asks you',
    question: true,
    unseen: false,
  });
  expect(badgeLine([row('Docs', { tone: 'waiting' })]).verb).toBe('waits for you');
});

it('puts a wait before a turn that ended unseen, and the first wait before the others', () => {
  const line = badgeLine([
    row('Build', { unseen: true }),
    row('Docs', { tone: 'waiting' }),
    row('Tests', { tone: 'waiting', question: true }),
  ]);
  expect([line.name, line.verb]).toEqual(['Docs', 'waits for you']);
  expect(line.unseen).toBe(false);
});

it('names a turn that ended out of sight when nothing waits, ringed in its own tone', () => {
  const line = badgeLine([row('Build', { tone: 'busy' }), row('Docs', { unseen: true })]);
  expect(line).toEqual({
    tone: 'idle',
    name: 'Docs',
    verb: 'finished',
    question: false,
    unseen: true,
  });
});

it('says no name while sessions only work or are idle', () => {
  expect(badgeLine([row('Build', { tone: 'busy' }), row('Docs')])).toEqual({
    tone: 'busy',
    name: null,
    verb: null,
    question: false,
    unseen: false,
  });
  expect(badgeLine([row('Docs')]).tone).toBe('idle');
});
