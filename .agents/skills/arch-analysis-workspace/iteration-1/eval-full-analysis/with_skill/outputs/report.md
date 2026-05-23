# Analisi Architetturale — ClaudeLens

> Generato il 2026-03-28

---

## 1. Main Process — IPC Handlers (`electron/main.ts`)

### Elenco completo degli handler per namespace

| Namespace | Handler | Descrizione |
|-----------|---------|-------------|
| `memory:*` | `memory:listProjects` | Lista progetti con dati in `~/.claude/projects/` |
| `memory:*` | `memory:getProject` | Legge memoria di un progetto (index + topic files + MEMORY.md) |
| `memory:*` | `memory:createTopic` | Crea un nuovo file topic e aggiorna MEMORY.md |
| `memory:*` | `memory:updateTopic` | Aggiorna contenuto topic e MEMORY.md |
| `memory:*` | `memory:deleteTopic` | Elimina file topic e riga da MEMORY.md |
| `cost:*` | `cost:getSummary` | Calcola costi aggregati di tutti i progetti |
| `cost:*` | `cost:getByProject` | Costi di un singolo progetto (con calcolo hardcoded Sonnet 3.0/15.0) |
| `claudeMd:*` | `claudeMd:getGlobal` | Legge `~/.claude/CLAUDE.md` |
| `claudeMd:*` | `claudeMd:getProject` | Legge CLAUDE.md nella root del progetto |
| `claudeMd:*` | `claudeMd:getHierarchy` | Legge l'intera gerarchia CLAUDE.md (global→project→local→subdir) |
| `sessions:*` | `sessions:listByProject` | Lista sessioni JSONL con metadati (token, costo, modelli) |
| `sessions:*` | `sessions:getChat` | Legge messaggi di una sessione specifica |
| `sessions:*` | `sessions:openInTerminal` | Apre Terminal per riprendere una sessione |
| `sessions:*` | `sessions:newInTerminal` | Apre Terminal per nuova sessione nel progetto |
| `rules:*` | `rules:getByProject` | Legge file `.claude/rules/**/*.md` con frontmatter `paths` |
| `skills:*` | `skills:getGlobal` | Lista skill globali da `~/.claude/skills/` |
| `skills:*` | `skills:getAll` | Lista skill globali + progetto (priorità al progetto) |
| `skills:*` | `skills:create` | Crea nuova skill globale |
| `agents:*` | `agents:getGlobal` | Lista agent globali da `~/.claude/agents/` |
| `agents:*` | `agents:getByProject` | Lista agent del progetto |
| `agents:*` | `agents:create` | Crea nuovo agent globale |
| `projects:*` | `projects:delete` | Elimina ricorsivamente la cartella del progetto |
| `mcp:*` | `mcp:getGlobal` | Legge server MCP da `~/.claude.json` e `~/.claude/settings.json` |
| `ai:*` | `ai:run` | Spawna `claude -p` con streaming su `ai:chunk` / `ai:done` / `ai:error` |
| `ai:*` | `ai:stop` | Termina il processo AI corrente |
| `live:*` | `live:getProcesses` | Scansiona i processi Claude attivi via `ps` + `lsof` |
| `live:*` | `live:startWatch` | Avvia il file watcher sul JSONL più recente del progetto |
| `live:*` | `live:stopWatch` | Ferma il file watcher attivo |

**Totale: 28 handler**

### Handler senza corrispondente hook in `useIPC.ts`

| Handler | Stato |
|---------|-------|
| `claudeMd:getProject` | **warning** — esposto nel preload (`claudeMd.getProject`) e tipizzato in `useIPC.ts`, ma **nessun hook React Query** lo consuma. Usato direttamente via `window.electronAPI.claudeMd.getProject` in `GlobalClaudeMdView.tsx` oppure non usato. |
| `ai:run` / `ai:stop` / `ai:onChunk` / `ai:onDone` / `ai:onError` | **ok** — usati direttamente in `AiAssistantView.tsx` (non necessitano React Query per il loro pattern streaming) |
| `live:getProcesses` / `live:startWatch` / `live:stopWatch` / `live:onEvent` | **ok** — usati direttamente in `LiveMonitor.tsx` |

