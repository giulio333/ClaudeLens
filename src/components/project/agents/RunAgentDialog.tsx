import { useEffect, useRef, useState } from 'react'
import { Agent } from '../../../hooks/useIPC'
import { entityTint } from '../shared/entityOptions'

const PlayIcon = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M4 3l9 5-9 5z" />
  </svg>
)

/* RUN AGENT DIALOG — prompt input → dispatch background agent */
export function RunAgentDialog({
  agent,
  project,
  onClose,
  onSubmit,
}: {
  agent: Agent
  project: { hash: string; realPath: string }
  onClose: () => void
  onSubmit: (args: { prompt: string; sessionName?: string }) => Promise<void>
}) {
  const [prompt, setPrompt] = useState('')
  const [sessionName, setSessionName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    promptRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        submit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function submit() {
    if (!prompt.trim() || busy) return
    try {
      setBusy(true)
      setError(null)
      await onSubmit({ prompt: prompt.trim(), sessionName: sessionName.trim() || undefined })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const projectName = project.realPath.split('/').pop() || project.realPath

  return (
    <div className="cl-run-agent-backdrop" onClick={onClose}>
      <div className="cl-run-agent-panel" onClick={e => e.stopPropagation()} style={entityTint(agent.color)}>
        <div className="ey"><span className="pip" />Dispatch background agent</div>
        <h2>
          Run <span style={{ color: 'var(--cl-accent)' }}>{agent.name}</span>
          <span className="g"> in {projectName}</span>
        </h2>
        <div className="sub">{project.realPath}</div>

        {error && <div className="error">✕ {error}</div>}

        <div className="field">
          <label className="l">Prompt</label>
          <textarea
            ref={promptRef}
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="What should this agent do?"
          />
        </div>
        <div className="field">
          <label className="l">Session name · optional</label>
          <input
            value={sessionName}
            onChange={e => setSessionName(e.target.value)}
            placeholder={`${agent.name} run`}
          />
        </div>

        <div className="actions">
          <button type="button" className="cl-btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="cl-btn-solid"
            onClick={submit}
            disabled={!prompt.trim() || busy}
          >
            <PlayIcon /> {busy ? 'Dispatching…' : 'Dispatch · ⌘↵'}
          </button>
        </div>
      </div>
    </div>
  )
}
