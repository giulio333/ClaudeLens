import { useEffect, useRef } from 'react';
import { useActiveSessions, useNotifyPrefs } from '../../../hooks/useIPC';
import { statusSummary } from './status-mirror';
import type { TerminalInstance } from './terminal-instances';
import { useTabAttention } from './use-tab-attention';

/**
 * Hands the tabs' state to the main process, which shows it in the menu bar and
 * on the Dock (`notifications:setStatus`, `status-mirror.ts`). Draws nothing.
 *
 * Sent only when it changes, compared as text: every registry reading hands
 * over new objects. Nothing is shown until the preferences are read and while
 * the switch is off, and unmounting clears both surfaces. A menu bar row hands
 * back its instance's id; one this list no longer has is ignored.
 */
export function StatusMirror({
  instances,
  onRestore,
}: {
  instances: readonly TerminalInstance[];
  onRestore: (id: string) => void;
}) {
  const { data: registry } = useActiveSessions();
  const attention = useTabAttention();
  const { data: prefs } = useNotifyPrefs();
  const summary = prefs?.surface ? statusSummary(instances, registry, attention) : null;
  const sent = JSON.stringify(summary);

  useEffect(() => {
    void window.electronAPI.notifications.setStatus(JSON.parse(sent));
  }, [sent]);
  useEffect(() => () => void window.electronAPI.notifications.setStatus(null), []);

  const ids = useRef<ReadonlySet<string>>(new Set());
  const restore = useRef(onRestore);
  useEffect(() => {
    ids.current = new Set(instances.map(i => i.id));
    restore.current = onRestore;
  });
  useEffect(
    () =>
      window.electronAPI.notifications.onRestoreSession(id => {
        if (ids.current.has(id)) restore.current(id);
      }),
    []
  );
  return null;
}
