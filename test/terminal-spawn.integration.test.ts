import { describe, expect, it } from 'vitest';
import {
  createTerminal,
  killTerminal,
  resizeTerminal,
  resolveClaudeCommand,
  writeTerminal,
} from '../electron/modules/terminal-manager';

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

// PTY plumbing (write/resize/kill) exercised with a generic `node` child — no
// claude, no auth, but still a real node-pty spawn on the actual OS. Same gate so
// it only runs in the CI matrix job where node-pty is rebuilt against Node.
describe.skipIf(!E2E)('terminal lifecycle (node-pty plumbing)', () => {
  it('round-trips input through writeTerminal and resizes without throwing', async () => {
    // Announces READY (so we write only once stdin is wired), echoes the first
    // line back with a marker, then exits.
    const script =
      "process.stdout.write('READY\\n');" +
      "let b='';process.stdin.on('data',d=>{b+=d.toString();" +
      "if(b.includes('\\n')){process.stdout.write('GOT:'+b.trim()+'\\n');process.exit(0);}});";

    let output = '';
    let wrote = false;
    let termId: string | null = null;
    const exitCode = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (termId) killTerminal(termId);
        reject(new Error(`timed out. Output so far: ${output}`));
      }, 15_000);
      const term = createTerminal(
        { cwd: process.cwd(), command: process.execPath, args: ['-e', script], env: process.env },
        {
          onData: d => {
            output += d;
            if (!wrote && output.includes('READY')) {
              wrote = true;
              resizeTerminal(term.id, 100, 40); // must not throw
              writeTerminal(term.id, 'ping\n');
            }
          },
          onExit: code => {
            clearTimeout(timer);
            resolve(code);
          },
        }
      );
      termId = term.id;
    });

    expect(output).toContain('GOT:ping');
    expect(exitCode).toBe(0);
  }, 20_000);

  it('killTerminal terminates a long-running child', async () => {
    const exited = await new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('killTerminal did not stop the child')), 15_000);
      const term = createTerminal(
        {
          cwd: process.cwd(),
          command: process.execPath,
          args: ['-e', 'setInterval(() => {}, 1000)'],
          env: process.env,
        },
        {
          onData: () => {},
          onExit: () => {
            clearTimeout(timer);
            resolve(true);
          },
        }
      );
      // Give the child a moment to come up, then kill it.
      setTimeout(() => killTerminal(term.id), 500);
    });

    expect(exited).toBe(true);
  }, 20_000);
});
