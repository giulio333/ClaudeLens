# components/project/ — Feature components di ClaudeLens

Tutti i componenti UI del progetto ClaudeLens, organizzati per dominio funzionale. Sono consumati da `tabs/ProjectOverview.tsx`, che funge da shell di navigazione.

## Fondamenta

### `types.ts`
- `View` — discriminated union con tutti i tipi di vista navigabili (~27 casi)
- `TYPE_STYLES` — classi Tailwind per i badge dei topic di memoria (`user`, `feedback`, `project`, `reference`)
- `SCOPE_STYLES` — classi Tailwind per i badge di scope CLAUDE.md (`global`, `project`, `local`, `subdir`)

> Quando si aggiunge una nuova vista, aggiungere prima il caso qui, poi il `case` nello switch di `ProjectOverview.tsx`.

### `utils.ts`
Formatter puri (nessuna dipendenza React):
- `fmt(n)` — numero con separatori migliaia
- `fmtCost(n)` — costo in dollari (`$0.0042`)
- `fmtDate(d)` — data localizzata `it-IT`
- `fmtModel(m)` — ID modello → nome leggibile (`claude-sonnet-4-6` → `Sonnet 4.6`)
- `modelColor(m)` — colore hex accent per famiglia modello

---

## Struttura per dominio

