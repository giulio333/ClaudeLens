import { useEffect } from 'react';

// The non-component half of the "create" pages kit (skills, agents, blueprints):
// the tool catalog, the field limits, and the small helpers/hook the forms share.
// Kept apart from CreateFormKit.tsx so that file only exports components —
// what react-refresh/only-export-components needs for fast refresh to work.

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

export type Accent = 'accent' | 'violet';

export function openDocs(url: string) {
  window.open(url, '_blank', 'noopener');
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
