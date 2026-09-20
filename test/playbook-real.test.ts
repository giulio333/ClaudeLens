import { mkdtemp, readdir, rm } from 'fs/promises';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { scanPromptCandidates } from '../electron/modules/playbook-reader';

// Read-only probe: reports aggregate counts and time, never prompts or project names.
it.skipIf(process.env.CLAUDELENS_PLAYBOOK_CORPUS !== '1')(
  'measures suggestions on local project history',
  async () => {
    const projects = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects');
    const temporary = await mkdtemp(join(tmpdir(), 'playbook-probe-'));
    const started = performance.now();
    const totals = {
      projects: 0,
      sessions: 0,
      candidates: 0,
      partialProjects: 0,
      failedProjects: 0,
      elapsedMs: 0,
    };
    try {
      for (const entry of await readdir(projects, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^[a-zA-Z0-9_-]{1,255}$/.test(entry.name)) continue;
        totals.projects++;
        try {
          const result = await scanPromptCandidates(projects, temporary, entry.name);
          totals.sessions += result.scannedSessions;
          totals.candidates += result.candidates.length;
          if (result.truncated) totals.partialProjects++;
        } catch {
          totals.failedProjects++;
        }
      }
      totals.elapsedMs = Math.round(performance.now() - started);
      console.log('Playbook corpus probe:', JSON.stringify(totals));
      expect(totals.projects).toBeGreaterThan(0);
      expect(totals.failedProjects).toBe(0);
      expect(await readdir(temporary)).toEqual([]);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  },
  120_000
);
