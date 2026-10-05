import { useMemo, useState } from 'react';
import type { InitInfo } from '../../../types';
import {
  filterCommandGroups,
  groupSlashCommands,
  type CommandGroup,
  type CommandRow,
} from './slash-command-groups';

/** Settings → Extensions' slash commands as an explorer, the Plugins page's
 *  idiom: the sources on the left (the user's and the project's, each plugin,
 *  Claude Code's own), the selected source's commands on the right, each with
 *  what it does. A search shows every match at once, grouped, so a command
 *  found in two sources is never hidden behind a click on the rail. */
export function SlashCommandList({ init, q }: { init: InitInfo | null; q: string }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const grouped = useMemo(
    () => groupSlashCommands(init?.commands, init?.slashCommands ?? []),
    [init]
  );
  if (!init) return <p className="set-dim">Runtime info unavailable.</p>;
  const visible = filterCommandGroups(grouped.groups, q);
  if (visible.length === 0) {
    return <p className="set-dim">{q ? 'No commands match.' : 'None.'}</p>;
  }
  const selected = visible.find(g => g.key === chosen) ?? visible[0];
  const shown = q ? visible : [selected];

  return (
    <div className="set-cx">
      <nav className="set-cx-rail" aria-label="Command sources">
        {railSections(visible).map(section => (
          <div key={section.title} className="set-cx-sec">
            <div className="set-cx-kicker">{section.title}</div>
            {section.groups.map(g => (
              <button
                key={g.key}
                type="button"
                className={`set-cx-node${!q && g === selected ? ' is-selected' : ''}`}
                aria-current={!q && g === selected ? 'true' : undefined}
                onClick={() => setChosen(g.key)}
              >
                <span className="name">{g.label}</span>
                <span className="ct">{g.rows.length}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="set-cx-pane">
        {!grouped.described && (
          <p className="set-cx-note">The CLI listed names only, so there are no descriptions.</p>
        )}
        {shown.map(g => (
          <CommandGroupView key={g.key} group={g} />
        ))}
      </div>
    </div>
  );
}

function railSections(groups: CommandGroup[]) {
  const sections = [
    { title: 'Yours', groups: groups.filter(g => g.kind === 'local' || g.kind === 'unsorted') },
    { title: 'Plugins', groups: groups.filter(g => g.kind === 'plugin') },
    { title: 'Claude Code', groups: groups.filter(g => g.kind === 'builtin') },
  ];
  return sections.filter(s => s.groups.length > 0);
}

const GROUP_NOTE: Record<CommandGroup['kind'], string> = {
  local: 'Defined by you or by this project',
  unsorted: 'Every command the CLI listed',
  plugin: 'Plugin',
  builtin: 'Built into Claude Code',
};

function CommandGroupView({ group }: { group: CommandGroup }) {
  const n = group.rows.length;
  return (
    <section className="set-cx-group" aria-label={group.label}>
      <header className="set-cx-head">
        <h3>{group.label}</h3>
        <span className="meta">
          {GROUP_NOTE[group.kind]} · {n} {n === 1 ? 'command' : 'commands'}
          {group.kind === 'plugin' && (
            <>
              {' · typed as '}
              <code>/{group.label}:…</code>
            </>
          )}
        </span>
      </header>
      <ul className="set-cx-list">
        {group.rows.map((row, i) => (
          <CommandLine key={`${row.name}#${i}`} row={row} />
        ))}
      </ul>
    </section>
  );
}

function CommandLine({ row }: { row: CommandRow }) {
  return (
    <li className="set-cx-row">
      <div className="cmd" title={`/${row.name}`}>
        <span className="slash">/</span>
        {row.shortName}
        {row.argumentHint && <span className="hint">{row.argumentHint}</span>}
      </div>
      {row.description && <p className="desc">{row.description}</p>}
    </li>
  );
}
