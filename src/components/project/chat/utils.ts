import { ChatMessage, ChatContentBlock, SubagentMeta, Skill, InstalledPlugin } from '../../../hooks/useIPC'

export type ChatDetailsFilter = 'all' | 'minimal'

// Una coppia tool_use + tool_result abbinati per id
export type ToolGroup = {
  use: Extract<ChatContentBlock, { type: 'tool_use' }>
  result: Extract<ChatContentBlock, { type: 'tool_result' }> | null
}

// Automatic harness notification emitted when a background task/agent completes.
export type TaskNotification = {
  taskId: string
  toolUseId?: string
  /** 'completed' | 'failed' | 'error' | other raw status */
  status: string
  summary: string
  result?: string
  /** Subagent metrics — present only for Task/Agent notifications. */
  usage?: TaskNotificationUsage
}

export type TaskNotificationUsage = {
  tokens?: number
  toolUses?: number
  durationMs?: number
}

// Messaggio processato: i tool_result del messaggio utente successivo vengono abbinati qui
export type ProcessedMessage = {
  msg: ChatMessage
  toolGroups: ToolGroup[]   // solo per messaggi assistant con tool_use
  command?: ClaudeSlashCommand  // se il messaggio è un Claude Code command (XML tag flow)
  notification?: TaskNotification  // set when the message is a harness task-notification
}

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference'
export type ParsedMemory = { name: string; description: string; type: MemoryType; body: string }
export type ClaudeSlashCommand = {
  command: string
  args: string
  description: string
  output?: string
  /** True when this slash command is actually a Skill invocation — detected by
   *  the skill-expansion message Claude Code injects right after ("Base directory
   *  for this skill: …"). Skills are surfaced as first-class cards, not plain
   *  `/commands`. */
  isSkill?: boolean
}

// Claude Code injects this as the first line of the user message that follows a
// skill slash command — the skill's expanded prompt. It's the most reliable
// signal that `/foo` is a Skill (works for project, global, and plugin skills,
// none of which we'd otherwise be able to tell apart from a built-in command).
const SKILL_EXPANSION_RE = /^\s*Base directory for this skill:/i

