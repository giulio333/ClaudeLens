# Analisi Allineamento IPC — ClaudeLens

Data analisi: 2026-03-28

---

## 1. IPC Handlers nel Main Process (`electron/main.ts`)

| Handler | Namespace | Presenza in preload.ts | Presenza in useIPC.ts (hook) |
|---|---|---|---|
| `memory:listProjects` | memory | `memory.listProjects` | `useMemoryProjects` |
| `memory:getProject` | memory | `memory.getProject` | `useMemoryProject` |
| `memory:createTopic` | memory | `memory.createTopic` | `useCreateTopic` |
| `memory:updateTopic` | memory | `memory.updateTopic` | `useUpdateTopic` |
| `memory:deleteTopic` | memory | `memory.deleteTopic` | `useDeleteTopic` |
| `cost:getSummary` | cost | `cost.getSummary` | `useCostSummary` |
| `cost:getByProject` | cost | `cost.getByProject` | `useProjectSessions` |
| `claudeMd:getGlobal` | claudeMd | `claudeMd.getGlobal` | `useGlobalClaudeMd` |
| `claudeMd:getProject` | claudeMd | `claudeMd.getProject` | **MANCANTE** |
| `claudeMd:getHierarchy` | claudeMd | `claudeMd.getHierarchy` | `useClaudeMdHierarchy` |
| `sessions:listByProject` | sessions | `sessions.listByProject` | `useSessionList` |
| `sessions:getChat` | sessions | `sessions.getChat` | `useChatSession` |
| `sessions:openInTerminal` | sessions | `sessions.openInTerminal` | nessun hook (chiamata diretta) |
| `sessions:newInTerminal` | sessions | `sessions.newInTerminal` | nessun hook (chiamata diretta) |
| `rules:getByProject` | rules | `rules.getByProject` | `useProjectRules` |
| `skills:getGlobal` | skills | `skills.getGlobal` | `useGlobalSkills` |
| `skills:getAll` | skills | `skills.getAll` | `useAllSkills` |
| `skills:create` | skills | `skills.create` | `useCreateSkill` |
| `agents:getGlobal` | agents | `agents.getGlobal` | `useGlobalAgents` |
| `agents:getByProject` | agents | `agents.getByProject` | `useProjectAgents` |
| `agents:create` | agents | `agents.create` | `useCreateAgent` |
| `projects:delete` | projects | `projects.delete` | `useDeleteProject` |
| `mcp:getGlobal` | mcp | `mcp.getGlobal` | `useGlobalMcp` |
| `ai:run` | ai | `ai.run` | nessun hook (chiamata diretta) |
| `ai:stop` | ai | `ai.stop` | nessun hook (chiamata diretta) |
| `live:getProcesses` | live | `live.getProcesses` | nessun hook (chiamata diretta) |
| `live:startWatch` | live | `live.startWatch` | nessun hook (chiamata diretta) |
| `live:stopWatch` | live | `live.stopWatch` | nessun hook (chiamata diretta) |

**Totale handler in main.ts:** 27
**Handler senza hook in useIPC.ts:** 7 (di cui 6 usati direttamente nei componenti, 1 con potenziale problema — vedi sotto)

---

## 2. Problemi Trovati

### [WARNING] `claudeMd:getProject` — handler esposto ma mai usato

- **main.ts:** `ipcMain.handle('claudeMd:getProject', ...)` — registrato
- **preload.ts:** `claudeMd.getProject(realPath)` — esposto
- **useIPC.ts:** tipo dichiarato nella `Window` interface (`getProject: (realPath: string) => Promise<IpcResult<string | undefined>>`) ma **nessun hook `useProjectClaudeMd` è definito**
- **Componenti:** nessuna chiamata a `window.electronAPI.claudeMd.getProject(...)` trovata

**Impatto:** Il renderer utilizza esclusivamente `claudeMd:getHierarchy` per ottenere il CLAUDE.md di progetto (via `useClaudeMdHierarchy`). L'handler `getProject` è quindi completamente inutilizzato. Probabilmente è un residuo pre-gerarchia.

**Suggerimento:** Valutare la rimozione di `claudeMd:getProject` da main.ts, preload.ts e dalla dichiarazione di tipo in useIPC.ts, oppure creare un hook `useProjectClaudeMd` se l'uso separato torna utile.

---

