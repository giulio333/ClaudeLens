import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  memory: {
    listProjects: () => ipcRenderer.invoke('memory:listProjects'),
    getProject: (hash: string) => ipcRenderer.invoke('memory:getProject', hash),
    createTopic: (hash: string, input: object) => ipcRenderer.invoke('memory:createTopic', hash, input),
    updateTopic: (hash: string, filename: string, input: object) => ipcRenderer.invoke('memory:updateTopic', hash, filename, input),
    deleteTopic: (hash: string, filename: string) => ipcRenderer.invoke('memory:deleteTopic', hash, filename),
  },
  cost: {
    getSummary: () => ipcRenderer.invoke('cost:getSummary'),
    getByProject: (hash: string) => ipcRenderer.invoke('cost:getByProject', hash),
    getPricingMeta: () => ipcRenderer.invoke('cost:getPricingMeta'),
  },
  claudeMd: {
    getGlobal: () => ipcRenderer.invoke('claudeMd:getGlobal'),
    getHierarchy: (realPath: string) => ipcRenderer.invoke('claudeMd:getHierarchy', realPath),
    writeGlobal: (content: string) => ipcRenderer.invoke('claudeMd:writeGlobal', content),
    writeFile: (filePath: string, content: string) => ipcRenderer.invoke('claudeMd:writeFile', filePath, content),
    deleteGlobal: () => ipcRenderer.invoke('claudeMd:deleteGlobal'),
    deleteFile: (filePath: string) => ipcRenderer.invoke('claudeMd:deleteFile', filePath),
  },
  markdownFile: {
    write: (filePath: string, content: string) => ipcRenderer.invoke('markdownFile:write', filePath, content),
    delete: (filePath: string, opts?: { pruneEmptyDir?: boolean }) => ipcRenderer.invoke('markdownFile:delete', filePath, opts),
  },
  exportFile: {
    saveMarkdown: (defaultFilename: string, content: string) =>
      ipcRenderer.invoke('export:markdown', defaultFilename, content),
    savePdf: (defaultFilename: string, html: string) =>
      ipcRenderer.invoke('export:pdf', defaultFilename, html),
  },
  sessions: {
    listByProject: (hash: string) => ipcRenderer.invoke('sessions:listByProject', hash),
    getChat: (hash: string, filename: string) => ipcRenderer.invoke('sessions:getChat', hash, filename),
    openInTerminal: (realPath: string, sessionId: string) => ipcRenderer.invoke('sessions:openInTerminal', realPath, sessionId),
    newInTerminal: (realPath: string) => ipcRenderer.invoke('sessions:newInTerminal', realPath),
  },
  rules: {
    getByProject: (realPath: string) => ipcRenderer.invoke('rules:getByProject', realPath),
  },
  tasks: {
    getByProject: (hash: string) => ipcRenderer.invoke('tasks:getByProject', hash),
  },
  plans: {
    getByProject: (hash: string) => ipcRenderer.invoke('plans:getByProject', hash),
  },
  skills: {
    getGlobal: () => ipcRenderer.invoke('skills:getGlobal'),
    getAll: (realPath: string) => ipcRenderer.invoke('skills:getAll', realPath),
    create: (input: object, projectPath?: string) => ipcRenderer.invoke('skills:create', input, projectPath),
  },
  agents: {
    getGlobal: () => ipcRenderer.invoke('agents:getGlobal'),
    getByProject: (realPath: string) => ipcRenderer.invoke('agents:getByProject', realPath),
    create: (input: object, projectPath?: string) => ipcRenderer.invoke('agents:create', input, projectPath),
    dispatchBg: (cwd: string, prompt: string, name?: string, agent?: string, model?: string) => ipcRenderer.invoke('agents:dispatchBg', cwd, prompt, name, agent, model),
    deleteBg: (id: string) => ipcRenderer.invoke('agents:deleteBg', id),
    stopBg: (id: string) => ipcRenderer.invoke('agents:stopBg', id),
    respawnBg: (id: string) => ipcRenderer.invoke('agents:respawnBg', id),
    attachBg: (cwd: string, id: string) => ipcRenderer.invoke('agents:attachBg', cwd, id),
  },
  mcp: {
    getGlobal: () => ipcRenderer.invoke('mcp:getGlobal'),
  },
  projects: {
    delete: (hash: string) => ipcRenderer.invoke('projects:delete', hash),
    detectDuplicates: () => ipcRenderer.invoke('projects:detectDuplicates'),
    planMerge: (sourceHash: string, destHash: string) =>
      ipcRenderer.invoke('projects:planMerge', sourceHash, destHash),
    executeMerge: (sourceHash: string, destHash: string) =>
      ipcRenderer.invoke('projects:executeMerge', sourceHash, destHash),
  },
  ai: {
    run: (instruction: string, inputContent: string, projectPath: string) =>
      ipcRenderer.invoke('ai:run', instruction, inputContent, projectPath),
    stop: () => ipcRenderer.invoke('ai:stop'),
    onChunk: (cb: (chunk: string) => void) => {
      ipcRenderer.removeAllListeners('ai:chunk');
      ipcRenderer.on('ai:chunk', (_event, chunk) => cb(chunk));
    },
    onDone: (cb: () => void) => {
      ipcRenderer.removeAllListeners('ai:done');
      ipcRenderer.on('ai:done', () => cb());
    },
    onError: (cb: (error: string) => void) => {
      ipcRenderer.removeAllListeners('ai:error');
      ipcRenderer.on('ai:error', (_event, error) => cb(error));
    },
  },
  settings: {
    getCleanupPeriodDays: () => ipcRenderer.invoke('settings:getCleanupPeriodDays'),
  },
  onDataChanged: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('data:changed', handler);
    return () => ipcRenderer.removeListener('data:changed', handler);
  },
  live: {
    getProcesses: () => ipcRenderer.invoke('live:getProcesses'),
    getSessions: () => ipcRenderer.invoke('live:getSessions'),
    startWatch: (hash: string) => ipcRenderer.invoke('live:startWatch', hash),
    stopWatch: () => ipcRenderer.invoke('live:stopWatch'),
    onEvent: (cb: (event: unknown) => void) => {
      ipcRenderer.removeAllListeners('live:event');
      ipcRenderer.on('live:event', (_event, data) => cb(data));
    },
  },
});
