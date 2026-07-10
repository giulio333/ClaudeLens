/* global console, document, process */

// REPL driver for ClaudeLens: launches the Electron app (SCREENSHOT_MODE mock
// data by default) and exposes stdin commands for agents/humans to drive the UI.
// Prereqs: `npx tsc -p tsconfig.electron.json` done and Vite running on :5173.
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as readline from 'node:readline';
import { pathToFileURL } from 'node:url';

const APP_DIR = path.resolve(import.meta.dirname, '../../..');
const SHOT_DIR = process.env.SCREENSHOT_DIR || '/tmp/claudelens-shots';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const { _electron: electron } = (
  await import(pathToFileURL(path.join(APP_DIR, 'node_modules/playwright-core/index.js')))
).default;

const electronBin =
  process.platform === 'darwin'
    ? path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    : path.join(APP_DIR, 'node_modules/electron/dist/electron');

let app = null;
let page = null;

const COMMANDS = {
  async launch(mode) {
    if (app) return console.log('already launched');
    app = await electron.launch({
      executablePath: electronBin,
      args: process.platform === 'linux' ? ['--no-sandbox', APP_DIR] : [APP_DIR],
      env: { ...process.env, ...(mode === 'real' ? {} : { SCREENSHOT_MODE: 'true' }) },
      timeout: 30_000,
    });
    page = await app.firstWindow();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2500);
    console.log('launched:', page.url());
  },
  async ss(name) {
    const f = path.join(SHOT_DIR, `${name || 'ss-' + Date.now()}.png`);
    await page.screenshot({ path: f });
    console.log('shot:', f);
  },
  // DOM click (not coordinates): exact text match first, then substring.
  async 'click-text'(text) {
    const r = await page.evaluate(t => {
      const els = [...document.querySelectorAll('button, a, [role="button"], .cl-tile, [class*=card]')];
      const el = els.find(e => e.textContent?.trim() === t) ?? els.find(e => e.textContent?.includes(t));
      if (!el) return 'NOT_FOUND';
      el.click();
      return 'OK:' + el.tagName;
    }, text);
    console.log('click-text', JSON.stringify(text), '→', r);
  },
  async click(sel) {
    const r = await page.evaluate(s => {
      const el = document.querySelector(s);
      if (!el) return 'NOT_FOUND';
      el.click();
      return 'OK';
    }, sel);
    console.log('click', sel, '→', r);
  },
  async wait(sel) {
    try {
      await page.waitForSelector(sel, { timeout: 10_000 });
      console.log('found:', sel);
    } catch {
      console.log('TIMEOUT:', sel);
    }
  },
  async text(sel) {
    console.log(
      await page.evaluate(s => (s ? document.querySelector(s) : document.body)?.innerText ?? '(null)', sel || null)
    );
  },
  async eval(expr) {
    try {
      console.log(JSON.stringify(await page.evaluate(expr)));
    } catch (e) {
      console.log('ERROR:', e.message);
    }
  },
  async theme(t) {
    await page.evaluate(v => document.documentElement.setAttribute('data-theme', v), t || 'dark');
    console.log('theme:', t || 'dark');
  },
  async quit() {
    if (app) await app.close().catch(() => {});
    app = null;
    page = null;
  },
  help() {
    console.log('commands:', Object.keys(COMMANDS).join(', '));
  },
};

// Raw fd read: Electron steals process.stdin otherwise.
const stdin = fs.createReadStream(null, { fd: fs.openSync('/dev/stdin', 'r') });
const rl = readline.createInterface({ input: stdin, output: process.stdout, prompt: 'driver> ' });
rl.on('line', async line => {
  const [cmd, ...rest] = line.trim().split(/\s+/);
  const fn = COMMANDS[cmd];
  if (!cmd) return rl.prompt();
  if (!fn) console.log('unknown:', cmd, '— try: help');
  else if (cmd !== 'launch' && cmd !== 'help' && cmd !== 'quit' && !page) console.log('ERROR: launch first');
  else {
    try {
      await fn(rest.join(' '));
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
