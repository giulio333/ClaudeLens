// "What's new" popup content, one entry per app release that has something to
// show — authored by hand, checked in CLAUDE.md's Release section as a step
// before tagging. Not every version needs an entry: prepare-release.js only
// warns (never blocks) when the bumped version has none.
//
// `visual` is a key into WHATS_NEW_VISUALS (WhatsNewDialog.tsx), never a
// screenshot: a static image goes stale the next time that surface's CSS
// changes, while a key into real ClaudeLens components cannot.
import { compareVersions } from '../../electron/shared/version-compare';

export interface WhatsNewHighlight {
  title: string;
  description: string;
  /** Where the feature lives in the app. A popup that shows a new surface
   *  without saying where it is leaves the reader to go looking for it. */
  where?: string;
  visual?:
    | 'cross-session-message'
    | 'prompt-playbook'
    | 'artifact'
    | 'chat-image'
    | 'file-changes'
    | 'session-color'
    | 'context-rail'
    | 'thinking-note'
    | 'model-picker'
    | 'remote'
    | 'background-shells'
    | 'live-orb'
    | 'plan'
    | 'parked-terminals'
    | 'session-tabs'
    | 'project-files'
    | 'web-sources'
    | 'tab-live'
    | 'tab-attention'
    | 'tab-overflow'
    | 'git-branch'
    | 'side-question';
}

export interface WhatsNewRelease {
  version: string;
  highlights: WhatsNewHighlight[];
}

