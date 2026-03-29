import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import os from 'os';
import chokidar from 'chokidar';
import { execFile, spawn, ChildProcess } from 'child_process';

import { listProjectsWithMemory, readMemory } from './modules/memory-reader';
import { createTopic, updateTopic, deleteTopic, TopicInput } from './modules/memory-writer';
import { calculateCostSummary, getSessionList, getProjectUsage } from './modules/cost-tracker';
import {
  readGlobalClaudeMd,
  getClaudeMdHierarchy,
} from './modules/claude-md-reader';
import { readProjectRules } from './modules/rules-reader';
import { readChatSession, findSessionFile } from './modules/session-reader';
import { getGlobalSkills, getAllSkills } from './modules/skills-reader';
import { getGlobalAgents, getProjectAgents } from './modules/agents-reader';
import { createGlobalSkill, SkillInput } from './modules/skills-writer';
import { createGlobalAgent, AgentInput } from './modules/agents-writer';
import { getGlobalMcp } from './modules/mcp-reader';
import { findClaudeProcesses } from './modules/process-scanner';
import { startLiveMonitor, stopLiveMonitor } from './modules/live-monitor';
import { hashToPath } from './utils';
import { registerScreenshotHandlers } from './screenshotFixtures';

const CLAUDE_DIR = join(os.homedir(), '.claude');
const PROJECTS_DIR = join(CLAUDE_DIR, 'projects');

type IpcResult<T> = { data: T | null; error: string | null };

function ok<T>(data: T): IpcResult<T> {
  return { data, error: null };
}

function err<T>(e: unknown): IpcResult<T> {
  return { data: null, error: e instanceof Error ? e.message : String(e) };
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

function createWindow() {
  const isDev = !app.isPackaged;
  const iconPath = isDev
    ? join(__dirname, '../icon4.icns')
    : join(app.getAppPath(), 'icon4.icns');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#0f172a',
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'));
  }
}

