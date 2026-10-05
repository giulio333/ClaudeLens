import type { InitCommand } from '../../../types';

// Settings → Extensions listed every slash command the CLI reported as one flat
// column of names — over a hundred on a machine with a few plugins, unreadable.
// The handshake says enough to sort them by where they come from: a plugin's
// command is namespaced `plugin:name`, Claude Code's own carry `builtin`, and
// what is left is the user's and the project's. Only those two structured facts
// decide the group; the "(project)"/"(user)" suffix Claude Code writes into a
// description is prose, and stays prose.

export type CommandGroupKind = 'local' | 'plugin' | 'builtin' | 'unsorted';

export interface CommandRow {
  name: string;
  /** The part of `name` after `plugin:`, or the whole name. */
  shortName: string;
  description: string;
  argumentHint: string;
}

export interface CommandGroup {
  key: string;
  label: string;
  kind: CommandGroupKind;
  rows: CommandRow[];
}

export interface GroupedCommands {
  groups: CommandGroup[];
  /** False when only the bare names were available (no descriptions, and no
   *  way to tell Claude Code's own commands from the user's). */
  described: boolean;
  total: number;
}

const KIND_ORDER: Record<CommandGroupKind, number> = {
  local: 0,
  unsorted: 0,
  plugin: 1,
  builtin: 2,
};

function pluginOf(name: string): string | null {
  const i = name.indexOf(':');
  return i > 0 ? name.slice(0, i) : null;
}

/** Plugin descriptions arrive as "(acme) Does X"; under the "acme" heading the
 *  tag says nothing. Stripped only when it names this very plugin. */
function stripPluginTag(description: string, plugin: string | null): string {
  if (!plugin) return description;
  const tag = `(${plugin}) `;
  return description.startsWith(tag) ? description.slice(tag.length) : description;
}

function toRow(cmd: InitCommand, plugin: string | null): CommandRow {
  return {
    name: cmd.name,
    shortName: plugin ? cmd.name.slice(plugin.length + 1) : cmd.name,
    description: stripPluginTag(cmd.description, plugin),
    argumentHint: cmd.argumentHint,
  };
}

function placeOf(cmd: InitCommand, described: boolean): Omit<CommandGroup, 'rows'> {
  const plugin = pluginOf(cmd.name);
  if (plugin) return { key: `plugin:${plugin}`, label: plugin, kind: 'plugin' };
  if (!described) return { key: 'unsorted', label: 'Commands', kind: 'unsorted' };
  if (cmd.builtin) return { key: 'builtin', label: 'Built-in', kind: 'builtin' };
  return { key: 'local', label: 'Project & user', kind: 'local' };
}

/** Groups the handshake's commands; falls back to the bare `names` when the
 *  CLI's richer answer is missing. Rows keep the CLI's order within a group. */
export function groupSlashCommands(
  commands: InitCommand[] | undefined,
  names: string[]
): GroupedCommands {
  const described = (commands?.length ?? 0) > 0;
  const source: InitCommand[] = described
    ? (commands as InitCommand[])
    : names.map(name => ({ name, description: '', argumentHint: '', builtin: false }));

  const byKey = new Map<string, CommandGroup>();
  for (const cmd of source) {
    const place = placeOf(cmd, described);
    let group = byKey.get(place.key);
    if (!group) {
      group = { ...place, rows: [] };
      byKey.set(place.key, group);
    }
    group.rows.push(toRow(cmd, place.kind === 'plugin' ? place.label : null));
  }

  const groups = [...byKey.values()].sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.label.localeCompare(b.label)
  );
  return { groups, described, total: source.length };
}

/** Keeps the rows whose name or description holds `q` (already lower-case),
 *  and the groups that still have one. */
export function filterCommandGroups(groups: CommandGroup[], q: string): CommandGroup[] {
  if (!q) return groups;
  return groups.flatMap(g => {
    const rows = g.rows.filter(
      r => r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)
    );
    return rows.length ? [{ ...g, rows }] : [];
  });
}
