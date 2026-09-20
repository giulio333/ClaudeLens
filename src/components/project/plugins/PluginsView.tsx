import { useState, KeyboardEvent } from 'react';
import { usePlugins, InstalledPlugin } from '../../../hooks/useIPC';
import { TopBar } from '../shared/TopBar';
import { PluginIcon } from './icons';
import { PluginDetailView, PluginItem, PluginItemView } from './PluginDetailView';
import {
  groupByMarketplace,
  pluginComponentCount,
  pluginComponentSummary,
  PluginKey,
  samePlugin,
  stepPlugin,
} from './utils';

function Chevron() {
  return (
    <svg className="tri" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M3.5 2l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function PluginNode({
  plugin,
  selected,
  onSelect,
}: {
  plugin: InstalledPlugin;
  selected: boolean;
  onSelect: () => void;
}) {
  const count = pluginComponentCount(plugin);
  return (
    <button
      type="button"
      className={`cl-plugin-node${selected ? ' is-selected' : ''}`}
      aria-current={selected ? 'true' : undefined}
      onClick={onSelect}
      title={pluginComponentSummary(plugin)}
    >
      <PluginIcon name="plugin" size={14} />
      <span className="name">{plugin.name}</span>
      {count > 0 && <span className="ct">{count}</span>}
    </button>
  );
}

function MarketplaceNode({
  marketplace,
  plugins,
  expanded,
  selected,
  onToggle,
  onSelect,
}: {
  marketplace: string;
  plugins: InstalledPlugin[];
  expanded: boolean;
  selected: PluginKey | null;
  onToggle: () => void;
  onSelect: (plugin: InstalledPlugin) => void;
}) {
  // Every plugin of a marketplace carries the same source repo.
  const repo = plugins.find(p => p.repo)?.repo;
  return (
    <div className="cl-plugin-mp">
      <button
        type="button"
        className="cl-plugin-mp-node"
        aria-expanded={expanded}
        onClick={onToggle}
        title={repo}
      >
        <Chevron />
        <PluginIcon name="marketplace" size={14} />
        <span className="name">{marketplace}</span>
        <span className="ct">
          {plugins.length} {plugins.length === 1 ? 'plugin' : 'plugins'}
        </span>
      </button>
      {expanded && (
        <div className="cl-plugin-children">
          {plugins.map(p => (
            <PluginNode
              key={p.name}
              plugin={p}
              selected={selected !== null && samePlugin(p, selected)}
              onSelect={() => onSelect(p)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The Plugins page as an explorer: the tree on the left is the hierarchy —
 * marketplaces as folders, the plugins they gave you as their children — and
 * the pane on the right is the selected plugin's own page. A tile clicked in
 * that pane opens full-screen, and Back lands on the same selection.
 */
export function PluginsView({ onBack }: { onBack: () => void }) {
  const { data: plugins, isLoading } = usePlugins();
  const [selectedKey, setSelectedKey] = useState<PluginKey | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState<PluginItem | null>(null);

  const list = plugins ?? [];
  const groups = groupByMarketplace(list);
  // The selection is a key, not an object, so a watcher refresh (install,
  // update) re-resolves it against the fresh list; a plugin that went away
  // falls back to the first one rather than leaving the pane on stale data.
  const selected = (selectedKey && list.find(p => samePlugin(p, selectedKey))) || list[0] || null;

  if (open && selected) {
    return <PluginItemView item={open} plugin={selected} onBack={() => setOpen(null)} />;
  }

  const toggle = (marketplace: string) =>
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(marketplace)) next.delete(marketplace);
      else next.add(marketplace);
      return next;
    });

  const onTreeKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const visible = list.filter(p => !collapsed.has(p.marketplace));
    const next = stepPlugin(visible, selected, e.key === 'ArrowDown' ? 1 : -1);
    if (next) setSelectedKey({ marketplace: next.marketplace, name: next.name });
  };

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>
      <TopBar onBack={onBack} crumbs={[{ label: 'Global · Plugins' }]} />

      {isLoading ? (
        <section className="cl-section">
          <p style={{ color: 'var(--cl-ink-3)', fontSize: 13 }}>Loading…</p>
        </section>
      ) : list.length === 0 ? (
        <section className="cl-section">
          <div className="cl-empty">
            No plugins installed. Install one with{' '}
            <code style={{ fontFamily: 'var(--font-mono)' }}>/plugin</code> in Claude Code.
          </div>
        </section>
      ) : (
        <div className="cl-plugin-split">
          <aside className="cl-plugin-tree" onKeyDown={onTreeKey}>
            <div className="cl-plugin-tree-head">
              <h1 className="cl-plugin-tree-title">
                Plugins<span className="glyph">.</span>
              </h1>
              <p className="cl-plugin-tree-lede">
                A marketplace is a catalogue you install plugins from. Each plugin adds skills,
                agents, commands, MCP servers or hooks to Claude Code.
              </p>
              <p className="cl-plugin-tree-path">~/.claude/plugins</p>
            </div>
            <h2 className="cl-plugin-tree-kicker">Marketplaces</h2>
            {[...groups.entries()].map(([marketplace, mpPlugins]) => (
              <MarketplaceNode
                key={marketplace}
                marketplace={marketplace}
                plugins={mpPlugins}
                expanded={!collapsed.has(marketplace)}
                selected={selected}
                onToggle={() => toggle(marketplace)}
                onSelect={p => setSelectedKey({ marketplace: p.marketplace, name: p.name })}
              />
            ))}
          </aside>
          <div className="cl-plugin-pane">
            {selected && <PluginDetailView plugin={selected} onOpen={setOpen} />}
          </div>
        </div>
      )}
    </div>
  );
}
