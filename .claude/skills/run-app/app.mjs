/* global console, document, process */

// Shared core for the two front-ends: `driver.mjs` (interactive REPL) and
// `run.mjs` (batch, for agents). Both speak the same command vocabulary, so a
// sequence worked out at the REPL can be pasted into a script file verbatim.
import * as path from 'node:path';
import * as fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const APP_DIR = path.resolve(import.meta.dirname, '../../..');
export const SHOT_DIR = process.env.SCREENSHOT_DIR || '/tmp/claudelens-shots';

const electronBin =
  process.platform === 'darwin'
    ? path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    : path.join(APP_DIR, 'node_modules/electron/dist/electron');

let app = null;
let page = null;
const pageErrors = [];

export const hasPage = () => page !== null;

/** In dev the main process opens DevTools alongside the window, and Playwright's
 *  `firstWindow()` hands back whichever appeared first — often the DevTools one,
 *  whose DOM has none of the app in it. Pick by URL instead of by arrival. */
async function appWindow() {
  for (let i = 0; i < 60; i++) {
    for (const w of app.windows()) {
      if (!w.url().startsWith('devtools://')) return w;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('app window never appeared (only DevTools)');
}

export const COMMANDS = {
  async launch(mode) {
    if (app) return console.log('already launched');
    const { _electron: electron } = (
      await import(pathToFileURL(path.join(APP_DIR, 'node_modules/playwright-core/index.js')))
    ).default;
    app = await electron.launch({
      executablePath: electronBin,
      args: process.platform === 'linux' ? ['--no-sandbox', APP_DIR] : [APP_DIR],
      env: { ...process.env, ...(mode === 'real' ? {} : { SCREENSHOT_MODE: 'true' }) },
      timeout: 30_000,
    });
    await app.firstWindow();
    page = await appWindow();
    page.on('pageerror', e => pageErrors.push(e.stack || e.message));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2500);
    console.log('launched:', page.url());
  },

  /** Back to the global home. Navigation is client-side state with no router,
   *  and the detail views (a skill, a plan) hide the top bar entirely — so from
   *  one of those there is nothing to click your way home with. */
  async reset() {
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2500);
    console.log('reset');
  },

  async ss(name) {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const f = path.join(SHOT_DIR, `${name || 'ss-' + Date.now()}.png`);
    await page.screenshot({ path: f });
    console.log('shot:', f);
  },

  // DOM click (not coordinates): exact text match first, then substring.
  async 'click-text'(text) {
    const r = await page.evaluate(t => {
      const els = [
        ...document.querySelectorAll('button, a, [role="button"], .cl-tile, [class*=card]'),
      ];
      const el =
        els.find(e => e.textContent?.trim() === t) ?? els.find(e => e.textContent?.includes(t));
      if (!el) return 'NOT_FOUND';
      el.click();
      return 'OK:' + el.tagName;
    }, text);
    console.log('click-text', JSON.stringify(text), '→', r);
    if (r === 'NOT_FOUND') throw new Error(`click-text not found: ${text}`);
    await page.waitForTimeout(1200);
  },

  async click(sel) {
    const r = await page.evaluate(s => {
      const el = document.querySelector(s);
      if (!el) return 'NOT_FOUND';
      el.click();
      return 'OK';
    }, sel);
    console.log('click', sel, '→', r);
    if (r === 'NOT_FOUND') throw new Error(`click not found: ${sel}`);
    await page.waitForTimeout(1200);
  },

  async wait(sel) {
    try {
      await page.waitForSelector(sel, { timeout: 10_000 });
      console.log('found:', sel);
    } catch {
      throw new Error(`TIMEOUT waiting for ${sel}`);
    }
  },

  async sleep(ms) {
    await page.waitForTimeout(Number(ms) || 1000);
  },

  async text(sel) {
    console.log(
      await page.evaluate(
        s => (s ? document.querySelector(s) : document.body)?.innerText ?? '(null)',
        sel || null
      )
    );
  },

  async eval(expr) {
    console.log(JSON.stringify(await page.evaluate(expr)));
  },

  async theme(t) {
    await page.evaluate(v => document.documentElement.setAttribute('data-theme', v), t || 'dark');
    await page.waitForTimeout(400);
    console.log('theme:', t || 'dark');
  },

  /** Console errors seen since launch — the error boundary's "Something went
   *  wrong" card carries no stack, this does. */
  async errors() {
    console.log(pageErrors.length ? pageErrors.join('\n---\n') : '(none)');
  },

  async quit() {
    if (app) await app.close().catch(() => {});
    app = null;
    page = null;
    pageErrors.length = 0;
  },
};

/** Run one `<cmd> <rest…>` line. Unknown commands and pre-launch commands are
 *  reported rather than thrown, so the REPL survives a typo. */
export async function runLine(line) {
  const [cmd, ...rest] = line.trim().split(/\s+/);
  if (!cmd) return;
  const fn = COMMANDS[cmd];
  if (!fn) {
    console.log('unknown:', cmd, '— try:', Object.keys(COMMANDS).join(', '));
    return;
  }
  if (cmd !== 'launch' && cmd !== 'quit' && !page) {
    console.log('ERROR: launch first');
    return;
  }
  await fn(rest.join(' '));
}
