import { describe, expect, it } from 'vitest';
import { createTerminal, killTerminal, resolveClaudeCommand } from '../electron/modules/terminal-manager';

// End-to-end guard for the Windows terminal regression (#110): spawn the REAL
// `claude` CLI through node-pty exactly like the app does and assert it launches.
// `claude --version` needs no auth, so this runs on the CI matrix (win/linux/mac)
// with Claude Code installed — see the `terminal-integration` job. Gated on
// CLAUDE_E2E so `npm test` stays fast/offline in the normal verify job.
const E2E = process.env.CLAUDE_E2E === '1';

describe.skipIf(!E2E)('terminal spawn (real claude CLI)', () => {
  it('launches `claude --version` through the PTY without "File not found"', async () => {
    const { command, args } = resolveClaudeCommand(['--version']);

    let output = '';
    let termId: string | null = null;
    const exitCode = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (termId) killTerminal(termId);
        reject(new Error(`timed out waiting for claude --version. Output so far: ${output}`));
      }, 30_000);
      try {
        const term = createTerminal(
          { cwd: process.cwd(), command, args, env: process.env },
          {
            onData: d => {
              output += d;
            },
            onExit: code => {
              clearTimeout(timer);
              resolve(code);
            },
          }
        );
        termId = term.id;
      } catch (e) {
        clearTimeout(timer);
        reject(e);
      }
    });

    expect(output.toLowerCase()).not.toContain('file not found');
    expect(exitCode).toBe(0);
    // `claude --version` prints a semver — proof the CLI actually ran.
    expect(output).toMatch(/\d+\.\d+\.\d+/);
  }, 35_000);
});
