import Markdown from '../../Markdown';
import type { ReactNode } from 'react';
import {
  ToolGroup,
  isMemoryFile,
  resolveToolIcon,
  stripLineNumbers,
  fileExt,
  SKILL_TOOL,
} from './utils';
import { PathChip, SectionLabel, CodeBlock, UrlChip } from './atoms';
import { CommandBlock, CommandOutput, CommandSheet } from './CommandBlock';
import { ownsToolBody, ownsOutputHead, isShellOutput } from './shell';
import {
  parseRedirectNotice,
  parseWebSearchResult,
  webHost,
  webPageLabel,
  WEB_FETCH,
  WEB_SEARCH,
} from './web';
import type { WebLink } from './web';

function BackChevron() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 3 5 8l5 5" />
    </svg>
  );
}

function OpenBoxIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 5 8 2.4 13.5 5 8 7.6 2.5 5Z" />
      <path d="M2.5 5v6L8 13.6 13.5 11V5" />
      <path d="M8 7.6v6" />
    </svg>
  );
}

function ResultIcon({ error }: { error: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {error ? (
        <>
          <path d="M8 2.4 14 13H2L8 2.4Z" />
          <path d="M8 6.2v3.1" />
          <path d="M8 11.5h.01" />
        </>
      ) : (
        <>
          <path d="M13.3 4.5 6.8 11 3.4 7.6" />
          <path d="M2.3 8a5.7 5.7 0 1 0 2-4.3" />
        </>
      )}
    </svg>
  );
}

function outputLineCount(result: ToolGroup['result']): number {
  if (!result?.content) return 0;
  return result.content.split('\n').length;
}

