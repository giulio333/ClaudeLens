export type Project = { hash: string; realPath: string };

/** The project a cwd belongs to. Exact match first, then the longest known
 *  project the cwd sits inside — a session started in `packages/api` of a
 *  monorepo belongs to the repo, not to nothing. */
export function projectForCwd(cwd: string | null, projects: Project[]): Project | null {
  if (!cwd) return null;
  let best: Project | null = null;
  for (const p of projects) {
    if (p.realPath === cwd) return p;
    if (cwd.startsWith(p.realPath + '/') && (!best || p.realPath.length > best.realPath.length)) {
      best = p;
    }
  }
  return best;
}
