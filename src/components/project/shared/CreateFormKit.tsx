import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';

// Shared building blocks for the "create" pages (skills, agents).

export const MODEL_PRESETS = [
  'default',
  'best',
  'sonnet',
  'opus',
  'haiku',
  'sonnet[1m]',
  'opus[1m]',
  'opusplan',
] as const;

// Curated list of common Claude Code tools for the tools autocomplete.
// Exact tool names as used in subagent `tools` frontmatter / permission rules.
// Users can still type any custom value (e.g. MCP tools) by hand.
export const KNOWN_TOOLS = [
  // File & shell
  'Read',
  'Write',
  'Edit',
  'NotebookEdit',
  'Bash',
  // Search & navigation
  'Glob',
  'Grep',
  'LSP',
  // Web
  'WebFetch',
  'WebSearch',
  // Delegation & skills
  'Agent',
  'Skill',
  'AskUserQuestion',
  // Tasks
  'TaskCreate',
  'TaskGet',
  'TaskList',
  'TaskUpdate',
  'TaskStop',
  // Plan & worktree
  'EnterPlanMode',
  'ExitPlanMode',
  'EnterWorktree',
  'ExitWorktree',
  // Misc
  'TodoWrite',
  'Monitor',
  'PowerShell',
  'ListMcpResourcesTool',
  'ReadMcpResourceTool',
] as const;

// One-line descriptions for the known tools, shown muted under each name in
// the autocomplete dropdown. Custom (typed) tools simply have none.
export const TOOL_DESCRIPTIONS: Record<string, string> = {
  Read: 'Read file contents',
  Write: 'Create or overwrite files',
  Edit: 'Make targeted edits to a file',
  NotebookEdit: 'Modify Jupyter notebook cells',
  Bash: 'Run shell commands',
  Glob: 'Find files by name pattern',
  Grep: 'Search file contents (ripgrep)',
  LSP: 'Code intelligence via language servers',
  WebFetch: 'Fetch and extract content from a URL',
  WebSearch: 'Run web searches',
  Agent: 'Spawn a subagent with its own context',
  Skill: 'Run a skill in the conversation',
  AskUserQuestion: 'Ask multiple-choice questions',
  TaskCreate: 'Create a task in the task list',
  TaskGet: 'Get details for a specific task',
  TaskList: 'List all tasks with their status',
  TaskUpdate: 'Update task status, deps or details',
  TaskStop: 'Kill a running background task',
  EnterPlanMode: 'Switch to plan mode before coding',
  ExitPlanMode: 'Present a plan and exit plan mode',
  EnterWorktree: 'Create / switch to an isolated git worktree',
  ExitWorktree: 'Return from a worktree session',
  TodoWrite: 'Manage the session task checklist',
  Monitor: 'Run a command in the background and react to output',
  PowerShell: 'Run PowerShell commands natively',
  ListMcpResourcesTool: 'List resources from MCP servers',
  ReadMcpResourceTool: 'Read a specific MCP resource by URI',
};