function firstText(m: ChatMessage): string {
  const t = m.content.find(b => b.type === 'text') as Extract<ChatContentBlock, { type: 'text' }> | undefined
  return t?.text ?? ''
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
  exit: 'End the current session',
  help: 'Get usage help',
  init: 'Initialize project guidance',
  login: 'Switch Anthropic accounts',
  logout: 'Sign out from Anthropic',
  mcp: 'Manage MCP server connections',
  memory: 'Edit CLAUDE.md memory files',
  model: 'Select or change the AI model',
  permissions: 'View or update permissions',
  pr_comments: 'View pull request comments',
  quit: 'End the current session',
  resume: 'Resume a previous conversation',
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

  // Mappa globale toolUseId → tool_result, costruita su tutta la sessione.
  // Necessaria perché Claude Code, con tool/agenti paralleli, scrive ogni
  // tool_use su una riga assistant separata e ogni tool_result su una riga user
  // separata, spesso in ordine non corrispondente. Abbinare guardando solo il
  // messaggio immediatamente successivo fallirebbe (vedi #parallel-agents).
  const resultsById = new Map<string, Extract<ChatContentBlock, { type: 'tool_result' }>>()
  for (const m of messages) {
    for (const b of m.content) {
      if (b.type === 'tool_result' && !resultsById.has(b.toolUseId)) {
        resultsById.set(b.toolUseId, b as Extract<ChatContentBlock, { type: 'tool_result' }>)
      }
    }
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]

    const isToolOnlyUserMsg =
      msg.role === 'user' &&
      msg.content.length > 0 &&
      msg.content.every(b => b.type === 'tool_result')
    if (isToolOnlyUserMsg) continue

    // task-notification: harness event for a completed background task/agent
    if (msg.role === 'user') {
      const onlyText = msg.content.length === 1 && msg.content[0].type === 'text'
        ? (msg.content[0] as Extract<ChatContentBlock, { type: 'text' }>).text
        : null
      if (onlyText) {
        const notification = parseTaskNotification(onlyText)
        if (notification) {
          result.push({ msg, toolGroups: [], notification })
          continue
        }
      }
    }

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
      const text = msg.content.find(b => b.type === 'text') as Extract<ChatContentBlock, { type: 'text' }> | undefined
      if (text) {
        command = parseClaudeSlashCommand(text.text) ?? undefined
        // A skill invocation is a slash command immediately followed by Claude
        // Code's skill-expansion message — peek the next raw message to tell a
        // skill apart from a plain built-in command.
        if (command && i + 1 < messages.length && SKILL_EXPANSION_RE.test(firstText(messages[i + 1]))) {
          command.isSkill = true
        }
      }
    }

    const toolUseBlocks = msg.content.filter(
      b => b.type === 'tool_use'
    ) as Extract<ChatContentBlock, { type: 'tool_use' }>[]

    let toolGroups: ToolGroup[] = []
    if (toolUseBlocks.length > 0) {
      toolGroups = toolUseBlocks.map(use => ({
        use,
        result: resultsById.get(use.id) ?? null,
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
  // 1. XML flow di Claude Code — il nome può essere namespaced (`plugin:skill`),
  // quindi la classe include `:` (senza, le skill di plugin non venivano
  // riconosciute e il tag XML grezzo trapelava nella chat).
  const cmdMatch = text.match(/<command-name>\s*\/?([a-z][a-z0-9_:-]*)\s*<\/command-name>/i)
  if (cmdMatch) {
    const command = cmdMatch[1].toLowerCase()
    // Il framing XML <command-name> è inequivocabile: trattalo sempre come comando,
    // anche se non è nella lista nota — così il testo grezzo non trapela mai nella chat.
    const description = CLAUDE_BUILTIN_SLASH_COMMANDS[command] ?? 'Claude Code command'

    const argsMatch = text.match(/<command-args>([\s\S]*?)<\/command-args>/i)
    const args = argsMatch?.[1].trim() ?? ''
    return { command, args, description }
  }

  // 2. Formato testuale plain "/cmd" — senza il framing XML è ambiguo: una frase
  // utente come "/clear the cache" o "/help me debug" inizia con uno slash ma NON
  // è un comando. Trattalo come comando solo se è il bare "/cmd" senza testo a
  // seguire (gli args reali arrivano sempre dal flow XML <command-args>). (#92)
  const trimmed = text.trim()
  const match = trimmed.match(/^\/([a-z][a-z0-9_:-]*)$/)
  if (!match) return null

  const command = match[1]
  const description = CLAUDE_BUILTIN_SLASH_COMMANDS[command]
  if (!description) return null

  return {
    command,
    args: '',
    description,
  }
}

// Extract the fields of a harness <task-notification>. Handles both the bare
// form and the variant prefixed with [SYSTEM NOTIFICATION...].
export function parseTaskNotification(text: string): TaskNotification | null {
  if (!/<task-notification[\s>]/i.test(text)) return null
  const inner = text.match(/<task-notification>([\s\S]*?)<\/task-notification>/i)?.[1]
  if (!inner) return null
  const get = (tag: string) =>
    inner.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1]?.trim() ?? ''
  const summary = get('summary')
  const taskId = get('task-id')
  if (!summary && !taskId) return null

  // <usage><subagent_tokens>…</subagent_tokens><tool_uses>…</tool_uses><duration_ms>…</duration_ms></usage>
  let usage: TaskNotificationUsage | undefined
  const usageRaw = inner.match(/<usage>([\s\S]*?)<\/usage>/i)?.[1]
  if (usageRaw) {
    const num = (tag: string) => {
      const v = usageRaw.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1]?.trim()
      const n = v != null ? Number(v) : NaN
      return Number.isFinite(n) ? n : undefined
    }
    const tokens = num('subagent_tokens')
    const toolUses = num('tool_uses')
    const durationMs = num('duration_ms')
    if (tokens != null || toolUses != null || durationMs != null) {
      usage = { tokens, toolUses, durationMs }
    }
  }

  return {
    taskId,
    toolUseId: get('tool-use-id') || undefined,
    status: get('status') || 'completed',
    summary,
    result: get('result') || undefined,
    usage,
  }
}

// Estrae il contenuto del tag <local-command-stdout>...</local-command-stdout>
// e rimuove gli escape ANSI. Ritorna null se non è puro stdout.
export function parseLocalCommandOutput(text: string): string | null {
  const match = text.match(/^\s*<local-command-stdout>([\s\S]*)<\/local-command-stdout>\s*$/i)
  if (!match) return null
  const out = stripAnsi(match[1]).trim()
  // "(no content)" è il placeholder di Claude Code per stdout vuoto: normalizzalo a stringa vuota
  return out === '(no content)' ? '' : out
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

// L'utente ha chiuso AskUserQuestion SENZA rispondere (ha chiesto di chiarire /
// ha continuato a parlare). Claude Code emette un tool_result di rejection con
// "The tool use was rejected" e "(No answer provided)" per ogni domanda. In quel
// caso il result è presente ma non c'è nessuna risposta da parsare: va distinto
// sia da "answered" che da "pending".
export function isQuestionDismissed(text: string): boolean {
  if (!text) return false
  return /tool use was rejected/i.test(text) || /no answer provided/i.test(text)
}

// ──────────────────────────────────────────────────────────────────────────
// Turn role resolution — single source of truth shared by MessageBubble
// (rendering) and ChatView (navigation minimap + type filters). Mirrors the
// "Direction A — editorial transcript" prototype: one identity per turn.
// ──────────────────────────────────────────────────────────────────────────
export const AGENT_TOOLS = new Set(['Agent', 'Task'])
export const PLAN_TOOLS = new Set(['EnterPlanMode', 'ExitPlanMode'])
export const QUESTION_TOOL = 'AskUserQuestion'
// A skill invoked agentically — the model calls the `Skill` tool (distinct from a
// `/foo` slash-command skill, which arrives as a `command` flagged `isSkill`).
export const SKILL_TOOL = 'Skill'

export type TurnVariant = 'user' | 'claude' | 'agent' | 'command' | 'skill' | 'question' | 'plan' | 'notification'

/** First-letter monogram for a skill, mirroring the agent orb rule (no icons,
 *  just the initial). Strips a `plugin:` namespace so `document-skills:pdf` → "P". */
export function skillInitial(command: string): string {
  const seg = command.includes(':') ? command.split(':').pop()! : command
  return (seg.match(/[A-Za-z]/)?.[0] ?? 'S').toUpperCase()
}

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
  hasPlan: boolean
  /** True when the turn invokes an agentic skill (a `Skill` tool_use). */
  hasSkill: boolean
  /** True when MessageBubble would render something for this turn+filter. */
  visible: boolean
  /** Minimal mode only: the turn renders solely as a collapsed "tools hidden"
   *  badge (no text / thinking / agent / question), so it isn't a real message
   *  turn — the navigation rail skips it even though it stays `visible`. */
  toolsOnly: boolean
}

const ROLE_META: Record<TurnVariant, { label: string; initial: string; color: string }> = {
  user:         { label: 'You',        initial: 'U', color: 'var(--cl-ink)' },
  claude:       { label: 'Claude',     initial: 'C', color: 'var(--cl-accent)' },
  // An agent dispatch is still a Claude turn — the "A" identity lives inside the
  // dispatch card, so the rail orb shows "C". The color is the dispatched agent's
  // own identity tint (resolved in MessageBubble); accent is the unconfigured default.
  agent:        { label: 'Agent',      initial: 'C', color: 'var(--cl-accent)' },
  command:      { label: 'Command',    initial: '/', color: 'var(--cl-accent)' },
  // A skill turn wears the brand accent and a first-letter orb (resolved below
  // from the skill name); the static initial here is just a fallback.
  skill:        { label: 'Skill',      initial: 'S', color: 'var(--cl-accent)' },
  question:     { label: 'Question',   initial: '?', color: 'var(--cl-warn)' },
  plan:         { label: 'Plan',       initial: 'P', color: 'var(--cl-accent)' },
  notification: { label: 'Task event', initial: 'T', color: 'var(--cl-ink-3)' },
}

/** Resolves a dispatched sub-agent's identity tint (final color string) from its
 *  `subagent_type`; returns undefined to fall back to the variant default. */
export type AgentColorResolver = (subagentType: string) => string | undefined

export function describeTurn(
  p: ProcessedMessage,
  detailsFilter: ChatDetailsFilter,
  agentColor?: AgentColorResolver
): TurnDescriptor {
  // Task-notification: always visible as a compact variant, regardless of the filter.
  if (p.notification) {
    return {
      variant: 'notification',
      label: ROLE_META.notification.label,
      initial: ROLE_META.notification.initial,
      color: ROLE_META.notification.color,
      hasText: false, hasThinking: false, hasTools: false,
      hasQuestion: false, hasAgent: false, hasPlan: false, hasSkill: false,
      visible: true,
      toolsOnly: false,
    }
  }

  const { msg, toolGroups, command } = p
  const isUser = msg.role === 'user'

  const textBlocks = msg.content.filter(b => b.type === 'text') as Extract<ChatContentBlock, { type: 'text' }>[]
  const thinkingBlocks = msg.content.filter(b => b.type === 'thinking') as Extract<ChatContentBlock, { type: 'thinking' }>[]
  const agentGroups = toolGroups.filter(g => AGENT_TOOLS.has(g.use.name))
  const planGroups = toolGroups.filter(g => PLAN_TOOLS.has(g.use.name))
  const skillGroups = toolGroups.filter(g => g.use.name === SKILL_TOOL)
  const questionGroups = toolGroups.filter(g => g.use.name === QUESTION_TOOL)
  const standardToolGroups = toolGroups.filter(g => g.use.name !== QUESTION_TOOL)

  const showThinking = detailsFilter === 'all'
  const showTools = detailsFilter === 'all'
  const showAgentStrip = detailsFilter === 'minimal' && agentGroups.length > 0
  // Plan-mode tools carry the proposed/approved plan — surface them in minimal
  // as a dedicated strip, mirroring the agent strip (full mode keeps the raw card).
  const showPlanStrip = detailsFilter === 'minimal' && planGroups.length > 0
  // Agentic skills are first-class work units (like agents): surface them in
  // minimal as a dedicated strip instead of hiding them as generic tools.
  const showSkillStrip = detailsFilter === 'minimal' && skillGroups.length > 0
  const showQuestions = questionGroups.length > 0

  const hasText = textBlocks.length > 0
  const hasThinking = thinkingBlocks.some(b => b.thinking)
  const hasTools = standardToolGroups.length > 0
  const hasQuestion = showQuestions
  const hasAgent = agentGroups.length > 0
  const hasPlan = planGroups.length > 0
  const hasSkill = skillGroups.length > 0

  const hasVisibleContent =
    hasText ||
    (showThinking && hasThinking) ||
    (showTools && hasTools) ||
    showAgentStrip ||
    showPlanStrip ||
    showSkillStrip ||
    showQuestions
  // Minimal mode collapses a tool-only turn into a single badge; it's not a
  // standalone message, so the minimap skips it — but it still counts as visible.
  const toolsOnly = !hasVisibleContent && !showTools && hasTools
  const visible = hasVisibleContent || toolsOnly

  const isAgentTurn = showAgentStrip && textBlocks.length === 0
  const isQuestionTurn =
    showQuestions && textBlocks.length === 0 && !showAgentStrip && (!showTools || standardToolGroups.length === 0)
  const isPlanTurn =
    showPlanStrip && textBlocks.length === 0 && !showAgentStrip && !showQuestions
  const isCommandTurn = !!command
  const isSkillTurn = !!command?.isSkill
  // An agentic skill standing on its own (no prose) owns the turn identity, the
  // way an agent dispatch does — same 'skill' variant as a slash-command skill.
  const isSkillToolTurn =
    showSkillStrip && textBlocks.length === 0 && !showAgentStrip && !showQuestions && !showPlanStrip && !isCommandTurn

  const variant: TurnVariant =
    isCommandTurn ? (isSkillTurn ? 'skill' : 'command')
    : isQuestionTurn ? 'question'
    : isAgentTurn ? 'agent'
    : isPlanTurn ? 'plan'
    : isSkillToolTurn ? 'skill'
    : isUser ? 'user'
    : 'claude'

  // Agent turns wear the dispatched sub-agent's identity color (resolved by the
  // caller, who knows the agent registry); accent is the unconfigured default.
  const meta = ROLE_META[variant]
  const color =
    variant === 'agent'
      ? agentColor?.((agentGroups[0]?.use.input as Record<string, unknown>)?.subagent_type as string) ?? meta.color
      : meta.color
  // Skill turns wear a first-letter orb (same rule as agents — no icons). The
  // name comes from the command for a slash-command skill, else from the `Skill`
  // tool's `skill` input for an agentic one.
  const initial =
    variant === 'skill'
      ? skillInitial(
          command
            ? command.command
            : String((skillGroups[0]?.use.input as Record<string, unknown>)?.skill ?? 'skill')
        )
      : meta.initial

  return { variant, label: meta.label, initial, color, hasText, hasThinking, hasTools, hasQuestion, hasAgent, hasPlan, hasSkill, visible, toolsOnly }
}

// ──────────────────────────────────────────────────────────────────────────
// Sub-agent correlation — links each Task/Agent dispatch in the transcript to
// its internal transcript file (`subagents/agent-*.jsonl`). The subagent file
// carries no readable type (only a codename `slug`), so the human name comes
// from the parent dispatch's `subagent_type`; the link is by prompt prefix
// (the subagent's first user message IS the dispatch prompt). 100% reliable on
// the observed corpus. Both lists are chronological, so we consume metas in
// order to disambiguate identical prompts dispatched more than once.
// ──────────────────────────────────────────────────────────────────────────
export type SessionAgent = {
  /** Stable key (turn + group index). */
  key: string
  /** 1-based turn index of the dispatch — used to jump/scroll to its card. */
  turnN: number
  subagentType: string
  description: string
  prompt: string
  isError: boolean
  /** Correlated transcript metadata, when the subagent file exists. */
  agentId: string | null
  startedAt?: string
  endedAt?: string
  messageCount?: number
}

const AGENT_PROMPT_PREFIX = 100
function promptKey(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, AGENT_PROMPT_PREFIX)
}

