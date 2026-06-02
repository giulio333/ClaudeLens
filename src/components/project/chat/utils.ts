import { ChatMessage, ChatContentBlock } from '../../../hooks/useIPC'

export type ChatDetailsFilter = 'all' | 'minimal'

// Una coppia tool_use + tool_result abbinati per id
export type ToolGroup = {
  use: Extract<ChatContentBlock, { type: 'tool_use' }>
  result: Extract<ChatContentBlock, { type: 'tool_result' }> | null
}

// Messaggio processato: i tool_result del messaggio utente successivo vengono abbinati qui
export type ProcessedMessage = {
  msg: ChatMessage
  toolGroups: ToolGroup[]   // solo per messaggi assistant con tool_use
  command?: ClaudeSlashCommand  // se il messaggio è un Claude Code command (XML tag flow)
}

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference'
export type ParsedMemory = { name: string; description: string; type: MemoryType; body: string }
export type ClaudeSlashCommand = {
  command: string
  args: string
  description: string
  output?: string
}

export const CLAUDE_BUILTIN_SLASH_COMMANDS: Record<string, string> = {
  'add-dir': 'Add additional working directories',
  agents: 'Manage custom AI subagents',
  bug: 'Report a bug to Anthropic',
  clear: 'Clear conversation history',
  compact: 'Compact conversation with optional focus instructions',
  config: 'View or modify configuration',
  cost: 'Show token usage statistics',
  doctor: 'Check the Claude Code installation',
  help: 'Get usage help',
  init: 'Initialize project guidance',
  login: 'Switch Anthropic accounts',
  logout: 'Sign out from Anthropic',
  mcp: 'Manage MCP server connections',
  memory: 'Edit CLAUDE.md memory files',
  model: 'Select or change the AI model',
  permissions: 'View or update permissions',
  pr_comments: 'View pull request comments',
  review: 'Request code review',
  status: 'View account and system status',
  'terminal-setup': 'Install Shift+Enter newline binding',
  vim: 'Enter vim mode',
}

// Pre-processa l'array raw di messaggi:
// - I messaggi utente con soli tool_result vengono assorbiti nel messaggio assistant precedente
// - I tool_use vengono abbinati ai loro tool_result per toolUseId
// - I messaggi user con tag <command-name> vengono riconosciuti come comandi Claude Code
// - Il <local-command-stdout> successivo viene accorpato come output del comando
export function buildProcessedMessages(messages: ChatMessage[]): ProcessedMessage[] {
  const result: ProcessedMessage[] = []

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]

    const isToolOnlyUserMsg =
      msg.role === 'user' &&
      msg.content.length > 0 &&
      msg.content.every(b => b.type === 'tool_result')
    if (isToolOnlyUserMsg) continue

    // local-command-stdout: assorbi nel command precedente, se presente
    if (msg.role === 'user') {
      const onlyText = msg.content.length === 1 && msg.content[0].type === 'text'
        ? (msg.content[0] as Extract<ChatContentBlock, { type: 'text' }>).text
        : null
      if (onlyText) {
        const stdout = parseLocalCommandOutput(onlyText)
        if (stdout !== null) {
          const prev = result[result.length - 1]
          if (prev?.command) {
            prev.command = { ...prev.command, output: stdout }
            continue
          }
          // stdout orfano: lo lascio passare come messaggio normale (sotto)
        }
      }
    }

    // Riconosci command flow
    let command: ClaudeSlashCommand | undefined
    if (msg.role === 'user') {
      const firstText = msg.content.find(b => b.type === 'text') as Extract<ChatContentBlock, { type: 'text' }> | undefined
      if (firstText) {
        command = parseClaudeSlashCommand(firstText.text) ?? undefined
      }
    }

    const toolUseBlocks = msg.content.filter(
      b => b.type === 'tool_use'
    ) as Extract<ChatContentBlock, { type: 'tool_use' }>[]

    let toolGroups: ToolGroup[] = []
    if (toolUseBlocks.length > 0) {
      const next = messages[i + 1]
      const resultBlocks =
        next?.role === 'user' && next.content.every(b => b.type === 'tool_result')
          ? (next.content as Extract<ChatContentBlock, { type: 'tool_result' }>[])
          : []

      toolGroups = toolUseBlocks.map(use => ({
        use,
        result: resultBlocks.find(r => r.toolUseId === use.id) ?? null,
      }))
    }

    result.push({ msg, toolGroups, command })
  }

  return result
}

// Strip codici ANSI escape (es. \x1b[1m...\x1b[22m) usati dal terminale.
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

