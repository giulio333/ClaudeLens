// Version comparison shared between the main process (update-checker, which
// asks GitHub whether a newer ClaudeLens exists) and the renderer (Settings →
// General, which checks the installed Claude Code against the version this
// build requires). It lives here rather than in `modules/update-checker.ts`
// because that module imports node's `https` — importing it from the renderer
// would pull the whole fetch path into the bundle for one pure function.

/**
 * Compare two version strings semver-style: negative when a < b, 0 when equal,
 * positive when a > b. Tolerates a leading `v` and compares dot-separated
 * numeric parts; a pre-release suffix (`-beta.1`) sorts *before* its release,
 * per semver. Anything non-numeric in a part is treated as 0.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): { nums: number[]; pre: string } => {
    const cleaned = v.trim().replace(/^v/i, '');
    const [core, ...preParts] = cleaned.split('-');
    const nums = core.split('.').map(p => {
      const n = parseInt(p, 10);
      return Number.isFinite(n) ? n : 0;
    });
    return { nums, pre: preParts.join('-') };
  };
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.nums.length, pb.nums.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0);
    if (diff !== 0) return diff;
  }
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return 1; // release > its own pre-release
  if (!pb.pre) return -1;
  return pa.pre < pb.pre ? -1 : 1;
}