export function correlateSessionAgents(
  processed: ProcessedMessage[],
  metas: SubagentMeta[],
): SessionAgent[] {
  const pool = metas.map(m => ({ m, used: false }))
  const agents: SessionAgent[] = []

  processed.forEach((p, idx) => {
    p.toolGroups.forEach((g, gi) => {
      if (!AGENT_TOOLS.has(g.use.name)) return
      const input = g.use.input as Record<string, unknown>
      const subagentType =
        (input.subagent_type as string) || (input.subagentType as string) || 'general-purpose'
      const description = (input.description as string) || ''
      const prompt = (input.prompt as string) || ''
      const pk = promptKey(prompt)

      let match: SubagentMeta | null = null
      if (pk) {
        const entry = pool.find(e => !e.used && promptKey(e.m.firstPrompt) === pk)
        if (entry) {
          entry.used = true
          match = entry.m
        }
      }

      agents.push({
        key: `${idx + 1}-${gi}`,
        turnN: idx + 1,
        subagentType,
        description,
        prompt,
        isError: g.result?.isError ?? false,
        agentId: match?.agentId ?? null,
        startedAt: match?.startedAt,
        endedAt: match?.endedAt,
        messageCount: match?.messageCount,
      })
    })
  })

  return agents
}

// ──────────────────────────────────────────────────────────────────────────
// Skill correlation — collects every skill invoked in the session (slash
// commands flagged `isSkill`, plus agentic `Skill` tool_uses) and links each to
// its definition, so the footer dock / Mission Control rail can list them and
// deep-link to the skill detail. Plain names resolve against the project/global
// registry; a namespaced `plugin:leaf` name (e.g. `document-skills:pdf`) resolves
// against the installed plugins. Unresolvable names keep `skill: null`.
// ──────────────────────────────────────────────────────────────────────────
export type SessionSkill = {
  /** Stable key (turn index). */
  key: string
  /** 1-based turn index of the invocation — used to jump/scroll to its card. */
  turnN: number
  /** Display id (the slash-command name, e.g. `build-dmg`). */
  name: string
  /** Args typed after a `/foo <args>` slash-command skill; absent for agentic ones. */
  args?: string
  description: string
  scope?: 'global' | 'project' | 'plugin'
  /** Resolved skill definition, when one matches by name; null otherwise. */
  skill: Skill | null
  /** Set for an agentic skill (a `Skill` tool_use): the tool group, so the dock
   *  and the minimal strip can open the output it produced (the tool_result).
   *  Absent for a slash-command skill, whose output is the inline turn that
   *  follows (no discrete artifact — those deep-link to the definition instead). */
  group?: ToolGroup
}

