import { InstalledPlugin, Skill, Agent, PluginCommand } from '../../../hooks/useIPC';
import { EntityDetailView, EntityConfig } from '../shared/EntityDetailView';
import { initialOf } from '../shared/entityOptions';
import { SkillDetailView } from '../skills/SkillDetailView';
import { AgentDetailView } from '../agents/AgentDetailView';
import {
  describeHook,
  describeMcpServer,
  describeVersion,
  firstSentence,
  repoUrl,
  shortInstallPath,
} from './utils';
import { PluginIcon, PluginIconName } from './icons';

/** One thing a plugin provides, as the reader opened it from the plugin's page. */
export type PluginItem =
  | { kind: 'skill'; item: Skill }
  | { kind: 'agent'; item: Agent }
  | { kind: 'command'; item: PluginCommand };

/** Read-only detail for a plugin slash command (markdown body, no frontmatter editing). */
function CommandDetail({
  command,
  plugin,
  onBack,
}: {
  command: PluginCommand;
  plugin: InstalledPlugin;
  onBack: () => void;
}) {
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
  };
  return <EntityDetailView config={config} onBack={onBack} />;
}

/** The full-screen page of one skill, agent or command a plugin provides. */
export function PluginItemView({
  item,
  plugin,
  onBack,
}: {
  item: PluginItem;
  plugin: InstalledPlugin;
  onBack: () => void;
}) {
  if (item.kind === 'skill') return <SkillDetailView skill={item.item} onBack={onBack} readOnly />;
  if (item.kind === 'agent') return <AgentDetailView agent={item.item} onBack={onBack} readOnly />;
  return <CommandDetail command={item.item} plugin={plugin} onBack={onBack} />;
}

/* One entry of the index: the name in the column it is addressed by — mono
   for what you type after a slash, plain for an agent you name — and the
   opening sentence of what it is for. An entry with a page of its own is a
   button; a server or a hook has none, so it is text. */
function Entry({
  name,
  typed,
  description,
  onOpen,
}: {
  name: string;
  typed: boolean;
  description?: string;
  onOpen?: () => void;
}) {
  const nm = <span className={`nm${typed ? ' typed' : ''}`}>{name}</span>;
  const ds = (
    <span className="ds">{description ? firstSentence(description) : 'No description.'}</span>
  );
  return (
    <li>
      {onOpen ? (
        <button type="button" className="cl-plugin-entry" onClick={onOpen}>
          {nm}
          {ds}
        </button>
      ) : (
        <div className="cl-plugin-entry is-static">
          {nm}
          {ds}
        </div>
      )}
    </li>
  );
}

function Kind({
  icon,
  title,
  count,
  what,
  children,
}: {
  icon: PluginIconName;
  title: string;
  count: number;
  what: string;
  children: React.ReactNode;
}) {
  return (
    <section className="cl-plugin-kind">
      <h2>
        <span className="disc">
          <PluginIcon name={icon} />
        </span>
        {title} <span className="n">{count}</span>
      </h2>
      <p className="what">{what}</p>
      <ul>{children}</ul>
    </section>
  );
}

function Fact({
  icon,
  label,
  children,
  title,
}: {
  icon: PluginIconName;
  label: string;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <div className="cl-plugin-fact" title={title}>
      <span className="disc">
        <PluginIcon name={icon} />
      </span>
      <span className="lbl">{label}</span>
      <span className="val">{children}</span>
    </div>
  );
}

/* The facts that place the plugin, each behind the mark that names it: the
   marketplace it came from, the repo behind that marketplace, the version or
   commit pinned, who wrote it, and where it sits on disk. A fact the
   plugin does not carry is simply not there. */
