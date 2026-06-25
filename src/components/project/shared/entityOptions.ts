import { CSSProperties } from 'react'
import type { Agent, Skill, MemoryTopic } from '../../../hooks/useIPC'

/* ════════════════════════════════════════════════════════════════════
   entityOptions — logica condivisa per le viste detail config-driven
   (estratta da AgentDetailViewV2). Option defs, serializzazione
   frontmatter con preservazione delle chiavi non gestite, helper UI.
   ════════════════════════════════════════════════════════════════════ */

/* ── agent.color → hue/chroma mapping (orb / pip / accents) ── */
const COLOR_MAP: Record<string, { h: number; c: number }> = {
  red:    { h: 25,  c: 0.18 },
  orange: { h: 40,  c: 0.16 },
  yellow: { h: 90,  c: 0.16 },
  green:  { h: 150, c: 0.16 },
  cyan:   { h: 200, c: 0.14 },
  blue:   { h: 250, c: 0.18 },
  purple: { h: 305, c: 0.18 },
  pink:   { h: 340, c: 0.16 },
}

/**
 * Restituisce le CSS vars per il tint dell'identità (orb/glyph/swatch).
 * `--agent-h`/`--agent-c` codificano hue+chroma del colore agent (usati dal
 * swatch `Color` della tape). `--ident-tint` è il colore d'identità risolto
 * dell'orb/glyph: il colore dell'agent quando presente, altrimenti l'accent
 * terracotta per le entità senza concetto di colore (skill, CLAUDE.md, memory,
 * plan). L'agent senza colore esplicito ricade sul green per preservare il look.
 */
export function entityTint(color?: string, opts?: { neutral?: boolean }): CSSProperties {
  const m = color ? COLOR_MAP[color.toLowerCase()] : undefined
  if (m) return { '--agent-h': String(m.h), '--agent-c': String(m.c), '--ident-tint': `oklch(0.62 ${m.c} ${m.h})` } as CSSProperties
  if (opts?.neutral) return { '--agent-h': '40', '--agent-c': '0', '--ident-tint': 'var(--cl-accent)' } as CSSProperties
  return { '--agent-h': String(COLOR_MAP.green.h), '--agent-c': String(COLOR_MAP.green.c), '--ident-tint': `oklch(0.62 ${COLOR_MAP.green.c} ${COLOR_MAP.green.h})` } as CSSProperties
}

/**
 * A single resolved oklch color string for a named agent color (for surfaces
 * that take one `--tint` value, e.g. the compact tool card). `undefined` when
 * the color is missing/unknown.
 */
export function agentTintColor(color?: string): string | undefined {
  const m = color ? COLOR_MAP[color.toLowerCase()] : undefined
  if (!m) return undefined
  return `oklch(0.62 ${m.c} ${m.h})`
}

export function initialOf(name: string) {
  return name.trim()[0]?.toUpperCase() ?? '?'
}

/* ════════════════════════════════════════════════════════════════════
   Option definitions
   ════════════════════════════════════════════════════════════════════ */
export type OptionValue = string | string[] | number | boolean | null

export type OptionDef = {
  /** Chiave nel modello entità + chiave di editState (es. 'allowedTools'). */
  key: string
  /** Etichetta mostrata nella griglia/righe (stile yaml-key). */
  label: string
  /** Chiave YAML emessa nel frontmatter (es. 'tools', 'allowed-tools'). */
  frontmatterKey: string
  blurb: string
  isArray?: boolean
  isBool?: boolean
  isNumber?: boolean
  /** Array di tool name: l'editor mostra l'autocomplete dei tool noti (input libero comunque consentito). */
  isTools?: boolean
  enum?: string[]
  /**
   * Campo obbligatorio: è sempre "set" (mai nelle "available options") e non
   * mostra il bottone di rimozione (✕) nell'editor. Usato per i campi
   * frontmatter richiesti, es. `type` di una memoria.
   */
  required?: boolean
}

