import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import hljs from 'highlight.js/lib/common';
import { ToolGroup } from './utils';
import { parseShellCommand, normalizeOutput, promptRows } from './shell';
import type { PromptLead } from './shell';

/** Output rows shown before the window asks to be unfolded. Deliberately a clamp
 *  and not an inner vertical scroller: a nested scrollbar inside a transcript
 *  that already scrolls swallows the wheel and hides how long the output is. */
const OUTPUT_CLAMP = 22;

function highlightBash(code: string): string | null {
  try {
    return hljs.highlight(code, { language: 'bash' }).value;
  } catch {
    return null;
  }
}

/** hljs escapes its output, so injecting it is safe (same contract as `CodeBlock`).
 *  No `.cl-code-pre` here: this surface is fixed dark, so the tokens keep the
 *  app's github-dark-dimmed palette instead of the paper-adaptive remap. */
function Code({ code }: { code: string }) {
  const html = useMemo(() => highlightBash(code), [code]);
  return html ? (
    <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <code className="hljs">{code}</code>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="cl-term-btn"
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      label={copied ? 'Copied' : label}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? (
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : (
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
      )}
    </IconButton>
  );
}

/** Kind of gutter mark, for colour: the prompt, a flow-changing connective, or a
 *  pipe. `''` (a plain `;`/newline sequence) needs no mark at all. */
function leadKind(lead: PromptLead): string {
  if (lead === '❯') return 'is-prompt';
  if (lead === '|') return 'is-pipe';
  return lead ? 'is-flow' : '';
}

/** The command, laid out for reading: ONE prompt (that is how many there were),
 *  every continuation line opened by the connective that governs it. Nothing
 *  wraps — a wrapped shell line reads as prose and loses its shape — the window
 *  scrolls sideways instead, command and output on one scroller, the way one
 *  session scrolls. */
function PromptLines({ command }: { command: string }) {
  const rows = useMemo(() => promptRows(command), [command]);

  if (rows.length === 0) {
    return (
      <div className="cl-term-line">
        <span className="cl-term-lead is-prompt" aria-hidden>
          ❯
        </span>
        <span className="cl-term-code cl-term-empty">(empty command)</span>
      </div>
    );
  }
  return (
    <>
      {rows.map((row, i) => (
        <div key={i} className="cl-term-line">
          <span className={`cl-term-lead ${leadKind(row.lead)}`} aria-hidden>
            {row.lead}
          </span>
          <span className="cl-term-code">
            <Code code={row.code} />
            {row.suffix && <span className="cl-term-op"> {row.suffix}</span>}
          </span>
        </div>
      ))}
    </>
  );
}

type RunState = 'ok' | 'error' | 'pending';

/** What the run produced. `null` = there is no result to show at all (the
 *  approval dialog, where the command has not run yet): no output area, no
 *  status strip — a status strip that says "running" about a command awaiting
 *  approval would be a lie. */
type Run = { output: string; state: RunState; totalLines: number };

/** The window: title bar (macOS lights + title + actions), the session body,
 *  and a status strip. Used inline in the transcript and, with `full`, as the
 *  fullscreen panel — same object, more room. */
function TerminalWindow({
  title,
  meta,
  command,
  run,
  clamped,
  onToggleClamp,
  onExpand,
  onClose,
  full,
}: {
  title: string;
  meta: string;
  command: string;
  run: Run | null;
  clamped: boolean;
  onToggleClamp?: () => void;
  onExpand?: () => void;
  onClose?: () => void;
  full?: boolean;
}) {
  const output = run?.output ?? '';
  const totalLines = run?.totalLines ?? 0;
  const shown = clamped ? output.split('\n').slice(0, OUTPUT_CLAMP).join('\n') : output;
  const status =
    run?.state === 'pending'
      ? 'running'
      : totalLines > 0
        ? `${totalLines} ${totalLines === 1 ? 'line' : 'lines'}`
        : 'no output';

  return (
    <div className={`cl-term${full ? ' is-full' : ''}${run?.state === 'error' ? ' is-error' : ''}`}>
      <div className="cl-term-bar">
        <span className="cl-term-lights" aria-hidden>
          <i className="r" />
          <i className="y" />
          <i className="g" />
        </span>
        <span className="cl-term-title">
          <b>{title}</b>
          {meta && <span className="sep">—</span>}
          {meta && <span className="meta">{meta}</span>}
        </span>
        <span className="cl-term-actions">
          {command && <CopyButton text={command} label="Copy command" />}
          {onExpand && (
            <IconButton label="Open fullscreen" onClick={onExpand}>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M9 3H3v6" />
                <path d="M15 21h6v-6" />
                <path d="M3 3l7 7" />
                <path d="M21 21l-7-7" />
              </svg>
            </IconButton>
          )}
          {onClose && (
            <IconButton label="Close fullscreen" onClick={onClose}>
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </IconButton>
          )}
        </span>
      </div>

      <div className={`cl-term-body${clamped ? ' is-clamped' : ''}`}>
        {command && <PromptLines command={command} />}
        {run &&
          (output ? (
            <div className="cl-term-out">
              <code>{shown}</code>
            </div>
          ) : (
            <div className="cl-term-note">
              {run.state === 'pending'
                ? 'still running — no result recorded yet'
                : 'completed with no output'}
            </div>
          ))}
      </div>

      {run && (
        <div className="cl-term-foot">
          <span className={`cl-term-state is-${run.state}`}>
            <i aria-hidden />
            {status}
          </span>
          <span className="cl-term-foot-actions">
            {onToggleClamp && (
              <button type="button" className="cl-term-link" onClick={onToggleClamp}>
                {clamped ? `Show all ${totalLines} lines` : 'Collapse output'}
              </button>
            )}
            {output && <CopyButton text={output} label="Copy output" />}
          </span>
        </div>
      )}
    </div>
  );
}

