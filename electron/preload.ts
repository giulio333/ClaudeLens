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
  },
  claudeMd: {
    getGlobal: () => ipcRenderer.invoke('claudeMd:getGlobal'),
    getHierarchy: (realPath: string) => ipcRenderer.invoke('claudeMd:getHierarchy', realPath),
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
  skills: {
    getGlobal: () => ipcRenderer.invoke('skills:getGlobal'),
    getAll: (realPath: string) => ipcRenderer.invoke('skills:getAll', realPath),
    create: (input: object) => ipcRenderer.invoke('skills:create', input),
  },
  agents: {
    getGlobal: () => ipcRenderer.invoke('agents:getGlobal'),
    getByProject: (realPath: string) => ipcRenderer.invoke('agents:getByProject', realPath),
    create: (input: object) => ipcRenderer.invoke('agents:create', input),
  },
  mcp: {
    getGlobal: () => ipcRenderer.invoke('mcp:getGlobal'),
  },
  projects: {
    delete: (hash: string) => ipcRenderer.invoke('projects:delete', hash),
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
  onDataChanged: (callback: () => void) => {
    ipcRenderer.on('data:changed', () => callback());
  },
  live: {
    getProcesses: () => ipcRenderer.invoke('live:getProcesses'),
    startWatch: (hash: string) => ipcRenderer.invoke('live:startWatch', hash),
    stopWatch: () => ipcRenderer.invoke('live:stopWatch'),
    onEvent: (cb: (event: unknown) => void) => {
      ipcRenderer.removeAllListeners('live:event');
      ipcRenderer.on('live:event', (_event, data) => cb(data));
    },
  },
});
