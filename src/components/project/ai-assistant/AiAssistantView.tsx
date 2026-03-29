import { useState, useEffect, useRef } from 'react'
import Markdown from '../../Markdown'
import { BackButton } from '../shared/BackButton'

type PresetAction = {
  label: string
  instruction: (p: { hash: string; realPath: string }) => string
}

const PRESET_ACTIONS: PresetAction[] = [
  {
    label: '🧠 Analyze memory',
    instruction: (p) =>
      `Analyze the memory topics of this Claude Code project. The files are located in ~/.claude/projects/${p.hash}/memory/. Read them with the available tools, then report redundancies, inconsistencies or topics that could be improved or merged.`,
  },
  {
    label: '📋 Suggest CLAUDE.md',
    instruction: (p) =>
      `Analyze the CLAUDE.md of this project (located at ${p.realPath}/CLAUDE.md and in parent directories). Read it with the available tools, then suggest concrete improvements to make it more effective, specific and useful.`,
  },
]

export function AiAssistantView({
  project,
  onBack,
}: {
  project: { hash: string; realPath: string }
  onBack: () => void
}) {
  const projectName = project.realPath.split('/').pop() ?? project.realPath
  const [prompt, setPrompt] = useState('')
  const [output, setOutput] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const outputRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.electronAPI.ai.onChunk((chunk) => {
      setOutput(prev => prev + chunk)
    })
    window.electronAPI.ai.onDone(() => {
      setIsRunning(false)
    })
    window.electronAPI.ai.onError((error) => {
      setOutput(prev => prev + (prev ? '\n\n' : '') + `**Error:** ${error}`)
      setIsRunning(false)
    })
    return () => {
      window.electronAPI.ai.onChunk(() => {})
      window.electronAPI.ai.onDone(() => {})
      window.electronAPI.ai.onError(() => {})
    }
  }, [])

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [output])

  async function runAction(instruction: string) {
    if (isRunning) return
    setOutput('')
    setIsRunning(true)
    try {
      await window.electronAPI.ai.run(instruction, '', project.realPath)
    } catch (e) {
      setOutput(`**Error:** ${e instanceof Error ? e.message : String(e)}`)
      setIsRunning(false)
    }
  }

  function handleSubmit() {
    if (!prompt.trim() || isRunning) return
    const text = prompt.trim()
    setPrompt('')
    runAction(text)
  }

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 bg-[#0d0f14]/95 backdrop-blur-sm border-b border-[#252836] px-8 pt-4 pb-0">
        <div className="flex items-center gap-3 mb-3">
          <BackButton label="Overview" onClick={onBack} />
          <span className="text-zinc-300">·</span>
          <span className="text-[13px] font-medium text-[#9096b0]">{projectName}</span>
          <span className="ml-auto text-[11px] font-mono text-zinc-400 bg-[#1c2133] px-2 py-0.5 rounded">claude -p</span>
        </div>
        <div className="flex items-end justify-between mb-3">
          <h1 className="text-[17px] font-semibold text-[#e0e2f0]">AI Assistant</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap pb-3 border-b border-[#252836]">
          {PRESET_ACTIONS.map(action => (
            <button
              key={action.label}
              onClick={() => runAction(action.instruction(project))}
              disabled={isRunning}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#161a26] border border-[#252836] text-[#787e98] text-[12px] font-medium hover:border-indigo-600/60 hover:text-indigo-400 hover:bg-indigo-950/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={outputRef} className="flex-1 overflow-y-auto px-8 py-6">
        {!output && !isRunning && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="w-12 h-12 rounded-xl bg-indigo-950/20 border border-indigo-800/30 flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <p className="text-[13px] font-medium text-[#787e98] mb-1">Ready</p>
              <p className="text-[12px] text-zinc-400">Select an action or write a prompt</p>
            </div>
          </div>
        )}
        {(output || isRunning) && (
          <div className="max-w-4xl mx-auto">
            <div className="bg-[#161a26] border border-[#252836] rounded-xl p-6">
              <Markdown>{output}</Markdown>
              {isRunning && (
                <span className="inline-block w-2 h-4 bg-indigo-950/200 rounded-sm animate-pulse ml-1 align-middle" />
              )}
            </div>
            {!isRunning && output && (
              <div className="flex items-center justify-between mt-3 px-1">
                <button
                  onClick={() => setOutput('')}
                  className="text-[12px] text-zinc-400 hover:text-[#787e98] transition-colors"
                >
                  New request
                </button>
                <button
                  onClick={() => navigator.clipboard.writeText(output)}
                  className="text-[12px] text-zinc-400 hover:text-[#787e98] transition-colors flex items-center gap-1"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-[#252836] px-8 py-4 bg-[#161a26]">
        <div className="flex items-end gap-3 max-w-4xl mx-auto">
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) handleSubmit() }}
            disabled={isRunning}
            placeholder="Ask something about the project... (Cmd+Enter to send)"
            className="flex-1 resize-none rounded-xl border border-[#252836] bg-[#0d0f14] px-4 py-3 text-[13px] text-[#9096b0] placeholder-zinc-400 focus:outline-none focus:border-indigo-600/60 focus:bg-[#161a26] transition-colors disabled:opacity-50"
            rows={2}
          />
          {isRunning ? (
            <button
              onClick={() => window.electronAPI.ai.stop()}
              className="shrink-0 px-4 py-3 rounded-xl bg-red-950/200 hover:bg-red-600 text-white text-[13px] font-medium transition-colors"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!prompt.trim()}
              className="shrink-0 px-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
