/** What a Notes AI run adds to the sheet, and the line that says what it cost. Pure. */
import {
  modelLabel,
  type InsightKind,
  type InsightResult,
} from '../../../../electron/shared/ai-settings';
import { newBlock, parseNotes, type NoteBlock } from './session-notes';

const LABEL: Record<InsightKind, string> = { summary: 'Summary', todos: 'To-dos' };

export function insightTitle(kind: InsightKind, at: Date): string {
  const day = at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  // ICU 72+ (Node 20+, recent Chromium) puts a narrow no-break space before AM/PM.
  const time = at
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    .replace(/\u202f/g, ' ');
  return `${LABEL[kind]} · ${day}, ${time}`;
}

export function appendInsight(
  blocks: NoteBlock[],
  kind: InsightKind,
  lines: string[],
  at: Date
): NoteBlock[] {
  const kept = blocks.slice();
  while (kept.length > 0 && !kept[kept.length - 1].text.trim()) kept.pop();
  return [...kept, newBlock('text', insightTitle(kind, at)), ...parseNotes(lines.join('\n'))];
}

function tokens(n: number): string {
  return n >= 10_000 ? `${Math.round(n / 1000)}K` : `${(n / 1000).toFixed(1)}K`;
}

function dollars(n: number): string {
  return n < 0.01 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`;
}

export function insightMeta(r: InsightResult): string {
  const parts = [
    modelLabel(r.model),
    `${tokens(r.inputTokens)} in`,
    `${tokens(r.outputTokens)} out`,
    // On a subscription the run uses quota, not dollars.
    `${dollars(r.costUsd)} at API rates`,
  ];
  if (r.truncated) parts.push('from the latest part of the session');
  return parts.join(' · ');
}