// Full descriptions + permission flag, shown in the hover popover next to a
// dropdown row. `permission` = the tool prompts for permission when it runs.
export const TOOL_DETAILS: Record<string, { full: string; permission: boolean }> = {
  Read: { full: 'Reads the contents of files.', permission: false },
  Write: {
    full: 'Creates or overwrites files with the full content provided. Does not append or merge.',
    permission: true,
  },
  Edit: {
    full: 'Makes targeted edits to specific files via exact string replacement.',
    permission: true,
  },
  NotebookEdit: {
    full: 'Modifies Jupyter notebook cells one cell at a time (replace, insert or delete).',
    permission: true,
  },
  Bash: {
    full: 'Executes shell commands in your environment, with an optional background mode for long-running processes.',
    permission: true,
  },
  Glob: {
    full: 'Finds files based on glob pattern matching (e.g. **/*.ts), sorted by modification time.',
    permission: false,
  },
  Grep: {
    full: 'Searches for patterns in file contents using ripgrep regex syntax. Respects .gitignore.',
    permission: false,
  },
  LSP: {
    full: 'Code intelligence via language servers: jump to definitions, find references, report type errors and warnings. Requires a code-intelligence plugin.',
    permission: false,
  },
  WebFetch: {
    full: 'Fetches content from a URL, converts HTML to Markdown and runs an extraction prompt against it. Lossy by design.',
    permission: true,
  },
  WebSearch: {
    full: 'Runs a web search and returns result titles and URLs. Does not fetch the pages — follow up with WebFetch.',
    permission: true,
  },
  Agent: {
    full: 'Spawns a subagent with its own context window to handle a task autonomously, returning a single text result to the parent.',
    permission: false,
  },
  Skill: { full: 'Executes a skill within the main conversation.', permission: true },
  AskUserQuestion: {
    full: 'Asks multiple-choice questions to gather requirements or clarify ambiguity.',
    permission: false,
  },
  TaskCreate: { full: 'Creates a new task in the task list.', permission: false },
  TaskGet: { full: 'Retrieves full details for a specific task.', permission: false },
  TaskList: { full: 'Lists all tasks with their current status.', permission: false },
  TaskUpdate: {
    full: 'Updates task status, dependencies, details, or deletes tasks.',
    permission: false,
  },
  TaskStop: { full: 'Kills a running background task by ID.', permission: false },
  EnterPlanMode: {
    full: 'Switches to plan mode to design an approach before coding.',
    permission: false,
  },
  ExitPlanMode: { full: 'Presents a plan for approval and exits plan mode.', permission: true },
  EnterWorktree: {
    full: 'Creates an isolated git worktree and switches into it, or switches into an existing one by path.',
    permission: false,
  },
  ExitWorktree: {
    full: 'Exits a worktree session and returns to the original directory.',
    permission: false,
  },
  TodoWrite: {
    full: 'Manages the session task checklist. Disabled by default as of v2.1.142 in favor of TaskCreate / TaskGet / TaskList / TaskUpdate.',
    permission: false,
  },
  Monitor: {
    full: 'Runs a command in the background and feeds each output line back to Claude, so it can react to logs, file changes or polled status mid-conversation.',
    permission: true,
  },
  PowerShell: {
    full: 'Executes PowerShell commands natively (availability depends on platform and settings).',
    permission: true,
  },
  ListMcpResourcesTool: {
    full: 'Lists resources exposed by connected MCP servers.',
    permission: false,
  },
  ReadMcpResourceTool: { full: 'Reads a specific MCP resource by URI.', permission: false },
};

export const NAME_MAX = 64;
export const DESC_MAX = 250;
export const NAME_RE = /^[a-z0-9-]+$/;

type Accent = 'accent' | 'violet';

export function openDocs(url: string) {
  window.open(url, '_blank', 'noopener');
}

