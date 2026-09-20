// "What's new" popup content, one entry per app release that has something to
// show — authored by hand, checked in CLAUDE.md's Release section as a step
// before tagging. Not every version needs an entry: prepare-release.js only
// warns (never blocks) when the bumped version has none.
//
// `visual` is a key into WHATS_NEW_VISUALS (WhatsNewDialog.tsx), never a
// screenshot: a static image goes stale the next time that surface's CSS
// changes, while a key into real ClaudeLens components cannot.
export interface WhatsNewHighlight {
  title: string;
  description: string;
  /** Where the feature lives in the app. A popup that shows a new surface
   *  without saying where it is leaves the reader to go looking for it. */
  where?: string;
  visual?: 'cross-session-message' | 'prompt-playbook' | 'artifact';
}

export interface WhatsNewRelease {
  version: string;
  highlights: WhatsNewHighlight[];
}

export const WHATS_NEW: WhatsNewRelease[] = [
  {
    version: '2.2.24',
    highlights: [
      {
        title: 'Prompt Playbook',
        description: 'Save a prompt once. Reuse it anywhere.',
        where: 'Mission Control rail, and the chat composer',
        visual: 'prompt-playbook',
      },
      {
        title: 'Both halves of a message',
        description: 'One line per message, on both sides of the wire.',
        where: 'Any session transcript',
        visual: 'cross-session-message',
      },
      {
        title: 'A published page, not a tool call',
        description: 'The page Claude published, with a link that works.',
        where: 'The transcript, where the tool ran',
        visual: 'artifact',
      },
    ],
  },
  {
    version: '2.2.23',
    highlights: [
      {
        title: 'Cross-session messages',
        description: 'See who sent it — another session, or an agent of this one.',
        visual: 'cross-session-message',
      },
    ],
  },
];

/** The entry for `version`, if one was authored. */
export function whatsNewFor(version: string): WhatsNewRelease | undefined {
  return WHATS_NEW.find(r => r.version === version);
}

/** Pure decision: show the dialog only when this version has content to show
 *  and the user has not already dismissed exactly this version. */
export function shouldShowWhatsNew(
  currentVersion: string,
  seenVersion: string | null,
  hasContent: boolean
): boolean {
  return hasContent && seenVersion !== currentVersion;
}