### `shared/` — Atomi UI riutilizzabili
| File | Esporta | Descrizione |
|---|---|---|
| `BackButton.tsx` | `BackButton` | Bottone freccia indietro con label |
| `StatChip.tsx` | `StatChip` | Chip label + valore, variante accent indigo |
| `TopBar.tsx` | `TopBar`, `Crumb` | Top bar editoriale condivisa (52px, drag region, back + breadcrumbs + right slot) |
| `EntityDetailView.tsx` | `EntityDetailView`, `EntityConfig`, `TapeCell` | **Vista detail unificata config-driven** (look "manifesto" stile agent): toggle View/Edit + Save/Discard/Delete/Duplicate/Run nella TopBar, tape/properties grid in view, frontmatter+body editabili. Usata da Agent, Skill, CLAUDE.md, Plan. Edit mono-colonna (`is-single-col`) per le entità senza frontmatter (CLAUDE.md); read-only per Plan |
| `entityOptions.ts` | `OptionDef`, `OptionValue`, `OptionEditor`-data, `AGENT_OPTION_DEFS`, `SKILL_OPTION_DEFS`, `serializeAgent`, `serializeSkill`, `readOptions`, `entityTint`, `initialOf`, `fluidTitleSize`, helper | Logica condivisa per `EntityDetailView`: option defs per agent/skill, serializzazione frontmatter YAML **con preservazione delle chiavi non modellate** (es. `hooks`), tint identità |
| `MarkdownDocView.tsx` | `MarkdownDocView` | Shell markdown semplice (toggle View/Edit nell'hero). Usata **solo da `memory/MemoryTopicView`** |
| `CreateFormKit.tsx` | `ModelPicker`, `ToolsInput`, `FieldHint`, `CharCounter`, `openDocs`, `validateName`, `useCreateFormKeys`, `MODEL_PRESETS`, `KNOWN_TOOLS`, `NAME_MAX`, `DESC_MAX`, `NAME_RE` | Building blocks condivisi per le pagine "create" (skill, agent): picker modello accent-aware, autocomplete tools, hint, counter, validazione nome, hook keybinding (⌘↵/Esc) |
| `DeleteSessionDialog.tsx` | `DeleteSessionDialog` | Dialog di conferma per cancellare una sessione + artefatti. Carica l'inventario via `useSessionArtifacts` (IPC `sessions:getArtifacts`) e mostra una checklist: transcript `.jsonl` (locked, sempre incluso), sub-agenti e task (default ON), piani globali condivisi (default OFF, con "referenced by N sessions"); `title` su ogni riga = path completo in hover. Conferma → `useDeleteSession`. Usato da `chat/ChatView` (TopBar) e da `overview/ProjectOverviewContent` (riga sessione) |

---

### `chat/` — Rendering sessioni chat
| File | Esporta | Descrizione |
|---|---|---|
| `utils.ts` | `buildProcessedMessages`, `correlateSessionAgents`, `resolveToolIcon`, `stripLineNumbers`, `fileExt`, `parseMemoryFrontmatter`, tipi `ToolGroup`, `ProcessedMessage`, `SessionAgent`, `ChatDetailsFilter` | Pre-processing messaggi raw: abbina `tool_use` + `tool_result` per ID; rimuove messaggi utente con soli tool_result; `correlateSessionAgents` collega ogni dispatch `Task`/`Agent` al suo transcript subagent per prefisso-prompt |
| `atoms.tsx` | `PathChip`, `SectionLabel`, `CodeBlock` | UI atoms per il rendering degli input/output tool |
| `fileIcons.tsx` | `FileIcon` | Logo file reali (devicon-plain monocromatici via `unplugin-icons`, `~icons/devicon-plain/*`): estensione → logo linguaggio (tsx/jsx→ts/js, scss→css3, ecc.), fallback a glifo documento generico. `currentColor` → seguono tema + tinta categoria. Usato dai chip file in `MessageBubble` (footer turno minimal) |
| `ToolDetailPanel.tsx` | `ToolDetailPanel` | Pannello fullscreen dettaglio tool: rendering specifico per Read, Write, Edit, Bash, Grep, Glob, Agent, operazioni memoria |
| `ToolGroupCard.tsx` | `ToolGroupCard` | Card compatta che mostra una coppia `tool_use` + `tool_result` |
| `MessageBubble.tsx` | `ThinkingBlock`, `MessageBubble` | Singolo messaggio con testo, thinking espandibile, tool cards |
| `SubagentTranscriptPanel.tsx` | `SubagentTranscriptPanel` | Overlay col transcript interno completo di un sub-agente (`useSubagentTranscript`), reso con la stessa pipeline `buildProcessedMessages`+`MessageBubble`; ToolDetailPanel annidato per i tool interni |
| `ChatComposer.tsx` | `ChatComposer` | Barra in basso al layout Focus. **Due modalità** in base a `sessionId`: presente → **continua una sessione esistente** (`sessions:sendMessage`); assente → **avvia una nuova sessione** (`sessions:startMessage`, il nuovo id arriva su `onChatStarted` e viene propagato via prop `onStarted`). Entrambe girano sull'**Agent SDK** (`modules/chat-runner.ts`), non più su `claude -p`: nuovi turni nello **stesso `.jsonl`** (interscambiabile col terminale) e **approvazioni tool interattive**. Due **selettori** nella meta-row (`ComposerSelect`, popover verso l'alto): **Model** (id ereditato in cima + alias Sonnet/Opus/Haiku + Default) e **Permission** (`default`/`acceptEdits`/`plan`/`bypassPermissions`, con `bypassPermissions` marcato in rosso via flag `danger`); entrambi passano a `model`/`permissionMode`. Le **etichette + hint** riflettono i prompt reali in-app: `default`→"Ask in app" (ogni azione chiede conferma), `acceptEdits`→"Accept edits" (auto-approva gli edit, gli altri tool chiedono), `plan`→"Plan only", `bypassPermissions`→"Bypass all". Quando l'SDK chiede un tool non auto-approvato, `onPermissionRequest` popola `permReq` e si monta il **`PermissionRequestDialog`** (Allow/Always/Deny → `respondPermission`). **Autocomplete slash command**: quando il draft è un singolo token che inizia con `/` (nome comando ancora in digitazione, prima di spazi/argomenti) si apre un popover sopra l'input (`cl-slash-menu`) coi comandi disponibili filtrati per prefisso. La lista viene da `useEffectiveConfig(realPath).init.slashCommands` (cached); nav da tastiera (↑/↓, Enter/Tab per selezionare, Esc per chiudere, mouse per hover/click via `mousedown`+preventDefault per non perdere il focus). La selezione inserisce `/<cmd> ` nel draft. L'invio è **nativo**: l'Agent SDK esegue un `/comando` passato nel prompt (nessun dispatch dedicato); l'output dei comandi senza turno modello — `/compact`, `/context`, `/usage` — è reso da `chat-runner` come nota assistant. Solo `bypassPermissions` resta in `CONFIRM_MODES` (mostra `SendConfirmDialog` pre-invio, consenso ricordato in `confirmedMode`); le altre modalità inviano subito perché i tool chiedono comunque. Lo stream live è sollevato al parent su due assi: `onStreamChange` (delta di testo da `sessions:chatChunk`, per il `LiveTurn`) e `onLiveMessagesChange` (messaggi completi da `sessions:chatMessage`, accumulati in `liveMessages`; all'arrivo di un assistant message completo azzera lo `stream` così il testo parziale non si duplica). Reset di `liveMessages` a ogni invio. Al `chatDone` rifà `refetch()` e azzera `permReq`. Enter invia, Shift+Enter newline; Stop → `sessions:stopMessage` (annulla e nega i permessi pendenti). In `ChatView` è montato con `key={sessionId}` per ri-seedare lo state del picker al cambio sessione. La pill flottante si alza (`[data-composer]`) per far posto |
| `PermissionRequestDialog.tsx` | `PermissionRequestDialog` | Dialog overlay (stile `SendConfirmDialog`) mostrato quando l'Agent SDK chiede l'approvazione di un tool via `canUseTool`. Mostra `toolName`, `title`/`displayName`, `description`, e il dettaglio rilevante dell'input (`command` per Bash, `file_path`/`path`, altrimenti JSON). Tre azioni: **Allow once** (`{ kind: 'allow' }`), **Always allow** (`{ kind: 'always', suggestions }`, solo se l'SDK fornisce `suggestions`) e **Deny…** (apre un textarea opzionale per il messaggio che Claude vedrà → `{ kind: 'deny', message }`). La decisione torna al main via `respondPermission(requestId, …)` |
| `NewChatView.tsx` | `NewChatView` | Vista **nuova chat** (`View` case `new-chat`): layout Focus vuoto con `ChatComposer` in modalità new (niente `sessionId`). Durante il primo turno il transcript è costruito **interamente dallo stream SDK**: un messaggio utente sintetico (eco ottimistica del prompt) + i `liveMessages` ricevuti via `onLiveMessagesChange`, passati per la stessa `buildProcessedMessages`+`MessageBubble` di una sessione reale, con un `LiveTurn` finale per il testo assistant ancora in streaming. `detailsFilter="minimal"` (niente toggle Min/Full in new chat): mostra prompt + testo assistant ma **non** le card raw dei tool (Bash/Read/…), coerente col default di `ChatView`. Al primo invio l'SDK conia un nuovo session id (pre-generato nel main e ricevuto subito via `onStarted`, niente race); al `chatDone` costruisce un `SessionSummary` minimale (`{id}.jsonl`, campi token/costo a zero, `firstUserMessage` dal testo inviato per il titolo) e lo passa a `onCreated` → naviga alla `chat` reale (il transcript è caricato da disco da `useChatSession`, il watcher rinfresca i metadati). Ingressi: bottone "New chat" nell'hero e nell'header sezione Sessions di `ProjectOverviewContent` |
| `ChatView.tsx` | `ChatView` | Vista completa chat — layout **"Focus"** (`cl-chat-workspace--focus`): solo `TopBar` (back + titolo + toggle Chat/Timeline) sopra una **colonna di lettura centrata** (`cl-chat-reading`, ~768px), niente hero/stat strip. I controlli del transcript vivono in una **pill flottante glass** in basso al centro (`ChatControlPill` → `cl-pill`): filtri per tipo (All/Tools/Thinking/Questions/Plan) + toggle densità Min/Full (chat mode) + **agent dock** (cluster di avatar + conteggio quando ci sono sub-agenti, `cl-pill-dock`) + Resume + trigger `↑` (`cl-pill-more`). La pill alza **un solo sheet alla volta** sopra di sé (`sheet: 'agents' | 'export' | null`): l'**agents sheet** (`AgentDockSheet` → `cl-sheet--agents`, lista sub-agenti correlati con click → transcript e bottone locate → scroll alla dispatch card) o lo **sheet Export/Delete** (`cl-sheet`). Il transcript resta a **tutta larghezza** (niente rail laterale). A destra una **minimap a filo** (`FocusMinimap` → `cl-focus-rail`): un dot proporzionale per turno-messaggio, label in hover, scroll-spy. Overlay `ToolDetailPanel` / `SubagentTranscriptPanel`. **Turno live (no doppione):** mentre un turno è in volo (`pendingUser !== null`) il transcript renderizzato (`displayMessages`) è assemblato dallo **stream SDK**, non da una riletta del `.jsonl` a metà turno: snapshot pre-turno (`frozenMessages`) + messaggio utente sintetico + `liveMessages` (da `onLiveMessagesChange`), passati per la stessa `buildProcessedMessages`; un `LiveTurn` finale mostra il testo assistant parziale (`onStreamChange`). Il file watcher continua a rifare il refetch in background, ma viene ignorato per il display finché il turno non chiude — così la risposta persistita non raddoppia quella live (bug storico). A fine turno (`!streaming` + il refetch contiene già il turno: `messages.length > pendingBaseCount`) si **riconcilia** sul read canonico da disco, azzerando `pendingUser`/`frozenMessages`/`liveMessages`. **Slash command informativi (`/context`, `/usage`, `/compact`…):** il loro output reale è uno stream `<synthetic>` che Claude Code **non persiste** (su disco resta solo il placeholder, filtrato da `session-reader`). Per non perderlo alla riconciliazione, `handleLiveMessages` lo **appunta** (`pinnedSlash`, state, deduplicato per uuid, keyed sul nome comando estratto dal prompt inviato via `slashCommandOf`) e `displayMessages` lo **reinserisce** in `displayMessages` subito dopo la sua command-card (`cardCommandOf`, consumo in ordine per chiamate ripetute). Vive solo finché la vista è montata (il dato non è su disco da ricaricare) |