---

## 2. Backend Modules (`electron/modules/`)

### Panoramica moduli

| Modulo | Responsabilità | Funzioni esportate | Dipendenze FS |
|--------|---------------|-------------------|---------------|
| `memory-reader.ts` | Legge indice e topic files di memoria | `readMemory`, `listProjectsWithMemory` | `~/.claude/projects/{hash}/memory/`, `{realPath}/.claude/memory/` |
| `memory-writer.ts` | Crea/aggiorna/elimina topic, mantiene MEMORY.md sincronizzato | `createTopic`, `updateTopic`, `deleteTopic` | `~/.claude/projects/{hash}/memory/` |
| `cost-tracker.ts` | Parsa JSONL, calcola token e costi per modello | `calculateCostSummary`, `getProjectUsage`, `getSessionList` | `~/.claude/projects/{hash}/sessions/*.jsonl` |
| `session-reader.ts` | Parsa messaggi chat da JSONL | `readChatSession`, `findSessionFile` | `~/.claude/projects/{hash}/sessions/*.jsonl` |
| `claude-md-reader.ts` | Legge gerarchia CLAUDE.md | `readGlobalClaudeMd`, `readProjectClaudeMd`, `getClaudeMdHierarchy` | `~/.claude/CLAUDE.md`, `{realPath}/CLAUDE.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md` |
| `rules-reader.ts` | Legge regole condizionali | `readProjectRules` | `{realPath}/.claude/rules/**/*.md` |
| `skills-reader.ts` | Legge skill da directory | `getGlobalSkills`, `getProjectSkills`, `getAllSkills` | `~/.claude/skills/`, `{realPath}/.claude/skills/` |
| `skills-writer.ts` | Crea skill globale | `createGlobalSkill` | `~/.claude/skills/` |
| `agents-reader.ts` | Legge agent da directory | `getGlobalAgents`, `getProjectAgents` | `~/.claude/agents/`, `{realPath}/.claude/agents/` |
| `agents-writer.ts` | Crea agent globale | `createGlobalAgent` | `~/.claude/agents/` |
| `mcp-reader.ts` | Legge configurazione MCP | `getGlobalMcp` | `~/.claude.json`, `~/.claude/settings.json` |
| `process-scanner.ts` | Trova processi Claude attivi | `findClaudeProcesses` | syscall `ps` + `lsof` |
| `live-monitor.ts` | Watcher file JSONL con parsing eventi | `startLiveMonitor`, `stopLiveMonitor` | `~/.claude/projects/{hash}/sessions/*.jsonl` |

### Violazioni convenzione 50 righe (CLAUDE.md)

| Modulo | Funzione | Righe stimate | Severità |
|--------|---------|---------------|----------|
| `cost-tracker.ts` | `parseJsonlSession` | ~70 righe (110–178) | **warning** |
| `cost-tracker.ts` | `calculateCostSummary` | ~45 righe (211–255) | ok (limite) |
| `memory-reader.ts` | `readMemoryIndex` | ~90 righe (24–115) | **error** |
| `memory-reader.ts` | `readTopicFiles` | ~25 righe | ok |
| `claude-md-reader.ts` | `findAllClaudeMd` | ~30 righe | ok |
| `claude-md-reader.ts` | `getClaudeMdHierarchy` | ~40 righe | ok |
| `live-monitor.ts` | `parseJsonlLine` | ~80 righe (92–172) | **warning** |
| `skills-reader.ts` | `parseSkillMarkdown` | ~50 righe (34–79) | ok (limite) |
| `agents-reader.ts` | `parseAgentMarkdown` | ~45 righe (40–84) | ok (limite) |

**Funzioni che violano la convenzione (>50 righe):**
1. `readMemoryIndex` in `memory-reader.ts` — **90 righe**: ha due branch distinti (con/senza MEMORY.md) che potrebbero essere separati in `readFromMemoryMdFile` e `readFromDirectoryScan`.
2. `parseJsonlSession` in `cost-tracker.ts` — **~68 righe**: contiene la logica di parsing JSONL e il calcolo della sessione in un unico corpo.
3. `parseJsonlLine` in `live-monitor.ts` — **~80 righe**: gestisce 5 tipi di blocco diversi; candidata alla scomposizione in funzioni helper per tipo.

