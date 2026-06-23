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
| `highlights.ts` | `Highlight`, `HighlightColor`, `HIGHLIGHT_COLORS`, `blockKey`, `isPersistableMessageUuid`, `rangeFromOffsets`, `textOffsetWithin`, `fencedCodeRanges`, `wrapHighlightsWithSentinels`, `materializeHighlightSentinels`, `exportHighlightCss` | **Highlight persistenti** del testo chat (vista Lens). Modulo puro: tipi + colori (4 tinte: amber/green/blue/pink), utility di range DOM (offset misurati nello spazio del **testo renderizzato** di un singolo blocco, NON nel markdown grezzo; `textOffsetWithin` misura via `Range`, così un endpoint su element node — triple-click / bordo blocco — resta corretto) e injection per l'export. L'export rilocalizza ogni highlight per **quote letterale** nel markdown grezzo e lo wrappa in `<mark>` via sentinel PUA (``-``, sopravvivono a `escapeHtml`/regex inline); un quote non trovato (markdown inline nella selezione) è **saltato** col testo intatto (soft-degrade). `skipFencedCode` (solo export **Markdown**): un highlight che cade in un fenced code block è saltato — un `<mark>` dentro un fence ``` stamperebbe letterale; l'export **HTML/PDF** omette il flag (il `<mark>` in `<pre><code>` rende bene, codice evidenziato resta a schermo e in PDF). `isPersistableMessageUuid` esclude gli uuid sintetici (`__pending_user__`, la bolla ottimistica live) dall'ancoraggio, così non restano highlight orfani dopo il reconcile. Highlight **sovrapposti** in export: il cursore di ricerca avanza oltre l'**inizio** del match (non la fine), così il secondo highlight si localizza comunque, e gli span vengono **clampati** per non annidarsi (il primo colore vince la regione comune, il secondo prende il resto — nessun highlight perso). I prompt **utente** in export HTML/PDF sono resi **verbatim** (escape + `<br>`, niente markdown), come la vista live (`<p>` plain); il testo assistant resta markdown. Le **formule math** in export sono rese come **MathML nativo** (`markdownToHtml` usa remark-math + rehype-katex con `output:'mathml'`: niente CSS/font KaTeX da spedire — Chromium/PDF e browser moderni lo rendono). `locateQuoteInRaw` tollera i whitespace del raw (skip dopo `q>0`) e i `$` (delimitatori math), così si rilocalizzano sia gli highlight **multi-paragrafo** di solo testo sia quelli che attraversano una **formula inline** (`$…$`): per questi ultimi la cattura salva `exportQuote` — come `quote` ma con ogni formula sostituita dal suo **TeX** (dall'annotation MathML, via `buildExportQuote`) — e l'export lo preferisce a `quote`. Lo span localizzato è poi spezzato per-blocco da `inlineRuns` (split sui blank line; scarta i segmenti display-math `$$…$$`/fenced che non possono portare un `<mark>` inline) → una coppia di sentinel **per paragrafo**, così un `<mark>` non scavalca mai un confine di blocco (HTML valido). Le formule **inline** finiscono dentro il `<mark>`; le formule **display** (block) sono rese (MathML) ma **non colorate** in export (un `<mark>` inline non può avvolgere un blocco) — i paragrafi attorno sì. Highlight vincolati a un **singolo blocco di testo del messaggio** per design |
| `useHighlights.ts` | `useHighlights`, `NewHighlight`, `HighlightsApi` | Store disk-backed (via `usePersistentState` → `~/.claudelens/preferences.json`, key `cl-highlights`, registrata in `prefsBackend` KEY_EVENTS) degli highlight per-sessione (`Record<sessionId, Highlight[]>`). Add/remove/recolor con read-modify-write sul valore fresco |
| `useHighlightLayer.tsx` | `useHighlightLayer`, `ToolbarState`, `ToolbarPlacement` | Layer di interazione + painting. Cattura `mouseup` (selezione testo → toolbar create, solo se start ed end condividono lo stesso `[data-hl-block]`; la selezione **può attraversare più paragrafi/formule** dentro quel blocco — il vincolo a singolo paragrafo è stato rimosso) e `click` (hit-test via `caretRangeFromPoint` su un highlight esistente → toolbar edit/remove). Dipinge con la **CSS Custom Highlight API** (`CSS.highlights` + `::highlight()`, Ranges, **zero mutazione DOM** → non litiga con react-markdown); un `MutationObserver` ri-dipinge quando il transcript cambia (toggle filtri/densità, remount markdown). Stale-skip: un Range il cui testo non combacia più col `quote` non viene dipinto. Sospeso quando un overlay copre il transcript (`enabled`) **o** quando la Custom Highlight API non è disponibile (niente listener → niente toolbar che promette qualcosa di non dipingibile). Il `quote` è catturato da `range.toString()` (non `sel.toString()`): così cattura offset, ridipintura e stale-check misurano il testo **nello stesso spazio** (`textContent`), il che fa funzionare gli highlight che attraversano formule **KaTeX** (il gemello MathML nascosto è incluso in modo coerente; `sel.toString()` lo scartava, disallineando il quote). Se la selezione tocca una formula, la cattura salva anche `exportQuote` (`buildExportQuote`: il range con le `.katex` sostituite dal loro TeX sorgente) per la rilocalizzazione in export. Le formule dentro un highlight sono dipinte come **box piena** (classe `cl-hl-formula-<color>` sull'elemento `.katex`, via `formulaIntervalsWithin` + `textSegmentsExcluding`) ed **escluse** dai range della Highlight API: il paint per-glifo lascerebbe buchi nel layout matematico (kerning/frazioni/pedici). L'export rilocalizza per quote letterale e fa soft-degrade quando non lo trova nel markdown (es. attraverso una formula). Nota: il costruttore DOM `Highlight` collide col tipo modello → quest'ultimo è aliasato `TextHighlight` |
| `HighlightToolbar.tsx` | `HighlightToolbar` | Barra flottante (portal su `<body>`) con gli swatch dei 4 colori + (in edit) il bottone rimuovi. `onMouseDown` preventDefault per non perdere la selezione nativa prima del pick. Separata dal layer per la regola fast-refresh (un file = solo componenti) |
| `useAutoScroll.ts` | `useChatAutoScroll` | Hook di bottom-pinning del feed chat: un ResizeObserver sulla colonna transcript ri-pinna a **ogni** crescita di contenuto (token, tool card che si espandono, run collassate che crescono, toggle Min/Full, reflow tardivi) finché l'utente è ancorato al fondo. Pin **istantanei** (mai smooth: gli eventi che generano atterrano esattamente al fondo e non vengono riletti come "utente scrollato via"); sgancio su scroll-up (wheel-up immediato, scrollbar/tastiera oltre soglia 200px), ri-aggancio tornando sotto soglia; l'attach via ref callback pinna in sincrono al (re)mount della colonna, così la chat si apre già in fondo. Espone `followRef` per gli effetti fratelli (toggle densità). Usato da `ChatView` e `NewChatView` |
| `atoms.tsx` | `PathChip`, `SectionLabel`, `CodeBlock` | UI atoms per il rendering degli input/output tool |
| `fileIcons.tsx` | `FileIcon` | Logo file reali (devicon-plain monocromatici via `unplugin-icons`, `~icons/devicon-plain/*`): estensione → logo linguaggio (tsx/jsx→ts/js, scss→css3, ecc.), fallback a glifo documento generico. `currentColor` → seguono tema + tinta categoria. Usato dai chip file in `MessageBubble` (footer turno minimal) |
| `ToolDetailPanel.tsx` | `ToolDetailPanel` | Pannello fullscreen dettaglio tool: rendering specifico per Read, Write, Edit, Bash, Grep, Glob, Agent, operazioni memoria |
| `ToolGroupCard.tsx` | `ToolGroupCard` | Card compatta che mostra una coppia `tool_use` + `tool_result` |
| `MessageBubble.tsx` | `ThinkingBlock`, `MessageBubble` | Singolo messaggio con testo, thinking espandibile, tool cards |
| `SubagentTranscriptPanel.tsx` | `SubagentTranscriptPanel` | Overlay col transcript interno completo di un sub-agente (`useSubagentTranscript`), reso con la stessa pipeline `buildProcessedMessages`+`MessageBubble`; ToolDetailPanel annidato per i tool interni |
| `ChatComposer.tsx` | `ChatComposer` | Barra in basso al layout Focus. **Due modalità** in base a `sessionId`: presente → **continua una sessione esistente** (`sessions:sendMessage`); assente → **avvia una nuova sessione** (`sessions:startMessage`, il nuovo id arriva su `onChatStarted` e viene propagato via prop `onStarted`). Entrambe girano sull'**Agent SDK** (`modules/chat-runner.ts`) in **streaming input mode**, non più su `claude -p`: una **`ChatSession` persistente** per vista (primo invio apre la sessione, i turni successivi cavalcano la **stessa query calda** — niente re-resume per turno), nuovi turni nello **stesso `.jsonl`** (interscambiabile col terminale) e **approvazioni tool interattive**. Due **selettori** nella meta-row (`ComposerSelect`, popover verso l'alto): **Model** (id ereditato in cima + alias Sonnet/Opus/Haiku + Default; il valore è **derivato** — `chosenModel` null = segui la prop `model`, che arriva async quando il transcript carica, così l'ereditarietà funziona anche al primo open) e **Permission** (`default`/`acceptEdits`/`plan`/`bypassPermissions`, con `bypassPermissions` marcato in rosso via flag `danger`); entrambi passano a `model`/`permissionMode`. Le **etichette + hint** riflettono i prompt reali in-app: `default`→"Ask in app" (ogni azione chiede conferma), `acceptEdits`→"Accept edits" (auto-approva gli edit, gli altri tool chiedono), `plan`→"Plan only", `bypassPermissions`→"Bypass all". Quando l'SDK chiede un tool non auto-approvato, `onPermissionRequest` **accoda** la richiesta in `permQueue` (FIFO: più `canUseTool` possono pendere insieme — tool read-only paralleli, o un tool del main + uno di un Task subagent — e mostrarne solo l'ultima lascerebbe le altre appese deadlockando il turno) e il **`PermissionRequestDialog`** mostra la testa della coda (Allow/Always/Deny → `respondPermission`, poi avanza alla successiva; hint "+N more pending"). I dialog (permessi e `SendConfirmDialog`) sono montati via **portal su `<body>`**, così restano visibili e rispondibili anche quando il workspace chat è nascosto dietro un overlay (vedi ChatView). **Autocomplete slash command**: quando il draft è un singolo token che inizia con `/` (nome comando ancora in digitazione, prima di spazi/argomenti) si apre un popover sopra l'input (`cl-slash-menu`) coi comandi disponibili filtrati per prefisso. La lista viene da `useEffectiveConfig(realPath).init.slashCommands` (cached); nav da tastiera (↑/↓, Enter/Tab per selezionare, Esc per chiudere, mouse per hover/click via `mousedown`+preventDefault per non perdere il focus). La selezione inserisce `/<cmd> ` nel draft. L'invio è **nativo**: l'Agent SDK esegue un `/comando` passato nel prompt (nessun dispatch dedicato); l'output dei comandi senza turno modello — `/compact`, `/context`, `/usage` — è reso da `chat-runner` come nota assistant. Solo `bypassPermissions` resta in `CONFIRM_MODES` (mostra `SendConfirmDialog` pre-invio, consenso ricordato in `confirmedMode`); le altre modalità inviano subito perché i tool chiedono comunque. Lo stream live è sollevato al parent su tre assi: `onStreamChange` (delta di testo da `sessions:chatChunk`, per il `LiveTurn`), `onLiveMessagesChange` (messaggi completi da `sessions:chatMessage`, accumulati in `liveMessages`; all'arrivo di un assistant message completo azzera lo `stream` così il testo parziale non si duplica) e `onLiveToolChange` (`ToolActivity` da `sessions:chatToolActivity` — il tool il cui input è in generazione o in esecuzione; azzerato all'arrivo del tool_result, a fine turno, su Stop e a ogni invio). Reset di `liveMessages` a ogni invio. Cambiando Model/Permission su una sessione viva, il main applica la modifica mid-stream via `setModel`/`setPermissionMode`. Al `chatDone` (fine **turno**, non fine processo: la sessione resta viva — il main lo emette anche quando la query muore da sola per un errore fatale, così il composer non resta su "Stop") rifà `refetch()` e svuota `permQueue`. Se l'invio fallisce **prima** che un turno parta (invoke error o `res.error`) fira `onSendFailed` così il parent ritira la bolla ottimistica. Enter invia, Shift+Enter newline; Stop → `sessions:stopMessage`, ora un `interrupt()` nativo dell'SDK (ferma il turno ma la sessione resta calda; nega i permessi pendenti). Allo smontaggio (uscita dalla chat o cambio sessione) un `useEffect` mount-only chiama `sessions:endChat` per disporre la sessione persistente; il primo invio successivo la ricrea via resume da disco. In `ChatView` è montato con `key={sessionId}` per ri-seedare lo state del picker al cambio sessione. La pill flottante si alza (`[data-composer]`) per far posto |
| `PermissionRequestDialog.tsx` | `PermissionRequestDialog` | Dialog overlay (stile `SendConfirmDialog`) mostrato quando l'Agent SDK chiede l'approvazione di un tool via `canUseTool`. Mostra `toolName`, `title`/`displayName`, `description`, e il dettaglio rilevante dell'input (`command` per Bash, `file_path`/`path`, altrimenti JSON); `pendingCount` mostra quante richieste sono in coda dietro questa. Tre azioni: **Allow once** (`{ kind: 'allow' }`), **Always allow** (`{ kind: 'always', suggestions }`, solo se l'SDK fornisce `suggestions`) e **Deny…** (apre un textarea opzionale per il messaggio che Claude vedrà → `{ kind: 'deny', message }`). **`AskUserQuestion` ha un rendering dedicato** (`QuestionForm`): le domande di chiarimento di Claude (`input.questions[]`) come opzioni cliccabili (radio/checkbox per `multiSelect`) + campo "Other…" free-text; Answer risponde `{ kind: 'allow', input: { questions, answers } }` — le risposte viaggiano **dentro l'input approvato** (chiave = testo domanda, valore = label scelte joined ", " o testo libero), perché un Allow pass-through lascerebbe le domande senza risposta; Dismiss = deny. Input malformato → fallback al rendering generico. La decisione torna al main via `respondPermission(requestId, …)` |
| `NewChatView.tsx` | `NewChatView` | Vista **nuova chat** (`View` case `new-chat`): layout Focus vuoto con `ChatComposer` in modalità new (niente `sessionId`). Durante il primo turno il transcript è costruito **interamente dallo stream SDK**: un messaggio utente sintetico (eco ottimistica del prompt) + i `liveMessages` ricevuti via `onLiveMessagesChange`, passati per la stessa `buildProcessedMessages`+`MessageBubble` di una sessione reale, con un `LiveTurn` finale per il testo assistant ancora in streaming. `detailsFilter="minimal"` (niente toggle Min/Full in new chat): mostra prompt + testo assistant ma **non** le card raw dei tool (Bash/Read/…), coerente col default di `ChatView`. Al primo invio l'SDK conia un nuovo session id (pre-generato nel main e ricevuto subito via `onStarted`, niente race); al `chatDone` costruisce un `SessionSummary` minimale (`{id}.jsonl`, campi token/costo a zero, `firstUserMessage` dal testo inviato per il titolo) e lo passa a `onCreated` → naviga alla `chat` reale (il transcript è caricato da disco da `useChatSession`, il watcher rinfresca i metadati) — ma **solo se il turno ha prodotto almeno un messaggio** (`liveMessagesRef`): l'id è coniato eagerly, quindi da solo non prova che il transcript esista; un primo turno morto senza output resta sulla vista con l'errore visibile nel composer (`onSendFailed` riporta al canvas vuoto se l'invio non è mai partito). Ingressi: bottone "New chat" nell'hero e nell'header sezione Sessions di `ProjectOverviewContent` |
| `ChatView.tsx` | `ChatView` | Vista completa chat — layout **"Focus"** (`cl-chat-workspace--focus`): solo `TopBar` (back + titolo + toggle Chat/Timeline) sopra una **colonna di lettura centrata** (`cl-chat-reading`, ~768px), niente hero/stat strip. I controlli del transcript vivono in una **pill flottante glass** in basso al centro (`ChatControlPill` → `cl-pill`): filtri per tipo (All/Tools/Thinking/Questions/Plan) + toggle densità Min/Full (chat mode) + **agent dock** (cluster di avatar + conteggio quando ci sono sub-agenti, `cl-pill-dock`) + trigger `↑` (`cl-pill-more`). La pill alza **un solo sheet alla volta** sopra di sé (`sheet: 'agents' | 'export' | null`): l'**agents sheet** (`AgentDockSheet` → `cl-sheet--agents`, lista sub-agenti correlati con click → transcript e bottone locate → scroll alla dispatch card) o lo **sheet Export/Delete** (`cl-sheet`). Il transcript resta a **tutta larghezza** (niente rail laterale). A destra una **minimap a filo** (`FocusMinimap` → `cl-focus-rail`): un dot proporzionale per turno-messaggio, label in hover, scroll-spy. Overlay `ToolDetailPanel` / `SubagentTranscriptPanel` (e la modalità Timeline) **non smontano il chat workspace**: resta montato nascosto (`chatHidden` → `display:none`), perché il composer al suo interno possiede la sessione SDK persistente e i listener di stream — smontarlo mid-turn la disporrebbe (endChat) abortendo silenziosamente il turno in volo; i dialog del composer sono su portal e restano interagibili sopra gli overlay. Lo scroller nascosto collassa comunque (offset perso): al ritorno un view anchored è ri-pinnato dal ResizeObserver, uno detached torna al turno attivo. Il **Model ereditato** passato al composer salta i turni `<synthetic>` (output di comandi locali persistito — non è un model id valido). **Turno live (no doppione):** mentre un turno è in volo (`pendingUser !== null`) il transcript renderizzato (`displayMessages`) è assemblato dallo **stream SDK**, non da una riletta del `.jsonl` a metà turno: snapshot pre-turno (`frozenMessages`) + messaggio utente sintetico + `liveMessages` (da `onLiveMessagesChange`), passati per la stessa `buildProcessedMessages`; un `LiveTurn` finale mostra il testo assistant parziale (`onStreamChange`) e, quando un tool è in preparazione/esecuzione (`onLiveToolChange`), una chip "Using X…" (`cl-live-tool`, con i secondi trascorsi dai `tool_progress`) al posto del caret. Il file watcher continua a rifare il refetch in background, ma viene ignorato per il display finché il turno non chiude — così la risposta persistita non raddoppia quella live (bug storico). A fine turno (`!streaming` + il refetch contiene già il turno: `messages.length > pendingBaseCount`) si **riconcilia** sul read canonico da disco, azzerando `pendingUser`/`frozenMessages`/`liveMessages`. **Slash command informativi (`/context`, `/usage`, `/compact`…):** il loro output reale è uno stream `<synthetic>` che Claude Code **non persiste** (su disco resta solo il placeholder, filtrato da `session-reader`). Per non perderlo, alla riconciliazione l'effetto lo **appunta** (`pinnedSlash`, keyed per **UUID della command-card** ora su disco — l'ultima che matcha il comando inviato, via `slashCommandOf`/`cardCommandOf`) e `displayMessages` lo **reinserisce** subito dopo quella card in **entrambi** i rami, idle e in-flight (`weave` su base e `frozenMessages`), così non sparisce durante il turno successivo. Vive solo finché la vista è montata (il dato non è su disco da ricaricare) |

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
