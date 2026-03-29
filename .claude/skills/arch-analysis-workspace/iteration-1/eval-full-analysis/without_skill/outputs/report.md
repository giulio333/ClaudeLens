# Analisi Architetturale — ClaudeLens

## Panoramica

ClaudeLens è un'applicazione Electron che funge da GUI per Claude Code. Legge i dati locali di Claude Code da `~/.claude/` e li presenta in un'interfaccia React. Il codice attivo risiede interamente in `claudelens-app/`.

---

## Struttura del progetto

```
claudelens-app/
├── electron/               # Main process (Node.js/Electron)
│   ├── main.ts             # Entry point, IPC handlers, file watcher
│   ├── preload.ts          # Bridge sicuro tra main e renderer
│   ├── utils.ts            # hashToPath / pathToHash
│   └── modules/            # Moduli backend puri
│       ├── memory-reader.ts
│       ├── memory-writer.ts
│       ├── cost-tracker.ts
│       ├── session-reader.ts
│       ├── live-monitor.ts
│       ├── claude-md-reader.ts
│       ├── rules-reader.ts
│       ├── skills-reader.ts
│       ├── skills-writer.ts
│       ├── agents-reader.ts
│       ├── agents-writer.ts
│       ├── mcp-reader.ts
│       └── process-scanner.ts
└── src/                    # Renderer process (React SPA)
    ├── App.tsx
    ├── main.tsx
    ├── types.ts             # Tipi condivisi (lato renderer)
    ├── hooks/
    │   └── useIPC.ts        # Tutti i React Query hooks + tipi Window
    ├── tabs/
    │   ├── ProjectOverview.tsx   # Shell di navigazione principale
    │   └── LiveMonitor.tsx       # Vista live monitor (624 righe)
    └── components/
        ├── ErrorBoundary.tsx
        ├── Markdown.tsx
        └── project/
            ├── types.ts          # View union type + design tokens
            ├── utils.ts          # Formatter puri
            ├── shared/           # Atomi UI riutilizzabili
            ├── chat/             # ChatView, MessageBubble, ToolDetailPanel, utils
            ├── sessions/         # SessionsDetailView
            ├── memory/           # MemorySection, MemoryTopicView, TopicForm, ecc.
            ├── claudemd/         # GlobalClaudeMdView
            ├── skills/           # GlobalSkillsView, SkillDetailView, CreateSkillModal
            ├── agents/           # GlobalAgentsView, AgentDetailView, CreateAgentModal
            ├── mcp/              # GlobalMcpView, McpServerCard
            ├── analytics/        # AnalyticsView (recharts)
            ├── ai-assistant/     # AiAssistantView
            └── overview/         # ProjectOverviewContent, GlobalHomeView, NavCard
```

---

## Flusso architetturale

### 1. Layer Main Process (`electron/main.ts`)

- Registra tutti gli IPC handler con namespace: `memory:*`, `cost:*`, `claudeMd:*`, `sessions:*`, `rules:*`, `skills:*`, `agents:*`, `mcp:*`, `ai:*`, `live:*`, `projects:*`
- Avvia un file watcher con chokidar su `~/.claude/projects/` (depth 3); emette `data:changed` al renderer ad ogni modifica
- Gestisce il processo AI (spawn del CLI `claude`) con streaming output via `ai:chunk`, `ai:error`, `ai:done`
- Gestisce apertura di Terminal per le sessioni Claude via AppleScript (`osascript`)
- Serializza `Map` → `Object.fromEntries` prima dell'IPC (i Map non sono trasferibili via IPC)

### 2. Layer Preload (`electron/preload.ts`)

- Espone `window.electronAPI` via `contextBridge` con context isolation abilitata
- Raggruppa le API per namespace: `memory`, `cost`, `claudeMd`, `sessions`, `rules`, `skills`, `agents`, `mcp`, `ai`, `live`, `projects`
- `onDataChanged(callback)` permette al renderer di sottoscriversi agli eventi del watcher

### 3. Layer Moduli Backend (`electron/modules/`)

Funzioni pure (eccetto `memory-writer.ts` e `live-monitor.ts` che hanno stato globale):

| Modulo | Responsabilità |
|---|---|
| `memory-reader.ts` | Legge MEMORY.md e file topic `.md`; inferisce tipo da prefisso filename |
| `memory-writer.ts` | CRUD topic file + sincronizzazione MEMORY.md |
| `cost-tracker.ts` | Parsing JSONL, pricing table per modello, calcolo costi |
| `session-reader.ts` | Parsing chat JSONL; normalizza content (string o block array) |
| `live-monitor.ts` | Chokidar su singolo file JSONL; tail-like con offset per eventi nuovi |
| `claude-md-reader.ts` | Gerarchia CLAUDE.md: global → project → local → subdir |
| `rules-reader.ts` | Regole condizionali da `.claude/rules/**/*.md` con frontmatter YAML |
| `skills-reader.ts` | Parsing SKILL.md con frontmatter custom (YAML subset manuale) |
| `skills-writer.ts` | Creazione nuove skill globali |
| `agents-reader.ts` | Parsing agent `.md` con frontmatter |
| `agents-writer.ts` | Creazione nuovi agent globali |
| `mcp-reader.ts` | Lettura configurazione MCP da `~/.claude/settings.json` |
| `process-scanner.ts` | Ricerca processi Claude attivi via `ps` + `lsof` |