**Props navigation pattern:**
```tsx
<ChatView
  project={{ hash, realPath }}
  session={session}
  onBack={() => onNavigate({ type: 'sessions', project })}
/>
```

---

### `memory/` — Gestione memoria Claude
| File | Esporta | Descrizione |
|---|---|---|
| `utils.ts` | `extractHeadings`, `parseMemoryContent`, `readingTime`, `formatDate`, `SidebarLabel`, `SidebarRow` | Parser markdown per TOC + metadata topic; helper UI sidebar |
| `MemoryTopicView.tsx` | `MemoryTopicView` | Vista singolo topic: tab View/Raw, sidebar metadata, TOC |

> La lista dei topic della vista `project-memory` è renderizzata da `ProjectView` (`overview/ProjectOverviewContent.tsx`, `section === 'memory'`) con `cl-tile-grid`/`cl-tile`, allineata a Skills/Agents.

---

### `claudemd/`
| File | Esporta | Descrizione |
|---|---|---|
| `GlobalClaudeMdView.tsx` | `GlobalClaudeMdView`, `ProjectClaudeMdView` | Wrapper detail per CLAUDE.md (global e per-layer) via `EntityDetailView`: edit mono-colonna (nessun frontmatter) + delete (`claudeMd:deleteGlobal`/`deleteFile`) |