---

## 3. Renderer — Componenti React (`src/components/`)

### Mappa struttura cartelle

```
src/
├── App.tsx                              (44 righe) ✓
├── tabs/
│   ├── ProjectOverview.tsx              (300 righe) ✓ (post-refactor, <400)
│   └── LiveMonitor.tsx                  (624 righe) ⚠ GRANDE
├── hooks/
│   └── useIPC.ts                        (275 righe) ✓
├── types.ts                             (tipi globali)
└── components/
    ├── Markdown.tsx
    ├── ErrorBoundary.tsx
    └── project/
        ├── types.ts                     (View union + stili)
        ├── utils.ts                     (formatter puri)
        ├── shared/
        │   ├── Accordion.tsx
        │   ├── BackButton.tsx
        │   ├── DeleteProjectDialog.tsx
        │   ├── ModelChip.tsx
        │   ├── SectionTitle.tsx
        │   ├── SidebarNavItem.tsx
        │   └── StatChip.tsx
        ├── chat/
        │   ├── atoms.tsx
        │   ├── ChatView.tsx             (153 righe) ✓
        │   ├── MessageBubble.tsx
        │   ├── ToolDetailPanel.tsx
        │   ├── ToolGroupCard.tsx
        │   └── utils.ts
        ├── sessions/
        │   └── SessionsDetailView.tsx
        ├── memory/
        │   ├── MemoryFullView.tsx
        │   ├── MemoryIndexFile.tsx
        │   ├── MemorySection.tsx        (250 righe) ⚠ borderline
        │   ├── MemoryTopicView.tsx
        │   ├── TopicForm.tsx
        │   └── utils.ts
        ├── claudemd/
        │   └── GlobalClaudeMdView.tsx
        ├── skills/
        │   ├── CreateSkillModal.tsx
        │   ├── GlobalSkillsView.tsx
        │   ├── SkillDetailView.tsx
        │   └── SkillPropertiesPanel.tsx
        ├── agents/
        │   ├── AgentDetailView.tsx
        │   ├── AgentPropertiesPanel.tsx
        │   ├── CreateAgentModal.tsx
        │   └── GlobalAgentsView.tsx
        ├── mcp/
        │   ├── GlobalMcpView.tsx
        │   └── McpServerCard.tsx
        ├── analytics/
        │   └── AnalyticsView.tsx        (277 righe) ⚠ borderline
        ├── ai-assistant/
        │   └── AiAssistantView.tsx      (176 righe) ✓
        └── overview/
            ├── GlobalHomeView.tsx
            ├── NavCard.tsx
            └── ProjectOverviewContent.tsx
```

### Componenti > 200 righe (candidati a refactor)

| Componente | Righe stimate | Candidato refactor |
|------------|--------------|-------------------|
| `tabs/LiveMonitor.tsx` | **624** | **SI** — contiene 5+ sub-componenti inline (`ActivityChart`, `CustomTooltip`, `ProjectContextPanel`, `UsedItemRow`, `SectionLabel`), logica di stato complessa, e la view principale. Già funziona, ma è difficile da testare e modificare. |
| `AnalyticsView.tsx` | **277** | Borderline — `ChartCard` wrapper inline potrebbe essere estratto; il resto è logica di filtraggio/aggregazione + 4 grafici. Accettabile come file singolo. |
| `MemorySection.tsx` | **250** | Borderline — `renderTopicRow` come funzione interna è la candidata principale all'estrazione come componente `TopicRow`. |

### Verifica `ProjectOverview.tsx`

`tabs/ProjectOverview.tsx` è **300 righe** — ampiamente sotto il limite di 400 stabilito dal refactor. Il refactor è stato rispettato. La struttura sidebar + `renderMainView()` switch è chiara e manutenibile.

---

## 4. React Query Hooks (`src/hooks/useIPC.ts`)