export const AGENT_OPTION_DEFS: OptionDef[] = [
  { key: 'color',                  label: 'color',                     frontmatterKey: 'color',                   blurb: 'Accent color for the agent identity: red · orange · yellow · green · cyan · blue · purple · pink.', enum: ['green', 'red', 'orange', 'yellow', 'cyan', 'blue', 'purple', 'pink'] },
  { key: 'model',                  label: 'model',                     frontmatterKey: 'model',                   blurb: 'Model alias or full model ID. Omit to inherit from the current session.' },
  { key: 'allowedTools',           label: 'tools',                     frontmatterKey: 'tools',                   blurb: 'Tools the subagent can use. Inherits all if omitted.', isArray: true, isTools: true },
  { key: 'disallowedTools',        label: 'disallowedTools',           frontmatterKey: 'disallowedTools',         blurb: 'Tools to deny, removed from the inherited list.', isArray: true, isTools: true },
  { key: 'permissionMode',         label: 'permissionMode',            frontmatterKey: 'permissionMode',          blurb: 'default · acceptEdits · auto · dontAsk · bypassPermissions · plan', enum: ['default', 'acceptEdits', 'auto', 'dontAsk', 'bypassPermissions', 'plan'] },
  { key: 'maxTurns',               label: 'maxTurns',                  frontmatterKey: 'maxTurns',                blurb: 'Maximum agentic turns before the subagent stops.', isNumber: true },
  { key: 'isolation',              label: 'isolation',                 frontmatterKey: 'isolation',               blurb: 'Set to worktree to run in an isolated git worktree.', enum: ['worktree'] },
  { key: 'memory',                 label: 'memory',                    frontmatterKey: 'memory',                  blurb: 'Persistent memory scope: user · project · local.', enum: ['user', 'project', 'local'] },
  { key: 'skills',                 label: 'skills',                    frontmatterKey: 'skills',                  blurb: 'Skills preloaded at startup, full content injected.', isArray: true },
  { key: 'mcpServers',             label: 'mcpServers',                frontmatterKey: 'mcpServers',              blurb: 'MCP servers available to this subagent.', isArray: true },
  { key: 'effort',                 label: 'effort',                    frontmatterKey: 'effort',                  blurb: 'Effort level: low · medium · high · xhigh · max.', enum: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { key: 'background',             label: 'background',                frontmatterKey: 'background',              blurb: 'Always run this subagent as a background task.', isBool: true },
  { key: 'disableModelInvocation', label: 'disable_model_invocation',  frontmatterKey: 'disable_model_invocation', blurb: 'Hide this subagent from automatic invocation.', isBool: true },
]

export const SKILL_OPTION_DEFS: OptionDef[] = [
  { key: 'argumentHint',           label: 'argument-hint',            frontmatterKey: 'argument-hint',            blurb: 'Hint shown in autocomplete — e.g. [filename] [format].' },
  { key: 'allowedTools',           label: 'allowed-tools',            frontmatterKey: 'allowed-tools',            blurb: 'Tools Claude can use without requesting permission when the skill is active.', isArray: true, isTools: true },
  { key: 'model',                  label: 'model',                    frontmatterKey: 'model',                    blurb: 'Model to use when the skill is active — e.g. claude-sonnet-4-6.' },
  { key: 'context',                label: 'context',                  frontmatterKey: 'context',                  blurb: 'Set to fork to run in an isolated forked subagent.', enum: ['fork'] },
  { key: 'agent',                  label: 'agent',                    frontmatterKey: 'agent',                    blurb: 'Type of subagent to use when context: fork is set.' },
  { key: 'disableModelInvocation', label: 'disable-model-invocation', frontmatterKey: 'disable-model-invocation', blurb: 'If true, Claude does not load the skill automatically — must be invoked with /name.', isBool: true },
  { key: 'userInvocable',          label: 'user-invocable',           frontmatterKey: 'user-invocable',           blurb: 'If false, the skill is hidden from the / menu — used only as background knowledge.', isBool: true },
]

/**
 * Memory topic: l'unica opzione frontmatter strutturata è `type` (obbligatoria).
 * I *tag* di una memoria NON sono frontmatter — vivono nel managed-tag store
 * (`useMemoryTags`, vedi MemoryTopicView), quindi non compaiono qui.
 */
export const MEMORY_OPTION_DEFS: OptionDef[] = [
  { key: 'type', label: 'type', frontmatterKey: 'type', blurb: 'Memory type: user · feedback · project · reference.', enum: ['user', 'feedback', 'project', 'reference'], required: true },
]

/** Valore read-only per la griglia "Properties" del manifesto. */
export function optionValueOf(entity: Record<string, unknown>, def: OptionDef): string | null {
  const v = entity[def.key]
  if (v == null || v === '') return null
  if (def.isBool) return v ? 'enabled' : null
  if (def.isArray) {
    const arr = v as string[]
    return arr.length ? arr.join(', ') : null
  }
  return String(v)
}

/** Stato iniziale editabile letto dall'entità. */
export function readOption(entity: Record<string, unknown>, def: OptionDef): OptionValue {
  const v = entity[def.key]
  if (v == null) return null
  if (def.isArray) return Array.isArray(v) ? [...(v as string[])] : null
  if (def.isBool) return Boolean(v)
  if (def.isNumber) return typeof v === 'number' ? v : null
  return typeof v === 'string' ? v : null
}

export function readOptions(entity: Record<string, unknown>, defs: OptionDef[]): Record<string, OptionValue> {
  const out: Record<string, OptionValue> = {}
  for (const def of defs) out[def.key] = readOption(entity, def)
  return out
}

export function defaultFor(def: OptionDef): OptionValue {
  if (def.isArray) return []
  if (def.isBool) return true
  if (def.isNumber) return 0
  if (def.enum?.length) return def.enum[0]
  return ''
}

export function isOptionSet(v: OptionValue): boolean {
  return v !== null
}

export function optionsDirty(
  a: Record<string, OptionValue>,
  b: Record<string, OptionValue>,
  defs: OptionDef[]
): boolean {
  return defs.some(def => {
    const x = a[def.key]
    const y = b[def.key]
    if (Array.isArray(x) && Array.isArray(y)) {
      return x.length !== y.length || x.some((v, i) => v !== y[i])
    }
    return x !== y
  })
}

/* ════════════════════════════════════════════════════════════════════
   Serializzazione frontmatter — preserva le chiavi non gestite
   ════════════════════════════════════════════════════════════════════ */
function splitFrontmatter(raw: string): { fm: string | null; body: string } {
  const norm = (raw ?? '').replace(/\r\n/g, '\n')
  if (!norm.startsWith('---\n')) return { fm: null, body: norm }
  const lines = norm.split('\n')
  let close = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { close = i; break }
  }
  if (close === -1) return { fm: null, body: norm }
  const fm = lines.slice(1, close).join('\n')
  const body = lines.slice(close + 1).join('\n').replace(/^\n/, '')
  return { fm, body }
}