/** True when a `Skill` tool_result carries no real artifact — the skill merely
 *  "launched" (its instructions were injected; the actual work is the turns that
 *  follow, not the tool_result). Observed sentinel: `Launching skill: <name>`. */
export function isSkillLaunchOutput(content: string | null | undefined): boolean {
  return !!content && /^\s*Launching skill:/i.test(content)
}

/** True when an agentic skill's tool_result is worth opening on its own: a real
 *  completed result (`Skill "…" completed … Result: …`) or an error — but NOT a
 *  bare "Launching skill: …" (nothing to show) nor a still-pending run. Lets the
 *  rail/dock route a "launch-only" skill to its definition instead of an empty page. */
export function skillHasViewableOutput(group: ToolGroup | undefined): boolean {
  const content = group?.result?.content
  if (!content) return false
  if (group?.result?.isError) return true
  return !isSkillLaunchOutput(content)
}

export function correlateSessionSkills(
  processed: ProcessedMessage[],
  skills: Skill[],
  plugins: InstalledPlugin[] = [],
): SessionSkill[] {
  const byName = new Map(skills.map(s => [s.name, s]))
  // Plugin skills are invoked namespaced — `${plugin.name}:${skill.name}` (e.g.
  // `document-skills:pdf`) — so they never match a plain registry name; resolve
  // them against the installed plugins instead.
  const byNamespaced = new Map<string, Skill>()
  for (const pl of plugins) for (const s of pl.skills) byNamespaced.set(`${pl.name}:${s.name}`, s)
  const resolve = (name: string): Skill | null => byName.get(name) ?? byNamespaced.get(name) ?? null

  const out: SessionSkill[] = []
  processed.forEach((p, idx) => {
    // Slash-command skill (`/foo`): output is the inline turn that follows.
    const c = p.command
    if (c) {
      const skill = resolve(c.command)
      if (c.isSkill || skill) {
        out.push({
          key: `skill-${idx + 1}`,
          turnN: idx + 1,
          name: c.command,
          args: c.args || undefined,
          description: skill?.description ?? (c.description !== 'Claude Code command' ? c.description : ''),
          scope: skill?.scope,
          skill,
        })
      }
    }
    // Agentic skill (a `Skill` tool_use): its output lives in the tool_result.
    p.toolGroups.forEach((g, gi) => {
      if (g.use.name !== SKILL_TOOL) return
      const name = String((g.use.input as Record<string, unknown>).skill ?? 'skill')
      const skill = resolve(name)
      out.push({
        key: `skill-${idx + 1}-${gi}`,
        turnN: idx + 1,
        name,
        description: skill?.description ?? '',
        scope: skill?.scope,
        skill,
        group: g,
      })
    })
  })
  return out
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

/** Letter-monogram glyph for a tool (ClaudeLens icon language — no emoji). Takes
 *  the first letter of the tool name, or of the segment after a `namespace:`
 *  prefix (e.g. `memory:createTopic` → `C`); falls back to `#`. */
export function toolMonogram(name: string): string {
  const seg = name.includes(':') ? name.split(':').pop()! : name
  return (seg.match(/[A-Za-z]/)?.[0] ?? '#').toUpperCase()
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

// Tool che operano su un singolo file su disco: ne estraiamo il path per i chip
// file mostrati nell'header minimal ("tools hidden" → quali file ha toccato).
const FILE_PATH_TOOLS = new Set(['Read', 'Write', 'Edit', 'NotebookEdit'])

/** Path del file su cui ha agito un tool, se è un tool file-oriented; altrimenti null. */
export function toolFilePath(name: string, input: Record<string, unknown>): string | null {
  if (!FILE_PATH_TOOLS.has(name)) return null
  const p = input.file_path ?? input.notebook_path
  return typeof p === 'string' && p ? p : null
}

export type TouchedFile = { path: string; ext: string }

/** Raccoglie i file toccati da un insieme di tool group, in ordine, deduplicati per path. */
export function touchedFiles(groups: ToolGroup[]): TouchedFile[] {
  const seen = new Set<string>()
  const out: TouchedFile[] = []
  for (const g of groups) {
    const p = toolFilePath(g.use.name, g.use.input as Record<string, unknown>)
    if (p && !seen.has(p)) {
      seen.add(p)
      out.push({ path: p, ext: fileExt(p) })
    }
  }
  return out
}

// Categoria d'estensione → tinta del chip file (riusa i token --cl-* esistenti,
// stessa famiglia cromatica del resto della chat: nessuna nuova tinta).
const FILE_CAT_BY_EXT: Record<string, 'code' | 'data' | 'web' | 'doc'> = {
  ts: 'code', tsx: 'code', js: 'code', jsx: 'code', mjs: 'code', cjs: 'code',
  py: 'code', go: 'code', rs: 'code', java: 'code', c: 'code', cc: 'code',
  cpp: 'code', h: 'code', hpp: 'code', rb: 'code', php: 'code', swift: 'code',
  kt: 'code', sh: 'code', bash: 'code', zsh: 'code', lua: 'code', ipynb: 'code',
  json: 'data', csv: 'data', tsv: 'data', xlsx: 'data', xls: 'data', sql: 'data',
  yaml: 'data', yml: 'data', toml: 'data', parquet: 'data', xml: 'data', env: 'data',
  html: 'web', htm: 'web', css: 'web', scss: 'web', sass: 'web', less: 'web', svg: 'web',
  md: 'doc', mdx: 'doc', txt: 'doc', pdf: 'doc', docx: 'doc', rst: 'doc',
}

export function fileCategoryTint(ext: string): string {
  switch (FILE_CAT_BY_EXT[ext]) {
    case 'code': return 'var(--cl-violet)'
    case 'data': return 'var(--cl-cyan)'
    case 'web': return 'var(--cl-haiku)'
    case 'doc': return 'var(--cl-accent)'
    default: return 'var(--cl-ink-3)'
  }
}
