import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, session, shell } from 'electron';
import { basename, delimiter, isAbsolute, join, sep } from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { execFile, spawn, ChildProcess } from 'child_process';

import { listProjectsWithMemory, readMemory } from './modules/memory-reader';
import { createTopic, updateTopic, deleteTopic, TopicInput } from './modules/memory-writer';
import {
  calculateCostSummary,
  getSessionList,
  getProjectUsage,
  getPricingMeta,
} from './modules/cost-tracker';
import {
  readGlobalClaudeMd,
  getClaudeMdHierarchy,
  writeClaudeMdFile,
} from './modules/claude-md-reader';
import { readProjectRules } from './modules/rules-reader';
import { readChatSessionViaSdk, readSubagentTranscriptViaSdk } from './modules/session-reader';
import { readSessionSubagentsViaSdk } from './modules/subagents-reader';
import { getSessionArtifacts, deleteSessionArtifacts } from './modules/session-deleter';
import { getProjectTasks } from './modules/tasks-reader';
import { getProjectPlans } from './modules/plans-reader';
import { getGlobalSkills, getAllSkills } from './modules/skills-reader';
import { getGlobalAgents, getProjectAgents } from './modules/agents-reader';
import { getInstalledPlugins } from './modules/plugins-reader';
import { createSkill, SkillInput } from './modules/skills-writer';
import { createAgent, AgentInput } from './modules/agents-writer';
import { getGlobalMcp } from './modules/mcp-reader';
import { readEffectiveConfig } from './modules/config-reader';
import {
  ChatSession,
  ChatSessionParams,
  CanUseTool,
  PermissionResult,
  PermissionUpdate,
} from './modules/chat-runner';
import type { PermissionDecision } from './shared/chat-types';
import { readPrefs, setPref } from './modules/prefs-store';
import { checkForUpdates, RELEASES_PAGE_URL } from './modules/update-checker';
import { initTelemetry, track, trackExit, isTelemetryEnabled, setTelemetryEnabled } from './modules/telemetry';
import {
  createTerminal,
  writeTerminal,
  resizeTerminal,
  killTerminal,
  disposeAllTerminals,
  resolveClaudeCommand,
} from './modules/terminal-manager';
import { readActiveSessions, defaultSessionsDir } from './modules/sessions-registry-reader';
import {
  createRegistryDiffState,
  diffRegistry,
} from './modules/notifications/registry-diff';
import {
  NOTIFY_ENABLED_KEY,
  NOTIFY_OS_KEY,
  DEFAULT_NOTIFY_PREFS,
  type NotificationEvent,
  type NotificationKind,
  type NotificationPrefs,
} from './modules/notifications/types';
import { getBgSessions } from './modules/bg-sessions-reader';
import { startLiveMonitor, stopLiveMonitor } from './modules/live-monitor';
import { detectDuplicateProjects } from './modules/duplicate-detector';
import { computeMergePlan } from './modules/duplicate-merger';
import { executeMerge } from './modules/duplicate-merge-executor';
import {
  resolveRealPath,
  invalidateCwdCache,
  canonicalize,
  CLAUDE_DIR,
  isValidSessionId,
} from './utils';
import { registerScreenshotHandlers } from './screenshotFixtures';

// Use an in-memory "mock" keychain for Chromium's encrypted storage (os_crypt)
// instead of the OS keychain. Must be set before the app is ready. ClaudeLens
// stores nothing sensitive in Chromium (no web logins/cookies, no safeStorage;
// all its state lives in ~/.claudelens and ~/.claude), so this is safe — and it
// stops macOS from popping a "<app> Safe Storage" Keychain permission dialog at
// launch, which Chromium would otherwise raise the first time its network/cookie
// store initializes (notably on unsigned builds, which is how ClaudeLens ships).
// If a future feature needs safeStorage-backed secrets, revisit this.
app.commandLine.appendSwitch('use-mock-keychain');

const PROJECTS_DIR = join(CLAUDE_DIR, 'projects');
const TASKS_DIR = join(CLAUDE_DIR, 'tasks');
const PLANS_DIR = join(CLAUDE_DIR, 'plans');
// installed_plugins.json: rinfresca la sezione Plugins su install/update/remove
// (la cache dei plugin cambia spesso e non va osservata interamente).
const INSTALLED_PLUGINS_FILE = join(CLAUDE_DIR, 'plugins', 'installed_plugins.json');

type IpcResult<T> = { data: T | null; error: string | null };
type ExportSaveResult = { canceled: boolean; filePath: string | null };

// Un hash di progetto è il nome di una cartella figlia diretta di PROJECTS_DIR:
// rifiuta separatori/traversal per impedire operazioni fuori da PROJECTS_DIR.
function assertValidHash(hash: string): void {
  if (
    typeof hash !== 'string' ||
    hash.length === 0 ||
    hash === '.' ||
    hash === '..' ||
    hash.includes('/') ||
    hash.includes('\\') ||
    hash.includes('\0')
  ) {
    throw new Error(`Invalid project hash: ${JSON.stringify(hash)}`);
  }
}

// Valida l'hash e costruisce il path della cartella progetto in un colpo solo,
// così nessun handler può dimenticare la validazione (vedi #13).
function projectDir(hash: string): string {
  assertValidHash(hash);
  return join(PROJECTS_DIR, hash);
}

const CLAUDE_MD_BASENAMES: ReadonlySet<string> = new Set(['CLAUDE.md', 'CLAUDE.local.md']);

// Un filename fornito dal renderer dev'essere un singolo segmento (no traversal):
// gli handler memory/sessions lo concatenano a un dir di progetto già validato.
function assertValidFilename(filename: string): void {
  if (
    typeof filename !== 'string' ||
    filename.length === 0 ||
    filename === '.' ||
    filename === '..' ||
    filename !== basename(filename) ||
    filename.includes('\\') ||
    filename.includes('\0')
  ) {
    throw new Error(`Invalid filename: ${JSON.stringify(filename)}`);
  }
}

interface SafeWritePathOptions {
  allowedBasenames?: ReadonlySet<string>;
  // I CLAUDE.md di progetto possono stare fuori dalla home (realPath = cwd letto dal .jsonl),
  // quindi il containment nella home si applica solo ai path sotto ~/.claude (markdownFile:*).
  // Gli agenti/skill di progetto vivono in {projectPath}/.claude/agents|skills/, fuori da CLAUDE_DIR
  // ma sempre sotto home — quindi markdownFile:* usa requireUnderHome.
  requireUnderHome?: boolean;
  // Confinamento più stretto a una directory specifica.
  requireUnder?: string;
  // Per markdownFile:*: accetta solo path sotto ~/.claude (global agents/skills/
  // plans/CLAUDE.md) oppure dentro un segmento `{progetto}/.claude/agents|skills/`
  // (entità di progetto). Blocca qualunque altro .md sotto la home (es. un README
  // di progetto), restringendo il blast radius all'invariante ~/.claude + .claude/.
  markdownEntityScope?: boolean;
  // Skip the `.md`-only basename check. Used by skills:* file IPC, which edits
  // arbitrary supporting files (scripts, json, …) confined via `requireUnder`.
  allowAnyExtension?: boolean;
}