---

### `skills/`
| File | Esporta | Descrizione |
|---|---|---|
| `SkillDetailView.tsx` | `SkillDetailView` | Wrapper che costruisce la `EntityConfig` skill (opzioni frontmatter editabili strutturate, `serializeSkill`) e delega a `EntityDetailView`. Supporta edit + delete (rimuove la cartella `skills/<name>/` se vuota) |
| `CreateSkillPage.tsx` | `CreateSkillPage` | Pagina dedicata per creare una nuova skill (globale o di progetto); on save torna alla lista |
| `GlobalSkillsView.tsx` | `GlobalSkillsView` | Lista skill globali con ricerca e navigazione al detail |

---

### `agents/`
| File | Esporta | Descrizione |
|---|---|---|
| `AgentDetailView.tsx` | `AgentDetailView` | Wrapper che costruisce la `EntityConfig` agent (`AGENT_OPTION_DEFS`, `serializeAgent`, tape Scope/Model/Color/Status, validation) e delega a `EntityDetailView`. Supporta edit + delete + Run agent |
| `RunAgentDialog.tsx` | `RunAgentDialog` | Dialog di dispatch background agent (overlay passato a `EntityDetailView` via `renderRunOverlay`) |
| `CreateAgentPage.tsx` | `CreateAgentPage` | Pagina dedicata per creare un nuovo agent (globale o di progetto); on save torna alla lista |
| `GlobalAgentsView.tsx` | `GlobalAgentsView` | Lista agent globali |