/** Estrae le entry top-level del frontmatter, conservando le righe grezze (per i map annidati come `hooks`). */
function parseFmEntries(fm: string): { key: string; lines: string[] }[] {
  const out: { key: string; lines: string[] }[] = []
  let cur: { key: string; lines: string[] } | null = null
  for (const line of fm.split('\n')) {
    const m = /^([A-Za-z0-9_-]+):/.exec(line)
    if (m && !/^\s/.test(line)) {
      cur = { key: m[1], lines: [line] }
      out.push(cur)
    } else if (cur) {
      cur.lines.push(line)
    }
  }
  return out
}

function emitOption(def: OptionDef, v: OptionValue): string | null {
  if (v == null) return null
  if (def.isBool) return `${def.frontmatterKey}: ${v ? 'true' : 'false'}`
  if (def.isArray) {
    const arr = v as string[]
    return arr.length ? `${def.frontmatterKey}: [${arr.join(', ')}]` : null
  }
  if (def.isNumber) return `${def.frontmatterKey}: ${v}`
  return v === '' ? null : `${def.frontmatterKey}: ${v}`
}

/**
 * Ricompone il markdown: fence + righe gestite (in ordine) + righe
 * preservate (chiavi YAML non modellate, es. `hooks`) + body.
 */
function serializeWithPreserved(
  rawContent: string,
  managedKeys: string[],
  emitted: string[],
  body: string
): string {
  const { fm } = splitFrontmatter(rawContent)
  const preserved: string[] = []
  if (fm) {
    for (const e of parseFmEntries(fm)) {
      if (!managedKeys.includes(e.key)) preserved.push(...e.lines)
    }
  }
  return ['---', ...emitted, ...preserved, '---', '', body].join('\n')
}

