import { useEffect, useRef, useState } from 'react';
import { CloseIcon, SheetModal } from '../chat/CommandBlock';
import { PaperCode } from '../chat/ContextFileSheet';
import { shellStatusLine, spanLabel } from './background-shells';
import type { BackgroundShell } from './background-shells';
import { StateIcon } from './ShellStateIcon';
import { useMinuteClock } from './use-minute-clock';

/**
 * One background shell's window, opened from its row in the top bar's list.
 * It floats over the session like the window of a file the session read
 * (`ContextFileSheet`), with the same anatomy and the same paper: bar, a column
 * of facts, the command, and a foot — so the chat stays where it was beneath.
 *
 * It holds what the transcript knows and nothing it doesn't: when the shell
 * started and ended, how long it ran, its exit code, how it reached the
 * background and whether Claude stopped it, the command, and the output file
 * the result names. The output itself is not here — the ending notification
 * does not carry it, it lives only in that file. The caller hands the shell in
 * fresh on every transcript read, so a window opened on a running shell turns
 * into its ending in place.
 */
export function BackgroundShellSheet({
  shell: s,
  onClose,
}: {
  shell: BackgroundShell;
  onClose: () => void;
}) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const now = useMinuteClock(s.state === 'running');
  useEffect(() => sheetRef.current?.focus(), []);

  const facts: Array<[string, string]> = [];
  if (s.startedAt) facts.push(['Started', clockTime(s.startedAt)]);
  if (s.endedAt) facts.push(['Ended', clockTime(s.endedAt)]);
  if (s.startedAt && s.endedAt) facts.push(['Ran', spanLabel(s.endedAt - s.startedAt)]);
  else if (s.state === 'running') facts.push(['Running for', spanLabel(now - s.startedAt)]);
  if (s.exitCode !== undefined) facts.push(['Exit code', String(s.exitCode)]);
  facts.push([
    'How',
    s.via === 'timeout'
      ? `Moved to the background after its ${s.timeoutS ?? '?'} s timeout`
      : 'Started in the background by Claude',
  ]);
  if (s.stoppedByClaude) facts.push(['Stopped by', 'Claude, with TaskStop']);

  return (
    <SheetModal onClose={onClose} glass>
      <div
        ref={sheetRef}
        className="cl-ctx-sheet cl-bgshell-sheet"
        role="document"
        tabIndex={-1}
        aria-label={`${s.title}, ${shellStatusLine(s, now)}`}
      >
        <div className="cl-ctx-sheet-bar">
          <StateIcon state={s.state} size={14} />
          <b className="cl-ctx-sheet-name cl-bgshell-sheet-title">{s.title}</b>
          <span className="cl-ctx-sheet-path cl-bgshell-sheet-status" data-tone={s.state}>
            {shellStatusLine(s, now)}
          </span>
          <button type="button" className="cl-ctx-sheet-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className="cl-ctx-sheet-main">
          <dl className="cl-ctx-sheet-reads cl-bgshell-facts">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <div className="cl-ctx-sheet-pane">
            <div className="cl-ctx-sheet-cmd cl-bgshell-sheet-cmd">
              <span className="where">Command</span>
              <CopyButton text={s.command} label="Copy command" />
            </div>
            <div className="cl-ctx-sheet-body">
              <PaperCode text={s.command} lang="bash" />
            </div>
          </div>
        </div>

        <div className="cl-ctx-sheet-foot">
          {s.outputFile ? (
            <>
              <span className="cl-bgshell-sheet-file" title={s.outputFile}>
                output · {s.outputFile}
              </span>
              <CopyButton text={s.outputFile} label="Copy path" />
            </>
          ) : (
            <span>no output file named</span>
          )}
        </div>
      </div>
    </SheetModal>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="cl-ctx-jump"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}

function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