---

### `mcp/`
| File | Esporta | Descrizione |
|---|---|---|
| `McpServerCard.tsx` | `McpServerCard`, `mcpServiceColor`, `mcpServiceMeta` | Card singolo MCP server (click → `mcp-detail`); colori brand + registry curato categoria/descrizione per servizi noti |
| `GlobalMcpView.tsx` | `GlobalMcpView` | Vista lista MCP server (cloud + local); `onSelectServer` apre il dettaglio |
| `McpServerDetailView.tsx` | `McpServerDetailView` | Pagina dettaglio singolo server: hero brand, metriche adoption, config locale, liste progetti enabled/disabled |

---

### `agents-live/`
| File | Esporta | Descrizione |
|---|---|---|
| `AgentsLiveView.tsx` | `AgentsLiveView` | Vista dei background/live agent: legge le sessioni agent in corso (`bg-sessions-reader` + `live:*`/`agents:*` IPC), con dispatch/stop/respawn. Click su una sessione → `chat` (con `from: 'agents-live'`) |

---

### `sessions/`
| File | Esporta | Descrizione |
|---|---|---|
| `TagBar.tsx` | `TagBar` | Barra dei tag di una sessione (lista + add) |
| `TagChip.tsx` | `TagChip` | Chip singolo tag (colore + remove) |
| `TagPicker.tsx` | `TagPicker` | Picker per assegnare/creare tag a una sessione |

---

### `analytics/`
| File | Esporta | Descrizione |
|---|---|---|
| `AnalyticsView.tsx` | `AnalyticsView` | Grafici recharts: token stacked bar per giorno, distribuzione modelli pie, messaggi area chart, bucket distribuzione |

---

### `ai-assistant/`
| File | Esporta | Descrizione |
|---|---|---|
| `AiAssistantView.tsx` | `AiAssistantView` | Terminale-like per eseguire istruzioni AI sul progetto; output markdown in streaming via `electronAPI.ai` |

---

### `tasks/`
| File | Esporta | Descrizione |
|---|---|---|
| `TasksSection.tsx` | `TasksSection` | Subtab "Tasks": legge i task creati da Claude (`~/.claude/tasks/{sessionUUID}/*.json`) via `useProjectTasks`, raggruppati per sessione con badge di stato (pending/in_progress/completed). Click sull'header del gruppo → apre la chat della sessione (`onOpenChat`) |

---

