// What changed on disk, shared between the main process (which knows the path)
// and the renderer (which knows the React Query keys).
//
// Rationale: the watcher used to emit a bare `data:changed` and the renderer
// answered by invalidating ~24 query keys indiscriminately. During a live chat
// turn the transcript `.jsonl` is appended continuously, so every debounce
// window re-ran *every* project scan — including `teams:project` and
// `workflows:project`, which walk each session dir of the project. The watcher
// already knows the path that changed; classifying it here lets the renderer
// invalidate only the queries that path can possibly affect.
//
// Same shared-module regime as `chat-types.ts`/`studio-schema.ts`: it lives
// under `electron/` (main build rootDir) and is re-exported to the renderer.
// Keep it pure — no fs, no imports — since it is compiled under both module
// systems and unit-tested directly.

/** Coarse buckets of on-disk change, each mapping to the queries it can affect. */
export type DataChangeCategory =
  /** `projects/{hash}/{sessionId}.jsonl` — a session transcript. */
  | 'transcript'
  /** `projects/{hash}/{sessionId}/subagents/**` — sub-agent + teammate transcripts. */
  | 'subagents'
  /** Workflow-tool run state / agent transcripts of a run. */
  | 'workflow-runs'
  /** A project history folder itself appeared/disappeared. */
  | 'project-tree'
  /** `projects/{hash}/memory/**` — the user memory of a project. */
  | 'memory'
  | 'tasks'
  | 'plans'
  /** `~/.claude/teams/**` — the (stale-prone) team registry. */
  | 'teams'
  | 'plugins'
  /** Native workflow scripts (Agent Studio), global or project-local. */
  | 'studio'
  /** Unknown path, or an emitter with no path at all: invalidate everything. */
  | 'all';

/** Payload of the `data:changed` IPC event. */
export interface DataChangeEvent {
  categories: DataChangeCategory[];
}

/** Absolute roots the watcher observes (all derived from `CLAUDE_DIR`). */
export interface DataChangeRoots {
  projectsDir: string;
  tasksDir: string;
  plansDir: string;
  teamsDir: string;
  /** `~/.claude/plugins/installed_plugins.json`. */
  pluginsFile: string;
  /** `~/.claude/workflows` — the global native workflow scripts. */
  workflowsDir: string;
}

/** React Query keys (first element) affected by each category. */
export const QUERY_KEYS_BY_CATEGORY: Record<DataChangeCategory, readonly string[]> = {
  // A transcript append changes the session list, its chat, the cost rollups —
  // and the plans, whose only link to a project lives in the transcript's
  // `plan_mode` attachments.
  transcript: [
    'sessions:project',
    'sessions:chat',
    'cost:summary',
    'cost:project',
    'plans:project',
  ],
  subagents: ['sessions:subagents', 'sessions:subagentTranscript', 'teams:project', 'teams:detail'],
  'workflow-runs': ['workflows:project', 'workflows:run'],
  'project-tree': ['memory:projects', 'cost:summary', 'sessions:project', 'studio:all'],
  memory: ['memory:projects', 'memory:project'],
  tasks: ['tasks:project'],
  plans: ['plans:project'],
  teams: ['teams:project', 'teams:detail'],
  plugins: ['plugins:all'],
  studio: ['studio:all', 'studio:blueprint'],
  all: [
    'memory:projects',
    'memory:project',
    'cost:summary',
    'cost:project',
    'sessions:project',
    'sessions:chat',
    'sessions:subagents',
    'sessions:subagentTranscript',
    'claudeMd:hierarchy',
    'claudeMd:global',
    'rules:project',
    'tasks:project',
    'plans:project',
    'workflows:project',
    'workflows:run',
    'teams:project',
    'teams:detail',
    'skills:global',
    'skills:all',
    'agents:global',
    'agents:project',
    'mcp:global',
    'plugins:all',
    'studio:all',
    'studio:blueprint',
  ],
};

/** Normalize separators (Windows) and drop a trailing one. */
function norm(path: string): string {
  const unix = path.replace(/\\/g, '/');
  return unix.length > 1 && unix.endsWith('/') ? unix.slice(0, -1) : unix;
}

function isWithin(root: string, path: string): boolean {
  const r = norm(root);
  return path === r || path.startsWith(r + '/');
}

/** Path segments of `path` relative to `root` (`root` itself → `[]`). */
function relSegments(root: string, path: string): string[] {
  const rest = path.slice(norm(root).length).replace(/^\//, '');
  return rest ? rest.split('/') : [];
}

/** Inside `~/.claude/projects`: `{hash}/…`. */
function classifyProjectPath(segments: string[]): DataChangeCategory[] {
  // `projects/` itself or a project folder appearing/disappearing.
  if (segments.length <= 1) return ['project-tree'];
  const [, second, third, fourth] = segments;
  if (second === 'memory') return ['memory'];
  if (second.endsWith('.jsonl')) return ['transcript'];
  // `{hash}/{sessionId}/…` — the session's sidecar artifacts.
  if (third === 'workflows') return ['workflow-runs'];
  if (third === 'subagents') {
    return fourth === 'workflows' ? ['workflow-runs'] : ['subagents'];
  }
  // The session dir itself, or a sidecar shape we don't model: stay safe and
  // refresh both sidecar readers (rare — only on dir creation).
  return ['subagents', 'workflow-runs'];
}

/**
 * Which categories a changed path belongs to. Unknown paths fall back to
 * `['all']`, preserving the old invalidate-everything behavior.
 */
export function classifyChangedPath(path: string, roots: DataChangeRoots): DataChangeCategory[] {
  const p = norm(path);
  if (isWithin(roots.projectsDir, p)) {
    return classifyProjectPath(relSegments(roots.projectsDir, p));
  }
  if (isWithin(roots.tasksDir, p)) return ['tasks'];
  if (isWithin(roots.plansDir, p)) return ['plans'];
  if (isWithin(roots.teamsDir, p)) return ['teams'];
  if (isWithin(roots.pluginsFile, p)) return ['plugins'];
  if (isWithin(roots.workflowsDir, p)) return ['studio'];
  // Project-local native workflows: `<projectPath>/.claude/workflows/**`.
  const segments = p.split('/');
  const dot = segments.lastIndexOf('.claude');
  if (dot >= 0 && segments[dot + 1] === 'workflows') return ['studio'];
  return ['all'];
}

/** Own-property check: `'constructor' in obj` would pass through the prototype. */
function isKnownCategory(value: unknown): value is DataChangeCategory {
  return (
    typeof value === 'string' && Object.prototype.hasOwnProperty.call(QUERY_KEYS_BY_CATEGORY, value)
  );
}

/**
 * Categories carried by a `data:changed` payload, validated at the IPC boundary.
 * Anything unusable (no payload, wrong shape, only unknown category names) means
 * "something changed but we don't know what" → `['all']`, the old behavior.
 */
export function categoriesFromPayload(payload: unknown): DataChangeCategory[] {
  const raw = (payload as Partial<DataChangeEvent> | undefined | null)?.categories;
  if (!Array.isArray(raw)) return ['all'];
  const known = raw.filter(isKnownCategory);
  return known.length ? known : ['all'];
}

/** Union of the query keys of `categories`, order-stable and deduped. */
export function queryKeysForCategories(categories: Iterable<DataChangeCategory>): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const category of categories) {
    if (!isKnownCategory(category)) continue;
    for (const key of QUERY_KEYS_BY_CATEGORY[category]) {
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}
