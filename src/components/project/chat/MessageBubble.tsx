import React, { memo, useState } from 'react'
import type { CSSProperties, Ref } from 'react'
import Markdown from '../../Markdown'
import { ChatContentBlock } from '../../../hooks/useIPC'
import { ProcessedMessage, ToolGroup, ChatDetailsFilter, ClaudeSlashCommand, parseAskUserQuestions, parseAnswersFromResultText, describeTurn, AGENT_TOOLS, QUESTION_TOOL } from './utils'
import { fmtModel, modelColor } from '../utils'
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

/** Sub-agent dispatch rendered as an editorial "delegated task receipt". */
function AgentDispatchCard({ group, onOpen }: { group: ToolGroup; onOpen: () => void }) {
  const input = group.use.input as Record<string, unknown>
  const subagent = (input.subagent_type as string) || 'general-purpose'
  const desc = (input.description as string) || (input.prompt as string) || ''
  const result = group.result
  const resultText = result ? result.content.replace(/\s+/g, ' ').trim().slice(0, 320) : ''
  return (
    <button type="button" className="cl-agent-card" onClick={onOpen} title="View agent detail">
      <span className="top">
        <span className="ic">A</span>
        <span className="lbl">Sub-agent</span>
        <span className="chip">{subagent}</span>
        {result && (
          <span className="status" data-error={result.isError || undefined}>
            {result.isError ? 'failed' : 'done'}
          </span>
        )}
      </span>
      {desc && <span className="desc">{String(desc)}</span>}
      {resultText && (
        <span className="return">
          <span className="mini">Returned</span>
          <span className="res">{resultText}</span>
        </span>
      )}
    </button>
  )
}

function SlashCommandCard({ command, timestamp }: { command: ClaudeSlashCommand; timestamp?: string }) {
  // Nascondi args se è solo l'echo del command name (es. <command-message>model</command-message> per /model)
  const showArgs = command.args && command.args !== command.command
  return (
    <div className="cl-command-card">
      <div className="cl-command-kicker">
        <span>Claude Code command</span>
        {timestamp && <time>{timestamp}</time>}
      </div>
      <div className="cl-command-main">
        <code>/{command.command}</code>
        <span>{command.description}</span>
      </div>
      {showArgs && (
        <pre className="cl-command-args">{command.args}</pre>
      )}
      {command.output && (
        <div className="cl-command-output">{command.output}</div>
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
  turnIndex,
  dimmed,
  innerRef,
}: {
  processed: ProcessedMessage
  detailsFilter: ChatDetailsFilter
  onOpenToolDetail: (group: ToolGroup) => void
  turnIndex?: number
  /** Faded out because it doesn't match the active type filter (kept visible for context). */
  dimmed?: boolean
  /** Forwarded ref to the turn <article> so the minimap can scroll-spy / jump to it. */
  innerRef?: Ref<HTMLElement>
}) {
  const { msg, toolGroups, command } = processed
  const isUser = msg.role === 'user'

  const textBlocks = msg.content.filter(b => b.type === 'text') as Extract<ChatContentBlock, { type: 'text' }>[]
  const thinkingBlocks = msg.content.filter(b => b.type === 'thinking') as Extract<ChatContentBlock, { type: 'thinking' }>[]
  const agentGroups = toolGroups.filter(g => AGENT_TOOLS.has(g.use.name))
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
  // Questions are first-class content: always visible regardless of filter.
  const showQuestions = questionGroups.length > 0

  const hasVisibleContent =
    textBlocks.length > 0 ||
    (showThinking && thinkingBlocks.some(b => b.thinking)) ||
    (showTools && standardToolGroups.length > 0) ||
    showAgentStrip ||
    showQuestions

  // In minimal mode, tool-only turns (no text, no agents, no questions) are
  // otherwise invisible. Render a compact "X tools hidden" badge so the user
  // can see that tool activity happened.
  const isHiddenToolsOnly = !hasVisibleContent && !showTools && standardToolGroups.length > 0

  if (!hasVisibleContent && !isHiddenToolsOnly) return null

  // Role identity is resolved by the shared describeTurn() so the minimap and
  // the rendered bubble always agree on who's speaking.
  const isCommandTurn = !!command
  const { variant: roleVariant, label: roleLabel, initial: roleInitial, color: roleColor } =
    describeTurn(processed, detailsFilter)

  const timestamp = new Date(msg.timestamp).toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const turnNumber = turnIndex !== undefined ? String(turnIndex).padStart(2, '0') : roleInitial

  // Tool-only turn in minimal mode: render a compact inline badge instead of full article.
  if (isHiddenToolsOnly) {
    return (
      <div
        className="cl-turn-tools-hidden"
        ref={innerRef as React.Ref<HTMLDivElement>}
        data-n={turnIndex}
        data-dim={dimmed || undefined}
      >
        <span className="cl-turn-tools-hidden-badge">
          {standardToolGroups.length} tool{standardToolGroups.length === 1 ? '' : 's'} hidden
        </span>
      </div>
    )
  }

  // Command turn: layout snello, niente "YOU · time", solo la card del comando.
  if (isCommandTurn && command) {
    return (
      <article
        className="cl-turn cl-turn--command"
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

  return (
    <article
      className={`cl-turn cl-turn--${roleVariant}`}
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
          <span className="cl-turn-sep">·</span>
          <time>{timestamp}</time>
          {msg.model && msg.role === 'assistant' && (
            <>
              <span className="cl-turn-sep">·</span>
              <span className="cl-turn-model-chip" style={{ '--mt': modelColor(msg.model) } as CSSProperties}>
                {fmtModel(msg.model)}
              </span>
            </>
          )}
          {standardToolGroups.length > 0 && (
            <span className="cl-turn-tool-count">{standardToolGroups.length} tool{standardToolGroups.length === 1 ? '' : 's'}{!showTools ? ' hidden' : ''}</span>
          )}
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
          <div className="cl-agent-stack">
            {agentGroups.map((group, i) => (
              <AgentDispatchCard key={i} group={group} onOpen={() => onOpenToolDetail(group)} />
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
                onOpenDetail={() => onOpenToolDetail(group)}
              />
            ))}
          </div>
        )}
      </section>
    </article>
  )
})
