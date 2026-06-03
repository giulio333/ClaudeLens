import { useState, type ReactNode } from 'react'
import { TopBar } from '../shared/TopBar'
import { useEffectiveConfig, type EffectiveConfig } from '../../../hooks/useIPC'

// ─── Settings page ────────────────────────────────────────────────────────────
// Reads the *effective* Claude Code configuration through the official Agent SDK
// (see electron/modules/config-reader.ts) and presents it grouped into a
// left-rail of tabs, mirroring the native Claude settings dialog. Read-only:
// ClaudeLens inspects configuration, it does not mutate ~/.claude settings here.

type TabId = 'general' | 'permissions' | 'tools' | 'mcp' | 'extensions' | 'sources'

const TABS: { id: TabId; label: string; icon: ReactNode }[] = [
  { id: 'general', label: 'General', icon: <GearIcon /> },
  { id: 'permissions', label: 'Permissions', icon: <ShieldIcon /> },
  { id: 'tools', label: 'Tools', icon: <WrenchIcon /> },
  { id: 'mcp', label: 'MCP Servers', icon: <PlugIcon /> },
  { id: 'extensions', label: 'Extensions', icon: <BlocksIcon /> },
  { id: 'sources', label: 'Sources', icon: <LayersIcon /> },
]

export function SettingsView({ onBack }: { onBack: () => void }) {
  const { data, isLoading, error, refetch, isFetching } = useEffectiveConfig()
  const [tab, setTab] = useState<TabId>('general')
  const [q, setQ] = useState('')

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--cl-paper)' }}>
      <TopBar
        onBack={onBack}
        backLabel="Close"
        crumbs={[{ label: 'Settings', accent: true }]}
        right={
          <button
            onClick={() => refetch()}
            title="Reload from the Agent SDK"
            className="font-mono uppercase rounded-md px-2.5 py-1 transition-colors hover:text-[var(--cl-accent)]"
            style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--cl-ink-3)', border: '1px solid var(--cl-line)' }}
          >
            {isFetching ? 'Loading…' : 'Reload'}
          </button>
        }
      />

      <div className="flex flex-1 min-h-0">
        {/* ─── Left rail ─── */}
        <aside
          className="shrink-0 flex flex-col gap-1 p-3 border-r overflow-y-auto"
          style={{ width: 232, borderColor: 'var(--cl-line)', background: 'var(--cl-paper-2)' }}
        >
          <div className="px-2 pt-1 pb-3" style={{ fontSize: 11, letterSpacing: '0.18em', color: 'var(--cl-ink-4)' }}>
            <span className="font-mono uppercase">Settings</span>
          </div>
          <SearchBox value={q} onChange={setQ} />
          <div className="h-2" />
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors"
              style={{
                background: tab === t.id ? 'var(--cl-accent-soft)' : 'transparent',
                color: tab === t.id ? 'var(--cl-accent-ink)' : 'var(--cl-ink-2)',
                fontWeight: tab === t.id ? 600 : 500,
                fontSize: 13.5,
              }}
            >
              <span style={{ opacity: tab === t.id ? 1 : 0.7, display: 'flex' }}>{t.icon}</span>
              {t.label}
            </button>
          ))}
          {data?.cwd && (
            <div className="mt-auto px-2 pt-4" style={{ fontSize: 10.5, color: 'var(--cl-ink-4)' }}>
              <div className="font-mono uppercase" style={{ letterSpacing: '0.14em' }}>Scope</div>
              <div className="mt-1 break-all" style={{ color: 'var(--cl-ink-3)' }}>{data.cwd}</div>
            </div>
          )}
        </aside>

        {/* ─── Content ─── */}
        <main className="flex-1 min-w-0 overflow-y-auto" style={{ padding: '28px 40px 60px' }}>
          {isLoading ? (
            <Centered>Reading configuration via the Agent SDK…</Centered>
          ) : error ? (
            <Centered>Failed to read configuration: {(error as Error).message}</Centered>
          ) : data ? (
            <>
              <TabContent tab={tab} cfg={data} q={q.trim().toLowerCase()} />
              <ReadOnlyHint />
            </>
          ) : null}
        </main>
      </div>
    </div>
  )
}