// Riconosce sia il flusso XML di Claude Code (<command-name>/X</command-name>...)
// sia il formato testuale "/X args". Ritorna null se non è un command noto.
export function parseClaudeSlashCommand(text: string): ClaudeSlashCommand | null {
  // 1. XML flow di Claude Code
  const cmdMatch = text.match(/<command-name>\s*\/?([a-z][a-z0-9_-]*)\s*<\/command-name>/i)
  if (cmdMatch) {
    const command = cmdMatch[1].toLowerCase()
    const description = CLAUDE_BUILTIN_SLASH_COMMANDS[command]
    if (!description) return null

    const argsMatch = text.match(/<command-args>([\s\S]*?)<\/command-args>/i)
    const args = argsMatch?.[1].trim() ?? ''
    return { command, args, description }
  }

  // 2. Formato testuale plain "/cmd args"
  const trimmed = text.trimStart()
  const match = trimmed.match(/^\/([a-z][a-z0-9_-]*)(?:\s+([\s\S]*))?$/)
  if (!match) return null

  const command = match[1]
  const description = CLAUDE_BUILTIN_SLASH_COMMANDS[command]
  if (!description) return null

  return {
    command,
    args: match[2]?.trim() ?? '',
    description,
  }
}

// Estrae il contenuto del tag <local-command-stdout>...</local-command-stdout>
// e rimuove gli escape ANSI. Ritorna null se non è puro stdout.
export function parseLocalCommandOutput(text: string): string | null {
  const match = text.match(/^\s*<local-command-stdout>([\s\S]*)<\/local-command-stdout>\s*$/i)
  if (!match) return null
  return stripAnsi(match[1]).trim()
}

// AskUserQuestion: i campi sono nel tool_use.input.questions[] e la risposta
// arriva o nel testo del tool_result ("...="Yes"...") o nel toolUseResult.answers.
export type AskQuestion = {
  question: string
  header?: string
  multiSelect: boolean
  options: { label: string; description?: string }[]
}

export function parseAskUserQuestions(input: Record<string, unknown>): AskQuestion[] {
  const raw = input.questions
  if (!Array.isArray(raw)) return []
  const out: AskQuestion[] = []
  for (const q of raw) {
    if (!q || typeof q !== 'object') continue
    const o = q as Record<string, unknown>
    const question = typeof o.question === 'string' ? o.question : ''
    if (!question) continue
    const opts = Array.isArray(o.options) ? o.options : []
    out.push({
      question,
      header: typeof o.header === 'string' ? o.header : undefined,
      multiSelect: Boolean(o.multiSelect),
      options: opts
        .map(opt => (opt && typeof opt === 'object' ? opt as Record<string, unknown> : null))
        .filter((x): x is Record<string, unknown> => x !== null)
        .map(opt => ({
          label: typeof opt.label === 'string' ? opt.label : '',
          description: typeof opt.description === 'string' ? opt.description : undefined,
        })),
    })
  }
  return out
}

