// The state of the sessions open in ClaudeLens, as the renderer hands it to the
// main process for the menu bar and the Dock (`notifications:setStatus`). The one
// definition shared by both sides; main checks it on arrival
// (`parseStatusSummary` in `modules/status-surface.ts`).

/** A tab's state: the renderer's `ChipTone`, value for value. */
export const STATUS_TONES = ['starting', 'busy', 'waiting', 'idle', 'lens', 'ended'] as const;
export type StatusTone = (typeof STATUS_TONES)[number];

export interface StatusRow {
  /** The renderer's instance id: a menu bar row hands it back to bring the tab
   *  on screen. */
  id: string;
  title: string;
  project: string;
  tone: StatusTone;
  /** Claude asks the user a question, not just any wait. */
  question: boolean;
  /** Its turn ended while it was off screen, and it has not been seen since. */
  unseen: boolean;
}

export interface StatusSummary {
  rows: StatusRow[];
}