// Valida un path fornito dal renderer prima di scriverci/cancellarlo (vedi #14):
// dev'essere assoluto, normalizzato (collassa `..`/`.`) e con un basename ammesso
// (allowlist) oppure `.md`; opzionalmente contenuto nella home. Ritorna il path normalizzato.
function assertSafeWritePath(filePath: string, opts: SafeWritePathOptions = {}): string {
  if (!filePath || typeof filePath !== 'string') throw new Error('Missing filePath');
  if (!isAbsolute(filePath)) throw new Error('Path must be absolute');
  // Canonicalize (resolve symlinks of the deepest existing ancestor) so a planted
  // symlink can't make a lexically-in-bounds path write/delete outside the base.
  const resolved = canonicalize(filePath);
  // Canonicalize the comparison bases too, so a symlinked home / ~/.claude
  // (common on macOS) doesn't make a legitimately-in-bounds canonical path fail.
  if (opts.requireUnderHome) {
    const home = canonicalize(os.homedir());
    if (resolved !== home && !resolved.startsWith(home + sep)) {
      throw new Error('Path must be under home directory');
    }
  }
  if (opts.requireUnder) {
    const baseDir = canonicalize(opts.requireUnder);
    if (resolved !== baseDir && !resolved.startsWith(baseDir + sep)) {
      throw new Error(`Path must be under ${baseDir}`);
    }
  }
  if (opts.markdownEntityScope) {
    const claudeDir = canonicalize(CLAUDE_DIR);
    const underClaude = resolved === claudeDir || resolved.startsWith(claudeDir + sep);
    // Project-scoped agents/skills live at {projectRealPath}/.claude/(agents|skills)/…
    const inProjectEntityDir =
      resolved.includes(`${sep}.claude${sep}agents${sep}`) ||
      resolved.includes(`${sep}.claude${sep}skills${sep}`);
    if (!underClaude && !inProjectEntityDir) {
      throw new Error('Path must be under ~/.claude or a project .claude/agents|skills directory');
    }
  }
  const base = basename(resolved);
  if (opts.allowedBasenames) {
    if (!opts.allowedBasenames.has(base)) throw new Error(`Refusing to write file: ${base}`);
  } else if (!opts.allowAnyExtension && !base.toLowerCase().endsWith('.md')) {
    throw new Error('Only .md files are allowed');
  }
  return resolved;
}

function ok<T>(data: T): IpcResult<T> {
  return { data, error: null };
}

function err<T>(e: unknown): IpcResult<T> {
  return { data: null, error: e instanceof Error ? e.message : String(e) };
}

// Build the env for spawning the `claude` CLI. A GUI-launched app may not inherit
// the user's interactive-shell PATH, so we prepend common install locations using
// the platform path delimiter (':' on Unix, ';' on Windows). On Windows the CLI
// is on the user PATH as claude.cmd, so the Unix-only dirs are skipped.
function claudeEnv(): NodeJS.ProcessEnv {
  const extra =
    process.platform === 'win32'
      ? []
      : [join(os.homedir(), '.local', 'bin'), '/usr/local/bin', '/opt/homebrew/bin'];
  const PATH = [...extra, process.env.PATH || ''].filter(Boolean).join(delimiter);
  return { ...process.env, PATH };
}

function cleanDefaultFilename(filename: string, extension: string): string {
  const fallback = `claudelens-export${extension}`;
  const base = basename(filename || fallback)
    // eslint-disable-next-line no-control-regex -- intentionally strip control chars from filenames
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  const normalized = base || fallback;
  return normalized.toLowerCase().endsWith(extension) ? normalized : `${normalized}${extension}`;
}

async function chooseExportPath(
  defaultFilename: string,
  extension: string,
  filters: Electron.FileFilter[]
): Promise<ExportSaveResult> {
  const options: Electron.SaveDialogOptions = {
    defaultPath: cleanDefaultFilename(defaultFilename, extension),
    filters,
  };
  const result = mainWindow
    ? await dialog.showSaveDialog(mainWindow, options)
    : await dialog.showSaveDialog(options);

  if (result.canceled || !result.filePath) return { canceled: true, filePath: null };

  const filePath = result.filePath.toLowerCase().endsWith(extension)
    ? result.filePath
    : `${result.filePath}${extension}`;
  return { canceled: false, filePath };
}

// Serializza MemoryData (Map non è trasferibile via IPC)
function serializeMemoryData(md: Awaited<ReturnType<typeof readMemory>>) {
  return {
    index: md.index,
    topics: Object.fromEntries(md.topics),
    memoryMd: md.memoryMd,
    projectLevelIndex: md.projectLevelIndex,
    projectLevelTopics: Object.fromEntries(md.projectLevelTopics),
    projectLevelMemoryMd: md.projectLevelMemoryMd,
  };
}

let mainWindow: BrowserWindow | null = null;

// Push to the renderer only when the window and its webContents are still alive.
// A bare `mainWindow?.webContents.send(...)` guards a null window but not a
// destroyed one: a file-watcher event firing while the window is closing or
// reloading throws "Object has been destroyed" from the main process.
function safeSend(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

// ─── Notifications ───────────────────────────────────────────────────────────
// A small engine that turns session lifecycle into user-facing notifications.
// The registry source is diffed for transitions (registry-diff.ts); the in-app
// chat feeds events directly off its existing callbacks. Each event is gated by
// the user's preferences, always pushed to the renderer (transient toast), and —
// only when the window is unfocused — mirrored to a native OS notification + a
// dock badge. See modules/notifications/.
const registryDiffState = createRegistryDiffState();
let badgeCount = 0;

function readNotifyPrefs(): NotificationPrefs {
  const p = readPrefs();
  return {
    enabled: typeof p[NOTIFY_ENABLED_KEY] === 'boolean' ? (p[NOTIFY_ENABLED_KEY] as boolean) : DEFAULT_NOTIFY_PREFS.enabled,
    os: typeof p[NOTIFY_OS_KEY] === 'boolean' ? (p[NOTIFY_OS_KEY] as boolean) : DEFAULT_NOTIFY_PREFS.os,
  };
}

function windowFocused(): boolean {
  return !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused();
}

// Bring the app to the foreground (clicking an OS notification) and clear the badge.
function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function clearBadge(): void {
  badgeCount = 0;
  if (process.platform === 'darwin' && app.dock) app.dock.setBadge('');
}

// Gate, push, and (when unfocused) mirror a single notification.
function emitNotification(event: NotificationEvent): void {
  const prefs = readNotifyPrefs();
  if (!prefs.enabled || process.env.SCREENSHOT_MODE) return;

  // The renderer always gets it (transient toast / future inbox).
  safeSend('notifications:event', event);

  // Native OS notification + dock badge only when the user isn't looking, so a
  // focused window doesn't double up with the in-app toast (and the chat's own
  // permission dialog). Honors the OS toggle and platform support.
  if (prefs.os && !windowFocused() && Notification.isSupported()) {
    const n = new Notification({ title: event.title, body: event.body ?? '' });
    n.on('click', focusMainWindow);
    n.show();
    if (process.platform === 'darwin' && app.dock) app.dock.setBadge(String(++badgeCount));
  }
}

// Feed a fresh registry snapshot through the diff and emit any transitions.
function notifyFromRegistry(sessions: Awaited<ReturnType<typeof readActiveSessions>>): void {
  const events = diffRegistry(sessions, registryDiffState, { now: Date.now, mkId: randomUUID });
  for (const e of events) emitNotification(e);
}

// Build a chat-source notification. cwd is supplied by the caller (the live
// session's working dir) so the renderer can offer "Open session". Suppressed
// when the window is focused: the in-app chat already shows the permission dialog
// / inline error, so a toast there would just duplicate it. Notifications earn
// their keep when the user has tabbed away.
function emitChatNotification(kind: NotificationKind, cwd: string, sessionId: string, title: string, body?: string): void {
  if (windowFocused()) return;
  emitNotification({ id: randomUUID(), kind, sessionId, cwd, title, body, createdAt: Date.now(), source: 'chat' });
}

// Set a Content Security Policy on every response so the renderer (which renders
// untrusted local Markdown/highlight content) has a second line of defense.
// Applied via onHeadersReceived so it covers both the file:// build and the dev server.
// `style-src 'unsafe-inline'` is required by Tailwind; Google Fonts (CSS + woff2) are
// allowlisted because index.css pulls them via @import. In dev, Vite's HMR needs
// 'unsafe-inline'/'unsafe-eval' and a websocket connection.
function setupContentSecurityPolicy() {
  const isDev = !app.isPackaged;
  const directives = [
    "default-src 'self'",
    isDev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data:",
    isDev ? "connect-src 'self' ws://localhost:5173 http://localhost:5173" : "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-src 'none'",
  ];
  const policy = directives.join('; ');

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    });
  });
}