### 4. Layer Renderer (`src/`)

- **`App.tsx`**: Root minimale; chiama `useDataChangedRefetch()` per invalidare tutte le query quando il watcher scatta
- **`ProjectOverview.tsx`** (~300 righe): Shell di navigazione; gestisce stato `View` come discriminated union con `useState`; switch/case → delega ai componenti feature
- **`useIPC.ts`**: Tutti i React Query hooks; dichiara il tipo globale `window.electronAPI`; helper `unwrap()` che lancia su errore
- **`types.ts`**: Definizioni dei tipi condivisi nel renderer (duplicati rispetto ai moduli backend — intenzionale per disaccoppiamento IPC)

---

## Identity del progetto

Il mapping tra path reale e directory `~/.claude/projects/` usa una conversione semplice:
- `pathToHash`: sostituisce ogni `/` con `-` (es. `/Users/foo/bar` → `-Users-foo-bar`)
- `hashToPath`: rimuove il `-` iniziale e sostituisce i restanti con `/`

**Problema latente**: questo schema è ambiguo per path contenenti `-`. Un path come `/Users/foo-bar/baz` produce lo stesso hash di `/Users/foo/bar-baz`. In pratica raramente si manifesta, ma è un bug di design.

---

## Problemi rilevati

### Critici

**1. Injection di comandi nella shell (`ai:run` in `main.ts`)**

```typescript
const escapedInstruction = instruction.replace(/'/g, "'\\''");
const cmd = `claude -p '${escapedInstruction}' --model Haiku ...`;
const proc = spawn(cmd, [], { shell: true, ... });
```