### Query definite

| Hook | Query Key | Handler IPC | Enabled condition |
|------|-----------|-------------|-------------------|
| `useMemoryProjects` | `'memory:projects'` | `memory:listProjects` | sempre |
| `useMemoryProject` | `['memory:project', hash]` | `memory:getProject` | `hash !== null` |
| `useCostSummary` | `'cost:summary'` | `cost:getSummary` | sempre |
| `useClaudeMdHierarchy` | `['claudeMd:hierarchy', realPath]` | `claudeMd:getHierarchy` | `realPath !== null` |
| `useGlobalClaudeMd` | `'claudeMd:global'` | `claudeMd:getGlobal` | sempre |
| `useProjectRules` | `['rules:project', realPath]` | `rules:getByProject` | `realPath !== null` |
| `useSessionList` | `['sessions:project', hash]` | `sessions:listByProject` | `hash !== null` |
| `useProjectSessions` | `['cost:project', hash]` | `cost:getByProject` | `hash !== null` |
| `useChatSession` | `['sessions:chat', hash, filename]` | `sessions:getChat` | `filename !== null` |
| `useGlobalSkills` | `'skills:global'` | `skills:getGlobal` | sempre |
| `useAllSkills` | `['skills:all', realPath]` | `skills:getAll` | `realPath !== null` |
| `useGlobalAgents` | `'agents:global'` | `agents:getGlobal` | sempre |
| `useGlobalMcp` | `'mcp:global'` | `mcp:getGlobal` | sempre |
| `useProjectAgents` | `['agents:project', realPath]` | `agents:getByProject` | `realPath !== null` |

### Mutation definite

| Hook | Invalidation on success | Corretto? |
|------|------------------------|-----------|
| `useCreateTopic` | `['memory:project', hash]` | ✓ |
| `useUpdateTopic` | `['memory:project', hash]` | ✓ |
| `useDeleteTopic` | `['memory:project', hash]` | ✓ |
| `useCreateSkill` | `'skills:global'` | ✓ |
| `useCreateAgent` | `'agents:global'` | ✓ |
| `useDeleteProject` | `'memory:projects'` | **warning** — invalida solo `memory:projects`; non invalida `cost:summary` che potrebbe mostrare dati del progetto eliminato |

### Chiamate `window.electronAPI` non tipizzate

Tutte le chiamate nei componenti che bypassano i hook React Query:

| File | Chiamata diretta | Note |
|------|-----------------|------|
| `ChatView.tsx` (riga 59) | `window.electronAPI.sessions.openInTerminal(...)` | Accettabile: azione one-shot, non necessita caching |
| `AiAssistantView.tsx` | `window.electronAPI.ai.run/stop/onChunk/onDone/onError` | Accettabile: pattern streaming, non usa React Query |
| `LiveMonitor.tsx` | `window.electronAPI.live.getProcesses/startWatch/stopWatch/onEvent` | Accettabile: pattern streaming + polling |

Tutte queste chiamate dirette sono **tipizzate** nel `declare global interface Window` in `useIPC.ts` — nessuna chiamata non tipizzata trovata.

---

## 5. Allineamento IPC

### Confronto handler `main.ts` vs. chiamate `useIPC.ts`

