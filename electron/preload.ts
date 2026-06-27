import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

// Subscribe to a renderer IPC channel with a *named* handler and return an
// unsubscribe disposer. Unlike `removeAllListeners(channel)` (the old pattern),
// this removes only this subscription, so two components can listen on the same
// channel without silently clobbering each other's listener — and a re-render
// can't drop an event in the gap between a removeAll and the re-add. Callers must
// call the returned disposer on cleanup (mirrors `onDataChanged`).
function subscribe<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, ...args: unknown[]) => cb(...(args as T));
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

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
    getSubagents: (hash: string, filename: string) => ipcRenderer.invoke('sessions:getSubagents', hash, filename),
    getSubagentTranscript: (hash: string, filename: string, agentId: string) =>
      ipcRenderer.invoke('sessions:getSubagentTranscript', hash, filename, agentId),
    getArtifacts: (hash: string, filename: string) =>
      ipcRenderer.invoke('sessions:getArtifacts', hash, filename),
    deleteSession: (paths: string[]) => ipcRenderer.invoke('sessions:deleteSession', paths),
    sendMessage: (
      realPath: string,
      sessionId: string,
      message: string,
      model?: string,
      permissionMode?: string
    ) => ipcRenderer.invoke('sessions:sendMessage', realPath, sessionId, message, model, permissionMode),
    startMessage: (
      realPath: string,
      message: string,
      model?: string,
      permissionMode?: string
    ) => ipcRenderer.invoke('sessions:startMessage', realPath, message, model, permissionMode),
    stopMessage: () => ipcRenderer.invoke('sessions:stopMessage'),
    endChat: () => ipcRenderer.invoke('sessions:endChat'),
    respondPermission: (requestId: string, decision: unknown) =>
      ipcRenderer.invoke('sessions:permissionResponse', requestId, decision),
    onPermissionRequest: (cb: (request: unknown) => void) =>
      subscribe('sessions:permissionRequest', cb),
    onChatStarted: (cb: (sessionId: string) => void) => subscribe('sessions:chatStarted', cb),
    onChatChunk: (cb: (chunk: string) => void) => subscribe('sessions:chatChunk', cb),
    onChatToolActivity: (cb: (activity: unknown) => void) =>
      subscribe('sessions:chatToolActivity', cb),
    onChatMessage: (cb: (message: unknown) => void) => subscribe('sessions:chatMessage', cb),
    onChatDone: (cb: () => void) => subscribe('sessions:chatDone', cb),
    onChatError: (cb: (error: string) => void) => subscribe('sessions:chatError', cb),
  },
  terminal: {
    create: (opts: { cwd: string; resumeSessionId?: string; attachJobId?: string; cols?: number; rows?: number }) =>
      ipcRenderer.invoke('terminal:create', opts),
    write: (id: string, data: string) => ipcRenderer.invoke('terminal:write', id, data),
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.invoke('terminal:resize', id, cols, rows),
    kill: (id: string) => ipcRenderer.invoke('terminal:kill', id),
    onData: (cb: (id: string, data: string) => void) => subscribe('terminal:data', cb),
    onExit: (cb: (id: string, exitCode: number) => void) => subscribe('terminal:exit', cb),
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
    readFile: (skillPath: string, relPath: string) => ipcRenderer.invoke('skills:readFile', skillPath, relPath),
    writeFile: (skillPath: string, relPath: string, content: string) => ipcRenderer.invoke('skills:writeFile', skillPath, relPath, content),
    openFile: (skillPath: string, relPath: string) => ipcRenderer.invoke('skills:openFile', skillPath, relPath),
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
  plugins: {
    getAll: () => ipcRenderer.invoke('plugins:getAll'),
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
    onChunk: (cb: (chunk: string) => void) => subscribe('ai:chunk', cb),
    onDone: (cb: () => void) => subscribe('ai:done', cb),
    onError: (cb: (error: string) => void) => subscribe('ai:error', cb),
  },
  settings: {
    getCleanupPeriodDays: () => ipcRenderer.invoke('settings:getCleanupPeriodDays'),
  },
  config: {
    getEffective: (cwd?: string) => ipcRenderer.invoke('config:getEffective', cwd),
  },
  prefs: {
    getAll: () => ipcRenderer.invoke('prefs:getAll'),
    set: (key: string, value: unknown) => ipcRenderer.invoke('prefs:set', key, value),
  },
  notifications: {
    onEvent: (cb: (event: unknown) => void) => subscribe('notifications:event', cb),
    clearBadge: () => ipcRenderer.invoke('notifications:clearBadge'),
  },
  telemetry: {
    isEnabled: () => ipcRenderer.invoke('telemetry:isEnabled'),
    setEnabled: (enabled: boolean) => ipcRenderer.invoke('telemetry:setEnabled', enabled),
    track: (name: string, props?: Record<string, string | number>) =>
      ipcRenderer.invoke('telemetry:track', name, props),
  },
  onDataChanged: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('data:changed', handler);
    return () => ipcRenderer.removeListener('data:changed', handler);
  },
  live: {
    getActiveSessions: () => ipcRenderer.invoke('live:getActiveSessions'),
    onActiveSessionsChanged: (callback: (sessions: unknown) => void) => {
      const handler = (_event: unknown, data: unknown) => callback(data);
      ipcRenderer.on('live:activeSessions', handler);
      return () => ipcRenderer.removeListener('live:activeSessions', handler);
    },
    getSessions: () => ipcRenderer.invoke('live:getSessions'),
    onBgSessionsChanged: (callback: (sessions: unknown) => void) => {
      const handler = (_event: unknown, data: unknown) => callback(data);
      ipcRenderer.on('live:bgSessions', handler);
      return () => ipcRenderer.removeListener('live:bgSessions', handler);
    },
    startWatch: (hash: string, sessionId?: string) =>
      ipcRenderer.invoke('live:startWatch', hash, sessionId),
    stopWatch: () => ipcRenderer.invoke('live:stopWatch'),
    onEvent: (cb: (event: unknown) => void) => subscribe('live:event', cb),
  },
});
