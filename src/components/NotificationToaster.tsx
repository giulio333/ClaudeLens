import { useEffect, useState, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { NotificationEvent, NotificationKind } from '../types';
import { trackEvent } from '../lib/telemetry';
import { projectDisplayName } from './project/shared/projectName';

// Transient in-app toasts for session-lifecycle notifications pushed from the
// main process over `notifications:event` (see electron/modules/notifications/).
// Passive + suggested only: a toast shows what happened and, when it carries a
// session, offers an "Open session" button — it never navigates on its own.
//
// Mounted inside ProjectOverview (not App) so `onOpenSession` has access to the
// navigation state. Keeps its own small queue; auto-dismisses after a while.
//
// Each toast is rendered as one Mission Control feed row (time gutter · state
// dot · subject · status tag): a notification is a session event, and that is
// the language this app already uses for events.

const AUTO_DISMISS_MS = 9000;
const MAX_VISIBLE = 4;

/** The right-hand status tag — the state, in the feed's vocabulary. */
const STATE_TAG: Record<NotificationKind, string> = {
  'needs-attention': 'WAITING',
  completed: 'FINISHED',
  error: 'ERROR',
};

/** Fallback for the meta line when the event carries no body of its own. The
 *  event's `title` is a full sentence written for the OS notification; here the
 *  layout wants a fragment, with that sentence kept as the row's tooltip. */
const FALLBACK_META: Record<NotificationKind, string> = {
  'needs-attention': 'waiting for you',
  completed: 'your turn',
  error: 'turn failed',
};

export interface NotificationToasterProps {
  /** Navigate to the session a notification is about. Omitted button when absent. */
  onOpenSession: (cwd: string, sessionId: string) => void;
}

export function NotificationToaster({ onOpenSession }: NotificationToasterProps) {
  const [toasts, setToasts] = useState<NotificationEvent[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => {
      const next = prev.filter(t => t.id !== id);
      if (next.length === 0) window.electronAPI.notifications.clearBadge().catch(() => {});
      return next;
    });
  }, []);

  useEffect(() => {
    return window.electronAPI.notifications.onEvent(event => {
      trackEvent('notification_fired', { kind: event.kind, source: event.source });
      setToasts(prev => {
        if (prev.some(t => t.id === event.id)) return prev; // dedup
        // Newest first; cap the stack so a burst can't fill the screen.
        return [event, ...prev].slice(0, MAX_VISIBLE);
      });
    });
  }, []);

  const act = useCallback(
    (t: NotificationEvent) => {
      trackEvent('notification_acted', { kind: t.kind });
      onOpenSession(t.cwd, t.sessionId);
      dismiss(t.id);
    },
    [onOpenSession, dismiss]
  );

  if (toasts.length === 0) return null;

  return (
    <div className="cl-toaster" role="region" aria-label="Notifications">
      <AnimatePresence initial={false}>
        {toasts.map(t => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, x: 24, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, scale: 0.98 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
          >
            <NotificationRow event={t} onOpen={() => act(t)} onDismiss={dismiss} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** One feed row. Owns its own dismiss timer so a re-render of the list — or a
 *  sibling arriving — never resets it, and so hovering pauses this row alone. */
function NotificationRow({
  event,
  onOpen,
  onDismiss,
}: {
  event: NotificationEvent;
  onOpen: () => void;
  /** Takes the id (rather than being pre-bound) so it stays referentially
   *  stable: it is a dependency of the dismiss timer, and a fresh closure per
   *  parent render would restart the clock on every re-render. */
  onDismiss: (id: string) => void;
}) {
  const [paused, setPaused] = useState(false);
  // Time left on this row's clock. Kept in a ref so pausing doesn't restart it.
  const remainingRef = useRef(AUTO_DISMISS_MS);
  const id = event.id;

  useEffect(() => {
    if (paused) return;
    const startedAt = Date.now();
    const timer = setTimeout(() => onDismiss(id), remainingRef.current);
    return () => {
      clearTimeout(timer);
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAt));
    };
  }, [paused, id, onDismiss]);

  const project = projectDisplayName(event.cwd);
  const detail = event.body?.trim() || FALLBACK_META[event.kind];
  const shortId = event.sessionId ? event.sessionId.slice(0, 8) : '';

  return (
    <div
      className={`cl-ntf cl-ntf--${event.kind}${paused ? ' is-paused' : ''}`}
      // The full sentence the OS notification shows, kept reachable here.
      title={event.title}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="cl-ntf-when">now</span>
      <span className="cl-ntf-dot" aria-hidden="true" />
      <span className="cl-ntf-subject">
        <span className="cl-ntf-name">{project || event.title}</span>
        <span className="cl-ntf-meta">
          {detail}
          {shortId && ` · ${shortId}`}
        </span>
      </span>
      <span className="cl-ntf-state">{STATE_TAG[event.kind]}</span>

      {event.sessionId && (
        <div className="cl-ntf-foot">
          <button type="button" className="cl-ntf-open" onClick={onOpen}>
            Open session →
          </button>
        </div>
      )}

      <button
        type="button"
        className="cl-ntf-close"
        aria-label="Dismiss"
        onClick={() => onDismiss(id)}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>

      <span
        className="cl-ntf-timer"
        aria-hidden="true"
        style={{ animationDuration: `${AUTO_DISMISS_MS}ms` }}
      />
    </div>
  );
}