### [WARNING] `live:*` — chiamate dirette senza hook React Query

Gli handler `live:getProcesses`, `live:startWatch`, `live:stopWatch` (e i listener `live:onEvent`) sono usati direttamente in `LiveMonitor.tsx` con `window.electronAPI.live.*` senza passare per useIPC.ts.

**Impatto:** Comportamento coerente funzionalmente (LiveMonitor è un componente isolato), ma inconsistente con il pattern del progetto. Le chiamate live non sono cachate da React Query e il componente gestisce manualmente il lifecycle.

**Suggerimento (bassa priorità):** Considerare l'aggiunta di hook dedicati (`useLiveProcesses`, `useLiveWatch`) in useIPC.ts per uniformità, oppure documentare l'eccezione nel CLAUDE.md.

---

### [WARNING] `ai:*` — chiamate dirette senza hook React Query

Gli handler `ai:run`, `ai:stop` e i listener `ai:chunk`, `ai:done`, `ai:error` sono usati direttamente in `AiAssistantView.tsx`.

**Impatto:** Analogo al caso `live:*`. La natura streaming dell'AI rende difficile l'integrazione con React Query, quindi il pattern diretto è giustificato. Il codice è corretto.

**Suggerimento:** Documentare esplicitamente nel CLAUDE.md che `ai:*` e `live:*` usano chiamate dirette per natura streaming/event-driven.

---

### [WARNING] `sessions:openInTerminal` e `sessions:newInTerminal` — chiamate dirette

Usati direttamente in `ChatView.tsx` (openInTerminal) e `SessionsDetailView.tsx` (entrambi), senza hook in useIPC.ts.

**Impatto:** Funzionano correttamente. Sono operazioni fire-and-forget senza stato da cachare. Tuttavia, l'assenza di hook li rende invisibili dall'analisi statica di useIPC.ts.

**Suggerimento (bassa priorità):** Coerenza di stile — aggiungere hook semplici `useOpenSessionInTerminal` e `useNewSessionInTerminal` o lasciare come eccezione documentata.

---

## 3. Tipi Mancanti nel Preload (`electron/preload.ts`)

Il preload usa `object` generico in tre punti invece di tipi specifici:

| Metodo | Tipo attuale nel preload | Tipo nel corrispondente hook (useIPC.ts) |
|---|---|---|
| `memory.createTopic(hash, input: object)` | `object` | `TopicInput` |
| `memory.updateTopic(hash, filename, input: object)` | `object` | `TopicInput` |
| `skills.create(input: object)` | `object` | `SkillInput` |
| `agents.create(input: object)` | `object` | `AgentInput` |

**Impatto:** Il preload è compilato con `tsconfig.electron.json` e non importa i tipi condivisi dal renderer. Questo è tecnicamente accettabile (il preload riceve i dati già tipizzati dal renderer tramite IPC, e IPC serializza tutto in JSON comunque). Tuttavia, la mancanza di tipi nel preload rende più difficile rilevare errori di firma a compile-time nel layer preload stesso.

**Suggerimento:** Creare un file `electron/types-shared.ts` con le interfacce `TopicInput`, `SkillInput`, `AgentInput` che sia importabile sia da `main.ts` sia da `preload.ts` (entrambi compilati con `tsconfig.electron.json`). Questo eliminerebbe i `object` generici.

---

## 4. Riepilogo

| Categoria | Stato |
|---|---|
| Handler IPC senza preload corrispondente | 0 — nessun handler orfano nel main |
| Handler preload senza handler IPC | 0 — tutti i metodi preload hanno handler |
| Handler usati solo con chiamata diretta (no hook) | 7 (`sessions:openInTerminal`, `sessions:newInTerminal`, `ai:run`, `ai:stop`, `live:getProcesses`, `live:startWatch`, `live:stopWatch`) |
| Handler completamente inutilizzato | **1** (`claudeMd:getProject`) — severity: WARNING |
| Tipo dichiarato in Window ma senza hook | **1** (`claudeMd.getProject`) |
| Tipi generici `object` nel preload | **4** (`createTopic`, `updateTopic`, `skills.create`, `agents.create`) |

### Problema prioritario

> **`claudeMd:getProject` è un dead code path** — registrato in main, esposto in preload, dichiarato nei tipi, ma mai chiamato. Va rimosso o documentato se intenzionalmente riservato per uso futuro.