function formatDuration(ms?: number): string | null {
  if (ms === undefined) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

function formatDurationParts(ms?: number): { value: string; unit: string } | null {
  if (ms === undefined) return null;
  if (ms < 1000) return { value: String(ms), unit: 'ms' };
  return { value: (ms / 1000).toFixed(ms < 10_000 ? 1 : 0), unit: 's' };
}

function agentGlyph(name: string): string {
  const parts = name
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'AG';
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return parts[0].slice(0, 2).toUpperCase();
}

function parseAgentResult(content: string) {
  const usageMatch = content.match(/<usage>([\s\S]*?)<\/usage>/);
  const usage = usageMatch?.[1] ?? '';
  const readNumber = (key: string) => {
    const match = usage.match(new RegExp(`${key}:\\s*(\\d+)`));
    return match ? Number(match[1]) : undefined;
  };

  return {
    cleanContent: content.replace(/\s*<usage>[\s\S]*?<\/usage>\s*/g, '').trim(),
    totalTokens: readNumber('total_tokens'),
    toolUses: readNumber('tool_uses'),
    durationMs: readNumber('duration_ms'),
    agentId: content.match(/agentId:\s*([A-Za-z0-9_-]+)/)?.[1],
  };
}

/** Does this label say anything the breadcrumb's tool name doesn't? `Web search`
 *  under a bar that already reads `WEBSEARCH` is the same word twice; `Tool
 *  execution` under `EDIT` is not. Compared without spaces or case because the
 *  bar upper-cases the name and the subtitle is written in prose. */
function addsToName(label: string | undefined, name: string): boolean {
  if (!label) return false;
  const flat = (s: string) => s.replace(/[\s_:-]+/g, '').toLowerCase();
  return flat(label) !== flat(name);
}

function ToolDetailShell({
  icon,
  name,
  title,
  subtitle,
  result,
  isMemory,
  onBack,
  children,
  variant,
  noHero,
  noBar,
}: {
  icon: string;
  name: string;
  title: string;
  subtitle?: string;
  result: ToolGroup['result'];
  isMemory: boolean;
  onBack: () => void;
  children: ReactNode;
  variant?: 'default' | 'agent';
  noHero?: boolean;
  noBar?: boolean;
}) {
  const status = result ? (result.isError ? 'Error' : 'Complete') : 'Pending';
  const statusClass = result ? (result.isError ? 'is-error' : 'is-ok') : 'is-pending';
  // The hero exists to carry a title the breadcrumb can't: a search query, a
  // fetched page, an agent's description. For `Edit` / `Read` / `Bash` the title
  // *is* the tool name, so the page said the same word four times — bar, kicker,
  // heading, subtitle — over ~110px before the first real line. There the bar is
  // the heading. The status badge moves into it either way: it belongs next to
  // what it qualifies, and the hero was holding a whole row for one chip.
  const showHero = !noHero && addsToName(title, name);
  const showSubtitle = addsToName(subtitle, name);

  return (
    <div className={`cl-tool-detail${variant === 'agent' ? ' cl-tool-detail--agent' : ''}`}>
      {!noBar && (
        <div className="cl-tool-detail-bar">
          <button type="button" onClick={onBack} className="cl-tool-detail-back">
            <BackChevron />
            <span>Back to chat</span>
          </button>
          <span className="cl-tool-detail-sep">/</span>
          <span className="cl-tool-detail-mini-icon">{icon}</span>
          <span className="cl-tool-detail-mini-title">{name}</span>
          {showSubtitle && <span className="cl-tool-detail-bar-sub">{subtitle}</span>}
          <div className="cl-tool-detail-badges">
            <span className={`cl-tool-status ${statusClass}`}>{status}</span>
            {isMemory && <span className="cl-tool-status is-memory">Memory</span>}
          </div>
        </div>
      )}

      <div className="cl-tool-detail-scroll">
        {showHero && (
          <header className="cl-tool-detail-hero">
            <h2>{title}</h2>
          </header>
        )}
        {children}
      </div>
    </div>
  );
}

function StatChip({
  label,
  value,
  unit,
  variant,
}: {
  label: string;
  value: string;
  unit?: string;
  variant?: 'id';
}) {
  return (
    <div className={`cl-agent-v1-chip${variant === 'id' ? ' is-id' : ''}`}>
      <span className="ll">{label}</span>
      <div className="vv">
        {value}
        {unit && <small>{unit}</small>}
      </div>
    </div>
  );
}

function AgentDetailBody({
  name,
  input,
  result,
  onBack,
  chromeless,
}: {
  name: string;
  input: Record<string, unknown>;
  result: ToolGroup['result'];
  onBack: () => void;
  /** The host frame carries the crumb and the way back — drop the local one. */
  chromeless?: boolean;
}) {
  const subtype =
    (input.subagent_type as string | undefined) || (name === 'Task' ? 'task' : 'general-purpose');
  const description = (input.description as string | undefined) || 'Agent dispatch';
  const prompt = (input.prompt as string | undefined) || '';
  const parsed = parseAgentResult(result?.content ?? '');
  const cleanOutput = parsed.cleanContent || result?.content || '';
  const isError = Boolean(result?.isError);
  const isPending = !result;
  const statusLabel = isPending ? 'Pending' : isError ? 'Error' : 'Complete';
  const statusClass = isPending ? 'is-pending' : isError ? 'is-error' : 'is-ok';
  const lineCount = result ? cleanOutput.split('\n').filter(Boolean).length : 0;
  const totalLineCount = result ? outputLineCount(result) : 0;
  const durationParts = formatDurationParts(parsed.durationMs);
  const durationFull = formatDuration(parsed.durationMs);
  const glyph = agentGlyph(subtype);

  return (
    <div className="cl-agent-v1">
      {!chromeless && (
        <nav className="cl-agent-v1-subbread">
          <button type="button" onClick={onBack} className="cl-agent-v1-back-pill">
            <span className="ico">
              <BackChevron />
            </span>
            Back to chat
          </button>
          <span className="sep">/</span>
          <span>Agent · Tool detail</span>
        </nav>
      )}

      <section className="cl-agent-v1-hero">
        <div className={`cl-agent-v1-orb ${statusClass}`}>{glyph}</div>
        <div className="cl-agent-v1-meta">
          <div className="cl-agent-v1-eyebrow">
            <span className="pip" /> Sub-agent · {subtype}
          </div>
          <h1>{description}</h1>
          <div className="cl-agent-v1-sub">
            <span className="cl-agent-v1-agent-pill">{subtype}</span>
            {(durationFull || lineCount > 0) && <span className="sep">·</span>}
            {durationFull && <span>{durationFull}</span>}
            {durationFull && lineCount > 0 && <span className="sep">·</span>}
            {lineCount > 0 && (
              <span>
                {lineCount} {lineCount === 1 ? 'line' : 'lines'}
              </span>
            )}
          </div>
        </div>
        <div className="cl-agent-v1-status-col">
          <span className={`cl-agent-v1-status-pill ${statusClass}`}>
            <span className="led" /> {statusLabel}
          </span>
          {parsed.agentId && <span className="cl-agent-v1-id">{parsed.agentId}</span>}
        </div>
      </section>

      <div className="cl-agent-v1-statline">
        {totalLineCount > 0 && (
          <StatChip
            label="Output"
            value={String(totalLineCount)}
            unit={totalLineCount === 1 ? 'line' : 'lines'}
          />
        )}
        {parsed.toolUses !== undefined && (
          <StatChip label="Tool uses" value={String(parsed.toolUses)} />
        )}
        {parsed.totalTokens !== undefined && (
          <StatChip label="Tokens" value={String(parsed.totalTokens)} />
        )}
        {durationParts && (
          <StatChip label="Duration" value={durationParts.value} unit={durationParts.unit} />
        )}
      </div>

      <div className="cl-agent-v1-io">
        <section className="cl-agent-v1-card prompt">
          <div className="cl-agent-v1-card-head">
            <span className="ico">
              <OpenBoxIcon />
            </span>
            <span className="lbl">
              Input · <b>Prompt</b>
            </span>
            <span className="meta">{prompt.length} chars</span>
          </div>
          {prompt ? (
            <div className="cl-agent-v1-prompt-body">{prompt}</div>
          ) : (
            <p className="cl-agent-v1-empty">No prompt provided.</p>
          )}
        </section>

        <section className={`cl-agent-v1-card output${isError ? ' is-error' : ''}`}>
          <div className="cl-agent-v1-card-head">
            <span className="ico">
              <ResultIcon error={isError} />
            </span>
            <span className="lbl">
              {isError ? 'Error' : 'Output'}
              {totalLineCount > 0 && (
                <>
                  {' · '}
                  <b>
                    {totalLineCount} {totalLineCount === 1 ? 'line' : 'lines'}
                  </b>
                </>
              )}
            </span>
            <span className="meta">{isError ? 'stderr' : 'stdout'}</span>
          </div>
          {isPending ? (
            <p className="cl-agent-v1-empty">No result available.</p>
          ) : isError ? (
            <pre className="cl-agent-v1-error">{cleanOutput || '(no output)'}</pre>
          ) : (
            <div className="cl-agent-v1-output-body">
              <Markdown>{cleanOutput || '(no output)'}</Markdown>
            </div>
          )}
          {parsed.agentId && !isError && !isPending && (
            <div className="cl-agent-v1-notice">
              <b>Continue this agent:</b> use <code>SendMessage</code> with{' '}
              <code>to: '{parsed.agentId}'</code>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export function ToolInput({
  name,
  input,
  inline,
}: {
  name: string;
  input: Record<string, unknown>;
  /** Rendered inside a tool chip in the transcript, whose header already shows
   *  the tool's description — so the body must not repeat it. */
  inline?: boolean;
}) {
  if (name === 'Read') {
    const fp = input.file_path as string;
    const ext = fileExt(fp);
    return (
      <div className="space-y-3">
        <PathChip path={fp} />
        {ext && (
          <span className="inline-block text-[10px] font-mono bg-[var(--cl-accent-soft)]/20 text-[var(--cl-accent-ink)] border border-[var(--cl-accent)]/40 rounded px-2 py-0.5">
            .{ext}
          </span>
        )}
      </div>
    );
  }

  if (name === 'Write' || name === 'Edit') {
    const fp = input.file_path as string;
    const content = input.content as string | undefined;
    const oldStr = input.old_string as string | undefined;
    const newStr = input.new_string as string | undefined;
    return (
      <div className="space-y-3">
        <PathChip path={fp} />
        {content !== undefined && (
          <>
            <SectionLabel label="Written content" meta={`${content.split('\n').length} lines`} />
            <CodeBlock code={content} lang={fileExt(fp)} />
          </>
        )}
        {oldStr !== undefined && (
          <>
            <SectionLabel label="Replaced text" />
            <CodeBlock
              code={oldStr}
              lang={fileExt(fp)}
              className="border-[var(--cl-danger)] opacity-75"
            />
            <SectionLabel label="New text" />
            <CodeBlock code={newStr ?? ''} lang={fileExt(fp)} className="border-[var(--cl-ok)]" />
          </>
        )}
      </div>
    );
  }

  if (name === 'Bash') {
    return <CommandBlock input={input} showDescription={!inline} />;
  }

  if (name === 'Grep') {
    const pattern = input.pattern as string;
    const path = input.path as string | undefined;
    const mode = input.output_mode as string | undefined;
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-[var(--cl-ink-3)]">Pattern:</span>
          <code className="bg-[var(--cl-warn-soft)] border border-[var(--cl-warn)] text-[var(--cl-warn)] rounded px-2 py-0.5 text-[12px] font-mono">
            {pattern}
          </code>
          {mode && (
            <span className="text-[10px] bg-[var(--cl-paper-3)] border border-[var(--cl-line)] text-[var(--cl-ink-3)] rounded px-2 py-0.5 font-mono">
              {mode}
            </span>
          )}
        </div>
        {path && <PathChip path={path} />}
      </div>
    );
  }

  // The two web tools carry a source and an intent, and both are prose the
  // reader wants: which page (as a live link, not a JSON string) and what was
  // asked of it. They used to fall through to a raw `JSON.stringify` of the
  // input — the URL unclickable, the ask a mono blob with escaped newlines.
  if (name === WEB_FETCH) {
    const url = typeof input.url === 'string' ? input.url : '';
    const prompt = typeof input.prompt === 'string' ? input.prompt : '';
    return (
      <div className="space-y-3">
        {url ? <UrlChip url={url} /> : <p className="text-[12px] text-[var(--cl-ink-3)]">No URL</p>}
        {prompt && (
          <div>
            <SectionLabel label="Asked of the page" />
            <p className="text-[12px] leading-relaxed text-[var(--cl-ink-2)] whitespace-pre-wrap">
              {prompt}
            </p>
          </div>
        )}
      </div>
    );
  }

  if (name === WEB_SEARCH) {
    const query = typeof input.query === 'string' ? input.query : '';
    const domains = Array.isArray(input.allowed_domains)
      ? input.allowed_domains.filter((d): d is string => typeof d === 'string')
      : [];
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 flex-wrap">
          <span className="text-[11px] text-[var(--cl-ink-3)] pt-1">Query:</span>
          <code className="bg-[var(--cl-warn-soft)] border border-[var(--cl-warn)] text-[var(--cl-warn)] rounded px-2 py-0.5 text-[12px] font-mono min-w-0 break-words">
            {query || '—'}
          </code>
        </div>
        {domains.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-[var(--cl-ink-3)]">Restricted to:</span>
            {domains.map(d => (
              <span
                key={d}
                className="text-[10px] font-mono bg-[var(--cl-paper-3)] border border-[var(--cl-line)] text-[var(--cl-ink-3)] rounded px-2 py-0.5"
              >
                {d}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (name === 'Glob') {
    const pattern = input.pattern as string;
    const path = input.path as string | undefined;
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--cl-ink-3)]">Pattern:</span>
          <code className="bg-[var(--cl-warn-soft)] border border-[var(--cl-warn)] text-[var(--cl-warn)] rounded px-2 py-0.5 text-[12px] font-mono">
            {pattern}
          </code>
        </div>
        {path && <PathChip path={path} />}
      </div>
    );
  }

  if (name === 'Agent') {
    const prompt = input.prompt as string;
    const subtype = input.subagent_type as string | undefined;
    const desc = input.description as string | undefined;
    return (
      <div className="space-y-3">
        {subtype && (
          <span className="inline-block text-[11px] font-semibold bg-[var(--cl-accent-soft)]/20 text-[var(--cl-accent-ink)] border border-[var(--cl-accent)]/40 rounded-full px-3 py-1">
            {subtype}
          </span>
        )}
        {desc && <p className="text-[13px] font-medium text-[var(--cl-ink-3)]">{desc}</p>}
        <div className="rounded-lg bg-[var(--cl-paper-3)] border border-[var(--cl-line)] px-4 py-3">
          <p className="text-[12px] text-[var(--cl-ink-3)] whitespace-pre-wrap leading-relaxed">
            {prompt}
          </p>
        </div>
      </div>
    );
  }

  if (name === 'memory:createTopic') {
    const topicName = input.name as string | undefined;
    const type = input.type as string | undefined;
    const desc = input.description as string | undefined;
    const content = input.content as string | undefined;
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {type && (
            <span
              className={`text-[10px] font-semibold px-2 py-1 rounded-full ${
                type === 'user'
                  ? 'bg-[var(--cl-paper-3)] text-[var(--cl-cyan)] border border-[var(--cl-cyan)]'
                  : type === 'feedback'
                    ? 'bg-[var(--cl-warn-soft)] text-[var(--cl-warn)] border border-[var(--cl-warn)]'
                    : type === 'project'
                      ? 'bg-[var(--cl-paper-3)] text-[var(--cl-ok)] border border-[var(--cl-ok)]'
                      : 'bg-[var(--cl-paper-3)] text-[var(--cl-violet)] border border-[var(--cl-violet)]'
              }`}
            >
              {type}
            </span>
          )}
          {topicName && (
            <span className="text-[12px] font-semibold text-[var(--cl-ink-2)] font-mono">
              {topicName}
            </span>
          )}
        </div>
        {desc && <p className="text-[12px] text-[var(--cl-ink-3)]">{desc}</p>}
        {content && (
          <>
            <SectionLabel label="Content" meta={`${content.split('\n').length} lines`} />
            <CodeBlock
              code={
                content.split('\n').slice(0, 15).join('\n') +
                (content.split('\n').length > 15 ? '\n...' : '')
              }
              lang="markdown"
            />
          </>
        )}
      </div>
    );
  }

  if (name === 'memory:updateTopic') {
    const filename = input.filename as string | undefined;
    const topicName = input.name as string | undefined;
    const content = input.content as string | undefined;
    return (
      <div className="space-y-3">
        {filename && <PathChip path={filename} />}
        {topicName && (
          <span className="text-[12px] font-semibold text-[var(--cl-ink-2)] font-mono">
            {topicName}
          </span>
        )}
        {content && (
          <>
            <SectionLabel label="New content" meta={`${content.split('\n').length} lines`} />
            <CodeBlock
              code={
                content.split('\n').slice(0, 15).join('\n') +
                (content.split('\n').length > 15 ? '\n...' : '')
              }
              lang="markdown"
            />
          </>
        )}
      </div>
    );
  }

  if (name === 'memory:deleteTopic') {
    const filename = input.filename as string | undefined;
    return (
      <div className="space-y-2">
        {filename ? (
          <PathChip path={filename} />
        ) : (
          <p className="text-[12px] text-[var(--cl-ink-3)]">No filename</p>
        )}
      </div>
    );
  }

  if (name === SKILL_TOOL) {
    const skill = input.skill as string | undefined;
    const rest = Object.entries(input).filter(([k]) => k !== 'skill');
    return (
      <div className="space-y-3">
        {skill && (
          <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold bg-[var(--cl-accent-soft)]/20 text-[var(--cl-accent-ink)] border border-[var(--cl-accent)]/40 rounded-full px-3 py-1">
            <span aria-hidden="true">⚡</span>
            {skill}
          </span>
        )}
        {rest.length > 0 && (
          <CodeBlock code={JSON.stringify(Object.fromEntries(rest), null, 2)} lang="json" />
        )}
      </div>
    );
  }

  return <CodeBlock code={JSON.stringify(input, null, 2)} lang="json" />;
}

/**
 * The sources a search returned, as the bibliography they are: ordinal · title ·
 * dotted leader · host, on the app's own leader-dot device (`.cl-src`, shared
 * language with the Settings readout and the session rows) instead of a stack of
 * bordered result cards.
 *
 * The caption counts **domains as well as results** — the cheap half of grouping
 * by host: it says at a glance whether a search drew on six sources or read one
 * site six times, without spending a heading per domain to do it.
 */
function SearchSources({ links }: { links: WebLink[] }) {
  const domains = new Set(links.map(l => webHost(l.url))).size;
  const meta =
    domains < links.length
      ? `${links.length} results · ${domains} domains`
      : `${links.length} ${links.length === 1 ? 'result' : 'results'}`;
  return (
    <div>
      <SectionLabel label="Sources" meta={meta} />
      <div className="cl-src-list">
        {links.map((l, i) => (
          <a
            key={l.url || i}
            className="cl-src"
            href={l.url}
            title={`${l.title ? `${l.title}\n` : ''}${l.url}`}
            onClick={e => {
              e.preventDefault();
              window.open(l.url, '_blank', 'noopener');
            }}
          >
            <span className="n" aria-hidden>
              [{i + 1}]
            </span>
            <span className="t">{l.title || l.url}</span>
            <span className="leader" aria-hidden />
            <span className="h">{webHost(l.url)}</span>
            <span className="go" aria-hidden>
              ↗
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

export function ToolOutput({
  name,
  input,
  result,
}: {
  name: string;
  input: Record<string, unknown>;
  result: ToolGroup['result'];
}) {
  // Shell output first: the block owns its own head, so it also has to own the
  // pending / empty / error states the generic guards below would swallow.
  if (isShellOutput(name)) return <CommandOutput result={result} />;

  if (!result)
    return <p className="text-[12px] text-[var(--cl-ink-3)] italic">No result available</p>;

  const raw = result.content;
  if (!raw) return <p className="text-[12px] text-[var(--cl-ink-3)] italic">(no output)</p>;

  if (result.isError) {
    return (
      <div className="rounded-lg bg-[var(--cl-danger-soft)] border border-[var(--cl-danger)] px-4 py-3">
        <pre className="text-[12px] text-[var(--cl-danger)] font-mono whitespace-pre-wrap break-words leading-relaxed">
          {raw}
        </pre>
      </div>
    );
  }

  if (name === 'Read' && raw.match(/^\s*\d+→/m)) {
    const stripped = stripLineNumbers(raw);
    const fp = input.file_path as string;
    const ext = fileExt(fp);
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          {ext && (
            <span className="text-[10px] font-mono bg-[var(--cl-paper-3)] border border-[var(--cl-line)] text-[var(--cl-ink-3)] rounded px-2 py-0.5">
              .{ext}
            </span>
          )}
        </div>
        <CodeBlock code={stripped} lang={ext} />
      </div>
    );
  }

  if (name === 'Agent') {
    return (
      <div className="bg-[var(--cl-paper-2)] border border-[var(--cl-line)] rounded-lg px-5 py-4">
        <div className="prose prose-sm prose-zinc max-w-none">
          <Markdown>{raw}</Markdown>
        </div>
      </div>
    );
  }

  // A fetched page comes back as the model's markdown extraction, so it renders
  // as markdown (it was a mono `CodeBlock` before — the one output in the app
  // that is prose by construction, printed as if it were source).
  if (name === WEB_FETCH) {
    const redirect = parseRedirectNotice(raw);
    if (redirect) {
      return (
        <div className="rounded-lg bg-[var(--cl-warn-soft)] border border-[var(--cl-warn)] px-4 py-3 space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--cl-warn)]">
            Redirected — page not read
          </p>
          <p className="text-[12px] leading-relaxed text-[var(--cl-ink-2)]">
            The host answered {redirect.status ?? 'with a redirect to another host'} and returned no
            content. Reading it takes a second call to the target below.
          </p>
          {redirect.to && <UrlChip url={redirect.to} />}
        </div>
      );
    }
    return (
      <div className="bg-[var(--cl-paper-2)] border border-[var(--cl-line)] rounded-lg px-5 py-4 overflow-x-auto">
        <div className="prose prose-sm prose-zinc max-w-none">
          <Markdown>{raw}</Markdown>
        </div>
      </div>
    );
  }

  // A search result is three things in one string: the sources, the synthesis,
  // and a `REMINDER:` written for the harness. The sources are the part worth
  // making clickable; the reminder is not the reader's business.
  if (name === WEB_SEARCH) {
    const { links, body, error } = parseWebSearchResult(raw);
    return (
      <div className="space-y-3">
        {error && (
          <div className="rounded-lg bg-[var(--cl-danger-soft)] border border-[var(--cl-danger)] px-4 py-3">
            <p className="text-[12px] text-[var(--cl-danger)]">
              The search did not run — <span className="font-mono">{error}</span>
            </p>
          </div>
        )}
        {links.length > 0 && <SearchSources links={links} />}
        {body && (
          <div className="bg-[var(--cl-paper-2)] border border-[var(--cl-line)] rounded-lg px-5 py-4 overflow-x-auto">
            <div className="prose prose-sm prose-zinc max-w-none">
              <Markdown>{body}</Markdown>
            </div>
          </div>
        )}
        {links.length === 0 && !body && !error && (
          <p className="text-[12px] text-[var(--cl-ink-3)] italic">No results</p>
        )}
      </div>
    );
  }

  if (name === SKILL_TOOL) {
    // Skill output is `Skill "<name>" completed (...).\n\nResult:\n<markdown>`.
    // Strip the preamble so the analysis renders as the markdown it is.
    const body = raw.replace(/^Skill\s+"[^"]*"\s+completed[^\n]*\.\s*\n+(?:Result:\s*\n+)?/, '');
    return (
      <div className="bg-[var(--cl-paper-2)] border border-[var(--cl-line)] rounded-lg px-5 py-4 overflow-x-auto">
        <div className="prose prose-sm prose-zinc max-w-none">
          <Markdown>{body || raw}</Markdown>
        </div>
      </div>
    );
  }

  if (name === 'Glob') {
    const paths = raw.split('\n').filter(Boolean);
    return (
      <div className="space-y-1">
        {paths.map((p, i) => (
          <div
            key={i}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--cl-paper-3)] border border-[var(--cl-line-soft)] text-[12px] font-mono text-[var(--cl-ink-3)] hover:bg-[var(--cl-paper-3)] transition-colors"
          >
            <span className="text-[var(--cl-ink-3)] shrink-0 text-[10px]">{i + 1}</span>
            <span className="truncate">{p}</span>
          </div>
        ))}
        {paths.length === 0 && (
          <p className="text-[12px] text-[var(--cl-ink-3)] italic">No files found</p>
        )}
      </div>
    );
  }

  if (name === 'Grep') {
    const lines = raw.split('\n').filter(Boolean);
    return (
      <div className="rounded-lg bg-[var(--cl-paper-3)] border border-[var(--cl-line)] overflow-hidden">
        {lines.map((line, i) => (
          <div
            key={i}
            className="flex items-start gap-3 px-3 py-1.5 border-b border-[var(--cl-line-soft)] last:border-0 hover:bg-[var(--cl-paper-2)] transition-colors"
          >
            <span className="text-[var(--cl-ink-2)] text-[10px] font-mono shrink-0 pt-0.5">
              {i + 1}
            </span>
            <pre className="text-[11px] font-mono text-[var(--cl-ink-3)] whitespace-pre-wrap break-words flex-1">
              {line}
            </pre>
          </div>
        ))}
        {lines.length === 0 && (
          <p className="px-3 py-2 text-[12px] text-[var(--cl-ink-3)] italic">No results</p>
        )}
      </div>
    );
  }

  if (name.startsWith('memory:')) {
    // Parse inside try/catch, but keep JSX returns outside it so a render-time
    // throw propagates to the error boundary instead of being swallowed.
    let json: { data?: { filename?: string }; filename?: string } | null = null;
    try {
      json = JSON.parse(raw);
    } catch {
      // Not JSON — fall through to the raw code block below.
    }
    if (json) {
      if (name === 'memory:createTopic' || name === 'memory:updateTopic') {
        const filename = json.data?.filename || json.filename;
        return filename ? (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-[var(--cl-paper-3)] border border-[var(--cl-ok)]">
            <span className="text-[var(--cl-ok)] text-[13px]">✓</span>
            <span className="text-[12px] text-[var(--cl-ok)] font-mono">{filename}</span>
          </div>
        ) : (
          <p className="text-[12px] text-[var(--cl-ink-3)]">Operation completed.</p>
        );
      }
      if (name === 'memory:deleteTopic') {
        return (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-[var(--cl-paper-3)] border border-[var(--cl-ok)]">
            <span className="text-[var(--cl-ok)] text-[13px]">✓</span>
            <span className="text-[12px] text-[var(--cl-ok)]">Topic deleted.</span>
          </div>
        );
      }
    }
  }

  return <CodeBlock code={raw} />;
}

export function ToolDetailPanel({
  group,
  onBack,
  chromeless,
}: {
  group: ToolGroup;
  onBack: () => void;
  /** Mounted inside a frame whose own top bar carries the tool's crumb and the
   *  way back (`TerminalMissionControl`, `ChatView`): the panel then draws no
   *  breadcrumb of its own, which is what put two "Back" one under the other. */
  chromeless?: boolean;
}) {
  const { use, result } = group;
  const icon = resolveToolIcon(use.name, use.input as Record<string, unknown>);
  const isMemory = isMemoryFile(use.input as Record<string, unknown>);
  const name = use.name;
  const input = use.input as Record<string, unknown>;
  const isAgent = name === 'Agent' || name === 'Task';
  // A web call's subject is the source it went to, not the tool that went there
  // — the same title the Mission Control row carries.
  const webSubject =
    name === WEB_FETCH && typeof input.url === 'string'
      ? webPageLabel(input.url)
      : name === WEB_SEARCH && typeof input.query === 'string'
        ? input.query
        : null;
  const detailTitle = isAgent
    ? (input.description as string | undefined) || 'Agent dispatch'
    : webSubject || name;
  const detailSubtitle = isAgent
    ? (input.subagent_type as string | undefined) || 'general-purpose'
    : isMemory
      ? 'Memory operation'
      : name === WEB_FETCH
        ? 'Web page'
        : name === WEB_SEARCH
          ? 'Web search'
          : 'Tool execution';

  return (
    <ToolDetailShell
      icon={icon}
      name={name}
      title={detailTitle}
      subtitle={detailSubtitle}
      result={result}
      isMemory={isMemory}
      onBack={onBack}
      variant={isAgent ? 'agent' : 'default'}
      noHero={isAgent}
      noBar={isAgent || chromeless}
    >
      {isAgent ? (
        <AgentDetailBody
          name={name}
          input={input}
          result={result}
          onBack={onBack}
          chromeless={chromeless}
        />
      ) : (
        <div className="cl-tool-detail-grid">
          {ownsToolBody(name) ? (
            // One panel: the command and what it printed are one reading unit.
            <section className={`cl-tool-detail-panel ${result?.isError ? 'is-error' : ''}`}>
              <CommandSheet input={input} result={result} showCommand showDescription />
            </section>
          ) : (
            <>
              <section className="cl-tool-detail-panel">
                <SectionLabel label="Input" />
                <ToolInput name={name} input={input} />
              </section>

              <section className={`cl-tool-detail-panel ${result?.isError ? 'is-error' : ''}`}>
                {(!ownsOutputHead(name) || result?.isError) && (
                  <SectionLabel
                    label={result?.isError ? 'Error' : 'Output'}
                    meta={result ? `${result.content.split('\n').length} lines` : undefined}
                  />
                )}
                <ToolOutput name={name} input={input} result={result} />
              </section>
            </>
          )}
        </div>
      )}
    </ToolDetailShell>
  );
}
