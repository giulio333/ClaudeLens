import { usePlugins, InstalledPlugin } from '../../../hooks/useIPC';
import { Lens } from '../overview/Lens';
import { TopBar } from '../shared/TopBar';

function componentCounts(plugin: InstalledPlugin): string {
  const parts: string[] = [];
  if (plugin.skills.length)
    parts.push(`${plugin.skills.length} skill${plugin.skills.length === 1 ? '' : 's'}`);
  if (plugin.agents.length)
    parts.push(`${plugin.agents.length} agent${plugin.agents.length === 1 ? '' : 's'}`);
  if (plugin.commands.length)
    parts.push(`${plugin.commands.length} command${plugin.commands.length === 1 ? '' : 's'}`);
  return parts.length ? parts.join(' · ') : 'no components';
}

function PluginTile({
  plugin,
  index,
  onClick,
}: {
  plugin: InstalledPlugin;
  index: number;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`cl-tile ${index === 0 ? 'accent' : ''}`} onClick={onClick}>
      <span className="glyph">{(plugin.name[0] ?? '?').toUpperCase()}</span>
      <div style={{ minWidth: 0 }}>
        <div className="t-name">{plugin.name}</div>
        <div className="t-desc">{plugin.description || componentCounts(plugin)}</div>
      </div>
      <span className="t-meta">
        <b>{componentCounts(plugin)}</b>
      </span>
    </button>
  );
}

export function PluginsView({
  onBack,
  onSelectPlugin,
}: {
  onBack: () => void;
  onSelectPlugin: (plugin: InstalledPlugin) => void;
}) {
  const { data: plugins, isLoading } = usePlugins();
  const total = plugins?.length ?? 0;

  // Group plugins by marketplace, preserving the backend's sorted order.
  const byMarketplace = new Map<string, InstalledPlugin[]>();
  for (const p of plugins ?? []) {
    const list = byMarketplace.get(p.marketplace) ?? [];
    list.push(p);
    byMarketplace.set(p.marketplace, list);
  }

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>
      <TopBar onBack={onBack} crumbs={[{ label: 'Global · Plugins' }]} />

      <div className="flex-1 overflow-y-auto">
        <section className="cl-hero">
          <Lens />
          <div className="cl-eyebrow">
            <span className="pip" />
            <span>Global · ~/.claude/plugins</span>
          </div>
          <h1 className="cl-h-name static">
            <span className="label-name">Plugins</span>
            <span className="glyph">.</span>
          </h1>
          <div className="cl-h-meta">
            <span>
              <b>{total}</b> {total === 1 ? 'plugin' : 'plugins'}
            </span>
            <span className="sep">·</span>
            <span>skills, agents & commands from marketplaces</span>
          </div>
        </section>

        {isLoading ? (
          <section className="cl-section">
            <p style={{ color: 'var(--cl-ink-3)', fontSize: 13 }}>Loading…</p>
          </section>
        ) : total === 0 ? (
          <section className="cl-section">
            <div className="cl-empty">
              No plugins installed. Install one with{' '}
              <code style={{ fontFamily: 'var(--font-mono)' }}>/plugin</code> in Claude Code.
            </div>
          </section>
        ) : (
          [...byMarketplace.entries()].map(([marketplace, list]) => (
            <section key={marketplace} className="cl-section">
              <div className="cl-sec-head">
                <h2>{marketplace}</h2>
                <span className="ct">
                  {list.length} {list.length === 1 ? 'plugin' : 'plugins'}
                </span>
              </div>
              <div className="cl-tile-grid cl-tile-grid--list">
                {list.map((p, i) => (
                  <PluginTile
                    key={`${p.marketplace}/${p.name}`}
                    plugin={p}
                    index={i}
                    onClick={() => onSelectPlugin(p)}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