export const WHATS_NEW: WhatsNewRelease[] = [
  {
    version: '2.2.35',
    highlights: [
      {
        title: 'Tabs that show the work',
        description:
          'Each tab wears its session’s state at rest — the orb while Claude works, circled by its sub-agents, and a fill for how much of the context window is in use, in the accent past 80% — and under the pointer the title gives way to what it is doing: the tool and its file, what it waits on, how long it has been idle.',
        where: 'The tab bar of Mission Control; hover a tab',
        visual: 'tab-live',
      },
      {
        title: 'Nothing finishes behind your back',
        description:
          'A turn that ended while its tab was out of sight rings the dot until you look, a question wears a ?, one left unanswered for two minutes tints its tab, and an ended session greys out.',
        where: 'The tab bar, the background badge and its list',
        visual: 'tab-attention',
      },
      {
        title: 'Tabs grouped by project',
        description:
          'Tabs sit together under their project’s name, and when there are more than fit they scroll, with a mark on the edge past which a session is waiting for you.',
        where: 'The tab bar of Mission Control; click the edge mark',
        visual: 'tab-overflow',
      },
      {
        title: 'The branch a session is on',
        description:
          'The branch each turn ran on is read from the transcript: Mission Control names it, with the worktree and the branches before it on hover, and the Lens marks every change of branch.',
        where: 'The strip at the foot of Mission Control’s rail; the tab’s card; the Lens',
        visual: 'git-branch',
      },
      {
        title: 'Side questions with /btw',
        description:
          'Type /btw and a question in the chat to have it answered from the session’s context, even mid-turn, without adding it to the conversation.',
        where: 'The chat composer',
        visual: 'side-question',
      },
    ],
  },
  {
    version: '2.2.34',
    highlights: [
      {
        title: 'Your project’s files',
        description:
          'Browse the project’s files and open one to read it, with the files a session read, edited or created marked in Mission Control.',
        where: 'Files in the project rail; the folder button in Mission Control’s rail',
        visual: 'project-files',
      },
      {
        title: 'Where a turn looked',
        description:
          'The pages a turn fetched and the searches it ran are listed at its foot, each saying whether it came back.',
        where: 'Any session transcript, in MIN',
        visual: 'web-sources',
      },
    ],
  },
  {
    version: '2.2.33',
    highlights: [
      {
        title: 'Sessions as tabs',
        description:
          'Every open session is a tab across the top of Mission Control: a click switches to it, + starts another, and each tab says whether Claude is working or waiting for you.',
        where: 'The top bar of Mission Control; the back arrow leaves and keeps them running',
        visual: 'session-tabs',
      },
    ],
  },
  {
    version: '2.2.32',
    highlights: [
      {
        title: 'Sessions in the background',
        description:
          'Send a terminal session to the background and it keeps running while you work elsewhere, behind a badge that says which one needs you.',
        where:
          'Mission Control’s back arrow keeps a session running; the badge in the app’s top bar brings it back',
        visual: 'parked-terminals',
      },
    ],
  },
  {
    version: '2.2.31',
    highlights: [
      {
        title: 'What became of a plan',
        description:
          'A plan card now says whether you approved or rejected it, and opens the plan as the document it is.',
        where: 'Any session transcript',
        visual: 'plan',
      },
      {
        title: 'Plugins synced from claude.ai',
        description:
          'The plugins claude.ai syncs to your account are listed beside the installed ones, and a plugin turned off is marked off.',
        where: 'Global · Plugins',
      },
    ],
  },
  {
    version: '2.2.30',
    highlights: [
      {
        title: 'See Claude at work',
        description:
          'While Claude works, a small orb moves the way the tool it is running does — searching, writing or waiting on an agent.',
        where: 'The live chat, the terminal pane’s top bar, Mission Control and the Monitor',
        visual: 'live-orb',
      },
    ],
  },
  {
    version: '2.2.29',
    highlights: [
      {
        title: 'Background shells, in view',
        description:
          'When Claude leaves a command running, a pill says how many and for how long — click it for how each one ended.',
        where: 'The terminal pane’s top bar, beside RUNNING',
        visual: 'background-shells',
      },
    ],
  },
  {
    version: '2.2.28',
    highlights: [
      {
        title: 'Remote hosts, in beta',
        description:
          'Beta: run Claude Code on another machine over your own ssh, and follow the session in Lens and Mission Control.',
        where: 'Remote, in the top bar',
        visual: 'remote',
      },
    ],
  },
  {
    version: '2.2.27',
    highlights: [
      {
        title: 'Opus 5.5, priced right',
        description:
          "Opus 5.5 is billed at its own rate instead of Opus 5's, and the model picker says which version each alias runs on.",
        where: 'Every spend figure, and the SDK chat’s model picker',
        visual: 'model-picker',
      },
      {
        title: 'What the session read',
        description:
          'Every file Claude read sits on the left edge — hover for the names, then for the lines it saw.',
        where: 'The left edge of Lens',
        visual: 'context-rail',
      },
      {
        title: 'Thinking notes, inline',
        description:
          'The short updates Claude writes while it works, the ones the terminal prints, now show in MIN too.',
        where: 'Any session transcript',
        visual: 'thinking-note',
      },
    ],
  },
  {
    version: '2.2.26',
    highlights: [
      {
        title: 'Pictures, drawn',
        description:
          'A pasted screenshot, a Read of a .png, an image linked by path — shown, not dropped.',
        where: 'Any session transcript',
        visual: 'chat-image',
      },
      {
        title: 'What a turn changed',
        description:
          'Every edited file as its diff under the turn — Bash rewrites included — without leaving MIN.',
        where: 'The foot of a turn, in MIN density',
        visual: 'file-changes',
      },
      {
        title: 'Session colors in Lens',
        description:
          'The color a session wears in the terminal follows it: a dot on the crumb and a glow at the foot of the view.',
        where: 'The Terminal / Lens frame',
        visual: 'session-color',
      },
    ],
  },
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

/** Entries strictly newer than `since` and strictly older than `before`, newest
 *  first: the releases a reader skipped between the one they last dismissed and
 *  the one on screen. The popup only ever shows the installed version's entry,
 *  so without these a jump from 2.2.24 to 2.2.27 never shows 2.2.26's. */
export function releasesBetween(
  since: string,
  before: string,
  list: WhatsNewRelease[] = WHATS_NEW
): WhatsNewRelease[] {
  return list.filter(
    r => compareVersions(r.version, since) > 0 && compareVersions(r.version, before) < 0
  );
}

/** Every entry older than `version`, newest first. */
export function releasesBefore(
  version: string,
  list: WhatsNewRelease[] = WHATS_NEW
): WhatsNewRelease[] {
  return list.filter(r => compareVersions(r.version, version) < 0);
}

/** The newest entry no newer than the running app — what Settings reopens. On a
 *  fix-only release that is the last one that had something to show. */
export function latestWhatsNew(
  version: string,
  list: WhatsNewRelease[] = WHATS_NEW
): WhatsNewRelease | undefined {
  return list.find(r => compareVersions(r.version, version) <= 0);
}

const OPEN_EVENT = 'cl:whats-new-open';

/** Asks the mounted popup to open (Settings → General). An event rather than a
 *  prop: the popup is mounted in App and Settings deep in ProjectOverview, and
 *  nothing between the two has any business carrying it. */
export function openWhatsNew(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/** Subscribes to `openWhatsNew`; returns the unsubscribe. */
export function onOpenWhatsNew(handler: () => void): () => void {
  window.addEventListener(OPEN_EVENT, handler);
  return () => window.removeEventListener(OPEN_EVENT, handler);
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
