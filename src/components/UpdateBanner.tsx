import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  useUpdateCheck,
  useSkippedUpdateVersion,
  useSkipUpdateVersion,
  useClaudeCodeVersion,
  useDismissedCliUpdate,
  useDismissCliUpdate,
} from '../hooks/useIPC';
import { compareVersions } from '../../electron/shared/version-compare';
import { claudeCodeVersion as requiredCliVersion } from '../../package.json';

// Passive update notices, shown once per launch, anchored bottom-left so they
// never fight the session-notification toaster in the bottom-right corner.
// Two independent things can be behind:
//
//   1. ClaudeLens itself — GitHub has a newer release than the running build
//      (see electron/modules/update-checker.ts for why there is no
//      auto-install: ClaudeLens ships unsigned).
//   2. The Claude Code CLI — the installed version (`claude --version`, via
//      `updates:claudeCodeVersion`) is older than the `claudeCodeVersion` this
//      build was prepared against, which is what Settings → General calls
//      "Claude Code required". The app reads data written by that CLI, so an
//      older one can mean formats this build doesn't know about.
//
// Both are advisory: they suggest, never block, and both remember a dismissal
// per version in ~/.claudelens/preferences.json.
//
// The anchor is a column stack so the two can be on screen together without
// either one having to know about the other.

const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

const ENTER = { opacity: 0, y: 16, scale: 0.98 };
const SHOWN = { opacity: 1, y: 0, scale: 1 };
const MOTION = { duration: 0.22, ease: 'easeOut' } as const;

export function UpdateBanner() {
  return (
    <div className="cl-update-anchor">
      <ClaudeCodeNotice />
      <AppUpdateNotice />
    </div>
  );
}

/**
 * "A newer ClaudeLens is published". Dismissal semantics: ✕ hides it for this
 * run only; "Skip this version" persists so that release stays quiet until the
 * next one. "View release" opens the GitHub release page in the browser (the
 * main process routes external links through shell.openExternal).
 */
function AppUpdateNotice() {
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
          role="status"
          aria-label="Update available"
          initial={ENTER}
          animate={SHOWN}
          exit={ENTER}
          transition={MOTION}
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
            <CloseButton onClick={() => setHidden(true)} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// What updates the CLI in place, whichever installer put it there.
const CLI_UPDATE_CMD = 'claude update';

/**
 * "Your Claude Code is older than this build expects". Deliberately quieter
 * than the notice above — no stripe, no title, one sentence and the command —
 * because nothing is broken: the app keeps working, it just may not understand
 * everything a newer CLI writes. Dismissal pins the *required* version, so
 * raising the requirement in a later ClaudeLens brings the notice back.
 */
function ClaudeCodeNotice() {
  const { data } = useClaudeCodeVersion();
  const { data: dismissed, isLoading: dismissedLoading } = useDismissedCliUpdate();
  const dismiss = useDismissCliUpdate();
  const [hidden, setHidden] = useState(false);
  const [copied, setCopied] = useState(false);

  const installed = data?.version ?? null;
  const outdated = !!installed && compareVersions(installed, requiredCliVersion) < 0;
  const visible = !hidden && !dismissedLoading && outdated && dismissed !== requiredCliVersion;

  const copy = () => {
    navigator.clipboard
      .writeText(CLI_UPDATE_CMD)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => {});
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          role="status"
          aria-label="Claude Code update suggested"
          initial={ENTER}
          animate={SHOWN}
          exit={ENTER}
          transition={MOTION}
        >
          <div className="cl-toast cl-toast--cli">
            <div className="cl-toast-body">
              {/* "Your" carries weight here: this is the CLI on the user's PATH,
                  not the one ClaudeLens bundles for its own chat (Settings →
                  General prints both, one row apart). `claude update` moves this
                  number and nothing else. */}
              <div className="cl-toast-sub">
                Your Claude Code {installed} is older than the {requiredCliVersion} this ClaudeLens
                expects.
              </div>
              <div className="cl-cli-cmd">
                <code>{CLI_UPDATE_CMD}</code>
                <button type="button" onClick={copy} className="cl-cli-copy">
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div className="cl-toast-actions">
                <button
                  type="button"
                  className="cl-toast-action cl-toast-action--quiet"
                  onClick={() => dismiss.mutate(requiredCliVersion)}
                >
                  Don’t remind me
                </button>
              </div>
            </div>
            <CloseButton onClick={() => setHidden(true)} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="cl-toast-close" aria-label="Dismiss" onClick={onClick}>
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
  );
}