| Handler in `main.ts` | Hook in `useIPC.ts` | Stato |
|---------------------|---------------------|-------|
| `memory:listProjects` | `useMemoryProjects` | ✓ |
| `memory:getProject` | `useMemoryProject` | ✓ |
| `memory:createTopic` | `useCreateTopic` | ✓ |
| `memory:updateTopic` | `useUpdateTopic` | ✓ |
| `memory:deleteTopic` | `useDeleteTopic` | ✓ |
| `cost:getSummary` | `useCostSummary` | ✓ |
| `cost:getByProject` | `useProjectSessions` | **warning** — nome hook (`useProjectSessions`) non allineato con il namespace IPC (`cost:*`). Potrebbe portare a confusione. |
| `claudeMd:getGlobal` | `useGlobalClaudeMd` | ✓ |
| `claudeMd:getProject` | nessun hook dedicato | **warning** — handler esposto ma non wrappato in un hook React Query |
| `claudeMd:getHierarchy` | `useClaudeMdHierarchy` | ✓ |
| `sessions:listByProject` | `useSessionList` | ✓ |
| `sessions:getChat` | `useChatSession` | ✓ |
| `sessions:openInTerminal` | diretta in `ChatView.tsx` | ok |
| `sessions:newInTerminal` | nessuna chiamata trovata | **warning** — handler esposto nel preload, tipizzato, ma non sembra usato nell'interfaccia |
| `rules:getByProject` | `useProjectRules` | ✓ |
| `skills:getGlobal` | `useGlobalSkills` | ✓ |
| `skills:getAll` | `useAllSkills` | ✓ |
| `skills:create` | `useCreateSkill` | ✓ |
| `agents:getGlobal` | `useGlobalAgents` | ✓ |
| `agents:getByProject` | `useProjectAgents` | ✓ |
| `agents:create` | `useCreateAgent` | ✓ |
| `projects:delete` | `useDeleteProject` | ✓ |
| `mcp:getGlobal` | `useGlobalMcp` | ✓ |
| `ai:run` | diretta in `AiAssistantView` | ok |
| `ai:stop` | diretta in `AiAssistantView` | ok |
| `live:getProcesses` | diretta in `LiveMonitor` | ok |
| `live:startWatch` | diretta in `LiveMonitor` | ok |
| `live:stopWatch` | diretta in `LiveMonitor` | ok |

---

## 6. Preload Bridge (`electron/preload.ts`)

### Metodi esposti via `contextBridge`

| Namespace | Metodi |
|-----------|--------|
| `memory` | `listProjects`, `getProject`, `createTopic`, `updateTopic`, `deleteTopic` |
| `cost` | `getSummary`, `getByProject` |
| `claudeMd` | `getGlobal`, `getProject`, `getHierarchy` |
| `sessions` | `listByProject`, `getChat`, `openInTerminal`, `newInTerminal` |
| `rules` | `getByProject` |
| `skills` | `getGlobal`, `getAll`, `create` |
| `agents` | `getGlobal`, `getByProject`, `create` |
| `mcp` | `getGlobal` |
| `projects` | `delete` |
| `ai` | `run`, `stop`, `onChunk`, `onDone`, `onError` |
| `live` | `getProcesses`, `startWatch`, `stopWatch`, `onEvent` |
| (root) | `onDataChanged` |

**Totale: 27 metodi esposti**

### Verifica coerenza con tipi in `useIPC.ts`

Tutti i metodi esposti nel preload hanno una corrispondente dichiarazione in `declare global interface Window { electronAPI: ... }` in `useIPC.ts`. La corrispondenza è **completa e corretta** — stessi nomi, stesso numero di parametri, stessa struttura `IpcResult<T>`.

**Osservazione:** il preload usa `input: object` invece dei tipi specifici (`TopicInput`, `SkillInput`, `AgentInput`) per le mutation. A runtime non causa problemi perché Electron serializza via IPC, ma riduce la type-safety nel layer preload stesso.

---

## 7. Problemi trovati — Riepilogo

### Errori (`error`)

| # | File | Problema | Impatto |
|---|------|---------|---------|
| E1 | `electron/modules/memory-reader.ts` | `readMemoryIndex` è ~90 righe (doppio del limite CLAUDE.md) con due branch non separati | Manutenibilità |
| E2 | `electron/main.ts` (`cost:getByProject` handler, riga 122) | Pricing hardcoded `3.0` e `15.0` nel handler IPC, invece di usare `calculateCost()` dal modulo `cost-tracker.ts` che ha la pricing table completa per modello | Bug silenzioso: tutti i progetti calcolati al prezzo di Sonnet, ignorando Haiku e Opus |

### Warning (`warning`)

