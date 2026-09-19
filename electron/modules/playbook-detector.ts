import { createHash } from 'crypto';
import type { ChatMessage } from '../shared/chat-types';
import { MAX_PROMPT_LENGTH, type PromptCandidate } from '../shared/playbook-types';
export { MAX_PROMPT_LENGTH } from '../shared/playbook-types';

export const MIN_PROMPT_LENGTH = 40;

/** Whitespace only: punctuation and letter case remain meaningful. */
export function normalizePrompt(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function promptFingerprint(text: string): string {
  return createHash('sha256').update(normalizePrompt(text)).digest('hex');
}

export function humanPromptText(message: ChatMessage): string | null {
  if (message.role !== 'user' || message.inbound || message.notice || message.skillPath) {
    return null;
  }
  if (message.content.some(block => block.type !== 'text')) return null;
  const text = message.content.map(block => (block.type === 'text' ? block.text : '')).join('\n');
  const normalized = normalizePrompt(text);
  if (normalized.length < MIN_PROMPT_LENGTH || text.length > MAX_PROMPT_LENGTH) return null;
  // These are Claude Code's control messages, not prompts the user authored.
  if (
    /^(?:\/\S+|!|Base directory for this skill:)/.test(normalized) ||
    /<(?:command-name|command-message|local-command|task-notification|teammate-message|system-reminder|session-notification|agent-notification|inbound-message|cross-session-message|agent-message)\b/.test(
      text
    )
  )
    return null;
  return text;
}

export interface PromptSession {
  sessionId: string;
  messages: ChatMessage[];
}

/** A session contributes at most once, even if resumed or provided twice. */
export function detectPromptCandidates(
  sessions: Iterable<PromptSession>,
  excluded: ReadonlySet<string> = new Set()
): PromptCandidate[] {
  const groups = new Map<string, { text: string; sessions: Set<string> }>();
  for (const session of sessions) {
    for (const message of session.messages) {
      const text = humanPromptText(message);
      if (text === null) continue;
      const id = promptFingerprint(text);
      if (excluded.has(id)) continue;
      const group = groups.get(id) ?? { text, sessions: new Set<string>() };
      group.sessions.add(session.sessionId);
      groups.set(id, group);
    }
  }
  return [...groups]
    .filter(([, value]) => value.sessions.size >= 3)
    .map(([id, value]) => ({ id, text: value.text, sessionCount: value.sessions.size }))
    .sort((a, b) => b.sessionCount - a.sessionCount || a.id.localeCompare(b.id));
}
