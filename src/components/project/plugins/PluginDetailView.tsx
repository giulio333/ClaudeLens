import { useState } from 'react'
import { usePlugins, InstalledPlugin, Skill, Agent, PluginCommand } from '../../../hooks/useIPC'
import { Lens } from '../overview/Lens'
import { TopBar } from '../shared/TopBar'
import { EntityDetailView, EntityConfig } from '../shared/EntityDetailView'
import { initialOf } from '../shared/entityOptions'
import { SkillDetailView } from '../skills/SkillDetailView'
import { AgentDetailView } from '../agents/AgentDetailView'

type OpenItem =
  | { kind: 'skill'; item: Skill }
  | { kind: 'agent'; item: Agent }
  | { kind: 'command'; item: PluginCommand }

function Tile({ glyph, name, desc, index, onClick }: { glyph: string; name: string; desc?: string; index: number; onClick: () => void }) {
  return (
    <button type="button" className={`cl-tile ${index === 0 ? 'accent' : ''}`} onClick={onClick}>
      <span className="glyph">{glyph}</span>
      <div style={{ minWidth: 0 }}>
        <div className="t-name">{name}</div>
        <div className="t-desc">{desc || '—'}</div>
      </div>
    </button>
  )
}

/** Read-only detail for a plugin slash command (markdown body, no frontmatter editing). */
function CommandDetail({ command, plugin, onBack }: { command: PluginCommand; plugin: InstalledPlugin; onBack: () => void }) {
  const config: EntityConfig = {
    kind: 'plan',
    name: `/${command.name}`,
    titleGlyph: '.md',
    titleFluid: true,
    scopeLabel: 'Plugin',
    path: command.path,
    description: command.description,
    eyebrow: `Plugin command · ${plugin.name}`,
    kindLabel: 'command',
    backLabel: plugin.name,
    crumbs: [{ label: 'Plugin' }, { label: `/${command.name}`, accent: true }],
    neutralTint: true,
    initial: initialOf(command.name),
    tape: [{ label: 'Plugin', value: plugin.name }],
    bodyLabel: 'Command · markdown',
    optionDefs: [],
    initialOptions: {},
    body: command.content,
    serialize: ({ body }) => body,
    editable: false,
    deletable: false,
    duplicable: false,
    runnable: false,
    footerNote: `Provided by ${plugin.name} · read-only`,
  }
  return <EntityDetailView config={config} onBack={onBack} />
}

export function PluginDetailView({ plugin: initialPlugin, onBack }: { plugin: InstalledPlugin; onBack: () => void }) {
  const [open, setOpen] = useState<OpenItem | null>(null)
  const { data: plugins } = usePlugins()
  // Re-derive the fresh plugin after a watcher refresh (install/update).
  const plugin =
    plugins?.find(p => p.marketplace === initialPlugin.marketplace && p.name === initialPlugin.name) ??
    initialPlugin

  if (open) {
    const back = () => setOpen(null)
    if (open.kind === 'skill') return <SkillDetailView skill={open.item} onBack={back} readOnly />
    if (open.kind === 'agent') return <AgentDetailView agent={open.item} onBack={back} readOnly />
    return <CommandDetail command={open.item} plugin={plugin} onBack={back} />
  }

  const meta: string[] = []
  if (plugin.version && plugin.version !== 'unknown') meta.push(`v${plugin.version}`)
  if (plugin.author) meta.push(plugin.author)
  if (plugin.repo) meta.push(plugin.repo)

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>
      <TopBar onBack={onBack} crumbs={[{ label: 'Plugins' }, { label: plugin.name, accent: true }]} />

      <div className="flex-1 overflow-y-auto">
        <section className="cl-hero">
          <Lens />
          <div className="cl-eyebrow">
            <span className="pip" />
            <span>{plugin.marketplace}</span>
          </div>
          <h1 className="cl-h-name static">
            <span className="label-name">{plugin.name}</span>
            <span className="glyph">.</span>
          </h1>
          {plugin.description && (
            <p style={{ color: 'var(--cl-ink-3)', fontSize: 14, maxWidth: 720, marginTop: 8 }}>{plugin.description}</p>
          )}
          {meta.length > 0 && (
            <div className="cl-h-meta">
              {meta.map((m, i) => (
                <span key={m}>
                  {i > 0 && <span className="sep">·</span>} {m}
                </span>
              ))}
            </div>
          )}
        </section>

        {plugin.skills.length > 0 && (
          <section className="cl-section">
            <div className="cl-sec-head">
              <h2>Skills</h2>
              <span className="ct">{plugin.skills.length}</span>
            </div>
            <div className="cl-tile-grid cl-tile-grid--list">
              {plugin.skills.map((s, i) => (
                <Tile key={s.path} glyph={(s.name[0] ?? '?').toUpperCase()} name={`/${s.name}`} desc={s.description} index={i} onClick={() => setOpen({ kind: 'skill', item: s })} />
              ))}
            </div>
          </section>
        )}

        {plugin.agents.length > 0 && (
          <section className="cl-section">
            <div className="cl-sec-head">
              <h2>Agents</h2>
              <span className="ct">{plugin.agents.length}</span>
            </div>
            <div className="cl-tile-grid cl-tile-grid--list">
              {plugin.agents.map((a, i) => (
                <Tile key={a.path} glyph={(a.name[0] ?? '?').toUpperCase()} name={a.name} desc={a.description} index={i} onClick={() => setOpen({ kind: 'agent', item: a })} />
              ))}
            </div>
          </section>
        )}

        {plugin.commands.length > 0 && (
          <section className="cl-section">
            <div className="cl-sec-head">
              <h2>Commands</h2>
              <span className="ct">{plugin.commands.length}</span>
            </div>
            <div className="cl-tile-grid cl-tile-grid--list">
              {plugin.commands.map((c, i) => (
                <Tile key={c.path} glyph={(c.name[0] ?? '?').toUpperCase()} name={`/${c.name}`} desc={c.description} index={i} onClick={() => setOpen({ kind: 'command', item: c })} />
              ))}
            </div>
          </section>
        )}

        {plugin.skills.length === 0 && plugin.agents.length === 0 && plugin.commands.length === 0 && (
          <section className="cl-section">
            <div className="cl-empty">This plugin provides no skills, agents or commands.</div>
          </section>
        )}
      </div>
    </div>
  )
}