| # | File | Problema | Impatto |
|---|------|---------|---------|
| W1 | `tabs/LiveMonitor.tsx` | 624 righe, 5+ componenti inline | Manutenibilità, difficoltà testing |
| W2 | `electron/modules/live-monitor.ts` | `parseJsonlLine` ~80 righe | Violazione convenzione |
| W3 | `electron/modules/cost-tracker.ts` | `parseJsonlSession` ~68 righe | Violazione convenzione |
| W4 | `hooks/useIPC.ts` | Hook `useProjectSessions` chiama `cost:getByProject` — nome disallineato rispetto al namespace IPC | Confusione sviluppatori |
| W5 | `electron/preload.ts` | `input: object` invece di tipi specifici per le mutation | Type-safety ridotta nel layer preload |
| W6 | `hooks/useIPC.ts` (`useDeleteProject`) | On success invalida solo `'memory:projects'`, non `'cost:summary'` | Cache stale post-eliminazione progetto |
| W7 | `electron/main.ts` | `sessions:newInTerminal` esposto e tipizzato ma non viene chiamato nella UI (nessun punto di navigazione trovato) | Dead code |
| W8 | `tabs/ProjectOverview.tsx` | `memory-topic` view — `onBack` torna sempre a `overview`, anche se il topic era stato aperto dal contesto globale | UX bug: back porta all'overview di progetto anche da contesti globali |
| W9 | `electron/modules/memory-reader.ts` | `listProjectsWithMemory` restituisce **tutti** i progetti in `~/.claude/projects/`, non solo quelli con una cartella `memory/` (il nome della funzione è fuorviante) | Il nome implica un filtro che non esiste |

---

## 8. Suggerimenti per i problemi più critici

### E2 — Pricing duplicato in `cost:getByProject` (CRITICO)

`main.ts` riga 122 calcola il costo con valori hardcoded:
```ts
cost: (usage.inputTokens / 1_000_000) * 3.0 + (usage.outputTokens / 1_000_000) * 15.0,
```
Mentre `cost-tracker.ts` ha `getProjectUsage()` che **non** calcola il costo, e il costo per sessione è in `getSessionList()`. La soluzione è aggiungere il calcolo costo aggregato a `getProjectUsage()` usando `calculateCost()` con il modello dominante, oppure derivare il costo da `getSessionList()` nella risposta IPC.

### W1 — `LiveMonitor.tsx` (624 righe)

Estrarre in file separati:
- `ActivityChart.tsx` (righe 1–117) — componente chart autonomo
- `ProjectContextPanel.tsx` (righe 135–211) — pannello destra
- `LiveMonitor.tsx` ridotto a ~200 righe di logica orchestrazione

### W6 — `useDeleteProject` cache stale

Aggiungere a `onSuccess`:
```ts
qc.invalidateQueries('cost:summary')
```

### W8 — Back navigation da `memory-topic`

Il `memory-topic` case non porta info sul contesto di provenienza. Aggiungere al tipo `View`:
```ts
| { type: 'memory-topic'; topic: MemoryTopic; content: string; from: 'overview' | 'global' }
```
e usare `view.from` nella funzione `onBack`.

### W9 — Nome fuorviante `listProjectsWithMemory`

Rinominare in `listProjects` o aggiungere un effettivo filtro su directory `memory/` — dipende dal comportamento desiderato.

---

## 9. Struttura generale — Valutazione

| Aspetto | Giudizio |
|---------|---------|
| Separazione main/renderer | **Ottima** — nessuna dipendenza diretta, tutto mediato da IPC |
| Coerenza IPC (28 handler, 27 metodi preload, 14 hook + chiamate dirette) | **Buona** — quasi tutto allineato, 2 handler orfani minori |
| Convenzione `IpcResult<T>` + `unwrap()` | **Eccellente** — applicata uniformemente |
| React Query (cache, invalidazione) | **Buona** — 5 mutation con invalidazione corretta, 1 con cache stale |
| Dimensione componenti | **Buona** — solo `LiveMonitor.tsx` supera 400 righe |
| `ProjectOverview.tsx` post-refactor | **Ottimo** — 300 righe, ben dentro la soglia |
| Tipi TypeScript | **Ottimi** — `View` discriminated union, nessuna chiamata non tipizzata |
| Funzioni backend | **Accettabile** — 3 funzioni violano la convenzione 50 righe |
