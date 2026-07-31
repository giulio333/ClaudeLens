import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useUpdateCheck, useSkippedUpdateVersion, useSkipUpdateVersion } from '../hooks/useIPC';

// Passive update notice, shown once per launch when GitHub has a newer release
// than the running build (see electron/modules/update-checker.ts for why there
// is no auto-install: ClaudeLens ships unsigned). Anchored bottom-left so it
// never fights the session-notification toaster in the bottom-right corner.
//
// Dismissal semantics: ✕ hides it for this run only; "Skip this version"
// persists to ~/.claudelens/preferences.json so that release stays quiet until
// the next one. "View release" opens the GitHub release page in the browser
// (the main process routes external links through shell.openExternal).

const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

export function UpdateBanner() {
  const { data: update } = useUpdateCheck();
  const { data: skippedVersion, isLoading: skippedLoading } = useSkippedUpdateVersion();
  const skip = useSkipUpdateVersion();
  const [hidden, setHidden] = useState(false);

  const visible =
    !hidden &&
    !skippedLoading &&
    !!update?.updateAvailable &&
    update.latestVersion !== skippedVersion;

  return (
    <AnimatePresence>
      {visible && update && (
        <motion.div
          className="cl-update-anchor"
          role="status"
          aria-label="Update available"
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
        >
          <div className="cl-toast cl-toast--update">
            <span className="cl-toast-stripe" aria-hidden="true" />
            <div className="cl-toast-body">
              <div className="cl-toast-title">Update available</div>
              <div className="cl-toast-sub">
                ClaudeLens {update.latestVersion} is out — you're on {update.currentVersion}.
              </div>
              <div className="cl-toast-actions">
                <a
                  className="cl-toast-action"
                  href={update.releaseUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setHidden(true)}
                >
                  View release
                </a>
                <button
                  type="button"
                  className="cl-toast-action cl-toast-action--quiet"
                  onClick={() => skip.mutate(update.latestVersion)}
                >
                  Skip this version
                </button>
              </div>
              {IS_MAC && (
                <div className="cl-toast-note">
                  Unsigned build: after installing, clear the quarantine flag — the command is in
                  Settings → General.
                </div>
              )}
            </div>
            <button
              type="button"
              className="cl-toast-close"
              aria-label="Dismiss"
              onClick={() => setHidden(true)}
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
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
