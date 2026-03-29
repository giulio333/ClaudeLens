import { useState } from 'react'
import { TopicInput } from '../../../hooks/useIPC'

export const EMPTY_FORM: TopicInput = { name: '', description: '', type: 'project', content: '' }

export function TopicForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial: TopicInput
  onSave: (v: TopicInput) => void
  onCancel: () => void
  saving: boolean
}) {
  const [form, setForm] = useState<TopicInput>(initial)
  const set = (k: keyof TopicInput, v: string) => setForm(f => ({ ...f, [k]: v }))
  const valid = form.name.trim() && form.description.trim() && form.content.trim()

  return (
    <div className="bg-[#161a26] border border-indigo-700/40 rounded-lg p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1">Name</label>
          <input
            value={form.name}
            onChange={e => set('name', e.target.value)}
            placeholder="E.g. Backend architecture"
            className="w-full text-[13px] border border-[#252836] rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
          />
        </div>
        <div>
          <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1">Type</label>
          <select
            value={form.type}
            onChange={e => set('type', e.target.value)}
            className="w-full text-[13px] border border-[#252836] rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-[#161a26]"
          >
            <option value="user">user</option>
            <option value="feedback">feedback</option>
            <option value="project">project</option>
            <option value="reference">reference</option>
          </select>
        </div>
      </div>
      <div>
        <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1">Short description</label>
        <input
          value={form.description}
          onChange={e => set('description', e.target.value)}
          placeholder="One line that appears in MEMORY.md"
          className="w-full text-[13px] border border-[#252836] rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
        />
      </div>
      <div>
        <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1">Content</label>
        <textarea
          value={form.content}
          onChange={e => set('content', e.target.value)}
          rows={6}
          placeholder="Write the memory body here (markdown supported)..."
          className="w-full text-[13px] border border-[#252836] rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent resize-y font-mono leading-relaxed"
        />
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          onClick={onCancel}
          className="text-[13px] text-zinc-500 hover:text-[#c4c8e0] px-3 py-1.5 rounded-md hover:bg-[#1c2133] transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => valid && onSave(form)}
          disabled={!valid || saving}
          className="text-[13px] font-medium bg-indigo-600 text-white px-4 py-1.5 rounded-md hover:bg-indigo-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  )
}