function Facts({ plugin }: { plugin: InstalledPlugin }) {
  const version = describeVersion(plugin.version);
  const url = plugin.repo ? repoUrl(plugin.repo) : null;
  return (
    <div className="cl-plugin-facts">
      <Fact icon="marketplace" label="Marketplace">
        {plugin.marketplace}
      </Fact>
      {plugin.repo && (
        <Fact icon="source" label="Source">
          {url ? (
            <a href={url} target="_blank" rel="noreferrer">
              {plugin.repo}
            </a>
          ) : (
            plugin.repo
          )}
        </Fact>
      )}
      {version && (
        <Fact icon="version" label={version.label}>
          {version.value}
        </Fact>
      )}
      {plugin.author && (
        <Fact icon="author" label="Author">
          {plugin.author}
        </Fact>
      )}
      <Fact icon="location" label="Location" title={plugin.installPath}>
        {shortInstallPath(plugin.installPath)}
      </Fact>
    </div>
  );
}

/**
 * What one plugin provides, as an index: the plugin named and placed, then
 * its skills, agents and commands each under a heading that says in plain
 * words what that kind of thing is. This is the right pane of the Plugins
 * page — it owns no top bar and no navigation, the page around it decides
 * what an entry opens.
 */
export function PluginDetailView({
  plugin,
  onOpen,
}: {
  plugin: InstalledPlugin;
  onOpen: (item: PluginItem) => void;
}) {
  const empty =
    !plugin.skills.length &&
    !plugin.agents.length &&
    !plugin.commands.length &&
    !plugin.mcpServers.length &&
    !plugin.hooks.length;
  return (
    <article className="cl-plugin-page">
      <h1 className="cl-plugin-title">{plugin.name}</h1>
      {plugin.description && <p className="cl-plugin-summary">{plugin.description}</p>}
      <Facts plugin={plugin} />

      <div className="cl-plugin-index">
        {empty ? (
          <p className="cl-plugin-none">
            Nothing to list: this plugin declares no skills, agents, commands, MCP servers or hooks.
          </p>
        ) : (
          <>
            {plugin.skills.length > 0 && (
              <Kind
                icon="skill"
                title="Skills"
                count={plugin.skills.length}
                what="Things Claude knows how to do. It reaches for one when the task calls for it, or you call it by name."
              >
                {plugin.skills.map(s => (
                  <Entry
                    key={s.path}
                    name={`/${s.name}`}
                    typed
                    description={s.description}
                    onOpen={() => onOpen({ kind: 'skill', item: s })}
                  />
                ))}
              </Kind>
            )}
            {plugin.agents.length > 0 && (
              <Kind
                icon="agent"
                title="Agents"
                count={plugin.agents.length}
                what="Specialists Claude can hand a task to. Each one runs on its own, with its own instructions and tools."
              >
                {plugin.agents.map(a => (
                  <Entry
                    key={a.path}
                    name={a.name}
                    typed={false}
                    description={a.description}
                    onOpen={() => onOpen({ kind: 'agent', item: a })}
                  />
                ))}
              </Kind>
            )}
            {plugin.commands.length > 0 && (
              <Kind
                icon="command"
                title="Commands"
                count={plugin.commands.length}
                what="Slash commands you type in Claude Code."
              >
                {plugin.commands.map(c => (
                  <Entry
                    key={c.path}
                    name={`/${c.name}`}
                    typed
                    description={c.description}
                    onOpen={() => onOpen({ kind: 'command', item: c })}
                  />
                ))}
              </Kind>
            )}
            {plugin.mcpServers.length > 0 && (
              <Kind
                icon="mcp"
                title="MCP servers"
                count={plugin.mcpServers.length}
                what="Tools that come from an outside service, connected over MCP. Claude uses them like any other tool."
              >
                {plugin.mcpServers.map(m => (
                  <Entry key={m.name} name={m.name} typed description={describeMcpServer(m)} />
                ))}
              </Kind>
            )}
            {plugin.hooks.length > 0 && (
              <Kind
                icon="hook"
                title="Hooks"
                count={plugin.hooks.length}
                what="Commands Claude Code runs by itself at set moments, such as when a session starts or before a tool runs."
              >
                {plugin.hooks.map((h, i) => (
                  <Entry
                    key={`${h.event}-${i}`}
                    name={h.event}
                    typed={false}
                    description={describeHook(h)}
                  />
                ))}
              </Kind>
            )}
          </>
        )}
      </div>
    </article>
  );
}
