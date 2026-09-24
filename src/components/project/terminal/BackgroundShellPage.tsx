import { useState } from 'react';
import { CommandBlock } from '../chat/CommandBlock';
import { shellStatusLine, spanLabel } from './background-shells';
import type { BackgroundShell } from './background-shells';
import { StateIcon } from './BackgroundShells';
import { useMinuteClock } from './use-minute-clock';

/**
 * A background shell's own page, opened from a row of the top bar's list and
 * shown in the frame's overlay like a tool or a file change — so the crumb, the
 * ✕ and Esc are the frame's, and this draws no bar of its own.
 *
 * It holds what the transcript knows about the shell and nothing it doesn't:
 * the command in the terminal window the transcript draws it in, then when it
 * started and ended, how long it ran, its exit code, how it reached the
 * background, whether Claude stopped it, and the output file the result names.
 * The output itself is not here: the ending notification does not carry it,
 * it lives only in that file. The frame hands in the shell fresh on every read,
 * so a page opened on a running shell turns into its ending when it lands.
 */
export function BackgroundShellPage({ shell: s }: { shell: BackgroundShell }) {
  const now = useMinuteClock(s.state === 'running');
  const facts: Array<[string, string]> = [];
  if (s.startedAt) facts.push(['Started', clockTime(s.startedAt)]);
  if (s.endedAt) facts.push(['Ended', clockTime(s.endedAt)]);
  if (s.startedAt && s.endedAt) facts.push(['Ran', spanLabel(s.endedAt - s.startedAt)]);
  if (s.exitCode !== undefined) facts.push(['Exit code', String(s.exitCode)]);
  facts.push([
    'Background',
    s.via === 'timeout'
      ? `Moved there after its ${s.timeoutS ?? '?'} s timeout`
      : 'Started there by Claude',
  ]);
  if (s.stoppedByClaude) facts.push(['Stopped', 'By Claude, with TaskStop']);

  return (
    <div className="cl-tool-detail">
      <div className="cl-tool-detail-scroll">
        <header className="cl-tool-detail-hero">
          <h2>{s.title}</h2>
          <p className="cl-bgshell-page-status" data-tone={s.state}>
            <StateIcon state={s.state} size={15} />
            {shellStatusLine(s, now)}
          </p>
        </header>
        <div className="cl-tool-detail-grid">
          <CommandBlock input={{ command: s.command }} showDescription={false} />
          <dl className="cl-bgshell-facts">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
            {s.outputFile && (
              <div>
                <dt>Output file</dt>
                <dd className="cl-bgshell-path">
                  <span>{s.outputFile}</span>
                  <CopyText text={s.outputFile} label="Copy path" />
                </dd>
              </div>
            )}
          </dl>
        </div>
      </div>
    </div>
  );
}

function CopyText({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="cl-bgshell-copy"
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