L'escape con `'\\''` è il pattern standard per single-quote in sh, ma l'input `instruction` proviene dal renderer via IPC senza ulteriore sanitizzazione. Qualsiasi stringa che l'utente inserisce nell'AI Assistant viene costruita come stringa di shell ed eseguita con `shell: true`. Sebbene il renderer sia un contesto trusted (nessuna navigazione a URL esterni), questo pattern rende difficile il ragionamento sulla sicurezza e dovrebbe usare `spawn(cmd, args, { shell: false })` con argomenti separati.

**2. Hardcoded Sonnet pricing per `cost:getByProject`**

Nel handler IPC `cost:getByProject` in `main.ts` (righe 122-125) il costo viene calcolato con prezzi fissi Sonnet 3.0/15.0 anziché chiamare `calculateCost()` del modulo `cost-tracker.ts`:

```typescript
cost: (usage.inputTokens / 1_000_000) * 3.0 + (usage.outputTokens / 1_000_000) * 15.0,
```

Mentre `getSessionList()` (usato da `cost:getSummary`) usa la pricing table completa con supporto multi-modello. Questo porta a costi incoerenti tra la vista summary globale e quella per singolo progetto, specialmente per progetti che usano Haiku o Opus.

**3. Stato globale mutable nel live monitor**

`live-monitor.ts` usa una variabile di modulo `let state: MonitorState | null = null`. Questo funziona per una singola finestra, ma se l'app aprisse più finestre o se `startLiveMonitor` venisse chiamato da sender diversi, il callback `onEvent` manterrebbe solo il sender dell'ultima chiamata. Attualmente non è un bug pratico (una sola finestra), ma è fragile.

**4. Stessa situazione per il processo AI**

Anche `currentAiProcess` in `main.ts` è una variabile di modulo. Due finestre (o due chiamate rapide) potrebbero interferire. La `kill()` al secondo `ai:run` uccide il processo precedente senza notificare il primo sender.

### Moderati

**5. `useDataChangedRefetch` registra listener multipli**

```typescript
useEffect(() => {
  window.electronAPI.onDataChanged(() => {
    qc.invalidateQueries()
  })
}, [qc])
```

`onDataChanged` in `preload.ts` chiama `ipcRenderer.on('data:changed', ...)` senza fare `removeListener`. Ad ogni re-render con nuovo `qc` (improbabile ma possibile) si accumula un nuovo listener. Sarebbe più corretto usare `ipcRenderer.removeAllListeners` prima di registrare, oppure restituire una funzione di cleanup dall'`useEffect`.

**6. Duplicazione dei tipi tra backend e renderer**

I tipi `MemoryTopic`, `MemoryData`, `SessionSummary`, `ChatMessage`, ecc. sono definiti sia in `electron/modules/*.ts` che in `src/types.ts`. La sincronizzazione è manuale. Un approccio più robusto sarebbe avere un file di tipi condivisi in una cartella `shared/` importabile da entrambi i lati (possibile con la configurazione tsconfig corretta).

**7. Parsing YAML frontmatter manuale in `skills-reader.ts`**

Il modulo usa regex custom per parsare il frontmatter YAML invece di usare la libreria `js-yaml` già presente come dipendenza. Non supporta valori multi-riga, array complessi o quoting YAML standard. Per i casi d'uso correnti funziona, ma potrebbe rompere su skill con frontmatter più complessi.

**8. `listProjectsWithMemory` non filtra solo progetti con memoria**

Il nome suggerisce che ritorni solo progetti con memoria, ma l'implementazione lista tutte le directory in `~/.claude/projects/` senza verificare l'esistenza della sottocartella `memory/`:

```typescript
export async function listProjectsWithMemory(claudeDir: string): Promise<string[]> {
  const projectDirs = await glob('*', { cwd: claudeDir, absolute: false });
  return projectDirs.sort();
}
```

Questo include anche i progetti senza memoria nella sidebar, il che può essere intenzionale ma il nome della funzione è fuorviante.

### Minori

**9. `LiveMonitor.tsx` è troppo grande (624 righe)**

Il file contiene: chart di attività, lista eventi, stato processi, logica di timing, e UI completa. Potrebbe essere scomposto in componenti più piccoli per migliorare la leggibilità. Stessa osservazione per `ToolDetailPanel.tsx` (325 righe) che gestisce il rendering specifico per ~10 tipi di tool diversi.

**10. `hashToPath` è ambiguo per path con trattini**

Come descritto nella sezione Identity: path come `/my-project/sub` e `/my/project-sub` producono hash identici. Claude Code stesso usa questo schema, quindi ClaudeLens lo eredita correttamente, ma vale la pena documentarlo esplicitamente.

**11. Nessun test automatizzato**

Il progetto è completamente privo di test. Per i moduli di parsing (JSONL, YAML frontmatter, memory index) esisterebbe valore concreto nell'avere unit test, specialmente per `cost-tracker.ts` dove gli errori di calcolo hanno impatto diretto sulla visibilità dei costi.

**12. Versioni dipendenze datate**

- `electron: ^31.0.2` — la versione corrente è 36.x (lug 2026). Mancano diversi cicli di sicurezza.
- `react-query: ^3.39.3` — la versione v4 (TanStack Query) è stata rilasciata da tempo con API migliorate.

---

## Punti di forza architetturali

1. **Separazione chiara main/renderer**: I moduli backend non importano mai nulla da React; il renderer non accede mai direttamente al filesystem. La frontiera IPC è ben definita.

2. **IPC result shape uniforme**: Ogni handler ritorna `{ data: T | null, error: string | null }`. L'`unwrap()` nel renderer centralizza la gestione degli errori.

3. **React Query per la cache**: Tutte le letture passano per React Query. L'invalidazione globale su `data:changed` garantisce consistenza senza gestione manuale dello stato.

4. **Navigazione come discriminated union**: Il tipo `View` con pattern matching exhaustive (switch/case) è type-safe e rende facile aggiungere nuove viste senza dimenticare i casi.

5. **Refactor completato di ProjectOverview**: Da 4.328 righe a ~340. La struttura a componenti per dominio (`chat/`, `memory/`, `sessions/`, ecc.) è ben organizzata.

6. **Live monitor con tail-like offset**: L'approccio di tracciare `fileOffset` per leggere solo i byte nuovi è efficiente e corretto per file JSONL in append.

---

## Dipendenze chiave

| Dipendenza | Versione | Ruolo |
|---|---|---|
| electron | ^31.0.2 | Runtime desktop |
| react | ^18.3.1 | UI framework |
| react-query | ^3.39.3 | Stato server/cache |
| chokidar | ^3.6.0 | File watching |
| recharts | ^3.8.0 | Grafici analytics |
| react-markdown | ^9.0.1 | Rendering markdown |
| js-yaml | ^4.1.0 | Parsing YAML (usato solo in rules-reader) |
| tailwindcss | ^3.4.4 | Styling |

---

## Riepilogo

ClaudeLens ha un'architettura solida e ben organizzata per un progetto di questa dimensione. Il pattern Electron con IPC namespaced, React Query per la cache e navigazione tramite discriminated union funziona bene. I problemi principali da affrontare in ordine di priorità sono: (1) il calcolo del costo hardcoded in `cost:getByProject` che produce dati errati, (2) la sicurezza del comando shell in `ai:run`, e (3) la duplicazione manuale dei tipi tra backend e renderer che richiede sincronizzazione continua.
