import { memo, useState } from 'react'
import type { CSSProperties, Ref } from 'react'
import Markdown from '../../Markdown'
import { ChatContentBlock } from '../../../hooks/useIPC'
import { ProcessedMessage, ToolGroup, ChatDetailsFilter, ClaudeSlashCommand, parseAskUserQuestions, parseAnswersFromResultText, describeTurn, AGENT_TOOLS, PLAN_TOOLS, QUESTION_TOOL } from './utils'
import { fmtModel, modelColor } from '../utils'
import { agentTintColor } from '../shared/entityOptions'
import { ToolGroupCard } from './ToolGroupCard'

/** AskUserQuestion card: surfaces the prompts and chosen answers, always visible. */
function AskQuestionCard({ group }: { group: ToolGroup }) {
  const questions = parseAskUserQuestions(group.use.input as Record<string, unknown>)
  if (questions.length === 0) return null
  const answers = group.result ? parseAnswersFromResultText(group.result.content) : {}
  const pending = !group.result

  return (
    <div className="cl-ask-card">
      <div className="cl-ask-card-kicker">
        <span className="cl-ask-card-ic">?</span>
        <span className="lbl">Question asked</span>
        <span className="cl-ask-card-status" data-pending={pending || undefined}>
          {pending ? 'Waiting for reply' : 'Answered'}
        </span>
      </div>
      {questions.map((q, i) => {
        const chosen = answers[q.question]
        return (
          <div key={i} className="cl-ask-card-q">
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

/** Collapsed marker for a run of consecutive tool-only turns in minimal mode.
 *  A single badge with a "× N" multiplier replaces the stack of identical
 *  "1 tool hidden" rows so a long sequence of tool calls reads as one marker. */
export function ToolsHiddenBadge({ count, dimmed }: { count: number; dimmed?: boolean }) {
  if (count <= 0) return null
  return (
    <div className="cl-turn-tools-hidden" data-dim={dimmed || undefined}>
      <span className="cl-turn-tools-hidden-badge">
        {count === 1 ? '1 tool hidden' : 'tools hidden'}
        {count > 1 && <span className="cl-turn-tools-hidden-x">×{count}</span>}
      </span>
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
  turnIndex,
  dimmed,
  isContinuation,
  innerRef,
  hiddenToolCount = 0,
}: {
  processed: ProcessedMessage
  detailsFilter: ChatDetailsFilter
  onOpenToolDetail: (group: ToolGroup) => void
  /** Resolves a dispatched sub-agent's identity color from its `subagent_type`. */
  agentColorOf?: (subagentType: string) => string | undefined
  turnIndex?: number
  /** Faded out because it doesn't match the active type filter (kept visible for context). */
  dimmed?: boolean
  /** True when this turn follows a turn from the same role — hides the orb to group consecutive messages. */
  isContinuation?: boolean
  /** Forwarded ref to the turn <article> so the minimap can scroll-spy / jump to it. */
  innerRef?: Ref<HTMLElement>
  /** Number of tool-only turns collapsed before this message in minimal mode. */
  hiddenToolCount?: number
}) {
  const { msg, toolGroups, command } = processed
  const isUser = msg.role === 'user'

  const textBlocks = msg.content.filter(b => b.type === 'text') as Extract<ChatContentBlock, { type: 'text' }>[]
  const thinkingBlocks = msg.content.filter(b => b.type === 'thinking') as Extract<ChatContentBlock, { type: 'thinking' }>[]
  const agentGroups = toolGroups.filter(g => AGENT_TOOLS.has(g.use.name))
  const planGroups = toolGroups.filter(g => PLAN_TOOLS.has(g.use.name))
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
  // Questions are first-class content: always visible regardless of filter.
  const showQuestions = questionGroups.length > 0

  const hasVisibleContent =
    textBlocks.length > 0 ||
    (showThinking && thinkingBlocks.some(b => b.thinking)) ||
    (showTools && standardToolGroups.length > 0) ||
    showAgentStrip ||
    showPlanStrip ||
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

  const timestamp = new Date(msg.timestamp).toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const turnNumber = turnIndex !== undefined ? String(turnIndex).padStart(2, '0') : roleInitial

  // Command turn: layout snello, niente "YOU · time", solo la card del comando.
  if (isCommandTurn && command) {
    return (
      <article
        className={`cl-turn cl-turn--command${isContinuation ? ' cl-turn--continuation' : ''}`}
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
          <SlashCommandCard command={command} timestamp={timestamp} />
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
          {!(showTools && textBlocks.length === 0 && thinkingBlocks.length === 0) &&
           !(showAgentStrip && textBlocks.length === 0) && (
            <>
              <span className="cl-turn-sep">·</span>
              <time>{timestamp}</time>
            </>
          )}
          {msg.model && msg.role === 'assistant' && (
            <>
              <span className="cl-turn-sep cl-turn-sep--model">·</span>
              <span className="cl-turn-model-chip" style={{ '--mt': modelColor(msg.model) } as CSSProperties}>
                {fmtModel(msg.model)}
              </span>
            </>
          )}
          {hiddenToolCount > 0 && (
            <span className="cl-turn-tools-hidden-badge">
              {hiddenToolCount === 1 ? '1 tool hidden' : 'tools hidden'}
              {hiddenToolCount > 1 && <span className="cl-turn-tools-hidden-x">×{hiddenToolCount}</span>}
            </span>
          )}
          {(() => {
            const nonAgentHidden = showAgentStrip
              ? standardToolGroups.filter(g => !AGENT_TOOLS.has(g.use.name)).length
              : standardToolGroups.length
            return nonAgentHidden > 0 && !showTools ? (
              <span className="cl-turn-tool-count">{nonAgentHidden} tool{nonAgentHidden === 1 ? '' : 's'}</span>
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

        {showQuestions && (
          <div className="cl-ask-stack">
            {questionGroups.map((group, i) => (
              <AskQuestionCard key={i} group={group} />
            ))}
          </div>
        )}

        {showAgentStrip && (
          <div className="cl-tool-stack">
            {agentGroups.map((group, i) => (
              <ToolGroupCard
                key={i}
                group={group}
                showDetails
                tint={agentTintColor(agentColorOf?.((group.use.input as Record<string, unknown>).subagent_type as string))}
              />
            ))}
          </div>
        )}

        {showPlanStrip && (
          <div className="cl-plan-stack">
            {planGroups.map((group, i) => (
              <PlanCard key={i} group={group} onOpen={() => onOpenToolDetail(group)} />
            ))}
          </div>
        )}

        {showTools && standardToolGroups.length > 0 && (
          <div className="cl-tool-stack">
            {standardToolGroups.map((group, i) => (
              <ToolGroupCard
                key={i}
                group={group}
                showDetails={showToolDetails}
                tint={AGENT_TOOLS.has(group.use.name)
                  ? agentTintColor(agentColorOf?.((group.use.input as Record<string, unknown>).subagent_type as string))
                  : undefined}
              />
            ))}
          </div>
        )}
      </section>
    </article>
  )
})
