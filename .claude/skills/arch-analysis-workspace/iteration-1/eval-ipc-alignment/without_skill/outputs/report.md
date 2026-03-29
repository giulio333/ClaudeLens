# IPC Alignment Report — ClaudeLens

**Data analisi:** 2026-03-28

---

## 1. Riepilogo

Analisi dell'allineamento tra i 27 handler IPC registrati in `electron/main.ts`, le 26 funzioni esposte nel bridge `electron/preload.ts` e i hook/chiamate dirette in `src/hooks/useIPC.ts` e componenti React.

---

## 2. Handler IPC in main.ts

| Canale IPC | Tipo | Handler presente |
|---|---|---|
| `memory:listProjects` | invoke | si |
| `memory:getProject` | invoke | si |
| `memory:createTopic` | invoke | si |
| `memory:updateTopic` | invoke | si |
| `memory:deleteTopic` | invoke | si |
| `cost:getSummary` | invoke | si |
| `cost:getByProject` | invoke | si |
| `claudeMd:getGlobal` | invoke | si |
| `claudeMd:getProject` | invoke | si |
| `claudeMd:getHierarchy` | invoke | si |
| `sessions:listByProject` | invoke | si |
| `sessions:getChat` | invoke | si |
| `sessions:openInTerminal` | invoke | si |
| `sessions:newInTerminal` | invoke | si |
| `rules:getByProject` | invoke | si |
| `skills:getGlobal` | invoke | si |
| `skills:getAll` | invoke | si |
| `skills:create` | invoke | si |
| `agents:getGlobal` | invoke | si |
| `agents:getByProject` | invoke | si |
| `agents:create` | invoke | si |
| `projects:delete` | invoke | si |
| `mcp:getGlobal` | invoke | si |
| `ai:run` | invoke | si |
| `ai:stop` | invoke | si |
| `live:getProcesses` | invoke | si |
| `live:startWatch` | invoke | si |
| `live:stopWatch` | invoke | si |
| `data:changed` | send (push) | si (chokidar watcher) |
| `ai:chunk` | send (push) | si (stdout stream) |
| `ai:done` | send (push) | si (close event) |
| `ai:error` | send (push) | si (stderr stream) |
| `live:event` | send (push) | si (live-monitor callback) |

---

## 3. Allineamento Preload Bridge

Il file `electron/preload.ts` espone **tutti** i canali invoke presenti in main.ts senza eccezioni.

I canali push (`data:changed`, `ai:chunk`, `ai:done`, `ai:error`, `live:event`) sono gestiti correttamente tramite `ipcRenderer.on()` con listener registrati nelle funzioni `onDataChanged`, `ai.onChunk`, `ai.onDone`, `ai.onError` e `live.onEvent`.

**Nessun canale mancante nel preload.**

---

## 4. Handler IPC non usati dal renderer

### 4.1 `claudeMd:getProject` — NON USATO

**Severita: media**

L'handler `claudeMd:getProject` esiste in main.ts ed e esposto nel preload, ma:
- Non c'e nessun hook `useProjectClaudeMd` in `useIPC.ts`
- Non viene chiamato da nessun componente React
- L'unico hook che usa il namespace `claudeMd` e `useClaudeMdHierarchy` (che chiama `claudeMd:getHierarchy`) e `useGlobalClaudeMd` (che chiama `claudeMd:getGlobal`)

Il tipo e dichiarato nel `Window.electronAPI` in `useIPC.ts`, ma non viene mai invocato.

**Probabile causa:** la funzionalita "project CLAUDE.md" era originariamente separata da `getHierarchy`, poi superseded dalla gerarchia completa. Il canale puo essere rimosso o e un candidato per future funzionalita.

### 4.2 `cost:getSummary` / `useCostSummary` — HOOK NON USATO

**Severita: bassa**

Il hook `useCostSummary()` e definito in `useIPC.ts` (riga 131) e chiama `cost:getSummary`, ma non viene importato ne usato in nessun componente React del progetto.

L'handler main.ts, il bridge preload e il tipo nel `Window` sono tutti presenti e corretti, ma il hook non e mai consumato. Il componente `AnalyticsView.tsx` usa `useSessionList` per ricavare i dati di costo per sessione, non il summary globale.

