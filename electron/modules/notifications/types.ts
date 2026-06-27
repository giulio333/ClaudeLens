// Shared types and preference keys for the notification system. A notification
// is a normalized lifecycle event about a Claude session (external CLI sessions
// from the live registry, or the in-app chat) that the renderer surfaces as a
// transient toast and the main process optionally mirrors as an OS notification
// + dock badge when the window is unfocused.
//
// Kinds:
//  - `needs-attention` — a session is blocked waiting on the user (e.g. a
//    permission prompt): the registry status flips into `waiting`.
//  - `completed` — a session finished its turn and is now idle waiting for your
//    next input ("the agent is done, your turn"): the busy -> idle transition.
//  - `error` — an in-app chat turn failed.
// Detecting a session that fully *exited* (disappeared from the registry) needs a
// grace-period timer and is deliberately left for a later cut.
// See electron/modules/notifications/registry-diff.ts for how registry
// transitions become events, and main.ts for the focus/preference gating.

export type NotificationKind = 'needs-attention' | 'completed' | 'error';

export interface NotificationEvent {
  /** Dedup key: the renderer drops a repeat with the same id. */
  id: string;
  kind: NotificationKind;
  /** The transcript id this is about; '' when unknown (no teleport possible). */
  sessionId: string;
  /** The session's working directory; drives the "Open session" navigation. */
  cwd: string;
  /** Short, already-English title (the UI is English-only). */
  title: string;
  /** Optional secondary line (e.g. what the session is waiting on, error text). */
  body?: string;
  /** Epoch ms — stamped by the caller, never inside a pure diff. */
  createdAt: number;
  source: 'registry' | 'chat';
}

// Preference keys (persisted in ~/.claudelens/preferences.json via prefs-store).
// All cl-* namespaced so the store accepts them.
export const NOTIFY_ENABLED_KEY = 'cl-notify-enabled';
export const NOTIFY_OS_KEY = 'cl-notify-os';

export interface NotificationPrefs {
  /** Master switch: when off, nothing is emitted (zero work, instant). */
  enabled: boolean;
  /** Mirror to a native OS notification + dock badge when the window is unfocused. */
  os: boolean;
}

export const DEFAULT_NOTIFY_PREFS: NotificationPrefs = {
  enabled: true,
  os: true,
};
