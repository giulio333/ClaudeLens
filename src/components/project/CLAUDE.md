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
| `EntityDetailView.tsx` | `EntityDetailView`, `EntityConfig`, `TapeCell` | **Vista detail unificata config-driven** (look "manifesto unificato" — Direzione 1, **flat editoriale**: canvas piatto senza wash a gradiente, orb minimale ad anello in alto a dx — `--ident-tint`: colore agent o accent — tape compatta piatta con dot/swatch, properties 2-col con tile bordate, edit a 2 colonne `320px` divise da hairline + righe opzione **verticali** con editor full-width, body editor piatto): toggle View/Edit + Save/Discard/Delete/Duplicate/Run nella TopBar. Usata da **Memory, Agent, Skill, CLAUDE.md, Plan** (read+edit unificate). Edit mono-colonna (`is-single-col`) per le entità senza frontmatter (CLAUDE.md); read-only per Plan. Glyph tile edit pieno (agent, `--ident-tint`) o outline (entità neutre). Opzioni `required` (sempre "set", badge "required" invece di ✕ — es. `type` di una memoria). Slot `viewExtras`/`editExtras` per UI non-frontmatter (es. i managed tags della memoria) |
| `entityOptions.ts` | `OptionDef`, `OptionValue`, `OptionEditor`-data, `AGENT_OPTION_DEFS`, `SKILL_OPTION_DEFS`, `MEMORY_OPTION_DEFS`, `serializeAgent`, `serializeSkill`, `serializeMemory`, `readOptions`, `entityTint`, `initialOf`, `fluidTitleSize`, helper | Logica condivisa per `EntityDetailView`: option defs per agent/skill/memory (`MEMORY_OPTION_DEFS` = solo `type`, `required`), serializzazione frontmatter YAML **con preservazione delle chiavi non modellate** (es. `hooks`; memory riscritta canonicamente da `memory-writer`), tint identità. `OptionDef.required` per i campi obbligatori |
| `MarkdownDocView.tsx` | `MarkdownDocView` | Shell markdown semplice (toggle View/Edit nell'hero). **Non più usata** dopo la migrazione di Memory a `EntityDetailView` — superata da quella, candidata alla rimozione |
| `CreateFormKit.tsx` | `ModelPicker`, `ToolsInput`, `FieldHint`, `CharCounter`, `openDocs`, `validateName`, `useCreateFormKeys`, `MODEL_PRESETS`, `KNOWN_TOOLS`, `NAME_MAX`, `DESC_MAX`, `NAME_RE` | Building blocks condivisi per le pagine "create" (skill, agent): picker modello accent-aware, autocomplete tools, hint, counter, validazione nome, hook keybinding (⌘↵/Esc) |
| `DeleteSessionDialog.tsx` | `DeleteSessionDialog` | Dialog di conferma per cancellare una sessione + artefatti. Carica l'inventario via `useSessionArtifacts` (IPC `sessions:getArtifacts`) e mostra una checklist: transcript `.jsonl` (locked, sempre incluso), sub-agenti e task (default ON), piani globali condivisi (default OFF, con "referenced by N sessions"); `title` su ogni riga = path completo in hover. Conferma → `useDeleteSession`. Usato da `chat/ChatView` (TopBar) e da `overview/ProjectOverviewContent` (riga sessione) |

---

### `chat/` — Rendering sessioni chat
| File | Esporta | Descrizione |
|---|---|---|
| `utils.ts` | `buildProcessedMessages`, `correlateSessionAgents`, `resolveToolIcon`, `stripLineNumbers`, `fileExt`, `parseMemoryFrontmatter`, tipi `ToolGroup`, `ProcessedMessage`, `SessionAgent`, `ChatDetailsFilter` | Pre-processing messaggi raw: abbina `tool_use` + `tool_result` per ID; rimuove messaggi utente con soli tool_result; `correlateSessionAgents` collega ogni dispatch `Task`/`Agent` al suo transcript subagent per prefisso-prompt |
| `highlights.ts` | `Highlight`, `HighlightColor`, `HIGHLIGHT_COLORS`, `blockKey`, `isPersistableMessageUuid`, `rangeFromOffsets`, `textOffsetWithin`, `fencedCodeRanges`, `wrapHighlightsWithSentinels`, `materializeHighlightSentinels`, `exportHighlightCss` | **Highlight persistenti** del testo chat (vista Lens). Modulo puro: tipi + colori (4 tinte: amber/green/blue/pink), utility di range DOM (offset misurati nello spazio del **testo renderizzato** di un singolo blocco, NON nel markdown grezzo; `textOffsetWithin` misura via `Range`, così un endpoint su element node — triple-click / bordo blocco — resta corretto) e injection per l'export. L'export rilocalizza ogni highlight per **quote letterale** nel markdown grezzo e lo wrappa in `<mark>` via sentinel PUA (``-``, sopravvivono a `escapeHtml`/regex inline); un quote non trovato (markdown inline nella selezione) è **saltato** col testo intatto (soft-degrade). `skipFencedCode` (solo export **Markdown**): un highlight che cade in un fenced code block è saltato — un `<mark>` dentro un fence ``` stamperebbe letterale; l'export **HTML/PDF** omette il flag (il `<mark>` in `<pre><code>` rende bene, codice evidenziato resta a schermo e in PDF). `isPersistableMessageUuid` esclude gli uuid sintetici (`__pending_user__`, la bolla ottimistica live) dall'ancoraggio, così non restano highlight orfani dopo il reconcile. Highlight **sovrapposti** in export: il cursore di ricerca avanza oltre l'**inizio** del match (non la fine), così il secondo highlight si localizza comunque, e gli span vengono **clampati** per non annidarsi (il primo colore vince la regione comune, il secondo prende il resto — nessun highlight perso). I prompt **utente** in export HTML/PDF sono resi **verbatim** (escape + `<br>`, niente markdown), come la vista live (`<p>` plain); il testo assistant resta markdown. Le **formule math** in export sono rese come **MathML nativo** (`markdownToHtml` usa remark-math + rehype-katex con `output:'mathml'`: niente CSS/font KaTeX da spedire — Chromium/PDF e browser moderni lo rendono). `locateQuoteInRaw` tollera i whitespace del raw (skip dopo `q>0`) e i `$` (delimitatori math), così si rilocalizzano sia gli highlight **multi-paragrafo** di solo testo sia quelli che attraversano una **formula inline** (`$…$`): per questi ultimi la cattura salva `exportQuote` — come `quote` ma con ogni formula sostituita dal suo **TeX** (dall'annotation MathML, via `buildExportQuote`) — e l'export lo preferisce a `quote`. Lo span localizzato è poi spezzato per-blocco da `inlineRuns` (split sui blank line; scarta i segmenti display-math `$$…$$`/fenced che non possono portare un `<mark>` inline) → una coppia di sentinel **per paragrafo**, così un `<mark>` non scavalca mai un confine di blocco (HTML valido). Le formule **inline** finiscono dentro il `<mark>`; le formule **display** (block) sono rese (MathML) ma **non colorate** in export (un `<mark>` inline non può avvolgere un blocco) — i paragrafi attorno sì. Highlight vincolati a un **singolo blocco di testo del messaggio** per design |
| `useHighlights.ts` | `useHighlights`, `NewHighlight`, `HighlightsApi` | Store disk-backed (via `usePersistentState` → `~/.claudelens/preferences.json`, key `cl-highlights`, registrata in `prefsBackend` KEY_EVENTS) degli highlight per-sessione (`Record<sessionId, Highlight[]>`). Add/remove/recolor con read-modify-write sul valore fresco |
| `useHighlightLayer.tsx` | `useHighlightLayer`, `ToolbarState`, `ToolbarPlacement` | Layer di interazione + painting. Cattura `mouseup` (selezione testo → toolbar create, solo se start ed end condividono lo stesso `[data-hl-block]`; la selezione **può attraversare più paragrafi/formule** dentro quel blocco — il vincolo a singolo paragrafo è stato rimosso) e `click` (hit-test via `caretRangeFromPoint` su un highlight esistente → toolbar edit/remove). Dipinge con la **CSS Custom Highlight API** (`CSS.highlights` + `::highlight()`, Ranges, **zero mutazione DOM** → non litiga con react-markdown); un `MutationObserver` ri-dipinge quando il transcript cambia (toggle filtri/densità, remount markdown). Stale-skip: un Range il cui testo non combacia più col `quote` non viene dipinto. Sospeso quando un overlay copre il transcript (`enabled`) **o** quando la Custom Highlight API non è disponibile (niente listener → niente toolbar che promette qualcosa di non dipingibile). Il `quote` è catturato da `range.toString()` (non `sel.toString()`): così cattura offset, ridipintura e stale-check misurano il testo **nello stesso spazio** (`textContent`), il che fa funzionare gli highlight che attraversano formule **KaTeX** (il gemello MathML nascosto è incluso in modo coerente; `sel.toString()` lo scartava, disallineando il quote). Se la selezione tocca una formula, la cattura salva anche `exportQuote` (`buildExportQuote`: il range con le `.katex` sostituite dal loro TeX sorgente) per la rilocalizzazione in export. Le formule dentro un highlight sono dipinte come **box piena** (classe `cl-hl-formula-<color>` sull'elemento `.katex`, via `formulaIntervalsWithin` + `textSegmentsExcluding`) ed **escluse** dai range della Highlight API: il paint per-glifo lascerebbe buchi nel layout matematico (kerning/frazioni/pedici). L'export rilocalizza per quote letterale e fa soft-degrade quando non lo trova nel markdown (es. attraverso una formula). Nota: il costruttore DOM `Highlight` collide col tipo modello → quest'ultimo è aliasato `TextHighlight` |
| `HighlightToolbar.tsx` | `HighlightToolbar` | Barra flottante (portal su `<body>`) con gli swatch dei 4 colori + (in edit) il bottone rimuovi. `onMouseDown` preventDefault per non perdere la selezione nativa prima del pick. Separata dal layer per la regola fast-refresh (un file = solo componenti) |
| `useAutoScroll.ts` | `useChatAutoScroll` | Hook di bottom-pinning del feed chat: un ResizeObserver sulla colonna transcript ri-pinna a **ogni** crescita di contenuto (token, tool card che si espandono, run collassate che crescono, toggle Min/Full, reflow tardivi) finché l'utente è ancorato al fondo. Pin **istantanei** (mai smooth: gli eventi che generano atterrano esattamente al fondo e non vengono riletti come "utente scrollato via"); sgancio su scroll-up (wheel-up immediato, scrollbar/tastiera oltre soglia 200px), ri-aggancio tornando sotto soglia; l'attach via ref callback pinna in sincrono al (re)mount della colonna, così la chat si apre già in fondo. Espone `followRef` per gli effetti fratelli (toggle densità). Usato da `ChatView` e `LiveChatView` |
| `atoms.tsx` | `PathChip`, `SectionLabel`, `CodeBlock`, `LiveInTerminalBadge` | UI atoms per il rendering degli input/output tool + badge TopBar "Live in terminal" (condiviso da `ChatView`/`LiveChatView`) |
| `fileIcons.tsx` | `FileIcon` | Logo file reali (devicon-plain monocromatici via `unplugin-icons`, `~icons/devicon-plain/*`): estensione → logo linguaggio (tsx/jsx→ts/js, scss→css3, ecc.), fallback a glifo documento generico. `currentColor` → seguono tema + tinta categoria. Usato dai chip file in `MessageBubble` (footer turno minimal) |
| `ToolDetailPanel.tsx` | `ToolDetailPanel` | Pannello fullscreen dettaglio tool: rendering specifico per Read, Write, Edit, Bash, Grep, Glob, Agent, operazioni memoria |
| `ToolGroupCard.tsx` | `ToolGroupCard` | Card compatta che mostra una coppia `tool_use` + `tool_result` |
| `MessageBubble.tsx` | `ThinkingBlock`, `MessageBubble` | Singolo messaggio con testo, thinking espandibile, tool cards |
| `SubagentTranscriptPanel.tsx` | `SubagentTranscriptPanel` | Overlay col transcript interno completo di un sub-agente (`useSubagentTranscript`), reso con la stessa pipeline `buildProcessedMessages`+`MessageBubble`; ToolDetailPanel annidato per i tool interni |
| `ChatComposer.tsx` | `ChatComposer` | Barra in basso al layout Focus — **componente puramente presentazionale**: tutto lo stato della conversazione (subscription IPC, turno in volo, coda permessi, transcript) vive in `useLiveChat`; il composer possiede solo ciò che appartiene all'input: il draft, l'**autocomplete slash command** (popover `cl-slash-menu` sul draft `/token`, lista da `useEffectiveConfig(realPath).init.slashCommands`, nav ↑/↓/Enter/Tab/Esc; l'invio è nativo — l'Agent SDK esegue un `/comando` nel prompt), i due **selettori** della meta-row (`ComposerSelect`: **Model** — id ereditato dalla prop `model` + alias Sonnet/Opus/Haiku + Default, valore derivato con `chosenModel` null = segui la prop — e **Permission** `default`/`acceptEdits`/`plan`/`bypassPermissions`, quest'ultimo `danger`), e il **`SendConfirmDialog`** pre-invio per i modi rischiosi (`CONFIRM_MODES` = solo `bypassPermissions`, consenso ricordato in `confirmedMode`). Send → `onSend(text, { model, permissionMode })` verso l'owner; Stop → `onStop`; `lockNotice` (settata da `LiveChatView` quando la sessione è viva nel terminale) disabilita input+Send e mostra il messaggio sopra la row; la richiesta di permesso in testa alla coda arriva come prop (`permRequest`/`permPendingCount`) ed è risposta via `onRespondPermission` (il dialog resta montato via **portal su `<body>`** così è rispondibile anche col workspace nascosto). `sessionId` presente/assente guida solo il copy (resume vs new). Usato esclusivamente da `LiveChatView` |
| `PermissionRequestDialog.tsx` | `PermissionRequestDialog` | Dialog overlay (stile `SendConfirmDialog`) mostrato quando l'Agent SDK chiede l'approvazione di un tool via `canUseTool`. Mostra `toolName`, `title`/`displayName`, `description`, e il dettaglio rilevante dell'input (`command` per Bash, `file_path`/`path`, altrimenti JSON); `pendingCount` mostra quante richieste sono in coda dietro questa. Tre azioni: **Allow once** (`{ kind: 'allow' }`), **Always allow** (`{ kind: 'always', suggestions }`, solo se l'SDK fornisce `suggestions`) e **Deny…** (apre un textarea opzionale per il messaggio che Claude vedrà → `{ kind: 'deny', message }`). **`AskUserQuestion` ha un rendering dedicato** (`QuestionForm`): le domande di chiarimento di Claude (`input.questions[]`) come opzioni cliccabili (radio/checkbox per `multiSelect`) + campo "Other…" free-text; Answer risponde `{ kind: 'allow', input: { questions, answers } }` — le risposte viaggiano **dentro l'input approvato** (chiave = testo domanda, valore = label scelte joined ", " o testo libero), perché un Allow pass-through lascerebbe le domande senza risposta; Dismiss = deny. Input malformato → fallback al rendering generico. La decisione torna al main via `respondPermission(requestId, …)` |
| `LiveChatView.tsx` | `LiveChatView` | Vista **chat SDK in-app** (`View` case `new-chat`): la conversazione live, guidata dallo stream. **Solo rendering**: tutto lo stato vive in `useLiveChat` (vedi riga dedicata) — la vista mostra `displayMessages` (transcript committato + bolla ottimistica + turno in volo) con `MessageBubble` `detailsFilter="minimal"`, un `LiveTurn` finale per il testo parziale / chip "Using X…", i metadati live (costo/token/modello dal `ChatTurnSummary` del `result` SDK) nella TopBar, e il `ChatComposer` presentazionale. **Due ingressi**: nuova conversazione (bottoni "New chat"/"SDK chat" di `ProjectOverviewContent`) o **resume di una sessione esistente** via prop `resumeSession` (azione **"Chat"** sulla riga sessione): il transcript è seedato con una lettura imperativa da disco al mount (mai una query watchata — niente refetch mid-turn), il composer eredita l'ultimo modello della sessione, il primo invio riprende lo stesso `.jsonl`. **Sessione viva nel terminale** (registro, via `useActiveSessions`): il composer è **locked** (`lockNotice` — rispondere qui gareggerebbe col CLI sullo stesso transcript), badge "Live in terminal" in TopBar, e il transcript **segue il disco** (`followDisk` di `useLiveChat`) così la conversazione del terminale scorre nella vista; il lock si scioglie da solo quando la sessione terminale finisce (il CLI aggiorna il registro all'uscita → push del watcher). Il registro esclude le sessioni SDK → la chat non si auto-locka mai. Keyed in `ProjectOverview` per `resumeSession.filename ?? 'new'`. **Trade-off voluti**: niente export/highlights durante la chat (riapri la sessione read-only in `ChatView`) |
| `useLiveChat.ts` | `useLiveChat` | **Hook: unico owner dello stato della chat SDK live.** Subscription mount-only ai canali `sessions:chat*` (payload a busta col `sessionId` produttore — gli eventi di una sessione non propria, es. il `chatDone` finale di una sessione superseded, sono **scartati**; l'id è adottato da `chatStarted`, emesso dal main prima di ogni evento stream), stato del turno in volo (`streamText`/`liveMessages`/`liveTool`/`permQueue`), transcript committato + bolla ottimistica (commit a `chatDone` leggendo i **ref interni** — niente hop cross-component che era il punto dove una risposta appena streamata poteva perdersi), azioni `send` (startMessage/sendMessage + rollback su fallimento pre-turno), `stop` (interrupt nativo), `respondPermission` (FIFO), `endChat` allo smontaggio. Modalità **resume** opzionale: seed del transcript da disco (`getChat` imperativo) + `sessionId` noto up front; con `followDisk` (sessione viva nel terminale, composer locked) il seed è ri-eseguito sugli eventi `data:changed` (debounce, mai con un turno in volo — `pendingRef` guard), così la vista segue il CLI finché non termina |
| `icons.tsx` | `TrashGlyph`, `ChevronUpGlyph`, `DockCaretGlyph`, `LocateGlyph` | Glyph SVG inline (stroke `currentColor`) usati da pill e dock sheets |
| `LiveTurn.tsx` | `LiveTurn` | Turno assistant provvisorio mostrato durante lo streaming SDK (testo parziale + caret, o chip "Using X…" quando un tool è in preparazione/esecuzione). Mirrora il markup `cl-turn--claude`. Usato da `LiveChatView` (la chat live; `ChatView` read-only non ha più turni in volo) |
| `FocusMinimap.tsx` | `FocusMinimap` | Minimap a filo del layout Focus (`cl-focus-rail`): un dot proporzionale per turno-messaggio, ruler adattivo (spacing/anelli scalano con la densità misurata via ResizeObserver), label in hover, scroll-spy |
| `ChatControlPill.tsx` | `ChatControlPill` | Pill flottante glass (`cl-pill`) coi controlli del transcript: filtri per tipo + toggle densità Min/Full, **agent dock** + **skill dock** (`AgentDockSheet`/`SkillDockSheet` + orb cluster), e lo sheet Export/Delete. Alza **un solo sheet alla volta** (`'agents' \| 'skills' \| 'export'`); registra un opener imperativo (`openExportRef`) per il bottone export per-turno. Estratto da `ChatView` || `useTranscriptModel.ts` | `useTranscriptModel`, `TranscriptModel` | **Hook: derivazione del transcript Focus.** Da `processed` + `detailsFilter` + resolver tinta agent ricava `descriptors`/`visibleItems`/`minimapItems`/`renderItems`/`filterCounts` (tutto memoizzato; la logica pesante — `buildRenderItems`/`computeFilterCounts` — è in `utils.ts`, unit-tested) |
| `ChatView.tsx` | `ChatView` | **Viewer read-only, disk-backed** di una sessione esistente — layout **"Focus"** (`cl-chat-workspace--focus`). `displayMessages = messages` (il read di `useChatSession`, memoizzato per stabilità referenziale), watcher-driven; **niente composer, niente stream** — la chat SDK live è una vista separata (`LiveChatView`) che non legge mai il disco. La derivazione del transcript è in `useTranscriptModel`, pill/minimap nei rispettivi file. Solo `TopBar` (back + titolo + toggle Chat/Timeline + tag + badge **"Live in terminal"** se la sessione è viva nel registro; il vecchio bottone "Continue chat" è stato rimosso — l'ingresso alla chat SDK è l'azione **"Chat"** sulla riga sessione, che apre direttamente `LiveChatView` in resume mode) sopra una **colonna di lettura centrata** (`cl-chat-reading`, ~768px). I controlli vivono in una **pill flottante glass** (`ChatControlPill` → `cl-pill`): filtri per tipo (All/Tools/Thinking/Questions/Plan) + toggle densità Min/Full + **agent/skill dock** + sheet Export/Delete (alza **un solo sheet alla volta**). Transcript a **tutta larghezza** + **minimap a filo** a destra (`FocusMinimap` → `cl-focus-rail`, dot per turno, scroll-spy). Mantiene tutte le affordance di lettura: export, highlights, timeline (`SessionGraphView`), tag, delete, transcript sub-agente. Overlay `ToolDetailPanel`/`SubagentTranscriptPanel` (e Timeline) **non smontano il workspace**: resta montato nascosto (`chatHidden` → `display:none`) per preservare scroll/highlight-layer/scroll-spy quando l'overlay si chiude (al ritorno un view anchored è ri-pinnato dal ResizeObserver, uno detached torna al turno attivo). `ChatView` è **keyed per `session.filename`** in `ProjectOverview`. `embedded` (Terminal/Lens) è un sotto-caso di chrome (niente TopBar/minimap) |

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
| `MemoryTopicView.tsx` | `MemoryTopicView` | Vista singolo topic sulla **superficie unificata `EntityDetailView`** (stessa firma/props di prima): view (hero + tape Type/Reading/Words/Links + body markdown + Properties `type` + blocco Metadata) ed edit strutturato (description + `type` select obbligatorio + body) con Save/Delete. `serializeMemory` → `parseTopicInput` → `useUpdateTopic` (il file è riscritto canonicamente da `memory-writer`). I **managed tags** (`useMemoryTags`, store namespaced — NON frontmatter) sono resi via slot `viewExtras`/`editExtras` con `ManagedTagChip`+`TagPicker`; **origin session** (link alla chat) e date nel blocco Metadata. Memory project-level (`isProjectLevel`) → read-only (no edit/delete), ma i tag restano editabili (metadata d'app) |

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

### `plugins/`
| File | Esporta | Descrizione |
|---|---|---|
| `PluginsView.tsx` | `PluginsView` | Vista lista plugin globali (`View` case `plugins`): legge i plugin installati via `usePlugins` (IPC `plugins:getAll`), raggruppati per **marketplace**, tile con descrizione + conteggi (`N skills · N agents · N commands`). Click → `plugin-detail`. Linguaggio editoriale `cl-hero`/`cl-section`/`cl-tile-grid` come `GlobalSkillsView`. Ingresso: tile "Plugins" nella sezione Configuration di `GlobalHomeView` |
| `PluginDetailView.tsx` | `PluginDetailView` | Dettaglio singolo plugin (`View` case `plugin-detail`): hero (nome, marketplace, repo, versione, author) + sezioni Skills / Agents / Commands come tile grid. Apertura di un item gestita con **stato locale** `open` (non casi della View union) che rende inline la detail **read-only**: skill → `SkillDetailView readOnly`, agent → `AgentDetailView readOnly`, command → `EntityDetailView` config `editable:false`/`deletable:false`. Ri-deriva il plugin fresco da `usePlugins` (back interno al plugin via `setOpen(null)`). I plugin sono read-only perché gestiti dal plugin manager |

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

### `workflows/`
Subtab "Workflows": mostra i run del **Workflow tool** di Claude Code (orchestrazione multi-agente, es. `/code-review` ad alto effort). L'SDK **non** ha API per i workflow → lo stato del run è letto raw da `workflows-reader.ts` (`workflows:getByProject`/`getRun`) con validazione difensiva stile `sessions-registry-reader`. **Insight chiave:** la session dir che contiene lo state JSON di un run **non è** sempre quella che l'ha lanciato (resume/fork); il reader raggruppa per la session **originante** estratta da `scriptPath`, l'unica il cui `.jsonl` esiste (header→chat) e che l'SDK `getSubagentMessages` sa risolvere per il drill-down del transcript.
| File | Esporta | Descrizione |
|---|---|---|
| `utils.ts` | `fmtDuration`, `statusTone`, `Tone` | Formatter puri condivisi da lista e detail (durata wall-clock; status→tone `ok`/`error`/`muted` con soli token brand esistenti) |
| `WorkflowsSection.tsx` | `WorkflowsSection` | Lista dei run via `useProjectWorkflows`, raggruppati per sessione originante. Per run: nome, status pill (token `ok`/`error`/`muted`, nessuna tinta nuova — riusa `--cl-accent`/`--cl-danger`), `args` chip, stat strip (`N agents · N phases · durata · tokens · model`), pill `N agents errored` quando `errorAgentCount>0` (uno `status:completed` può mentire), riga **degradata** tratteggiata per i run orfani (transcript senza state JSON). Click riga → `workflow-detail`; header gruppo → chat/terminale della sessione |
| `WorkflowRunDetailView.tsx` | `WorkflowRunDetailView` | Pagina read-only custom (non `EntityDetailView`): `TopBar` + hero (nome, status, `StatChip` agents/errored/phases/durata/tokens/tool calls/model, summary, data), **rail fasi** con agent rows raggruppati per `phaseIndex` (glyph stato ✓/✕, dot colore modello, tokens/tool/durata, `retry N`, `lastToolName`+summary, `error` inline, prompt/result preview espandibili), logs/result/script collassabili (`<details>`), footer `scriptPath`. Click "view transcript →" su un agent → overlay `SubagentTranscriptPanel` (`sessionFilename` = `${run.sessionId}.jsonl`, `subagentType:'workflow-subagent'`), che risolve il transcript annidato via SDK. Fetch on-demand con `useWorkflowRun` (watcher-live). Banner + lista `orphanAgentIds` drill-down-abile per i run degradati |

---

### `teams/`
Subtab "Teams": mostra i **team di agenti** di Claude Code 2.x (teammate in-process coordinati da un team-lead). **Insight chiave:** il registry globale `~/.claude/teams/<teamName>/config.json` è stale-prone (sessioni lead uccise lasciano i membri nel config; ogni sessione crea eagerly una dir team vuota; `leadSessionId` diventa stale quando la sessione lead ruota id al resume) → la fonte di verità è il transcript teammate (`{sessionId}/subagents/agent-a<name>-*.jsonl` + sidecar `.meta.json` con `taskKind: 'in_process_teammate'` e `teamName`), letto da `teams-reader.ts` (`teams:getByProject`/`getDetail`); il config solo arricchisce (prompt, joinedAt, membri mai partiti). Le inbox (`inboxes/*.json`) sono code transienti svuotate in secondi — nessuno storico, escluse dal watcher.

**Secondo ingresso — Mission Control:** il rail (`terminal/MissionRail.tsx`) ha un'isola **TEAMS** (`TeamsCard`/`TeamRow`) **scoped alla sessione focalizzata** (un team è lanciato dentro una sessione — il lead *è* la sessione): il match copre l'intero array dei lead id ruotati (`team.sessionIds.includes(sessionId)`) più lo stale-prone `leadSessionIdFromConfig` come segnale secondario. L'isola è resa ogni volta che il progetto ha team, con empty state esplicito "No teams in this session · N in the project" — così "nessun team nel progetto" (isola nascosta) e "nessun team in questa sessione" restano distinguibili senza il vecchio tag `THIS SESSION` (rimosso: rumore > beneficio). Live-first; status onesto **LEAD LIVE** (+ WORKING/WAITING dal registry — descrive la *sessione lead*, non i teammate, il tooltip lo dice) / **ENDED** / **HISTORICAL**, segnale **`quiet Nm`** (accent) quando live ma `lastActivity` ferma da ≥5 min (firma del team bloccato). Click card → `TeamDetailView` ospitata nell'**overlay** di `TerminalMissionControl` (kind `'team'`, `backLabel="Close"` — il PTY resta vivo); l'"open chat" del dettaglio in overlay naviga alla Mission Control della sessione (view `terminal` keyed per `resumeSessionId` in `ProjectOverview` + prop `onOpenSession`), con `window.confirm` se un PTY sta girando (navigare lo ucciderebbe).
| File | Esporta | Descrizione |
|---|---|---|
| `utils.ts` | `isTeamLive`, `liveLeadSession`, `isGeneratedName`, `teamLabel`, `memberColor`, `fmtRelative`, `fmtTokens`, `minutesSince` | Liveness renderer-side (cross-check `team.sessionIds`/`leadSessionIdFromConfig` — ora su `TeamSummary` — con `useActiveSessions`; `liveLeadSession` ritorna l'entry registry viva per lo status busy/waiting); titolo team condiviso lista/rail (`teamLabel`: nome generato → titolo sessione lead); mappa dei colori nominati dei teammate (blue/green/…) su tinte **desaturate** (encoding dati come `modelColor`, nessuna nuova tinta accent); tempo relativo (date > 7d in `en-US` — UI english-only, niente `it-IT`); `fmtTokens` compatto (`3.7m`/`52k`) per il footer token |
| `TeamsSection.tsx` | `TeamsSection` | Lista team via `useProjectTeams` **raggruppata per sessione** (pattern `PlansSection`/`TasksSection`): header eyebrow per sessione (`cl-plan-eyebrow` riusato — titolo `sessionTitle`, `N teams · data`, link hover **open chat ↗**) sopra le sue **slab card** (design direction 1c). Un team multi-`sessionId` (lead che ruota id al resume) è ancorato alla sola sessione più recente (`team.filename`), mai duplicato. Card: slab scuro a sinistra (member count grande, dot colore per membro, stato `Live`/`Ended`/`Historical` — live via `isTeamLive`, dot pulsante), corpo editoriale a destra (kicker "Agent team", titolo `teamLabel`, meta mono `Lead <id8> · N transcripts · N messages · last activity`, azione **Open team →** — l'ingresso chat vive sull'header di gruppo, chip membri `cl-team-chip` cap 6 + `+N`) e footer **token distribution** (barra segmentata per membro da `TeamSummary.memberTokens`, totale `fmtTokens`; nota "Configuration unavailable" quando `!hasConfig`). Card intera cliccabile → `team-detail` |
| `TeamDetailView.tsx` | `TeamDetailView` | Pagina read-only custom (pattern `WorkflowRunDetailView`): `TopBar` + hero (`StatChip` members/transcripts/messages/tokens/sessions), nota "stale lead id" quando il `leadSessionIdFromConfig` non è tra le sessioni con transcript, sezione **Lead sessions** (una riga per session id ruotato, link → terminale, la più recente evidenziata), sezione **Members** con righe espandibili (dot colore, model/permissionMode, metriche `N msg · N tools · N tok` dal parse del transcript, description/cwd/prompt in dettaglio, stato muted "never produced a transcript" per i `config-only`) e **"Open transcript →"** per ogni transcript (membro respawnato = più bottoni) → overlay `SubagentTranscriptPanel` (`sessionFilename` = quella del transcript, `subagentType` = nome membro), e sezione **Team activity**: timeline della conversazione del team (`TeamEvent[]` dal reader — dispatch + messaggi bidirezionali con summary in evidenza e testo completo in `<details>`, dot del colore del mittente, lead = accent; ricostruita dai transcript dei membri: `<teammate-message>` in ingresso + tool call `SendMessage` in uscita, idle notification scartate, `to:"main"` normalizzato a `team-lead`). Fetch on-demand con `useTeamDetail` (watcher-live). Prop `backLabel?` (default `'Teams'`; `'Close'` quando ospitata nell'overlay di Mission Control). **Due modalità di body** switchabili da un segmented `.cl-view-mode` in TopBar (visibile solo con membri): **Overview** (default, quanto sopra) e **Swimlanes** (`TeamSwimlanes`) |
| `TeamSwimlanes.tsx` | `TeamSwimlanes` | Vista secondaria del team detail (design 1g): la conversazione **plottata su corsie** — una lane verticale per team-lead (accent) + ogni membro (colore dato), righe cronologiche dai `TeamEvent` (dispatch = linea sottile sbiadita col tag `dispatch`, messaggi = linea piena color mittente, dot pieno = sender, anello = receiver, summary mono al midpoint — bold per i report member→lead), label espandibile al click (testo completo in Markdown), richieste **broadcast duplicate del lead nascoste** di default (`N more request messages hidden · show all`), legenda, footer compatto dei membri (dot + nome + token `fmtTokens` + `→` transcript). Pill di lane cliccabili: lead → open chat, membro → transcript. Posizioni x = frazioni `(i+0.5)/n` oltre il gutter tempi 56px (classi `cl-sw-*` in index.css) |

---

### `settings/`
| File | Esporta | Descrizione |
|---|---|---|
| `SettingsView.tsx` | `SettingsView`, `SettingsGearIcon`, `AppearanceTab`/`GeneralTab`/`PermissionsTab`/`ToolsTab`/`McpTab`/`ExtensionsTab`, `ReadOnlyHint` | Pagina Settings **globale** (deep view, trigger = ingranaggio nella top bar). Legge la config **effettiva** via `useEffectiveConfig()` (cwd = home) → IPC `config:getEffective` → SDK ufficiale. **Rail di tab a sinistra** (Appearance, Privacy, General, Permissions, Tools, MCP Servers, Extensions) + ricerca; il pannello destro è un **"instrument readout"** stile scheda tecnica (classi `set-*` in index.css): `PanelHead` per-tab (eyebrow + titolo grande + caption scritta dal lato utente), `Block` con label mono + hairline, e righe `Row` con **leader puntinati** (il device-firma) che collegano il setting al valore + **source stamp** (provenance, tag mono violet) per ogni valore risolto. Read-only **tranne** Appearance e Privacy. La tab **Sources** (dump JSON dei tier) è stata **rimossa** — la provenance per-campo è ora sui singoli valori. La tab **Appearance** è una preferenza ClaudeLens (selettore Light/Dark/System via `useTheme()`, unico controllo del tema). I renderer di tab accettano `heading?` (stampa la label di dominio) per il riuso impilato |
| `ProjectConfigView.tsx` | `ProjectConfigView` | Variante **scoped al progetto** (subtab "Config" della vista progetto). `useEffectiveConfig(project.realPath)` → include i tier `project`/`local` di `.claude/settings*.json`. Riusa i renderer di `SettingsView` (`GeneralTab`/… con `heading`) impilati verticalmente (scroll piatto, niente rail interno) per stare nella chrome editoriale. Read-only |

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