// ─── Tab routing ────────────────────────────────────────────────────────────

function TabContent({ tab, cfg, q }: { tab: TabId; cfg: EffectiveConfig; q: string }) {
  switch (tab) {
    case 'general': return <GeneralTab cfg={cfg} q={q} />
    case 'permissions': return <PermissionsTab cfg={cfg} q={q} />
    case 'tools': return <ToolsTab cfg={cfg} q={q} />
    case 'mcp': return <McpTab cfg={cfg} q={q} />
    case 'extensions': return <ExtensionsTab cfg={cfg} q={q} />
    case 'sources': return <SourcesTab cfg={cfg} q={q} />
  }
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

export function GeneralTab({ cfg, q }: { cfg: EffectiveConfig; q: string }) {
  const s = cfg.effective
  const init = cfg.init
  return (
    <Filtered q={q}>
      {cfg.initError && <Banner>Runtime (init) info unavailable: {cfg.initError}</Banner>}
      <Section title="Runtime">
        <Row label="Model" hint="Resolved model id for this scope">{init ? <Mono>{init.model}</Mono> : <Dim>—</Dim>}</Row>
        <Row label="Permission mode" hint="Effective at startup (trust filter applied)">
          {init ? <Pill>{init.permissionMode}</Pill> : <Dim>—</Dim>}
        </Row>
        <Row label="Output style">{init ? <Mono>{init.outputStyle || 'default'}</Mono> : <Dim>—</Dim>}</Row>
        <Row label="API key source">{init ? <Mono>{init.apiKeySource}</Mono> : <Dim>—</Dim>}</Row>
        <Row label="Claude Code version">{init ? <Mono>{init.claudeCodeVersion}</Mono> : <Dim>—</Dim>}</Row>
        <Row label="Working directory">{init ? <Mono small>{init.cwd}</Mono> : <Dim>—</Dim>}</Row>
      </Section>

      <Section title="Preferences">
        <Row label="Theme" src={prov(cfg, 'theme')}>{val(s.theme) ?? <Dim>system default</Dim>}</Row>
        <Row label="Configured model" src={prov(cfg, 'model')}>{val(s.model) ?? <Dim>default</Dim>}</Row>
        <Row label="Language" src={prov(cfg, 'language')}>{val(s.language) ?? <Dim>default</Dim>}</Row>
        <Row label="Effort level" src={prov(cfg, 'effortLevel')}>{val(s.effortLevel) ?? <Dim>default</Dim>}</Row>
        <Row label="Transcript retention" src={prov(cfg, 'cleanupPeriodDays')}>
          {s.cleanupPeriodDays != null ? <Mono>{String(s.cleanupPeriodDays)} days</Mono> : <Dim>30 days (default)</Dim>}
        </Row>
      </Section>
    </Filtered>
  )
}

export function PermissionsTab({ cfg, q }: { cfg: EffectiveConfig; q: string }) {
  const p = (cfg.effective.permissions as Record<string, unknown>) ?? {}
  return (
    <Filtered q={q}>
      <Section title="Permission mode">
        <Row label="Default mode" src={prov(cfg, 'permissions')}>
          <Pill>{String(p.defaultMode ?? 'default')}</Pill>
        </Row>
        {cfg.init && (
          <Row label="Effective at startup" hint="After the CLI trust filter">
            <Pill>{cfg.init.permissionMode}</Pill>
          </Row>
        )}
      </Section>
      <Section title="Rules">
        <ListRow label="Allow" items={p.allow as string[]} tone="ok" />
        <ListRow label="Ask" items={p.ask as string[]} tone="warn" />
        <ListRow label="Deny" items={p.deny as string[]} tone="danger" />
        <ListRow label="Additional directories" items={p.additionalDirectories as string[]} />
      </Section>
    </Filtered>
  )
}

export function ToolsTab({ cfg, q }: { cfg: EffectiveConfig; q: string }) {
  const tools = (cfg.init?.tools ?? []).filter(t => !q || t.toLowerCase().includes(q))
  return (
    <Section title={`Available tools (${cfg.init?.tools.length ?? 0})`} hintRight="Resolved by the SDK for this scope">
      {!cfg.init ? <Dim>Runtime info unavailable.</Dim> : (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {tools.map(t => <Chip key={t}>{t}</Chip>)}
          {tools.length === 0 && <Dim>No tools match.</Dim>}
        </div>
      )}
    </Section>
  )
}

export function McpTab({ cfg, q }: { cfg: EffectiveConfig; q: string }) {
  const servers = (cfg.init?.mcpServers ?? []).filter(s => !q || s.name.toLowerCase().includes(q))
  return (
    <Section title={`MCP servers (${cfg.init?.mcpServers.length ?? 0})`}>
      {!cfg.init ? <Dim>Runtime info unavailable.</Dim> : servers.length === 0 ? <Dim>No servers match.</Dim> : (
        <div className="flex flex-col gap-px pt-1">
          {servers.map(s => (
            <div key={s.name} className="flex items-center justify-between py-2.5 border-b" style={{ borderColor: 'var(--cl-line-soft)' }}>
              <Mono>{s.name}</Mono>
              <StatusDot status={s.status} />
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

export function ExtensionsTab({ cfg, q }: { cfg: EffectiveConfig; q: string }) {
  const init = cfg.init
  const filt = (arr: string[] = []) => arr.filter(x => !q || x.toLowerCase().includes(q))
  return (
    <>
      <Section title={`Skills (${init?.skills.length ?? 0})`}>
        <ChipCloud items={filt(init?.skills)} empty={!init} />
      </Section>
      <Section title={`Subagents (${init?.agents.length ?? 0})`}>
        <ChipCloud items={filt(init?.agents)} empty={!init} />
      </Section>
      <Section title={`Slash commands (${init?.slashCommands.length ?? 0})`}>
        <ChipCloud items={filt(init?.slashCommands)} empty={!init} />
      </Section>
      <Section title={`Plugins (${init?.plugins.length ?? 0})`}>
        {!init ? <Dim>Runtime info unavailable.</Dim> : (
          <div className="flex flex-col gap-px pt-1">
            {(init.plugins ?? []).filter(p => !q || p.name.toLowerCase().includes(q)).map(p => (
              <div key={p.name} className="flex items-center justify-between gap-4 py-2.5 border-b" style={{ borderColor: 'var(--cl-line-soft)' }}>
                <Mono>{p.name}</Mono>
                <Mono small className="truncate" >{p.path}</Mono>
              </div>
            ))}
            {init.plugins.length === 0 && <Dim>None.</Dim>}
          </div>
        )}
      </Section>
    </>
  )
}

export function SourcesTab({ cfg, q }: { cfg: EffectiveConfig; q: string }) {
  return (
    <>
      {cfg.settingsError && <Banner>Settings cascade unavailable: {cfg.settingsError}</Banner>}
      <p className="mb-5" style={{ fontSize: 13, color: 'var(--cl-ink-3)', maxWidth: 560 }}>
        The effective configuration is the merge of these tiers (low → high precedence),
        resolved by the SDK with the same engine as the CLI.
      </p>
      {cfg.sources.length === 0 && <Dim>No filesystem settings sources loaded.</Dim>}
      {cfg.sources.map((src, i) => {
        const json = JSON.stringify(src.settings, null, 2)
        if (q && !json.toLowerCase().includes(q) && !src.source.includes(q)) return null
        return (
          <div key={i} className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <SourceBadge source={src.source} />
              {src.path && <Mono small className="truncate" >{src.path}</Mono>}
            </div>
            <pre className="rounded-lg p-3 overflow-x-auto" style={{ background: 'var(--cl-paper-2)', border: '1px solid var(--cl-line)', fontSize: 12, lineHeight: 1.55, color: 'var(--cl-ink-2)' }}>
              {json === '{}' ? '(empty)' : json}
            </pre>
          </div>
        )
      })}
    </>
  )
}

// ─── Building blocks ────────────────────────────────────────────────────────

function Section({ title, hint, hintRight, children }: { title: string; hint?: string; hintRight?: string; children: ReactNode }) {
  return (
    <section className="mb-9">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="font-mono uppercase" style={{ fontSize: 12, letterSpacing: '0.18em', color: 'var(--cl-ink)' }}>{title}</h2>
        {hintRight && <span style={{ fontSize: 11, color: 'var(--cl-ink-4)' }}>{hintRight}</span>}
      </div>
      {hint && <p className="mb-2" style={{ fontSize: 12, color: 'var(--cl-ink-4)' }}>{hint}</p>}
      <div>{children}</div>
    </section>
  )
}

function Row({ label, hint, src, children }: { label: string; hint?: string; src?: SrcInfo; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 py-3 border-b" style={{ borderColor: 'var(--cl-line-soft)' }}>
      <div className="min-w-0">
        <div style={{ fontSize: 13.5, color: 'var(--cl-ink)', fontWeight: 500 }}>{label}</div>
        {hint && <div style={{ fontSize: 11.5, color: 'var(--cl-ink-4)', marginTop: 2 }}>{hint}</div>}
        {src && <div className="mt-1"><SourceBadge source={src.source} small /></div>}
      </div>
      <div className="text-right shrink-0 max-w-[55%] break-words">{children}</div>
    </div>
  )
}

function ListRow({ label, items, tone }: { label: string; items?: string[]; tone?: 'ok' | 'warn' | 'danger' }) {
  const list = items ?? []
  return (
    <div className="py-3 border-b" style={{ borderColor: 'var(--cl-line-soft)' }}>
      <div style={{ fontSize: 13.5, color: 'var(--cl-ink)', fontWeight: 500, marginBottom: list.length ? 8 : 0 }}>{label}</div>
      {list.length === 0 ? <Dim>none</Dim> : (
        <div className="flex flex-wrap gap-1.5">{list.map((x, i) => <Chip key={i} tone={tone}>{x}</Chip>)}</div>
      )}
    </div>
  )
}

function ChipCloud({ items, empty }: { items: string[]; empty?: boolean }) {
  if (empty) return <Dim>Runtime info unavailable.</Dim>
  if (items.length === 0) return <Dim>None.</Dim>
  return <div className="flex flex-wrap gap-1.5 pt-1">{items.map((x, i) => <Chip key={i}>{x}</Chip>)}</div>
}

function Chip({ children, tone }: { children: ReactNode; tone?: 'ok' | 'warn' | 'danger' }) {
  const c = tone === 'ok' ? 'var(--cl-ok)' : tone === 'warn' ? 'var(--cl-warn)' : tone === 'danger' ? 'var(--cl-danger)' : 'var(--cl-ink-3)'
  const bg = tone === 'ok' ? 'var(--cl-task-green-soft)' : tone === 'warn' ? 'var(--cl-warn-soft)' : tone === 'danger' ? 'var(--cl-danger-soft)' : 'var(--cl-paper-2)'
  return (
    <span className="font-mono rounded-md px-2 py-1" style={{ fontSize: 11.5, color: c, background: bg, border: '1px solid var(--cl-line)' }}>{children}</span>
  )
}

function Pill({ children }: { children: ReactNode }) {
  return <span className="font-mono rounded-full px-3 py-1" style={{ fontSize: 12, color: 'var(--cl-accent-ink)', background: 'var(--cl-accent-soft)' }}>{children}</span>
}

function Mono({ children, small, className }: { children: ReactNode; small?: boolean; className?: string }) {
  return <span className={`font-mono ${className ?? ''}`} style={{ fontSize: small ? 11.5 : 13, color: 'var(--cl-ink-2)' }}>{children}</span>
}

function Dim({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 13, color: 'var(--cl-ink-4)', fontStyle: 'italic' }}>{children}</span>
}

function StatusDot({ status }: { status: string }) {
  const ok = /connect|ready|running|ok/i.test(status)
  const failed = /fail|error|disconnect/i.test(status)
  const color = ok ? 'var(--cl-ok)' : failed ? 'var(--cl-danger)' : 'var(--cl-warn)'
  return (
    <span className="flex items-center gap-2 font-mono" style={{ fontSize: 11.5, color: 'var(--cl-ink-3)' }}>
      <span style={{ width: 7, height: 7, borderRadius: 99, background: color, display: 'inline-block' }} />
      {status}
    </span>
  )
}

function SourceBadge({ source, small }: { source: string; small?: boolean }) {
  return (
    <span className="font-mono uppercase rounded" style={{ fontSize: small ? 9.5 : 10.5, letterSpacing: '0.1em', padding: small ? '1px 5px' : '2px 7px', color: 'var(--cl-violet-ink)', background: 'var(--cl-violet-soft)' }}>{source}</span>
  )
}

function Banner({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg px-3.5 py-2.5 mb-5" style={{ background: 'var(--cl-warn-soft)', color: 'var(--cl-ink-2)', fontSize: 12.5, border: '1px solid var(--cl-line)' }}>{children}</div>
  )
}

export function ReadOnlyHint() {
  return (
    <div
      className="mt-4 pt-4 flex items-center gap-2"
      style={{ borderTop: '1px solid var(--cl-line-soft)', fontSize: 12, color: 'var(--cl-ink-4)' }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
      </svg>
      <span>
        Read-only view. To change these, run <code className="font-mono" style={{ color: 'var(--cl-ink-3)' }}>/config</code> in Claude Code or edit the <code className="font-mono" style={{ color: 'var(--cl-ink-3)' }}>settings.json</code> files in the Sources tab.
      </span>
    </div>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-center h-full" style={{ color: 'var(--cl-ink-4)', fontSize: 13 }}>{children}</div>
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5" style={{ background: 'var(--cl-paper)', border: '1px solid var(--cl-line)' }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--cl-ink-4)" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Filter"
        className="bg-transparent outline-none w-full"
        style={{ fontSize: 13, color: 'var(--cl-ink)' }}
      />
    </div>
  )
}

// Search on General/Permissions tabs is a passthrough — those tabs are short and
// always-visible; the list-heavy tabs (Tools, MCP, Extensions, Sources) filter
// their own items by the query.
function Filtered({ children }: { q: string; children: ReactNode }) {
  return <>{children}</>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type SrcInfo = { source: string; path?: string }

function prov(cfg: EffectiveConfig, key: string): SrcInfo | undefined {
  return cfg.provenance[key]
}

function val(v: unknown): ReactNode | null {
  if (v == null) return null
  if (typeof v === 'object') return <Mono small>{JSON.stringify(v)}</Mono>
  return <Mono>{String(v)}</Mono>
}

// ─── Icons (16px) ───────────────────────────────────────────────────────────

function GearIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg> }
function ShieldIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg> }
function WrenchIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.1 2.1-2.4-2.4z" /></svg> }
function PlugIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22v-5M9 8V2M15 8V2M5 8h14v3a7 7 0 0 1-14 0z" /></svg> }
function BlocksIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="8" height="8" rx="1" /><rect x="13" y="13" width="8" height="8" rx="1" /><path d="M13 7h8M17 3v8M3 17h8M7 13v8" /></svg> }
function LayersIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m12 2 9 5-9 5-9-5 9-5zM3 12l9 5 9-5M3 17l9 5 9-5" /></svg> }

/** Gear glyph for the top-bar trigger (exported for ProjectOverview). */
export function SettingsGearIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}
