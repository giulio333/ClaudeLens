import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from 'electron';
import { basename, delimiter, isAbsolute, join, resolve, sep } from 'path';
import os from 'os';
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
import { readChatSession, findSessionFile } from './modules/session-reader';
import { getProjectTasks } from './modules/tasks-reader';
import { getProjectPlans } from './modules/plans-reader';
import { getGlobalSkills, getAllSkills } from './modules/skills-reader';
import { getGlobalAgents, getProjectAgents } from './modules/agents-reader';
import { createSkill, SkillInput } from './modules/skills-writer';
import { createAgent, AgentInput } from './modules/agents-writer';
import { getGlobalMcp } from './modules/mcp-reader';
import { readEffectiveConfig } from './modules/config-reader';
import { findClaudeProcesses } from './modules/process-scanner';
import { getBgSessions } from './modules/bg-sessions-reader';
import { startLiveMonitor, stopLiveMonitor } from './modules/live-monitor';
import { detectDuplicateProjects } from './modules/duplicate-detector';
import { computeMergePlan } from './modules/duplicate-merger';
import { executeMerge } from './modules/duplicate-merge-executor';
import { hashToPath, resolveRealPath, invalidateCwdCache, CLAUDE_DIR } from './utils';
import { registerScreenshotHandlers } from './screenshotFixtures';
const PROJECTS_DIR = join(CLAUDE_DIR, 'projects');
const TASKS_DIR = join(CLAUDE_DIR, 'tasks');
const PLANS_DIR = join(CLAUDE_DIR, 'plans');

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
  requireUnderHome?: boolean;
}

// Valida un path fornito dal renderer prima di scriverci/cancellarlo (vedi #14):
// dev'essere assoluto, normalizzato (collassa `..`/`.`) e con un basename ammesso
// (allowlist) oppure `.md`; opzionalmente contenuto nella home. Ritorna il path normalizzato.
function assertSafeWritePath(filePath: string, opts: SafeWritePathOptions = {}): string {
  if (!filePath || typeof filePath !== 'string') throw new Error('Missing filePath');
  if (!isAbsolute(filePath)) throw new Error('Path must be absolute');
  const resolved = resolve(filePath);
  if (opts.requireUnderHome) {
    const home = os.homedir();
    if (resolved !== home && !resolved.startsWith(home + sep)) {
      throw new Error('Path must be under home directory');
    }
  }
  const base = basename(resolved);
  if (opts.allowedBasenames) {
    if (!opts.allowedBasenames.has(base)) throw new Error(`Refusing to write file: ${base}`);
  } else if (!base.toLowerCase().endsWith('.md')) {
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
  const iconPath = isDev ? join(__dirname, '../icon4.icns') : join(app.getAppPath(), 'icon4.icns');

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
    const safePath = assertSafeWritePath(filePath, { requireUnderHome: true });
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
      const safePath = assertSafeWritePath(filePath, { requireUnderHome: true });
      if (fs.existsSync(safePath)) fs.rmSync(safePath);
      // Per le skill (skills/<name>/SKILL.md) rimuovi la cartella contenitore se resta vuota.
      if (opts?.pruneEmptyDir) {
        const dir = path.dirname(safePath);
        if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0)
          fs.rmSync(dir, { recursive: false });
      }
      return ok(null);
    } catch (e) {
      return err(e);
    }
  }
);

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

ipcMain.handle('sessions:getChat', async (_event, hash: string, filename: string) => {
  try {
    assertValidFilename(filename);
    const projectPath = projectDir(hash);
    const filePath = await findSessionFile(projectPath, filename);
    if (!filePath) return err(new Error(`File sessione non trovato: ${filename}`));
    const messages = readChatSession(filePath);
    return ok(messages);
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
    mainWindow?.webContents.send('data:changed');
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

// ─── Live Monitor IPC ─────────────────────────────────────────────────────────

ipcMain.handle('live:getProcesses', async () => {
  try {
    const processes = await findClaudeProcesses();
    return ok(processes);
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

ipcMain.handle('live:startWatch', async (event, hash: string) => {
  try {
    const projectPath = projectDir(hash);
    const started = await startLiveMonitor(projectPath, liveEvent => {
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
    const escapedCwd = dir.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const script = [
      'tell application "Terminal"',
      `do script "cd \\"${escapedCwd}\\" && ${command}"`,
      'activate',
      'end tell',
    ].join('\n');
    execFile('osascript', ['-e', script]);
    return;
  }

  if (process.platform === 'win32') {
    // `start` is a cmd builtin (hence `cmd /c start`); the empty "" is the
    // window title. `cmd /k` runs the command and keeps the window open.
    // `cd /d` switches drive and directory in one go.
    execFile('cmd.exe', ['/c', 'start', '', 'cmd', '/k', `cd /d "${dir}" && ${command}`]);
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

/**
 * Background sessions (managed by `claude agents`) reject plain `--resume`,
 * so we always use `claude attach <id>` — works for both alive and terminal
 * sessions and shows the real conversation rather than forking a copy.
 * Foreground sessions keep the regular `--resume` behavior.
 */
function buildResumeCommand(sessionId: string): string {
  try {
    const bg = getBgSessions().find(s => s.sessionId === sessionId);
    if (bg) return `claude attach ${bg.id}`;
  } catch {
    // fall through to default
  }
  return `claude --resume ${sessionId}`;
}

ipcMain.handle('sessions:openInTerminal', async (_event, realPath: string, sessionId: string) => {
  try {
    openInTerminal(realPath, buildResumeCommand(sessionId));
    return ok(null);
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('sessions:newInTerminal', async (_event, realPath: string) => {
  try {
    openInTerminal(realPath, 'claude');
    return ok(null);
  } catch (e) {
    return err(e);
  }
});

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
  const watcher = watch([PROJECTS_DIR, TASKS_DIR, PLANS_DIR], {
    ignoreInitial: true,
    depth: 3,
  });

  const notify = () => {
    if (watcherPauseDepth > 0) return;
    mainWindow?.webContents.send('data:changed');
  };

  watcher.on('add', notify);
  watcher.on('change', notify);
  watcher.on('unlink', notify);
}

app.whenReady().then(() => {
  if (process.env.SCREENSHOT_MODE) {
    registerScreenshotHandlers(ipcMain);
  }
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
  if (process.platform !== 'darwin') app.quit();
});