// IPC Handlers
ipcMain.handle('memory:listProjects', async (): Promise<IpcResult<Array<{ hash: string; realPath: string }>>> => {
  try {
    const hashes = await listProjectsWithMemory(PROJECTS_DIR);
    const projects = hashes.map(hash => ({
      hash,
      realPath: hashToPath(hash),
    }));
    return ok(projects);
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('memory:getProject', async (_event, hash: string) => {
  try {
    const projectPath = join(PROJECTS_DIR, hash);
    const realPath = hashToPath(hash);
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

ipcMain.handle('cost:getByProject', async (_event, hash: string) => {
  try {
    const projectPath = join(PROJECTS_DIR, hash);
    const { usage, sessionCount } = await getProjectUsage(projectPath);
    const result = {
      project: hash,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      cost: (usage.inputTokens / 1_000_000) * 3.0 + (usage.outputTokens / 1_000_000) * 15.0,
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

ipcMain.handle('sessions:listByProject', async (_event, hash: string) => {
  try {
    const projectPath = join(PROJECTS_DIR, hash);
    const sessions = await getSessionList(projectPath);
    return ok(sessions);
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('memory:createTopic', async (_event, hash: string, input: TopicInput) => {
  try {
    const memoryDir = join(PROJECTS_DIR, hash, 'memory');
    const filename = createTopic(memoryDir, input);
    return ok({ filename });
  } catch (e) { return err(e); }
});

ipcMain.handle('memory:updateTopic', async (_event, hash: string, filename: string, input: TopicInput) => {
  try {
    const memoryDir = join(PROJECTS_DIR, hash, 'memory');
    updateTopic(memoryDir, filename, input);
    return ok(null);
  } catch (e) { return err(e); }
});

ipcMain.handle('memory:deleteTopic', async (_event, hash: string, filename: string) => {
  try {
    const memoryDir = join(PROJECTS_DIR, hash, 'memory');
    deleteTopic(memoryDir, filename);
    return ok(null);
  } catch (e) { return err(e); }
});

ipcMain.handle('sessions:getChat', async (_event, hash: string, filename: string) => {
  try {
    const projectPath = join(PROJECTS_DIR, hash);
    const filePath = await findSessionFile(projectPath, filename);
    if (!filePath) return err(new Error(`File sessione non trovato: ${filename}`));
    const messages = readChatSession(filePath);
    return ok(messages);
  } catch (e) { return err(e); }
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

ipcMain.handle('skills:create', async (_event, input: SkillInput) => {
  try {
    const filePath = createGlobalSkill(input);
    return ok({ filePath });
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('agents:create', async (_event, input: AgentInput) => {
  try {
    const filePath = createGlobalAgent(input);
    return ok({ filePath });
  } catch (e) {
    return err(e);
  }
});

ipcMain.handle('projects:delete', async (_event, hash: string) => {
  try {
    const projectPath = join(PROJECTS_DIR, hash);
    const { rmSync } = await import('fs');
    rmSync(projectPath, { recursive: true, force: true });
    return ok(null);
  } catch (e) {
    return err(e);
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

ipcMain.handle('ai:run', async (event, instruction: string, inputContent: string, projectPath: string) => {
  if (currentAiProcess) {
    currentAiProcess.kill();
    currentAiProcess = null;
  }

  return new Promise<IpcResult<null>>((resolve) => {
    // Con shell:true su Unix, spawn(cmd, args) diventa: /bin/sh -c cmd arg1 arg2
    // dove arg1/arg2 sono $0/$1 della shell, NON argomenti di cmd.
    // Soluzione: passare tutto come stringa singola con args=[].
    const escapedInstruction = instruction.replace(/'/g, "'\\''");
    const cmd = `claude -p '${escapedInstruction}' --model Haiku --allowedTools 'Read,Glob,Grep,WebSearch,WebFetch' --no-session-persistence`;
    const localBinPath = join(os.homedir(), '.local', 'bin');
    const proc = spawn(cmd, [], {
      cwd: projectPath,
      shell: true,
      env: { ...process.env, PATH: `${localBinPath}:/usr/local/bin:${process.env.PATH || ''}` },
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

    proc.on('close', (code) => {
      currentAiProcess = null;
      if (code === 0 || code === null) {
        event.sender.send('ai:done');
        resolve(ok(null));
      } else {
        event.sender.send('ai:done');
        resolve(err(new Error(`Processo terminato con codice ${code}`)));
      }
    });

    proc.on('error', (e) => {
      currentAiProcess = null;
      event.sender.send('ai:error', e.message);
      event.sender.send('ai:done');
      resolve(err(e));
    });
  });
});

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

ipcMain.handle('live:startWatch', async (event, hash: string) => {
  try {
    const projectPath = join(PROJECTS_DIR, hash);
    const started = await startLiveMonitor(projectPath, (liveEvent) => {
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
  const escapedCwd = cwd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const script = [
    'tell application "Terminal"',
    `do script "cd \\"${escapedCwd}\\" && ${command}"`,
    'activate',
    'end tell',
  ].join('\n');
  execFile('osascript', ['-e', script]);
}

ipcMain.handle('sessions:openInTerminal', async (_event, realPath: string, sessionId: string) => {
  try {
    openInTerminal(realPath, `claude --resume ${sessionId}`);
    return ok(null);
  } catch (e) { return err(e); }
});

ipcMain.handle('sessions:newInTerminal', async (_event, realPath: string) => {
  try {
    openInTerminal(realPath, 'claude');
    return ok(null);
  } catch (e) { return err(e); }
});

// File watcher
function startWatcher() {
  const watcher = chokidar.watch(PROJECTS_DIR, {
    ignoreInitial: true,
    depth: 3,
  });

  const notify = () => {
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
  createWindow();
  if (!process.env.SCREENSHOT_MODE) startWatcher();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