---

## 5. Problemi di tipo nel preload

### 5.1 Tipi `object` non tipizzati nel preload

**Severita: media**

In `electron/preload.ts`, tre funzioni usano `object` invece di tipi specifici per i parametri di input:

```typescript
// preload.ts — versione attuale (tipi deboli)
createTopic: (hash: string, input: object) => ipcRenderer.invoke('memory:createTopic', hash, input),
updateTopic: (hash: string, filename: string, input: object) => ipcRenderer.invoke('memory:updateTopic', hash, filename, input),
create: (input: object) => ipcRenderer.invoke('skills:create', input),       // skills
create: (input: object) => ipcRenderer.invoke('agents:create', input),       // agents
```

I tipi corretti (`TopicInput`, `SkillInput`, `AgentInput`) sono definiti in `electron/modules/` e nel renderer in `src/types.ts`, ma il preload — che compila con `tsconfig.electron.json` separato — non li importa. Il risultato e che il bridge non ha type safety end-to-end: un oggetto malformato passerebbe il controllo TypeScript nel preload.

Questo e un compromesso architetturale noto (il preload deve essere leggero e non importare tutta la logica backend), ma andrebbe documentato o risolto con un file di tipi condivisi.

### 5.2 `live.onEvent` — tipo `unknown` per il payload

**Severita: bassa**

```typescript
// preload.ts
onEvent: (cb: (event: unknown) => void) => { ... }

// useIPC.ts — Window declaration
onEvent: (cb: (event: unknown) => void) => void
```

Il tipo `unknown` e conservativo ma corretto come scelta difensiva. Tuttavia in `LiveMonitor.tsx` il cast esplicito `e as LiveEvent` aggira la type safety senza validazione runtime. Considerare di tipizzare il payload direttamente come `LiveEvent` nel preload declaration, oppure aggiungere un type guard.

---

## 6. Osservazioni aggiuntive

### 6.1 `ai:run` chiama direttamente `window.electronAPI` (non tramite hook)

Il componente `AiAssistantView.tsx` chiama `window.electronAPI.ai.run(...)`, `window.electronAPI.ai.stop()` e registra i listener push direttamente, senza hook React Query intermedi. Questo e coerente con la natura streaming dell'operazione (non e un fetch tradizionale), ma bypassa il pattern `unwrap()` e la gestione errori centralizzata di React Query.

### 6.2 `sessions:openInTerminal` e `sessions:newInTerminal` — chiamate dirette senza hook

Entrambe le funzioni terminale sono chiamate direttamente via `window.electronAPI.sessions.openInTerminal(...)` e `window.electronAPI.sessions.newInTerminal(...)` nei componenti `ChatView.tsx` e `SessionsDetailView.tsx`, senza hook dedicati. Questo e ragionevole (sono azioni fire-and-forget), ma non consistente con il pattern generale.

---

## 7. Riepilogo problemi

| Problema | File | Severita | Tipo |
|---|---|---|---|
| `claudeMd:getProject` handler mai usato dal renderer | `main.ts`, `preload.ts`, `useIPC.ts` | Media | Handler inutilizzato |
| `useCostSummary` hook definito ma mai usato | `useIPC.ts` | Bassa | Hook inutilizzato |
| Parametri `object` non tipizzati nel preload | `preload.ts` | Media | Tipo debole |
| `live.onEvent` payload tipizzato come `unknown` | `preload.ts`, `LiveMonitor.tsx` | Bassa | Tipo conservativo con cast unsafe |

---

## 8. File analizzati

- `/Users/giuliodigiamberardino/Desktop/ClaudeLens/claudelens-app/electron/main.ts`
- `/Users/giuliodigiamberardino/Desktop/ClaudeLens/claudelens-app/electron/preload.ts`
- `/Users/giuliodigiamberardino/Desktop/ClaudeLens/claudelens-app/src/hooks/useIPC.ts`
- `/Users/giuliodigiamberardino/Desktop/ClaudeLens/claudelens-app/src/types.ts`
- Tutti i componenti in `src/components/project/**/*.tsx` e `src/tabs/*.tsx`
