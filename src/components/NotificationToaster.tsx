import { useEffect, useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { NotificationEvent } from '../types';
import { trackEvent } from '../lib/telemetry';

// Transient in-app toasts for session-lifecycle notifications pushed from the
// main process over `notifications:event` (see electron/modules/notifications/).
// Passive + suggested only: a toast shows what happened and, when it carries a
// session, offers an "Open session" button — it never navigates on its own.
//
// Mounted inside ProjectOverview (not App) so `onOpenSession` has access to the
// navigation state. Keeps its own small queue; auto-dismisses after a while.

const AUTO_DISMISS_MS = 9000;
const MAX_VISIBLE = 4;

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
            className={`cl-toast cl-toast--${t.kind}`}
          >
            <span className="cl-toast-stripe" aria-hidden="true" />
            <div className="cl-toast-body">
              <div className="cl-toast-title">{t.title}</div>
              {t.body && <div className="cl-toast-sub">{t.body}</div>}
              {t.sessionId && (
                <button type="button" className="cl-toast-action" onClick={() => act(t)}>
                  Open session
                </button>
              )}
            </div>
            <button
              type="button"
              className="cl-toast-close"
              aria-label="Dismiss"
              onClick={() => dismiss(t.id)}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
            <AutoDismiss id={t.id} onExpire={dismiss} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// One timer per toast; split out so each toast owns its own lifecycle and a
// re-render of the list doesn't reset every timer.
function AutoDismiss({ id, onExpire }: { id: string; onExpire: (id: string) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onExpire(id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [id, onExpire]);
  return null;
}