function createWindow() {
  const isDev = !app.isPackaged;
  // macOS legge l'.icns; Windows/Linux la taskbar vuole un PNG. Su Windows usiamo
  // la variante a sfondo trasparente, altrove quella con sfondo.
  const iconFile =
    process.platform === 'darwin'
      ? 'icon4.icns'
      : process.platform === 'win32'
        ? 'icon-win.png'
        : 'icon.png';
  const iconPath = isDev ? join(__dirname, '..', iconFile) : join(app.getAppPath(), iconFile);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#f6f4ef',
    icon: iconPath,
    // Su Windows/Linux la menu bar nativa (File/Edit/…) non ha senso: l'app non
    // la usa e su macOS vive nella system bar. La nascondiamo (Alt non la mostra
    // perché viene anche rimossa via Menu.setApplicationMenu(null) all'avvio).
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Focusing the window means the user is back: clear any notification dock badge.
  mainWindow.on('focus', clearBadge);

  // Open external links (window.open from Markdown) in the system browser, deny in-app windows
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Block navigation away from the app origin
  const appOrigin = isDev ? 'http://localhost:5173' : 'file://';
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(appOrigin)) {
      event.preventDefault();
      if (url.startsWith('http://') || url.startsWith('https://')) {
        shell.openExternal(url);
      }
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'));
  }
}

// IPC Handlers
ipcMain.handle(
  'memory:listProjects',
  async (): Promise<IpcResult<Array<{ hash: string; realPath: string }>>> => {
    try {
      const hashes = await listProjectsWithMemory(PROJECTS_DIR);
      const projects = hashes.map(hash => ({
        hash,
        realPath: resolveRealPath(PROJECTS_DIR, hash),
      }));
      return ok(projects);
    } catch (e) {
      return err(e);
    }
  }
);