### `plans/`
| File | Esporta | Descrizione |
|---|---|---|
| `PlansSection.tsx` | `PlansSection` | Subtab "Plans": legge i piani referenziati negli attachment `plan_mode`/`plan_mode_exit` delle sessioni e ne legge il markdown dal dir globale `~/.claude/plans/*.md` via `useProjectPlans`, raggruppati per sessione con badge `proposed`/`approved`/`deleted`. Click sul piano → `plan-detail`; click sull'header del gruppo → chat della sessione |
| `PlanDetailView.tsx` | `PlanDetailView` | Vista dettaglio singolo piano: `EntityDetailView` con toggle View/Edit + Save/Delete (edit mono-colonna, nessun frontmatter — il body è l'intero markdown; `serialize` = identità). Save/delete via `markdownFile:write`/`delete` su `~/.claude/plans/*.md`, invalida `plans:project`; il piano fresco è ri-derivato da `useProjectPlans`. Tape status/created/branch + footer filePath. I piani vivono globali su disco ma sono linkati al progetto via `planFilePath` nei `.jsonl` |

---

### `settings/`
| File | Esporta | Descrizione |
|---|---|---|
| `SettingsView.tsx` | `SettingsView`, `SettingsGearIcon`, `AppearanceTab`/`GeneralTab`/`PermissionsTab`/`ToolsTab`/`McpTab`/`ExtensionsTab`/`SourcesTab`, `ReadOnlyHint` | Pagina Settings **globale** (deep view, trigger = ingranaggio nella top bar). Legge la config **effettiva** via `useEffectiveConfig()` (cwd = home) → IPC `config:getEffective` → SDK ufficiale. Rail di tab a sinistra (Appearance, General, Permissions, Tools, MCP Servers, Extensions, Sources) + ricerca; read-only **tranne** la tab Appearance. I dati runtime (model risolto, status MCP, tool, versione) vengono dall'init dell'SDK; il merge settings + provenance da `resolveSettings`. La tab **Appearance** è una preferenza ClaudeLens (non Claude config) ed è l'**unico** controllo del tema (non c'è più il toggle in top bar): selettore Light/Dark/System via `useTheme()`; scegliere System fa seguire l'OS. I renderer di tab sono esportati per riuso |
| `ProjectConfigView.tsx` | `ProjectConfigView` | Variante **scoped al progetto** (subtab "Config" della vista progetto). `useEffectiveConfig(project.realPath)` → include i tier `project`/`local` di `.claude/settings*.json`. Riusa i renderer di `SettingsView` impilati verticalmente (scroll piatto, niente rail interno) per stare nella chrome editoriale. Read-only |

---

### `overview/`
| File | Esporta | Descrizione |
|---|---|---|
| `GlobalHomeView.tsx` | `GlobalHomeView` | Home globale: progetti, panoramica MCP, link a sezioni globali |
| `Lens.tsx` | `Lens` | Componente "lente" usata per inquadrare le metriche/sezioni della overview |
| `ProjectOverviewContent.tsx` | `ProjectOverviewContent` | Vista overview di un progetto: header metriche + sezioni (memoria, sessioni, CLAUDE.md, analytics, mcp) |
| `ProjectSubtabs.tsx` | `ProjectSubtabs` | Subtab di navigazione interna a un progetto |
| `DuplicateProjectsNotice.tsx` | `DuplicateProjectsBadge`, `DuplicateProjectsNotice` | Notice/badge per progetti duplicati (cwd rewrite + merge) |

---

## Convenzioni

- **Navigation:** ogni componente riceve `onNavigate(v: View)` e/o `onBack()` come callback — non gestisce stato di navigazione proprio
- **Data fetching:** tutti gli hook da `../../hooks/useIPC`; React Query gestisce cache e invalidazione
- **Styling:** Tailwind CSS + token `--cl-*` / classi `cl-*` in `index.css` (accent terracotta `#C15F3C`). Tema chiaro di default, dark derivato via `:root[data-theme='dark']`. Non introdurre nuove tinte d'accento — vedi root `CLAUDE.md`
- **Tema (light/dark/system):** la preferenza vive in `hooks/useTheme.tsx` (`ThemeProvider` in `App.tsx`). Unica fonte di verità `preference` (`'light' | 'dark' | 'system'`) persistita in `localStorage['cl-theme']`; `resolved` (`'light' | 'dark'`) applicato su `<html data-theme>`. Con `system` segue l'OS via `matchMedia` (aggiornamento live). Il controllo è esclusivamente nella tab Appearance dei Settings (nessun toggle in top bar)
- **Import paths:** da sottocartelle usare `../types`, `../utils`, `../shared/BackButton`, ecc.
