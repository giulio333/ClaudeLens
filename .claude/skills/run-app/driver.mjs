/* global console, process */

// Interactive REPL front-end for humans. The commands themselves live in
// `app.mjs`, shared with the batch runner `run.mjs` — so a sequence worked out
// here can be pasted into a script file unchanged.
// Prereqs: `npx tsc -p tsconfig.electron.json` done and Vite running on :5173.
import * as fs from 'node:fs';
import * as readline from 'node:readline';
import { COMMANDS, runLine } from './app.mjs';

// Raw fd read: Electron steals process.stdin otherwise.
const stdin = fs.createReadStream(null, { fd: fs.openSync('/dev/stdin', 'r') });
const rl = readline.createInterface({ input: stdin, output: process.stdout, prompt: 'driver> ' });

rl.on('line', async line => {
  const cmd = line.trim().split(/\s+/)[0];
  if (cmd === 'help') {
    console.log('commands:', Object.keys(COMMANDS).join(', '), '| help');
  } else {
    try {
      await runLine(line);
    } catch (e) {
      console.log('ERROR:', e.message);
    }
  }
  if (cmd === 'quit') {
    rl.close();
    process.exit(0);
  }
  rl.prompt();
});

rl.on('close', async () => {
  await COMMANDS.quit();
  process.exit(0);
});

console.log('ClaudeLens driver — "launch" to start, "help" for commands');
rl.prompt();
