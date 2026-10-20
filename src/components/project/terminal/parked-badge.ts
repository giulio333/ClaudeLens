// What the background badge says in words, beside its count: the one session
// that needs the user, by name. A wait comes first, then a turn that ended out
// of sight; a session that is only working gets the orb and no words, because
// working is not a reason to look.

import { mostUrgentTone, type ChipTone } from './terminal-instances';

export interface BadgeRow {
  title: string;
  tone: ChipTone;
  /** Claude asks a question (`asksQuestion`), not just any wait. */
  question: boolean;
  /** Its turn ended while it was off screen, and it has not been seen since. */
  unseen: boolean;
}

export interface BadgeLine {
  /** The state the badge wears: the named session's, else the most urgent. */
  tone: ChipTone;
  /** The session that needs the user and what it is at, apart: a long title
   *  is cut short in the bar, the verb never. Null when none needs the user. */
  name: string | null;
  verb: string | null;
  question: boolean;
  unseen: boolean;
}

export function badgeLine(rows: readonly BadgeRow[]): BadgeLine {
  const waiting = rows.find(r => r.tone === 'waiting');
  if (waiting) {
    return {
      tone: 'waiting',
      name: waiting.title,
      verb: waiting.question ? 'asks you' : 'waits for you',
      question: waiting.question,
      unseen: false,
    };
  }
  const unseen = rows.find(r => r.unseen);
  if (unseen) {
    return {
      tone: unseen.tone,
      name: unseen.title,
      verb: 'finished',
      question: false,
      unseen: true,
    };
  }
  return {
    tone: mostUrgentTone(rows.map(r => r.tone)),
    name: null,
    verb: null,
    question: false,
    unseen: false,
  };
}