ipcMain.handle('memory:getProject', async (_event, hash: string) => {
  try {
    const projectPath = projectDir(hash);
    const realPath = resolveRealPath(PROJECTS_DIR, hash);
    const md = await readMemory(projectPath, realPath);
    return ok(serializeMemoryData(md));
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('cost:getSummary', async () => {
  try {
    const data = await calculateCostSummary(PROJECTS_DIR);
    return ok(data);
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('cost:getPricingMeta', async () => {
  try {
    return ok(getPricingMeta());
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('cost:getByProject', async (_event, hash: string) => {
  try {
    const projectPath = projectDir(hash);
    const { usage, sessionCount, cost } = await getProjectUsage(projectPath);
    const result = {
      project: hash,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      cost,
      sessionsCount: sessionCount,
    };
    return ok(result);
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('claudeMd:getGlobal', async () => {
  try {
    return ok(readGlobalClaudeMd(CLAUDE_DIR));
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('claudeMd:getHierarchy', async (_event, realPath: string) => {
  try {
    return ok(getClaudeMdHierarchy(realPath));
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('claudeMd:writeGlobal', async (_event, content: string) => {
  try {
    writeClaudeMdFile(join(CLAUDE_DIR, 'CLAUDE.md'), content);
    return ok(null);
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('claudeMd:writeFile', async (_event, filePath: string, content: string) => {
  try {
    const safePath = assertSafeWritePath(filePath, { allowedBasenames: CLAUDE_MD_BASENAMES });
    writeClaudeMdFile(safePath, content);
    return ok(null);
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('markdownFile:write', async (_event, filePath: string, content: string) => {
  try {
    const fs = require('fs') as typeof import('fs');
    const safePath = assertSafeWritePath(filePath, { requireUnderHome: true, markdownEntityScope: true });
    const dir = require('path').dirname(safePath) as string;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(safePath, content, 'utf-8');
    return ok(null);
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle(
  'markdownFile:delete',
  async (_event, filePath: string, opts?: { pruneEmptyDir?: boolean }) => {
    try {
      const fs = require('fs') as typeof import('fs');
      const path = require('path') as typeof import('path');
      const safePath = assertSafeWritePath(filePath, { requireUnderHome: true, markdownEntityScope: true });
      if (fs.existsSync(safePath)) fs.rmSync(safePath);
      // Per le skill (skills/<name>/SKILL.md) rimuovi la cartella contenitore se resta vuota.
      // Guard: prune solo una sottocartella di skills/ (basename del parent === 'skills'),
      // mai una root come la home o CLAUDE_DIR se per qualche motivo il .md vi stesse dentro.
      if (opts?.pruneEmptyDir) {
        const dir = path.dirname(safePath);
        const parent = path.dirname(dir);
        const prunable = path.basename(parent) === 'skills' || path.basename(parent) === 'agents';
        if (prunable && fs.existsSync(dir) && fs.readdirSync(dir).length === 0)
          fs.rmSync(dir, { recursive: false });
      }
      return ok(null);
    } catch (e) {
      return err(e);
    }
  }
);

// Resolve `<dirname(skillPath)>/<relPath>` and confine it to the skill directory.
// `skillPath` is the skill's SKILL.md absolute path (from the Skill object).
function resolveSkillFile(skillPath: string, relPath: string): string {
  const path = require('path') as typeof import('path');
  if (!relPath || typeof relPath !== 'string' || path.isAbsolute(relPath))
    throw new Error('Invalid relative path');
  const skillDir = path.dirname(skillPath);
  const target = path.resolve(skillDir, relPath);
  return assertSafeWritePath(target, {
    requireUnderHome: true,
    requireUnder: skillDir,
    allowAnyExtension: true,
  });
}

ipcMain.handle('skills:readFile', async (_event, skillPath: string, relPath: string) => {
  try {
    const fs = require('fs') as typeof import('fs');
    const safePath = resolveSkillFile(skillPath, relPath);
    return ok(fs.readFileSync(safePath, 'utf-8'));
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle(
  'skills:writeFile',
  async (_event, skillPath: string, relPath: string, content: string) => {
    try {
      const fs = require('fs') as typeof import('fs');
      const safePath = resolveSkillFile(skillPath, relPath);
      fs.writeFileSync(safePath, content, 'utf-8');
      return ok(null);
    } catch (e) {
      return err(e);
    }
  },
);

ipcMain.handle('skills:openFile', async (_event, skillPath: string, relPath: string) => {
  try {
    const safePath = resolveSkillFile(skillPath, relPath);
    const error = await shell.openPath(safePath);
    if (error) throw new Error(error);
    return ok(null);
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('claudeMd:deleteGlobal', async () => {
  try {
    const fs = require('fs') as typeof import('fs');
    const target = join(CLAUDE_DIR, 'CLAUDE.md');
    if (fs.existsSync(target)) fs.rmSync(target);
    return ok(null);
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('claudeMd:deleteFile', async (_event, filePath: string) => {
  try {
    const fs = require('fs') as typeof import('fs');
    const safePath = assertSafeWritePath(filePath, { allowedBasenames: CLAUDE_MD_BASENAMES });
    if (fs.existsSync(safePath)) fs.rmSync(safePath);
    return ok(null);
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('export:markdown', async (_event, defaultFilename: string, content: string) => {
  try {
    if (typeof content !== 'string') throw new Error('Missing markdown content');
    const chosen = await chooseExportPath(defaultFilename, '.md', [
      { name: 'Markdown', extensions: ['md'] },
    ]);
    if (chosen.canceled || !chosen.filePath) return ok(chosen);
    writeFileSync(chosen.filePath, content, 'utf-8');
    return ok(chosen);
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('export:pdf', async (_event, defaultFilename: string, html: string) => {
  let printWindow: BrowserWindow | null = null;
  let tempDir: string | null = null;

  try {
    if (typeof html !== 'string' || !html.trim()) throw new Error('Missing HTML content');
    const chosen = await chooseExportPath(defaultFilename, '.pdf', [
      { name: 'PDF', extensions: ['pdf'] },
    ]);
    if (chosen.canceled || !chosen.filePath) return ok(chosen);

    tempDir = mkdtempSync(join(os.tmpdir(), 'claudelens-export-'));
    const htmlPath = join(tempDir, 'export.html');
    writeFileSync(htmlPath, html, 'utf-8');

    printWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    await printWindow.loadFile(htmlPath);
    // The export document loads the app's reading fonts (Inter / JetBrains
    // Mono) from the network; print only once they've resolved (or failed —
    // fonts.ready settles either way, and the stacks have system fallbacks).
    await printWindow.webContents.executeJavaScript('document.fonts.ready.then(() => true)', true);
    const pdf = await printWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
    });

    writeFileSync(chosen.filePath, pdf);
    return ok(chosen);
  } catch (e) {
    return err(e);
  } finally {
    if (printWindow && !printWindow.isDestroyed()) printWindow.close();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
});

ipcMain.handle('settings:getCleanupPeriodDays', async () => {
  try {
    const { readFileSync, existsSync } = require('fs') as typeof import('fs');
    const settingsPath = join(CLAUDE_DIR, 'settings.json');
    if (!existsSync(settingsPath)) return ok(30);
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    const days = typeof settings.cleanupPeriodDays === 'number' ? settings.cleanupPeriodDays : 30;
    return ok(days);
  } catch {
    return ok(30);
  }
});

// ClaudeLens UI preferences (pinned projects/sessions, session tags) persisted
// to ~/.claudelens/preferences.json — see modules/prefs-store.ts.
ipcMain.handle('prefs:getAll', async () => {
  try {
    return ok(readPrefs());
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('prefs:set', async (_event, key: string, value: unknown) => {
  try {
    setPref(key, value);
    return ok(true);
  } catch (e) {
    return err(e);
  }
});

// Clear the notification dock badge (renderer calls this when the user dismisses
// a toast / acts on a notification while the window is already up).
ipcMain.handle('notifications:clearBadge', async () => {
  try {
    clearBadge();
    return ok(true);
  } catch (e) {
    return err(e);
  }
});

// Anonymous usage telemetry (Aptabase) opt-out toggle — see modules/telemetry.ts.
ipcMain.handle('telemetry:isEnabled', async () => {
  try {
    return ok(isTelemetryEnabled());
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('telemetry:setEnabled', async (_event, value: boolean) => {
  try {
    setTelemetryEnabled(value === true);
    return ok(true);
  } catch (e) {
    return err(e);
  }
});

// Anonymous feature-usage events fired from the renderer (view opened, chat
// started, export done, …). Defense-in-depth sanitizer: only a well-formed
// event name and flat string/number props survive, and strings are capped — so
// even a buggy/compromised renderer can't smuggle session content, paths, or
// other sensitive data into telemetry. `track()` itself is still opt-out gated.
ipcMain.handle('telemetry:track', async (_event, name: unknown, props: unknown) => {
  try {
    if (typeof name !== 'string' || !/^[a-z0-9_]{1,40}$/i.test(name)) return ok(false);
    let safe: Record<string, string | number> | undefined;
    if (props && typeof props === 'object' && !Array.isArray(props)) {
      safe = {};
      for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
        if (Object.keys(safe).length >= 10) break;
        if (!/^[a-z0-9_]{1,40}$/i.test(k)) continue;
        if (typeof v === 'number' && Number.isFinite(v)) safe[k] = v;
        else if (typeof v === 'string') safe[k] = v.slice(0, 80);
      }
    }
    void track(name, safe);
    return ok(true);
  } catch (e) {
    return err(e);
  }
});

// Update check against the GitHub releases API — see modules/update-checker.ts.
// No auto-download/install (the app ships unsigned, macOS would quarantine a
// silently swapped bundle); the renderer shows a notice linking to the release.
// Screenshot mode stays offline and banner-free, like telemetry.
ipcMain.handle('updates:check', async () => {
  try {
    if (process.env.SCREENSHOT_MODE) {
      const v = app.getVersion();
      return ok({
        currentVersion: v,
        latestVersion: v,
        updateAvailable: false,
        releaseName: null,
        releaseUrl: RELEASES_PAGE_URL,
        publishedAt: null,
      });
    }
    return ok(await checkForUpdates(app.getVersion()));
  } catch (e) {
    return err(e);
  }
});

// Reads the effective Claude Code configuration via the official Agent SDK.
// `cwd` is optional; when omitted the reader resolves against the user's home
// (the global/user scope shown by the Settings page).
ipcMain.handle('config:getEffective', async (_event, cwd?: string) => {
  try {
    return ok(await readEffectiveConfig(cwd));
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('sessions:listByProject', async (_event, hash: string) => {
  try {
    const projectPath = projectDir(hash);
    const sessions = await getSessionList(projectPath);
    return ok(sessions);
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('memory:createTopic', async (_event, hash: string, input: TopicInput) => {
  try {
    const memoryDir = join(projectDir(hash), 'memory');
    const filename = createTopic(memoryDir, input);
    return ok({ filename });
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle(
  'memory:updateTopic',
  async (_event, hash: string, filename: string, input: TopicInput) => {
    try {
      assertValidFilename(filename);
      const memoryDir = join(projectDir(hash), 'memory');
      updateTopic(memoryDir, filename, input);
      return ok(null);
    } catch (e) {
      return err(e);
    }
  }
);

ipcMain.handle('memory:deleteTopic', async (_event, hash: string, filename: string) => {
  try {
    assertValidFilename(filename);
    const memoryDir = join(projectDir(hash), 'memory');
    deleteTopic(memoryDir, filename);
    return ok(null);
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('sessions:getChat', async (_event, _hash: string, filename: string) => {
  try {
    assertValidFilename(filename);
    // POC: lo storico è letto ESCLUSIVAMENTE via Agent SDK (getSessionMessages).
    // L'SDK cerca l'id in tutte le project dir di ~/.claude, quindi `hash` non
    // serve. NB: tronca alla compaction (perde la storia pre-`/compact`).
    const sessionId = filename.replace(/\.jsonl$/, '');
    const messages = await readChatSessionViaSdk(sessionId);
    return ok(messages);
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('sessions:getSubagents', async (_event, _hash: string, filename: string) => {
  try {
    assertValidFilename(filename);
    // POC: metadati sub-agenti via SDK (listSubagents + getSubagentMessages).
    const sessionId = filename.replace(/\.jsonl$/, '');
    const metas = await readSessionSubagentsViaSdk(sessionId);
    return ok(metas);
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle(
  'sessions:getSubagentTranscript',
  async (_event, _hash: string, filename: string, agentId: string) => {
    try {
      assertValidFilename(filename);
      // POC: transcript sub-agente via SDK (getSubagentMessages).
      const sessionId = filename.replace(/\.jsonl$/, '');
      const messages = await readSubagentTranscriptViaSdk(sessionId, agentId);
      return ok(messages);
    } catch (e) {
      return err(e);
    }
  }
);

ipcMain.handle('sessions:getArtifacts', async (_event, hash: string, filename: string) => {
  try {
    assertValidFilename(filename);
    const projectPath = projectDir(hash);
    const artifacts = await getSessionArtifacts(projectPath, TASKS_DIR, filename);
    return ok(artifacts);
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('sessions:deleteSession', async (_event, paths: string[]) => {
  try {
    if (!Array.isArray(paths)) throw new Error('paths must be an array');
    const result = deleteSessionArtifacts(paths, CLAUDE_DIR);
    return ok(result);
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('tasks:getByProject', async (_event, hash: string) => {
  try {
    const projectPath = projectDir(hash);
    const groups = await getProjectTasks(projectPath, TASKS_DIR);
    return ok(groups);
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('plans:getByProject', async (_event, hash: string) => {
  try {
    const projectPath = projectDir(hash);
    const groups = await getProjectPlans(projectPath);
    return ok(groups);
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('rules:getByProject', async (_event, realPath: string) => {
  try {
    const rules = await readProjectRules(realPath);
    return ok(rules);
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('skills:getGlobal', async () => {
  try {
    return ok(getGlobalSkills());
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('skills:getAll', async (_event, realPath: string) => {
  try {
    return ok(getAllSkills(realPath));
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('agents:getGlobal', async () => {
  try {
    return ok(getGlobalAgents());
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('agents:getByProject', async (_event, realPath: string) => {
  try {
    return ok(getProjectAgents(realPath));
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('plugins:getAll', async () => {
  try {
    return ok(getInstalledPlugins());
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('skills:create', async (_event, input: SkillInput, projectPath?: string) => {
  try {
    const filePath = createSkill(input, projectPath);
    return ok({ filePath });
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('agents:create', async (_event, input: AgentInput, projectPath?: string) => {
  try {
    const filePath = createAgent(input, projectPath);
    return ok({ filePath });
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle(
  'agents:dispatchBg',
  async (_event, cwd: string, prompt: string, name?: string, agent?: string, model?: string) => {
    try {
      const { existsSync, statSync } = await import('fs');
      if (!cwd || !existsSync(cwd) || !statSync(cwd).isDirectory()) {
        return err(
          `Project directory not found on disk: ${cwd}. The project may have been moved or deleted.`
        );
      }

      const args = ['--bg'];
      if (name) {
        args.push('--name', name);
      }
      if (agent) {
        args.push('--agent', agent);
      }
      if (model) {
        args.push('--model', model);
      }
      args.push(prompt);

      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFile);

      await execFileAsync('claude', args, { cwd, env: claudeEnv() });

      return ok(null);
    } catch (e: any) {
      if (e?.code === 'ENOENT') {
        return err(`'claude' CLI not found in PATH, or working directory missing (${cwd}).`);
      }
      return err(e.stderr || e.message || String(e));
    }
  }
);

ipcMain.handle('agents:deleteBg', async (_event, id: string) => {
  return runClaudeCommand(['rm', id]);
});

ipcMain.handle('agents:stopBg', async (_event, id: string) => {
  return runClaudeCommand(['stop', id]);
});

ipcMain.handle('agents:respawnBg', async (_event, id: string) => {
  return runClaudeCommand(['respawn', id]);
});

ipcMain.handle('agents:attachBg', async (_event, cwd: string, id: string) => {
  try {
    openInTerminal(cwd || os.homedir(), `claude attach ${id}`);
    return ok(null);
  } catch (e) {
    return err(e);
  }
});

async function runClaudeCommand(args: string[]): Promise<IpcResult<string>> {
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync('claude', args, {
      env: claudeEnv(),
      maxBuffer: 4 * 1024 * 1024,
    });
    return ok(stdout);
  } catch (e: any) {
    return err(e.stderr || e.message || String(e));
  }
}

ipcMain.handle('projects:delete', async (_event, hash: string) => {
  try {
    const projectPath = projectDir(hash);
    const { rmSync } = await import('fs');
    rmSync(projectPath, { recursive: true, force: true });
    return ok(null);
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('projects:detectDuplicates', async () => {
  try {
    return ok(detectDuplicateProjects(PROJECTS_DIR));
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('projects:planMerge', async (_event, sourceHash: string, destHash: string) => {
  try {
    assertValidHash(sourceHash);
    assertValidHash(destHash);
    return ok(computeMergePlan(PROJECTS_DIR, sourceHash, destHash));
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('projects:executeMerge', async (_event, sourceHash: string, destHash: string) => {
  try {
    assertValidHash(sourceHash);
    assertValidHash(destHash);
  } catch (e) {
    return err(e);
  }
  pauseWatcher();
  try {
    const result = executeMerge(PROJECTS_DIR, sourceHash, destHash);
    return ok(result);
  } catch (e) {
    return err(e);
  } finally {
    // Il contenuto delle due cartelle è cambiato (o è stato ripristinato dal rollback):
    // invalida la cache del cwd e notifica un solo refresh.
    invalidateCwdCache(sourceHash);
    invalidateCwdCache(destHash);
    resumeWatcher();
    safeSend('data:changed');
  }
});

ipcMain.handle('mcp:getGlobal', async () => {
  try {
    return ok(getGlobalMcp());
  } catch (e) {
    return err(e);
  }
});

let currentAiProcess: ChildProcess | null = null;

ipcMain.handle(
  'ai:run',
  async (event, instruction: string, inputContent: string, projectPath: string) => {
    if (currentAiProcess) {
      currentAiProcess.kill();
      currentAiProcess = null;
    }

    const { existsSync, statSync } = await import('fs');
    if (!projectPath || !existsSync(projectPath) || !statSync(projectPath).isDirectory()) {
      return err(
        `Project directory not found on disk: ${projectPath}. The project may have been moved or deleted.`
      );
    }

    return new Promise<IpcResult<null>>(resolve => {
      // execFile-style: nessuna shell, l'istruzione passa come argomento separato
      // (niente string-building né escaping fragile — cfr. agents:dispatchBg).
      const args = [
        '-p',
        instruction,
        '--model',
        'Haiku',
        '--allowedTools',
        'Read,Glob,Grep,WebSearch,WebFetch',
        '--no-session-persistence',
      ];
      const proc = spawn('claude', args, {
        cwd: projectPath,
        env: claudeEnv(),
      });
      currentAiProcess = proc;

      if (inputContent) {
        proc.stdin?.write(inputContent);
      }
      proc.stdin?.end();

      proc.stdout?.on('data', (chunk: Buffer) => {
        event.sender.send('ai:chunk', chunk.toString());
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        event.sender.send('ai:error', chunk.toString());
      });

      proc.on('close', code => {
        currentAiProcess = null;
        if (code === 0 || code === null) {
          event.sender.send('ai:done');
          resolve(ok(null));
        } else {
          event.sender.send('ai:done');
          resolve(err(new Error(`Processo terminato con codice ${code}`)));
        }
      });

      proc.on('error', e => {
        currentAiProcess = null;
        event.sender.send('ai:error', e.message);
        event.sender.send('ai:done');
        resolve(err(e));
      });
    });
  }
);

ipcMain.handle('ai:stop', async () => {
  if (currentAiProcess) {
    currentAiProcess.kill();
    currentAiProcess = null;
  }
  return ok(null);
});

// ─── Chat composer (Agent SDK with in-app approvals) ──────────────────────────
// Runs chat turns through the official Agent SDK (`modules/chat-runner.ts`) rather
// than spawning `claude -p`. The SDK persists to the same
// `~/.claude/projects/<hash>/<id>.jsonl` the terminal reads, so a message sent
// from ClaudeLens stays interchangeable with one typed via `claude --resume <id>`.
// Crucially the SDK exposes `canUseTool`: when Claude wants a non-auto-approved
// tool the callback fires here, we forward it to the renderer
// (`sessions:permissionRequest`), the user picks Allow / Always / Deny, and the
// decision (`sessions:permissionResponse`) flows back to the SDK — the interactive
// terminal experience, inside the app. Assistant text still streams live over
// `sessions:chatChunk`; on `chatDone` the watcher refetch renders the full turn.
//
// Streaming input mode: one long-lived ChatSession per chat view drives a single
// persistent `query()`. A send pushes into the live session (its context stays
// warm) instead of opening a new query each turn; Stop interrupts the turn but
// keeps the session alive; leaving the view (`sessions:endChat`) disposes it.
// Only one session is alive at a time — starting/opening another supersedes it.
let currentChatSession: ChatSession | null = null;

// Pending tool-approval requests, keyed by the requestId sent to the renderer.
// Each resolver settles the Promise that `canUseTool` returned to the SDK.
const pendingPermissions = new Map<string, (r: PermissionResult) => void>();

// Resume default: the session file records no permission mode, so we pick a
// faithful default. `default` means "ask every time" — now that the SDK can
// actually prompt in-app via canUseTool, this matches the live terminal chat
// rather than silently bypassing or blocking. Callers may override.
const RESUME_PERMISSION_MODE = 'default';

function toPermissionResult(d: PermissionDecision): PermissionResult {
  if (d.kind === 'deny') return { behavior: 'deny', message: d.message || 'Denied by the user.' };
  if (d.kind === 'always')
    return {
      behavior: 'allow',
      updatedInput: d.input,
      // The renderer round-trips the SDK's suggestions verbatim (opaque to it),
      // so the loose shared type narrows back to the SDK's here.
      updatedPermissions: d.suggestions as PermissionUpdate[] | undefined,
    };
  return { behavior: 'allow', updatedInput: d.input };
}

// Resolve every still-pending approval as a denial and clear the map. Used when a
// turn is stopped or superseded so the SDK never hangs on an unanswered request.
function denyAllPending(message: string): void {
  for (const resolve of pendingPermissions.values()) {
    resolve({ behavior: 'deny', message });
  }
  pendingPermissions.clear();
}

// Builds the `canUseTool` callback: forwards each request to the renderer and
// returns a Promise the matching `sessions:permissionResponse` settles. Honors
// the per-call abort signal by resolving as a denial.
function makeCanUseTool(event: Electron.IpcMainInvokeEvent, cwd: string): CanUseTool {
  return (toolName, input, options) =>
    new Promise<PermissionResult>(resolve => {
      const requestId = randomUUID();
      // The turn is now blocked on the user. Surface a notification when the app
      // is in the background (no-op when focused — the dialog below is enough).
      // Only the first request of a burst notifies: parallel tool calls fire
      // several canUseTool at once, and the renderer queues them behind a single
      // dialog anyway — one OS notification per pending request would just spam.
      if (pendingPermissions.size === 0) {
        emitChatNotification(
          'needs-attention',
          cwd,
          currentChatSession?.sessionId ?? '',
          'Claude is waiting for your approval',
          options.title || options.displayName || toolName
        );
      }
      // A dedup-guarded resolver: the first of {user response, abort, supersede}
      // to fire wins, the rest are no-ops.
      const settle = (r: PermissionResult) => {
        if (!pendingPermissions.has(requestId)) return;
        pendingPermissions.delete(requestId);
        resolve(r);
      };
      pendingPermissions.set(requestId, settle);

      options.signal.addEventListener('abort', () =>
        settle({ behavior: 'deny', message: 'Aborted.' })
      );

      event.sender.send('sessions:permissionRequest', {
        requestId,
        // canUseTool can only fire while its session is the live one (a
        // supersede denies its pending requests), so the current pointer is it.
        sessionId: currentChatSession?.sessionId ?? '',
        toolName,
        title: options.title,
        displayName: options.displayName,
        description: options.description,
        input,
        suggestions: options.suggestions,
        blockedPath: options.blockedPath,
        decisionReason: options.decisionReason,
        toolUseID: options.toolUseID,
      });
    });
}

// Create and start a persistent ChatSession, wiring its stream to the renderer.
// `onTurnEnd` maps to the existing `chatDone` event (the renderer treats it as
// "turn finished": re-enable composer + refetch) — the session itself lives on.
// `onClosed` clears the live reference only when *this* session is still current
// (identity, not session id, so a freshly-resumed session isn't cleared by the
// disposed one it replaced). Sends are guarded against a torn-down webContents,
// which matters now a session outlives a single turn.
function launchSession(event: Electron.IpcMainInvokeEvent, params: ChatSessionParams): ChatSession {
  const send = (channel: string, ...args: unknown[]) => {
    if (!event.sender.isDestroyed()) event.sender.send(channel, ...args);
  };
  // `onClosed` self-references `session` to clear the live pointer only when it's
  // still the current one. The arrow is lazy (fired async, long after the ctor
  // returns), so referencing `session` inside its own initializer is safe.
  // Every stream event is enveloped with the session id (see the envelope
  // types in shared/chat-types.ts), so the renderer can drop stale events from
  // a superseded session instead of trusting arrival order.
  const session: ChatSession = new ChatSession(params, {
    onStarted: id => send('sessions:chatStarted', id),
    onChunk: text => send('sessions:chatChunk', { sessionId: session.sessionId, text }),
    onToolActivity: activity =>
      send('sessions:chatToolActivity', { sessionId: session.sessionId, activity }),
    onMessage: message => send('sessions:chatMessage', { sessionId: session.sessionId, message }),
    onError: message => {
      send('sessions:chatError', { sessionId: session.sessionId, error: message });
      // Surface the failure as a notification when the app is backgrounded (the
      // composer shows it inline when focused, so emitChatNotification no-ops there).
      emitChatNotification('error', params.cwd, session.sessionId, 'A chat turn failed', message);
      // A turn that errors out leaves any tool-approval requests it raised
      // dangling — their canUseTool Promises never settle, leaking the resolvers
      // and risking a stale dialog next turn. Deny them so the SDK unblocks and
      // the renderer's queue clears.
      denyAllPending('The turn ended with an error.');
    },
    onTurnEnd: summary => send('sessions:chatDone', { sessionId: session.sessionId, summary }),
    onClosed: () => {
      // A deliberate teardown (endChat, supersede) clears or replaces the live
      // pointer before this fires. Reaching here with the pointer still intact
      // means the query died on its own (fatal stream error, CLI crash) — emit a
      // final `chatDone` so the renderer's composer doesn't stay stuck on "Stop"
      // with no turn ever ending.
      if (currentChatSession === session) {
        currentChatSession = null;
        send('sessions:chatDone', { sessionId: session.sessionId });
      }
    },
  });
  return session;
}

const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions'] as const;
type ChatPermissionMode = (typeof PERMISSION_MODES)[number];
function asPermissionMode(m?: string): ChatPermissionMode {
  return PERMISSION_MODES.includes(m as ChatPermissionMode)
    ? (m as ChatPermissionMode)
    : RESUME_PERMISSION_MODE;
}

// Continue an existing session: `resume: sessionId` (no fork) appends to the same
// transcript. Tool calls route through the in-app approval dialog via canUseTool.
ipcMain.handle(
  'sessions:sendMessage',
  async (
    event,
    realPath: string,
    sessionId: string,
    message: string,
    model?: string,
    permissionMode?: string
  ) => {
    try {
    const { existsSync, statSync } = await import('fs');
    if (!realPath || !existsSync(realPath) || !statSync(realPath).isDirectory()) {
      return err(
        `Project directory not found on disk: ${realPath}. The project may have been moved or deleted.`
      );
    }
    if (!sessionId) return err(new Error('Missing session id.'));
    // Validate the id before handing it to the SDK as `resume` (it resolves the
    // transcript file path from it), mirroring the terminal:create handler.
    if (!isValidSessionId(sessionId)) return err(new Error('Invalid session id.'));
    if (typeof message !== 'string' || !message.trim()) {
      return err(new Error('Cannot send an empty message.'));
    }

    const mode = asPermissionMode(permissionMode);
    // Same transcript already live: push into the warm query (applying any
    // model/permission switch first) so the turn rides the persistent session.
    const live = currentChatSession;
    if (live && live.sessionId === sessionId) {
      try {
        await live.setModel(model);
        await live.setPermissionMode(mode);
      } catch {
        // The live session was disposed mid-switch (a concurrent endChat/stop/
        // supersede); fall through to resume a fresh one below.
      }
      // Re-check identity after the awaits: a concurrent teardown could have
      // disposed or replaced the session between them, and sending into a
      // torn-down query would silently drop the message.
      if (currentChatSession === live) {
        live.send(message);
        return ok(null);
      }
    }
    // No live session for this transcript (or it was just superseded): supersede
    // whatever's running and resume this one into a fresh persistent query.
    currentChatSession?.dispose();
    denyAllPending('Superseded by a new request.');
    currentChatSession = launchSession(event, {
      cwd: realPath,
      resume: sessionId,
      model,
      permissionMode: mode,
      canUseTool: makeCanUseTool(event, realPath),
      env: claudeEnv(),
    });
    currentChatSession.send(message);
    return ok(null);
    } catch (e) {
      return err(e);
    }
  }
);

// Start a brand-new session: we pre-generate the session id (`crypto.randomUUID`)
// and pass it as `sessionId`, so the new `~/.claude/projects/<hash>/<id>.jsonl` id
// is known up front. We emit `sessions:chatStarted` immediately (no race in the
// new-chat view), then run the turn — tool calls still flow through canUseTool.
ipcMain.handle(
  'sessions:startMessage',
  async (event, realPath: string, message: string, model?: string, permissionMode?: string) => {
    try {
    const { existsSync, statSync } = await import('fs');
    if (!realPath || !existsSync(realPath) || !statSync(realPath).isDirectory()) {
      return err(
        `Project directory not found on disk: ${realPath}. The project may have been moved or deleted.`
      );
    }
    if (typeof message !== 'string' || !message.trim()) {
      return err(new Error('Cannot send an empty message.'));
    }

    currentChatSession?.dispose();
    denyAllPending('Superseded by a new request.');

    const id = randomUUID();
    event.sender.send('sessions:chatStarted', id);

    currentChatSession = launchSession(event, {
      cwd: realPath,
      sessionId: id,
      model,
      permissionMode: asPermissionMode(permissionMode),
      canUseTool: makeCanUseTool(event, realPath),
      env: claudeEnv(),
    });
    currentChatSession.send(message);
    return ok(null);
    } catch (e) {
      return err(e);
    }
  }
);

// The renderer's verdict on a pending approval. Settling resolves the Promise the
// SDK's canUseTool is awaiting; an unknown requestId (already aborted) is a no-op.
ipcMain.handle(
  'sessions:permissionResponse',
  async (_event, requestId: string, decision: PermissionDecision) => {
    const resolve = pendingPermissions.get(requestId);
    if (resolve) resolve(toPermissionResult(decision));
    return ok(null);
  }
);

// Stop the in-flight turn with the SDK's native interrupt: the turn ends (the SDK
// emits a `result`, so the composer re-enables) but the session stays alive and
// warm — the user can keep chatting, unlike the old kill. Pending approvals are
// denied first so the interrupted turn never hangs on an unanswered one.
ipcMain.handle('sessions:stopMessage', async () => {
  denyAllPending('Stopped by the user.');
  try {
    await currentChatSession?.interrupt();
  } catch {
    // interrupt() can race the turn's natural end (query already closed); the
    // stop still achieved its goal, so don't reject the invoke over it.
  }
  return ok(null);
});

// Tear the persistent session down when the chat view unmounts (back, or switch
// session/project). Disposing aborts the query and closes the input generator;
// the next message in any view resumes from disk into a fresh session.
ipcMain.handle('sessions:endChat', async () => {
  currentChatSession?.dispose();
  currentChatSession = null;
  denyAllPending('Session closed.');
  return ok(null);
});

// ─── Embedded terminal IPC ────────────────────────────────────────────────────
//
// Runs the *interactive* `claude` CLI in a PTY (terminal-manager.ts) — the
// heavy-use path that bills against the subscription's usage limits, unlike the
// SDK chat above which draws from the separate Agent SDK monthly credit. The
// renderer's xterm is a dumb pipe: keystrokes down `terminal:write`, raw output
// up `terminal:data`, per-terminal id so views never cross streams.

ipcMain.handle(
  'terminal:create',
  async (event, opts: { cwd: string; resumeSessionId?: string; attachJobId?: string; cols?: number; rows?: number }) => {
    try {
      const { existsSync, statSync } = await import('fs');
      const cwd = opts?.cwd;
      if (!cwd || !existsSync(cwd) || !statSync(cwd).isDirectory()) {
        return err(
          `Project directory not found on disk: ${cwd}. The project may have been moved or deleted.`
        );
      }
      if (opts.resumeSessionId && !isValidSessionId(opts.resumeSessionId)) {
        return err(new Error('Invalid session id.'));
      }
      // Background-agent job id (short hex from ~/.claude/jobs/<id>). Validated
      // before it reaches the shell since attach passes it as a CLI arg.
      if (opts.attachJobId && !/^[a-zA-Z0-9_-]{1,64}$/.test(opts.attachJobId)) {
        return err(new Error('Invalid agent id.'));
      }

      // Mutual exclusion: a terminal `claude --resume` and the SDK chat must not
      // both write the same <id>.jsonl. If an SDK chat session is live, dispose it
      // before spawning the PTY (both persist to the same transcript file).
      if (currentChatSession) {
        currentChatSession.dispose();
        currentChatSession = null;
        denyAllPending('Session moved to the terminal.');
      }

      const send = (channel: string, ...args: unknown[]) => {
        if (!event.sender.isDestroyed()) event.sender.send(channel, ...args);
      };
      // On Windows this routes through cmd.exe to launch the claude.cmd shim (see
      // resolveClaudeCommand). Both ids are validated above, so they are safe to
      // pass through the shell.
      //
      // `attachJobId` means the row is a *live* background agent: `claude --resume`
      // is rejected by the CLI while a session runs as a bg agent, so we `claude
      // attach <id>` into the live worker instead. A stopped/done agent (or a plain
      // session) carries only `resumeSessionId` and reopens with `--resume`.
      const cliArgs = opts.attachJobId
        ? ['attach', opts.attachJobId]
        : opts.resumeSessionId
          ? ['--resume', opts.resumeSessionId]
          : [];
      const { command, args } = resolveClaudeCommand(cliArgs);
      const { id, pid } = createTerminal(
        {
          cwd,
          command,
          args,
          env: claudeEnv(),
          cols: opts.cols,
          rows: opts.rows,
        },
        {
          onData: data => send('terminal:data', id, data),
          onExit: exitCode => send('terminal:exit', id, exitCode),
        }
      );
      return ok({ id, pid });
    } catch (e) {
      return err(e);
    }
  }
);

ipcMain.handle('terminal:write', async (_event, id: string, data: string) => {
  writeTerminal(id, data);
  return ok(null);
});

ipcMain.handle('terminal:resize', async (_event, id: string, cols: number, rows: number) => {
  resizeTerminal(id, cols, rows);
  return ok(null);
});

ipcMain.handle('terminal:kill', async (_event, id: string) => {
  killTerminal(id);
  return ok(null);
});

// ─── Live Monitor IPC ─────────────────────────────────────────────────────────

ipcMain.handle('live:getActiveSessions', async () => {
  try {
    return ok(await readActiveSessions());
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('live:getSessions', async () => {
  try {
    return ok(getBgSessions());
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('live:startWatch', async (event, hash: string, sessionId?: string) => {
  try {
    const projectPath = projectDir(hash);
    const started = await startLiveMonitor(projectPath, sessionId ?? null, liveEvent => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('live:event', liveEvent);
      }
    });
    return ok({ started });
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('live:stopWatch', async () => {
  stopLiveMonitor();
  return ok(null);
});

function openInTerminal(cwd: string, command: string): void {
  const dir = cwd || os.homedir();

  if (process.platform === 'darwin') {
    // Both values are embedded in an AppleScript double-quoted string, so
    // backslashes and quotes must be escaped or a crafted path/command could
    // break out of the string literal.
    const escapeAppleScript = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const escapedCwd = escapeAppleScript(dir);
    const escapedCommand = escapeAppleScript(command);
    const script = [
      'tell application "Terminal"',
      `do script "cd \\"${escapedCwd}\\" && ${escapedCommand}"`,
      'activate',
      'end tell',
    ].join('\n');
    execFile('osascript', ['-e', script]);
    return;
  }

  if (process.platform === 'win32') {
    // `start` is a cmd builtin (hence `cmd /c start`); the empty "" is the
    // window title. `start /d <dir>` sets the working directory for the new
    // window, so we avoid the `cd /d "..." && ...` chain — that broke under
    // cmd's quoting rules (the `&&` plus the quotes around the path stopped
    // cmd /k from stripping the outer quotes, yielding "The filename,
    // directory name, or volume label syntax is incorrect").
    // `cmd /k` runs the command and keeps the window open. The command tokens
    // are passed individually so Node doesn't wrap them in a single quoted arg.
    execFile('cmd.exe', ['/c', 'start', '', '/d', dir, 'cmd', '/k', ...command.split(' ')]);
    return;
  }

  // Linux: no single standard terminal, so try common emulators in order and
  // fall through on ENOENT. We pass the working directory via the spawn `cwd`
  // option (and `--working-directory` where supported) to avoid quoting it into
  // the shell command. `exec $SHELL` keeps the window open after the command.
  const shell = process.env.SHELL || 'bash';
  const inner = `${command}; exec ${shell}`;
  const candidates: Array<[string, string[]]> = [
    ['x-terminal-emulator', ['-e', 'bash', '-lc', inner]],
    ['gnome-terminal', ['--working-directory', dir, '--', 'bash', '-lc', inner]],
    ['konsole', ['--workdir', dir, '-e', 'bash', '-lc', inner]],
    ['xfce4-terminal', [`--working-directory=${dir}`, '-x', 'bash', '-lc', inner]],
    ['xterm', ['-e', 'bash', '-lc', inner]],
  ];

  const tryNext = (i: number): void => {
    if (i >= candidates.length) return;
    const [bin, args] = candidates[i];
    const child = execFile(bin, args, { cwd: dir });
    child.on('error', (e: NodeJS.ErrnoException) => {
      // Emulator not installed — try the next one.
      if (e?.code === 'ENOENT') tryNext(i + 1);
    });
  };
  tryNext(0);
}

// File watcher — pausa rientrante (gestisce eventuali merge concorrenti).
let watcherPauseDepth = 0;
function pauseWatcher() {
  watcherPauseDepth += 1;
}
function resumeWatcher() {
  if (watcherPauseDepth > 0) watcherPauseDepth -= 1;
}

async function startWatcher() {
  // Osserva le sessioni dei progetti, i task creati durante le sessioni
  // (~/.claude/tasks/{sessionUUID}/*.json) e i piani (~/.claude/plans/*.md):
  // così i subtab Tasks e Plans si aggiornano live.
  // chokidar 5 è ESM-only: import dinamico per usarlo dal bundle CommonJS.
  const { watch } = await import('chokidar');
  const watcher = watch([PROJECTS_DIR, TASKS_DIR, PLANS_DIR, INSTALLED_PLUGINS_FILE], {
    ignoreInitial: true,
    depth: 3,
  });

  const notify = () => {
    if (watcherPauseDepth > 0) return;
    safeSend('data:changed');
  };

  watcher.on('add', notify);
  watcher.on('change', notify);
  watcher.on('unlink', notify);

  // Registro sessioni vive (~/.claude/sessions/<pid>.json): push dedicato al
  // renderer invece del polling. Il file heartbeat-a ogni pochi secondi, quindi
  // l'evento NON passa per data:changed (invaliderebbe tutte le query React
  // Query di continuo) ma viaggia su un canale suo con il payload già letto.
  const sessionsWatcher = watch(defaultSessionsDir(), { ignoreInitial: true, depth: 0 });
  let pushTimer: NodeJS.Timeout | null = null;
  const pushActiveSessions = () => {
    if (pushTimer) return; // debounce: una lettura per raffica di eventi
    pushTimer = setTimeout(async () => {
      pushTimer = null;
      try {
        const sessions = await readActiveSessions();
        safeSend('live:activeSessions', sessions);
        // Same fresh snapshot also feeds the notification diff (transitions only).
        notifyFromRegistry(sessions);
      } catch {
        /* lettura fallita: il refetch periodico del renderer copre il buco */
      }
    }, 400);
  };
  sessionsWatcher.on('add', pushActiveSessions);
  sessionsWatcher.on('change', pushActiveSessions);
  sessionsWatcher.on('unlink', pushActiveSessions);

  // Background agents (~/.claude/jobs/<id>/state.json + daemon/roster.json):
  // push the fresh BgSession[] on its own channel so the Agent View updates
  // live instead of polling. state.json rewrites frequently while an agent
  // works, so debounce like the sessions registry above. Dedicated channel
  // (not data:changed) so these heartbeats don't invalidate every query.
  const bgWatcher = watch([join(CLAUDE_DIR, 'jobs'), join(CLAUDE_DIR, 'daemon')], {
    ignoreInitial: true,
    depth: 2,
  });
  let bgPushTimer: NodeJS.Timeout | null = null;
  const pushBgSessions = () => {
    if (bgPushTimer) return; // debounce: one read per burst of events
    bgPushTimer = setTimeout(() => {
      bgPushTimer = null;
      try {
        safeSend('live:bgSessions', getBgSessions());
      } catch {
        /* read failed: the renderer's slow refetch covers the gap */
      }
    }, 400);
  };
  bgWatcher.on('add', pushBgSessions);
  bgWatcher.on('change', pushBgSessions);
  bgWatcher.on('unlink', pushBgSessions);
}

app.whenReady().then(() => {
  if (process.env.SCREENSHOT_MODE) {
    registerScreenshotHandlers(ipcMain);
  }
  // Anonymous telemetry: set the opt-out gate, then send one launch event
  // (no-op when opted out / in screenshot mode). Sent via Node https, not
  // electron.net, so it never triggers the macOS Keychain prompt. See
  // modules/telemetry.ts.
  initTelemetry();
  void track('app_started');
  // Rimuove del tutto la menu bar nativa su Windows/Linux (incl. il toggle con Alt).
  // Su macOS la lasciamo: ospita l'app menu di sistema (Cmd+Q, copia/incolla, ecc.).
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  setupContentSecurityPolicy();
  createWindow();
  if (!process.env.SCREENSHOT_MODE) void startWatcher();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Closing the window must not leave orphan `claude` PTYs running. On macOS the
  // app stays alive in the dock (no quit → `will-quit` never fires), so dispose
  // the terminals here too — they should die with the window on every platform.
  disposeAllTerminals();
  if (process.platform !== 'darwin') app.quit();
});

// Send one `app_exited` event (with how long the app was open) before quitting,
// so we can gauge usage time. The first `before-quit` is deferred just long
// enough to let the event reach the network (capped at ~2s inside trackExit);
// re-quitting after that proceeds normally. No-op/instant when opted out.
let exitTracked = false;
app.on('before-quit', event => {
  if (exitTracked) return;
  exitTracked = true;
  event.preventDefault();
  void trackExit().finally(() => app.quit());
});

// Embedded-terminal PTYs are real `claude` processes: kill them on shutdown so
// none outlive the app.
app.on('will-quit', () => {
  disposeAllTerminals();
});
