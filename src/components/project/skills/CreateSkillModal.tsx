import { useState } from 'react'
import { useCreateSkill, SkillInput } from '../../../hooks/useIPC'

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

export function CreateSkillModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState<Partial<SkillInput> & { name: string; content: string; allowedToolsRaw: string }>({
    name: '', content: '', allowedToolsRaw: '',
  })
  const [error, setError] = useState<string | null>(null)
  const createSkill = useCreateSkill()

  function set(key: string, value: unknown) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Name is required'); return }
    if (!form.content.trim()) { setError('Content is required'); return }
    const input: SkillInput = {
      name: form.name.trim(),
      content: form.content.trim(),
      ...(form.description ? { description: form.description } : {}),
      ...(form.argumentHint ? { argumentHint: form.argumentHint } : {}),
      ...(form.model ? { model: form.model } : {}),
      ...(form.context ? { context: form.context } : {}),
      ...(form.agent ? { agent: form.agent } : {}),
      ...(form.allowedToolsRaw ? { allowedTools: form.allowedToolsRaw.split(',').map(s => s.trim()).filter(Boolean) } : {}),
    }
    try {
      await createSkill.mutateAsync(input)
      onCreated()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const labelCls = "flex items-center text-[11px] font-medium text-[#787e98] mb-1"
  const inputCls = "w-full rounded-lg border border-[#252836] bg-[#0d0f14] px-3 py-2 text-[12px] text-[#e0e2f0] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-[#161a26] rounded-2xl shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[85vh]">
        <div className="px-6 py-4 border-b border-[#1c2030] flex items-center gap-2">
          <span className="text-base">⚡</span>
          <h2 className="text-[14px] font-semibold text-[#e0e2f0]">New Global Skill</h2>
          <button onClick={onClose} className="ml-auto text-zinc-400 hover:text-[#9096b0] text-lg leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
          <div>
            <label className={labelCls}>
              Name <span className="text-red-400 ml-0.5">*</span>
              <FieldHint text="Skill directory name in ~/.claude/skills/. Letters, numbers and hyphens only. Will be the /name command." />
            </label>
            <input className={inputCls} placeholder="es. commit-helper" value={form.name} onChange={e => set('name', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>
              Description
              <FieldHint text="Short description visible in the skill list. Used by Claude to understand when to invoke the skill." />
            </label>
            <input className={inputCls} placeholder="e.g. Generates structured commit messages" value={form.description ?? ''} onChange={e => set('description', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>
              Content (SKILL.md body) <span className="text-red-400 ml-0.5">*</span>
              <FieldHint text="The SKILL.md file body: instructions for Claude on what to do when the skill is invoked." />
            </label>
            <textarea className={inputCls + ' min-h-[120px] resize-y font-mono'} placeholder="Write the skill instructions in markdown..." value={form.content} onChange={e => set('content', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>
              Argument Hint
              <FieldHint text="Hint for the expected argument. E.g.: '<branch-name>' appears in autocomplete." />
            </label>
            <input className={inputCls} placeholder="es. <message>" value={form.argumentHint ?? ''} onChange={e => set('argumentHint', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>
              Allowed Tools
              <FieldHint text="List of allowed tools, comma-separated. Limits which tools Claude can use in the skill." />
            </label>
            <input className={inputCls} placeholder="es. Bash, Read, Write" value={form.allowedToolsRaw} onChange={e => set('allowedToolsRaw', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>
              Model
              <FieldHint text="Claude model to use for this skill. If empty, uses the default. E.g.: claude-sonnet-4-6" />
            </label>
            <input className={inputCls} placeholder="es. claude-sonnet-4-6" value={form.model ?? ''} onChange={e => set('model', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>
              Agent
              <FieldHint text="Name of an agent to delegate for executing this skill." />
            </label>
            <input className={inputCls} placeholder="es. my-agent" value={form.agent ?? ''} onChange={e => set('agent', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>
              Context
              <FieldHint text="Additional context to inject into the prompt when the skill is active." />
            </label>
            <input className={inputCls} placeholder="es. project-files" value={form.context ?? ''} onChange={e => set('context', e.target.value)} />
          </div>
          {error && <p className="text-[11px] text-red-400 bg-red-950/20 rounded-lg px-3 py-2">{error}</p>}
        </form>
        <div className="px-6 py-4 border-t border-[#1c2030] flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-1.5 rounded-lg text-[12px] text-[#787e98] hover:bg-[#1c2133] transition">Cancel</button>
          <button
            onClick={handleSubmit as unknown as React.MouseEventHandler}
            disabled={createSkill.isLoading}
            className="px-4 py-1.5 rounded-lg text-[12px] font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition"
          >
            {createSkill.isLoading ? 'Saving…' : 'Create Skill'}
          </button>
        </div>
      </div>
    </div>
  )
}
