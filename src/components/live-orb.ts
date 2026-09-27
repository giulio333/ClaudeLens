import type { OrbState } from 'thinking-orbs';
import type { SessionActivity } from '../types';

const SEARCHING = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebSearch', 'WebFetch', 'ToolSearch']);
const COMPOSING = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
/** Waiting on another party's answer: a sub-agent, another session, the user. */
const LISTENING = new Set(['Agent', 'Task', 'SendMessage', 'AskUserQuestion']);

/** The thinking orb's animation for what a session is doing: `breathing`
 *  while the model thinks with nothing to show yet, then one verb per family
 *  of tool. Anything unlisted — Bash, an MCP tool, a tool added next month —
 *  is `working`, which claims no more than that something runs.
 *
 *  Only states that still read at the 20px preset: `connecting` — the obvious
 *  verb for an agent — draws eight or nine loose dots and no line there, and
 *  `weaving` hardly more, so both looked like noise in Mission Control. */
export function liveOrbState(toolName: string | null | undefined): OrbState {
  if (!toolName) return 'breathing';
  if (SEARCHING.has(toolName)) return 'searching';
  if (COMPOSING.has(toolName)) return 'composing';
  if (LISTENING.has(toolName)) return 'listening';
  return 'working';
}

/** The tool a live session has in flight, from its tail digest: its own call
 *  first, else a sub-agent it is waiting on — the work the tail cannot see,
 *  since it runs in a sidecar transcript. Null between calls, which is the
 *  model thinking: the digest drops `lastTool` on every result and text. */
export function inFlightTool(
  activity: Pick<SessionActivity, 'lastTool' | 'delegates'> | undefined
): string | null {
  if (activity?.lastTool) return activity.lastTool.name;
  return activity?.delegates.length ? 'Agent' : null;
}

/** The colour each surface already gives "working": the accent in the chat,
 *  violet in Mission Control (where the accent means "waiting for you"), sage
 *  in the Monitor (its WORKING tag). */
export type OrbTone = 'accent' | 'violet' | 'ok';

/** The orb takes only hex or `rgb()` — an `oklch()` token or a `var()` is
 *  dropped without a word and the dots go grey — so each token is repeated
 *  here in the hex it renders to, once per theme (`src/index.css`). */
export const ORB_INK: Record<OrbTone, { light: string; dark: string }> = {
  // --cl-accent: oklch(0.575 0.135 40) / oklch(0.72 0.14 40)
  accent: { light: '#B95835', dark: '#ED835E' },
  // --cl-violet: oklch(0.58 0.2 305) / oklch(0.7 0.18 305)
  violet: { light: '#9751D7', dark: '#B97DF7' },
  // --cl-ok: oklch(0.62 0.1 145) / oklch(0.72 0.1 145)
  ok: { light: '#5E9660', dark: '#7CB57D' },
};
