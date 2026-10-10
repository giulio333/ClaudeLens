import type { SettingsSourceEntry } from '../../../types';
import { homeRelativePath } from '../shared/projectName';

// The settings cascade, read for the two questions the Config pages answer:
// "which file set this value?" (the stamp on a row) and "what does this project
// change?" (the project filter). Everything here is derived from the tiers the
// Agent SDK's `resolveSettings` returns — nothing is read from disk again.

export type SettingsTier = 'user' | 'project' | 'local' | 'flag' | 'managed';

const TIER_LABEL: Record<SettingsTier, string> = {
  user: 'User',
  project: 'Project',
  local: 'Local',
  flag: 'Flag',
  managed: 'Managed',
};

/** The three tiers that are files a person edits, lowest precedence first. */
const FILE_TIERS: SettingsTier[] = ['user', 'project', 'local'];

/**
 * The tier a source name stands for, or `null` for one this app has no name for.
 *
 * `resolveSettings` says `user` / `project` / `local` / `flag` / `managed`; the
 * permission API and older captures say `userSettings` / `policySettings`. Both
 * spellings reach the renderer, and a stamp that printed whichever one arrived
 * showed two names for one file.
 */
export function settingsTier(source: string): SettingsTier | null {
  switch (source) {
    case 'user':
    case 'userSettings':
      return 'user';
    case 'project':
    case 'projectSettings':
      return 'project';
    case 'local':
    case 'localSettings':
      return 'local';
    case 'flag':
    case 'flagSettings':
      return 'flag';
    case 'managed':
    case 'policySettings':
      return 'managed';
    default:
      return null;
  }
}

/** What a source stamp prints. An unknown source keeps its own name. */
export function sourceLabel(source: string): string {
  const tier = settingsTier(source);
  return tier ? TIER_LABEL[tier] : source;
}

/** True for the tiers that live in the project: its shared and its local file. */
export function isProjectTier(source: string): boolean {
  const tier = settingsTier(source);
  return tier === 'project' || tier === 'local';
}

/**
 * A settings file as the page prints it: relative to the project for the
 * project's own tiers, `~/…` for everything else. Never for the user tier
 * against the project root — in the global scope the "project" is the home
 * directory, and `~/.claude/settings.json` would lose its `~/`.
 */
export function settingsFilePath(path: string, source: string, projectRoot: string): string {
  if (isProjectTier(source) && path.startsWith(projectRoot + '/')) {
    return path.slice(projectRoot.length + 1);
  }
  return homeRelativePath(path);
}

export interface CascadeTier {
  /** Stable key: the tier, or the raw source name for one without a tier. */
  key: string;
  label: string;
  /** A tier of this project (its shared or local file). */
  here: boolean;
  /** Display path, `null` when the SDK reported no file for the tier. */
  path: string | null;
  /** Top-level keys the tier sets. Zero is an answer: the tier sets nothing. */
  keys: number;
}

function tierCell(
  key: string,
  label: string,
  entries: SettingsSourceEntry[],
  projectRoot: string
): CascadeTier {
  const keys = new Set<string>();
  for (const e of entries) for (const k of Object.keys(e.settings)) keys.add(k);
  const withPath = entries.find(e => e.path);
  return {
    key,
    label,
    here: entries.length > 0 ? isProjectTier(entries[0].source) : isProjectTier(key),
    path: withPath?.path ? settingsFilePath(withPath.path, withPath.source, projectRoot) : null,
    keys: keys.size,
  };
}

/**
 * The cascade as a legend, lowest precedence first, so "later wins" reads left
 * to right. User, Project and Local are always there — a tier that sets nothing
 * is the fact a reader is looking for — and a flag or managed tier joins only
 * when the SDK returned one.
 */
export function settingsCascade(
  sources: SettingsSourceEntry[],
  projectRoot: string
): CascadeTier[] {
  const out = FILE_TIERS.map(tier =>
    tierCell(
      tier,
      TIER_LABEL[tier],
      sources.filter(s => settingsTier(s.source) === tier),
      projectRoot
    )
  );
  const seen = new Set<string>();
  for (const s of sources) {
    const tier = settingsTier(s.source);
    if (tier && FILE_TIERS.includes(tier)) continue;
    const key = tier ?? s.source;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(
      tierCell(
        key,
        sourceLabel(s.source),
        sources.filter(x => (settingsTier(x.source) ?? x.source) === key),
        projectRoot
      )
    );
  }
  return out;
}

const SETTING_LABEL: Record<string, string> = {
  model: 'Configured model',
  theme: 'CLI theme',
  language: 'Language',
  effortLevel: 'Effort level',
  cleanupPeriodDays: 'Transcript retention',
  permissions: 'Permissions',
};

/** The datasheet's name for a settings key; an unlisted key keeps its own. */
export function settingLabel(key: string): string {
  return SETTING_LABEL[key] ?? key;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Allow + ask + deny in a `permissions` object. Absent lists count as none. */
export function permissionRuleCount(permissions: unknown): number {
  if (!isRecord(permissions)) return 0;
  return (['allow', 'ask', 'deny'] as const).reduce(
    (n, kind) =>
      n + (Array.isArray(permissions[kind]) ? (permissions[kind] as unknown[]).length : 0),
    0
  );
}

function permissionsSummary(p: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const kind of ['allow', 'ask', 'deny'] as const) {
    const n = Array.isArray(p[kind]) ? (p[kind] as unknown[]).length : 0;
    if (n > 0) parts.push(`${n} ${kind}`);
  }
  if (typeof p.defaultMode === 'string') parts.push(`mode ${p.defaultMode}`);
  const dirs = Array.isArray(p.additionalDirectories) ? p.additionalDirectories.length : 0;
  if (dirs > 0) parts.push(count(dirs, 'extra directory', 'extra directories'));
  return parts.length > 0 ? parts.join(' · ') : 'no rules';
}

/**
 * One line for a value a settings file sets. A scalar is printed; a structure is
 * counted, never dumped — a `hooks` or `env` object as JSON would be the longest
 * thing on the page and still not readable.
 */
export function settingValue(key: string, value: unknown): string {
  if (key === 'permissions' && isRecord(value)) return permissionsSummary(value);
  if (key === 'cleanupPeriodDays' && typeof value === 'number') return count(value, 'day', 'days');
  if (Array.isArray(value)) return count(value.length, 'entry', 'entries');
  if (isRecord(value)) return count(Object.keys(value).length, 'key', 'keys');
  return String(value);
}

export interface ProjectSetting {
  key: string;
  label: string;
  value: string;
  source: string;
  path: string | null;
}

/**
 * What this project's own files set, tier by tier, in the order the files list
 * their keys. Read from each tier's raw settings rather than from `provenance`:
 * provenance names one winner per top-level key, so a `permissions` object the
 * user and the project both contribute to would be credited to one of them.
 * A key both project tiers set appears once per tier — the local one wins, and
 * the page should show that there are two.
 */
export function projectSettings(
  sources: SettingsSourceEntry[],
  projectRoot: string
): ProjectSetting[] {
  return sources
    .filter(s => isProjectTier(s.source))
    .flatMap(s =>
      Object.entries(s.settings).map(([key, value]) => ({
        key,
        label: settingLabel(key),
        value: settingValue(key, value),
        source: s.source,
        path: s.path ? settingsFilePath(s.path, s.source, projectRoot) : null,
      }))
    );
}
