import { memo, useState } from 'react'
import type { CSSProperties } from 'react'
import Markdown from '../../Markdown'
import { ChatContentBlock } from '../../../hooks/useIPC'
import { ProcessedMessage, ToolGroup, ChatDetailsFilter, ClaudeSlashCommand, parseAskUserQuestions, parseAnswersFromResultText } from './utils'
import { ToolGroupCard } from './ToolGroupCard'

const QUESTION_TOOL = 'AskUserQuestion'

/** AskUserQuestion card: surfaces the prompts and chosen answers, always visible. */
function AskQuestionCard({ group }: { group: ToolGroup }) {
  const questions = parseAskUserQuestions(group.use.input as Record<string, unknown>)
  if (questions.length === 0) return null
  const answers = group.result ? parseAnswersFromResultText(group.result.content) : {}
  const pending = !group.result

  return (
    <div className="cl-ask-card">
      <div className="cl-ask-card-kicker">
        <span>Question asked</span>
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
                    <div className="cl-ask-card-option-label">
                      {selected && <span className="cl-ask-card-check">✓</span>}
                      {opt.label}
                    </div>
                    {opt.description && <div className="cl-ask-card-option-desc">{opt.description}</div>}
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
        <span>Thinking</span>
        <b>{open ? 'Close' : 'Open'}</b>
      </button>
      {open && (
        <pre className="cl-thinking-body">{thinking}</pre>
      )}
    </div>
  )
}

/** Compact card that surfaces a Claude Code sub-agent dispatch in minimal mode. */
function AgentDispatchCard({ group, onOpen }: { group: ToolGroup; onOpen: () => void }) {
  const input = group.use.input as Record<string, unknown>
  const subagent = (input.subagent_type as string) || 'general-purpose'
  const desc = (input.description as string) || (input.prompt as string) || ''
  return (
    <button type="button" className="cl-agent-card" onClick={onOpen} title="View agent detail">
      <span className="ic">A</span>
      <span className="lbl">Claude Code Agent</span>
      <span className="chip">{subagent}</span>
      {desc && <span className="desc">{String(desc).slice(0, 90)}</span>}
      {group.result && (
        <span className="status" style={{ color: group.result.isError ? 'var(--cl-danger)' : 'var(--cl-ok)' }}>
          {group.result.isError ? '⚠' : '✓'}
        </span>
      )}
    </button>
  )
}

const AGENT_TOOLS = new Set(['Agent', 'Task'])

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
        <div className="cl-command-output">
          <div className="cl-command-output-label">Output</div>
          <pre>{command.output}</pre>
        </div>
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
}: {
  processed: ProcessedMessage
  detailsFilter: ChatDetailsFilter
  onOpenToolDetail: (group: ToolGroup) => void
  turnIndex?: number
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
  if (!hasVisibleContent) return null

  // A turn that is *only* a sub-agent dispatch gets its own role identity.
  const isAgentTurn = showAgentStrip && textBlocks.length === 0
  // A turn whose only payload is a question (no text, no other tools) gets
  // a dedicated "Question" identity so it stands out in the timeline.
  const isQuestionTurn =
    showQuestions &&
    textBlocks.length === 0 &&
    !showAgentStrip &&
    (!showTools || standardToolGroups.length === 0)
  const isCommandTurn = !!command
  const roleVariant: 'user' | 'claude' | 'agent' | 'command' | 'question' =
    isCommandTurn ? 'command'
    : isQuestionTurn ? 'question'
    : isAgentTurn ? 'agent'
    : isUser ? 'user'
    : 'claude'
  const roleInitial =
    roleVariant === 'command' ? '/' :
    roleVariant === 'question' ? '?' :
    roleVariant === 'agent' ? 'A' :
    roleVariant === 'user' ? 'U' : 'C'
  const roleLabel =
    roleVariant === 'command' ? 'Command' :
    roleVariant === 'question' ? 'Question' :
    roleVariant === 'agent' ? 'Agent' :
    roleVariant === 'user' ? 'You' : 'Claude'
  const roleColor =
    roleVariant === 'command' ? 'var(--cl-accent)' :
    roleVariant === 'question' ? 'var(--cl-warn)' :
    roleVariant === 'agent' ? 'var(--cl-violet)' :
    roleVariant === 'user' ? 'var(--cl-ink)' : 'var(--cl-accent)'

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
        className="cl-turn cl-turn--command"
        style={{ '--turn-role-color': roleColor } as CSSProperties}
      >
        <aside className="cl-turn-rail">
          <span className="cl-turn-orb" aria-label={roleLabel}>{roleInitial}</span>
          <span className="cl-turn-index">{turnNumber}</span>
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
    >
      <aside className="cl-turn-rail">
        <span className="cl-turn-orb">{roleInitial}</span>
        <span className="cl-turn-index">{turnNumber}</span>
      </aside>

      <section className="cl-turn-body">
        <header className="cl-turn-head">
          <span className="cl-turn-who">{roleLabel}</span>
          <span className="cl-turn-sep">·</span>
          <time>{timestamp}</time>
          {standardToolGroups.length > 0 && (
            <span className="cl-turn-tool-count">{standardToolGroups.length} tool{standardToolGroups.length === 1 ? '' : 's'}</span>
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
