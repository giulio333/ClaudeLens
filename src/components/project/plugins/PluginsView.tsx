import { usePlugins, InstalledPlugin } from '../../../hooks/useIPC';
import { TopBar } from '../shared/TopBar';
import { pluginComponentCount, pluginComponentGroups, skylineHeight } from './utils';

const COMPONENT_NAMES_CAP = 6;

function Skyline({ plugins, max }: { plugins: InstalledPlugin[]; max: number }) {
  return (
    <div className="cl-plugin-skyline">
      {plugins.map(p => (
        <div
          key={p.name}
          className="cl-plugin-bar"
          style={{ height: skylineHeight(pluginComponentCount(p), max) }}
        >
          {pluginComponentCount(p) > 0 && (
            <div
              className="cl-plugin-bar-fill"
              style={{
                height: `${Math.round((pluginComponentCount(p) / max) * 100)}%`,
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function ComponentGroups({ plugin }: { plugin: InstalledPlugin }) {
  const groups = pluginComponentGroups(plugin);
  if (!groups.length) {
    return (
      <div className="cl-plugin-comps cl-plugin-comps--none">
        no local components — MCP server only
      </div>
    );
  }
  return (
    <>
      {groups.map(g => {
        const shown = g.names.slice(0, COMPONENT_NAMES_CAP);
        const hidden = g.names.length - shown.length;
        return (
          <div className="cl-plugin-comp-group" key={g.kind}>
            <span className="cl-plugin-comp-kind">{g.kind}</span>
            {shown.map((name, i) => (
              <span className="cl-plugin-tag" key={name}>
                {name}
                {(i < shown.length - 1 || hidden > 0) && <span className="cl-plugin-tag-sep" />}
              </span>
            ))}
            {hidden > 0 && <span className="cl-plugin-tag cl-plugin-tag--more">+{hidden}</span>}
          </div>
        );
      })}
    </>
  );
}

function PluginRow({ plugin, onClick }: { plugin: InstalledPlugin; onClick: () => void }) {
  const hasComponents = pluginComponentCount(plugin) > 0;
  return (
    <button type="button" className="cl-plugin-row" onClick={onClick}>
      <span className={`cl-plugin-glyph${hasComponents ? '' : ' is-empty'}`}>
        {(plugin.name[0] ?? '?').toUpperCase()}
      </span>
      <div className="cl-plugin-main">
        <div className="cl-plugin-top">
          <span className="cl-plugin-name">{plugin.name}</span>
          {plugin.version && <span className="cl-plugin-ver">v{plugin.version}</span>}
        </div>
        {plugin.description && <div className="cl-plugin-desc">{plugin.description}</div>}
        <ComponentGroups plugin={plugin} />
      </div>
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
  const marketplaceCount = byMarketplace.size;
  // Global max, not per-group: bars stay comparable across marketplaces
  // instead of each group inventing its own scale.
  const globalMaxComponents = Math.max(1, ...(plugins ?? []).map(pluginComponentCount));

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>
      <TopBar onBack={onBack} crumbs={[{ label: 'Global · Plugins' }]} />

      <div className="flex-1 overflow-y-auto">
        <section className="cl-hero cl-hero--band">
          <div className="cl-eyebrow">
            <span className="pip" />
            <span>
              Global · <span className="path">~/.claude/plugins</span>
            </span>
          </div>
          <div className="cl-h-title">
            <h1 className="cl-h-name static">
              <span className="label-name">Plugins</span>
              <span className="glyph">.</span>
            </h1>
          </div>
          <div className="cl-h-meta">
            <span>
              <b>{total}</b> installed
            </span>
            {marketplaceCount > 0 && (
              <>
                <span className="sep">·</span>
                <span>
                  across <b>{marketplaceCount}</b>{' '}
                  {marketplaceCount === 1 ? 'marketplace' : 'marketplaces'}
                </span>
              </>
            )}
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
          <section className="cl-section cl-plugin-body">
            {[...byMarketplace.entries()].map(([marketplace, list]) => (
              <div key={marketplace} className="cl-plugin-mp-group">
                <div className="cl-plugin-mp-label">
                  {marketplace}
                  <span className="cl-plugin-mp-count">
                    · {list.length} {list.length === 1 ? 'plugin' : 'plugins'}
                  </span>
                </div>
                <Skyline plugins={list} max={globalMaxComponents} />
                {list.map(p => (
                  <PluginRow key={p.name} plugin={p} onClick={() => onSelectPlugin(p)} />
                ))}
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