// Estrae la risposta dal testo del tool_result quando non abbiamo strutturato.
// Formato osservato: 'Your questions have been answered: "Q1"="A1", "Q2"="A2".'
export function parseAnswersFromResultText(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!text) return out
  const re = /"([^"]+)"\s*=\s*"([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out[m[1]] = m[2]
  return out
}

// ──────────────────────────────────────────────────────────────────────────
// Turn role resolution — single source of truth shared by MessageBubble
// (rendering) and ChatView (navigation minimap + type filters). Mirrors the
// "Direction A — editorial transcript" prototype: one identity per turn.
// ──────────────────────────────────────────────────────────────────────────
export const AGENT_TOOLS = new Set(['Agent', 'Task'])
export const QUESTION_TOOL = 'AskUserQuestion'

export type TurnVariant = 'user' | 'claude' | 'agent' | 'command' | 'question'

export type TurnDescriptor = {
  variant: TurnVariant
  label: string
  initial: string
  color: string
  hasText: boolean
  hasThinking: boolean
  hasTools: boolean
  hasQuestion: boolean
  hasAgent: boolean
  /** True when MessageBubble would render something for this turn+filter. */
  visible: boolean
}

const ROLE_META: Record<TurnVariant, { label: string; initial: string; color: string }> = {
  user:     { label: 'You',      initial: 'U', color: 'var(--cl-ink)' },
  claude:   { label: 'Claude',   initial: 'C', color: 'var(--cl-accent)' },
  agent:    { label: 'Agent',    initial: 'A', color: 'var(--cl-violet)' },
  command:  { label: 'Command',  initial: '/', color: 'var(--cl-accent)' },
  question: { label: 'Question', initial: '?', color: 'var(--cl-warn)' },
}

export function describeTurn(p: ProcessedMessage, detailsFilter: ChatDetailsFilter): TurnDescriptor {
  const { msg, toolGroups, command } = p
  const isUser = msg.role === 'user'

  const textBlocks = msg.content.filter(b => b.type === 'text') as Extract<ChatContentBlock, { type: 'text' }>[]
  const thinkingBlocks = msg.content.filter(b => b.type === 'thinking') as Extract<ChatContentBlock, { type: 'thinking' }>[]
  const agentGroups = toolGroups.filter(g => AGENT_TOOLS.has(g.use.name))
  const questionGroups = toolGroups.filter(g => g.use.name === QUESTION_TOOL)
  const standardToolGroups = toolGroups.filter(g => g.use.name !== QUESTION_TOOL)

  const showThinking = detailsFilter === 'all'
  const showTools = detailsFilter === 'all'
  const showAgentStrip = detailsFilter === 'minimal' && agentGroups.length > 0
  const showQuestions = questionGroups.length > 0

  const hasText = textBlocks.length > 0
  const hasThinking = thinkingBlocks.some(b => b.thinking)
  const hasTools = standardToolGroups.length > 0
  const hasQuestion = showQuestions
  const hasAgent = agentGroups.length > 0

  const visible =
    hasText ||
    (showThinking && hasThinking) ||
    hasTools ||
    showAgentStrip ||
    showQuestions

  const isAgentTurn = showAgentStrip && textBlocks.length === 0
  const isQuestionTurn =
    showQuestions && textBlocks.length === 0 && !showAgentStrip && (!showTools || standardToolGroups.length === 0)
  const isCommandTurn = !!command

  const variant: TurnVariant =
    isCommandTurn ? 'command'
    : isQuestionTurn ? 'question'
    : isAgentTurn ? 'agent'
    : isUser ? 'user'
    : 'claude'

  return { variant, ...ROLE_META[variant], hasText, hasThinking, hasTools, hasQuestion, hasAgent, visible }
}

export const TOOL_ICON: Record<string, string> = {
  Read: '📖', Write: '✏️', Edit: '✏️', Bash: '⌨️', Glob: '📁',
  Grep: '🔍', Agent: '🤖', WebFetch: '🌐', WebSearch: '🔎', Task: '📋',
  Skill: '⚡',
  'memory:createTopic': '📝', 'memory:updateTopic': '📝', 'memory:deleteTopic': '🗑️',
}

// Hue per i chip colorati dei tool sulla toolstrip
export const TOOL_TINT: Record<string, string> = {
  Bash: 'var(--cl-ink)',
  Read: 'var(--cl-cyan)',
  Write: 'var(--cl-cyan)',
  Edit: 'var(--cl-violet)',
  Glob: 'var(--cl-ink-3)',
  Grep: 'var(--cl-ink-3)',
  Agent: 'var(--cl-accent)',
  Task: 'var(--cl-accent)',
  WebFetch: 'var(--cl-haiku)',
  WebSearch: 'var(--cl-haiku)',
  Skill: 'var(--cl-warn)',
}

export const MEMORY_TYPE_STYLE: Record<MemoryType, { badge: string; label: string }> = {
  user:      { badge: 'bg-blue-950/20 text-blue-400 border border-blue-700/40',     label: 'User' },
  feedback:  { badge: 'bg-amber-950/20 text-amber-400 border border-amber-700/40',  label: 'Feedback' },
  project:   { badge: 'bg-emerald-950/20 text-emerald-400 border border-emerald-700/40', label: 'Project' },
  reference: { badge: 'bg-violet-950/20 text-violet-400 border border-violet-700/40', label: 'Reference' },
}

export function parseMemoryFrontmatter(content: string): ParsedMemory | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return null
  const fm = match[1]
  const body = match[2].trim()
  const get = (key: string) => fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim() ?? ''
  const type = get('type') as MemoryType
  return { name: get('name'), description: get('description'), type, body }
}

export function isMemoryFile(input: Record<string, unknown>): boolean {
  const path = input.file_path as string | undefined
  if (!path) return false
  // Normalize backslashes so the check works on Windows paths too
  const normalized = path.replace(/\\/g, '/')
  return normalized.includes('/.claude/') && normalized.includes('/memory/')
}

export function resolveToolIcon(name: string, input: Record<string, unknown>): string {
  if ((name === 'Write' || name === 'Edit' || name === 'Read') && isMemoryFile(input)) return '🧠'
  return TOOL_ICON[name] ?? '🔧'
}

// Rimuove i prefissi riga "     1→" dall'output di Read
export function stripLineNumbers(text: string): string {
  return text.split('\n').map(line => {
    const m = line.match(/^\s*\d+→(.*)$/)
    return m ? m[1] : line
  }).join('\n')
}

// Estrae l'estensione per il chip lingua
export function fileExt(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? ''
}
