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
}

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference'
export type ParsedMemory = { name: string; description: string; type: MemoryType; body: string }

// Pre-processa l'array raw di messaggi:
// - I messaggi utente con soli tool_result vengono assorbiti nel messaggio assistant precedente
// - I tool_use vengono abbinati ai loro tool_result per toolUseId
export function buildProcessedMessages(messages: ChatMessage[]): ProcessedMessage[] {
  const result: ProcessedMessage[] = []

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]

    const isToolOnlyUserMsg =
      msg.role === 'user' &&
      msg.content.length > 0 &&
      msg.content.every(b => b.type === 'tool_result')
    if (isToolOnlyUserMsg) continue

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

    result.push({ msg, toolGroups })
  }

  return result
}

export const TOOL_ICON: Record<string, string> = {
  Read: '📖', Write: '✏️', Edit: '✏️', Bash: '⌨️', Glob: '📁',
  Grep: '🔍', Agent: '🤖', WebFetch: '🌐', WebSearch: '🔎', Task: '📋',
  Skill: '⚡',
  'memory:createTopic': '📝', 'memory:updateTopic': '📝', 'memory:deleteTopic': '🗑️',
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
  return path.includes('/.claude/') && path.includes('/memory/')
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
