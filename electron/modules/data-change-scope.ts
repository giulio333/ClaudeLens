import { sep } from 'path';

// The `~/.claude` watcher emits `data:changed` on every disk event, and the
// renderer used to turn that into an invalidation of EVERY React Query cache.
// With a live chat appending to its transcript the burst is continuous, so every
// namespace was re-read even when the changed file could not possibly concern it
// (#148). This module classifies a changed path into the namespaces it can have
// touched; the renderer invalidates the union of a burst's scopes.
//
// Pure and I/O-free: it reads the path as text, never the disk.

export type DataScope =
  | 'sessions'
  | 'cost'
  | 'plans'
  | 'tasks'
  | 'teams'
  | 'workflows'
  | 'studio'
  | 'plugins'
  | 'memory'
  | 'claudeMd'
  | 'rules'
  | 'skills'
  | 'agents'
  | 'mcp';

/** Path segments, normalized over the platform separator. */
function segments(path: string): string[] {
  return path.split(sep === '\\' ? /[\\/]/ : '/').filter(Boolean);
}

/**
 * The namespaces a changed path can have touched.
 *
 * `null` means "unknown": the caller must invalidate everything. That is the
 * deliberate default — an unrecognized path must NEVER read as "nothing to
 * refresh", or a view would go silently stale.
 *
 * `claudeDir` is injectable for tests; normally `~/.claude`.
 */
export function scopesForPath(path: string, claudeDir: string): DataScope[] | null {
  const parts = segments(path);
  const root = segments(claudeDir);

  // Native workflows live in two places: the global ~/.claude/workflows and each
  // known project's `.claude/workflows` (outside ~/.claude). Recognize the second
  // before requiring the path to sit under the Claude root.
  const wfIdx = parts.lastIndexOf('workflows');
  if (wfIdx > 0 && parts[wfIdx - 1] === '.claude') return ['studio'];

  const insideClaudeDir = parts.length > root.length && root.every((seg, i) => parts[i] === seg);
  if (!insideClaudeDir) return null;

  const rest = parts.slice(root.length);
  switch (rest[0]) {
    case 'projects':
      return projectScopes(rest);
    case 'tasks':
      return ['tasks'];
    case 'plans':
      return ['plans'];
    case 'teams':
      return ['teams'];
    case 'workflows':
      return ['studio'];
    case 'plugins':
      return rest[1] === 'installed_plugins.json' ? ['plugins'] : null;
    default:
      return null;
  }
}

/**
 * `projects/<hash>/…`. Deliberately conservative: when in doubt include the
 * scope, and a path we cannot read returns `null` (= invalidate everything).
 *
 *  - session transcript (`<hash>/<id>.jsonl`, or `<hash>/sessions/<id>.jsonl`):
 *    besides sessions and cost this carries `plans`, because plan references
 *    live INSIDE the transcript (`plan_mode` attachments), and `memory`, which
 *    carries the topics' origin sessions.
 *  - `subagents/**`: sub-agent transcripts — they feed both the sub-agent panel
 *    and the teams (teammates are sidecar transcripts).
 *  - `workflows/**`: Workflow tool run state JSON. A workflow sub-agent
 *    transcript (`subagents/workflows/<runId>/agent-*.jsonl`) sits in both
 *    branches and takes both scopes.
 */
function projectScopes(rest: string[]): DataScope[] | null {
  // rest = ['projects', hash, …]
  if (rest.length < 3) return null; // the project dir itself: no idea what changed
  const tail = rest.slice(2);
  const scopes = new Set<DataScope>();

  const isSubagent = tail.includes('subagents');
  if (isSubagent) {
    scopes.add('sessions');
    scopes.add('teams');
  }
  if (tail.includes('workflows')) scopes.add('workflows');
  // Only top-level transcripts feed cost and plans: cost-tracker and plans-reader
  // glob `*.jsonl` non-recursively, never the sub-agent sidecars.
  if (!isSubagent && tail[tail.length - 1].endsWith('.jsonl')) {
    scopes.add('sessions');
    scopes.add('cost');
    scopes.add('plans');
    scopes.add('memory');
  }

  return scopes.size > 0 ? [...scopes] : null;
}