export function ModelPicker({
  value,
  onChange,
  accentVar,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  accentVar: string;
  placeholder: string;
}) {
  const isPreset = MODEL_PRESETS.includes(value as (typeof MODEL_PRESETS)[number]);
  const [customMode, setCustomMode] = useState(!!value && !isPreset);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {MODEL_PRESETS.map(p => {
          const active = !customMode && value === p;
          return (
            <button
              key={p}
              type="button"
              onClick={() => {
                setCustomMode(false);
                onChange(p);
              }}
              className={`px-2.5 py-1 font-mono text-[11px] border transition-colors ${active ? 'bg-[var(--cl-ink)] text-[var(--cl-paper)] border-[var(--cl-ink)]' : 'bg-[var(--cl-paper)] text-[var(--cl-ink-2)] border-[var(--cl-line)] hover:border-[var(--cl-ink-4)]'}`}
            >
              {p}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => {
            setCustomMode(true);
            if (isPreset) onChange('');
          }}
          className={`px-2.5 py-1 font-mono text-[11px] border transition-colors ${customMode ? '' : 'bg-[var(--cl-paper)] text-[var(--cl-ink-3)] border-dashed border-[var(--cl-line)] hover:border-[var(--cl-ink-4)] hover:text-[var(--cl-ink-2)]'}`}
          style={
            customMode
              ? { borderColor: `var(${accentVar})`, color: `var(${accentVar})` }
              : undefined
          }
        >
          Custom…
        </button>
      </div>
      {customMode && (
        <input
          autoFocus
          className="w-full rounded-none border border-[var(--cl-line)] bg-[var(--cl-paper)] px-3 py-2 text-[13px] font-mono text-[var(--cl-ink)] placeholder:text-[var(--cl-ink-4)] outline-none focus:border-[var(--cl-ink)] transition-colors"
          placeholder={placeholder}
          value={value}
          onChange={e => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

export function ToolsInput({
  value,
  onChange,
  placeholder,
  accent,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  accent: Accent;
}) {
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const [hover, setHover] = useState<{ tool: string; rowTop: number } | null>(null);

  // The dropdown is portaled to <body> so it escapes ancestors that clip
  // (e.g. the edit card uses backdrop-filter, which clips descendants in
  // Chromium even with overflow: visible). Position is tracked from the box.
  const measure = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ left: r.left, top: r.bottom, width: r.width });
  }, []);

  // Opening the dropdown measures the box up-front (in the event handler, so no
  // synchronous setState lands in an effect); the effect below only keeps it
  // anchored on scroll/resize while open. The portal renders solely when
  // `open && rect`, so a stale rect after close is never visible.
  const openMenu = () => {
    measure();
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open, measure]);

  // Literal class strings (no dynamic interpolation) so Tailwind's JIT keeps them.
  const chipCls =
    accent === 'violet'
      ? 'bg-[var(--cl-violet-soft)] text-[var(--cl-violet-ink)]'
      : 'bg-[var(--cl-accent-soft)] text-[var(--cl-accent-ink)]';
  const optionCls =
    accent === 'violet'
      ? 'hover:bg-[var(--cl-violet-soft)] hover:text-[var(--cl-violet-ink)]'
      : 'hover:bg-[var(--cl-accent-soft)] hover:text-[var(--cl-accent-ink)]';

  const suggestions = useMemo(() => {
    const q = draft.trim().toLowerCase();
    return KNOWN_TOOLS.filter(t => !value.includes(t) && (!q || t.toLowerCase().includes(q)));
  }, [draft, value]);

  function add(tool: string) {
    const t = tool.trim();
    if (t && !value.includes(t)) onChange([...value, t]);
    setDraft('');
    inputRef.current?.focus();
  }
  function removeAt(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }

  return (
    <div className="relative">
      <div
        ref={boxRef}
        onClick={() => inputRef.current?.focus()}
        className="flex flex-wrap items-center gap-1.5 w-full rounded-none border border-[var(--cl-line)] bg-[var(--cl-paper)] px-2 py-1.5 min-h-[40px] cursor-text focus-within:border-[var(--cl-ink)] transition-colors"
      >
        {value.map((t, i) => (
          <span
            key={t}
            className={`inline-flex items-center gap-1 px-2 py-0.5 font-mono text-[11px] border border-transparent ${chipCls}`}
          >
            {t}
            <button
              type="button"
              onClick={() => removeAt(i)}
              className="opacity-60 hover:opacity-100 leading-none"
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="flex-1 min-w-[100px] bg-transparent px-1 py-0.5 text-[13px] font-mono text-[var(--cl-ink)] placeholder:text-[var(--cl-ink-4)] outline-none"
          placeholder={value.length ? '' : placeholder}
          value={draft}
          onChange={e => {
            setDraft(e.target.value);
            openMenu();
          }}
          onFocus={openMenu}
          onBlur={() =>
            setTimeout(() => {
              setOpen(false);
              setHover(null);
            }, 120)
          }
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              if (draft.trim()) add(draft);
            } else if (e.key === 'Backspace' && !draft && value.length) removeAt(value.length - 1);
          }}
        />
      </div>
      {open &&
        suggestions.length > 0 &&
        rect &&
        createPortal(
          <div
            className="fixed z-[100] bg-[var(--cl-paper)] border border-[var(--cl-ink)] shadow-xl max-h-48 overflow-y-auto"
            style={{ left: rect.left, top: rect.top + 4, width: rect.width }}
          >
            {suggestions.map(t => (
              <button
                key={t}
                type="button"
                onMouseDown={e => {
                  e.preventDefault();
                  add(t);
                }}
                onMouseEnter={e =>
                  setHover({ tool: t, rowTop: e.currentTarget.getBoundingClientRect().top })
                }
                onMouseLeave={() => setHover(h => (h?.tool === t ? null : h))}
                className={`block w-full text-left px-3 py-1.5 transition-colors ${optionCls}`}
              >
                <span className="block font-mono text-[12px] text-[var(--cl-ink-2)]">{t}</span>
                {TOOL_DESCRIPTIONS[t] && (
                  <span className="block text-[10.5px] leading-tight text-[var(--cl-ink-4)] mt-0.5">
                    {TOOL_DESCRIPTIONS[t]}
                  </span>
                )}
              </button>
            ))}
          </div>,
          document.body
        )}
      {open &&
        hover &&
        TOOL_DETAILS[hover.tool] &&
        rect &&
        createPortal(
          (() => {
            const W = 260;
            const rightX = rect.left + rect.width + 8;
            // Flip to the left of the dropdown if it would overflow the viewport.
            const left = rightX + W > window.innerWidth ? Math.max(8, rect.left - W - 8) : rightX;
            const detail = TOOL_DETAILS[hover.tool];
            return (
              <div
                className="fixed z-[101] bg-[var(--cl-paper)] border border-[var(--cl-ink)] shadow-xl px-3 py-2.5 pointer-events-none"
                style={{ left, top: hover.rowTop, width: W }}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="font-mono text-[12px] text-[var(--cl-ink)]">{hover.tool}</span>
                  <span
                    className="font-mono text-[9px] uppercase tracking-[0.12em] px-1.5 py-0.5 border"
                    style={
                      detail.permission
                        ? {
                            color: 'var(--cl-accent-ink)',
                            background: 'var(--cl-accent-soft)',
                            borderColor: 'transparent',
                          }
                        : { color: 'var(--cl-ink-4)', borderColor: 'var(--cl-line)' }
                    }
                  >
                    {detail.permission ? 'asks permission' : 'no prompt'}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-[var(--cl-ink-3)]">{detail.full}</p>
              </div>
            );
          })(),
          document.body
        )}
    </div>
  );
}

export function FieldHint({ text }: { text: string }) {
  return (
    <span className="relative group inline-flex items-center ml-1.5 cursor-default">
      <span className="text-[9px] font-mono text-[var(--cl-ink-4)] border border-[var(--cl-line)] w-3.5 h-3.5 flex items-center justify-center leading-none select-none">
        i
      </span>
      <span className="pointer-events-none absolute left-5 top-0 z-50 w-56 bg-[var(--cl-paper)] border border-[var(--cl-ink)] px-2.5 py-1.5 font-mono text-[10px] leading-relaxed text-[var(--cl-ink-2)] shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-normal normal-case tracking-normal">
        {text}
      </span>
    </span>
  );
}

export function CharCounter({ n, max, accentVar }: { n: number; max: number; accentVar: string }) {
  const near = n > max * 0.85;
  const over = n > max;
  return (
    <span
      className="ml-auto font-mono text-[9px] tabular-nums"
      style={{ color: over ? 'var(--cl-danger)' : near ? `var(${accentVar})` : 'var(--cl-ink-4)' }}
    >
      {n}/{max}
    </span>
  );
}

// Cmd/Ctrl+Enter to save · Esc to cancel
export function useCreateFormKeys(opts: {
  canSubmit: boolean;
  isLoading: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const { canSubmit, isLoading, onSubmit, onCancel } = opts;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (canSubmit && !isLoading) onSubmit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
}

export function validateName(raw: string): string | null {
  const nameTrim = raw.trim();
  if (nameTrim.length === 0) return null;
  if (!NAME_RE.test(nameTrim)) return 'Lowercase letters, numbers and hyphens only';
  if (nameTrim.length > NAME_MAX) return `Max ${NAME_MAX} characters`;
  return null;
}