export function serializeAgent(
  agent: Agent,
  body: string,
  opts: { description: string; options: Record<string, OptionValue> }
): string {
  const emitted: string[] = [`name: ${agent.name}`]
  if (opts.description) emitted.push(`description: ${opts.description}`)
  for (const def of AGENT_OPTION_DEFS) {
    const line = emitOption(def, opts.options[def.key])
    if (line) emitted.push(line)
  }
  const managed = ['name', 'description', ...AGENT_OPTION_DEFS.map(d => d.frontmatterKey)]
  return serializeWithPreserved(agent.rawContent, managed, emitted, body)
}

export function serializeSkill(
  skill: Skill,
  body: string,
  opts: { description: string; options: Record<string, OptionValue> }
): string {
  const emitted: string[] = []
  if (opts.description) emitted.push(`description: ${opts.description}`)
  for (const def of SKILL_OPTION_DEFS) {
    const line = emitOption(def, opts.options[def.key])
    if (line) emitted.push(line)
  }
  const managed = ['description', ...SKILL_OPTION_DEFS.map(d => d.frontmatterKey)]
  return serializeWithPreserved(skill.rawContent, managed, emitted, body)
}

/**
 * Serializza una memoria in markdown grezzo (frontmatter + body). Il wrapper la
 * ri-passa a `parseTopicInput` → `updateTopic`, che la riscrive in forma
 * canonica via `memory-writer`; quindi qui basta emettere i campi che
 * `parseTopicInput` rilegge (name, description, type, originSessionId). `type`
 * è obbligatorio: se l'opzione è vuota si ricade sul valore corrente del topic.
 */
export function serializeMemory(
  topic: MemoryTopic,
  body: string,
  opts: { description: string; options: Record<string, OptionValue> }
): string {
  const type = typeof opts.options.type === 'string' && opts.options.type ? opts.options.type : topic.type
  const lines = ['---', `name: ${topic.name}`]
  if (opts.description) lines.push(`description: ${opts.description}`)
  lines.push(`type: ${type}`)
  if (topic.originSessionId) lines.push(`originSessionId: ${topic.originSessionId}`)
  lines.push('---', '', body)
  return lines.join('\n')
}

/* ════════════════════════════════════════════════════════════════════
   fluidTitleSize — titoli che possono essere frasi intere (plan)
   ════════════════════════════════════════════════════════════════════ */
export function fluidTitleSize(label: string): string {
  const len = label.length
  if (len <= 16) return 'clamp(54px, 8.5vw, 120px)'
  if (len <= 28) return 'clamp(46px, 6.5vw, 88px)'
  if (len <= 44) return 'clamp(38px, 5vw, 64px)'
  if (len <= 64) return 'clamp(30px, 4vw, 50px)'
  return 'clamp(26px, 3.2vw, 40px)'
}
