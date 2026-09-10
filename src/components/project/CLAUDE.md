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
- `fmtCost(n)` — costo in dollari, max 2 decimali + separatore migliaia (`$1,234.56`); sotto il centesimo → `<$0.01` (mai `$0.00`)
- `fmtDate(d)` — data localizzata `it-IT`
- `fmtModel(m)` — ID modello → nome leggibile (`claude-sonnet-4-6` → `Sonnet 4.6`)
- `modelColor(m)` — colore hex accent per famiglia modello
- `formatTokens(n)` — conteggio compatto `{value, unit}` (`2.3` + `m`)
- `modelMixKey(m)` / `buildModelMix(sessions)` — distribuzione per famiglia modello della **fascia metriche** dell'hero progetto: quota sui **token** (non sulle sessioni), famiglie a zero token scartate (mai un segmento a larghezza nulla), finestra senza uso → `[]` e la cella mostra l'empty state. Un id sconosciuto finisce in `other` invece di essere indovinato. Unit-tested in `test/project-formatters.test.ts`

---

## Struttura per dominio

### `shared/` — Atomi UI riutilizzabili

- **`BackButton.tsx`** — Bottone freccia indietro con label
- **`StatChip.tsx`** — Chip label + valore, variante accent indigo
- **`TopBar.tsx`** → `TopBar`, `Crumb` — Top bar editoriale condivisa (52px, drag region, back + breadcrumbs + right slot)
- **`EntityDetailView.tsx`** → `EntityDetailView`, `EntityConfig`, `TapeCell` — **Vista detail unificata config-driven** (look "manifesto unificato" — Direzione 1, **flat editoriale**: canvas piatto senza wash a gradiente, orb minimale ad anello in alto a dx — `--ident-tint`: colore agent o accent — tape compatta piatta con dot/swatch, properties 2-col con tile bordate, edit a 2 colonne `320px` divise da hairline + righe opzione **verticali** con editor full-width, body editor piatto): toggle View/Edit + Save/Discard/Delete/Duplicate/Run nella TopBar. Usata da **Memory, Agent, Skill, CLAUDE.md, Plan** (read+edit unificate). Edit mono-colonna (`is-single-col`) per le entità senza frontmatter (CLAUDE.md); read-only per Plan. Glyph tile edit pieno (agent, `--ident-tint`) o outline (entità neutre). Opzioni `required` (sempre "set", badge "required" invece di ✕ — es. `type` di una memoria). Slot `viewExtras`/`editExtras` per UI non-frontmatter (es. i managed tags della memoria)
- **`entityOptions.ts`** → `OptionDef`, `OptionValue`, `OptionEditor`-data, `AGENT_OPTION_DEFS`, `SKILL_OPTION_DEFS`, `MEMORY_OPTION_DEFS`, `serializeAgent`, `serializeSkill`, `serializeMemory`, `readOptions`, `entityTint`, `initialOf`, `fluidTitleSize`, helper — Logica condivisa per `EntityDetailView`: option defs per agent/skill/memory (`MEMORY_OPTION_DEFS` = solo `type`, `required`), serializzazione frontmatter YAML **con preservazione delle chiavi non modellate** (es. `hooks`; memory riscritta canonicamente da `memory-writer`), tint identità. `OptionDef.required` per i campi obbligatori
- **`MarkdownDocView.tsx`** — Shell markdown semplice (toggle View/Edit nell'hero). **Non più usata** dopo la migrazione di Memory a `EntityDetailView` — superata da quella, candidata alla rimozione
- **`CreateFormKit.tsx` / `formKit.ts`** → componenti: `ModelPicker`, `ToolsInput`, `FieldHint`, `CharCounter`; non-componenti (in `formKit.ts`): `openDocs`, `validateName`, `useCreateFormKeys`, `MODEL_PRESETS`, `KNOWN_TOOLS`, `TOOL_DESCRIPTIONS`, `TOOL_DETAILS`, `NAME_MAX`, `DESC_MAX`, `NAME_RE`, `Accent` — Building blocks condivisi per le pagine "create" (skill, agent): picker modello accent-aware, autocomplete tools, hint, counter, validazione nome, hook keybinding (⌘↵/Esc). **Split in due file**: il `.tsx` esporta solo componenti, tutto il resto sta in `formKit.ts` — `react-refresh/only-export-components` (ora errore in CI via `--max-warnings 0`) non tollera export non-componente in un file di componenti
- **`DeleteSessionDialog.tsx`** — Dialog di conferma per cancellare una sessione + artefatti. Carica l'inventario via `useSessionArtifacts` (IPC `sessions:getArtifacts`) e mostra una checklist: transcript `.jsonl` (locked, sempre incluso), sub-agenti e task (default ON), piani globali condivisi (default OFF, con "referenced by N sessions"); `title` su ogni riga = path completo in hover. Conferma → `useDeleteSession`. **La richiesta porta `required`** per ogni path (il transcript `locked` è l'unico required), e il dialog **legge la risposta invece di presumerla**: con `succeeded: false` — il transcript è ancora su disco, quindi la sessione esiste ancora — resta aperto sul **report degli esiti** (una riga per path: `deleted` / `already gone` / `refused` / `still there` col motivo), non registra `session_deleted` e non naviga, offrendo **Try again**; se il transcript è andato ma un artefatto **opzionale** no, la sessione è contata come cancellata e il report elenca ciò che è rimasto indietro, chiuso dall'utente con **Done** invece di portarlo via da quello che c'è scritto. Prima ogni chiamata IPC risolta valeva successo: `deleteSessionArtifacts` è best-effort per voce e i suoi `warnings` non venivano guardati, quindi l'app dichiarava cancellata una sessione ancora su disco (#193). Coperto da `test/delete-session-dialog.test.tsx`. Usato da `chat/ChatView` (TopBar) e da `overview/ProjectOverviewContent` (riga sessione)
- **`DeleteProjectDialog.tsx`** — Conferma di cancellazione dello **stato Claude Code di un progetto**. Il piano non è ricostruito dal renderer: è l'output di `claude project purge --dry-run` (IPC `projects:planPurge` → `useProjectPurgePlan`, `staleTime: 0` — è il preventivo che si sta approvando, non una cache), con i **progetti del piano elencati uno per riga e nominati** (il `detail` di una riga progetto è la costante `project transcripts (.jsonl) and memory/`: raggruppare su quello nascondeva N progetti dietro il path del primo — #224; il raggruppamento ora vale solo per le voci il cui detail portava un id variabile, cioè i sidecar per-sessione, che restano contati). Conferma → `usePurgeProject` (`-y`). Protezioni: **blocca** (non avvisa soltanto) se una sessione è viva su quel cwd — il CLI cancellerebbe file che un altro CLI sta scrivendo — ma solo per le entry `source: 'registry'`, quelle che il CLI stesso ha scritto in `~/.claude/sessions/<pid>.json` e che portano un `sessionId`; una entry `process-scan` (il fallback legacy che indovina da `ps`, senza `sessionId`) scende ad **avviso non bloccante**, e in entrambi i casi il dialog **nomina** ciò su cui blocca (`pid · id · status`) invece di stampare un conteggio non verificabile — un utente si è visto rifiutare la cancellazione da "2 live" che erano due processi `git` intenti a clonare un repo con "claude" nel nome (vedi `isClaudeCliCommand` in `process-scanner.ts`); ripiega sull'**output grezzo** se il piano non è interpretabile, così non si conferma mai una lista vuota; e dichiara cosa **resta** (sorgenti, `.claude/` del repo, teams e plans, che `purge` non copre). Coperto da `test/delete-project-dialog.test.tsx`. **blocca e nomina un piano che tocca più di un progetto** (`claude project purge <path>` agisce su tutto il sottoalbero di `<path>` — verificato di nuovo su CLI 2.1.240 — e non esiste un flag che lo restringa: l'unica risposta sicura è non eseguirlo, elencando i progetti coinvolti e invitando a purgarli singolarmente; lo stesso rifiuto vive in `refusePurge` lato modulo, quindi una UI che dimenticasse il controllo non lo aggira); **blocca anche un piano non interpretabile** (prima l'output grezzo era approvabile: ma il conteggio dei progetti _è_ la protezione, e un piano che non si legge non si conta); e **legge l'esito invece di presumerlo** — solo `status: 'clean'` chiude il dialog, mentre `partial`/`unknown`/`failed`/`refused` restano a schermo col report per-path (cosa è andato, cosa è ancora su disco, l'output della CLI) e un **Try again**: una purge parziale è irreversibile e prima veniva mostrata come banner rosso di fallimento. Ingressi: la sezione **Danger zone** in fondo a `settings/ProjectConfigView` (l'unico visibile) e il bottone "Remove current" nella status bar di `SearchPopover`, entrambi dietro `PROJECT_PURGE_ENABLED` (`shared/project-purge.ts`) — **spento in v2.2.13, riacceso con i guardrail di #224**; ingresso verificato da `test/project-purge-entrypoints.test.tsx`, storia completa nel commento del flag

---

### `chat/` — Rendering sessioni chat

- **`utils.ts`** → `buildProcessedMessages`, `buildRenderItems`, `buildRenderRows`, `buildRowIndexByTurn`, `correlateSessionAgents`, `resolveToolIcon`, `stripLineNumbers`, `fileExt`, `parseMemoryFrontmatter`, tipi `ToolGroup`, `ProcessedMessage`, `RenderItem`, `RenderRow`, `SessionAgent`, `ChatDetailsFilter` — Pre-processing messaggi raw: abbina `tool_use` + `tool_result` per ID; rimuove messaggi utente con soli tool_result; `correlateSessionAgents` collega ogni dispatch `Task`/`Agent` al suo transcript subagent per prefisso-prompt. `buildRenderRows` risolve ogni riga dello stream (key stabile, `turnN`, `isContinuation`) **in anticipo**, così il transcript può essere finestrato: `isContinuation` era derivato camminando i vicini in ordine di render, cosa che richiede tutte le righe montate
- **`highlights.ts`** → `Highlight`, `HighlightColor`, `HIGHLIGHT_COLORS`, `blockKey`, `isPersistableMessageUuid`, `rangeFromOffsets`, `textOffsetWithin`, `fencedCodeRanges`, `wrapHighlightsWithSentinels`, `materializeHighlightSentinels`, `exportHighlightCss` — **Highlight persistenti** del testo chat (vista Lens). Modulo puro: tipi + colori (4 tinte: amber/green/blue/pink), utility di range DOM (offset misurati nello spazio del **testo renderizzato** di un singolo blocco, NON nel markdown grezzo; `textOffsetWithin` misura via `Range`, così un endpoint su element node — triple-click / bordo blocco — resta corretto) e injection per l'export. L'export rilocalizza ogni highlight per **quote letterale** nel markdown grezzo e lo wrappa in `<mark>` via sentinel PUA (``-``, sopravvivono a `escapeHtml`/regex inline); un quote non trovato (markdown inline nella selezione) è **saltato** col testo intatto (soft-degrade). `skipFencedCode` (solo export **Markdown**): un highlight che cade in un fenced code block è saltato — un `<mark>` dentro un fence ``` stamperebbe letterale; l'export **HTML/PDF** omette il flag (il `<mark>` in `<pre><code>` rende bene, codice evidenziato resta a schermo e in PDF). `isPersistableMessageUuid` esclude gli uuid sintetici (`__pending_user__`, la bolla ottimistica live) dall'ancoraggio, così non restano highlight orfani dopo il reconcile. Highlight **sovrapposti** in export: il cursore di ricerca avanza oltre l'**inizio** del match (non la fine), così il secondo highlight si localizza comunque, e gli span vengono **clampati** per non annidarsi (il primo colore vince la regione comune, il secondo prende il resto — nessun highlight perso). I prompt **utente** in export HTML/PDF sono resi **verbatim** (escape + `<br>`, niente markdown), come la vista live (`<p>` plain); il testo assistant resta markdown. Le **formule math** in export sono rese come **MathML nativo** (`markdownToHtml` usa remark-math + rehype-katex con `output:'mathml'`: niente CSS/font KaTeX da spedire — Chromium/PDF e browser moderni lo rendono). `locateQuoteInRaw` tollera i whitespace del raw (skip dopo `q>0`) e i `$` (delimitatori math), così si rilocalizzano sia gli highlight **multi-paragrafo** di solo testo sia quelli che attraversano una **formula inline** (`$…$`): per questi ultimi la cattura salva `exportQuote` — come `quote` ma con ogni formula sostituita dal suo **TeX** (dall'annotation MathML, via `buildExportQuote`) — e l'export lo preferisce a `quote`. Lo span localizzato è poi spezzato per-blocco da `inlineRuns` (split sui blank line; scarta i segmenti display-math `$$…$$`/fenced che non possono portare un `<mark>` inline) → una coppia di sentinel **per paragrafo**, così un `<mark>` non scavalca mai un confine di blocco (HTML valido). Le formule **inline** finiscono dentro il `<mark>`; le formule **display** (block) sono rese (MathML) ma **non colorate** in export (un `<mark>` inline non può avvolgere un blocco) — i paragrafi attorno sì. Highlight vincolati a un **singolo blocco di testo del messaggio** per design
- **`useHighlights.ts`** → `useHighlights`, `NewHighlight`, `HighlightsApi` — Store disk-backed (via `usePersistentState` → `~/.claudelens/preferences.json`, key `cl-highlights`, registrata in `prefsBackend` KEY_EVENTS) degli highlight per-sessione (`Record<sessionId, Highlight[]>`). Add/remove/recolor con read-modify-write sul valore fresco
- **`useHighlightLayer.tsx`** → `useHighlightLayer`, `ToolbarState`, `ToolbarPlacement` — Layer di interazione + painting. Cattura `mouseup` (selezione testo → toolbar create, solo se start ed end condividono lo stesso `[data-hl-block]`; la selezione **può attraversare più paragrafi/formule** dentro quel blocco — il vincolo a singolo paragrafo è stato rimosso) e `click` (hit-test via `caretRangeFromPoint` su un highlight esistente → toolbar edit/remove). Dipinge con la **CSS Custom Highlight API** (`CSS.highlights` + `::highlight()`, Ranges, **zero mutazione DOM** → non litiga con react-markdown); un `MutationObserver` ri-dipinge quando il transcript cambia (toggle filtri/densità, remount markdown). Stale-skip: un Range il cui testo non combacia più col `quote` non viene dipinto. Sospeso quando un overlay copre il transcript (`enabled`) **o** quando la Custom Highlight API non è disponibile (niente listener → niente toolbar che promette qualcosa di non dipingibile). Il `quote` è catturato da `range.toString()` (non `sel.toString()`): così cattura offset, ridipintura e stale-check misurano il testo **nello stesso spazio** (`textContent`), il che fa funzionare gli highlight che attraversano formule **KaTeX** (il gemello MathML nascosto è incluso in modo coerente; `sel.toString()` lo scartava, disallineando il quote). Se la selezione tocca una formula, la cattura salva anche `exportQuote` (`buildExportQuote`: il range con le `.katex` sostituite dal loro TeX sorgente) per la rilocalizzazione in export. Le formule dentro un highlight sono dipinte come **box piena** (classe `cl-hl-formula-<color>` sull'elemento `.katex`, via `formulaIntervalsWithin` + `textSegmentsExcluding`) ed **escluse** dai range della Highlight API: il paint per-glifo lascerebbe buchi nel layout matematico (kerning/frazioni/pedici). L'export rilocalizza per quote letterale e fa soft-degrade quando non lo trova nel markdown (es. attraverso una formula). Nota: il costruttore DOM `Highlight` collide col tipo modello → quest'ultimo è aliasato `TextHighlight`
- **`HighlightToolbar.tsx`** — Barra flottante (portal su `<body>`) con gli swatch dei 4 colori + (in edit) il bottone rimuovi. `onMouseDown` preventDefault per non perdere la selezione nativa prima del pick. Separata dal layer per la regola fast-refresh (un file = solo componenti)
- **`useAutoScroll.ts`** → `useChatAutoScroll` — Hook di bottom-pinning del feed chat: un ResizeObserver sulla colonna transcript ri-pinna a **ogni** crescita di contenuto (token, tool card che si espandono, run collassate che crescono, toggle Min/Full, reflow tardivi) finché l'utente è ancorato al fondo. Pin **istantanei** (mai smooth: gli eventi che generano atterrano esattamente al fondo e non vengono riletti come "utente scrollato via"); sgancio su scroll-up (wheel-up immediato, scrollbar/tastiera oltre soglia 200px), ri-aggancio tornando sotto soglia; l'attach via ref callback pinna in sincrono al (re)mount della colonna, così la chat si apre già in fondo. Espone `followRef` per gli effetti fratelli (toggle densità). Usato da `ChatView` e `LiveChatView`
- **`atoms.tsx`** → `PathChip`, `UrlChip`, `SectionLabel`, `CodeBlock`, `LiveInTerminalBadge` — UI atoms per il rendering degli input/output tool + badge TopBar "Live in terminal" (condiviso da `ChatView`/`LiveChatView`). `UrlChip` è la sorgente web nella stessa forma che `PathChip` dà a un file (host in evidenza, path a seguire) ed è un **link vero**: `window.open` → `setWindowOpenHandler` del main → `shell.openExternal`, mai dentro il renderer; solo `http(s)`, così un `file:`/`javascript:` resta testo inerte
- **`fileIcons.tsx`** → `FileIcon` — Logo file reali (devicon-plain monocromatici via `unplugin-icons`, `~icons/devicon-plain/*`): estensione → logo linguaggio (tsx/jsx→ts/js, scss→css3, ecc.), fallback a glifo documento generico. `currentColor` → seguono tema + tinta categoria. Usato dai chip file in `MessageBubble` (footer turno minimal)
- **`ToolDetailPanel.tsx`** — Pannello fullscreen dettaglio tool: rendering specifico per Read, Write, Edit, Bash, Grep, Glob, Agent, operazioni memoria, **WebFetch/WebSearch**. Per i due tool web il titolo della pagina è la **sorgente** (page label / query, la stessa della riga in Mission Control) e non il nome del tool: input = `UrlChip` cliccabile + la richiesta di estrazione come prosa (prima era un `JSON.stringify` con l'URL non cliccabile), output = markdown (una pagina fetchata **è** prosa: era l'unico output dell'app reso come sorgente in un `CodeBlock`), e la nota di **redirect** resa come avviso warn — il tool non ha restituito la pagina, dirlo è il punto. Le fonti di una ricerca sono una **bibliografia** (`SearchSources` → classi `.cl-src` in index.css): ordinale · titolo · **filetto puntinato** · host, cioè il device che l'app già usa per "label … valore" (righe Settings, righe sessione), non una pila di card bordate. **Una riga per fonte, titolo troncato**: il wrap a due righe è stato provato e si rompe — un leader flex parte dopo il _box_ del titolo, non dopo la sua ultima riga, quindi una riga andata a capo lascia i puntini sospesi a metà del vuoto (titolo capped al 62% perché anche con un host corto resti un tratto di puntini leggibile; titolo intero nel tooltip). La freccia ↗ è nascosta fino all'hover ma tiene il suo spazio, come le azioni delle righe sessione. Il caption conta **anche i domini** (`8 results · 6 domains`): è la metà a costo zero del raggruppamento per host — dice se una ricerca ha attinto a sei fonti o letto sei volte lo stesso sito. Con quella testata, `WebSearch` entra in `ownsOutputHead` (`shell.ts`): un `Output · 47 lines` sopra `SOURCES` sarebbe un secondo titolo per lo stesso blocco. Il predicato resta name-only e i call site scrivono `!ownsOutputHead(name) || result.isError`, così un risultato **fallito** conserva la sua etichetta "Error", che nessun body disegna da sé; l'instradamento verso `CommandOutput`è passato al nuovo`isShellOutput`, che è la domanda che stava davvero facendo
- **`web.ts`** → `webHost`, `webPageLabel`, `webCanonicalUrl`, `parseWebSearchResult`, `parseRedirectNotice`, `parseHttpFailure`, `webOutcome`, `WEB_TOOLS` — **Modulo puro** (unit-tested in `test/web.test.ts`) dei payload dei due tool web, condiviso dalla specie WEB di Mission Control e dal `ToolDetailPanel`. Regole verificate su 75 chiamate reali: il fallimento ha **quattro forme e solo una alza `is_error`** — la notifica `REDIRECT DETECTED:` (il tool NON restituisce la pagina, la considera un successo sarebbe una bugia), `Web search error:` dentro un risultato altrimenti sano (la ricerca non è mai partita) e la **risposta HTTP raccontata in prosa** (`The server returned HTTP 403 Forbidden.` + ~200 byte di consiglio al posto della pagina, `is_error` non alzato): su 73 fetch reali sono 7 (403 ×4, 404 ×3), e il rail le chiamava `FETCHED` mentre nessuna pagina era tornata. Il target di un redirect è letto **attraverso il qualificatore** che le CLI recenti inseriscono (`Redirect URL (from the server's Location header — …): <url>`); ancorare su `Redirect URL:` nudo lasciava `to` a null e la riga diceva REDIRECT senza dire dove — entrambe le grafie convivono nei transcript. Un risultato di ricerca è tre cose in una stringa (eco della query · array JSON `Links:` su una riga sola · sintesi · `REMINDER:` scritto per l'harness): solo le due centrali sono contenuto. `webCanonicalUrl` è la **chiave d'aggregazione**: il fragment cade (`…/settings#plugin-settings` è la stessa pagina di `…/settings` — il server non lo vede nemmeno; caso reale che produceva due righe indistinguibili), la query string no
- **`shell.ts`** → `parseShellCommand`, `splitPipeline`, `normalizeOutput`, `promptRows`, `ownsToolBody`, `ownsOutputHead`, tipi `ShellStep`/`PromptRow`/`ParsedShellCommand` — **Modulo puro** (unit-tested in `test/shell.test.ts`) del rendering shell. `parseShellCommand` decide **dove un one-liner può essere tagliato**: uno scanner con stato di quoting (`'`/`"`/backtick), profondità `$(…)`/`{…}` e memoria dell'ultimo carattere non-spazio taglia sugli operatori top-level (`;`, `&&`, `||`, `&`, newline) — quest'ultima serve a distinguere `2>&1`/`>&2`/`&>log` (redirezioni) da un `&` di background, che era il modo più facile di spezzare un comando a metà. Un comando **multi-riga** o con **heredoc** non viene toccato (`mode: 'script'`, le righe dell'autore sono il modello). Le pipeline si spezzano in stage solo sopra i 72 caratteri: sotto, una riga sola si legge meglio di due. `promptRows` traduce il parse in righe da leggere: **un solo `❯`** (i prompt veri della run) e ogni continuazione aperta dal connettivo che la governa (`&&`/`||`/`|`), col `;` silenzioso (per la shell è la riga nuova stessa) e `&` come suffisso. `normalizeOutput` rende stampabile l'output registrato — via le sequenze ANSI (un comando che credeva di avere un tty) e ogni run di `\r` collassato a ciò che il terminale avrebbe lasciato a schermo (barre di progresso: una riga, non mille). `ownsToolBody` è il seam che tiene **comando e output come una cosa sola**: per Bash la card e la detail page non stampano né la sezione Input né la sezione Result, perché `CommandSheet` le rende dentro la stessa finestra di terminale; `ownsOutputHead` copre il solo lato risultato (`BashOutput`, la lettura di una shell in background)
- **`CommandBlock.tsx`** → `CommandSheet`, `CommandBlock`, `CommandOutput` — La run di shell resa come **la finestra di terminale che era**: barra del titolo (semafori macOS + titolo centrato `bash — 5 steps` + azioni), le righe di prompt, l'output subito sotto, e una striscia di stato in fondo (`● 24 lines`, `no output`, `running`, errore in danger). `CommandSheet` (usata da `ToolGroupCard` e `ToolDetailPanel`) tiene comando e output **nella stessa finestra**; `CommandBlock` (senza risultato, quindi senza striscia di stato: dire "running" di un comando in attesa di approvazione sarebbe falso) sta nel dialog dei permessi; `CommandOutput` copre `BashOutput`. Due iterazioni editoriali precedenti — finta finestra macOS con semafori finti, poi sezioni COMMAND/OUTPUT su carta — sono state scartate dall'utente: le etichette erano l'unica cosa che diceva che si trattava di una shell, cosa che un glifo di prompt dice meglio. **La superficie è dark fissa in entrambi i temi**, con gli stessi valori dei code fence markdown della chat (`.prose-lens .cl-md-code`): il codice si vede uguale in tutta l'app e la palette highlight.js (github-dark-dimmed, importata globalmente) è tarata proprio per quel fondo — per questo i pannelli **non** portano `.cl-code-pre`, il cui remap serve alle superfici di carta. **Un solo `❯` per run** (`promptRows` in `shell.ts`, unit-tested): il comando è stato battuto a un prompt solo, e un glifo per statement inventava prompt mai esistiti. Ogni riga di continuazione è **aperta dal connettivo che la governa** (`&&`/`||` in accent, il `|` degli stage di pipeline in grigio), non chiusa da quello della riga precedente, dove l'occhio è già andato via; il `;` non stampa nulla — per la shell è la riga nuova stessa — e `&` resta suffisso della riga che manda in background. **Niente wrapping** (una riga di shell a capo si legge come prosa e perde la forma, una riga di log perde le colonne): il body scorre in orizzontale con comando e output **su un solo scroller**, come scorre una sessione — un gutter sticky galleggerebbe sopra l'output. L'output è clampato a 22 righe con dissolvenza + "Show all N lines" (mai uno scroller verticale annidato in un transcript che già scrolla) e ⤢ apre la stessa finestra **a tutto schermo** (portal, z-index 999 come `.cl-run-agent-*`, Esc/backdrop per chiudere), dimensionata sul contenuto fino a 92vh e con l'output non clampato; lì il titolo diventa la description e il comando resta per contesto anche in densità MIN
- **`ToolGroupCard.tsx`** — Card compatta che mostra una coppia `tool_use` + `tool_result`; per i tool che portano una head propria (`ownsInputHead`/`ownsOutputHead` in `shell.ts`) non stampa i titoli di sezione Input/Result
- **`MessageBubble.tsx`** → `ThinkingBlock`, `MessageBubble` — Singolo messaggio con testo, thinking espandibile, tool cards
- **`SubagentTranscriptPanel.tsx`** — Overlay col transcript interno completo di un sub-agente (`useSubagentTranscript`), reso con la stessa pipeline `buildProcessedMessages`+`MessageBubble`; ToolDetailPanel annidato per i tool interni
- **`ChatComposer.tsx`** — Barra in basso al layout Focus — **componente puramente presentazionale**: tutto lo stato della conversazione (subscription IPC, turno in volo, coda permessi, transcript) vive in `useLiveChat`; il composer possiede solo ciò che appartiene all'input: il draft, l'**autocomplete slash command** (popover `cl-slash-menu` sul draft `/token`, lista da `useEffectiveConfig(realPath).init.slashCommands`, nav ↑/↓/Enter/Tab/Esc; l'invio è nativo — l'Agent SDK esegue un `/comando` nel prompt), i due **selettori** della meta-row (`ComposerSelect`: **Model** — id ereditato dalla prop `model` + alias Sonnet/Opus/Haiku + Default, valore derivato con `chosenModel` null = segui la prop — e **Permission** `default`/`acceptEdits`/`plan`/`bypassPermissions`, quest'ultimo `danger`), e il **`SendConfirmDialog`** pre-invio per i modi rischiosi (`CONFIRM_MODES` = solo `bypassPermissions`, consenso ricordato in `confirmedMode`). Send → `onSend(text, { model, permissionMode })` verso l'owner; Stop → `onStop`; `lockNotice` (settata da `LiveChatView` quando la sessione è viva nel terminale) disabilita input+Send e mostra il messaggio sopra la row; la richiesta di permesso in testa alla coda arriva come prop (`permRequest`/`permPendingCount`) ed è risposta via `onRespondPermission` (il dialog resta montato via **portal su `<body>`** così è rispondibile anche col workspace nascosto). `sessionId` presente/assente guida solo il copy (resume vs new). Usato esclusivamente da `LiveChatView`. **Superficie**: un solo **foglio di carta + hairline** (`cl-composer-sheet`), non più vetro — era l'ultimo `backdrop-filter` della superficie chat, rimasto indietro quando la direzione "Nastro" ha portato `cl-pill` e `cl-turns-capsule` a carta opaca. Il **rail dei controlli sta dentro il foglio**, diviso da una hairline: sotto di esso i tre badge sciolti leggevano come decorazioni della pagina, non come impostazioni di quell'input. Send/Stop sono **mono hairline** e prendono l'accento solo quando c'è qualcosa da mandare (uno slab accent pieno che passa la vita al 40% di opacità si legge come rotto, non come "in attesa"); i due picker perdono la pastiglia e diventano bottoni mono nudi con caret, separati da `·` — lo stile borderless è **scopato a `.cl-composer-meta`** perché `AgentsLiveView` riusa `.cl-composer-chip` come pill tra i suoi controlli di dispatch, dove la pastiglia è giusta. Il badge crediti scende da pill accent bordata a **testo con dot** (è un fatto dichiarato, non un controllo: bordato era l'elemento più urlato di una barra piena di comandi veri) e la scorciatoia tastiera vive nel placeholder (`⏎ send · ⇧⏎ newline`), cioè visibile esattamente quando serve. Nota: `.cl-dispatch-card` (Agents Live) dichiara di leggersi "come lo stesso componente" ed è rimasta a vetro — stessa anatomia (prompt + footer diviso da hairline), superficie diversa
- **`PermissionRequestDialog.tsx`** — Dialog overlay (stile `SendConfirmDialog`) mostrato quando l'Agent SDK chiede l'approvazione di un tool via `canUseTool`. Mostra `toolName`, `title`/`displayName`, `description`, e il dettaglio rilevante dell'input (`command` per Bash, `file_path`/`path`, altrimenti JSON); `pendingCount` mostra quante richieste sono in coda dietro questa. Tre azioni: **Allow once** (`{ kind: 'allow' }`), **Always allow** (`{ kind: 'always', suggestions }`, solo se l'SDK fornisce `suggestions`) e **Deny…** (apre un textarea opzionale per il messaggio che Claude vedrà → `{ kind: 'deny', message }`). **`AskUserQuestion` ha un rendering dedicato** (`QuestionForm`): le domande di chiarimento di Claude (`input.questions[]`) come opzioni cliccabili (radio/checkbox per `multiSelect`) + campo "Other…" free-text; Answer risponde `{ kind: 'allow', input: { questions, answers } }` — le risposte viaggiano **dentro l'input approvato** (chiave = testo domanda, valore = label scelte joined ", " o testo libero), perché un Allow pass-through lascerebbe le domande senza risposta; Dismiss = deny. Input malformato → fallback al rendering generico. La decisione torna al main via `respondPermission(requestId, …)`
- **`LiveChatView.tsx`** — Vista **chat SDK in-app** (`View` case `new-chat`): la conversazione live, guidata dallo stream. **Solo rendering**: tutto lo stato vive in `useLiveChat` (vedi riga dedicata) — la vista mostra `displayMessages` (transcript committato + bolla ottimistica + turno in volo) con `MessageBubble` `detailsFilter="minimal"`, un `LiveTurn` finale per il testo parziale / chip "Using X…", i metadati live (costo/token/modello dal `ChatTurnSummary` del `result` SDK) nella TopBar, e il `ChatComposer` presentazionale. **Due ingressi**: nuova conversazione (bottoni "New chat"/"SDK chat" di `ProjectOverviewContent`) o **resume di una sessione esistente** via prop `resumeSession` (azione **"Chat"** sulla riga sessione): il transcript è seedato con una lettura imperativa da disco al mount (mai una query watchata — niente refetch mid-turn), il composer eredita l'ultimo modello della sessione, il primo invio riprende lo stesso `.jsonl`. **Sessione viva nel terminale** (registro, via `useActiveSessions`): il composer è **locked** (`lockNotice` — rispondere qui gareggerebbe col CLI sullo stesso transcript), badge "Live in terminal" in TopBar, e il transcript **segue il disco** (`followDisk` di `useLiveChat`) così la conversazione del terminale scorre nella vista; il lock si scioglie da solo quando la sessione terminale finisce (il CLI aggiorna il registro all'uscita → push del watcher). Il registro esclude le sessioni SDK → la chat non si auto-locka mai. Keyed in `ProjectOverview` per `resumeSession.filename ?? 'new'`. **Trade-off voluti**: niente export/highlights durante la chat (riapri la sessione read-only in `ChatView`)
- **`useLiveChat.ts`** — **Hook: unico owner dello stato della chat SDK live.** Subscription mount-only ai canali `sessions:chat*` (payload a busta col `sessionId` produttore — gli eventi di una sessione non propria, es. il `chatDone` finale di una sessione superseded, sono **scartati**; l'id è adottato da `chatStarted`, emesso dal main prima di ogni evento stream), stato del turno in volo (`streamText`/`liveMessages`/`liveTool`/`permQueue`), transcript committato + bolla ottimistica (commit a `chatDone` leggendo i **ref interni** — niente hop cross-component che era il punto dove una risposta appena streamata poteva perdersi), azioni `send` (startMessage/sendMessage + rollback su fallimento pre-turno), `stop` (interrupt nativo), `respondPermission` (FIFO), `endChat` allo smontaggio. Modalità **resume** opzionale: seed del transcript da disco (`getChat` imperativo) + `sessionId` noto up front; con `followDisk` (sessione viva nel terminale, composer locked) il seed è ri-eseguito sugli eventi `data:changed` (debounce, mai con un turno in volo — `pendingRef` guard), così la vista segue il CLI finché non termina
- **`icons.tsx`** → `TrashGlyph`, `ChevronUpGlyph`, `DockCaretGlyph`, `LocateGlyph`, `NarrateGlyph` — Glyph SVG inline (stroke `currentColor`) usati da pill e dock sheets
- **`LiveTurn.tsx`** — Turno assistant provvisorio mostrato durante lo streaming SDK (testo parziale + caret, o chip col tool in preparazione/esecuzione). Mirrora il markup `cl-turn--claude`. Usato da `LiveChatView` (la chat live; `ChatView` read-only non ha più turni in volo). Il chip stampa la **`description` della chiamata** quando c'è (`thought`, da `pendingToolThought`): `Show recent commits · Bash 3s` invece di `Using Bash`, che era l'affermazione vera più generica disponibile. Arriva un messaggio dopo l'inizio della chiamata — `ToolActivity` è emesso a `content_block_start`, prima che l'input abbia streamato — quindi il chip apre sul nome del tool e guadagna la frase poco dopo; il fallback non è uno stato degradato ma il testo onesto per una chiamata che non porta nota (ogni Read/Edit/Write, e quasi tutti i tool che non siano Bash). **Non** è dietro il toggle della narrazione: quella preferenza nasconde la riga di commento, una superficie aggiunta da noi, mentre questo è un chip che esisteva già e dice la cosa più vera che può — e la chat live non ha una pill da cui riaccenderlo
- **`thoughts.ts`** → `Thought`, `thoughtOf`, `dwellMs`, `collectThoughts`, `enqueue`, `advance`, `pendingToolThought`, `emptyQueue`, `THOUGHT_MAX`, `PENDING_MAX` — **Modulo puro** (unit-tested in `test/thoughts.test.ts`) del **commento in corsa**: la frase che Claude scrive per ogni chiamata (`input.description`) letta come narrazione. Vedi la sezione dedicata sotto per il perché di ogni regola
- **`useThoughtStream.ts`** — **Hook: una frase alla volta, temporizzata per la lettura.** La sorgente sono i `messages` che il chiamante ha già (la lettura watcher-driven del Lens, lo stream della chat live) — nessuna IPC e nessun watcher in più. La **coda vive in un ref e a renderizzare è l'orologio**: lo stato React è solo la frase a schermo e l'unico posto che la scrive è la callback del timer (`pump`). Non è un aggiramento della regola `react-hooks/set-state-in-effect` ma la forma onesta della cosa — una riga temporizzata è un sistema esterno con un clock, e questo hook lo pilota e lo ascolta; derivarla dai `messages` con un `setState` nel corpo dell'effect avrebbe anche ri-renderizzato a ogni raffica del watcher di una sessione che non aveva niente da dire. `until` è **assoluto**: l'effect ri-gira a ogni append, e re-armare il timer deve re-armare lo **stesso** istante, altrimenti una sessione attiva congelerebbe una frase a schermo (coperto da `test/thought-stream.test.tsx`, l'unico test che cade se la scadenza diventa relativa)
- **`ThoughtLine.tsx`** — La riga di commento, resa da `ChatControlPill` **dentro `.cl-pill-wrap`** e posizionata in assoluto sopra di esso. Il posto **è** il progetto: erediterebbe — ed eredita — ogni offset di fondo che il wrap già porta (Lens nudo, composer, composer locked) senza ridichiararne uno, sta fuori dal flusso quindi non può allargare la pill su cui galleggia (il wrap è `align-items: stretch`: una frase da 58 caratteri come figlio flex la stirerebbe), e cade dentro il padding che la colonna di lettura riserva già sotto il transcript — quindi non copre nessun turno e non muove niente. Iniettarla nel transcript non è mai stata un'opzione: quella lista è finestrata con misura per riga e bottom-pinned, e righe effimere litigherebbero con entrambi
- **`FocusMinimap.tsx`** — Minimap a filo del layout Focus (`cl-focus-rail`): un dot proporzionale per turno-messaggio, ruler adattivo (spacing/anelli scalano con la densità misurata via ResizeObserver), label in hover, scroll-spy
- **`ChatControlPill.tsx`** — Pill flottante glass (`cl-pill`) coi controlli del transcript: filtri per tipo + toggle densità Min/Full, **agent dock** + **skill dock** (`AgentDockSheet`/`SkillDockSheet` + orb cluster), e lo sheet Export/Delete. Alza **un solo sheet alla volta** (`'agents' | 'skills' | 'export'`); registra un opener imperativo (`openExportRef`) per il bottone export per-turno. Estratto da `ChatView`. Ospita anche il **commento in corsa**: la `ThoughtLine` sopra il wrap e il toggle `Notes` (`.cl-pill-narrate`, `NarrateGlyph`) tra la densità e i dock. Il toggle compare **solo se `onToggleThoughts` è passato**, cosa che `ChatView` fa soltanto per una sessione viva nel registro: un controllo permanente per qualcosa che non può mai parlare è un controllo per niente
- **`useTranscriptModel.ts`** → `useTranscriptModel`, `TranscriptModel` — **Hook: derivazione del transcript Focus.** Da `processed` + `detailsFilter` + resolver tinta agent ricava `descriptors`/`visibleItems`/`minimapItems`/`renderItems`/`rows`/`rowIndexByTurn`/`filterCounts` (tutto memoizzato; la logica pesante — `buildRenderItems`/`buildRenderRows`/`computeFilterCounts` — è in `utils.ts`, unit-tested). `rows` sono le righe già risolte che il virtualizer itera, `rowIndexByTurn` traduce numero di turno → indice di riga per lo scroll
- **`ChatView.tsx`** — **Viewer read-only, disk-backed** di una sessione esistente — layout **"Focus"** (`cl-chat-workspace--focus`). `displayMessages = messages` (il read di `useChatSession`, memoizzato per stabilità referenziale), watcher-driven; **niente composer, niente stream** — la chat SDK live è una vista separata (`LiveChatView`) che non legge mai il disco. La derivazione del transcript è in `useTranscriptModel`, pill/minimap nei rispettivi file. Solo `TopBar` (back + titolo + toggle Chat/Timeline + tag + badge **"Live in terminal"** se la sessione è viva nel registro; il vecchio bottone "Continue chat" è stato rimosso — l'ingresso alla chat SDK è l'azione **"Chat"** sulla riga sessione, che apre direttamente `LiveChatView` in resume mode) sopra una **colonna di lettura centrata** (`cl-chat-reading`, ~820px). Il linguaggio visivo della superficie di lettura è la variante **"Nastro"** (design handoff _Lens variants_, sostituisce le "isole di vetro"): niente card e niente vetro — ogni turno è un **pallino di ruolo da 9px appeso a un filo verticale** (`.cl-turn-spine`, riabilitato con extra specificità perché ogni riga virtualizzata è figlio unico e il `:last-child` di base lo spegnerebbe ovunque), il corpo poggia sulla carta e si chiude con una **riga sottile allineata alla colonna di testo**; i tool scendono a **chip inline che vanno a capo** (`cl-tool-stack` in flex-wrap; un chip aperto — o che porta la striscia d'errore collassata, via `:has()` — si prende l'intera riga per avere spazio al pannello input/result); il codice inline perde la pastiglia. Un **turno di continuazione** (assistant senza testo dopo un altro assistant) non ha né pallino né riga: il filo lo attraversa intero, così una sequenza di turni tool-only in densità Full non diventa una scaletta di filetti. `.cl-transcript-inner` in `cl-chat-reading` ha `gap: 0` — il ritmo lo dà il padding del corpo, e un gap flex spezzerebbe il filo nella live chat (il transcript finestrato posiziona le righe in assoluto e il gap non lo vede). Coerentemente, `cl-pill` e `cl-turns-capsule` sono passate da vetro a **carta opaca + hairline**. La **Mission Control rail** (`terminal/MissionRail.tsx`) è andata oltre Nastro fino al design **1d · Feed**: niente più blocchi per specie, un solo **flusso cronologico** di eventi con le sezioni demolite a **filtri** (vedi il doc del componente). I due numeri della riga vitals (context %, spend) sono **hover target** che fanno scendere una readout card (`terminal/VitalsPopover.tsx`): recuperano i dati che i vecchi blocchi CONTEXT WINDOW / SPEND stampavano fissi (`used · left · total`, `cache −$x · y% saved`, rimasti per una release come `title` nativi) e ci aggiungono la **composizione** — cache read / fresh input / cache write per il contesto, il mix di token per la spesa — come part-of-whole su rampa monocroma accent (`color-mix` contro `--cl-paper`, così la scala si inverte da sola nel tema dark). Le card sono `pointer-events: none` (non contengono controlli: catturare il cursore le terrebbe aperte dopo che il puntatore ha lasciato il numero) e i trigger sono `tabIndex`+`onFocus`, così il secondo livello è raggiungibile da tastiera. È chrome condivisa con la vista Terminal: cambia anche lì, di proposito — le due metà di Mission Control devono leggersi come una superficie sola. La riga vitals è anche **l'unico posto** dove la spesa della sessione è stampata: la `TopBar` di `TerminalMissionControl` portava lo stesso `fmtCost` a poche centinaia di pixel di distanza, e due copie della stessa cifra si leggono come due letture diverse — lì resta solo l'indicatore RUNNING. Col rail collassato la cifra non è a schermo (è dentro il rail, un toggle di distanza). I controlli vivono nella **pill flottante** (`ChatControlPill` → `cl-pill`): filtri per tipo (All/Tools/Thinking/Questions/Plan) + toggle densità Min/Full + **agent/skill dock** + sheet Export/Delete (alza **un solo sheet alla volta**). Transcript a **tutta larghezza** + **minimap a filo** a destra (`FocusMinimap` → `cl-focus-rail`, dot per turno, scroll-spy). La lista è **finestrata** (`@tanstack/react-virtual`): solo le righe attorno al viewport sono montate, con misura dinamica per riga (`measureElement` — le altezze dipendono dal contenuto) dentro un sizer `.cl-vlist` alto quanto l'intera sessione, così scrollbar, bottom-pinning e minimap continuano a vedere tutto il transcript. Conseguenze progettuali: `isContinuation` è pre-derivato in `buildRenderRows` (niente lookahead sui vicini), lo **scroll-spy legge la geometria del virtualizer** invece di un IntersectionObserver sui nodi montati, `jumpToTurn` usa `scrollToIndex` (e sgancia il bottom-pinning, altrimenti la misura successiva riporterebbe in fondo) e un cambio di densità **non** azzera le misure: `rowVirtualizer.measure()` sembra corretto (lo stesso turno ha altezze diverse in MIN e FULL) ma manda la posizione di lettura a spasso — collassa la lista sulle stime e l'ancoraggio finisce per essere calcolato su un layout inesistente. Le righe montate si rimisurano da sole e quelle sopra il viewport, tenendo la dimensione precedente, tengono ferme le offset; le sole mai visitate restano approssimate finché non entrano in vista. Per la stessa ragione **non** si usa `anchorTo: 'end'`: questo feed ha già un'ancora di fondo (il pin di `useAutoScroll`) e le due inseguono coordinate diverse — il DOM, che include i 140px di padding sotto la lista, contro `getTotalSize()`. Il `content-visibility: auto` su `.cl-transcript-inner > .cl-turn` resta ai transcript non finestrati (live chat, pannello sub-agente) e **non deve** raggiungere le righe virtualizzate: una riga fuori schermo riporterebbe `contain-intrinsic-size` invece dell'altezza reale. Trade-off accettati: ricerca nativa del browser e selezione testo attraverso righe smontate non funzionano; gli highlight fuori finestra vengono ridipinti quando la riga rientra (il MutationObserver di `useHighlightLayer`). Mantiene tutte le affordance di lettura: export, highlights, timeline (`SessionGraphView`), tag, delete, transcript sub-agente. Overlay `ToolDetailPanel`/`SubagentTranscriptPanel` (e Timeline) **non smontano il workspace**: resta montato nascosto (`chatHidden` → `display:none`) per preservare scroll/highlight-layer/scroll-spy quando l'overlay si chiude (al ritorno un view anchored è ri-pinnato dal ResizeObserver, uno detached torna al turno attivo). `ChatView` è **keyed per `session.filename`** in `ProjectOverview`. `embedded` (Terminal/Lens) è un sotto-caso di chrome (niente TopBar/minimap)

**Il commento in corsa — la frase che Claude scrive per ogni azione** (issue
#236; modello puro in `chat/thoughts.ts`, ritmo in `useThoughtStream`, riga in
`ThoughtLine`, chip in `LiveTurn`). Ogni `tool_use` può portare una
`description`: una frase breve scritta dal modello per quella chiamata
specifica (`Show recent commits and changed files`, `Read live-monitor
module`). È l'**unico resoconto in lingua parlata** che una sessione produce, e
finora l'app la rendeva come riga grigia dentro una card tool — visibile solo in
densità FULL e solo se eri scrollato lì (`ToolGroupCard.tsx:41`) — oppure per
niente (il chip live diceva `Using Bash`). Tutte le regole sono misurate su 59
transcript reali, 38 progetti, 1358 chiamate non-sidechain:

- **Solo `description` è un pensiero.** Il 47% delle chiamate ne porta una, e la
  copertura è `Bash` 82%, `Agent` 100%, **zero** per Read/Edit/Write/Glob/Grep e
  ogni tool MCP osservato (su questo progetto sale al 92,9%, ma perché è una
  storia fatta di `Bash`). I silenzi sono quindi strutturali, e la risposta a un
  silenzio è **non dire niente**: derivare una frase da `command` o `file_path`
  sarebbe `toolArg` travestito, e tenere a schermo la frase precedente mentre la
  sessione è andata avanti afferma una cosa falsa. Nota che è la priorità
  **opposta** a `toolArg` in `session-tails.ts`, che mette `command` per primo di
  proposito — una cella del Monitor risponde a "cosa sta eseguendo", questa a
  "per farci cosa".
- **Il ritmo lo detta la lunghezza.** Il 13% delle chiamate descritte
  consecutive arriva a meno di 2s l'una dall'altra (il 29% sotto i 4s), più
  veloce di quanto chiunque legga, mentre il gap mediano è 7,3s. Quindi
  `dwellMs` = `clamp(1200ms + 55ms × caratteri, 1600, 4200)`: 55ms/carattere è
  deliberatamente più lento della lettura di prosa (~20 caratteri/s) perché
  questa riga si legge con la coda dell'occhio, mentre l'attenzione è sul
  transcript. Le frasi misurano p50 31 caratteri, p90 48, max 71 — `THOUGHT_MAX`
  (96) taglia solo un caso patologico.
- **Un arretrato si scarta, non si smaltisce.** Con una coda svuotata in ordine
  la riga resterebbe indietro rispetto alla sessione della somma dei propri
  dwell, e su una raffica finirebbe a narrare lavoro concluso venti secondi
  prima — peggio del buco che riempie, perché chi guarda sta guardando la
  sessione, non leggendo un log. `enqueue` tiene **le più recenti** e scarta le
  più vecchie in attesa (`PENDING_MAX` = 2), e non conta a schermo quelle
  scartate: il transcript è il registro, e un `+3` accanto a una frase è un
  numero su cui nessuno può agire.
- **Niente replay.** Il taglio è il momento in cui l'hook ha iniziato a
  osservare, non l'inizio della sessione: il Lens rilegge l'intero file a ogni
  raffica del watcher, e senza taglio ogni rilettura sarebbe una nuova recita
  della stessa sessione. Una chiamata che non si riesce a datare non è una
  notizia. È la stessa decisione del cursore del Monitor che parte da EOF.
- **Niente arretrato mentre è nascosta.** Con la narrazione spenta il diff gira
  comunque, così le chiamate passate nel frattempo sono marcate narrate e
  riaccendere la riga riparte dal presente invece di srotolare il perduto.
- **Non si chiama "thinking" da nessuna parte nella UI.** L'app rende già i
  blocchi `thinking` veri (`ThinkingBlock`), e questi sono un'altra cosa: la
  descrizione di un'azione, non il ragionamento del modello. Confondere i due
  nomi peggiorerebbe entrambi — da cui l'etichetta `Notes` sul toggle.

Lo stato del toggle vive in `useThoughtsShown` (`cl-thoughts-hidden`, chiave
registrata in `prefsBackend`): il flag su disco è il **negativo**, così una
preferenza assente — installazione fresca, o build precedente alla feature —
si legge come accesa, che è il default per cui la riga è progettata (non costa
layout e non dice niente quando non c'è niente da dire). Coperto da
`test/thoughts.test.ts` (26 claim sul modello puro) e
`test/thought-stream.test.tsx` (10 sul ritmo: replay, dwell, raffica, spento,
scadenza assoluta, teardown). La **pill e il wiring di `ChatView` non hanno
copertura automatica**, coerentemente con la posizione del repo sul layout.

**Chrome del tool detail — quanto spazio prendeva per non dire niente.** Un tool
aperto dal rail di Mission Control aveva **quattro barre impilate** prima della
prima riga di contenuto (~242px: `TopBar` 52 + striscia tag/toggle 46 + `ViewTabs`
40 + inset 12 + breadcrumb 52 + padding/kicker 39) e **114px di gutter a sinistra**
su una colonna centrale di ~900px. Tre interventi, tutti sul costo, nessuno sul
linguaggio:

- **Una sola riga di controlli.** La striscia che ospitava `+ tag` e i due toggle
  è stata assorbita dallo slot `right` di `ViewTabs` (griglia a 3 colonne: le tab
  restano centrate sulla colonna anche con molti tag, che in un flex semplice le
  avrebbero spinte fuori asse). Il cluster destro è `overflow: hidden` +
  `justify-end`, così l'eccedenza cade dall'**inizio** e i controlli sopravvivono
  invece di mandare la barra a due righe.
- **Hero adattivo** (`ToolDetailShell`). Il kicker `TOOL DETAIL` è sparito ovunque
  (la breadcrumb nomina già il tool) e lo status `Complete`/`Error`/`Pending`
  è salito **nella breadcrumb**, dove sta accanto a ciò che qualifica invece di
  tenersi una riga di hero per un chip. L'hero sopravvive solo quando il titolo
  **aggiunge** qualcosa al nome del tool — una query, una pagina, la descrizione
  di un agente: per `Edit`/`Read`/`Bash` la pagina diceva la stessa parola quattro
  volte (barra, kicker, titolo, sottotitolo) su ~110px, e lì la barra **è** la
  testata. Stesso predicato (`addsToName`, confronto senza spazi né case) decide
  se stampare il sottotitolo in barra: `Web search` sotto `WEBSEARCH` è la stessa
  parola due volte, `Tool execution` sotto `EDIT` no.
- **Niente spina, un solo cap.** Il gutter da 88px e la hairline verticale a 56px
  rimavano col filo del transcript (`.cl-transcript-inner::before`), ma in un
  overlay senza transcript sotto non allineavano nulla: gutter simmetrico a 44px
  e `.cl-tool-detail-grid` portata da `max-width: 980` a **1180**, la stessa
  dell'hero — con due cap diversi il filetto sotto il titolo sporgeva di 100px per
  lato oltre i bordi dei pannelli.

**Chi possiede il ritorno — un solo "Back" a schermo.** I pannelli di dettaglio
disegnavano un `Back to chat` proprio, che atterrava una riga sotto il `← Back`
della `TopBar`: **due frecce con due destinazioni diverse, impilate**. Ora il
ritorno è del **frame**, e ogni pannello aperto da esso è `chromeless`
(`ToolDetailPanel`, `SubagentTranscriptPanel`, `EntityDetailView` → Skill/Agent,
`TeamDetailView`): niente barra propria, −52px e una hairline in meno. Tre
affordance, tutte nella chrome che già esiste:

- **la freccia della TopBar, che cammina lo stack**: con un dettaglio aperto
  torna alla sessione (`Back to session` / `Back to chat`), e solo dalla sessione
  esce verso il progetto (`Back` / `Sessions`). La label dichiara sempre quale
  passo, così non va indovinato;
- **il crumb** (`PERSONAL / <sessione> / 🔍 WEBSEARCH`): il crumb della sessione
  è lo stesso passo indietro per la mano che è già lassù (`Crumb.onClick` in
  `shared/TopBar.tsx`, che lo rende `<button>`), e l'accento "sei qui" passa al
  crumb del dettaglio;
- **la ✕** (`shared/CloseOverlayButton.tsx`) in coda alla riga dei controlli,
  sagomata come i toggle di colonna che le stanno accanto;
- **Esc**, che il frame già gestiva.

**Perché la freccia cammina lo stack** (e non "esce sempre dalla sessione", com'è
stato per una revisione): finché ogni pannello disegnava il proprio `Back to
chat` sotto di essa, una freccia che usciva dalla sessione era difendibile —
c'erano due frecce, una per passo. Rimasta **l'unica freccia a schermo**, l'unica
cosa che può fare è tornare indietro di un passo: uscire dalla sessione da dentro
un tool salta un livello e atterra nell'overview, che è esattamente il bug che
questa revisione ha prodotto e poi corretto.

Conseguenze da conoscere:

- **Un tool aperto dal transcript embedded viene issato al frame**
  (`ChatView` prop `onOpenTool` → overlay `{kind:'tool'}` di
  `TerminalMissionControl`, lo stesso percorso di skill e agent). Senza,
  il pannello si monterebbe dentro una `ChatView` la cui `TopBar` non è a
  schermo, e la barra sopra non saprebbe di doverlo crumbare. `ChatView`
  standalone continua ad aprirlo in casa (lì la `TopBar` è sua): un solo
  `openTool` interno instrada card inline, session graph e output di skill.
- **Lo status del tool** (`Complete`/`Error`/`Pending`) è ora letto in due
  superfici — il pannello e il frame che lo ospita — quindi il verdetto vive in
  una funzione pura condivisa, `toolRunStatus` in `chat/utils.ts`
  (unit-tested): un risultato assente è `Pending`, mai un successo.
- **`chromeless` è onorato solo se la barra non porta azioni**: in
  `EntityDetailView` la TopBar ospita Save/Discard/Delete/Duplicate/Run, quindi
  la soppressione è gated da `barHasActions` — in read-only (l'unico caso in
  overlay) il right slot è vuoto e la barra è pura navigazione. `TeamDetailView`
  invece **conserva** il suo segmented Overview/Swimlanes spostandolo nel corpo:
  è un controllo della vista, non navigazione.
- **I tag di sessione spariscono dalla riga dei controlli mentre un dettaglio è
  aperto**: appartengono alla sessione dietro, non all'unità a schermo, e quello
  spazio ora porta lo status e la ✕.
- In `ChatView` standalone la stessa regola vale per il **transcript di un
  sub-agente** (crumb `AGENT · <tipo>`, pannello `chromeless`). **Embedded no**:
  lì un transcript di sub-agente non viene issato al frame — solo i tool lo sono
  — quindi il pannello tiene il suo bottone, perché nulla sopra sa che è aperto.

**Mission Control — la specie WEB** (`terminal/mission-feed.ts` → `buildWebActivity`,
righe `W` in tinta `--cl-haiku`, la stessa che `TOOL_TINT` dà ai due tool web nel
transcript; filtro omonimo tra MEMORY e CHANGES). Era l'unico lavoro che il feed
non vedeva: una sessione di ricerca poteva tirare dieci pagine e cinque ricerche
e il rail restava vuoto tranne i file scritti dopo — le **fonti** di una risposta
invisibili, e un fetch mai atterrato invisibile due volte. Decisioni, tutte prese
sui transcript reali:

- **L'unità è la pagina, o la query** — una riga per URL distinto e per query
  distinta, con le chiamate ripetute aggregate come `buildFileChanges` aggrega gli
  edit di un file (`×N` nella meta, disclosure espandibile). Due fetch della stessa
  pagina sono la stessa fonte letta due volte, di solito chiedendole cose diverse:
  per questo la disclosure porta **la richiesta** di ogni chiamata (`webItemNote`)
  e non due volte il nome del tool, che è l'unica cosa che condividono. Due pagine
  dello stesso host restano invece due fonti.
- **Il titolo è la fonte, la meta dice da dove** — page label + host per un fetch
  (come nome file + area per un CHANGES), la query intera + i **primi due host dei
  risultati** (`+N` per il resto) per una ricerca: la domanda vera davanti a una
  ricerca è da dove viene la risposta.
- **Lo stato a destra è onesto sul fallimento**: `FETCHED` / `N LINKS` /
  `REDIRECT` (warn — la pagina **non** è stata letta) / `FAILED` (danger, include
  i fallimenti che `is_error` non marca: la ricerca mai partita e la risposta
  HTTP raccontata in prosa, con lo status — `HTTP 403 Forbidden` — come meta
  della riga) / `PENDING` (chiamata senza risultato su
  disco; non dice "adesso", che il transcript non può provare). Precedenza per
  lettura riuscita: un URL redirezionato una volta e letto poi è `FETCHED`.
- **L'URL intero e la richiesta stanno nel tooltip** (`FeedEvent.hint`, terza riga
  del `title` nativo): in un rail da 380px il titolo tronca, e la fonte esatta
  deve restare recuperabile senza aprire nulla.
- Non può vedere, per costruzione: i fetch di un **sub-agente** (vivono nel suo
  transcript sidechain, l'ingresso è la riga AGENTS) e le pagine tirate via shell
  o via tool MCP del browser — nessuno dei due porta un `url` leggibile.

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

- **`utils.ts`** → `extractHeadings`, `parseMemoryContent`, `readingTime`, `formatDate`, `SidebarLabel`, `SidebarRow` — Parser markdown per TOC + metadata topic; helper UI sidebar
- **`MemoryTopicView.tsx`** — Vista singolo topic sulla **superficie unificata `EntityDetailView`** (stessa firma/props di prima): view (hero + tape Type/Reading/Words/Links + body markdown + Properties `type` + blocco Metadata) ed edit strutturato (description + `type` select obbligatorio + body) con Save/Delete. `serializeMemory` → `parseTopicInput` → `useUpdateTopic` (il file è riscritto canonicamente da `memory-writer`). I **managed tags** (`useMemoryTags`, store namespaced — NON frontmatter) sono resi via slot `viewExtras`/`editExtras` con `ManagedTagChip`+`TagPicker`; **origin session** (link alla chat) e date nel blocco Metadata. Memory project-level (`isProjectLevel`) → read-only (no edit/delete), ma i tag restano editabili (metadata d'app)

> La lista dei topic della vista `project-memory` è renderizzata da `ProjectView` (`overview/ProjectOverviewContent.tsx`, `section === 'memory'`) con `cl-tile-grid`/`cl-tile`, allineata a Skills/Agents.

**Seconda lente sulla stessa lista — il grafo delle relazioni** (toggle `List`/`Graph` nella testata della subtab, stato `memLayout` locale alla vista). Le memorie **già contengono** `[[wikilink]]` scritti a mano nel body: nessuno li leggeva, e sono l'unico segnale di relazione che qualcuno ha davvero affermato. Il modello è puro in `memory/graph.ts` e **non costa I/O** — `MemoryData.topics` porta già il contenuto di ogni topic al renderer, quindi è una regex su testo in memoria.

- **`graph.ts`** → `buildMemoryGraph`, `layoutMemoryGraph`, `neighborhoodOf`, `nodeRadius`, `graphLabel`, tipi — Modello puro: risoluzione wikilink → `links`, community detection → `clusters`, affinità di parole → `affinities`, layout deterministico a isole. Unit-tested (`test/memory-graph.test.ts`) + sonda sugli archivi reali (`test/memory-graph-real.test.ts`)
- **`MemoryGraphView.tsx`** — La mappa: un'isola per cluster, hub al centro, hover card dopo 420ms. Nessuna freccia (vedi sotto)
- **`MemoryOrbit.tsx`** — Il vicinato della memoria aperta, montato in `viewExtras` del suo detail: orbita interna = relazione diretta, esterna = secondo grado. Qui **le frecce ci sono**
- **`MemoryPeekCard.tsx`** → `MemoryPeekCard`, `PeekAnchor` — Card di hover in portal su `<body>`, `pointer-events: none` come le `VitalsPopover`: titolo intero (sulla mappa è troncato a 24 char), descrizione, `cited by N · cites N · cluster`

Decisioni prese sui dati veri, non a priori:

- **I `[[wikilink]]` sono gli archi, la somiglianza di parole no.** Il keyword matching sugli stessi 33 topic di ClaudeLens dava 41 archi su 25 nodi a soglia bassa (la nuvola indistinta) e ~55% di precisione a soglia alta. Vive separato in `affinities` — reso **tratteggiato**, mai promosso a link: scrivere una relazione resta un gesto esplicito nel file, la vista non scrive mai su disco. Le stopword includono il vocabolario di dominio in **italiano e inglese** (`progetto`, `memoria`, …): senza, accoppiavano `duplicate_merge` con `icloud_dataless` per pura ripetizione.
- **I cluster sono comunità per modularità (Louvain), non componenti connesse.** Le componenti connesse separano solo ciò che è del tutto scollegato: su SARA2.0 (43 memorie, **1,91 archi per nodo**) un solo arco fra due temi fondeva tutto in **un'isola da 39 nodi** — l'hairball che `feedback_dataviz_principles` vieta — mentre ClaudeLens (0,85) sembrava a posto. Con la modularità: SARA2.0 → 10 gruppi nominabili, 71% degli archi interni; ClaudeLens → 7 gruppi, 86%.
- **L'ordine di visita è canonico, non quello di arrivo.** I topic vengono da un `readdir`, il cui ordine non è garantito fra filesystem, e la fase locale di Louvain dipende dalla sequenza: permutando l'input la partizione cambiava su 2 archivi su 6. Ordinare nodi, candidati, archi, affinità (coppie normalizzate) e `nodes` rende il grafo **funzione del solo contenuto** — la garanzia che rende la mappa imparabile a memoria.
- **Le isole sono ordinate per affinità reciproca** (greedy: si accoda quella con più archi verso le già collocate), e gli archi **fra** gruppi sono smorzati a 0.16: il ~30% che attraversa resta leggibile in hover ma smette di coprire la struttura.
- **Frecce solo nell'orbita.** Su una mappa d'insieme il verso di decine di archi è rumore e il diametro del nodo già codifica `inDeg`; davanti a **una** memoria la domanda è invece "è una fonte o una conseguenza?".
- **Le memorie senza alcun link stanno in una fascia dichiarata in fondo** ("NO RELATIONS YET"), come debito di connessione. Una memoria _collegata_ non ci finisce mai: da lì i suoi archi attraverserebbero la mappa contraddicendo l'etichetta.
- I `[[link]]` che puntano fuori (moduli di codice, es. `[[subagents-reader]]`) sono contati come `dangling` e dichiarati in legenda invece di sparire.

**Secondo ingresso — Mission Control:** il rail (`terminal/MissionRail.tsx`) porta l'**attività di memoria della sessione** — topic letti, creati, revisionati, **estratti da CHANGES** — come specie **MEMORY** del suo event feed (una riga per topic, filtro omonimo). Il modello dati è puro e unit-tested in `chat/utils.ts` (`buildMemoryActivity` → `MemoryTouch[]` + `indexOps`, con `memoryScopeOf`/`memoryTypeFromFilename`/`memoryTitleFromFilename`/`writeAction`; test in `test/chat-utils.test.ts`). Ragioni delle scelte, tutte verificate sui transcript reali:

- **L'unità è il topic, non il file.** Su disco ricordare un fatto è sempre `Write` di `<slug>.md` **più** `Edit` di `MEMORY.md`: dentro una lista di file diventavano due righe di bookkeeping (`feedback_x.md +12 −0`, `MEMORY.md +1 −1`) che non dicevano mai _cosa_ è stato ricordato. Le operazioni sull'indice degradano a una nota `index MEMORY.md` in coda al blocco; i file di memoria sono esclusi da CHANGES (`isMemoryFile`) per non contarli due volte nei totali di riga
- **Le letture stanno qui.** Un `Read` su un topic è l'unica traccia visibile di quali memorie hanno informato la sessione. Il recall automatico **non** è visibile: arriva come `<system-reminder>` e non passa da nessun tool (come una `rm` da `Bash`, che non porta `file_path`)
- **`new` vs `revised` si legge dal tool result** (`File created successfully at:` vs `has been updated`), l'unico posto che lo dice; quando non lo dice l'azione resta `wrote` invece di mentire. Un `Write` batte un `Edit` successivo nel rank (`new > revised > wrote > read`), i topic mutati flottano sopra quelli solo letti
- **Una riga per topic, niente description in riga.** Il `name` di una memoria è spesso già una frase: stampare nome + description raddoppiava lo stesso fatto. La description vive nel tooltip con il path; niente diff bar (`+12/−0` su una memoria non misura nulla di interessante) — la riga porta `consulted`/`remembered` (+ `repo`, + `×N`) come meta e l'azione (NEW/REVISED/WROTE/READ) come stato a destra. Per un `Edit` (che non porta frontmatter) nome/description/tipo arrivano dall'indice su disco via `useMemoryProject`, con fallback sul prefisso del filename — la regola di `memory-reader`
- Il tag di tipo usa `MEMORY_TYPE_TAG`/`MEMORY_TYPE_TINT` (`chat/utils.ts`): le stesse tinte di `MEMORY_TYPE_STYLE` mappate sui token brand (`--cl-cyan`/`--cl-warn`/`--cl-ok`/`--cl-violet`), encoding di una dimensione dato come `modelColor`, non un accento nuovo

---

### `claudemd/`

- **`GlobalClaudeMdView.tsx`** → `GlobalClaudeMdView`, `ProjectClaudeMdView` — Wrapper detail per CLAUDE.md (global e per-layer) via `EntityDetailView`: edit mono-colonna (nessun frontmatter) + delete (`claudeMd:deleteGlobal`/`deleteFile`)

---

### `skills/`

- **`SkillDetailView.tsx`** — Wrapper che costruisce la `EntityConfig` skill (opzioni frontmatter editabili strutturate, `serializeSkill`) e delega a `EntityDetailView`. Supporta edit + delete (rimuove la cartella `skills/<name>/` se vuota)
- **`CreateSkillPage.tsx`** — Pagina dedicata per creare una nuova skill (globale o di progetto); on save torna alla lista
- **`GlobalSkillsView.tsx`** — Lista skill globali con ricerca e navigazione al detail

---

### `agents/`

- **`AgentDetailView.tsx`** — Wrapper che costruisce la `EntityConfig` agent (`AGENT_OPTION_DEFS`, `serializeAgent`, tape Scope/Model/Color/Status, validation) e delega a `EntityDetailView`. Supporta edit + delete + Run agent
- **`RunAgentDialog.tsx`** — Dialog di dispatch background agent (overlay passato a `EntityDetailView` via `renderRunOverlay`)
- **`CreateAgentPage.tsx`** — Pagina dedicata per creare un nuovo agent (globale o di progetto); on save torna alla lista
- **`GlobalAgentsView.tsx`** — Lista agent globali

---

### `mcp/`

- **`McpServerCard.tsx`** → `McpServerCard`, `mcpServiceColor`, `mcpServiceMeta` — Card singolo MCP server (click → `mcp-detail`); colori brand + registry curato categoria/descrizione per servizi noti
- **`GlobalMcpView.tsx`** — Vista lista MCP server (cloud + local); `onSelectServer` apre il dettaglio
- **`McpServerDetailView.tsx`** — Pagina dettaglio singolo server: hero brand, metriche adoption, config locale, liste progetti enabled/disabled

---

### `plugins/`

- **`PluginsView.tsx`** — Vista lista plugin globali (`View` case `plugins`): legge i plugin installati via `usePlugins` (IPC `plugins:getAll`), raggruppati per **marketplace**, tile con descrizione + conteggi (`N skills · N agents · N commands`). Click → `plugin-detail`. Linguaggio editoriale `cl-hero`/`cl-section`/`cl-tile-grid` come `GlobalSkillsView`. Ingresso: tile "Plugins" nella sezione Configuration di `GlobalHomeView`
- **`PluginDetailView.tsx`** — Dettaglio singolo plugin (`View` case `plugin-detail`): hero (nome, marketplace, repo, versione, author) + sezioni Skills / Agents / Commands come tile grid. Apertura di un item gestita con **stato locale** `open` (non casi della View union) che rende inline la detail **read-only**: skill → `SkillDetailView readOnly`, agent → `AgentDetailView readOnly`, command → `EntityDetailView` config `editable:false`/`deletable:false`. Ri-deriva il plugin fresco da `usePlugins` (back interno al plugin via `setOpen(null)`). I plugin sono read-only perché gestiti dal plugin manager

---

### `studio/`

Sezione **Agent Studio** (globale, tab primario nella barra superiore): editor visuale/source dei workflow nativi Claude Code — sia i globali `~/.claude/workflows/*.js` sia i **project-local** `.claude/workflows/*.js` di ogni progetto noto (entrambe location native da cui Claude Code risolve i workflow; le righe project-local portano un badge col nome del progetto e l'editor scrive nel file giusto via `projectPath`). Lo script è l'unica sorgente di verità: nessun manifest ClaudeLens. **Quattro lenti** sullo stesso modello a nodi del parser (`studio-script.ts`): **Brief** (metadati), **Flow** (spina narrativa verticale), **Canvas** (blocchi tipizzati su colonne-fasi + archi data-flow, vedi sotto) e **Script** (sorgente). Brief/Flow/Canvas proiettano step `agent()` (con schema/isolation/label dinamiche), gruppi `parallel`, `pipeline` (stage agent editabili + stage codice verbatim), righe `log` e **code node verbatim** per ogni altro statement — così anche il JS arbitrario resta visibile/editabile come chip di codice e il salvataggio visuale riscrive lo stesso `.js` senza perdita. Le tre viste visuali sono disabilitate se il file non parsa oppure se `meta` contiene JavaScript dinamico (identificatori, spread, chiavi calcolate o dichiarazioni sorelle): questi casi restano source-only per evitare una riscrittura lossy. Le directory workflow project-local vengono osservate anche prima della loro creazione e la lista dei watcher segue il registry progetti. Ogni save visuale/source confronta lo snapshot sorgente originale e rifiuta conflitti esterni; Back e window unload chiedono conferma quando una bozza è dirty. **Atomi condivisi**: i componenti presentazionali (`AgentCard`, `RefChip`, `StepTitle`, `SpineMarker`/`SpineRail`, `CodeNote`, `LogNote`) vivono in `flowAtoms.tsx` e gli helper puri (`modelDot`, `promptExcerpt`, `describeCode`, `stepVarName`, `scanIdentifiers`) in `studioLang.ts`, riusati sia da Flow che da Canvas; le mutazioni del draft (`updateStep`/`addNode`/`moveNode`/`updateNode`/…) restano in `BlueprintEditorView` e sono passate come props a entrambe le viste (nessuno stato duplicato → coerenza Flow↔Canvas garantita).

- **`StudioLibraryView.tsx`** — Lista unica dei workflow globali (`~/.claude/workflows/*.js`) e project-local (`<progetto>/.claude/workflows/*.js`, badge col basename del progetto). Badge VISUAL (solo nodi strutturati), HYBRID (`codeNodeCount>0`), SOURCE (syntax error o `meta` dinamico non round-trippabile); stat row con conteggio Hybrid
- **`CreateBlueprintPage.tsx`** — Crea direttamente un nuovo script workflow nativo con una fase/step seed; nessun artefatto intermedio
- **`BlueprintEditorView.tsx`** — Unica vista per workflow creati nello Studio o esterni. Il Flow è una **spina narrativa** (design scelto tra 3 paradigmi con preview): le card agente sono gli unici elementi grandi — kicker AGENT, nome (label dinamiche rese `write:⟨item.sourcePath⟩`), meta `modello · effort · JSON output`, **prompt leggibile clampato a 2 righe** come frase principale e `→ variabile` in uscita (il dato che scorre lungo la spina); il codice verbatim è demolito a note sottili con etichette derivate in linguaggio piano (`describeCode`: guard "stops early when …", setup, result), espandibili per l'editing; le fasi sono capitoli `PHASE n` + titolo + **detail del meta come sottotitolo editabile**; pipeline = blocco "FOR EACH ITEM IN ⟨items⟩ — one agent per item, in parallel" con card annidata (senza freccia output propria) e stage `then`; parallel = gruppo "IN PARALLEL — N agents at once". Inspector con schema JSON editabile. Header buttons `+ agent` / `+ parallel`. Eyebrow di stato visual/hybrid/source/invalid. Ospita anche la subtab **Canvas** (`canvas/flow/StudioCanvasFlow`) a cui passa `draft`/`selectedStep`/handler
- **`PromptPreview.tsx`** → `PromptPreview` (default) — Anteprima renderizzata del prompt di uno step (usata da `StepInspector`). **Non** usa il `Markdown` condiviso: un prompt è un template literal, e darlo in pasto a un parser markdown lo falsifica — `remark-math` divora i `$` (l'interpolazione finisce in uno `<span class="katex-error">`) e i backtick dei template annidati vengono ri-appaiati, sicché i due rami di un ternario si saldano in una frase sola. Qui ogni `${…}` è **mascherato con un sentinel PUA prima del parsing** (`maskInterpolations` in `studioLang.ts`) e reintrodotto dopo come chip accent col testo verbatim (`maskSegments` + plugin rehype locale, eseguito **prima** di `rehype-highlight` così un sentinel dentro un fence torna testo prima che l'highlighter possa spezzarlo): il markdown vede solo la prosa letterale. Niente math né frontmatter; dentro un blocco di codice l'espressione resta testo, non chip. Coperto end-to-end da `test/studio-prompt-preview.test.ts` (render HTML reale sul prompt di `fix-issue`)
- **`flowAtoms.tsx`** → `AgentCard`, `RefChip`, `StepTitle`, `SpineMarker`, `SpineRail`, `CodeNote`, `LogNote` — Atomi presentazionali della spina Flow, estratti da `BlueprintEditorView` per essere riusati dal Canvas (components-only → nessun warning react-refresh). `AgentCard` accetta `hideRefs` (il Canvas nasconde il footer uses/produces — l'informazione è portata dagli archi). Il footer separa **due specie** di interpolazione: **uses** = riferimenti a dati (`${args}`, `${collect}`, `${picked.number}`), risolti allo step produttore via `refIndex` (`buildRefIndex`/`resolveRef` — id, nome compilato o variabile legata dallo script) e quindi cross-evidenziabili; **computed** = JavaScript che _costruisce_ il testo del prompt (ternari, call, join), che non è una dipendenza dati: chip in forma compatta (`compactExpr`, corpi delle stringhe elisi → `` forcedIssue ? `…` : `…` ``) con l'espressione integrale nel tooltip
- **`canvas/graph.ts`** → `buildGraph`, tipi `CanvasGraph`/`PositionedBlock`/`CanvasEdge`/`NodeRef` — **Modulo puro, unit-tested** (`test/studio-graph.test.ts`): proiezione read-model del Blueprint. Classifica ogni nodo in un blocco tipizzato (`agent`/`parallel`/`foreach`/`guard`/`output`/`setup`/`log`/`code`/`schema` via `describeCode`), deriva gli **archi data-flow** dai `${ref}` dei prompt (id-form) e dagli identificatori dei code node (var-form) e l'**early-exit** guard→output (tratteggiato). I nodi **`log` non ricevono archi**: una riga di progresso interpola gli output ma non consuma nulla — narra lo step che le sta sopra, e il suo arco non faceva che ripetere la dipendenza reale (stesso produttore, stessa label) con una freccia in più. Un **guard legge la sua condizione**, non il payload che restituisce uscendo (`guardCondition`): i valori che il return anticipato si limita a ri-emettere non sono input, e scansionarli disegnerebbe archi lunghi per dipendenze inesistenti — stessa ragione per cui il guard non ha arco verso l'output. Ogni step è indicizzato con **tre chiavi** — id, `stepVarName(id)` e il `resultVar` letto dal parser: negli script nativi scritti a mano label e variabile divergono di norma (`label: 'pick-issue'` → `const picked`) e ogni consumatore usa la variabile, quindi senza la terza chiave l'agente produttore apparirebbe un vicolo cieco. **Schema**: il segnale è l'**opzione `schema:` dell'agente**, non la forma con cui è scritta — ogni step che la porta (top-level, membro `parallel`, stage `pipeline`) genera un blocco **`schema`** collegato al suo blocco consumatore da un arco **`schema`** dedicato (tratteggio accent, segue il toggle data-flow). Una sola specie di card, identica sulla UI; cambia solo **da dove si legge la definizione**: (a) `schema: X_SCHEMA` con il `const X_SCHEMA = {…}` dichiarato nello script → la card **è** quel code node (promosso da `setup`/`code`, `nodeRef` intatto → editor che riscrive il `const`), condivisa da tutti i consumatori (l'1-a-molti resta visibile: una card, N archi); (b) literal scritto sulla call → card satellite (`nodeRef: null`, `schemaOwnerStepId`/`schemaOwnerBlockId`) ancorata sotto il suo agente, editata sullo step via `updateStep`; (c) nome che lo script non dichiara (import, valore calcolato, o forma che lo scan non legge) → card satellite comunque presente col nome referenziato, senza modello, con rimando allo Script. Dedup per chiave (nome del const, oppure `literal@<stepId>`), così due agenti sullo stesso const non duplicano la card. Niente pill schema sulla card agente. Layout deterministico a colonne-fasi (`x = indice fase`, `y = ordine sorgente`; preamble = colonna 0 "Setup"). `parallel`/`foreach` restano **un** blocco contenitore (niente hairball). Genera un blocco OUTPUT sintetico (auto-return) quando manca un `return` esplicito. L'**OUTPUT non riceve archi**: un return finale compone quasi tutto il flusso, quindi la pill **dichiara** i produttori che compone (`returnTokens`) invece di tirare una linea attraverso ogni colonna per dire ciò che "terminale" già dice
- **`canvas/flow/StudioCanvasFlow.tsx`** → `StudioCanvasFlow` — Orchestratore della quarta lente (edizione **React Flow**): il viewport (pan/zoom/fit) è di React Flow, i blocchi tipizzati sono nodi custom (`flow/BlockNode`, riusa `CanvasBlock`), gli archi derivano da `flow/toFlow` e il layout da ELK (`flow/layout`). L'ordine verticale dentro ogni fase è sempre quello dello script (ELK può allineare ma non scambiare i nodi); gli archi Bézier scelgono gli handle dalle posizioni React Flow finali, quindi restano coerenti dopo layout e drag senza perdere il tratto morbido. Il comando **Re-layout** ripristina il layout automatico. Selezione condivisa via `flow/selection` context; `selectedStep` è condiviso con Flow, `selectedBlockId` resta locale e hover evidenzia gli archi. Monta le due sidebar (`CanvasSidebar`). **Inspector destro ridimensionabile**: maniglia sul bordo sinistro (drag, clamp 320→`min(900, finestra−480)`, larghezza persistita in `localStorage['cl-studio-inspector-width']`)
- **`canvas/CanvasBlock.tsx`** → `CanvasBlock` — Rende un `PositionedBlock` per `kind` (riusa `AgentCard`/`describeCode`); blocco = display + selezione, **tutti gli edit passano dall'inspector destro**. Riusato dai nodi custom di React Flow (`flow/BlockNode`). **Due pesi visivi**, come sulla spina Flow: sono card solo agent/parallel/foreach/schema; il JS verbatim (setup/guard/log/code) è una **riga di annotazione** (`AnnotationRow`, altezza fissa `ROW=44`, superficie piatta, hairline sinistro — warn per il guard): tag + frase in linguaggio piano + metà silenziosa (il valore per il setup, `returns …` per il guard), **una riga con ellissi vera**. È una scelta strutturale, non estetica: un'altezza fissa attorno a sorgente libero può solo tagliare il testo a metà glifo, mentre lo statement completo resta a un hover (`title`) o un click (inspector) di distanza
- **`canvas/CanvasSidebar.tsx`** → `CanvasLeftSidebar`, `CanvasRightInspector`, `CollapsedInspectorRail`, tipi `BlueprintHandlers`/`ViewportToggles` — **Sinistra**: outline fasi (conteggio nodi, reorder, `+ add phase`), palette (`+ agent`/`parallel`/`for-each`/`note` sulla fase attiva), toggle viewport (data-flow/code-setup/fit). **Destra**: inspector contestuale — agent → **`StepInspector` riusato as-is**; foreach → editor items/resultVar/stage; guard/code/output/log → editor verbatim; schema → editor a campi: ricompila il `const` se la card è il nodo dichiarante, altrimenti lo stesso `SchemaBuilder` dell'inspector agente (scrive sullo step via `updateStep`) + link all'agente; nota "edit in Script" quando il nome non è risolvibile; vuoto → summary + checks. Larghezza controllata dall'host via prop `width`/`onResizeStart`/`resizing` (maniglia sul bordo sinistro). Nessuna nuova operazione di scrittura: dispatch via gli stessi `BlueprintHandlers` del Flow

---

### `agents-live/`

- **`AgentsLiveView.tsx`** — Vista dei background/live agent: legge le sessioni agent in corso (`bg-sessions-reader` + `live:*`/`agents:*` IPC), con dispatch/stop/respawn. Click su una sessione → `chat` (con `from: 'agents-live'`)
- **`status.ts`** → `statusOf`, `needsInput`, `isTerminal`, `isFinished`, `isRecurring`, `isWorking`, `stateOutcome`, `parseRespawnFlags`, `primaryFanTask`, `fmtAge`, `projectHashFromTranscript`, `transcriptFilename`, `TERMINAL_BUCKETS`, `UNSTARTED_NEEDS` — **Modulo puro** (unit-tested in `test/agents-live-status.test.ts`) che decide in che bucket sta un job. Era una funzione dentro il componente e una **nostra congettura**, e la congettura metteva il bucket a priorità massima su `state === 'blocked'`. È il campo sbagliato: estratti dal bundle 2.1.263, i predicati della CLI sono `Cr` (needs-input) = `!zo(t) && t.tempo === 'blocked' && t.needs !== 'send a prompt to start'`, `zo` (finito) = `Hs(t) && !(successo && ricorrente)`, `Hs` (terminale) = `stato terminale && tempo !== 'active'`. Quindi **`tempo` dice cosa un job sta facendo, `state` è un nome di esito**; `state === 'blocked'` sopravvive nella CLI solo come `TNe`, un test di respawn-eligibility nel percorso di auto-resume. Quattro bug in uno:

  - **needs-input** era acceso da `state`, che **si incastra**: dopo che l'utente ha risposto a una domanda il job resta `blocked` per tutto il resto del turno mentre lavora, e la riga stampava `detail` — cioè il messaggio dell'utente stesso — come se fosse la domanda. Verificato dal vivo due volte, contro il TUI che nello stesso momento contava `0 awaiting input`. Ora il sottotitolo di una riga in attesa è `needs`, la richiesta vera, e `detail` non è mai spacciato per una domanda;
  - `tempo === 'thinking'` e `'busy'` erano **rami morti** (i valori sono `idle|active|blocked`), quindi un job che lavorava cadeva nel fallback e leggeva **Ready**; e `fan` — il lavoro in volo accanto al turno — non era letto affatto, benché `inFlight.tasks` valga 0 proprio mentre una shell del fan gira;
  - un `state` terminale è terminale **solo se `tempo !== 'active'`**: un job ripreso che porta ancora `done` lavora, non è completato;
  - un job **ricorrente** (`routine`/`selfWake`/`session_cron`/intent `/loop`) che è riuscito non è finito — si risveglierà — quindi resta nella lista viva con l'etichetta `Scheduled` invece di essere archiviato per sempre. Un ricorrente **fallito** invece finisce: solo un successo è una corsa che si ripete.

  `hasPendingQuestion` è deliberatamente **fuori** dal verdetto: una domanda senza risposta arriva come `tempo: 'blocked'`, e mettere al comando del bucket più urgente un campo che non abbiamo mai visto scritto è esattamente l'errore che questo modulo corregge. Il modulo porta anche ciò che la riga può finalmente dire — `parseRespawnFlags` (modello · permission mode · effort; un flag senza valore legge assente invece di mangiarsi il successivo), `primaryFanTask` + `fmtAge` (il task in volo da più tempo, cioè quello di cui uno stallo parla; uno stamp inutilizzabile stampa stringa vuota, mai `NaN`) e `projectHashFromTranscript`/`transcriptFilename`, che aprono la chat dal path autoritativo scritto nello state file invece di indovinare l'hash dal cwd. I token si stampano, i dollari no: il supervisor riporta un totale unico senza split input/output/cache

---

### `monitor/` — Cosa sta girando adesso

Tab globale **Monitor** (`View` case `monitor`), accanto ad Agent View. Non è un
secondo Agent View, e la distinzione è nel modello dati prima che nella UI: Agent
View legge il **roster dei job** (`~/.claude/jobs` + `daemon/roster.json`), cioè
tutto ciò che hai dispatchato — per la maggior parte finito o addormentato — con i
controlli per agirci; il Monitor legge il **registro dei processi**
(`~/.claude/sessions/<pid>.json`) più il **tail dei transcript**. Un background
agent **vivo** compare anche qui (è un processo claude che consuma token), ma come
cella che **instrada** ad Agent View: dispatch/stop/respawn restano in un posto
solo — il Monitor osserva.

- **`MonitorView.tsx`** — Due livelli: una **band a tutta larghezza** per ogni processo bloccato, una **griglia a hairline** (`.cl-mxcell`) per tutti gli altri. Join di due hook per `sessionId`: `useActiveSessions` (il registro: busy/waiting + `waitingFor`) e `useSessionActivity` (il digest del tail: azione corrente, nastro, contesto, spesa, conteggi)
- **`trace.ts`** → `buildRibbon`, `RIBBON_SPAN_MS`, `RIBBON_CELLS`, `RIBBON_WINDOW` — Modulo puro del **ribbon**: dai `TraceMark` ricava le corse di blocchi tinti per tool su un asse di 2,5 minuti. La finestra è tagliata in `RIBBON_CELLS` celle, ogni mark cade nella cella del suo `at` e le celle contigue dello stesso tool collassano in **un** blocco (un retry loop = un blocco lungo). Scarta la prosa (niente tool → niente tinta), scarta i mark fuori finestra invece di clamparli (incluso lo skew di clock) e non disegna mai un blocco sotto lo 0,9%

**Cinque forme, e le prime quattro sono l'argomento per la quinta.** Sono state
bocciate una griglia di card **scure** e poi una **lavagna** scura di corsie a
tutta larghezza, per la stessa ragione strutturale: una superficie scura larga
che regge cinque stringhe corte è vuota per costruzione, e sulla carta calda di
questa app una lastra nera legge anche come corpo estraneo. Niente in un processo
lo rende un terminale — quell'analogia era presa in prestito ed è costata due
iterazioni. La terza forma è stata la **index card della memoria** (`.cl-mcard`)
su carta; la quarta ne ha reso **fissa l'anatomia** (stessa altezza per tutte, il
rack finalmente con una linea di base).

**Quinta forma — design handoff _Monitor Variants_, opzione 2b: il livello lo dà
la costruzione, non il bordo.** La card uniforme aveva risolto il rack ma
affermava anche che una sessione che **aspetta te** e una che sta editando un
file sono la stessa taglia di notizia — cioè l'unica cosa che questa pagina
esiste per negare, e per questo la card bloccata aveva bisogno di un bordo accent
da 1.5px per farsi leggere per prima. Ora:

- **chi è bloccato è una band scura a tutta larghezza** (`.cl-mxband`, `oklch(0.205
0.008 75)` **fissa in entrambi i temi**, come la cella live della stat strip):
  eyebrow accent pulsante `Needs you · quiet 4m`, **la domanda in display**
  (clamp 19→27px), identità demolita a una riga mono (`progetto · titolo · pid ·
modello · uptime`), e a destra l'**orologio accent** (fino a 52px) sotto
  `BLOCKED FOR` con il bottone d'uscita. È la terza volta che si prova una
  superficie scura ed è la prima che funziona, perché le due che hanno fallito
  l'avevano resa il **default**: qui è l'eccezione, corre da bordo a bordo, e a
  riempirla c'è l'unica stringa della pagina abbastanza lunga da meritare il
  display — la domanda su cui la sessione è ferma. È anche l'unica cosa che pulsa;
- **tutto il resto è una griglia a hairline senza alcun bordo di card**
  (`.cl-mx-grid` a 3 colonne fisse → 2 → 1; `.cl-mxcell` senza raggio né
  superficie, definita solo dai filetti verso i vicini). Colonne **fisse** e non
  `auto-fill` perché la prima e l'ultima portano il **gutter di pagina**: con
  `auto-fill` non c'è modo di dire "la cella al bordo" e la griglia partirebbe 32px
  dentro rispetto a una testata che parte dal gutter. Il filetto è `border-bottom`
  e non `border-top` — la testata si chiude già con la sua riga d'inchiostro da
  1.5px, e un hairline subito sotto la farebbe leggere sfrangiata; rigare verso il
  basso chiude anche l'ultima riga.

**Il bottone della band dice cosa fa.** Il mock lo etichetta `Reply in terminal
↗`: sarebbe una bugia, perché il prompt aspetta nella shell dell'utente e niente
in questa app può rispondergli. Il bottone apre la sessione (`Open session ↗`) o
instrada ad Agent View per un background agent — la stessa destinazione del click
sulla cella.

**Il nastro testuale è stato sostituito dal ribbon.** La tape a tre righe diceva
cosa la sessione aveva fatto **a parole** (`Edit MonitorView.tsx`, `Bash npm run
typecheck ✕`) e costava alla card quattro righe fisse: sono i 260px d'altezza che
obbligavano il rack a colonne da 340px. 2b spende quell'altezza sulla band e dà a
tutto il resto tre colonne, quindi la storia si comprime in una **corsia**
(`.cl-mx-ribbon`). Decisioni:

- **NOW resta a parole** (`.cl-mx-now`, inset su `paper-2`): è l'unica
  affermazione che il ribbon non può fare — ha forma, non nomi — e resta l'unico
  posto della cella dove un tool è scritto per esteso.
- **La corsia è letta da timestamp veri**, non da una stringa rasterizzata:
  posizione = quando, larghezza = quanto è durata quella corsa di lavoro. Un
  **estremo destro vuoto** è una sessione che non fa niente da quel tanto — la
  domanda "è piantata?" che le tre righe dicevano a parole, detta in forma.
- **La tinta è `TOOL_TINT`**, la codifica dei tool che il transcript già usa: una
  corsia ciano è una sessione che legge, viola una che edita.
- **Una chiamata fallita prende la tinta `danger` invece di quella del suo tool**:
  la tinta risponde a "che tipo di lavoro", e un errore batte quella domanda.
- **La hairline sotto la corsia è ciò che la rende una corsia**: senza, una
  sessione con due chiamate in due minuti non ha niente contro cui essere rada, e
  il vuoto a destra legge come pagina bianca invece che come silenzio.
- **`no transcript to tail` prende il posto della corsia** (background agent),
  perché "non c'è transcript" non è la stessa affermazione di "non ha fatto
  niente" e solo una delle due si risolve aspettando. Una corsia **vuota** dice
  invece l'altra cosa (`nothing in the last 2.5 min`).
- **La prosa non entra nel ribbon**: un mark `text` non ha tool, quindi non ha
  tinta, e un blocco grigio fra due Edit leggerebbe come un tool senza nome.
- Il costo dichiarato: **la storia a parole non c'è più**. Il design stesso la
  offre come passo successivo ("aggiungi il tape di 1e nelle card"), e riportarla
  è aggiungere un blocco alla cella, non rifare la pagina.

**I vitals: le due cose azionabili solo mentre gira.** Il tail leggeva ogni riga
assistant e **scartava `usage`**. Ora il digest porta:

- **CONTEXT** — quanto è pieno il context window, dal prompt del turno più
  recente. È un **livello**, non un totale (ogni lettura sostituisce la
  precedente; sommare i prompt fra turni riporterebbe una finestra parecchie
  volte più piena, dato che il prompt di ogni turno contiene già quello prima). È
  l'unica misura con un **denominatore vero**, quindi l'unica disegnata come gauge
  — una barra contro un tetto inventato sarebbe decorazione travestita da misura.
  Tre bande perché la domanda non è "quanto piena" ma "quanto preoccupato":
  neutra sotto il 75%, `warn` fino al 90%, `danger` sopra — una sessione al 94%
  sta per compattare e perdere fedeltà, ed è l'unica cosa in pagina che puoi
  ancora prevenire adesso.
- **SPEND** — dollari. Nessun tetto, quindi cifra e non barra. `~` davanti quando
  il modello non ha una voce esatta nella tabella prezzi (`spendEstimated`). La
  spesa è **seedata** una volta lato main da un parse completo (cached) del
  transcript, perché il cursore parte da EOF: senza seed una sessione già in corso
  avrebbe riportato il costo degli ultimi turni come totale, e una cifra in denaro
  silenziosamente parziale è peggio di nessuna cifra. Seed fallito → `spend: null`
  → non si stampa niente.
- **Il conteggio dei token non è sulla cella**: i dollari rispondono alla domanda
  che uno si fa davvero, e i token sono lo stesso fatto in un'unità in cui nessuno
  fa budget. Sopravvive **una volta sola**, come totale di macchina in testata
  (`.cl-mxtop-tot`, `$4.50 · 1.2m tokens`), dove smette di essere una seconda copia
  del conto e diventa l'unica lettura di scala della pagina. Entrambe le metà
  spariscono se nessuno le ha riportate — `$0.00 · 0 tokens` accanto a processi
  vivi sarebbe l'unica cifra sbagliata a schermo.
- **La band porta ribbon e vitals anche se il mock non li dà alla sua band**: la
  sessione che stai per sbloccare è proprio quella in cui "quanto è piena la
  finestra" e "quanto è costata" cambiano cosa fai, e la corsia piatta a destra è
  la figura di ciò che `blocked for` dice in cifre.
- Un **background agent non ha vitals né corsia**: il roster non porta né usage né
  conto, e il transcript sidecar che scrive non è di questa pagina. Assenti, non
  zero.

**Al posto dell'hero, un header da console.** `Monitor.` a
`clamp(64px, 9vw, 132px)` erano ~300px verticali sull'unica pagina il cui
soggetto sono i prossimi minuti — e chi è lì ha appena cliccato "Monitor". Al suo
posto (`.cl-mxtop`) un eyebrow + **una frase che cambia**: `1 waiting on you, 2
working`, con le cifre in inchiostro pieno e la clausola che **chiede qualcosa**
in testa e in accento, e all'angolo opposto il totale di macchina. Prosa con
numeri dentro, non una fascia di stat tile: quella fascia è già stata rimossa una
volta da questa pagina perché stampava gli stessi numeri che le celle portano.

L'anatomia della cella, dall'alto: **identità + orologio** (tag di stato,
progetto in display, titolo della conversazione, riga macchina | orologio a
26px), poi la riga **NOW**, poi il **ribbon**, poi i **vitals** divisi da
hairline e ancorati in fondo (`align-self: end`, così i gauge di due vicini
restano sulla stessa linea di pagina).

Altre decisioni:

- **La riga macchina resta sulla cella** anche se il design la tiene per la sola
  band: il pid è ciò che serve per fare `kill`, e un fatto che esiste solo nello
  stato in cui stai già agendo è un fatto che non puoi usare.
- **Il gauge del contesto ha perso l'etichetta `ctx`**: una barra con una
  percentuale accanto dice già cos'è. Resta nel caso `is-none`, dove un trattino
  da solo non nominerebbe niente.
- **Il pid ha un campo suo** nella riga macchina (`pid · modello · up 2h07 ·
./sottocartella`): come suffisso dell'ident era rumore e un titolo lungo se lo
  mangiava dalla coda con l'ellissi. Conseguenza: il fallback quando Claude non ha
  ancora nominato la sessione **non è più il pid** (l'avrebbe detto due volte) ma
  `not named yet`. Il sottopath si stampa **solo se aggiunge qualcosa**
  (`cwdNote`).
- **L'orologio conta dalla transizione di stato** (`statusUpdatedAt`), con
  semantica unica in ogni stato: **da quanto è in questo stato**. Contava
  dall'ultimo append e si azzerava a ogni tool, quindi non rispondeva mai a
  "questo turno sta durando troppo?". Una cella `ended` aggiunge `ago`.
- **Un sub-agente in volo è nominato, e vale come lavoro.** Il tool `Agent` è
  **asincrono** — ack immediato, poi `stop_reason: end_turn` — e il lavoro
  dell'agente vive in un transcript sidecar che il tail salta. Misurato dal vivo
  su 2.1.233: **148 s** senza un append nel transcript principale mentre il
  sidecar accumulava **31 tool call**. La cella diceva `READY · waiting for your
next prompt`. Ora il digest porta `delegates`, la riga NOW stampa il **nome
  dell'agente** (`subagent_type`) e i vitals la sua età (`2m in flight`) al posto
  del silenzio. **Niente conteggio dei suoi tool** — e per la stessa ragione
  **niente suoi token**: `parseTurnUsage` scarta le righe sidechain, altrimenti il
  prompt del sub-agente gonfierebbe la lettura del contesto del padre e
  predirebbe una compattazione che non arriva.
- **`ready` è un'affermazione su DUE sorgenti** (`isReady`): il registry è l'unico
  che sa che una sessione lavora ancora quando il suo transcript tace, il tail è
  l'unico che sa che un turno è finito quando il registry non è stato riscritto da
  allora (`updatedAt` non è un heartbeat). Lo stesso incrocio copre
  `status: 'unknown'` (registry scritto **prima** del primo stato).
- **Il nome del processo non si mostra, il titolo della conversazione sì.** Il
  `name` del registry (`claudelens-b4`) è il progetto più due caratteri casuali.
  Il titolo viene da `{"type":"ai-title"}` nel transcript, letto una volta dalla
  **testa** del file (`readSessionTitle`) perché il cursore parte da EOF.
- **Ordine**: la band viene prima della griglia per costruzione; dentro la
  griglia, prima chi lavora, poi chi è pronto, poi chi ha finito, e a parità di
  stato guida chi è in quello stato da più tempo.
- **Le sessioni finite restano** 10 minuti (`endedAt`), coi loro vitali finali:
  quanto è costata e quanto si era riempita restano la verità su di lei.
- Il silenzio sotto i 10s non si stampa (`QUIET_FLOOR_MS`): è l'intervallo fra due
  tool call, non un segnale. Per una sessione bloccata è detto **nell'eyebrow
  della band**, non nei vitals: quanto tempo è ferma sulla tua risposta non è una
  nota a piè di pagina in grigio da 10px.
- Il ticker da 1s gira **solo se c'è qualcosa da contare** (`cards.length > 0`).

Coperta da `test/monitor-view.test.tsx` (join, stato, ordinamento, ritenzione,
routing degli agent — band inclusa —, riga macchina, sottopath, ribbon e sua
separazione dalla riga NOW, corsia vuota vs assente, totale di macchina in
testata, bande del gauge di contesto, spesa e stima, frase dell'header,
teardown, modello del ribbon).

---

### `sessions/`

- **`TagBar.tsx`** — Barra dei tag di una sessione (lista + add)
- **`TagChip.tsx`** — Chip singolo tag (colore + remove)
- **`TagPicker.tsx`** — Picker per assegnare/creare tag a una sessione
- **`ManagedTagChip.tsx`** — Chip tag + il suo menu azioni (filtra / rimuovi / rinomina / elimina ovunque)
- **`SessionRowMenu.tsx`** — Il kebab "⋯" in coda a una riga sessione e il suo menu portal (Open in chat · Add tag… · Pin/Unpin · Delete). Stato locale al bottone: il rect del trigger è misurato all'apertura e serve sia a posizionare il menu (right-aligned, ribaltato sopra se la riga sta troppo in basso) sia ad ancorare il `TagPicker` che "Add tag" apre. Chiude su Esc, mousedown fuori (il trigger escluso, così il secondo click chiude invece di riaprire) e **scroll** — è `position: fixed` sopra una lista che scorre

L'anatomia del popover (`.cl-menu` / `-head` / `-item` / `-item.danger`) è
**condivisa** con `ManagedTagChip`: si chiamava `.cl-tag-menu` finché i tag erano
l'unico chiamante. Una sola forma per ogni "cosa posso fare con questo?".

---

### `analytics/`

- **`AnalyticsView.tsx`** — Grafici recharts: token stacked bar per giorno, distribuzione modelli pie, messaggi area chart, bucket distribuzione

---

### `ai-assistant/`

- **`AiAssistantView.tsx`** — Terminale-like per eseguire istruzioni AI sul progetto; output markdown in streaming via `electronAPI.ai`

---

### `tasks/`

- **`TasksSection.tsx`** — Subtab "Tasks": legge i task creati da Claude (`~/.claude/tasks/{sessionUUID}/*.json`) via `useProjectTasks`, raggruppati per sessione con badge di stato (pending/in_progress/completed). Click sull'header del gruppo → apre la chat della sessione (`onOpenChat`)

---

### `plans/`

- **`PlansSection.tsx`** — Subtab "Plans": legge i piani referenziati negli attachment `plan_mode`/`plan_mode_exit` delle sessioni e ne legge il markdown dal dir globale `~/.claude/plans/*.md` via `useProjectPlans`, raggruppati per sessione con badge `proposed`/`approved`/`deleted`. Click sul piano → `plan-detail`; click sull'header del gruppo → chat della sessione. In coda un gruppo **Unlinked plans** (`useUnlinkedPlans`, #154): i `.md` della cartella globale che nessuna sessione — di nessun progetto — referenzia. Non essendo di nessuna sessione entrano nella stessa lista piatta sotto un id **sentinella** (`__unlinked__`, data 0): filtri, conteggi e ordinamento restano un percorso solo e il gruppo si ordina in fondo da sé; l'eyebrow non offre "open chat" e dichiara `in ~/.claude/plans, not referenced by any session`. Essendo la lista globale, è la stessa sotto ogni progetto — la chiave di query `['plans:unlinked']` non porta l'hash
- **`PlanDetailView.tsx`** — Vista dettaglio singolo piano: `EntityDetailView` con toggle View/Edit + Save/Delete (edit mono-colonna, nessun frontmatter — il body è l'intero markdown; `serialize` = identità). Save/delete via `markdownFile:write`/`delete` su `~/.claude/plans/*.md`, invalida `plans:project` **e `plans:unlinked`**; il piano fresco è ri-derivato da `useProjectPlans` con fallback su `useUnlinkedPlans` (un piano non collegato non sta in nessun gruppo di sessione: senza fallback resterebbe fermo al contenuto d'apertura dopo un save). Tape status/created/branch + footer filePath; per un piano `unlinked` la cella data si chiama **Modified**, non "Created" — il timestamp è l'mtime del file, non un attachment. I piani vivono globali su disco ma sono linkati al progetto via `planFilePath` nei `.jsonl`

---

### `workflows/`

Subtab "Workflows": mostra i run del **Workflow tool** di Claude Code (orchestrazione multi-agente, es. `/code-review` ad alto effort). L'SDK **non** ha API per i workflow → lo stato del run è letto raw da `workflows-reader.ts` (`workflows:getByProject`/`getRun`) con validazione difensiva stile `sessions-registry-reader`. **Insight chiave:** la session dir che contiene lo state JSON di un run **non è** sempre quella che l'ha lanciato (resume/fork); il reader raggruppa per la session **originante** estratta da `scriptPath`, l'unica il cui `.jsonl` esiste (header→chat) e che l'SDK `getSubagentMessages` sa risolvere per il drill-down del transcript.

- **`utils.ts`** → `fmtDuration`, `statusTone`, `Tone` — Formatter puri condivisi da lista e detail (durata wall-clock; status→tone `ok`/`error`/`muted` con soli token brand esistenti)
- **`WorkflowsSection.tsx`** — Lista dei run via `useProjectWorkflows`, raggruppati per sessione originante. Per run: nome, status pill (token `ok`/`error`/`muted`, nessuna tinta nuova — riusa `--cl-accent`/`--cl-danger`), `args` chip, stat strip (`N agents · N phases · durata · tokens · model`), pill `N agents errored` quando `errorAgentCount>0` (uno `status:completed` può mentire), riga **degradata** tratteggiata per i run orfani (transcript senza state JSON). Click riga → `workflow-detail`; header gruppo → chat/terminale della sessione
- **`WorkflowRunDetailView.tsx`** — Pagina read-only custom (non `EntityDetailView`): `TopBar` + hero (nome, status, `StatChip` agents/errored/phases/durata/tokens/tool calls/model, summary, data), **rail fasi** con agent rows raggruppati per `phaseIndex` (glyph stato ✓/✕, dot colore modello, tokens/tool/durata, `retry N`, `lastToolName`+summary, `error` inline, prompt/result preview espandibili), logs/result/script collassabili (`<details>`), footer `scriptPath`. Click "view transcript →" su un agent → overlay `SubagentTranscriptPanel` (`sessionFilename` = `${run.sessionId}.jsonl`, `subagentType:'workflow-subagent'`), che risolve il transcript annidato via SDK. Fetch on-demand con `useWorkflowRun` (watcher-live). Banner + lista `orphanAgentIds` drill-down-abile per i run degradati

---

### `teams/`

Subtab "Teams": mostra i **team di agenti** di Claude Code 2.x (teammate in-process coordinati da un team-lead). **Insight chiave:** il registry globale `~/.claude/teams/<teamName>/config.json` è stale-prone (sessioni lead uccise lasciano i membri nel config; ogni sessione crea eagerly una dir team vuota; `leadSessionId` diventa stale quando la sessione lead ruota id al resume) → la fonte di verità è il transcript teammate (`{sessionId}/subagents/agent-a<name>-*.jsonl` + sidecar `.meta.json` con `taskKind: 'in_process_teammate'` e `teamName`), letto da `teams-reader.ts` (`teams:getByProject`/`getDetail`); il config solo arricchisce (prompt, joinedAt, membri mai partiti). Le inbox (`inboxes/*.json`) sono code transienti svuotate in secondi — nessuno storico, escluse dal watcher.

**Secondo ingresso — Mission Control:** il rail (`terminal/MissionRail.tsx`) porta i team come specie **TEAMS** del suo event feed, **scoped alla sessione focalizzata** (un team è lanciato dentro una sessione — il lead _è_ la sessione): il match copre l'intero array dei lead id ruotati (`team.sessionIds.includes(sessionId)`) più lo stale-prone `leadSessionIdFromConfig` come segnale secondario. Il **filtro** TEAMS compare ogni volta che il progetto ha team (anche a conteggio 0), e dietro di esso sta l'empty state esplicito "No teams in this session · N in the project" — così "nessun team nel progetto" (nessun filtro) e "nessun team in questa sessione" restano distinguibili senza il vecchio tag `THIS SESSION` (rimosso: rumore > beneficio). Un team con lead vivo è `live` e flotta in cima al feed; status onesto **LEAD LIVE** (+ WORKING/WAITING dal registry — descrive la _sessione lead_, non i teammate, il tooltip lo dice) / **ENDED** / **HISTORICAL**, segnale **`quiet Nm`** (nella meta della riga) quando live ma `lastActivity` ferma da ≥5 min (firma del team bloccato). Click riga → `TeamDetailView` ospitata nell'**overlay** di `TerminalMissionControl` (kind `'team'`, `backLabel="Close"` — il PTY resta vivo); l'"open chat" del dettaglio in overlay naviga alla Mission Control della sessione (view `terminal` keyed per `resumeSessionId` in `ProjectOverview` + prop `onOpenSession`), con `window.confirm` se un PTY sta girando (navigare lo ucciderebbe).

- **`utils.ts`** → `isTeamLive`, `liveLeadSession`, `isGeneratedName`, `teamLabel`, `memberColor`, `fmtRelative`, `fmtTokens`, `minutesSince` — Liveness renderer-side (cross-check `team.sessionIds`/`leadSessionIdFromConfig` — ora su `TeamSummary` — con `useActiveSessions`; `liveLeadSession` ritorna l'entry registry viva per lo status busy/waiting); titolo team condiviso lista/rail (`teamLabel`: nome generato → titolo sessione lead); mappa dei colori nominati dei teammate (blue/green/…) su tinte **desaturate** (encoding dati come `modelColor`, nessuna nuova tinta accent); tempo relativo (date > 7d in `en-US` — UI english-only, niente `it-IT`); `fmtTokens` compatto (`3.7m`/`52k`) per il footer token
- **`TeamsSection.tsx`** — Lista team via `useProjectTeams` **raggruppata per sessione** (pattern `PlansSection`/`TasksSection`): header eyebrow per sessione (`cl-plan-eyebrow` riusato — titolo `sessionTitle`, `N teams · data`, link hover **open chat ↗**) sopra le sue **slab card** (design direction 1c). Un team multi-`sessionId` (lead che ruota id al resume) è ancorato alla sola sessione più recente (`team.filename`), mai duplicato. Card: slab scuro a sinistra (member count grande, dot colore per membro, stato `Live`/`Ended`/`Historical` — live via `isTeamLive`, dot pulsante), corpo editoriale a destra (kicker "Agent team", titolo `teamLabel`, meta mono `Lead <id8> · N transcripts · N messages · last activity`, azione **Open team →** — l'ingresso chat vive sull'header di gruppo, chip membri `cl-team-chip` cap 6 + `+N`) e footer **token distribution** (barra segmentata per membro da `TeamSummary.memberTokens`, totale `fmtTokens`; nota "Configuration unavailable" quando `!hasConfig`). Card intera cliccabile → `team-detail`
- **`TeamDetailView.tsx`** — Pagina read-only custom (pattern `WorkflowRunDetailView`): `TopBar` + hero (`StatChip` members/transcripts/messages/tokens/sessions), nota "stale lead id" quando il `leadSessionIdFromConfig` non è tra le sessioni con transcript, sezione **Lead sessions** (una riga per session id ruotato, link → terminale, la più recente evidenziata), sezione **Members** con righe espandibili (dot colore, model/permissionMode, metriche `N msg · N tools · N tok` dal parse del transcript, description/cwd/prompt in dettaglio, stato muted "never produced a transcript" per i `config-only`) e **"Open transcript →"** per ogni transcript (membro respawnato = più bottoni) → overlay `SubagentTranscriptPanel` (`sessionFilename` = quella del transcript, `subagentType` = nome membro), e sezione **Team activity**: timeline della conversazione del team (`TeamEvent[]` dal reader — dispatch + messaggi bidirezionali con summary in evidenza e testo completo in `<details>`, dot del colore del mittente, lead = accent; ricostruita dai transcript dei membri: `<teammate-message>` in ingresso + tool call `SendMessage` in uscita, idle notification scartate, `to:"main"` normalizzato a `team-lead`). Fetch on-demand con `useTeamDetail` (watcher-live). Prop `backLabel?` (default `'Teams'`; `'Close'` quando ospitata nell'overlay di Mission Control). **Due modalità di body** switchabili da un segmented `.cl-view-mode` in TopBar (visibile solo con membri): **Overview** (default, quanto sopra) e **Swimlanes** (`TeamSwimlanes`)
- **`TeamSwimlanes.tsx`** — Vista secondaria del team detail (design 1g): la conversazione **plottata su corsie** — una lane verticale per team-lead (accent) + ogni membro (colore dato), righe cronologiche dai `TeamEvent` (dispatch = linea sottile sbiadita col tag `dispatch`, messaggi = linea piena color mittente, dot pieno = sender, anello = receiver, summary mono al midpoint — bold per i report member→lead), label espandibile al click (testo completo in Markdown), richieste **broadcast duplicate del lead nascoste** di default (`N more request messages hidden · show all`), legenda, footer compatto dei membri (dot + nome + token `fmtTokens` + `→` transcript). Pill di lane cliccabili: lead → open chat, membro → transcript. Posizioni x = frazioni `(i+0.5)/n` oltre il gutter tempi 56px (classi `cl-sw-*` in index.css)

---

### `settings/`

- **`SettingsView.tsx`** → `SettingsView`, `SettingsGearIcon`, `AppearanceTab`/`GeneralTab`/`PermissionsTab`/`ToolsTab`/`McpTab`/`ExtensionsTab`, `ReadOnlyHint` — Pagina Settings **globale** (deep view, trigger = ingranaggio nella top bar). Legge la config **effettiva** via `useEffectiveConfig()` (cwd = home) → IPC `config:getEffective` → SDK ufficiale. **Rail di tab a sinistra** (Appearance, Privacy, General, Permissions, Tools, MCP Servers, Extensions) + ricerca; il pannello destro è un **"instrument readout"** stile scheda tecnica (classi `set-*` in index.css): `PanelHead` per-tab (eyebrow + titolo grande + caption scritta dal lato utente), `Block` con label mono + hairline, e righe `Row` con **leader puntinati** (il device-firma) che collegano il setting al valore + **source stamp** (provenance, tag mono violet) per ogni valore risolto. Read-only **tranne** Appearance e Privacy. La tab **Sources** (dump JSON dei tier) è stata **rimossa** — la provenance per-campo è ora sui singoli valori. I renderer di tab accettano `heading?` (stampa la label di dominio) per il riuso impilato. **La tab General ha un layout e un gating propri** (`GeneralPanel`, unica tab che mescola preferenze ClaudeLens e config risolta): in cima una **status tape** (`.set-tape`, idioma tape delle entity view) con 4 celle — Model, Claude Code (versione installata + verdetto dot sage/warn contro il `claudeCodeVersion` richiesto, via `compareVersions` da `electron/shared/version-compare`; la versione installata viene da `useClaudeCodeVersion()` → `claude --version`, **non** dall'`init.claudeCodeVersion` dell'handshake SDK, che riporta la CLI impacchettata nell'Agent SDK spedito con l'app e resta ferma quando l'utente aggiorna la propria — leggerlo lì stampava 2.1.220 a chi aveva 2.1.229; una lettura fallita dice `not found` e non ripiega mai sul numero dell'SDK, vedi `test/settings-cli-version.test.tsx`; il numero arriva da `readInstalledClaudeVersion`, che per firma non accetta un eseguibile — passare il binario SDK unpacked dell'app pacchettizzata rimetteva in scena lo stesso 2.1.220, visibile solo su un build vero), Permission mode (dot warn solo per i modi che rinunciano ai prompt — `bypassPermissions`/`acceptEdits`, **non** `plan`, che è più restrittivo del default) e ClaudeLens (versione + stato update come qualifier); poi **Updates** (installata + ultima release + Check now, comando quarantena macOS dietro `<details className="set-disc">`) e **Appearance** — entrambi ClaudeLens-own, montati **fuori** dal gate SDK come `McpTab` — e infine il datasheet SDK (Runtime + Claude Code preferences) chiuso dal `ReadOnlyHint`, che così si riferisce esattamente ai blocchi read-only sopra di sé. Il blocco editabile porta il marcatore `editable` (prop di `Block` → `.set-block-head .ed`, accent = azionabile, specchio del source stamp violet = risolto/read-only). Disambiguazioni deliberate: la riga della cascata è **"CLI theme"** (il tema del terminale) contro il blocco **Appearance** (il tema dell'app) — con lo stesso nome "Theme" leggevano come lo stesso setting; e installata/richiesta di Claude Code sono **una riga sola** con chip `outdated` invece di due numeri da confrontare a mano. Il datasheet Runtime porta invece **due righe adiacenti** per due install diversi: **Claude Code** (la CLI sul PATH, quella che gira nel terminale dell'utente — l'unica che il verdetto e l'avviso `claude update` riguardano) e **Bundled CLI** (`init.claudeCodeVersion` dell'handshake SDK: la CLI impacchettata dentro ClaudeLens, quella che muove la chat in-app). Il numero SDK **si mostra**, perché è un fatto vero e prima l'app non sapeva dire su quale Claude Code parlava la sua chat; quello che non deve succedere mai più è che uno stia al posto dell'altro. La riga Bundled non porta verdetto (nessun chip, nessun dot): aggiornare la propria CLI non può muovere quel numero, solo un nuovo ClaudeLens. **Eccezione: la tab MCP Servers non legge l'SDK config** — `McpTab` prende la prop `cwd` (non `cfg`) e i server da `useGlobalMcp()` (IPC `mcp:getGlobal` → `claude mcp list`), perché l'`mcp_servers` dell'handshake SDK è scoped alla cwd interrogata e qui la cwd è la home, che Claude Code considera untrusted → nessun MCP caricato → pannello vuoto (il bug "0 servers / No servers match"). Per lo stesso motivo è montata **fuori** dal gate `data ?`: non attende né viene nascosta dalla lettura SDK (lenta e fallibile). Mostra `off in this scope` per i connettori che il `cwd` corrente ha disabilitato, e un blocco `Not listed` per i residui su disco
- **`ProjectConfigView.tsx`** — Variante **scoped al progetto** (subtab "Config" della vista progetto). `useEffectiveConfig(project.realPath)` → include i tier `project`/`local` di `.claude/settings*.json`. Riusa i renderer di `SettingsView` (`GeneralTab`/… con `heading`) impilati verticalmente (scroll piatto, niente rail interno) per stare nella chrome editoriale. Read-only. La **Danger zone** in fondo — l'unico ingresso visibile alla cancellazione del progetto (prima esisteva solo come "Remove current" nella status bar del popover di ricerca, trovabile solo da chi già sapeva che c'era) — sta dietro `PROJECT_PURGE_ENABLED`: **nascosta in v2.2.13, di nuovo visibile con i guardrail di #224** (vedi `shared/DeleteProjectDialog.tsx` in questa tabella per il perché). Apre `shared/DeleteProjectDialog` via `onDeleteProject`, inoltrato da `ProjectView`

---

### `overview/`

- **`GlobalHomeView.tsx`** — Home globale: benvenuto + sessioni live + margine con progetti **pinnati** e configurazione. Vedi sotto
- **`Lens.tsx`** — Componente "lente" usata per inquadrare le metriche/sezioni della overview
- **`ProjectDescription.tsx`** — La riga di prosa sotto il nome nell'hero: che cos'è questo progetto. Default **derivato dal CLAUDE.md** del progetto (`useProjectDescription` → IPC `projects:getDescription`, ladder empirica in `electron/modules/project-description.ts`), sovrascrivibile in place. **L'edit non tocca il CLAUDE.md**: la formulazione dell'utente vive nelle prefs di ClaudeLens (`useProjectDescriptions` → `cl-project-descriptions`, chiave = hash progetto) e svuotare il campo **cancella l'override** invece di salvare una descrizione vuota, così il file torna a fare da sorgente. **La frase stessa è il controllo**: si clicca il testo per modificarlo — niente bottone Edit né tag `from CLAUDE.md` di fianco, che spendevano spazio dell'hero per dire quello che dicono già il click e il tooltip (che nomina il file sorgente, o dichiara l'override). L'hover è l'unica affordance, una tinta e non un box. Senza né override né derivato resta un invito `+ Add a description`. Non montata nell'hero compatto dei Teams. Coperta da `test/project-description-view.test.tsx`
- **`ProjectOverviewContent.tsx`** — Vista di un progetto: hero + **fascia metriche** + sezioni (memoria, sessioni, CLAUDE.md, analytics, mcp). Vedi sotto
- **`ProjectRail.tsx`** — **Rail verticale** di navigazione del progetto (design 5a) — ha sostituito `ProjectSubtabs`. Vedi sotto
- **`DuplicateProjectsNotice.tsx`** → `DuplicateProjectsBadge`, `DuplicateProjectsView` — Badge compatto nella home globale + vista dedicata dei progetti duplicati (cwd rewrite + merge). Vedi sotto

**Home globale — un benvenuto, non una dashboard. Design handoff _ClaudeLens
Home v6_, opzione 6b.** `GlobalHomeView` ha sostituito interamente il layout a
sezioni verticali (hero → fascia cifre → live processes → pinned → config a
card → grid MCP) con una stanza a **due colonne** (`.cl-ghome-split`, grid
`minmax(0,1fr) 320px`) che occupa tutta l'altezza del corpo app: `.cl-ghome`
diventa `flex:1` per crescere dentro `.cl-main`, lo stesso opt-in che qualsiasi
vista può prendere (vedi il commento su `.cl-main` più sopra). **Fascia cifre,
tabella dei processi live con PID/cwd e griglia MCP sono state rimosse, non
spostate** — il mock 6b non le prevede e la richiesta a monte era esplicitamente
di allontanarsi da "sembra già una dashboard o un monitoring". Il CSS morto che
le serviva (`.cl-stats--home`, `.cl-tile-grid--cards`, `.cl-proc`/`.cl-proc-list`

- il suo `@keyframes clPulseGreen`, e il blocco di reset `.cl-ghome .cl-sec-head`
  /`.cl-section`/`.cl-stats`/`.cl-row`/`.cl-tile-grid` di design 1a) è stato tolto
  da `index.css` insieme al markup: nessuna di quelle classi rende più nulla sotto
  `.cl-ghome`. `McpServerGrid` come componente resta — lo monta ancora
  `GlobalMcpView` — solo non più qui.

**Colonna di benvenuto.** Eyebrow ridotta a `~/.claude` (il contatore progetti
viveva nella fascia cifre rimossa), titolo statico `Welcome back.` sul
consueto `.cl-h-name.static`, e sotto una **sola frase dinamica**
(`welcomeLine()`) che sostituisce sia la fascia cifre sia la tabella dei
processi: conta quante sessioni sono vive e chiama per nome quella in attesa
("`X` is waiting on you") invece di limitarsi a un numero — un nome è l'unica
cosa che un conteggio non può dire. Sotto, **al massimo due righe**
(`HERO_ROWS`) delle sessioni effettivamente live, deduplicate per cwd
(`liveRowsFromProcs`: più processi sullo stesso progetto restano una riga sola,
e `waiting` vince su `busy`/`idle` se convivono). Il tetto a due righe è
deliberato — un benvenuto che cresce senza limite con l'occupazione di
`~/.claude` smette di essere un benvenuto — ed è per questo che la frase sopra,
non l'elenco, è la fonte di verità sul totale: quel che eccede le due righe
resta comunque contato lì.

**Colonna margine — pinned + configuration.** Niente più sezioni separate sotto
la piega: `.cl-ghome-aside` (border-left, piena altezza) porta **Pinned** come
indice numerato (`01`, `02`, …, solo nome — niente stato live, sessioni, token o
spesa per riga: quel dettaglio viveva nella card `.cl-row.has-pin` che questa
vista non usa più) e **Configuration** come lista compatta di monogrammi
(`.cl-ghome-mono`, 20px, variante `.accent` per CLAUDE.md) invece della griglia
3-up di card di design 1a. **Mostra tutti i pin**, non una pagina alla volta: la
paginazione (`PROJECTS_PAGE_SIZE`) è sparita insieme alle card, e la lista
scrolla da sola dentro la colonna (`.cl-ghome-pinned-list`, `flex:1;
overflow-y:auto`) così Configuration e la didascalia di chiusura restano ferme
in fondo. **Pinnare/spinnare non si fa più dalla home** (niente
`cl-pin-row`/`PinIcon` qui): resta raggiungibile da dove lo era già prima di 1a
— la lente (`⌘F`) o `cl-eyebrow-pin` sull'hero del progetto. Senza pin, la
colonna non sparisce (a differenza della vecchia sezione "solo se c'è qualcosa
da mostrare"): mostra un invito muto (`.cl-ghome-pinned-empty`), perché ora è
una colonna strutturale sempre presente, non una sezione opzionale.
`DuplicateProjectsBadge` resta montato: è l'unico ingresso a
`DuplicateProjectsView` nell'app, quindi anche se il mock 6b non lo disegna va
tenuto — si limita a non renderizzare nulla quando non ci sono duplicati. Non è
più la fascia piena a tutta larghezza in `--cl-warn-soft` sopra lo split
(`.cl-ghome-notice`, sparita): quella forma faceva del suggerimento di
manutenzione la cosa più rumorosa del benvenuto. Ora è una **pill di notifica**
(`.cl-ghome-dup`) larga quanto il contenuto, **in coda alla colonna welcome** —
dentro `.cl-ghome-welcome-inner`, non da fratello, altrimenti combatterebbe con
`justify-content:center`. Nello stesso posto era stata provata una riga mono
nuda, senza fondo: scartata perché si leggeva come una didascalia e non attirava
lo sguardo — il problema era la forma, non la posizione. La pill tiene l'ambra e apre con un
**badge del conteggio pieno**, la forma che a colpo d'occhio dice "c'è qualcosa
in sospeso". L'ambra sta fra 0.70 e 0.78 di lightness in entrambi i temi, quindi
l'inchiostro del badge è un mix scuro del token stesso (`color-mix(… 22%,
black)`) invece di una seconda tinta.

**Il titolo dell'hero è rimpicciolito solo qui** (`.cl-ghome-welcome
.cl-h-name`, `clamp(40px, 6vw, 84px)`). `.cl-h-name` arriva a 132px perché
altrove sta in un hero a tutta pagina; dentro la colonna welcome (680px)
"Welcome back" finiva troncato in "Welcome…" dalla guardia
`text-overflow:ellipsis` di `.label-name`, che esiste per i nomi di progetto —
dati utente di lunghezza ignota. Qui il titolo è una stringa fissa: la guardia
non serve e viene disattivata (va a capo invece di troncare, come fallback alle
larghezze in cui non ci sta), e la misura più bassa è quella che lo tiene su una
riga.

**La colonna margine non ha più la didascalia di chiusura.** `Global · ~ ·
shared across all projects` (`.cl-ghome-aside-foot`) andava a capo su due righe
in 240px di colonna per ripetere quello che dicono già il tab GLOBAL e
l'eyebrow `~/.claude` del benvenuto; l'unica informazione sua era lo **scope**
delle voci sotto — che `Skills 0` conta le skill globali, non quelle del
progetto. Quello scope è finito nell'etichetta della sezione (`GLOBAL
CONFIGURATION`), dove costa zero righe. Con la didascalia via, gli spazi si
stringono: `gap` dell'aside 44 → 30px, `padding-top` di `.cl-ghome-config` 44 →
30px (erano 88px cumulativi fra l'ultimo pin e l'etichetta successiva, un vuoto
che la colonna non poteva permettersi), padding 64/44 → 48/40.
`.cl-ghome-pinned` resta `flex:1`, quindi Configuration continua a stare in
fondo da sé.

I due bordi vanno misurati **dal testo, non dal box**, ed è lì che la colonna
pendeva: in fondo l'ultima riga di Configuration porta 8px di padding suoi, così
40px di padding-bottom danno 48px di aria sotto il testo, mentre in cima
l'etichetta non ha niente sopra di sé e 56px di padding erano 56px veri. Ora il
padding-top è 48 e i due margini ottici pareggiano. Per la stessa ragione lo
stacco etichetta → prima riga è scritto **a somma costante** nei due blocchi:
`.cl-ghome-pinned-list` ha `margin-top:14` sopra righe con 10px di padding,
`.cl-ghome-config-list` ne ha 16 sopra righe con 8 — 24px in entrambi i casi,
che a occhio è la cosa che conta.

**Il benvenuto distingueva due stati su tre, e per questo mentiva.**
`liveRowsFromProcs` leggeva `waiting` e metteva tutto il resto in un unico
secchio che la frase chiamava «working right now»: due sessioni aperte e ferme
al prompt venivano annunciate come due progetti al lavoro. Il registro di
`~/.claude/sessions` gli stati li distingue da sempre e il Monitor li legge
tutti e tre (`isReady`/`doingOf` in `monitor/MonitorView.tsx`); ora lo fa anche
la home, con le stesse regole: `busy` → **working**, `waiting` → **waiting**,
`idle` e `unknown` → **open** (una sessione che non ha mai riportato niente non
è stata osservata lavorare, esattamente come là). Conseguenze:

- La frase si compone per clausole invece di avere un caso per ogni forma:
  quante lavorano, chi aspetta te, e quante sono soltanto aperte — col nome
  proprio ovunque una clausola appartenga a un progetto solo, perché il nome è
  l'unica cosa che un conteggio non sa dire.
- Le righe escono **ordinate per priorità** (waiting > working > open), così le
  due che l'hero ha spazio di mostrare sono le due che contano; la stessa
  priorità decide quale stato vince quando una cwd ha più processi.
- La riga `open` è l'unica **non tinta** — contorno e basta, nome smorzato:
  era lo stato dipinto come lavoro, ed è quello che non deve più sembrarlo. La
  sua azione è `resume →` — il verbo di Claude Code stesso per tornare su una
  sessione ferma — mentre `working` prende `watch →` e `waiting` resta
  `answer →`. `watch` e non `open`: una sessione che gira non la apri, la
  guardi, e `open` è già la parola con cui la frase sopra chiama l'altro stato
  («2 projects are open»), due significati a due righe di distanza.
- La parte pura sta in **`overview/live-rows.ts`**, non nella vista: il file
  della vista esporta un componente e basta (regola fast-refresh, come
  `CreateFormKit`), e così le frasi si asseriscono direttamente —
  `test/global-home-live.test.ts`.

**Sotto i 980px lo split si impila, e la colonna margine deve smettere di
comportarsi da colonna.** Due cose si rompono se resta com'è a due colonne.
`.cl-ghome-pinned` è `flex:1 1 0%` — corretto per una stanza di altezza data,
dove i pin scrollano in place accanto al benvenuto — ma impilato l'`aside` ha
altezza propria (il suo contenuto), e con quel flex-basis la dimensione
ipotetica della lista è **zero**: `overflow-y:auto` la nascondeva del tutto e
in schermata si vedeva la label PINNED, poi il filetto di Configuration, e in
mezzo niente, con nove progetti pinnati sul disco. Nella media query pinned
torna `flex:none` con `overflow-y:visible`: i pin prendono l'altezza che
serve e scrolla la pagina. Seconda: la **lente** è ancorata all'angolo in
basso a destra della colonna di benvenuto, che impilata è larga tutto — cioè
proprio dietro le righe live, che si fermano a `620px` (`max-width` di
`.cl-ghome-welcome-inner`); rimpicciolisce a 320px e si sposta fuori dalla loro
strada, e **sotto i 760px sparisce** (`display:none`), larghezza sotto la quale
la colonna non tiene più testo e lente insieme. La colonna di benvenuto perde
anche il centraggio verticale (`justify-content:flex-start`): impilata non ha
più un'altezza da riempire e il centraggio si limitava a spingere il titolo giù
lasciando un buco sopra.

**Le righe live sono card, quindi hanno aria tra loro** (`.cl-ghome-working`,
`gap:10px` — era `2px`, che le faceva leggere come un blocco unico spezzato da
una fessura). Conseguenza diretta: `data-live='warn'` non poteva più restare
senza fondo. Aveva solo il pallino colorato, e a 2px di gap una riga non tinta
era semplicemente sobria, mentre a 10px tra due card `accent-soft` diventa un
**buco** — la riga che ti sta chiedendo qualcosa che sembra la card mancante.
Prende lo stesso trattamento di `ok` nella tinta di stato (`--cl-warn-soft`,
hover `color-mix` verso `--cl-warn`, action su `--cl-ink-2`).

**Token di raggio.** `--cl-r-card` (usato da `.cl-ghome-working-row`) e
`--cl-r-tile` sono dichiarati in `:root`: una var non definita invalida l'intera
dichiarazione a computed-value time, e questo aveva già reso squadrate
`.cl-plan-card`/`.cl-ask-card` prima che i token fossero aggiunti. Le elevazioni
(`--cl-elev-card`) restano non dichiarate di proposito: lì i call site passano
un fallback esplicito.

**Trigger di ricerca — pill nella top bar.** `.cl-lens-btn` non è più il tondo
da 28px: è il pill di 1a (lente + `Search projects, sessions…` + chip `⌘F`).
Il mock lo disegna dentro l'hero, ma il mock non ha la top bar dell'app e un
secondo trigger per lo stesso popover è esattamente ciò che era stato tolto dal
rail progetto — quindi resta uno solo, dov'era, e vale su ogni vista. Sotto i
1080px label e chip spariscono e torna il tondo. Lo stato aperto **tinge invece
di riempire**: un pieno terracotta largo 230px sarebbe l'elemento più urlato
della chrome, e il popover sotto dice già che la ricerca è aperta.

**Hover della top bar — una risposta sola.** Le tre superfici della barra
(scope nav, pill della lente, ingranaggio) rispondevano al puntatore in tre modi
diversi, tutti scritti a mano. Ora usano gli stessi due token: la tinta
`--cl-glass-hover-bg` (la stessa di altre 12 superfici) e la durata
`--cl-hover-ms` (120ms), col testo che va a `--cl-accent-ink`. Cosa se n'è
andato, e perché:

- **Il pill di vetro dei tab** (`.cl-scope button::before`) era un bottone
  modellato — gradiente radiale bianco, rim interno, ombra portata, molla
  `scale(0.92 → 1)` con overshoot su 360ms. Era l'hover più rumoroso dell'app
  sull'elemento più quieto, e l'ultimo utente di un idioma che nient'altro
  segue; l'override dark serviva solo a rifare lo stesso gradiente con altri
  numeri, e sparisce col gradiente. Al suo posto **l'hover anticipa la tab
  attiva** invece di inventarsi una forma propria: la stessa underline, a un
  terzo dell'inchiostro (`--cl-accent` al 35%), col testo che va a `--cl-ink`.
  Un vocabolario solo per "dove sei" e "dove stai passando".
- **La fascia è piatta.** Non era vetro: compositava bianco al 42% sopra
  `.cl-app`, che è `--cl-paper` — bianco su bianco — e poi sfocava e saturava
  una finestra opaca sotto cui non scorre niente (l'header è fratello flex
  dell'area di scroll, non un layer sopra). Quello che si vedeva davvero era
  l'ombra interna inferiore a fare da bordo, accanto a un `border-bottom` vero
  che era bianco puro, cioè invisibile. Ora: la carta che era già, e una
  hairline onesta. Stesso trattamento per la pill della lente e l'ingranaggio,
  che avevano il loro vetro (bianco 18% + blur + rim) sulla stessa barra bianca.
  **Altezza (52px), gap e tipografia mono restano quelli di prima**: provati a
  46px e in sans, la barra perdeva presenza.
- I bottoni della nav ora **prendono l'altezza piena della barra**
  (`align-items: stretch` sul grid, `height` implicita sul flex), così
  l'underline atterra sulla hairline qualunque sia la misura della fascia;
  brand e blocco destro si ricentrano da sé con `align-self: center`.
- **L'hover della lente impersonava lo stato aperto**: si dava la stessa lavata
  accento _e_ un bordo terracotta, che è il segnale esclusivo di `.on`. Ora
  l'hover tinge e basta — il bordo resta la firma dell'aperto.
- **L'hover dell'ingranaggio era bianco su bianco** (`oklch(1 0 0 / 0.32)` su una
  barra già bianca): invisibile. Ora è la stessa tinta della pill accanto.
- Il **brand** non aveva hover pur essendo un bottone (va a Global): ora vira ad
  accent-ink come tutto il resto.

La stessa passata è stata estesa al resto dell'app, ma **a due famiglie, non a
una**: l'app ha due hover legittimi — quello **neutro** delle superfici a lista
fitta (voci di menu, righe del tag picker, chip di provenance, opzioni di
export, filtri della ricerca, pill del narratore) e quello **accento** dei
controlli azionabili (pin, menu di riga sessione, remove degli highlight).
Appiattirli in uno sarebbe stato una regressione, non una normalizzazione, così
il neutro ha preso un token suo (`--cl-hover-bg`) e l'accento riusa
`--cl-glass-hover-bg`. Ogni sito resta nella sua famiglia: i valori si spostano
di un punto o due (accento 12–14% → accent-soft 78%, ink 4% → 5%), quindi la
resa è **quasi** identica, non identica. Quello che sparisce davvero sono **tre
override dark** (`.cl-menu-item`, `.cl-tag-picker-row`, `.cl-search-filters
button`) che esistevano solo perché il valore light non era theme-aware, e un
`rgba(193, 95, 60, 0.12)` che era `#C15F3C` battuto a mano invece del token.

**Due esclusioni volute.** `.cl-term-btn` gira sulla palette propria del
terminale (`--t-*`), non su `--cl-*`. E `.cl-btn--primary:hover` non è una
tinta ma uno stato composto (background + border-mix + box-shadow): ripuntare
il solo fondo lo desincronizzerebbe dal bordo accanto, quindi o si cambiano
tutti e tre o non si tocca.

**Il popover di ricerca è stato stretto senza togliergli informazioni.** Il
recupero grosso non è nei padding ma nel **path**: ogni riga stampava
`/Users/<utente>/Projects/…`, un prefisso identico su tutte le righe che, stando
in testa, mandava sotto l'ellissi proprio la coda — l'unica parte che distingue
una riga dall'altra (nello screenshot del bug si leggeva
`/Users/giuliodigiamberardino/Projects/Cl…`). Ora passa da `homeRelativePath`
(`shared/projectName.ts`, coperto in `test/project-formatters.test.ts`), che
riconosce la home **per forma** — `/Users/<x>`, `/home/<x>`, `C:\Users\<x>` —
perché nel renderer non c'è `os.homedir()` e questi path sono per costruzione
quelli dell'utente corrente; `/Users/Shared` è escluso, è una cartella vera. Si
applica **al render** (`.ppath`), non nei costruttori delle righe: così vale per
tutte e cinque le famiglie con due call site invece di cinque, e una `detail`
che è una descrizione e non un path attraversa la funzione intatta.

**Due informazioni sono state tolte perché ridette altrove.** Una riga di
sessione portava il **path del progetto**: identico per tutte le sessioni dello
stesso progetto e troncato a `~/Projec…`, cioè zero informazione occupando la
metà della riga. Al suo posto c'è il **nome** del progetto — di una sessione
conta _in che progetto_ sta, e quello è il modo corto di dirlo. E il **tag di
tipo** (`SESSION`, `MCP`, …) era il terzo posto in cui la stessa cosa veniva
detta, dopo l'intestazione di sezione sotto cui la riga sta e la tile colorata
del glifo alla sua sinistra: via il tag, il glifo resta a distinguere i tipi
nelle sezioni miste (i pin). Le due colonne liberate vanno al titolo, che prima
si troncava a `Kernel alarm bro…`.

Il resto è ritmo verticale — header, filtri, sezioni, righe, piede tutti più
stretti di 2–5px, con le gutter portate da 18 a 16px: valgono circa una riga e
mezzo di risultati in più a parità di `max-height`. Due cose che erano rimaste
indietro: la **tile del glifo** delle entity era l'ultimo chip di vetro
modellato dell'app (fondo bianco 52%, bordo bianco, inset highlight, su una
superficie già quasi bianca) e ora è la stessa tile della home globale — 20px,
`1px solid var(--cl-line)`, fondo trasparente; e l'**highlight di riga** era
un'altra lavata accento scritta a mano con override dark al seguito, ora è
`--cl-glass-hover-bg`.

**Chrome del progetto — design handoff _Sessions Varianti_ (rail 5a + contenuto 5b).**
La navigazione di progetto non è più una fascia orizzontale di subtab: è una
**colonna di lavoro** a sinistra (`ProjectRail`, 220px, `--cl-paper-2`, hairline
a destra) montata da `ProjectOverview` dentro `.cl-shell`, il wrapper flex-row
che ora contiene rail + `.cl-main`. Il rail porta, dall'alto: **testata
progetto** (tile monogramma + nome + path in `~` + `▾` → apre il popover
progetti, lo stesso del nome nell'hero), le sezioni raggruppate in
**Context / Execution / System** con tile monogramma e conteggio (sezione a 0 →
tile tratteggiata e riga smorzata: "vuoto" e "non ancora letto" restano
distinguibili), e un piede a una riga col **processo live** (pulse +
`N processes running` + `PID · uptime`) e il **collapse come sola icona** da
26px (⌘B nel tooltip). Collassato è una striscia di 64px di sole tile, con badge
del conteggio sulla tile attiva; lo stato è persistito (`useRailCollapsed` →
`cl-rail-collapsed`, chiave registrata in `prefsBackend`). Il ticker dell'uptime
vive qui, non più in `ProjectView`: prima ri-renderizzava tutta la vista
progetto una volta al secondo.
**Niente riga di ricerca nel rail** (il mock 5a ne aveva una): l'app ha già un
solo ingresso alla ricerca, la lente in alto a destra della top bar con `⌘F` —
due trigger per lo stesso popover erano ridondanti. Per la stessa ragione il
collapse ha perso label e chip `⌘B`: era l'elemento più pesante della colonna
per un controllo che la scorciatoia già copre.

Il contenuto segue **5b**: l'hero perde la meta-riga e guadagna una **fascia
metriche** (`.cl-hband`) di celle divise da hairline — Sessions/{retention}d con
delta sulla finestra precedente, Tokens, Messages, **distribuzione modelli** come
barra part-of-whole + legenda (`buildModelMix` in `../utils.ts`, quota sui
**token** e non sulle sessioni: la cella sta accanto alla cifra dei token e ciò
che la barra codifica è dove è finito il lavoro; unit-tested). La fascia ha
**assorbito la vecchia stat strip a 4 celle** della Overview: le sparkline del
periodo di retention sono scese dentro le prime due celle, media/costo sono
diventati la riga piccola, e la cella "live" è migrata nel piede del rail (era
duplicata in due punti). Il nome display scende a `clamp(40px, 4.2vw, 72px)`
perché una cifra da 26px sotto un titolo da 132px non è una gerarchia.
Le sessioni sono **righe** (`.cl-srow`): pin, indice, titolo, tag, spazio
elastico, il gruppo cifre `msg · modello · token · data` e in coda il **kebab
delle azioni**. Due elementi di 5b sono caduti qui, per la stessa ragione:

- **il filetto puntinato** che portava l'occhio dal titolo alle cifre. Esisteva
  anche come spazio morto riservato (`min-width: 196px`) sotto le azioni, che
  gli galleggiavano sopra in assoluto; senza quel cluster non connette più
  nulla, e una colonna di puntini grigi ripetuta su ogni riga si leggeva come
  decorazione. Resta uno `.cl-srow-gap` vuoto: ciò che allinea davvero la lista
  sono le **larghezze fisse delle colonne di cifre** (`model` 92px, `toks` 72px,
  `when` 104px), non i puntini;
- **i tre bottoni etichettati** (Chat / + tag / Delete), sostituiti da un solo
  `SessionRowMenu` (`.cl-srow-menu`, il tondo da 24px con i tre puntini — stesso
  peso e stessa comparsa in hover del pin all'altro capo della riga, così i due
  affordance si leggono come una coppia). Erano un cluster pieno che, stando
  **sopra** la riga tinta dell'hover, aveva bisogno di un fondo opaco proprio
  (`--cl-paper` composito) per restare leggibile — in dark mode un blocco grigio
  — e che cresceva di un bottone per ogni azione nuova. Il menu (`.cl-menu`,
  portal) porta Open in chat · Add tag… · Pin/Unpin · Delete e può crescere
  senza toccare il layout della riga. La `+ tag` non anchora più il `TagPicker`
  a sé: l'ancora è il kebab, misurato all'apertura.

La riga pinnata **non ha alcun trattamento di superficie**. Due sono stati
provati e **bocciati entrambi**, per lo stesso motivo: erano la cosa più urlata
di una lista il cui linguaggio è fatto di hairline. Il **wash terracotta a
gradiente** (fino a metà riga) in dark leggeva come una macchia marrone e
collideva con la tinta dell'hover — una riga pinnata sotto il cursore mostrava
due fondi insieme, quindi l'hover smetteva di dire "questa"; il **filetto accent
da 2px** sul bordo sinistro lasciava una striscia dura lungo tutto il margine.
Quel che dice "pinnata" è tipografia: il **pin** in testa alla riga, pieno e
permanentemente visibile (per le altre righe compare solo in hover), e
l'**indice mono in accent** (`--cl-accent-ink`, la variante leggibile: `--cl-accent`
puro a 10.5px su carta bianca non tiene il contrasto). È lo stesso idioma dei
progetti pinnati di `GlobalHomeView`, che non hanno mai avuto altro che il loro
pin. La lista si apre con il filetto d'inchiostro 1.5px. Il piede riporta il range (`1–N of M`) e il "Show more": il
caricamento resta progressivo, prende solo l'idioma del pager del mock.
La data della riga è formattata **en-US** come il resto dell'app: era l'ultimo
`it-IT` rimasto in una UI english-only (`10 ago` accanto a colonne inglesi).

**Landing di progetto — design handoff _Overview Redesign_, opzione 1c**
(`section === 'overview'`). Le sessioni sono **un blocco solo**, non due: la
sezione **Pinned sessions** e la striscia **Recent** (`RecentSessionsStrip`,
`.cl-mrow`, entrambe rimosse col loro CSS) erano la stessa lista letta due
volte, e la seconda doveva rinunciare a pin, tag e cluster di cifre per
giustificare di stare sotto una sezione che li portava. Ora: testata
`Sessions · N pinned · M total · View all` e **tre righe `.cl-srow` piene**
(`LANDING_SESSIONS`), **pinnate per prime** — non avendo più una sezione
propria, è la testa della terna che tiene raggiungibile dalla landing una
conversazione pinnata e quindi magari vecchia. Il `rankOf` resta l'indice vero
nella storia completa, così i numeri di riga non mentono. Il caption conta sul
totale della storia (`sessions.length`).

La **memoria** è la sezione che 1c cambia di più, ed era la più penalizzata:
una definition-list a 3 colonne (`.cl-mem`/`.cl-mem-row`, rimosse) dove un
topic si leggeva come una riga di tabella — niente tipo, niente tag, niente
gerarchia. Diventa una **griglia di index card** (`.cl-mem-cards`/`.cl-mcard`,
`renderMemCard`): header con glifo iniziale + tipo + età relativa, nome come
titolo, **tre righe di prosa** in `--font-reading` (`memPreview` accetta ora un
`max`, qui `MEM_CARD_PREVIEW_MAX`) e i tag a piede card. La prima card prende
il wash accent, come la prima tile di Skills/Agents. I tag sono **read-only**
qui: aggiungerli/rimuoverli resta nella subtab Memory, che possiede la lista
intera (e il `TagPicker`). Cap a `LANDING_MEM_CARDS` (due file da tre), con
`View all` verso la subtab.
Il caption è `N topics · <due tipi più frequenti>`: un breakdown completo
sfora la testata su qualsiasi memoria vera, e i due tipi dominanti sono ciò che
dice che cosa questo progetto ricorda. **Una sola visualizzazione, newest
first**: il segmented `Newest / By type` (stato locale `memCardView`, con il suo
`landingMemGroups`) è stato **rimosso**. La landing mostra sei card di una
storia che ne conta decine — a quella taglia il raggruppamento per tipo era un
controllo su un campione, e la subtab a cui `View all` porta possiede la lista
intera con l'ordinamento e il group-by che le appartengono
(`memSort`/`memGroupBy`, tuttora suoi). La variante `.cl-seg--paper` **resta**:
la usa la toolbar della subtab.
**Non implementata** di 1c: la card tratteggiata "New topic" — l'app non ha
(ancora) nessun ingresso di creazione memoria, solo l'IPC `memory:createTopic`
e l'hook `useCreateTopic` inutilizzato; sarebbe una feature, non un cambio di
layout. Fuori scope anche la «context chain» che collassa CLAUDE.md sotto
l'hero.

La sezione **CLAUDE.md** ha invece lasciato la tile-grid per una **cascata a
una colonna** (`.cl-md-cascade`/`.cl-md-layer`): ogni layer è un file con lo
stesso nome, quindi lo scope da solo non distingue una riga dall'altra — con
sei layer quattro righe si chiamavano `Subdir` e il path stava nella riga
smorzata sotto. Ora **il path è il nome della riga**, spezzato da
`claudeMdPathParts` in genitori smorzati + segmento identificante in evidenza +
nome file smorzato (`src/components/`**`project/`**`CLAUDE.md`), e la parola
generica scende a **chip di larghezza fissa** che allinea tutti i path sulla
stessa colonna. L'ordine segue la cascata che la testata annuncia (global →
project → local → subdir, i subdir per profondità poi alfabetici): la riga di
intestazione fa da legenda solo se la lista la segue, mentre prima partiva dal
project. L'accento passa quindi **dalla prima riga al layer `project`**, che
resta quello che si apre più spesso. Una **barra proporzionale** dà la scala
(36 righe contro 882) che una colonna di cifre lascia fare a mente; sotto i
760px sparisce. Una colonna sola perché la cascata è una sequenza ordinata e la
griglia a due colonne la faceva leggere a zig-zag.
La sezione **Teams** conserva l'hero compatto (`cl-hero--compact`) e la
vecchia meta-riga: è una vista operativa, non una landing di progetto.
Il **filtro per tag** (`sessions/TagBar`) non è più una banda sotto il titolo:
sta nella **testata di sezione**, a destra, accanto al conteggio che filtra —
come banda propria costava una hairline e 28px verticali per dire "todo 1", e
la hairline era comunque ridondante col filetto d'inchiostro in cima a
`.cl-srows`. `all` e i tag sono **una sola specie** (nessun separatore tra
loro: sono un radio group) nel linguaggio dei filtri della pill chat
(`.cl-pill-filter`): niente bordo, niente riempimento, conteggio smorzato di
fianco, velo accent su quello attivo. È la nuova variante **`filter`** di
`TagChip` (`.cl-tag--filter`), non un override di `--pill`: la pastiglia resta
giusta dove il chip è un controllo delimitato tra altri (righe del `TagPicker`,
testate di sessione/topic), e una variante evita di combattere con gli
override `[data-theme='dark']` della pastiglia. `ManagedTagChip` inoltra
`variant`. Il grigio della pastiglia è stato comunque **riportato in palette**
(`color-mix(in oklch, var(--cl-ink) 6%)` + `--cl-line` al posto di
`color-mix(in srgb, var(--cl-ink-3) 10%)`): era uno scrim **grigio neutro in
sRGB** su carta calda, l'unica cosa di quelle righe che veniva da un'altra
palette. Lo stesso rail serve la toolbar della memoria, che già annullava a
mano la banda.

**Vista Duplicates — hero + confronto affiancato** (`DuplicateProjectsView`,
direzione scelta tra 3 paradigmi con preview). Prima era un `BackButton` nudo
sopra una colonna da 860px: il bottone finiva **sotto i semafori macOS** (la
`TopBar` condivisa esiste proprio per il suo gutter da 88px) e i dati stavano in
un terzo di finestra con il box di spiegazione come elemento più pesante della
pagina, pur essendo da leggere una volta sola. Ora la vista prende la chrome
delle altre deep view (`TopBar` + `cl-hero` + `Lens` + `cl-section`, come
`PluginsView`) e la spiegazione scende in un `<details className="set-disc">`
chiuso — il testo resta, smette di dominare.
La **fascia metriche** (`.cl-hband`, riusata dall'hero progetto) dichiara la
scala del problema, che prima nessuno diceva: Projects, Folders
(`N primary · N duplicate`), **Sessions to move** e **Memory to merge** —
i due totali sommano solo le cartelle **non** primarie, cioè esattamente ciò che
un riordino sposterebbe.
Ogni gruppo è un **diff a due colonne** (`.cl-dup-compare`, grid
`1fr 46px 1fr`): primary a sinistra, i duplicati impilati a destra
(`.cl-dup-stack` — un gruppo può averne più di uno), e nel gutter la **direzione
del merge**, che punta **a sinistra** (`←`) perché il duplicato confluisce nel
primary; per la stessa ragione il bottone ha perso la sua freccia `→`, che
raccontava il contrario. Sotto i 900px il confronto impila e la freccia ruota di
90° (punta in su, verso il primary): affiancate, due colonne da mezza finestra
stretta non si confrontano più.
I due pannelli portano **le stesse tre cifre negli stessi slot**
(`.cl-dup-tape`: Sessions / Memory / Last) perché il confronto _è_ la decisione;
il path **va a capo invece di troncare** (è l'oggetto della scelta) e il suo
**prefisso condiviso è smorzato** (`sharedPathPrefix` in
`shared/projectName.ts`, unit-tested in `test/project-formatters.test.ts`): le
cartelle di un gruppo condividono il basename — è ciò che le rende candidate —
quindi ciò che le distingue sta nel mezzo del path, e smorzare la testa comune
porta l'occhio lì. Un prefisso di sola `/` non viene smorzato (un carattere non
è rumore). Il primary si segnala col wash sage (`color-mix` su `--cl-ok`, niente
tinta nuova) e la parola `kept`: `--cl-ok-soft`, che la vecchia riga usava, **non
esiste** — il fallback `transparent` era sempre quello preso.
La scelta del primary resta del reader (attività più recente, poi più sessioni —
`sortPrimaryFirst` in `duplicate-detector.ts`): la vista non offre di scambiarlo.

---

## Convenzioni

- **Navigation:** ogni componente riceve `onNavigate(v: View)` e/o `onBack()` come callback — non gestisce stato di navigazione proprio
- **Data fetching:** tutti gli hook da `../../hooks/useIPC`; React Query gestisce cache e invalidazione
- **Styling:** Tailwind CSS + token `--cl-*` / classi `cl-*` in `index.css` (accent terracotta `#C15F3C`). Tema chiaro di default, dark derivato via `:root[data-theme='dark']`. Non introdurre nuove tinte d'accento — vedi root `CLAUDE.md`
- **Tema (light/dark/system):** la preferenza vive in `hooks/useTheme.ts` (tipi + context + hook `useTheme`) e `hooks/ThemeProvider.tsx` (il provider, montato in `App.tsx`) — separati per la stessa regola fast-refresh di `CreateFormKit`. Unica fonte di verità `preference` (`'light' | 'dark' | 'system'`) persistita in `localStorage['cl-theme']`; `resolved` (`'light' | 'dark'`) applicato su `<html data-theme>`. Con `system` segue l'OS via `matchMedia` (aggiornamento live). Il controllo è esclusivamente nella tab Appearance dei Settings (nessun toggle in top bar)
- **Import paths:** da sottocartelle usare `../types`, `../utils`, `../shared/BackButton`, ecc.