function lineLabel(n: number): string {
  return `${n} ${n === 1 ? 'line' : 'lines'}`;
}

function readCommand(input: Record<string, unknown>): string {
  return typeof input.command === 'string' ? input.command : '';
}

/** Title-bar meta, macOS-style ("bash — 5 steps"): the shape of what ran, plus
 *  the flags that changed how it ran. */
function commandMeta(input: Record<string, unknown>, command: string): string {
  const parsed = parseShellCommand(command);
  const bits: string[] = [];
  if (parsed.mode === 'script') bits.push(lineLabel(parsed.lines));
  else if (parsed.steps.length > 1) bits.push(`${parsed.steps.length} steps`);
  if (input.run_in_background === true) bits.push('background');
  if (typeof input.timeout === 'number') bits.push(`timeout ${Math.round(input.timeout / 1000)}s`);
  if (input.dangerouslyDisableSandbox === true) bits.push('sandbox off');
  return bits.join(' · ');
}

/** A recorded shell run — command and its output in ONE terminal window, the way
 *  the session actually read. They used to be two labelled editorial sections
 *  (COMMAND / OUTPUT) with a head each, which both split a single unit in half
 *  and needed the labels to say what a prompt glyph says by itself. */
export function CommandSheet({
  input,
  result,
  showCommand,
  showDescription,
}: {
  input: Record<string, unknown>;
  result: ToolGroup['result'];
  /** MIN density drops tool inputs: the window then carries the output alone. */
  showCommand: boolean;
  /** The inline tool chip already prints the description in its header, so only
   *  the full-page views put it in the title bar. */
  showDescription: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [full, setFull] = useState(false);

  const command = showCommand ? readCommand(input) : '';
  const description = typeof input.description === 'string' ? input.description : '';
  const output = useMemo(() => normalizeOutput(result?.content ?? ''), [result?.content]);
  const state: RunState = !result ? 'pending' : result.isError ? 'error' : 'ok';

  const totalLines = output ? output.split('\n').length : 0;
  const clamped = !expanded && totalLines > OUTPUT_CLAMP;
  const title = showDescription && description ? description : 'bash';
  const meta = commandMeta(input, readCommand(input));

  const run: Run = { output, state, totalLines };

  return (
    <>
      <TerminalWindow
        title={title}
        meta={meta}
        command={command}
        run={run}
        clamped={clamped}
        onToggleClamp={totalLines > OUTPUT_CLAMP ? () => setExpanded(e => !e) : undefined}
        onExpand={command || output ? () => setFull(true) : undefined}
      />
      {full && (
        <FullscreenTerminal
          title={description || title}
          meta={meta}
          // Fullscreen always carries the command, even in MIN density: it is
          // the "show me everything" view.
          command={readCommand(input)}
          run={run}
          onClose={() => setFull(false)}
        />
      )}
    </>
  );
}

/** The same window on top of everything, output unclamped and scrolling on its
 *  own — the answer to "the output is too big to read inside a chat bubble". */
function FullscreenTerminal({
  title,
  meta,
  command,
  run,
  onClose,
}: {
  title: string;
  meta: string;
  command: string;
  run: Run;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="cl-term-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="cl-term-modal-hold" onClick={e => e.stopPropagation()}>
        <TerminalWindow
          title={title}
          meta={meta}
          command={command}
          run={run}
          clamped={false}
          onClose={onClose}
          full
        />
      </div>
    </div>,
    document.body
  );
}

/** Command only, no result to show: the approval dialog, where the command is
 *  what the user has to read before saying yes. */
export function CommandBlock({
  input,
  showDescription,
}: {
  input: Record<string, unknown>;
  showDescription: boolean;
}) {
  const command = readCommand(input);
  const description = typeof input.description === 'string' ? input.description : '';
  return (
    <TerminalWindow
      title={showDescription && description ? description : 'bash'}
      meta={commandMeta(input, command)}
      command={command}
      run={null}
      clamped={false}
    />
  );
}

/** Output only — a `BashOutput` read of a background shell. */
export function CommandOutput({ result }: { result: ToolGroup['result'] }) {
  return <CommandSheet input={{}} result={result} showCommand={false} showDescription={false} />;
}
