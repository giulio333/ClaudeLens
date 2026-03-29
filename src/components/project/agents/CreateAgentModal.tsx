import { useState } from 'react'
import { useCreateAgent, AgentInput } from '../../../hooks/useIPC'

function FieldHint({ text }: { text: string }) {
  return (
    <span className="relative group inline-flex items-center ml-1 cursor-default">
      <span className="text-[9px] text-zinc-400 border border-[#2a2f45] rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none select-none">?</span>
      <span className="pointer-events-none absolute left-5 top-0 z-50 w-52 rounded-lg bg-zinc-800 px-2.5 py-1.5 text-[10px] text-zinc-100 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-normal">
        {text}
      </span>
    </span>
  )
}

export function CreateAgentModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState<Partial<AgentInput> & { name: string; content: string; allowedToolsRaw: string; disallowedToolsRaw: string; skillsRaw: string; mcpServersRaw: string }>({
    name: '', content: '', allowedToolsRaw: '', disallowedToolsRaw: '', skillsRaw: '', mcpServersRaw: '',
  })
  const [error, setError] = useState<string | null>(null)
  const createAgent = useCreateAgent()

  function set(key: string, value: unknown) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Name is required'); return }
    if (!form.content.trim()) { setError('Content is required'); return }
    const splitList = (raw: string) => raw.split(',').map(s => s.trim()).filter(Boolean)
    const input: AgentInput = {
      name: form.name.trim(),
      content: form.content.trim(),
      ...(form.description ? { description: form.description } : {}),
      ...(form.model ? { model: form.model } : {}),
      ...(form.allowedToolsRaw ? { allowedTools: splitList(form.allowedToolsRaw) } : {}),
      ...(form.disallowedToolsRaw ? { disallowedTools: splitList(form.disallowedToolsRaw) } : {}),
      ...(form.permissionMode ? { permissionMode: form.permissionMode } : {}),
      ...(form.maxTurns ? { maxTurns: Number(form.maxTurns) } : {}),
      ...(form.isolation ? { isolation: form.isolation } : {}),
      ...(form.memory ? { memory: form.memory } : {}),
      ...(form.skillsRaw ? { skills: splitList(form.skillsRaw) } : {}),
      ...(form.mcpServersRaw ? { mcpServers: splitList(form.mcpServersRaw) } : {}),
    }
    try {
      await createAgent.mutateAsync(input)
      onCreated()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const labelCls = "flex items-center text-[11px] font-medium text-[#787e98] mb-1"
  const inputCls = "w-full rounded-lg border border-[#252836] bg-[#0d0f14] px-3 py-2 text-[12px] text-[#e0e2f0] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 transition"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-[#161a26] rounded-2xl shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[85vh]">
        <div className="px-6 py-4 border-b border-[#1c2030] flex items-center gap-2">
          <span className="text-base">🤖</span>
          <h2 className="text-[14px] font-semibold text-[#e0e2f0]">New Global Agent</h2>
          <button onClick={onClose} className="ml-auto text-zinc-400 hover:text-[#9096b0] text-lg leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
          <div>
            <label className={labelCls}>
              Name <span className="text-red-400 ml-0.5">*</span>
              <FieldHint text="File name in ~/.claude/agents/. E.g.: 'code-reviewer' → ~/.claude/agents/code-reviewer.md" />
            </label>
            <input className={inputCls} placeholder="es. code-reviewer" value={form.name} onChange={e => set('name', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>
              Description
              <FieldHint text="Agent description. Claude uses it to decide when to use this agent autonomously." />
            </label>
            <input className={inputCls} placeholder="e.g. Reviews code for quality and security" value={form.description ?? ''} onChange={e => set('description', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>
              Content (system prompt) <span className="text-red-400 ml-0.5">*</span>
              <FieldHint text="The agent's system prompt: instructions on how it should behave and what it should do." />
            </label>
            <textarea className={inputCls + ' min-h-[120px] resize-y font-mono'} placeholder="Write the agent instructions in markdown..." value={form.content} onChange={e => set('content', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>
              Model
              <FieldHint text="Model to use for this agent. If empty, uses the project default." />
            </label>
            <input className={inputCls} placeholder="es. claude-haiku-4-5-20251001" value={form.model ?? ''} onChange={e => set('model', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>
              Allowed Tools
              <FieldHint text="Tools the agent can use, comma-separated. If empty, can use all tools." />
            </label>
            <input className={inputCls} placeholder="es. Read, Grep, Bash" value={form.allowedToolsRaw} onChange={e => set('allowedToolsRaw', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>
              Disallowed Tools
              <FieldHint text="Tools the agent CANNOT use, comma-separated." />
            </label>
            <input className={inputCls} placeholder="es. Write, Edit" value={form.disallowedToolsRaw} onChange={e => set('disallowedToolsRaw', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>
                Permission Mode
                <FieldHint text="Permission mode: 'default', 'acceptEdits', 'bypassPermissions'." />
              </label>
              <input className={inputCls} placeholder="default" value={form.permissionMode ?? ''} onChange={e => set('permissionMode', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>
                Max Turns
                <FieldHint text="Maximum number of conversation turns for the agent." />
              </label>
              <input className={inputCls} type="number" placeholder="es. 10" value={form.maxTurns ?? ''} onChange={e => set('maxTurns', e.target.value ? Number(e.target.value) : undefined)} />
            </div>
          </div>
          <div>
            <label className={labelCls}>
              Isolation
              <FieldHint text="Isolation mode: 'worktree' runs the agent in a temporary git worktree." />
            </label>
            <input className={inputCls} placeholder="es. worktree" value={form.isolation ?? ''} onChange={e => set('isolation', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>
              Memory
              <FieldHint text="Path or ID of the memory file to inject into the agent's context." />
            </label>
            <input className={inputCls} placeholder="es. ~/.claude/memory.md" value={form.memory ?? ''} onChange={e => set('memory', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>
              Skills
              <FieldHint text="Names of skills available for the agent, comma-separated." />
            </label>
            <input className={inputCls} placeholder="es. commit-helper, test-runner" value={form.skillsRaw} onChange={e => set('skillsRaw', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>
              MCP Servers
              <FieldHint text="IDs of MCP servers available for the agent, comma-separated." />
            </label>
            <input className={inputCls} placeholder="es. filesystem, github" value={form.mcpServersRaw} onChange={e => set('mcpServersRaw', e.target.value)} />
          </div>
          {error && <p className="text-[11px] text-red-400 bg-red-950/20 rounded-lg px-3 py-2">{error}</p>}
        </form>
        <div className="px-6 py-4 border-t border-[#1c2030] flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-1.5 rounded-lg text-[12px] text-[#787e98] hover:bg-[#1c2133] transition">Cancel</button>
          <button
            onClick={handleSubmit as unknown as React.MouseEventHandler}
            disabled={createAgent.isLoading}
            className="px-4 py-1.5 rounded-lg text-[12px] font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition"
          >
            {createAgent.isLoading ? 'Saving…' : 'Create Agent'}
          </button>
        </div>
      </div>
    </div>
  )
}
