/* global console, process */

// Batch front-end: runs a script of driver commands to completion, one at a
// time, and exits non-zero on the first failure.
//
// This is the path for agents. The REPL needs a pty to hold its stdin open —
// the documented recipe wraps it in tmux, which is not installed everywhere —
// and piping into it does not work: readline emits every line at once and the
// async handlers interleave. Here each command is awaited before the next.
//
//   node .claude/skills/run-app/run.mjs shots.txt
//   node .claude/skills/run-app/run.mjs - <<'EOF'
//   launch
//   theme light
//   ss home
//   EOF
//
// Blank lines and `#` comments are skipped. `quit` is always run at the end,
// including after a failure, so no Electron process is left behind.
import * as fs from 'node:fs';
import { COMMANDS, runLine, SHOT_DIR } from './app.mjs';

const arg = process.argv[2];
if (!arg) {
  console.error('usage: run.mjs <script-file>|-   (- reads stdin)');
  process.exit(2);
}

const source = arg === '-' ? fs.readFileSync(0, 'utf-8') : fs.readFileSync(arg, 'utf-8');
const lines = source
  .split('\n')
  .map(l => l.trim())
  .filter(l => l && !l.startsWith('#'));

console.log(`running ${lines.length} commands · screenshots → ${SHOT_DIR}`);

let failed = null;
for (const line of lines) {
  if (line === 'quit') continue; // run once, at the end
  try {
    await runLine(line);
  } catch (e) {
    failed = `${line} → ${e.message}`;
    console.error('FAILED:', failed);
    break;
  }
}

await COMMANDS.quit();
if (failed) process.exit(1);
console.log('done');
