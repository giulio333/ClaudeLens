import type { InstalledPlugin } from '../../../hooks/useIPC';

/** Total skills + agents + commands a plugin carries — the "richness" the
 * skyline bars and glyph tinting encode. */
export function pluginComponentCount(plugin: InstalledPlugin): number {
  return plugin.skills.length + plugin.agents.length + plugin.commands.length;
}

export interface ComponentGroup {
  kind: 'skills' | 'agents' | 'commands';
  names: string[];
}

/** Component names grouped by kind, skipping empty kinds — this is what the
 * row prints instead of a bare count, so a reader can see *what* a plugin
 * does, not just how much of it there is. Command names keep their leading
 * `/`, matching how Claude Code addresses them. */
export function pluginComponentGroups(plugin: InstalledPlugin): ComponentGroup[] {
  const groups: ComponentGroup[] = [];
  if (plugin.skills.length) groups.push({ kind: 'skills', names: plugin.skills.map(s => s.name) });
  if (plugin.agents.length) groups.push({ kind: 'agents', names: plugin.agents.map(a => a.name) });
  if (plugin.commands.length)
    groups.push({ kind: 'commands', names: plugin.commands.map(c => `/${c.name}`) });
  return groups;
}

const SKYLINE_MIN_PX = 14;
const SKYLINE_MAX_PX = 60;

/** Bar height for the marketplace skyline: a square-root curve against the
 * richest plugin on the page, so one plugin with 19 components doesn't
 * flatten every other bar to a sliver, and a plugin with zero components
 * still reads as a bar (the floor), not a gap. `max` is the global count
 * across every installed plugin, so bars stay comparable across marketplace
 * groups, not just within one. */
export function skylineHeight(count: number, max: number): number {
  if (max <= 0) return SKYLINE_MIN_PX;
  const ratio = Math.sqrt(Math.min(count, max) / max);
  return Math.round(SKYLINE_MIN_PX + (SKYLINE_MAX_PX - SKYLINE_MIN_PX) * ratio);
}
