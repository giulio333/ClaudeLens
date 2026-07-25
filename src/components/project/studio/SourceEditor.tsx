import { useMemo } from 'react';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';

hljs.registerLanguage('javascript', javascript);

/**
 * Editable JavaScript source with syntax highlighting: a highlighted `<pre>`
 * underneath a transparent `<textarea>` that owns the caret and the typing.
 * Both layers share font metrics, padding and wrapping so the glyphs line up.
 * Workflow scripts are always JavaScript, so the language is fixed.
 */
export function SourceEditor({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
}) {
  const html = useMemo(() => hljs.highlight(value, { language: 'javascript' }).value, [value]);
  // Shared metrics — any drift here would misalign the caret from the glyphs.
  const layer =
    'font-mono text-[12.5px] leading-[1.65] tab-size-2 whitespace-pre-wrap break-words p-5 m-0';

  return (
    <div className="cl-code-pre relative border border-[var(--cl-line)] min-h-[620px]">
      <pre className={`${layer} overflow-hidden`} aria-hidden="true">
        {/* Trailing newline keeps the last empty line tall enough to click into. */}
        <code className="hljs" dangerouslySetInnerHTML={{ __html: `${html}\n` }} />
      </pre>
      <textarea
        value={value}
        onChange={event => onChange(event.target.value)}
        spellCheck={false}
        aria-label={ariaLabel}
        className={`${layer} absolute inset-0 h-full w-full resize-none border-none bg-transparent text-transparent caret-[var(--cl-ink)] outline-none selection:bg-[color-mix(in_oklch,var(--cl-accent)_28%,transparent)]`}
      />
    </div>
  );
}
