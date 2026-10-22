// The session as the model reads it: the conversation whole, every tool call as
// one line, tool output cut short. Built on the same parse as the Lens
// (parseChatSessionText + transcript extras), so the model and the reader agree
// on what a message is. Pure.
import type { ChatContentBlock, ChatMessage } from '../shared/chat-types';
import { parseChatSessionText } from './session-reader';
import { mergeTranscriptExtras, parseTranscriptExtras } from './transcript-extras';

export const MAX_DIGEST_TOKENS = 800_000;
export const RESULT_CHARS = 2000;
export const TARGET_CHARS = 120;
export const OMITTED_LINE = '[Earlier part of the session omitted]';
export const COMPACTED_LINE = '[conversation compacted here]';
// Pessimistic on purpose: code, Italian and CJK run denser than 4.
const CHARS_PER_TOKEN = 3;
const TARGET_KEYS = ['description', 'file_path', 'path', 'pattern', 'command'] as const;

export interface SessionDigest {
  text: string;
  estimatedTokens: number;
  truncated: boolean;
  /** Turns that made it in; 0 means there is nothing to read. */
  turns: number;
}

function toolTarget(input: Record<string, unknown>): string {
  for (const key of TARGET_KEYS) {
    const v = input[key];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, TARGET_CHARS);
  }
  return '';
}

function blockLine(block: ChatContentBlock): string | null {
  switch (block.type) {
    case 'text':
      return block.text.trim() || null;
    case 'tool_use': {
      const target = toolTarget(block.input);
      return target ? `[Tool: ${block.name} — ${target}]` : `[Tool: ${block.name}]`;
    }
    case 'tool_result': {
      const body = block.content.trim();
      if (!body) return null;
      const cut = body.length > RESULT_CHARS ? `${body.slice(0, RESULT_CHARS)}… [truncated]` : body;
      return `[Result${block.isError ? ' (error)' : ''}]\n${cut}`;
    }
    case 'image':
      return '[image]';
    default:
      return null; // thinking and advisor consults stay out
  }
}

function speaker(m: ChatMessage): string {
  if (m.role === 'assistant') return 'Claude';
  if (m.inbound)
    return m.inbound.from === 'agent' ? 'Message from an agent' : 'Message from another session';
  if (m.content.length > 0 && m.content.every(b => b.type === 'tool_result')) return 'Tool output';
  return 'User';
}

function turnText(m: ChatMessage): string | null {
  if (m.notice?.kind === 'compaction') return COMPACTED_LINE;
  if (m.notice) return `### Notice\n${m.notice.text}`;
  const lines = m.content.map(blockLine).filter((l): l is string => l !== null);
  if (lines.length === 0) return null;
  return `### ${speaker(m)}\n${lines.join('\n')}`;
}

export function buildSessionDigest(
  messages: ChatMessage[],
  maxTokens = MAX_DIGEST_TOKENS
): SessionDigest {
  const turns = messages.map(turnText).filter((t): t is string => t !== null);
  const budget = maxTokens * CHARS_PER_TOKEN;
  let start = 0;
  let size = turns.reduce((sum, t) => sum + t.length + 2, 0);
  while (start < turns.length - 1 && size > budget) {
    size -= turns[start].length + 2;
    start += 1;
  }
  const kept = turns.slice(start);
  const last = kept.length - 1;
  // A single turn larger than the cap keeps its end, where it concluded.
  if (last >= 0 && kept[last].length > budget) kept[last] = kept[last].slice(-budget);
  const truncated = start > 0 || (last >= 0 && kept[last] !== turns[turns.length - 1]);
  const text = (truncated ? [OMITTED_LINE, ...kept] : kept).join('\n\n');
  return {
    text,
    estimatedTokens: Math.ceil(text.length / CHARS_PER_TOKEN),
    truncated,
    turns: kept.length,
  };
}

export function digestTranscriptText(raw: string, maxTokens = MAX_DIGEST_TOKENS): SessionDigest {
  const messages = mergeTranscriptExtras(parseChatSessionText(raw), parseTranscriptExtras(raw));
  return buildSessionDigest(messages, maxTokens);
}
