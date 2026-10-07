// What a tab says about its session beyond its state: the line that slides in
// beside the title when the pointer is on it, and how full the context window
// is, which the tab wears as a fill. Only what the registry and the transcript
// tail already say.

import type { ActiveSession, SessionActivity } from '../../../types';
import { spanLabel } from './background-shells';
import { asksQuestion, type ChipTone } from './terminal-instances';

/** From here the fill turns to the accent: a session this full is close to
 *  compacting, and that is worth seeing from the next tab. */
export const CONTEXT_HIGH = 0.8;

/** The subject of a call in a word: a command is the program its last
 *  statement runs (past `cd … &&` and `VAR=…`), a path its file name. The whole
 *  command does not fit a tab or a card, and half of one is noise. */
export function shortArg(tool: { name: string; arg: string }): string {
  const arg = tool.arg.trim();
  if (tool.name === 'Bash') {
    const last = arg.split(/&&|\|\||;/).pop() ?? '';
    return (
      last
        .trim()
        .split(/\s+/)
        .find(w => !w.includes('=')) ?? ''
    );
  }
  if (/[\\/]/.test(arg) && !/\s/.test(arg)) return arg.split(/[\\/]/).filter(Boolean).pop() ?? arg;
  return arg;
}

/** The line a tab shows on hover: what a working session is doing, what a
 *  waiting one waits on, how long an idle one has been idle. */
export function liveLine(
  tone: ChipTone,
  entry: ActiveSession | undefined,
  activity: SessionActivity | undefined,
  now: number
): string {
  switch (tone) {
    case 'busy': {
      const tool = activity?.lastTool;
      if (tool) {
        const subject = shortArg(tool);
        return subject ? `${tool.name} · ${subject}` : tool.name;
      }
      // A delegating session writes nothing of its own while its agent works.
      const agent = activity?.delegates[activity.delegates.length - 1];
      return agent ? `Agent · ${agent.name}` : 'Working';
    }
    case 'waiting':
      if (asksQuestion(entry?.waitingFor)) return 'Asks you a question';
      return entry?.waitingFor || 'Waiting for you';
    case 'idle': {
      const since = entry?.statusUpdatedAt;
      return since ? `Idle · ${spanLabel(now - since)}` : 'Your turn';
    }
    case 'lens':
      return 'Lens only';
    case 'ended':
      return 'Ended';
    case 'starting':
      return 'Starting';
  }
}

/** The share of the context window in use, from the newest turn the tail read;
 *  null until there is one — unknown is not empty. */
export function contextShare(activity: SessionActivity | undefined): number | null {
  const ctx = activity?.context;
  if (!ctx || ctx.max <= 0) return null;
  return Math.min(1, ctx.used / ctx.max);
}

// The calls that write a file. A shell command that edits one is no `Edit` and
// leaves no mark that says so: it goes unflashed rather than guessed.
const WRITE_TOOLS: ReadonlySet<string> = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

/** The newest call in the tail that wrote a file: `key` tells one write from
 *  the next (the call's id, else its time), `name` is the file's. Only a call
 *  whose result came back, and not as an error: an `Edit` still waiting on the
 *  user's approval has written nothing, and a denied one never will. */
export function newestWrite(
  activity: SessionActivity | undefined
): { key: string; name: string } | null {
  const recent = activity?.recent ?? [];
  for (let i = recent.length - 1; i >= 0; i--) {
    const mark = recent[i];
    if (mark.kind !== 'tool' || !mark.tool || !WRITE_TOOLS.has(mark.tool)) continue;
    if (!mark.done || mark.failed) continue;
    return {
      key: mark.id ?? String(mark.at),
      name: shortArg({ name: mark.tool, arg: mark.arg ?? '' }),
    };
  }
  return null;
}
