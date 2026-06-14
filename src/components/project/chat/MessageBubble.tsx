import { memo, useState } from 'react'
import type { CSSProperties, Ref } from 'react'
import Markdown from '../../Markdown'
import { ChatContentBlock, Skill, Agent } from '../../../hooks/useIPC'
import { ProcessedMessage, ToolGroup, ChatDetailsFilter, ClaudeSlashCommand, parseAskUserQuestions, parseAnswersFromResultText, isQuestionDismissed, describeTurn, touchedFiles, fileCategoryTint, TouchedFile, skillInitial, AGENT_TOOLS, PLAN_TOOLS, QUESTION_TOOL, SKILL_TOOL } from './utils'
import { fmtModel, modelColor } from '../utils'
import { agentTintColor } from '../shared/entityOptions'
import { ToolGroupCard } from './ToolGroupCard'
import { FileIcon } from './fileIcons'

/** AskUserQuestion card: surfaces the prompts and chosen answers, always visible. */
function AskQuestionCard({ group }: { group: ToolGroup }) {
  const questions = parseAskUserQuestions(group.use.input as Record<string, unknown>)
  if (questions.length === 0) return null
  const resultText = group.result?.content ?? ''
  const answers = group.result ? parseAnswersFromResultText(resultText) : {}
  const pending = !group.result
  // L'utente ha chiuso la domanda senza rispondere (clarify / continua a parlare):
  // il result esiste ma è una rejection, non ci sono risposte da evidenziare.
  const dismissed = !pending && Object.keys(answers).length === 0 && isQuestionDismissed(resultText)

  return (
    <div className="cl-ask-card">
      <div className="cl-ask-card-kicker">
        <span className="cl-ask-card-ic">?</span>
        <span className="lbl">Question asked</span>
        <span
          className="cl-ask-card-status"
          data-pending={pending || undefined}
          data-dismissed={dismissed || undefined}
        >
          {pending ? 'Waiting for reply' : dismissed ? 'No answer · kept talking' : 'Answered'}
        </span>
      </div>
      {questions.map((q, i) => {
        const chosen = answers[q.question]
        return (
          <div key={i} className="cl-ask-card-q" data-dismissed={dismissed || undefined}>
            <div className="cl-ask-card-question">{q.question}</div>
            <div className="cl-ask-card-options">
              {q.options.map((opt, j) => {
                const selected = chosen ? opt.label === chosen : false
                return (
                  <div
                    key={j}
                    className="cl-ask-card-option"
                    data-selected={selected || undefined}
                  >
                    <span className="cl-ask-card-option-label">{opt.label}</span>
                    {opt.description && <span className="cl-ask-card-option-desc">{opt.description}</span>}
                  </div>
                )
              })}
            </div>
            {dismissed && (
              <div className="cl-ask-card-custom cl-ask-card-custom--dismissed">
                No answer provided — the user replied without picking an option.
              </div>
            )}
            {chosen && !q.options.some(o => o.label === chosen) && (
              <div className="cl-ask-card-custom">Reply: <b>{chosen}</b></div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function ThinkingBlock({ thinking }: { thinking: string }) {
  const [open, setOpen] = useState(false)
  if (!thinking) return null
  return (
    <div className="cl-thinking">
      <button type="button" onClick={() => setOpen(o => !o)} className="cl-thinking-toggle" aria-label={`Thinking — ${open ? 'collapse' : 'expand'} content`} aria-expanded={open}>
        <span className="tw">Thinking</span>
        <svg className="caret" width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M3 1.5L6 4.5L3 7.5" />
        </svg>
        <b>{open ? 'Hide' : 'Show'}</b>
      </button>
      {open && (
        <pre className="cl-thinking-body">{thinking}</pre>
      )}
    </div>
  )
}

/** Plan-mode milestone rendered as an editorial card. EnterPlanMode is a bare
 *  marker; ExitPlanMode carries the proposed plan (title + snippet), click → detail. */
function PlanCard({ group, onOpen }: { group: ToolGroup; onOpen: () => void }) {
  const input = group.use.input as Record<string, unknown>
  const isExit = group.use.name === 'ExitPlanMode'
  const planText = typeof input.plan === 'string' ? input.plan : ''
  const titleMatch = planText.match(/^#+\s*(.+)$/m)
  const title = titleMatch ? titleMatch[1].trim() : 'Plan presented'
  const snippet = planText.replace(/^#+\s*.+$/m, '').replace(/\s+/g, ' ').trim().slice(0, 280)

  return (
    <button type="button" className="cl-plan-card" onClick={onOpen} title="View plan detail">
      <span className="top">
        <span className="ic">P</span>
        <span className="lbl">{isExit ? 'Plan' : 'Plan mode'}</span>
        {isExit && <span className="chip">presented</span>}
      </span>
      {isExit ? (
        <>
          <span className="title">{title}</span>
          {snippet && <span className="snippet">{snippet}</span>}
        </>
      ) : (
        <span className="desc">Claude entered plan mode to design an approach before editing.</span>
      )}
    </button>
  )
}

function SlashCommandCard({ command, timestamp }: { command: ClaudeSlashCommand; timestamp?: string }) {
  const [open, setOpen] = useState(false)
  // Nascondi args se è solo l'echo del command name (es. <command-message>model</command-message> per /model)
  const showArgs = command.args && command.args !== command.command
  const hasExpandable = !!(showArgs || command.output)
  const status = hasExpandable ? (open ? '▾' : '→') : ''

  return (
    <div
      className={`cl-command-card${open ? ' is-open' : ''}`}
      style={{ '--tint': 'var(--cl-accent)' } as CSSProperties}
    >
      <div className="cl-command-card-row">
        <button
          type="button"
          onClick={() => hasExpandable && setOpen(o => !o)}
          className={`cl-command-card-main${!hasExpandable ? ' is-static' : ''}`}
          aria-expanded={hasExpandable ? open : undefined}
        >
          <span className="cl-command-mono">/</span>
          <span className="cl-command-id">
            <span className="cl-command-name">/{command.command}</span>
            {command.description && (
              <span className="cl-command-preview">{command.description}</span>
            )}
          </span>
          <span className="cl-command-right">
            {timestamp && <time className="cl-command-time">{timestamp}</time>}
            {status && <span className="cl-command-status">{status}</span>}
          </span>
        </button>
      </div>
      {open && (
        <div className="cl-command-expanded">
          {showArgs && (
            <div className="cl-command-section">
              <div className="cl-command-section-title">Args</div>
              <pre>{command.args}</pre>
            </div>
          )}
          {command.output && (
            <div className="cl-command-section">
              <div className="cl-command-section-title">Output</div>
              <pre>{command.output}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Inline card for a Skill invocation — a first-class sibling of SlashCommandCard
 *  with a first-letter orb (no icon), the skill description, and an expandable
 *  body surfacing the skill's definition (scope / model / tools / arguments) plus
 *  a "View skill →" deep link. The link only shows once the card is expanded. */
function SkillCommandCard({ command, timestamp, skill, onOpenSkill }: {
  command: ClaudeSlashCommand
  timestamp?: string
  skill?: Skill
  onOpenSkill?: (skill: Skill) => void
}) {
  const [open, setOpen] = useState(false)
  const desc = skill?.description ?? (command.description !== 'Claude Code command' ? command.description : '')
  const showArgs = command.args && command.args !== command.command
  const metaRows: [string, string][] = []
  if (skill?.scope) metaRows.push(['Scope', skill.scope])
  if (skill?.model) metaRows.push(['Model', skill.model])
  if (skill?.argumentHint) metaRows.push(['Arguments', skill.argumentHint])
  if (skill?.allowedTools?.length) metaRows.push(['Tools', skill.allowedTools.join(', ')])
  const canOpen = !!(skill && onOpenSkill)
  const hasExpandable = metaRows.length > 0 || !!showArgs || !!command.output || canOpen
  const status = hasExpandable ? (open ? '▾' : '→') : ''

  return (
    <div
      className={`cl-command-card cl-skill-card${open ? ' is-open' : ''}`}
      style={{ '--tint': 'var(--cl-accent)' } as CSSProperties}
    >
      <div className="cl-command-card-row">
        <button
          type="button"
          onClick={() => hasExpandable && setOpen(o => !o)}
          className={`cl-command-card-main${!hasExpandable ? ' is-static' : ''}`}
          aria-expanded={hasExpandable ? open : undefined}
        >
          <span className="cl-command-mono" aria-hidden>{skillInitial(command.command)}</span>
          <span className="cl-command-id">
            <span className="cl-command-name">
              <span className="cl-skill-tag">Skill</span>
              /{command.command}
            </span>
            {desc && <span className="cl-command-preview">{desc}</span>}
          </span>
          <span className="cl-command-right">
            {timestamp && <time className="cl-command-time">{timestamp}</time>}
            {status && <span className="cl-command-status">{status}</span>}
          </span>
        </button>
      </div>
      {open && (
        <div className="cl-command-expanded">
          {metaRows.length > 0 && (
            <div className="cl-command-section cl-skill-meta">
              {metaRows.map(([label, value]) => (
                <div key={label} className="cl-skill-meta-row">
                  <span className="k">{label}</span>
                  <span className="v">{value}</span>
                </div>
              ))}
            </div>
          )}
          {showArgs && (
            <div className="cl-command-section">
              <div className="cl-command-section-title">Args</div>
              <pre>{command.args}</pre>
            </div>
          )}
          {command.output && (
            <div className="cl-command-section">
              <div className="cl-command-section-title">Output</div>
              <pre>{command.output}</pre>
            </div>
          )}
          {canOpen && (
            <div className="cl-command-section cl-entity-link-row">
              <button type="button" className="cl-entity-link" onClick={() => onOpenSkill!(skill!)}>
                View skill →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Collapsed marker for a run of consecutive tool-only turns in minimal mode.
 *  A single badge with a "× N" multiplier replaces the stack of identical
 *  "1 tool hidden" rows so a long sequence of tool calls reads as one marker. */
export function ToolsHiddenBadge({ count, files = [], dimmed }: { count: number; files?: TouchedFile[]; dimmed?: boolean }) {
  if (count <= 0) return null
  return (
    <div className="cl-turn-tools-hidden" data-dim={dimmed || undefined}>
      <span className="cl-turn-tools-hidden-badge">
        {count === 1 ? '1 tool hidden' : 'tools hidden'}
        {count > 1 && <span className="cl-turn-tools-hidden-x">×{count}</span>}
      </span>
      <FileChipCluster files={files} />
    </div>
  )
}

/** Row of file chips at the foot of a turn: one icon per file the (hidden) tools
 *  touched, tinted by file kind, with the file name on hover. */
function FileChipCluster({ files, max = 10 }: { files: TouchedFile[]; max?: number }) {
  if (files.length === 0) return null
  // One chip per distinct file (dedupe by path across the run + own tools).
  const seen = new Set<string>()
  const distinct: TouchedFile[] = []
  for (const f of files) {
    if (!seen.has(f.path)) {
      seen.add(f.path)
      distinct.push(f)
    }
  }
  const shown = distinct.slice(0, max)
  const overflow = distinct.length - shown.length
  return (
    <div className="cl-turn-files">
      {shown.map((f, i) => {
        const name = f.path.split('/').pop() ?? f.path
        return (
          <span
            key={i}
            className="cl-file-chip"
            style={{ '--ft': fileCategoryTint(f.ext) } as CSSProperties}
            data-file={name}
            aria-label={name}
          >
            <FileIcon ext={f.ext} />
            {f.ext && <span className="cl-file-chip-ext">{f.ext}</span>}
          </span>
        )
      })}
      {overflow > 0 && (
        <span
          className="cl-file-chip cl-file-chip--more"
          data-file={distinct.slice(max).map(f => f.path.split('/').pop()).join('\n')}
        >
          +{overflow}
        </span>
      )}
    </div>
  )
}

// Memoized: with a stable `processed` (from ChatView's useMemo) and a stable
// `onOpenToolDetail` setter, bubbles don't re-render on header-collapse / export
// state changes — only when their own props actually change.
export const MessageBubble = memo(function MessageBubble({
  processed,
  detailsFilter,
  onOpenToolDetail,
  agentColorOf,
  skillOf,
  onOpenSkill,
  agentOf,
  onOpenAgent,
  turnIndex,
  dimmed,
  isContinuation,
  innerRef,
  hiddenToolCount = 0,
  hiddenFiles = [],
}: {
  processed: ProcessedMessage
  detailsFilter: ChatDetailsFilter
  onOpenToolDetail: (group: ToolGroup) => void
  /** Resolves a dispatched sub-agent's identity color from its `subagent_type`. */
  agentColorOf?: (subagentType: string) => string | undefined
  /** Resolves a skill definition from a slash-command name (for the skill card link). */
  skillOf?: (name: string) => Skill | undefined
  /** Navigates to the skill detail view (deep link from an expanded skill card). */
  onOpenSkill?: (skill: Skill) => void
  /** Resolves an agent definition from its `subagent_type` (for the agent card link). */
  agentOf?: (subagentType: string) => Agent | undefined
  /** Navigates to the agent detail view (deep link from an expanded agent card). */
  onOpenAgent?: (agent: Agent) => void
  turnIndex?: number
  /** Faded out because it doesn't match the active type filter (kept visible for context). */
  dimmed?: boolean
  /** True when this turn follows a turn from the same role — hides the orb to group consecutive messages. */
  isContinuation?: boolean
  /** Forwarded ref to the turn <article> so the minimap can scroll-spy / jump to it. */
  innerRef?: Ref<HTMLElement>
  /** Count of tool-only turns collapsed *out of this same assistant turn* (their
   *  tool_use lines were persisted separately) — surfaced as a header chip. */
  hiddenToolCount?: number
  /** Files touched by that collapsed run of hidden tools, shown at the turn foot. */
  hiddenFiles?: TouchedFile[]
}) {
  const { msg, toolGroups, command } = processed
  const isUser = msg.role === 'user'

  const textBlocks = msg.content.filter(b => b.type === 'text') as Extract<ChatContentBlock, { type: 'text' }>[]
  const thinkingBlocks = msg.content.filter(b => b.type === 'thinking') as Extract<ChatContentBlock, { type: 'thinking' }>[]
  const agentGroups = toolGroups.filter(g => AGENT_TOOLS.has(g.use.name))
  const planGroups = toolGroups.filter(g => PLAN_TOOLS.has(g.use.name))
  const skillGroups = toolGroups.filter(g => g.use.name === SKILL_TOOL)
  const questionGroups = toolGroups.filter(g => g.use.name === QUESTION_TOOL)
  // Tools rendered by the generic stack: never include AskUserQuestion (we have
  // a dedicated card) and, in minimal, never include agent dispatches either
  // (those use the AgentDispatchCard).
  const standardToolGroups = toolGroups.filter(g => g.use.name !== QUESTION_TOOL)

  const showThinking = detailsFilter === 'all'
  const showTools = detailsFilter === 'all'
  const showToolDetails = detailsFilter === 'all'
  // In minimal mode tools are hidden, but agent dispatches stay visible so the
  // reader can see when Claude Code delegated work to a sub-agent.
  const showAgentStrip = detailsFilter === 'minimal' && agentGroups.length > 0
  // Plan-mode milestones surface as a dedicated strip in minimal (raw card in full).
  const showPlanStrip = detailsFilter === 'minimal' && planGroups.length > 0
  // Agentic skills get a dedicated minimal strip too (raw tool card in full),
  // so a skill reads as a first-class unit instead of a hidden tool.
  const showSkillStrip = detailsFilter === 'minimal' && skillGroups.length > 0
  // Questions are first-class content: always visible regardless of filter.
  const showQuestions = questionGroups.length > 0

  const hasVisibleContent =
    textBlocks.length > 0 ||
    (showThinking && thinkingBlocks.some(b => b.thinking)) ||
    (showTools && standardToolGroups.length > 0) ||
    showAgentStrip ||
    showPlanStrip ||
    showSkillStrip ||
    showQuestions

  // Tool-only turns (no text/agents/questions) render nothing here: in minimal
  // mode ChatView collapses runs of them into a single <ToolsHiddenBadge>, and
  // in full mode they always have visible content. So a bare turn is dropped.
  if (!hasVisibleContent) return null

  // Role identity is resolved by the shared describeTurn() so the minimap and
  // the rendered bubble always agree on who's speaking.
  const isCommandTurn = !!command
  // The rail orb of an agent turn wears the dispatched sub-agent's identity color
  // (same resolution the dispatch card uses); resolved inside describeTurn so the
  // minimap dots and the bubble orb always agree.
  const { variant: roleVariant, label: roleLabel, initial: roleInitial, color: roleColor } =
    describeTurn(processed, detailsFilter, t => agentTintColor(agentColorOf?.(t)))

  // Deep link surfaced at the foot of an expanded agent-dispatch card — resolves
  // the dispatched sub-agent's definition by type, mirroring the skill card link.
  const agentLink = (group: ToolGroup): { label: string; onClick: () => void } | undefined => {
    if (!AGENT_TOOLS.has(group.use.name) || !agentOf || !onOpenAgent) return undefined
    const t = (group.use.input as Record<string, unknown>).subagent_type as string | undefined
    const agent = t ? agentOf(t) : undefined
    return agent ? { label: 'View agent', onClick: () => onOpenAgent(agent) } : undefined
  }

  // Guard against a missing/invalid timestamp (e.g. a synthetic slash-command
  // message): format only when the date is real, else render nothing — never the
  // literal "Invalid Date".
  const parsedTs = new Date(msg.timestamp)
  const timestamp = Number.isNaN(parsedTs.getTime())
    ? ''
    : parsedTs.toLocaleTimeString('it-IT', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
  const turnNumber = turnIndex !== undefined ? String(turnIndex).padStart(2, '0') : roleInitial

  // Command turn: layout snello, niente "YOU · time", solo la card del comando.
  // Una skill (slash command con `isSkill` o che risolve a una skill nota) usa
  // la SkillCommandCard di prima classe; un comando normale la SlashCommandCard.
  if (isCommandTurn && command) {
    const skill = skillOf?.(command.command)
    const isSkill = command.isSkill || !!skill
    return (
      <article
        className={`cl-turn cl-turn--${roleVariant}${isContinuation ? ' cl-turn--continuation' : ''}`}
        style={{ '--turn-role-color': roleColor } as CSSProperties}
        ref={innerRef}
        data-n={turnIndex}
        data-dim={dimmed || undefined}
      >
        <aside className="cl-turn-rail">
          <span className="cl-turn-orb" aria-label={roleLabel}>{roleInitial}</span>
          <span className="cl-turn-index">{turnNumber}</span>
          <span className="cl-turn-spine" aria-hidden />
        </aside>
        <section className="cl-turn-body">
          {isSkill ? (
            <SkillCommandCard command={command} timestamp={timestamp} skill={skill} onOpenSkill={onOpenSkill} />
          ) : (
            <SlashCommandCard command={command} timestamp={timestamp} />
          )}
        </section>
      </article>
    )
  }

  const isAgentOnly = showAgentStrip && textBlocks.length === 0

  return (
    <article
      className={`cl-turn cl-turn--${roleVariant}${isContinuation ? ' cl-turn--continuation' : ''}${showTools && textBlocks.length === 0 && thinkingBlocks.length === 0 ? ' cl-turn--tool-only' : ''}${isAgentOnly ? ' cl-turn--agent-only' : ''}`}
      style={{ '--turn-role-color': roleColor } as CSSProperties}
      ref={innerRef}
      data-n={turnIndex}
      data-dim={dimmed || undefined}
    >
      <aside className="cl-turn-rail">
        <span className="cl-turn-orb">{roleInitial}</span>
        <span className="cl-turn-index">{turnNumber}</span>
        <span className="cl-turn-spine" aria-hidden />
      </aside>

      <section className="cl-turn-body">
        <header className="cl-turn-head">
          <span className="cl-turn-who">{roleLabel}</span>
          {timestamp &&
           !(showTools && textBlocks.length === 0 && thinkingBlocks.length === 0) &&
           !(showAgentStrip && textBlocks.length === 0) && (
            <>
              <span className="cl-turn-sep">·</span>
              <time>{timestamp}</time>
            </>
          )}
          {msg.model && msg.role === 'assistant' && (
            <>
              <span className="cl-turn-sep cl-turn-sep--model">·</span>
              {msg.model === '<synthetic>' ? (
                // Output of a built-in slash command (/context, /usage, …) — not a
                // real model turn, so label it as such instead of showing the raw
                // "<synthetic>" model tag.
                <span className="cl-turn-model-chip cl-turn-model-chip--synthetic">Command output</span>
              ) : (
                <span className="cl-turn-model-chip" style={{ '--mt': modelColor(msg.model) } as CSSProperties}>
                  {fmtModel(msg.model)}
                </span>
              )}
            </>
          )}
          {hiddenToolCount > 0 && (
            <span className="cl-turn-tools-hidden-badge">
              {hiddenToolCount === 1 ? '1 tool hidden' : 'tools hidden'}
              {hiddenToolCount > 1 && <span className="cl-turn-tools-hidden-x">×{hiddenToolCount}</span>}
            </span>
          )}
          {(() => {
            // Tools collapsed into the "N tools" badge — minus anything already
            // surfaced as its own strip (agent dispatches, agentic skills).
            const stripHidden = standardToolGroups.filter(
              g => !(showAgentStrip && AGENT_TOOLS.has(g.use.name)) && !(showSkillStrip && g.use.name === SKILL_TOOL)
            ).length
            return stripHidden > 0 && !showTools ? (
              <span className="cl-turn-tool-count">{stripHidden} tool{stripHidden === 1 ? '' : 's'}</span>
            ) : null
          })()}
        </header>

        {showThinking && thinkingBlocks.map((b, i) => (
          <ThinkingBlock key={i} thinking={b.thinking} />
        ))}

        <div className="cl-turn-content">
          {textBlocks.map((b, i) => (
            isUser ? (
              <p key={i} className="cl-message-text cl-message-text--user">{b.text}</p>
            ) : (
              <div
                key={i}
                className="cl-message-text cl-message-text--assistant"
              >
                <Markdown>{b.text}</Markdown>
              </div>
            )
          ))}
        </div>

        {!showTools && (() => {
          // Files touched in this turn — the run of tool-only turns folded back
          // into it (their tool_use lines were persisted separately) plus this
          // turn's own (hidden) file tools. One chip per file at the turn foot.
          const ownFiles = touchedFiles(standardToolGroups.filter(g => !AGENT_TOOLS.has(g.use.name)))
          const allFiles = [...hiddenFiles, ...ownFiles]
          return allFiles.length > 0 ? <FileChipCluster files={allFiles} /> : null
        })()}

        {showQuestions && (
          <div className="cl-ask-stack">
            {questionGroups.map((group, i) => (
              <AskQuestionCard key={i} group={group} />
            ))}
          </div>
        )}

        {showAgentStrip && (
          <div className="cl-tool-stack">
            {agentGroups.map((group, i) => {
              const link = agentLink(group)
              return (
                <ToolGroupCard
                  key={i}
                  group={group}
                  showDetails
                  tint={agentTintColor(agentColorOf?.((group.use.input as Record<string, unknown>).subagent_type as string))}
                  detailLabel={link?.label}
                  onViewDetail={link?.onClick}
                />
              )
            })}
          </div>
        )}

        {showPlanStrip && (
          <div className="cl-plan-stack">
            {planGroups.map((group, i) => (
              <PlanCard key={i} group={group} onOpen={() => onOpenToolDetail(group)} />
            ))}
          </div>
        )}

        {showSkillStrip && (
          <div className="cl-tool-stack">
            {skillGroups.map((group, i) => (
              <ToolGroupCard
                key={i}
                group={group}
                showDetails
                detailLabel="View output"
                onViewDetail={() => onOpenToolDetail(group)}
              />
            ))}
          </div>
        )}

        {showTools && standardToolGroups.length > 0 && (
          <div className="cl-tool-stack">
            {standardToolGroups.map((group, i) => {
              const link = agentLink(group)
              return (
                <ToolGroupCard
                  key={i}
                  group={group}
                  showDetails={showToolDetails}
                  tint={AGENT_TOOLS.has(group.use.name)
                    ? agentTintColor(agentColorOf?.((group.use.input as Record<string, unknown>).subagent_type as string))
                    : undefined}
                  detailLabel={link?.label}
                  onViewDetail={link?.onClick}
                />
              )
            })}
          </div>
        )}
      </section>
    </article>
  )
})
