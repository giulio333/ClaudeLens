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
- `modelMixKey(m)` / `buildModelMix(sessions)` — distribuzione per famiglia modello della **fascia metriche** dell'hero progetto: quota sui **token** (non sulle sessioni), famiglie a zero token scartate (mai un segmento a larghezza nulla), finestra senza uso → `[]` e la cella mostra l'empty state. Le famiglie sono Fable / Opus / Sonnet / Haiku, in quest'ordine; un id sconosciuto finisce in `other` invece di essere indovinato, e lì resta anche Mythos — stessa fascia di Fable ma modello diverso, e un'etichetta sbagliata in legenda è peggio di una generica. Unit-tested in `test/project-formatters.test.ts`

---

## Struttura per dominio

### `shared/` — Atomi UI riutilizzabili

- **`BackButton.tsx`** — Bottone freccia indietro con label
- **`BetaTag.tsx`** — Tag `Beta` (`.cl-beta`): hairline nell'inchiostro accent, senza fondo — è un'etichetta, non un controllo. Oggi lo porta solo Remote (#242), in tre punti: la voce della top bar, l'eyebrow della pagina e il banner della sessione connessa. Toglierlo quando Remote esce di beta è togliere i tre usi e il componente
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
- **`find.ts`** → `findMatchingTurns`, `stepToHit` — **Modulo puro, unit-tested** (`test/chat-find.test.ts`): la metà "scansione" del trova-nel-transcript. La colonna di lettura è **finestrata**, quindi il Ctrl+F del browser vede solo le righe attorno al viewport: questo è il rimpiazzo, e legge i **dati**, che sono tutti. Risponde **un booleano per turno, ed è il progetto, non una scorciatoia**: navigare per match ("hit 4 di 37") obbligherebbe a riconciliare gli offset del markdown grezzo con quelli del testo renderizzato — `**bold**`, un link, uno span in backtick li spostano tutti — e quella riconciliazione è l'unica parte davvero difficile di un find qui. Per turno non servono offset: la scansione dice quali turni contengono la query, `jumpToTurn` li percorre, e il layer accende ogni occorrenza nelle righe montate. È anche il modello con cui questa superficie già naviga (minimap e `activeTurn` vanno di turno in turno). **Scopo: la prosa** — blocchi `text`, più `thinking` dove la densità lo mostra: una nota breve (`thinkingNote`) in entrambe, un blocco lungo solo in FULL. Un `tool_result` sarebbe un hit su un turno senza niente di acceso, e un `thinking` lungo in MIN pure. La nota non è un `data-hl-block` (quell'indice è dei blocchi `text`): porta un `data-find-block`, che `useFindLayer` dipinge e le evidenziazioni ignorano. `stepToHit` prende il **turno corrente**, non un indice nella lista dei hit, così resta giusto quando la lista cambia sotto (query modificata, watcher che appende) e "avanti" vuol dire "il prossimo dopo dove sto leggendo"
- **`useFindLayer.ts`** → `useFindLayer` — La metà "pittura", gemella di `useHighlightLayer`: stessa CSS Custom Highlight API, stesso `MutationObserver` che ri-pinna i Range quando una riga finestrata rimonta. **Le due convivono perché nessuna svuota il registro in blocco** — ognuna cancella solo i nomi che possiede (`cl-find`/`cl-find-active` qui, `cl-hl-*` là). **Cammina sul DOM, non sui dati, ed è questo che la tiene semplice**: la scansione lavora sul markdown per dire _quali_ turni, questa sul testo renderizzato per dire _dove_ dentro una riga montata, e le due non devono mai accordarsi su un offset. Le righe non montate non dipingono niente, e non costa niente: sono fuori schermo. Due nomi e non due tinte: l'attivo è l'accento del brand, il resto è l'ambra degli highlight a un terzo del peso — una quinta tinta si leggerebbe come un quinto tipo di evidenziazione, cioè qualcosa che il lettore ha marcato, mentre vuol dire solo "questo è il turno dove ti ho portato". Il turno attivo arriva come **uuid**, non come numero: è ciò che il DOM porta (`data-hl-block` è `<uuid>:<blockIndex>`)
- **`useAutoScroll.ts`** → `useChatAutoScroll` — Hook di bottom-pinning del feed chat: un ResizeObserver sulla colonna transcript ri-pinna a **ogni** crescita di contenuto (token, tool card che si espandono, run collassate che crescono, toggle Min/Full, reflow tardivi) finché l'utente è ancorato al fondo. Pin **istantanei** (mai smooth: gli eventi che generano atterrano esattamente al fondo e non vengono riletti come "utente scrollato via"); sgancio su scroll-up (wheel-up immediato, scrollbar/tastiera oltre soglia 200px), ri-aggancio tornando sotto soglia; l'attach via ref callback pinna in sincrono al (re)mount della colonna, così la chat si apre già in fondo. Espone `followRef` per gli effetti fratelli (toggle densità). Usato da `ChatView` e `LiveChatView`
- **`atoms.tsx`** → `PathChip`, `UrlChip`, `SectionLabel`, `CodeBlock`, `LiveInTerminalBadge` — UI atoms per il rendering degli input/output tool + badge TopBar "Live in terminal" (condiviso da `ChatView`/`LiveChatView`). `UrlChip` è la sorgente web nella stessa forma che `PathChip` dà a un file (host in evidenza, path a seguire) ed è un **link vero**: `window.open` → `setWindowOpenHandler` del main → `shell.openExternal`, mai dentro il renderer; solo `http(s)`, così un `file:`/`javascript:` resta testo inerte
- **`fileIcons.tsx`** → `FileIcon` — Logo file reali (devicon-plain monocromatici via `unplugin-icons`, `~icons/devicon-plain/*`): estensione → logo linguaggio (tsx/jsx→ts/js, scss→css3, ecc.), fallback a glifo documento generico. `currentColor` → seguono tema + tinta categoria. Usato dai chip file in `MessageBubble` (footer turno minimal)
- **`ToolDetailPanel.tsx`** — Pannello fullscreen dettaglio tool: rendering specifico per Grep, Glob, Agent, operazioni memoria, **WebFetch/WebSearch**; Bash e i file tool (Read/Write/Edit, `isFileTool` in `file-view.ts`) prendono un pannello unico con la loro finestra (`CommandSheet` / `FileSheet`), la stessa del transcript — i vecchi rami Read/Write/Edit di `ToolInput`/`ToolOutput` (PathChip + badge estensione + tre `CodeBlock`) non esistono più. Per i due tool web il titolo della pagina è la **sorgente** (page label / query, la stessa della riga in Mission Control) e non il nome del tool: input = `UrlChip` cliccabile + la richiesta di estrazione come prosa (prima era un `JSON.stringify` con l'URL non cliccabile), output = markdown (una pagina fetchata **è** prosa: era l'unico output dell'app reso come sorgente in un `CodeBlock`), e la nota di **redirect** resa come avviso warn — il tool non ha restituito la pagina, dirlo è il punto. Le fonti di una ricerca sono una **bibliografia** (`SearchSources` → classi `.cl-src` in index.css): ordinale · titolo · **filetto puntinato** · host, cioè il device che l'app già usa per "label … valore" (righe Settings, righe sessione), non una pila di card bordate. **Una riga per fonte, titolo troncato**: il wrap a due righe è stato provato e si rompe — un leader flex parte dopo il _box_ del titolo, non dopo la sua ultima riga, quindi una riga andata a capo lascia i puntini sospesi a metà del vuoto (titolo capped al 62% perché anche con un host corto resti un tratto di puntini leggibile; titolo intero nel tooltip). La freccia ↗ è nascosta fino all'hover ma tiene il suo spazio, come le azioni delle righe sessione. Il caption conta **anche i domini** (`8 results · 6 domains`): è la metà a costo zero del raggruppamento per host — dice se una ricerca ha attinto a sei fonti o letto sei volte lo stesso sito. Con quella testata, `WebSearch` entra in `ownsOutputHead` (`shell.ts`): un `Output · 47 lines` sopra `SOURCES` sarebbe un secondo titolo per lo stesso blocco. Il predicato resta name-only e i call site scrivono `!ownsOutputHead(name) || result.isError`, così un risultato **fallito** conserva la sua etichetta "Error", che nessun body disegna da sé; l'instradamento verso `CommandOutput`è passato al nuovo`isShellOutput`, che è la domanda che stava davvero facendo
- **`web.ts`** → `webHost`, `webPageLabel`, `webCanonicalUrl`, `parseWebSearchResult`, `parseRedirectNotice`, `parseHttpFailure`, `webOutcome`, `WEB_TOOLS` — **Modulo puro** (unit-tested in `test/web.test.ts`) dei payload dei due tool web, condiviso dalla specie WEB di Mission Control e dal `ToolDetailPanel`. Regole verificate su 75 chiamate reali: il fallimento ha **quattro forme e solo una alza `is_error`** — la notifica `REDIRECT DETECTED:` (il tool NON restituisce la pagina, la considera un successo sarebbe una bugia), `Web search error:` dentro un risultato altrimenti sano (la ricerca non è mai partita) e la **risposta HTTP raccontata in prosa** (`The server returned HTTP 403 Forbidden.` + ~200 byte di consiglio al posto della pagina, `is_error` non alzato): su 73 fetch reali sono 7 (403 ×4, 404 ×3), e il rail le chiamava `FETCHED` mentre nessuna pagina era tornata. Il target di un redirect è letto **attraverso il qualificatore** che le CLI recenti inseriscono (`Redirect URL (from the server's Location header — …): <url>`); ancorare su `Redirect URL:` nudo lasciava `to` a null e la riga diceva REDIRECT senza dire dove — entrambe le grafie convivono nei transcript. Un risultato di ricerca è tre cose in una stringa (eco della query · array JSON `Links:` su una riga sola · sintesi · `REMINDER:` scritto per l'harness): solo le due centrali sono contenuto. `webCanonicalUrl` è la **chiave d'aggregazione**: il fragment cade (`…/settings#plugin-settings` è la stessa pagina di `…/settings` — il server non lo vede nemmeno; caso reale che produceva due righe indistinguibili), la query string no
- **`shell.ts`** → `parseShellCommand`, `splitPipeline`, `normalizeOutput`, `promptRows`, `ownsToolBody`, `ownsOutputHead`, tipi `ShellStep`/`PromptRow`/`ParsedShellCommand` — **Modulo puro** (unit-tested in `test/shell.test.ts`) del rendering shell. `parseShellCommand` decide **dove un one-liner può essere tagliato**: uno scanner con stato di quoting (`'`/`"`/backtick), profondità `$(…)`/`{…}` e memoria dell'ultimo carattere non-spazio taglia sugli operatori top-level (`;`, `&&`, `||`, `&`, newline) — quest'ultima serve a distinguere `2>&1`/`>&2`/`&>log` (redirezioni) da un `&` di background, che era il modo più facile di spezzare un comando a metà. Un comando **multi-riga** o con **heredoc** non viene toccato (`mode: 'script'`, le righe dell'autore sono il modello). Le pipeline si spezzano in stage solo sopra i 72 caratteri: sotto, una riga sola si legge meglio di due. `promptRows` traduce il parse in righe da leggere: **un solo `❯`** (i prompt veri della run) e ogni continuazione aperta dal connettivo che la governa (`&&`/`||`/`|`), col `;` silenzioso (per la shell è la riga nuova stessa) e `&` come suffisso. `normalizeOutput` rende stampabile l'output registrato — via le sequenze ANSI (un comando che credeva di avere un tty) e ogni run di `\r` collassato a ciò che il terminale avrebbe lasciato a schermo (barre di progresso: una riga, non mille). `ownsToolBody` è il seam che tiene **comando e output come una cosa sola**: per Bash la card e la detail page non stampano né la sezione Input né la sezione Result, perché `CommandSheet` le rende dentro la stessa finestra di terminale; `ownsOutputHead` copre il solo lato risultato (`BashOutput`, la lettura di una shell in background)
- **`CommandBlock.tsx`** → `CommandSheet`, `CommandBlock`, `CommandOutput`, `SheetModal`, `IconButton`, `CopyButton`, `ExpandIcon`, `CloseIcon` — La run di shell resa come **la finestra di terminale che era**: barra del titolo (semafori macOS + titolo centrato `bash — 5 steps` + azioni), le righe di prompt, l'output subito sotto, e una striscia di stato in fondo (`● 24 lines`, `no output`, `running`, errore in danger). `CommandSheet` (usata da `ToolGroupCard` e `ToolDetailPanel`) tiene comando e output **nella stessa finestra**; `CommandBlock` (senza risultato, quindi senza striscia di stato: dire "running" di un comando in attesa di approvazione sarebbe falso) sta nel dialog dei permessi; `CommandOutput` copre `BashOutput`. Due iterazioni editoriali precedenti — finta finestra macOS con semafori finti, poi sezioni COMMAND/OUTPUT su carta — sono state scartate dall'utente: le etichette erano l'unica cosa che diceva che si trattava di una shell, cosa che un glifo di prompt dice meglio. **La superficie è dark fissa in entrambi i temi**, con gli stessi valori dei code fence markdown della chat (`.prose-lens .cl-md-code`): il codice si vede uguale in tutta l'app e la palette highlight.js (github-dark-dimmed, importata globalmente) è tarata proprio per quel fondo — per questo i pannelli **non** portano `.cl-code-pre`, il cui remap serve alle superfici di carta. **Un solo `❯` per run** (`promptRows` in `shell.ts`, unit-tested): il comando è stato battuto a un prompt solo, e un glifo per statement inventava prompt mai esistiti. Ogni riga di continuazione è **aperta dal connettivo che la governa** (`&&`/`||` in accent, il `|` degli stage di pipeline in grigio), non chiusa da quello della riga precedente, dove l'occhio è già andato via; il `;` non stampa nulla — per la shell è la riga nuova stessa — e `&` resta suffisso della riga che manda in background. **Niente wrapping** (una riga di shell a capo si legge come prosa e perde la forma, una riga di log perde le colonne): il body scorre in orizzontale con comando e output **su un solo scroller**, come scorre una sessione — un gutter sticky galleggerebbe sopra l'output. L'output è clampato a 22 righe con dissolvenza + "Show all N lines" (mai uno scroller verticale annidato in un transcript che già scrolla) e ⤢ apre la stessa finestra **a tutto schermo** (portal, z-index 999 come `.cl-run-agent-*`, Esc/backdrop per chiudere), dimensionata sul contenuto fino a 92vh e con l'output non clampato; lì il titolo diventa la description e il comando resta per contesto anche in densità MIN
- **`ToolGroupCard.tsx`** — Una coppia `tool_use` + `tool_result` nel transcript, **aperta di default**: la run è quello che il lettore è venuto a vedere, e una riga da cliccare davanti a ogni tool era un menu a tendina davanti a ognuno. I due tool che possiedono una finestra **sono** la loro finestra — Bash la `CommandSheet` (terminale), Read/Write/Edit la `FileSheet` (editor, vedi `FileWindow.tsx`) — senza header di card sopra a ripetere il nome che la title bar già dice (per Bash la description passa in title bar, `showDescription`). Ogni altro tool tiene l'header (monogramma · nome · cosa gli è stato chiesto — un `div`, non più un `button` che non fa niente) con input e risultato già sotto, senza toggle né caret; un errore sta nel corpo aperto, non in una striscia collassata. La prop `collapsible` sopravvive **solo per le strisce che MIN tiene a schermo** (dispatch di agenti, skill — `.cl-tool-stack--chips`): lì la card resta un chip che si apre al click, perché MIN è la densità che nasconde i corpi dei tool. L'`Artifact` tool si divide qui in due: una chiamata che ha **pubblicato** una pagina è quella pagina (`ArtifactCard`), una che non ha pubblicato niente (`quickstart`, `read`, `list`) è impianto idraulico e finisce nel chip **qualunque sia la densità** — la sua risposta è un kilobyte di prosa scritta per l'harness, ed era la metà del problema. Coperto da `test/tool-group-card.test.tsx` e `test/artifact-card.test.tsx` (StrictMode)
- **`artifact.ts`** — Lettura dell'`Artifact` tool, modulo puro (`test/artifact.test.ts`). La pagina (`ArtifactPublish`) la scrive il main process leggendo `toolUseResult`; qui si decide cosa se ne mostra. Due forme tenute apart: una **publish** ha prodotto una pagina ed è l'esito del turno, una `quickstart`/`read`/`list` ha risposto a una domanda e non ha prodotto niente — e il discriminante è **l'assenza della pagina**, non l'`action` dell'input, che un transcript vecchio può non avere. `artifactVersion` non inventa un `v1` dove il transcript tace, e `artifactIsPrivate` torna `undefined` invece di `true` quando `audience` manca: dire "privato" è un'affermazione su chi può aprire un link. `buildArtifactActivity` aggrega **per `artifact_id`**, una riga per pagina per quante volte sia stata ripubblicata: serve al rail, non alla chat, dove ogni publish sta al momento in cui è avvenuta
- **`ArtifactCard.tsx`** — La pagina pubblicata, disegnata come esito e non come tool call: titolo suo, la `description` sotto, la versione a destra, e una striscia di stato `CREATED`/`UPDATED` + **il link vero** (`window.open` → `shell.openExternal`, come `UrlChip`) + `private`/`shared`. La prosa del risultato resta, ripiegata, dietro il caret. La grammatica visiva è quella di `.cl-tool-card` **invariata** — stesso monogramma da 22px, stessa coppia titolo/preview, stessa striscia: cambia solo la **tinta**, accent invece di neutro, perché la domanda del lettore qui è "questo turno ha prodotto qualcosa" e il colore risponde prima di qualsiasi glifo (un primo giro di pittogrammi lucide era stato scartato: in una grammatica di label mono maiuscole si leggevano come importati da un altro design system). `compact` è la riga sola che MIN tiene a schermo, accanto ad agenti, skill e piani
- **`sent-message.ts`** — Lettura del tool `SendMessage`, modulo puro: la **metà mittente** di un messaggio fra sessioni. La ricevente aveva la sua bolla (#274) e la sua pagina (#280); questa si vedeva come tool card generica — header `SendMessage`, preview vuota, e il JSON del risultato come corpo — cioè una delle due metà di ogni conversazione fra sessioni leggibile come impianto idraulico. Ciò che la chiamata ha detto sta sull'input (`to`, `message`, `summary`; **mai `content`**, che è l'eco di `message` tagliata con un'ellissi); ciò che solo il risultato sa — che il messaggio è partito e sotto che id — è `SentMessage`, letto nel main da `toolUseResult` (`transcript-extras`), mai dalla prosa. `messageDeliveryState` distingue `sending` (nessun risultato: in volo o CLI morta a metà, il transcript non sa dirlo), `sent`/`sent-to-agent`, `not-delivered` (risposta senza id: nome irraggiungibile, o `main` da dentro un agente) e `failed`; `messageExchangeId` offre lo scambio **solo** per una consegna a un'altra sessione — la inbox di un teammate non si lega a niente (`session-exchange` tiene gli agenti fuori da ogni thread) e offrirlo risponderebbe `null`
- **`MessageLine.tsx`** + **`message-line.ts`** — La riga che disegna **entrambe** le metà di un messaggio fra sessioni: quella ricevuta (`InboundMessage` in `MessageBubble.tsx`, #274) e quella mandata (`OutboundMessage`). Erano due blocchi — filetto a sinistra, striscia mono maiuscola, corpo srotolato fino a 12 righe, e sul lato mittente anche una riga di summary e una di stato: due livelli di chrome attorno a qualcosa che, in mezzo a un transcript, è un inciso. Ora è **una riga sola** — chi, la prima riga di cosa ha detto, quando — e il messaggio **si apre al click** (la riga intera è il disclosure, non un caret a parte). Ciò che la riga non può lasciare ambiguo è la **direzione**, e la dice tre volte perché perderne una la lasci comunque leggibile: il glifo (freccia che atterra in basso a sinistra per ciò che arriva, che esce in alto a destra per ciò che parte), la parola `from` / `to` davanti al nome, e la tinta (accent per l'entrante, ink per l'uscente e per un agente interno — nessuna tinta nuova, i 40° del brand). **Nessun controllo sulla riga**: allo scambio si arriva dal dock MESSAGES di Mission Control, che raggruppa la conversazione per interlocutore — un `Show exchange` su ogni messaggio dello stream era esattamente la chrome che questa riga esiste per togliere, e `MessageBubble`/`ChatView` non inoltrano più `onOpenExchange` (resta il percorso del rail). `previewLine` (modulo puro, separato per la regola fast-refresh) sceglie la riga d'anteprima e spoglia il markdown invece di stamparne la punteggiatura
- **`OutboundMessage.tsx`** — La metà mittente, resa da `MessageLine` con `direction="out"`: stessa riga della gemella in arrivo, così le due metà di una conversazione si leggono uguali qualunque transcript sia aperto. Ciò che è solo suo è lo **stato di consegna** registrato dal risultato (`SENDING`/`SENT`/`NO DELIVERY`/`FAILED`) e l'anteprima, che è il `summary` della chiamata quando c'è e la prima riga del messaggio altrimenti. Una chiamata che non ha consegnato nulla non incolla il JSON del risultato sotto il messaggio: lo offre ripiegato (`Show what the tool answered`) sotto il corpo aperto, come `ArtifactCard` fa con la sua prosa. `ToolGroupCard` ci instrada in **entrambe** le densità (`isMessageTool`). **Perché in MIN non si vedeva affatto**: `describeTurn` (`chat/utils.ts`) non conosceva né i gruppi `SendMessage` né gli `Artifact`, quindi un turno che conteneva solo uno dei due risultava `toolsOnly` e `buildRenderItems` lo ripiegava nel badge "tools hidden" — la striscia di `MessageBubble` era codice morto su quel percorso, e la densità di default della Lens è proprio MIN. Le due liste di specie devono restare allineate. Coperto da `test/message-bubble-markers.test.tsx` (StrictMode) e `test/chat-utils.test.ts`
- **`FileChangesStrip.tsx`** → `FileChangesStrip`, `FileChangeDiffs`, `FileChangePage`, `FileChipCluster` — **I file che un turno ha cambiato, a piè del turno, in densità MIN.** MIN nasconde i corpi dei tool, e l'unica traccia di una modifica era un chip a icona col nome del file in hover: niente verbo, niente misura, e per vedere il cambiamento bisognava passare l'intera conversazione a FULL. Ora ogni file cambiato è **il diff stesso**, disegnato come Claude Code lo stampa nel terminale: una riga — etichetta `UPDATED`/`CREATED`/`DELETED` (terracotta / verde / rosso), icona, **nome in grassetto**, directory attenuata dopo, `×N` se più chiamate, `+N −N` a destra — e sotto gli hunk numerati, **aperti di default**, sulla carta della pagina (tema chiaro e scuro, mai una finestra dentro la finestra: il diff è parte di ciò che il turno ha detto). Palette **propria** (`--diff-add`/`--diff-del` e i loro fondi, definiti su `.cl-file-change`/`.cl-file-change-body`): il `--cl-ok` è un salvia fatto per un puntino e sotto una riga di codice al 12% spariva; le righe `+`/`−` hanno il fondo pieno e una barra di 3px sul bordo, le righe di contesto sono in `--cl-ink-3` (solo il cambiamento porta inchiostro pieno), il blocco ha bordo, angoli e un'ombra a due livelli nell'inchiostro caldo delle superfici glass. **Evidenziazione intra-riga** (`markPairs`/`spanDiff` in `file-view.ts`): in un run di N righe tolte seguite da N aggiunte ogni coppia porta il solo tratto che differisce (prefisso e suffisso comuni), disegnato come **layer sotto il codice** con testo trasparente — hljs possiede l'HTML del codice e uno span infilato dentro finirebbe dentro un token; un rewrite (run diseguali) o due righe che condividono solo l'indentazione non hanno mark. Lo stacco fra due hunk è una banda `⋯ N lines unchanged` (il conteggio dagli header). Clamp **per specie**: un file creato è il suo intero contenuto e piega a 12 righe, un edit o una riscrittura da shell a 60 (la coda del corpus arriva a 298 righe per hunk); "Show all N lines" in terracotta a piè del blocco, ⤢ (sempre visibile, attenuato) apre lo stesso oggetto a tutto schermo (`SheetModal`), Esc chiude. **Le fonti sono due e vanno unite**, ed è la ragione del componente: i tool file (`Edit`/`Write`/`MultiEdit`/`NotebookEdit`) dal loro input, e i file che un comando `Bash` ha riscritto dal `bashEditDiff` del risultato (#265) — che è come Claude modifica in auto mode, e che i chip non vedevano affatto. Le raccoglie `touchedFiles` in `utils.ts` (`TouchedFile` porta `action` e `sources`; il verbo è l'**effetto netto** — `FILE_ACTION_RANK`: read < edited < created < deleted — così un file letto e poi modificato è un file modificato, uno creato e poi modificato è ancora nuovo), `mergeTouchedFiles` fonde i file di un turno con quelli della run di turni tool-only ripiegata su di esso (`buildRenderItems`), `changeRows`/`changeStat` in `file-view.ts` danno le righe e i numeri (gli hunk registrati quando ci sono, l'input altrimenti). Le letture **non sono cambiamenti**: restano i chip a icona (`FileChipCluster`), perché un turno che ha letto dodici file per modificarne uno deve mostrare l'uno. **La pill ha un interruttore** (`DiffGlyph`, terza cella del segmento MIN/FULL, `.cl-seg-icon`): attivo di default, piega e riapre tutti i diff insieme via `DiffsOpenContext` (`diffs-open.ts` — un context e non una prop: `MessageBubble` è memoizzato su una dozzina di prop e la strip sta tre componenti sotto, su turno e badge); un click sul singolo file vale finché l'interruttore non si muove di nuovo (reset dello stato locale durante il render, chiavato sull'ultimo valore visto — niente `setState` in un effect). La cella **changes** della pill se n'è andata: il totale e il per-file stanno in Mission Control. Coperto da `test/file-changes-strip.test.tsx` (StrictMode) e, per la metà pura, `test/file-view.test.ts` e `test/chat-utils.test.ts`
- **`FileWindow.tsx`** → `FileSheet` — Un tool su file (`Read`/`Write`/`Edit`) reso come **la finestra editor che era**, gemella della finestra terminale: stessa chrome (semafori, titolo centrato, striscia di stato, superficie dark fissa in entrambi i temi — `.cl-term.cl-term--file`), perché lettura e modifica sono l'altra metà della stessa sessione e il lettore le distingue da ciò che sta **dentro** la finestra, non da una chrome diversa. Il verbo in title bar (`READ`/`WRITE`/`EDIT`, `.cl-term-kind`) prende la tinta del tool (`TOOL_TINT`: ciano per Read/Write, viola per Edit) e un secondo tag `memory` sotto `~/.claude/…/memory`; poi **nome file in grassetto, che non cede mai** (`flex: 0 0 auto`: senza quella riga `b` ereditava `0 1 auto` e si stringeva insieme al path, e la barra diceva `build_report_ht… — …/-Users-…-Acme2.0/1f2e3d4c-…`) e, come meta, `…/dove/sta · lines 436–497` (o `replace all`) — dove `shortDir` **scarta segmenti dalla testa** finché quel che resta sta in 40 caratteri, perché l'ellissi CSS taglia l'altra estremità: di uno scratchpad dell'archivio sopravviveva l'hash del progetto e spariva `scratchpad`, l'unico segmento che diceva qualcosa. Il path **intero** non sta nella barra ma è a un gesto: la meta è un `button` che lo copia (e lo porta nel `title`), e in fullscreen è stampata per esteso — quella è la larghezza che la finestra inline non ha. Il corpo è una griglia gutter + riga (`.cl-file-row`): un **Read** stampa le righe con i numeri che Claude Code ha messo davanti (`   436→…` — reali, una lettura con `offset` parte dove parte il file), un **Write** dal numero 1 con righe **piatte** (`ctx`, non `add`: una scrittura è il file, non un diff del file — cosa che il gutter diceva già stampando il numero invece del `+`; marcarle `add` stendeva il velo verde delle righe aggiunte sotto tutte le righe di un file scritto e si portava via il contrasto di ogni colore di sintassi, su una superficie per cui la palette hljs è tarata), un **Edit** come **diff** `old_string → new_string` (righe tolte in danger, poi quelle che le sostituiscono in verde, contesto in mezzo; il gutter porta `−`/`+`, **niente numeri**: `old_string` dice cosa è cambiato, non dove). Il `The file … has been updated successfully.` del risultato **è la striscia di stato** (`updated · −1 +5`, `created · 42 lines`, `3 lines`, `running`), non un blocco RESULT; un errore (`String to replace not found`) si stampa sotto le righe come lo stderr sotto un comando, in danger, con la modifica tentata ancora sopra. Un risultato non numerato (immagine, `(no content)`) si stampa com'è. **Un file markdown ha una seconda lettura: il documento che è.** Un `.md` è prosa per costruzione e stamparlo come sorgente è lo stesso errore già corretto per una pagina fetchata: il corpo diventa un foglio di carta (`.cl-file-preview`, `--cl-paper`) dentro la stessa chrome — title bar, verbo, striscia di stato invariati — e la prosa la rende `<Markdown>` esattamente come nel transcript, fence compresi. **Un Write apre sul documento** (è quello che il turno ha prodotto), **un Read sulle sue righe numerate** (è una fetta di file, e il numero da cui parte è metà dell'informazione), un **Edit non ce l'ha**: un diff non si renderizza. Lo switch è una parola in title bar (`.cl-term-mode`, `Preview`/`Source`: nessun glifo dice quale delle due letture otterresti) e lo stato è in `FileSheet`, così inline e fullscreen mostrano la stessa. Il clamp resta quello delle righe ma misurato in pixel (420px), perché un documento renderizzato non ha righe da contare, con la stessa dissolvenza. Clamp **per specie** — 12 righe una Read, 24 una Write/Edit — con "Show all N lines" (mai uno scroller annidato): una modifica è la notizia del turno, una lettura è ciò che ha guardato strada facendo, la chiamata più frequente e meno informativa, e un turno di sei Read non deve essere sei lastre scure alte uguali (la leva da girare se "troppo"), ⤢ apre la stessa finestra a tutto schermo (`SheetModal`, condiviso col terminale), Copy copia il contenuto (o il `new_string`). Evidenziazione hljs **riga per riga** dalla estensione (`code-lang.ts`), come le righe di prompt del terminale: un costrutto multi-riga perde lo stato attraverso le righe, ed è il prezzo di righe clampabili, tinte e numerate una a una. Il diff di un Edit prende **gli hunk dello `structuredPatch`** che Claude Code scrive sulla riga `toolUseResult` quando ci sono (`result.patch`, letti da `session-reader` e recuperati dalla seconda passata di `transcript-extras` come `bashEditDiff`, #265): sono l'unica fonte con i **numeri di riga**, che `old_string` non dice; nella chat live, dove lo stream non li porta, resta il diff delle due stringhe (`lineDiff`)
- **`file-view.ts`** → `lineDiff`, `numberedRows`, `contentRows`, `lineRange`, `diffStat`, `shortDir`, `fileName`, `writeOutcome`, `splitLines`, `isFileTool`, `isMarkdownPath`, `FILE_TOOLS`, tipo `FileRow` — **Modulo puro** (unit-tested in `test/file-view.test.ts`) del rendering dei file tool. `lineDiff` è un LCS a livello di riga (`old_string`/`new_string` sono poche righe: la tabella quadratica non costa nulla; sopra i 400k celle degrada a "tutto tolto, tutto aggiunto", che è ancora un diff) e a parità emette la rimozione prima, così un blocco sostituito si legge `−` poi `+`. `numberedRows` legge i prefissi `N→` — e `N\t…`, la forma che Claude Code scrive oggi (ogni Read su disco da 2.1.241 in poi; il regex con la sola freccia disegnava quelle finestre senza numeri) — dell'output di Read (`null` se nessuna riga è numerata; una riga non numerata in mezzo a numerate resta senza numero). `splitLines`: `'a\nb\n'` sono due righe, non tre. `writeOutcome` legge `created`/`written` dalla frase del risultato — la stessa regola di `writeAction` in `chat/utils.ts`. `contentRows` numera dal 1 e lascia le righe `ctx`, `shortDir` tiene gli ultimi tre segmenti e poi ne scarta dalla testa finché stanno in 40 caratteri (l'ultimo resta sempre, lungo quanto è)
- **`code-lang.ts`** → `resolveLang` — estensione → linguaggio highlight.js, estratto da `atoms.tsx` (che esporta solo componenti, regola react-refresh) per servire sia il `CodeBlock` su carta sia la finestra editor
- **`MessageBubble.tsx`** → `ThinkingBlock`, `MessageBubble` — Singolo messaggio con testo, thinking, tool cards. Un `thinking` breve (≤ `THINKING_NOTE_MAX`, 600 caratteri, in `utils.ts`) è una **nota**: Claude Code tiene vuoti quasi tutti i thinking, e i pochi che salva sono aggiornamenti scritti per l'utente che il terminale stampa come un messaggio — nasconderli in MIN faceva sparire righe che il terminale mostrava. Quindi la nota è disegnata in linea in entrambe le densità, con l'etichetta `THINKING` e il filetto a sinistra in un grigio più tenue della risposta; un blocco lungo (ragionamento grezzo dei transcript vecchi) resta il toggle chiuso, solo in FULL. `describeTurn`, il bubble e `find` chiedono tutti a `thinkingNote`, così il descrittore non dà per vuoto un turno che il bubble poi disegna
- **`SubagentTranscriptPanel.tsx`** — Overlay col transcript interno completo di un sub-agente (`useSubagentTranscript`), reso con la stessa pipeline `buildProcessedMessages`+`MessageBubble`; ToolDetailPanel annidato per i tool interni
- **`ChatComposer.tsx`** — Barra in basso al layout Focus — **componente puramente presentazionale**: tutto lo stato della conversazione (subscription IPC, turno in volo, coda permessi, transcript) vive in `useLiveChat`; il composer possiede solo ciò che appartiene all'input: il draft, l'**autocomplete slash command** (popover `cl-slash-menu` sul draft `/token`, lista da `useEffectiveConfig(realPath).init.slashCommands`, nav ↑/↓/Enter/Tab/Esc; l'invio è nativo — l'Agent SDK esegue un `/comando` nel prompt), i due **selettori** della meta-row (`ComposerSelect`: **Model** — id ereditato dalla prop `model` + alias Sonnet/Opus/Haiku + Default, valore derivato con `chosenModel` null = segui la prop — e **Permission** `default`/`acceptEdits`/`plan`/`bypassPermissions`, quest'ultimo `danger`), (il picker, `ComposerSelect`, è esportato per l'anteprima del popup "What's new" v2.2.27, che lo monta aperto con `defaultOpen` e le opzioni vere di `composerModelOptions`) e il **`SendConfirmDialog`** pre-invio per i modi rischiosi (`CONFIRM_MODES` = solo `bypassPermissions`, consenso ricordato in `confirmedMode`). Send → `onSend(text, { model, permissionMode })` verso l'owner; Stop → `onStop`; `lockNotice` (settata da `LiveChatView` quando la sessione è viva nel terminale) disabilita input+Send e mostra il messaggio sopra la row; la richiesta di permesso in testa alla coda arriva come prop (`permRequest`/`permPendingCount`) ed è risposta via `onRespondPermission` (il dialog resta montato via **portal su `<body>`** così è rispondibile anche col workspace nascosto). `sessionId` presente/assente guida solo il copy (resume vs new). Usato esclusivamente da `LiveChatView`. **Superficie**: un solo **foglio di carta + hairline** (`cl-composer-sheet`), non più vetro — era l'ultimo `backdrop-filter` della superficie chat, rimasto indietro quando la direzione "Nastro" ha portato `cl-turns-capsule` — e allora anche `cl-pill`, poi tornata a vetro — a carta opaca. Il **rail dei controlli sta dentro il foglio**, diviso da una hairline: sotto di esso i tre badge sciolti leggevano come decorazioni della pagina, non come impostazioni di quell'input. Send/Stop sono **mono hairline** e prendono l'accento solo quando c'è qualcosa da mandare (uno slab accent pieno che passa la vita al 40% di opacità si legge come rotto, non come "in attesa"); i due picker perdono la pastiglia e diventano bottoni mono nudi con caret, separati da `·` — lo stile borderless è **scopato a `.cl-composer-meta`** perché `AgentsLiveView` riusa `.cl-composer-chip` come pill tra i suoi controlli di dispatch, dove la pastiglia è giusta. Il badge crediti scende da pill accent bordata a **testo con dot** (è un fatto dichiarato, non un controllo: bordato era l'elemento più urlato di una barra piena di comandi veri) e la scorciatoia tastiera vive nel placeholder (`⏎ send · ⇧⏎ newline`), cioè visibile esattamente quando serve. Nota: `.cl-dispatch-card` (Agents Live) dichiara di leggersi "come lo stesso componente" ed è rimasta a vetro — stessa anatomia (prompt + footer diviso da hairline), superficie diversa
- **`PermissionRequestDialog.tsx`** — Dialog overlay (stile `SendConfirmDialog`) mostrato quando l'Agent SDK chiede l'approvazione di un tool via `canUseTool`. Mostra `toolName`, `title`/`displayName`, `description`, e il dettaglio rilevante dell'input (`command` per Bash, `file_path`/`path`, altrimenti JSON); `pendingCount` mostra quante richieste sono in coda dietro questa. Tre azioni: **Allow once** (`{ kind: 'allow' }`), **Always allow** (`{ kind: 'always', suggestions }`, solo se l'SDK fornisce `suggestions`) e **Deny…** (apre un textarea opzionale per il messaggio che Claude vedrà → `{ kind: 'deny', message }`). **`AskUserQuestion` ha un rendering dedicato** (`QuestionForm`): le domande di chiarimento di Claude (`input.questions[]`) come opzioni cliccabili (radio/checkbox per `multiSelect`) + campo "Other…" free-text; Answer risponde `{ kind: 'allow', input: { questions, answers } }` — le risposte viaggiano **dentro l'input approvato** (chiave = testo domanda, valore = label scelte joined ", " o testo libero), perché un Allow pass-through lascerebbe le domande senza risposta; Dismiss = deny. Input malformato → fallback al rendering generico. La decisione torna al main via `respondPermission(requestId, …)`
- **`LiveChatView.tsx`** — Vista **chat SDK in-app** (`View` case `new-chat`): la conversazione live, guidata dallo stream. **Solo rendering**: tutto lo stato vive in `useLiveChat` (vedi riga dedicata) — la vista mostra `displayMessages` (transcript committato + bolla ottimistica + turno in volo) con `MessageBubble` `detailsFilter="minimal"`, un `LiveTurn` finale per il testo parziale / chip "Using X…", i metadati live (costo/token/modello dal `ChatTurnSummary` del `result` SDK) nella TopBar, e il `ChatComposer` presentazionale. **Due ingressi**: nuova conversazione (bottoni "New chat"/"SDK chat" di `ProjectOverviewContent`) o **resume di una sessione esistente** via prop `resumeSession` (azione **"Chat"** sulla riga sessione): il transcript è seedato con una lettura imperativa da disco al mount (mai una query watchata — niente refetch mid-turn), il composer eredita l'ultimo modello della sessione, il primo invio riprende lo stesso `.jsonl`. **Sessione viva nel terminale** (registro, via `useActiveSessions`): il composer è **locked** (`lockNotice` — rispondere qui gareggerebbe col CLI sullo stesso transcript), badge "Live in terminal" in TopBar, e il transcript **segue il disco** (`followDisk` di `useLiveChat`) così la conversazione del terminale scorre nella vista; il lock si scioglie da solo quando la sessione terminale finisce (il CLI aggiorna il registro all'uscita → push del watcher). Il registro esclude le sessioni SDK → la chat non si auto-locka mai. Keyed in `ProjectOverview` per `resumeSession.filename ?? 'new'`. **Trade-off voluti**: niente export/highlights durante la chat (riapri la sessione read-only in `ChatView`)
- **`useLiveChat.ts`** — **Hook: unico owner dello stato della chat SDK live.** Subscription mount-only ai canali `sessions:chat*` (payload a busta col `sessionId` produttore — gli eventi di una sessione non propria, es. il `chatDone` finale di una sessione superseded, sono **scartati**; l'id è adottato da `chatStarted`, emesso dal main prima di ogni evento stream), stato del turno in volo (`streamText`/`liveMessages`/`liveTool`/`permQueue`), transcript committato + bolla ottimistica (commit a `chatDone` leggendo i **ref interni** — niente hop cross-component che era il punto dove una risposta appena streamata poteva perdersi), azioni `send` (startMessage/sendMessage + rollback su fallimento pre-turno), `stop` (interrupt nativo), `respondPermission` (FIFO), `endChat` allo smontaggio. Modalità **resume** opzionale: seed del transcript da disco (`getChat` imperativo) + `sessionId` noto up front; con `followDisk` (sessione viva nel terminale, composer locked) il seed è ri-eseguito sugli eventi `data:changed` (debounce, mai con un turno in volo — `pendingRef` guard), così la vista segue il CLI finché non termina
- **`icons.tsx`** → `TrashGlyph`, `ChevronUpGlyph`, `DockCaretGlyph`, `LocateGlyph` — Glyph SVG inline (stroke `currentColor`) usati da pill e dock sheets
- **`LiveTurn.tsx`** — Turno assistant provvisorio mostrato durante lo streaming SDK (testo parziale + caret, o chip col tool in preparazione/esecuzione). Mirrora il markup `cl-turn--claude`. Usato da `LiveChatView` (la chat live; `ChatView` read-only non ha più turni in volo). Il chip stampa la **`description` della chiamata** quando c'è (`thought`, da `pendingToolThought`): `Show recent commits · Bash 3s` invece di `Using Bash`, che era l'affermazione vera più generica disponibile. Arriva un messaggio dopo l'inizio della chiamata — `ToolActivity` è emesso a `content_block_start`, prima che l'input abbia streamato — quindi il chip apre sul nome del tool e guadagna la frase poco dopo; il fallback non è uno stato degradato ma il testo onesto per una chiamata che non porta nota (ogni Read/Edit/Write, e quasi tutti i tool che non siano Bash). Non è la riga di commento (`ThoughtLine`, una superficie aggiunta da noi): è un chip che esisteva già e dice la cosa più vera che può
- **`thoughts.ts`** → `Thought`, `thoughtOf`, `dwellMs`, `collectThoughts`, `enqueue`, `advance`, `pendingToolThought`, `emptyQueue`, `THOUGHT_MAX`, `PENDING_MAX` — **Modulo puro** (unit-tested in `test/thoughts.test.ts`) del **commento in corsa**: la frase che Claude scrive per ogni chiamata (`input.description`) letta come narrazione. Vedi la sezione dedicata sotto per il perché di ogni regola
- **`useThoughtStream.ts`** — **Hook: una frase alla volta, temporizzata per la lettura.** La sorgente sono i `messages` che il chiamante ha già (la lettura watcher-driven del Lens, lo stream della chat live) — nessuna IPC e nessun watcher in più. La **coda vive in un ref e a renderizzare è l'orologio**: lo stato React è solo la frase a schermo e l'unico posto che la scrive è la callback del timer (`pump`). Non è un aggiramento della regola `react-hooks/set-state-in-effect` ma la forma onesta della cosa — una riga temporizzata è un sistema esterno con un clock, e questo hook lo pilota e lo ascolta; derivarla dai `messages` con un `setState` nel corpo dell'effect avrebbe anche ri-renderizzato a ogni raffica del watcher di una sessione che non aveva niente da dire. `until` è **assoluto**: l'effect ri-gira a ogni append, e re-armare il timer deve re-armare lo **stesso** istante, altrimenti una sessione attiva congelerebbe una frase a schermo (coperto da `test/thought-stream.test.tsx`, l'unico test che cade se la scadenza diventa relativa)
- **`ThoughtLine.tsx`** — La riga di commento, resa da `ChatControlPill` **dentro `.cl-pill-wrap`** e posizionata in assoluto sopra di esso. Il posto **è** il progetto: erediterebbe — ed eredita — ogni offset di fondo che il wrap già porta (Lens nudo, composer, composer locked) senza ridichiararne uno, sta fuori dal flusso quindi non può allargare la pill su cui galleggia (il wrap è `align-items: stretch`: una frase da 58 caratteri come figlio flex la stirerebbe), e cade dentro il padding che la colonna di lettura riserva già sotto il transcript — quindi non copre nessun turno e non muove niente. Iniettarla nel transcript non è mai stata un'opzione: quella lista è finestrata con misura per riga e bottom-pinned, e righe effimere litigherebbero con entrambi
- **`ContextRail.tsx`** — **I file che la sessione ha letto, sul bordo sinistro del Lens** (`cl-ctx-rail`), al posto della minimap dei turni (`FocusMinimap`, rimossa: un tick per turno diceva `03 Claude` e nient'altro). Stessa impronta — colonna da 64px, capsula — e stesso legame con lo scroll: **a riposo sono pallini**, uno per file, nella tinta di categoria dei chip file (`fileCategoryTint`), e quelli letti nel turno che si sta leggendo (`activeTurn`) sono pieni e anellati; l'etichetta ruotata è `READING` (non "context": nella pill quella parola è già la percentuale della finestra di contesto). Nessun nome a riposo, di proposito: lo spazio è quello dei turni e deve restarlo. **In hover** (o click/Enter sulla capsula) si apre la lista dei nomi raggruppata per cartella (`groupContextFiles`); **in hover su un nome** esce accanto un'**anteprima minimale** dell'ultima lettura — testa `nome · righe · turno`, poi le righe (14, sfumate), e **niente piede**: quante letture e con che comando stanno nella finestra del file. Lista e anteprima sono **carta satinata** (60% carta + blur leggero da 8px — più blur copre di più e si legge come meno trasparente — contorno a due filetti, la pagina resta sotto sfocata) e seguono il tema: **niente superfici scure**, l'app è su carta e le righe usano la stessa palette hljs dei diff sotto i turni (`.cl-ctx-code` è nel `:is()` del remap). **Nessun `title` nativo** sulle righe: l'utente li ha chiesti fuori, l'unico popup è l'anteprima. **Apertura e chiusura sono transizioni**, non un montaggio: il pannello cresce dal bordo della capsula (fade + un leggero slide/scale, 240ms in apertura, 160ms in chiusura) mentre la capsula si ritira sotto, e l'anteprima entra con un breve slide dalla lista. Per questo pannello e anteprima restano **montati** anche chiusi — il pannello `inert` (fuori dal tab order e dall'albero di accessibilità), l'anteprima con l'ultimo file mostrato, così svanisce dov'è invece di sparire. La chiusura aspetta 160ms, il tempo di passare dalla capsula al pannello. `prefers-reduced-motion` tiene solo il fade, `prefers-reduced-transparency` riporta carta piena. L'anteprima si posiziona **misurando la propria altezza** prima del paint (`useLayoutEffect`, `top` scritto sul nodo): sta accanto alla riga e sale quando finirebbe sotto la pill, cioè resta nella fascia del rail meno il suo padding inferiore. Una lettura dentro un **comando composto** (`wc -l a; sed -n 1,60p a`) ha comunque la sua anteprima — è ciò che il modello ha visto — ma **senza numeri di riga**, perché quell'output non è il file; la finestra lo mostra intero con una nota. (Una versione l'aveva sostituita con una frase: in queste sessioni i comandi composti sono tanti, e l'anteprima spariva quasi ovunque.) Click su un nome → apre la **finestra del file** (`ContextFileSheet`, sotto) e chiude il pannello dietro. Esc chiude e rende il focus alla capsula. Oltre la capienza del rail i pallini tengono i file letti più di recente e contano gli altri (`+N`); misurato: 7 file letti per sessione in mediana, 27 al p90, 94 al massimo. **Solo nel tab Lens** (`embedded`): la `ChatView` standalone non ha né questa né la vecchia minimap. L'altro posto che la monta è il popup "What's new" (v2.2.27), con `defaultOpen`: a riposo sono pallini che a chi non ha mai visto il rail non dicono niente, quindi l'anteprima apre sulla lista; hover, click e chiusura restano del lettore. Coperta da `test/context-rail.test.tsx` (StrictMode)
- **`ContextFileSheet.tsx`** → `ContextFileSheet`, `ReadLines` — **La finestra di un file letto**, aperta dal click sul suo nome nel rail, nel modal delle finestre fullscreen (`SheetModal glass`: backdrop, Esc, click fuori), in **carta satinata** come la lista e l'anteprima del rail da cui si apre — 60% carta + blur 8px, contorno a due filetti, carta piena con `prefers-reduced-transparency`. Il backdrop di una finestra `glass` tinge e **non sfoca**: un `backdrop-filter` annidato in un altro campiona la tinta piatta del livello esterno e non la pagina, e il satinato sembrerebbe pieno, 920px perché riguarda un file solo. Testa: icona, nome, **path intero** e un Copy; a sinistra **ogni lettura** in ordine (turno, righe — `spanLabel`, o `lines not stated` — e come, su una riga troncata); a destra la lettura selezionata: **una volta sola in testa** turno, righe e il comando intero, poi le **righe complete** (non clampate, scroll proprio); nel piede le **righe coperte in totale** (`coverageLabel`, intervalli fusi) e `Jump to turn N`, l'unico posto da cui ora si salta al turno. La selezione è **solo la tinta accent-soft** — niente anello (il focus va alla finestra, non a una riga: una riga focalizzata all'apertura portava l'anello da tastiera su una finestra aperta col mouse) e niente riga che si allarga col comando. Apre sull'ultima lettura. Di un comando composto mostra l'output intero **senza numeri** e con una nota che dice cos'è. `ReadLines` è la resa delle righe su carta, condivisa con l'anteprima. Nessun `title` nativo. Coperta da `test/context-rail.test.tsx`
- **`context-files.ts`** → `contextFiles`, `shellReads`, `groupContextFiles`, `readRows`, `numberedSpan`, `spanLabel`, `coverageLabel`, `nearestTurn`, tipi `ContextFile`/`ContextRead`/`ReadSpan`/`ContextGroup` — **Modulo puro** del rail (`test/context-files.test.ts`). Due fonti: un `Read` (path e righe sono fatti — i numeri stampati nel risultato) e un comando **Bash**, dove sta la gran parte delle letture (in questo corpus `sed`/`grep`/`cat` superano `Read` di due ordini di grandezza) e che quindi va **letto dal testo**, con prudenza: un comando con `bashEditDiff` ha scritto e non conta; si parsano solo `cat`/`nl`/`head`/`tail`/`sed -n`/`grep` su file nominati (mai `-r`, `-l`, `-c`, `sed -i` o `sed` senza `-n`), il primo stadio di una pipeline, i `cd` lungo la strada; heredoc, sostituzioni, variabili, glob e `~` non nominano **nessun** file piuttosto che uno sbagliato; le redirezioni cadono col loro target. L'intervallo si dichiara solo dove il comando lo dice (`sed -n a,bp`, `head -n N`, `tail -n +K`, `cat` = file intero) e **non attraverso una pipe**, perché lì il modello ha visto ciò che la pipe ha lasciato passare. E una lettura da shell è **`exact`** solo quando il comando era quella lettura — una istruzione (i `cd` a parte), un file, niente pipe: solo allora il suo output è le righe del file e si numera. Un comando composto stampa tutto ciò che fa, e numerarlo come il file metteva l'output di un `grep` o di un `wc` alla riga 840 di quest'ultimo. Provato sui 15.000 comandi Bash su disco: 4.901 nominano file, e dentro questo repo i path risolti che oggi non esistono sono worktree cancellate, non errori di parsing. Un risultato in errore o assente non è una lettura
- **`ChatControlPill.tsx`** — Pill flottante glass (`cl-pill`) coi controlli del transcript. **Superficie**: a 92% di carta la barra aveva smesso di essere una cosa appoggiata _sopra_ il transcript ed era diventata un pezzo di pagina che per caso galleggiava, quindi è tornata a vetro — ma vetro con **spessore**, non il bianco-al-60%-più-blur che prende qualsiasi card. Tre livelli e **un solo `backdrop-filter`**: `::before` filtra il backdrop (`blur(11px) saturate brightness` + `url(#cl-liquid-bar)`, la lente di dispersione a misura di barra dichiarata in `App.tsx` — quella di `.cl-btn` è tarata su 30px e su 600 si legge come grana), `::after` tinge e illumina, i figli stanno sopra a `z-index: 2`. Annidare un secondo `backdrop-filter` dentro il primo è il modo in cui un livello di rifrazione diventa silenziosamente un no-op: campionerebbe l'output già sfocato del primo e non avrebbe più gradienti da piegare — per la stessa ragione il blur resta moderato e `url()` sta **in fondo** alla catena. La tinta è la parte che regge, ed è **verticale**: densa sulla fascia dei glifi, sottile ai due bordi, cioè la barra è trasparente esattamente dove non c'è scritto niente. Non è solo estetica — le label sono mono da 9.5–10px su `--cl-ink-3`/`--cl-ink-4`, e `--cl-ink-4` è già scurito giusto per passare AA su bianco, mentre sotto la pill capita spesso una finestra tool scura: la fascia dei glifi non scende sotto l'82% di carta e la trasparenza si spende sopra e sotto. Gli stati attivi (chip modello, sheet aperto) guadagnano qualche punto di tinta e un anello hairline: su un corpo translucido un wash piatto non ha un bordo che lo tenga. `prefers-reduced-transparency` riporta la striscia opaca — rifrazione e gradiente _sono_ l'effetto, quindi cadono insieme invece di assottigliarsi in una superficie che non è né l'una né l'altra. **L'anatomia è fissa**: le stesse celle, nello stesso ordine, in ogni sessione — vedi la sezione dedicata più sotto. Controlli: **trova** + toggle densità Min/Full, e lo sheet Export/Delete — **niente filtri per tipo**, che non esistono più da nessuna parte nell'app (vedi la sezione dedicata). Alza **un solo sheet alla volta** (`'models' | 'export'`); registra un opener imperativo (`openExportRef`) per il bottone export per-turno. Estratto da `ChatView`. Porta anche le **tre cifre di Mission Control** (`vitals` + `changes`) — contesto, spesa e il **diff della sessione** — come prime celle dopo il chip del modello: stanno nel gruppo d'identità, non fra i controlli, perché dicono cos'è questa sessione e quanto costa esserlo, e il divisore dopo di loro è dove cominciano i comandi. Tengono il registro della pill (mono ~10px) e non le cifre da 21px della banda: questa è una superficie di controllo, non un cruscotto, e un numero da titolo qui urlerebbe più forte di ogni comando accanto. Quello che la dimensione toglie lo ridà il **gauge** da 26px: la percentuale è l'unica cifra della barra che ha un **tetto**, e il numero da solo non dice quanto le si è vicini — è di proposito l'unico grafico quantitativo della pill, e vira su `--cl-danger` con la cifra oltre il 90%, stessa soglia del rail. Le hover card sono le stesse (`terminal/VitalsPopover`, `placement="pill"`): **salgono** invece di scendere, animazione inclusa, perché una card già sopra il trigger che scivola in giù si legge come una card che cade _dentro_ la pill. Slot condiviso: la card sta dove sta la `ThoughtLine` e sotto qualunque sheet, quindi cede allo sheet (alzarne uno azzera anche la card, che altrimenti scatterebbe fuori alla chiusura) e toglie lo slot alla frase finché è su. Senza la prop `vitals` le due celle non esistono affatto — un host che non ha una riga di sessione da cui leggerle non dice niente. Il **diff** (`+N −M · K file`) sta con loro perché è ciò che la sessione **ha fatto**: stava sopra il feed di Mission Control, dove si leggeva come il titolo di una lista di eventi, e non è né l'uno né l'altro. Niente readout card: il feed del rail elenca già i file uno per uno, e inventarne un secondo posto sarebbero due liste. A zero **tiene la cella e dice `no changes`**: `+0 −0 0 file` sono tre zeri e non sono un'informazione, ma "questa sessione non ha toccato niente" lo è — e una barra le cui celle vanno e vengono è esattamente ciò che questa pill ha smesso di fare.

Porta poi il **trova-nel-transcript** (`find`): collassato è una lente larga come ogni altro controllo tondo, aperto è una casella che tiene l'altezza della pill. **Non si prende ⌘F**, che è del search globale nella top bar (`ProjectOverview`, listener su `window`): due cose che rispondono allo stesso tasto sono un bug che nessuno vede. ⏎ / ⇧⏎ passano al turno successivo e precedente, Esc chiude e svuota. Il contatore dice `"N turns"` per esteso e **mai** un `2/12` nudo: questa ricerca naviga turni, e `2/12` si legge come "match 2 di 12" per chiunque abbia usato una casella di ricerca. La logica sta in `find.ts` + `useFindLayer.ts`; qui c'è solo il controllo. `position` segue un **cursore proprio** del find (`findCursor` in `ChatView`), non `activeTurn`: lo scroll-spy riscrive `activeTurn` a ogni scroll, quindi il contatore cadrebbe da `3/12 turns` a `12 turns` appena il lettore scorre via dal hit, e sembrerebbe rotto. Lo **step** invece parte da `activeTurn` — "avanti" vuol dire il prossimo dopo dove sto leggendo — che è la metà che deve seguire lo scroll. Ospita anche il **commento in corsa**: la `ThoughtLine` sopra il wrap, **sempre attiva e senza toggle** — c'è stato un bottone `Notes` nella pill, tolto perché spegnere una riga che non costa layout e tace da sola quando non c'è niente da dire era un controllo per niente (e il suo posto in pill costava più della riga). Prima cella della pill: il **chip del modello** (`.cl-pill-model`) — con cosa si sta parlando adesso e a che **effort** — che è identità, non un controllo, quindi sta a sinistra di tutto il resto e lo etichetta. Il valore non è una proprietà della sessione: `/model` lo cambia a conversazione in corso e il transcript lo registra solo scrivendo un `model` diverso sui turni successivi, quindi il chip stampa **l'ultima** tratta di `collectModelRuns` (`chat/utils.ts`) e mai la prima. Una chat che ha cambiato modello — o effort, che si muove per conto suo: su questa macchina 3 transcript cambiano effort a modello fermo — porta `+N` e un caret: diventa un dock come agents/skills, e il `ModelDockSheet` elenca ogni tratta col turno da cui parte e quanti turni ci sono girati, con il locate che ci salta. Le etichette contano **tratte**, non modelli (`Model & effort · N runs`, tooltip "model or effort changed N times"): una tratta può nascere da un cambio di solo effort, e chiamarla modello sarebbe falso proprio nel caso che esiste sul disco. Tinta da `modelColor()` via `--mt`, la stessa dimensione-dato che codifica il chip per-turno: nessuna tinta nuova. L'effort arriva dalla **riga** di transcript, non da `message` (vedi `transcript-extras`), quindi manca sui transcript che non lo scrivono e il chip semplicemente non lo stampa invece di inventare un default

- **`useTranscriptModel.ts`** → `useTranscriptModel`, `TranscriptModel` — **Hook: derivazione del transcript Focus.** Da `processed` + `detailsFilter` + resolver tinta agent ricava `descriptors`/`renderItems`/`rows`/`rowIndexByTurn` (tutto memoizzato; la logica pesante — `buildRenderItems`/`buildRenderRows`/`computeFilterCounts` — è in `utils.ts`, unit-tested). `rows` sono le righe già risolte che il virtualizer itera, `rowIndexByTurn` traduce numero di turno → indice di riga per lo scroll
- **`ChatView.tsx`** — **Viewer read-only, disk-backed** di una sessione esistente — layout **"Focus"** (`cl-chat-workspace--focus`). `displayMessages = messages` (il read di `useChatSession`, memoizzato per stabilità referenziale), watcher-driven; **niente composer, niente stream** — la chat SDK live è una vista separata (`LiveChatView`) che non legge mai il disco. La derivazione del transcript è in `useTranscriptModel`, pill/minimap nei rispettivi file. Solo `TopBar` (back + titolo + toggle Chat/Timeline + tag + badge **"Live in terminal"** se la sessione è viva nel registro; il vecchio bottone "Continue chat" è stato rimosso — l'ingresso alla chat SDK è l'azione **"Chat"** sulla riga sessione, che apre direttamente `LiveChatView` in resume mode) sopra una **colonna di lettura** (`cl-chat-reading`) con gutter fissi e **asimmetrici**: 96px a sinistra — l'unica cosa da scansare e' il rail da 64px dei file letti (`ContextRail`, solo nel Lens), che sta in `position:absolute` sul bordo **sinistro** del feed — e 24px a destra, dove non c'e' niente da scansare; **senza cap** (`max-width: none`, anche su `.cl-transcript-inner`): erano 80px per lato piu' un tetto a 1560px, cioe' due terzi della larghezza disponibile con Mission Control aperta, e a pagarlo erano i diff. La prosa resta capped da `--cl-read-measure` (95ch, quanto puo' essere lunga una riga di testo), quindi allargare la colonna allarga finestre tool, diff, terminali e tabelle e non i paragrafi. Il composer (`cl-composer-inner`) segue la stessa geometria piu' i 30px della rail del turno, e si ferma alla misura di lettura: quello che si scrive atterra dove si legge. Il linguaggio visivo della superficie di lettura è la variante **"Nastro"** (design handoff _Lens variants_, sostituisce le "isole di vetro"): niente card e niente vetro — ogni turno è un **pallino di ruolo da 9px appeso a un filo verticale** (`.cl-turn-spine`, riabilitato con extra specificità perché ogni riga virtualizzata è figlio unico e il `:last-child` di base lo spegnerebbe ovunque), il corpo poggia sulla carta e si chiude con una **riga sottile allineata alla colonna di testo**; i tool sono una **colonna di finestre aperte** (`cl-tool-stack` in grid, 8px di gap: il terminale per una run di shell, l'editor per un file tool, una card col corpo già visibile per il resto — vedi `ToolGroupCard`); i chip inline che vanno a capo sopravvivono solo nelle strisce di MIN (`cl-tool-stack--chips`: un chip aperto — o che porta la striscia d'errore collassata, via `:has()` — si prende l'intera riga per avere spazio al pannello); il codice inline perde la pastiglia. Un **turno di continuazione** (assistant senza testo dopo un altro assistant) non ha né pallino né riga: il filo lo attraversa intero, così una sequenza di turni tool-only in densità Full non diventa una scaletta di filetti. `.cl-transcript-inner` in `cl-chat-reading` ha `gap: 0` — il ritmo lo dà il padding del corpo, e un gap flex spezzerebbe il filo nella live chat (il transcript finestrato posiziona le righe in assoluto e il gap non lo vede). Coerentemente `cl-turns-capsule` è passata da vetro a **carta opaca + hairline**; `cl-pill` ci è passata con lei ed è tornata indietro — vedi il doc di `ChatControlPill`: è l'unica superficie della vista che non appartiene alla pagina ma ci sta sopra. La **Mission Control rail** (`terminal/MissionRail.tsx`) è andata oltre Nastro fino al design **1d · Feed**: niente più blocchi per specie, un solo **flusso cronologico** di eventi con le sezioni demolite a **filtri** (vedi il doc del componente). I due numeri della riga vitals (context %, spend) sono **hover target** che fanno scendere una readout card (`terminal/VitalsPopover.tsx`): recuperano i dati che i vecchi blocchi CONTEXT WINDOW / SPEND stampavano fissi (`used · left · total`, `cache −$x · y% saved`, rimasti per una release come `title` nativi) e ci aggiungono la **composizione** — cache read / fresh input / cache write per il contesto, il mix di token per la spesa — come part-of-whole su rampa monocroma accent (`color-mix` contro `--cl-paper`, così la scala si inverte da sola nel tema dark). Le card sono `pointer-events: none` (non contengono controlli: catturare il cursore le terrebbe aperte dopo che il puntatore ha lasciato il numero) e i trigger sono `tabIndex`+`onFocus`, così il secondo livello è raggiungibile da tastiera. È chrome condivisa con la vista Terminal, e quello è esattamente il vincolo: **la banda vitals sta nel rail solo nel tab Terminal** (`showVitals`, passato da `TerminalMissionControl` come `view === 'terminal'`). Nel Lens le due cifre le porta la **pill** — è per questo che `ChatControlPill` ora prende `vitals` — e stamparle anche qui rimetterebbe la stessa cifra a schermo due volte a poche centinaia di pixel di distanza, cioè precisamente il motivo per cui la `TopBar` del terminale aveva smesso di stampare il `fmtCost` (lì resta solo l'indicatore RUNNING). Due copie della stessa cifra si leggono come due letture diverse. Nel Terminal la pill non esiste, quindi lì la banda resta ed è l'unico posto dove contesto e spesa sono dichiarati. Quando `showVitals` è falso **l'intera riga esce**, diff compreso (anche quello è andato nella pill): resta la hairline da 1px su cui la banda deve chiudere, al posto del **fill di contesto da 2px**, che se ne va con la cifra di cui è il misuratore — due pixel di barra residua si leggerebbero comunque come la misura di qualcosa. Col rail collassato, nel Terminal, la cifra non è a schermo (è dentro il rail, un toggle di distanza). I controlli vivono nella **pill flottante** (`ChatControlPill` → `cl-pill`): trova + toggle densità Min/Full + sheet Export/Delete (alza **un solo sheet alla volta**), preceduti dal gruppo d'identità — chip del modello, **contesto** e **spesa** (la cella **diff della sessione** non c'è più: totale e per-file stanno in Mission Control, e i diff stessi sotto i turni — `FileChangesStrip`). Il contesto lo deriva qui `deriveContext(messages, rawModel)` con lo stesso `useEffectiveConfig` che legge il rail (stessa query, quindi le due superfici non possono dissentire su quanto è pieno il finestra), la spesa è la `session` che la vista ha già. Transcript a **tutta larghezza** + nel Lens il **rail dei file letti** a sinistra (`ContextRail` → `cl-ctx-rail`, un pallino per file, acceso sul turno in lettura). La lista è **finestrata** (`@tanstack/react-virtual`): solo le righe attorno al viewport sono montate, con misura dinamica per riga (`measureElement` — le altezze dipendono dal contenuto) dentro un sizer `.cl-vlist` alto quanto l'intera sessione, così scrollbar e bottom-pinning continuano a vedere tutto il transcript. Conseguenze progettuali: `isContinuation` è pre-derivato in `buildRenderRows` (niente lookahead sui vicini), lo **scroll-spy legge la geometria del virtualizer** invece di un IntersectionObserver sui nodi montati, `jumpToTurn` usa `scrollToIndex` (e sgancia il bottom-pinning, altrimenti la misura successiva riporterebbe in fondo) e un cambio di densità **non** azzera le misure: `rowVirtualizer.measure()` sembra corretto (lo stesso turno ha altezze diverse in MIN e FULL) ma manda la posizione di lettura a spasso — collassa la lista sulle stime e l'ancoraggio finisce per essere calcolato su un layout inesistente. Le righe montate si rimisurano da sole e quelle sopra il viewport, tenendo la dimensione precedente, tengono ferme le offset; le sole mai visitate restano approssimate finché non entrano in vista. Per la stessa ragione **non** si usa `anchorTo: 'end'`: questo feed ha già un'ancora di fondo (il pin di `useAutoScroll`) e le due inseguono coordinate diverse — il DOM, che include i 140px di padding sotto la lista, contro `getTotalSize()`. Il `content-visibility: auto` su `.cl-transcript-inner > .cl-turn` resta ai transcript non finestrati (live chat, pannello sub-agente) e **non deve** raggiungere le righe virtualizzate: una riga fuori schermo riporterebbe `contain-intrinsic-size` invece dell'altezza reale. Trade-off accettati: la **ricerca nativa del browser** vede solo le righe montate — per questo la pill ha il suo trova (`find.ts` + `useFindLayer.ts`, scansione sui dati e pittura sul DOM, navigazione per turno); i hit sono filtrati ai turni per cui `rowIndexByTurn` ha davvero una riga, perché un turno che la densità corrente ripiega non è raggiungibile e offrirlo come destinazione sarebbe un passo che non fa niente. La selezione testo attraverso righe smontate non funziona; gli highlight fuori finestra vengono ridipinti quando la riga rientra (il MutationObserver di `useHighlightLayer`). Mantiene le affordance di lettura: export, highlights, timeline (`SessionGraphView`), tag, delete. **Non più il transcript di un sub-agente**: il `transcriptAgent` di questa vista aveva un solo produttore, il dock agenti della pill, e con quello se ne sono andati lo stato, il crumb `AGENT · …` e il pannello — il transcript di un sub-agente si apre dalla riga AGENTS del rail, che lo alza nell'overlay del frame. Per la stessa ragione `correlateSessionAgents`/`correlateSessionSkills` non girano più qui: li fa il rail, una volta sola. Overlay `ToolDetailPanel` (e Timeline) **non smontano il workspace**: resta montato nascosto (`chatHidden` → `display:none`) per preservare scroll/highlight-layer/scroll-spy quando l'overlay si chiude (al ritorno un view anchored è ri-pinnato dal ResizeObserver, uno detached torna al turno attivo). `ChatView` è **keyed per `session.filename`** in `ProjectOverview`. `embedded` (Terminal/Lens) è un sotto-caso di chrome (niente TopBar; è l'unico caso con il rail dei file letti)

**La pill ha un'anatomia fissa, e le tre cose che la facevano ballare sono
andate in Mission Control.** Agents, skills e Questions erano disegnati **solo
se la sessione ne aveva**: su una chat con tre sub-agenti e una skill la barra
metteva un dock qui e un chip là e andava a capo su due righe, mentre su una
sessione di sola lettura restava un moncone — l'unica superficie che deve stare
sempre nello stesso posto era l'unica che si muoveva. La distinzione che
risolve: quei tre sono **inventari** — cosa ha usato questa sessione, cosa ha
chiesto — non controlli, e un inventario ha una data e un esito, cioè è un
evento. Il posto degli eventi è il feed del rail, che li ordina e li data già.
AGENTS e SKILLS erano **già** specie del feed; QUESTIONS è stata aggiunta (sotto).

**Anche i filtri per tipo sono andati, e con loro l'intera funzione.** Restava
`Thinking`/`Plan` dopo che `Questions` era passata al feed, e nessuna delle due
forme possibili funzionava: un chip sempre presente legge `THINKING 0`, cioè è un
controllo per niente, e un chip che compare solo a conteggio non nullo è
l'anatomia mobile da capo. Non c'è una terza opzione, quindi il filtro è stato
rimosso dall'app invece di essere tenuto come cella sbagliata in uno dei due
modi: via `TurnFilter`, `TurnFilterCounts`, `computeFilterCounts`, la
derivazione `activeFilter`/`matchesFilter` in `ChatView`, il prop `dimmed` di
`MessageBubble`/`ToolsHiddenBadge`/`AdvisorBadge`, il `matches` della
`FocusMinimap` e le cinque regole `[data-dim]` in `index.css`. Con loro sono
caduti i sette flag `has*` di `TurnDescriptor`: `hasThinking`/`hasQuestion`/
`hasPlan` erano del filtro, gli altri quattro non avevano già più un lettore.
Resta il **toggle densità**, che è un'altra cosa — non sceglie quali turni
contano, dice quanto di ogni turno si vede.

Cosa resta, sempre e nello stesso ordine: `modello effort │ ctx spesa │ diff │
trova │ MIN FULL │ ⌃`. La cella che può leggere zero **lo dice invece di
sparire** — è la regola che la cella del contesto applicava da sempre stampando
`—` al posto di uno zero che non ha misurato: il **diff** a zero legge
`no changes` (`.cl-pill-diff.is-none`), non `+0 −0 0 file`.

**La barra andava a capo per un bug di larghezza, non per troppe celle.**
`.cl-pill-wrap` è `position: absolute; left: 50%` con `translateX(-50%)`: per un
box assolutamente posizionato con `width: auto` la shrink-to-fit si calcola sullo
spazio **a sinistra del suo bordo destro**, cioè su metà contenitore — la barra
era quindi limitata al 50% della colonna di lettura e andava su due righe con
centinaia di pixel liberi accanto. Il `translateX` la sposta dopo, non le
restituisce larghezza. Il fix è `width: max-content` sul wrap (più il cap
`min(--cl-read-col, 100vw − 40px)` che le impedisce di uscire dalla colonna su
una finestra stretta); `flex-wrap` resta sulla pill come valvola per quel caso.

Conseguenze da conoscere:

- **`ChatView` non correla più agenti e skill** (`correlateSessionAgents` /
  `correlateSessionSkills` girano nel rail, una volta sola) e ha perso il
  pannello del transcript sub-agente: il dock ne era l'unico produttore.
- **La `ChatView` standalone non è più raggiungibile.** Senza rail non avrebbe
  nessuno dei tre, quindi i due ingressi che ci arrivavano — un hit di
  `SearchView` e la origin session di una memoria — aprono ora `terminal`. Il
  case `terminal` porta per questo `focusMessageUuid` (il deep-link al turno,
  inoltrato alla `ChatView` embedded) e il ritorno di chi l'ha aperto
  (`searchQuery`, `memoryTopic`), che sopravvive anche saltando a un'altra
  sessione. `SearchView` **non cambia**: risolve ancora la `SessionSummary` vera
  e rifiuta una sessione che non c'è più — è ciò che asserisce `test/search-view`.
  Il case `chat` resta in `types.ts` senza produttori, così toglierlo — insieme a
  tutta la metà `!embedded` di `ChatView` — si potrà leggere come diff a sé.

**Mission Control — la specie QUESTIONS** (`terminal/mission-feed.ts` →
`questionEvents`, righe `?` in tinta `--cl-warn`, la stessa che il transcript dà
già alla `AskQuestionCard`; filtro fra SKILLS e MEMORY). Una riga per chiamata
`AskUserQuestion`:

- **titolo** la prima domanda, **meta** la risposta che è stata scelta — che è il
  fatto per cui uno guarda: il vecchio chip in pill poteva solo dire quante
  domande c'erano. Il conteggio si stampa solo quando una chiamata ne portava più
  d'una (`2 questions · A · Rail`).
- **stato a destra** `ANSWERED` / `NO ANSWER` (l'utente ha chiuso e ha continuato
  a parlare) / `PENDING` — i tre stati **sono quelli della card nel transcript**,
  non nuovi: risultato assente → pending, risultato senza risposte parsate che si
  legge come rejection → dismissed, il resto → answered. `PENDING` è l'unico
  tinto: è l'unico che sta ancora aspettando qualcuno.
- **il click salta al turno** (`onLocateTurn` → `jumpToTurn` del frame, che
  rivela il Lens se si è su Terminal). Non apre un
  pannello: la domanda con tutte le sue opzioni e quella selezionata è già
  disegnata nel transcript, e un `ToolDetailPanel` generico mostrerebbe meno.
- **l'ask intero sta nel tooltip** (`FeedEvent.hint`): a 380px il titolo tronca,
  e ogni domanda con la sua risposta deve restare recuperabile senza aprire nulla.
- **Nessuna riga è mai `live`, nemmeno una pending** — la stessa linea che tiene
  il `PENDING` di WEB. Una chiamata senza risultato su disco può essere una
  sessione ferma ad aspettarti adesso o una CLI uccisa a metà domanda una
  settimana fa, e il transcript non sa distinguerle; `live` flotta la riga sopra
  tutto e le dà la tinta del vivo, cioè afferma proprio quello. Non costa
  salienza: una domanda davvero aperta è l'ultima cosa scritta, quindi
  l'ordinamento newest-first la mette già in cima — perché **è** la più recente,
  che è un fatto, e non perché abbiamo indovinato che fosse attuale.
- Una chiamata da cui non si legge nessuna domanda **non produce una riga**, la
  stessa regola con cui la card nel transcript non si disegna.

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
- **Niente arretrato mentre è nascosta.** Con `enabled` a false il diff gira
  comunque, così le chiamate passate nel frattempo sono marcate narrate e
  riaccendere la riga riparte dal presente invece di srotolare il perduto. Oggi
  nessuno la spegne — `ChatView` passa sempre `true` — ma il parametro resta:
  è il contratto dell'hook, non della pill, e i test lo coprono.
- **Non si chiama "thinking" da nessuna parte nella UI.** L'app rende già i
  blocchi `thinking` veri (`ThinkingBlock`), e questi sono un'altra cosa: la
  descrizione di un'azione, non il ragionamento del modello. Confondere i due
  nomi peggiorerebbe entrambi.

**La riga è sempre accesa, senza preferenza.** C'è stato un toggle `Notes` in
pill (`useThoughtsShown`, chiave `cl-thoughts-hidden` in `prefsBackend`, flag
negativo così una preferenza assente leggeva come accesa): tolto, insieme alla
chiave e al glifo, perché la riga non costa layout e tace da sola quando non
c'è niente da dire — un interruttore per spegnerla era un controllo per niente
e occupava un posto nella pill. Un `cl-thoughts-hidden` rimasto in
`preferences.json` da una build precedente è inerte: nessuno lo legge più.
Coperto da `test/thoughts.test.ts` (26 claim sul modello puro) e
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

**Mission Control — il dock MESSAGES** (`terminal/mission-messages.ts` +
`terminal/MessagesDock.tsx`): le conversazioni della sessione — con altre
sessioni e con gli agenti dentro di sé — **fuori dal feed**, appuntate sotto di
esso come l'`EnvironmentStrip`. Prima non comparivano affatto nel rail: che
qualcuno avesse scritto alla sessione si scopriva scorrendo il transcript in
cerca di `⇢`. **Perché non una specie del feed**: una riga di feed è
un'operazione con un esito (un glifo, una riga, uno stato), un messaggio è una
battuta di una conversazione — la domanda del lettore è "con chi sta parlando
questa sessione e qual è stata l'ultima cosa detta", che è la forma della
sidebar di un messenger, non quella di un log. Quindi si raggruppa per
interlocutore: monogramma tondo nel colore che un messaggio porta nel
transcript (accent per una sessione, ink per un agente interno), nome, cosa
l'altra parte È, l'ultima battuta con la sua direzione (`⇣`/`⇡`) e il conteggio;
`N received · N sent` sta nel `title`, non in una quarta colonna. **Nessuna IPC
nuova**: entrambe le metà sono già in `processed` — la ricevuta è un turno con
`inbound` (#274), la mandata un tool group `SendMessage` (`chat/sent-message.ts`).

Il modello è puro (`buildMessageThreads`, `test/mission-messages.test.ts`) e la
parte difficile è **chi è l'interlocutore**: il nome è una sua pretesa e cambia
da solo, il pid che il ricevente ha verificato sul socket no. Quindi un thread è
chiuso **sul pid** ogni volta che un lato ne dà uno (`origin.pid` in entrata,
`uds:/tmp/cc-socks/<pid>.sock` in uscita), e un messaggio indirizzato solo per
nome entra nel thread del processo che quel nome **ha dichiarato ricevendo** —
altrimenti resta sotto il nome, che è onesto: niente lo legava a un processo.
Gli agenti si chiudono sul nome, non c'è pid da verificare. L'etichetta è
l'ultimo nome **dichiarato dall'altra parte**; quello con cui l'abbiamo
chiamata vale solo finché non parla. Click → `onOpenExchange(msgId)` quando il
thread ha un id da unire (una sessione dall'altra parte), altrimenti
`onLocateTurn` sull'ultimo messaggio: un agente interno non ha uno scambio.
Vista coperta da `test/messages-dock.test.tsx` (StrictMode).

**Shell in background — nella top bar, non in Mission Control**
(`terminal/background-shells.ts` + `terminal/BackgroundShells.tsx`). Il "1 shell"
che la CLI stampa nel suo footer: i comandi che Claude ha lasciato girare
(`run_in_background`, o spostati dall'harness allo scadere del timeout). Sta
**accanto a RUNNING** nella `TopBar` di `TerminalMissionControl`, visibile da
Terminal e da Lens, perché è **stato** della sessione e non un evento: una prima
versione dentro il rail (un riquadro a terminale sotto i vitals, poi una riga
del feed a fine corsa) è stata scartata dall'utente — troppo tecnica, e si
confondeva con i dati del feed. La pillola parla a parole (`1 in background ·
12 min`, poi `Finished`/`Failed`/`Stopped · 3 min ago` per 10 minuti) e al click
apre un elenco con la `description` di ogni comando e da quanto gira o quando è
finito (`Finished 9 min ago · ran 20 min`: prima il quando, poi la durata —
"Finished after 20 min" si leggeva come "20 minuti fa"). Il comando e il resto
stanno **in una finestra che galleggia sopra la sessione**
(`terminal/BackgroundShellSheet.tsx`), la stessa anatomia e la stessa carta satinata
della finestra di un file letto (`ContextFileSheet`, via `SheetModal`: backdrop,
Esc, click fuori): barra con stato e titolo, a sinistra la colonna dei fatti
(ora di inizio e di fine, durata, exit code, come è finita in background —
chiesto da Claude o spostata allo scadere del timeout, letto dalla frase del
risultato — e se l'ha fermata Claude con `TaskStop`), a destra il comando in
righe numerate su carta (`PaperCode`, esportato da `ContextFileSheet`),
copiabile. Niente piede: il path del file di output c'era, ed è stato tolto
perché non serviva a nessuno. Due forme
sono state scartate: i dettagli dentro il popover (380px non bastano a un
comando vero) e una pagina nell'overlay del frame, che si sostituiva alla chat.
La finestra tiene l'id della chiamata, non la shell: la legge fresca a ogni
lettura del transcript, quindi una aperta mentre gira diventa il suo esito sul
posto, e resta aperta anche se la pillola sparisce. Niente "Show in chat": la
pillola esiste solo nella sessione che ha lanciato la shell, quindi la chat è
già quella a schermo. L'output non c'è: la notifica non lo porta.
Regole, misurate sulle 122 shell in background del corpus:

- la shell si riconosce dal **risultato** del `Bash`, che nomina il task id in
  due frasi (`running in background with ID: …`, `moved to the background (ID:
…)`), non da `run_in_background`, che la seconda via non porta — e la frase
  deve **aprire** il risultato: più avanti è l'output di un comando che la cita
  (un grep sui transcript, il `cat` di una fixture), e contarlo lasciava "in
  corso" fino alla fine del processo una shell che nessuna notifica chiuderà;
- finisce con la `<task-notification>` che porta il suo **`tool-use-id`**
  (`completed`/`failed`/`stopped`/`killed`, exit code nel summary: un
  `completed (exit code -1)` è un fallimento) **oppure** con un `TaskStop`
  riuscito sul suo task id, che **non scrive nessuna notifica** — senza questa
  regola ogni shell fermata così resterebbe "in corso" per sempre;
- senza nessuna delle due è in corso **solo se l'ha lanciata il processo CLI
  che gira adesso**: la shell è sua figlia, e una partita prima — una sessione
  ripresa si porta dietro le shell del processo uscito — è morta con lui. Il
  momento di avvio viene dallo `startedAt` del registro (la voce di questa pane,
  altrimenti quella del processo che la gira altrove) e, finché la CLI non vi si
  è iscritta, dall'istante in cui la pane ha avuto il pid. Nessun processo vivo
  → nessuna pillola. L'avviso di recupero che Claude Code scrive al resume non
  basta: arriva tardi ed elenca più task id, di cui `parseTaskNotification`
  tiene il primo. Un `exit code 144` resta un fallimento: sui 6 casi su disco
  nessuno segue un `TaskStop`, e la CLI stessa li marca `failed`;
- l'elenco sta in un **portal su `<body>`**: la top bar è un contesto di
  sovrapposizione suo (`backdrop-filter`), e un pannello disegnato lì dentro
  finirebbe sotto il terminale.

Legge la stessa query `sessions:chat` del rail, quindi nessuna lettura in più.
Coperto da `test/background-shells.test.ts` e
`test/background-shells-view.test.tsx` (StrictMode). Solo per le sessioni
locali: la pane remota (#294) non la monta.

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

> La lista dei topic della vista `project-memory` è renderizzata da `ProjectView` (`overview/ProjectOverviewContent.tsx`, `section === 'memory'`) con `cl-mem-rows`/`cl-mem-row` — **non più** le `cl-tile` di Skills/Agents (design 2b): una memoria non è un elemento di catalogo, e il glifo con l'iniziale ripeteva la prima lettera del nome che gli stava accanto. Al suo posto un **pallino di tipo** (`MEMORY_TYPE_TINT`, la stessa tinta della mappa, anellato quando la memoria è l'hub del proprio gruppo). Filtri, tag gestiti, sort e group-by restano dov'erano: la forma cambia, le funzioni no.

**La riga è una riga sola, e la descrizione si legge sostando** (ridisegno di settembre 2026, nato da «troppo incastrato, difficile da capire a primo impatto», poi «leverei l'anteprima in basso, la aprirei facendo hover»). Titolo coi tag gestiti **accanto**, come una riga di sessione porta i suoi hashtag; a destra due colonne mono: `cited by N · hub` **solo quando c'è** (la cella resta, così le date si allineano) e la data (en-US, come ogni altra data dell'app: `tileDate` stampava mesi it-IT). La descrizione non sta nella riga: sostando sul titolo si apre la **stessa `MemoryPeekCard` della mappa** — `useMemoryPeek(memGraph, MEM_ROW_PEEK)`, stessa attesa di 420ms, subito sul focus da tastiera, chiusa su scroll/Escape/click — che dice tipo, nome, descrizione intera (clamp portato da 3 a 5 righe: da quando la riga non la stampa più, la card è l'unico posto dove la si legge senza aprire la memoria) e `cited by · cites · cluster`. La card ha preso un `PeekPlacement` per questo: sulla mappa è centrata sul nodo e preferisce stargli **sopra**, su una riga parte dal bordo sinistro del titolo (`anchorOf` ancora al `.t-name`, non alla riga: centrata sulla riga finiva a metà schermo) e preferisce stare **sotto**, come un'espansione della riga; `schedulePeek` accetta un `Element` qualunque, non più solo un `SVGGElement`. Niente più toggle newest/oldest: si ordina per data di creazione, più recenti in alto, e basta. La forma precedente (design 2b) metteva sotto il titolo la descrizione in mono a 11px troncata a 70 caratteri, l'arco intero a parole (`↑ cited by 4 · cluster hub ↓ cites <nome> +2`, in `--cl-accent-ink`, la cosa più forte della riga dopo il titolo e la meno leggibile), i tag su una **quarta** riga con 23px riservati anche dove non c'era nulla, e ripeteva il tipo a destra in parola oltre al pallino: quattro registri mono da 10px uno sull'altro. Che cosa una memoria **cita** non sta più nell'elenco — lo dice la card (`cites N`) e lo disegna l'orbita del dettaglio; `relationSummary.cites` resta nel modello per quello. Il tipo è ora **solo il pallino**, e la sua chiave è la riga sopra l'elenco.

**Una riga sola sopra l'elenco, al posto di tre fasce.** Prima della prima riga c'erano la testata, la fascia dei totali del grafo, e la toolbar tag + group-by: tre filetti in 90px, e il numero 15 stampato tre volte (`15 topics`, `15/15 connected`, `all 15`). Ora i totali stanno nel `.ct` della testata (`15 topics · 22 links · 5 clusters`, e nella testata non c'è più il toggle del sort) e sotto c'è una riga `cl-mem-toolbar` senza filetto proprio — il filetto d'inchiostro delle righe subito sotto è la sua linea — con a sinistra `cl-mem-filters`: **`all N`**, la **legenda dei tipi** (`cl-mem-type`, un pallino + il nome + il conteggio per ogni tipo presente, nell'ordine della mappa) che è anche un **filtro** (`memTypeFilter`, indipendente da quello per tag: si sommano, e `all` azzera entrambi — una chiave con i conteggi accanto che non facesse nulla al click sarebbe stata l'unico chip inerte dell'app), poi i tag gestiti dietro un filetto verticale (`TagBar` con `showAll={false}`, prop aggiunta per questo: due "all" su una riga sarebbero stati due gruppi radio a dire la stessa cosa); a destra il group-by. Il tipo attivo prende la velatura neutra dell'hover e non quella d'accento — l'accento è di `all`, e un pallino tinta dentro una velatura terracotta erano due colori a dire una cosa. Con group-by Type la testata del gruppo porta il pallino del suo tipo (`memGroups[].tint`) e **non ha più il filetto sotto**: quello d'inchiostro delle righe a 8px di distanza faceva una tabella con una riga vuota. La toolbar appare da due memorie in su, la stessa soglia del toggle List/Graph.

**Due lenti sugli stessi dati** (toggle `List`/`Graph` nella testata della subtab, stato `memLayout` locale alla vista). Le memorie **già contengono** `[[wikilink]]` scritti a mano nel body: nessuno li leggeva, e sono l'unico segnale di relazione che qualcuno ha davvero affermato. Il modello è puro in `memory/graph.ts` e **non costa I/O** — `MemoryData.topics` porta già il contenuto di ogni topic al renderer, quindi è una regex su testo in memoria.

**Un solo grafo per le due viste**: `memGraph` è memoizzato in `ProjectOverviewContent` e passato a `MemoryGraphView` come prop (che non lo costruisce più da sé). Non è solo lavoro risparmiato — è ciò che impedisce alle due lenti di divergere: l'elenco stampa gli stessi totali che apre la mappa (`N links · M clusters` nella testata, e i connessi in fondo: `All N connected` o `N unconnected`) e chiude con lo stesso debito (`M suggested affinities — see Graph`), quindi passare da una vista all'altra cambia la forma e mai i dati.

- **`graph.ts`** → `buildMemoryGraph`, `layoutMemoryGraph`, `neighborhoodOf`, `relationSummary`, `nodeRadius`, `graphLabel`, tipi — Modello puro: risoluzione wikilink → `links`, community detection → `clusters`, affinità di parole → `affinities`, layout deterministico a orbite. `relationSummary` è la stessa relazione detta a parole (`inDeg`/`outDeg`/`isHub`/`cites`/`clusterLabel`) per la forma a righe, dove non c'è una posizione da leggere. Unit-tested (`test/memory-graph.test.ts`) + sonda sugli archivi reali (`test/memory-graph-real.test.ts`)
- **`MemoryGraphView.tsx`** — La mappa (design 3a): **un sistema di orbite per cluster**, hub al centro con un anello proprio, hover card dopo 420ms. Nessuna freccia (vedi sotto). Coperta da `test/memory-graph-view.test.tsx` (orbite, anello dell'hub, elenco dei non collegati, canvas assente quando nulla è collegato) e `test/memory-graph-peek.test.tsx` (la card), entrambe montate in `React.StrictMode`
- **`MemoryOrbit.tsx`** — Il vicinato della memoria aperta, montato in `viewExtras` del suo detail: orbita interna = relazione diretta, esterna = secondo grado. Qui **le frecce ci sono**. Stessi segni della mappa — riusa le classi `cl-memgraph-*` (nodo vuoto col bordo del tipo, anello sul centro, etichetta verso l'esterno, secondo anello solo se abitato) — ma **tarato sulla rail**: viewBox largo 280 con `max-width` in CSS, così un'unità disegna ~un pixel dentro i 320px della colonna, etichette a 18 caratteri e portate dentro il canvas quando il satellite sta sul bordo, anello quasi tondo (0.8) che si allunga in verticale se il giro ideale non ci sta in larghezza. Il fuoco **non ha etichetta**: il suo nome è il titolo della pagina, e sotto il centro passano i satelliti della metà bassa. Una memoria senza relazioni lo dice (`Unconnected`) invece di far sparire il pannello, e se i suoi wikilink ci sono ma non arrivano a una memoria li nomina — la tape lì accanto li conta (`parseMemoryContent` somma `[[wikilink]]` e link markdown), e «it cites none» la smentirebbe. Le due orbite hanno un tetto di larghezza ciascuna (`SIDE_GAP`): con sette vicini diretti finivano sullo stesso semiasse e si toccavano ai lati. Stessa card di hover della mappa (`useMemoryPeek`), su ogni nodo, fuoco compreso: dice gruppo e conteggi, che la pagina non ha. Coperta da `test/memory-orbit.test.tsx` (StrictMode)
- **`MemoryPeekCard.tsx`** → `MemoryPeekCard`, `PeekAnchor`, `PeekPlacement` (+ **`useMemoryPeek.ts`**) — Card di hover in portal su `<body>`, `pointer-events: none` come le `VitalsPopover`: titolo intero (sulla mappa è troncato a 24 char), descrizione, `cited by N · cites N · cluster`. `useMemoryPeek(graph, placement?)` è lo stato che la governa — attesa di 420ms, apertura immediata sul focus da tastiera, chiusura su scroll/resize e allo smontaggio — condiviso da mappa, orbita e **righe dell'elenco** (che passano `{ align: 'start', side: 'below' }`: la card parte dal titolo e sta sotto la riga; mappa e orbita restano centrate e sopra)

Decisioni prese sui dati veri, non a priori:

- **I `[[wikilink]]` sono gli archi, la somiglianza di parole no.** Il keyword matching sugli stessi 33 topic di ClaudeLens dava 41 archi su 25 nodi a soglia bassa (la nuvola indistinta) e ~55% di precisione a soglia alta. Vive separato in `affinities` — reso **tratteggiato**, mai promosso a link: scrivere una relazione resta un gesto esplicito nel file, la vista non scrive mai su disco. Le stopword includono il vocabolario di dominio in **italiano e inglese** (`progetto`, `memoria`, …): senza, accoppiavano `duplicate_merge` con `icloud_dataless` per pura ripetizione.
- **I cluster sono comunità per modularità (Louvain), non componenti connesse.** Le componenti connesse separano solo ciò che è del tutto scollegato: su Acme2.0 (43 memorie, **1,91 archi per nodo**) un solo arco fra due temi fondeva tutto in **un'isola da 39 nodi** — l'hairball che `feedback_dataviz_principles` vieta — mentre ClaudeLens (0,85) sembrava a posto. Con la modularità: Acme2.0 → 10 gruppi nominabili, 71% degli archi interni; ClaudeLens → 7 gruppi, 86%.
- **L'ordine di visita è canonico, non quello di arrivo.** I topic vengono da un `readdir`, il cui ordine non è garantito fra filesystem, e la fase locale di Louvain dipende dalla sequenza: permutando l'input la partizione cambiava su 2 archivi su 6. Ordinare nodi, candidati, archi, affinità (coppie normalizzate) e `nodes` rende il grafo **funzione del solo contenuto** — la garanzia che rende la mappa imparabile a memoria.
- **Le isole sono ordinate per affinità reciproca** (greedy: si accoda quella con più archi verso le già collocate), e gli archi **fra** gruppi sono smorzati a 0.16: il ~30% che attraversa resta leggibile in hover ma smette di coprire la struttura.
- **Frecce solo nell'orbita.** Su una mappa d'insieme il verso di decine di archi è rumore e il diametro del nodo già codifica `inDeg`; davanti a **una** memoria la domanda è invece "è una fonte o una conseguenza?".
- **Il gruppo è un'orbita, non un riquadro** (design 3a). Il rettangolo tratteggiato dichiarava un confine senza dire nulla di come il gruppo fosse fatto; l'ellisse ha il centro **sull'hub** e passa **per** i satelliti, quindi disegna la sola cosa che la disposizione codifica. Per questo `MemoryIsland` espone `cx/cy` + `rx/ry` + `innerRx/innerRy` invece di lasciarli dedurre dal riquadro: `x/y/w/h` è il box che impacchetta gli scaffali, e derivarne il centro sbaglierebbe di tutto il padding (`PAD_X` 86, `PAD_Y` 44). Il **secondo anello si disegna solo se `twoRings`**, cioè se dei satelliti ci stanno davvero sopra (>7): un'orbita vuota sarebbe una struttura affermata e non presente. Il riquadro e le sue etichette (`cl-memgraph-island*`) non esistono più — il nome del gruppo è già l'etichetta in grassetto del suo hub.
- **Due misure tarate sul riquadro sono cadute appena l'anello è diventato visibile.** Il raggio minimo era `96` fisso, cioè il caso peggiore di _etichette_ da separare lungo il giro, applicato anche a un gruppo di tre nodi che di etichette ne ha due: sotto il riquadro non si notava, come orbita era un cerchio vuoto per tre quarti. Ora `ringGeometry(m)` parte da `MIN_RING` 74 (l'hub + la sua etichetta + il satellite più vicino, che è il vero vincolo) e per `m ≤ 3` usa un rapporto quasi tondo (0.8 invece di 0.62): lo schiacciamento serve a distribuire etichette larghe lungo il perimetro, e con due satelliti non c'è nulla da distribuire. Stessa storia per l'etichetta del satellite, che stava **sempre sotto** il nodo: nella metà alta dell'anello finiva scritta sul tratteggio, quindi ora va **verso l'esterno** — sopra nella metà alta, sotto in quella bassa, e sotto per l'hub, che sta sul centro e non ha un fuori.
- **Il nodo è un cerchio vuoto col bordo del tipo, non un pallino pieno.** Il riempimento è la carta, quindi copre il tratteggio dell'orbita dove la incontra: il nodo ci sta **sopra** come una perla sul filo invece di sembrarne trafitto — che è ciò che il mock 3a ottiene disegnando anelli puramente decorativi, dentro ai satelliti, e che qui si ottiene tenendo l'orbita vera. Il vuoto ha imposto la seconda taratura: `nodeRadius` parte da 7.5 (era 4.5), perché a 4.5 un bordo da 2px è quasi tutto bordo. La mappa si rende a tutta la larghezza della finestra, quindi un nodo da 4.5 unità finiva in ~5px e si indovinava invece di leggersi; le etichette sono salite a 10px (11.5 per l'hub) e da `ink-3` a `ink-2`. `MemoryOrbit` condivide `nodeRadius` e le stesse classi, ma **non le stesse misure di canvas**: disegnava un viewBox da 620 dentro una rail da 320px, cioè a scala 0,43 — etichette da 10px rese a 4, nodi da 7.5 a 3 — e la stessa codifica, scalata a meno di metà, non si leggeva. La taratura è la stessa storia all'inverso: il viewBox è largo quanto la colonna (280) e il CSS gli vieta di crescere quando la rail collassa sotto il corpo.
- **La legenda dice solo ciò che il disegno non dice da sé.** «Una linea fra due nodi di un grafo è un legame» non è un'informazione; il tratteggio dell'affinità sì, ma solo quando ce n'è almeno una e sono accese.
- **Le memorie senza alcun link escono dal canvas**: `layoutMemoryGraph` non le posiziona più (via `lonersBand`) e la vista le elenca sotto la mappa come chip cliccabili, precedute dal conteggio. Restano dichiarate come prima — il debito di connessione non si nasconde — ma una fascia di grafo dove non c'è alcun grafo da vedere era spazio speso per dire "niente". Una memoria _collegata_ non ci finisce mai. La lista dice lo stesso in fondo alle righe (`cl-mem-relnote`), dove non c'è una posizione che possa mostrarlo.
- I `[[link]]` che puntano fuori (moduli di codice, es. `[[subagents-reader]]`) sono contati come `dangling` e dichiarati in legenda invece di sparire.
- **`MemoryTopic.filename` non è sempre un nome di file**: è il target grezzo della riga di `MEMORY.md`, che può essere un path — `sub/topic.md`, o il link **assoluto** con cui un progetto condivide a mano una memoria con un altro (`~/.claude/projects/<altro>/memory/x.md`, forma reale sui progetti Acme). Quindi tutto ciò che si deriva dal nome passa da `baseName` (`graphLabel`, i token di affinità): letto come un nome di file, l'hash del progetto si sbriciolava in `Users user Projects ACME CORE 4 0` sotto la mappa, e i suoi segmenti entravano come parole di contenuto accoppiando fra loro tutte le memorie condivise. Il resolver dei wikilink porta un **alias sul basename** dopo i filename interi, così `[[accesso-macchine-bench-acme]]` risolve `exact` su una memoria indicizzata per path. Lato reader (`electron/modules/memory-reader.ts`) quel file **viene letto**, con un permesso stretto — solo un `.md` dentro la `memory/` di un progetto fratello, e solo per la memory dir utente, mai per quella di progetto che sta nel repo — e il topic porta `isExternal`, che nel detail vale read-only con la sua nota di provenienza: si legge qui, si modifica dove sta. Prima il path finiva in `join(memoryDir, '/Users/…')`, che concatena invece di resettare: il file non veniva mai aperto, la memoria non aveva corpo e quindi nessun `[[wikilink]]` — sei memorie di ACME_CORE vivevano in fondo alla mappa fra le "unconnected" per questo.

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
  Il titolo viene dai record del transcript — `agent-name` (`/rename`),
  `custom-title` (il vecchio `/title`), `ai-title` (generato), in quest'ordine —
  letti una volta dai **due estremi** del file (`readSessionTitle`) perché il
  cursore parte da EOF: il rinomina sta dove l'utente l'ha scritto, cioè ben
  oltre una testa di 256 KB.
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

### `search/` — Cercare dentro le conversazioni

Vista `search` (deep view, globale o scoped a un progetto). L'app legge ogni
conversazione mai avuta con Claude Code e finora non c'era modo di chiedere
**dove** è successo qualcosa: `SearchPopover` cerca **nomi** (path di progetto,
titoli di sessione, skill, agent, MCP), non contenuti — una query che lì non
trova niente non ha ricevuto risposta, semplicemente non ha fatto match.

| File             | Esporta      | Descrizione                                                                                                                                                                                                                     |
| ---------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SearchView.tsx` | `SearchView` | Campo + risultati raggruppati per sessione (progetto · titolo · id corto · data · conteggio match), snippet con la run evidenziata. Chrome standard delle deep view (`TopBar` + `cl-hero` + `Lens` + `cl-hband` + `cl-section`) |

Decisioni, tutte con un costo dichiarato:

- **La query si sottomette, non si strema.** Ogni run è una passata su tutta la
  storia su disco (vedi `electron/modules/session-search.ts`), quindi battere a
  macchina non deve farne partire una: si preme Invio, e il campo è **seedato**
  con le parole già scritte nel popover, così arrivare qui mostra risultati
  invece di chiedere un secondo Invio.
- **La query NON è invalidata da `data:changed`** (`useConversationSearch` non
  sta nel set di `useDataChangedRefetch`): un result set è l'istantanea di una
  scansione, e rieseguirla a ogni append di ogni sessione viva metterebbe una
  passata sull'intera storia dietro ogni riga scritta — esattamente il costo che
  le cache dei reader esistono per togliere.
- **L'evidenziazione usa gli offset che la scansione ha riportato**, non ricerca
  di nuovo la query nello snippet: il match è stato trovato da una regex
  case-insensitive, e una `indexOf` naive qui disegnerebbe il box sulla parola
  sbagliata su ogni folding che le due non risolvono allo stesso modo.
- **Aprire un hit risolve la `SessionSummary` vera** dalla lista del progetto
  (`qc.fetchQuery(['sessions:project', hash])`) e **rifiuta** se la sessione non
  c'è più: `ChatView` è guidata da quella riga, con i suoi costi e token, e
  fabbricarne una a zeri metterebbe cifre inventate nella testata. Un transcript
  cancellato dopo la scansione non è una sessione apribile, e dirlo batte
  navigare su una vista vuota.
- **Il deep-link al turno viaggia per `uuid`, mai per posizione** (`ChatView`
  prop `focusMessageUuid`): la vista transcript legge via Agent SDK, che
  **tronca alla compaction**, mentre la scansione legge il file — un match nella
  storia pre-`/compact` è reale e lì irraggiungibile. Con un indice il
  disallineamento sarebbe stato silenzioso (atterraggio sul turno sbagliato);
  con lo uuid o il messaggio si trova, o la vista lo **dichiara** e non finge.
- **Lo scope parte dal progetto aperto** (è la storia in cui uno sta) e la
  pagina dei risultati lo allarga con una checkbox; il conteggio in testata dice
  quanti transcript sono stati letti e quanti parsati, e una scansione tagliata
  da un cap lo dichiara invece di presentare un campione come la risposta.

**Ingresso**: il piede di `SearchPopover` — `⌘↵ search conversations`
(`.cl-search-more`), che compare da 2 caratteri in su (il pavimento della
scansione lato main). Deliberatamente **non** su Invio semplice: il primo
risultato del popover resta a un tasto di distanza.

---

### `exchange/` — Le due metà di uno scambio fra sessioni

Vista `exchange` (#280). Un messaggio mandato da una sessione a un'altra si
leggeva già da entrambe le parti, ma una alla volta: il mittente lo ha come
tool card `SendMessage`, il ricevente come bolla inbound (#274), e ricostruire
lo scambio voleva dire sapere quali sessioni aprire e leggerle in ordine. Il
join sta nel main (`electron/modules/session-exchange.ts`, `exchange:get`); qui
c'è solo la pagina.

| File               | Esporta                                                                             | Descrizione                                                                                                                                                                                                                                                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `thread.ts`        | `buildThreadRows`, `summarizeExchange`, `exchangeSpan`, `messageClock`, `threadDay` | La forma dello scambio come la pagina lo disegna: da che lato sta ogni messaggio, dove finisce una parte e comincia l'altra (`startsRun`), quanto è durata la conversazione. Puro, `test/exchange-thread.test.ts`                                                                                                                          |
| `ExchangeView.tsx` | `ExchangeView`                                                                      | La conversazione: hero con la coppia affiancata (`⇄`) e una riga di meta (`N messages · N in · N out · over 44s`), sotto il thread a due lati — l'altra parte a sinistra su paper-2, questa sessione a destra nel lavaggio accent — con il messaggio d'ingresso cerchiato (`aria-current`) e i due turni apribili come note a piè di bolla |

Decisioni:

- **Gli ingressi sono le due bolle, e le righe MESSAGES del rail**:
  `InboundMessage` offre `Show exchange` solo per un messaggio di **sessione**
  che porta un `msgId` — un agente interno (`from: 'agent'`) non ha con che
  legarsi, e un messaggio senza id nemmeno; `OutboundMessage` lo offre alla
  stessa condizione sul lato mittente (`messageExchangeId`: consegna a una
  sessione, con id). Il callback risale `MessageBubble` → `ChatView` (che vi
  aggiunge il proprio `sessionId`, **qualunque lato sia**: `readExchange`
  accetta come ingresso sia la ricevente sia la mittente) →
  `TerminalMissionControl`/`ProjectOverview`, come `onOpenSkill`; `ChatView`
  lo memoizza perché la bolla è `memo`. `TerminalMissionControl` passa lo
  stesso callback al rail, dove una riga MESSAGES con id apre la stessa pagina
  e una senza (agente, nessuna consegna) localizza il turno come QUESTIONS.
- **Lo scambio è la conversazione fra due sessioni**, tutti i messaggi fra la
  coppia in ordine di arrivo — non la hop chain, che è un percorso causale e
  spezza una conversazione umana in più catene (vedi il modulo main). La catena
  si disegna comunque, **come percorso e con le ripetizioni** (`via A → B → A`):
  una sessione che compare due volte è un rilancio, non un errore.
- **È disegnata come una conversazione, non come una lista di righe unite.**
  La prima versione ripeteva `mittente → destinatario` su ogni messaggio — in
  una conversazione a due parti, dove non cambia mai — e appendeva due bottoni
  a ciascuno: la pagina diceva quattro volte quello che poteva dire una volta.
  Ora la coppia sta in testa (due chip affiancati con `⇄`), ogni messaggio
  prende un lato (l'altra parte a sinistra, questa sessione a destra
  nell'accent che l'app usa già per "mio"), una serie di messaggi della stessa
  parte porta il volto una volta sola — come un turno di continuazione perde il
  pallino — e i due turni apribili sono note a piè di bolla sotto una hairline.
  Un messaggio lungo si ripiega a 14 righe come la bolla del transcript.
- **Le cifre del join non sono titoli**: `Transcripts read` e `Took` dicevano
  quanto è costata la risposta, non cosa c'è dentro la conversazione, e
  stavano in una fascia grande quanto i messaggi. Restano — la pagina deve
  poter dire su cosa si regge — nel `title` della riga di meta, che al loro
  posto conta i due lati e la durata.
- **Un mittente senza transcript è detto tale**, mai vestito da sessione
  apribile: la card dice `transcript not found`, il nome resta quello dichiarato
  (etichetta, non identità), e la riga non offre `Open sending turn`. Dove il
  messaggio è atterrato resta apribile.
- **Aprire un turno risolve la `SessionSummary` vera** dalla lista del suo
  progetto e rifiuta se la sessione non c'è più — la regola di `SearchView`,
  per la stessa ragione. La destinazione è Mission Control con
  `focusMessageUuid` (`sentTurnUuid` sul lato mittente: la riga assistant che
  ha fatto la chiamata; `receivedUuid` sul lato ricevente: la bolla inbound) e
  `from: 'exchange'` + `exchange` per tornare **qui**, anche da un progetto
  diverso da quello della sessione aperta.
- **La query È invalidata da `data:changed`** (`exchange:get` sta nello scope
  `sessions`), al contrario della ricerca: uno scambio è vivo, l'altra parte può
  rispondere mentre la pagina è aperta, e il reader ricorda ogni transcript sotto
  il suo stamp, quindi un refetch è uno `stat` per file e la rilettura di ciò
  che è cresciuto.

Coperta da `test/exchange-view.test.tsx` (StrictMode, fake bridge) e, per il
bottone sulla bolla, da `test/message-bubble-markers.test.tsx`.

---

### `remote/` — Claude Code su un'altra macchina (#242)

Vista `remote` (deep view, voce **Remote** nella barra in alto). Il terminale
integrato puntato a un host via il **`ssh` di sistema**: stessa `TerminalPane`,
stessi canali `terminal:*`, con `ssh -t <host> sh -c '<script>'` al posto di un
`claude` locale — o, su un host Windows, `powershell -EncodedCommand <…>`
(`electron/modules/remote-ssh.ts` dice perché e come è quotato).

| File                 | Esporta                                                                        | Descrizione                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RemoteView.tsx`     | `RemoteView`                                                                   | Elenco degli host salvati (nome, destinazione ssh, porta, cartella di partenza) + form di aggiunta/modifica + pannello Connect con la cartella sull'host; una volta connesso, la `TerminalPane` in modalità remota con il banner e la notice d'uscita                                                                                                      |
| `remote-exit.ts`     | `remoteExitNotice`, `remoteActionLabel`                                        | Modulo puro: cosa significa un codice d'uscita (i `REMOTE_EXIT` dello script, il 255 di ssh, un'uscita normale) e quale passo successivo offrire                                                                                                                                                                                                           |
| `RemoteChrome.tsx`   | `RemoteStatus`, `RemoteBanner`                                                 | Lo stato in top bar (`RUNNING ON <HOST>`) e il banner sopra il terminale, col tag Beta: file proprio così il popup "What's new" (v2.2.28) li disegna veri senza montare la pane                                                                                                                                                                            |
| `RemoteLensPane.tsx` | `RemoteLensPane`                                                               | Il tab Lens di una pane remota (#294): la `ChatView` embedded con `remote` impostato quando c'è un transcript, altrimenti dove sta la lettura — e la domanda di ssh per un secondo login, con il campo per rispondere, che passa davanti al transcript: un retry, o il riavvio dopo un frame perso, rifà il login col transcript vecchio ancora in memoria |
| `remote-lens.ts`     | `channelNote`, `remoteProjectHash`, `remoteTranscript`, `remoteSessionSummary` | Modulo puro: la frase sul canale (condiviso o secondo login), la chiave di progetto che non incontra mai un progetto locale (`remote:<hostId>`), e ciò che `ChatView`/`MissionRail` ricevono                                                                                                                                                               |

Decisioni:

- **Additiva e rimovibile, per scelta.** Claude Code potrebbe offrire un modo
  suo per agganciarsi a una sessione su un'altra macchina
  (anthropics/claude-code#87190), e allora questo strato va tolto. Quindi niente
  di locale è riscritto attorno a un host: `TerminalMissionControl`,
  `terminal:create`, `chat-runner` e i reader restano come sono. La
  `TerminalPane` prende solo prop opzionali (`remote`, `onExit` +
  `hideExitOverlay`, `onTerminalId` per la Lens); senza, si comporta
  esattamente come prima. Lo stesso vale per `ChatView`, `MissionRail`,
  `ChatControlPill` (`onDelete` opzionale, `exportable`) e per l'`enabled` di
  `useEffectiveConfig`/`usePlugins`/`useGlobalAgents`.
- **Una sessione remota non passa mai per locale.** Registro e transcript stanno
  sull'host: il banner (`role="note"`) lo dice finché la connessione è aperta, e
  la barra in alto stampa `RUNNING ON <HOST>`. Gli elenchi delle sessioni di
  questa macchina non la vedono.
- **Lens e Mission Control la leggono dall'host (#294)**, per la sola sessione
  connessa e in sola lettura: tab `TERMINAL` / `LENS` (i `ViewTabs` e il
  `RailToggle` di `TerminalMissionControl`, esportati) e la `MissionRail`, con la
  `TerminalPane` sempre montata perché è la connessione. I dati arrivano da
  `useRemoteLens` (push `remote:lensState` + snapshot all'aggancio, `revision`
  contro lo snapshot tardivo — niente React Query: nessuno scope del watcher può
  invalidare righe tenute nella memoria del main). `ChatView` e `MissionRail`
  prendono la prop opzionale `remote` e con essa **non leggono niente del
  progetto su questa macchina** — definizioni di skill e agent, config
  effettiva, task, team, memoria, sotto-agenti, wikilink, lista sessioni,
  playbook — né offrono export, highlight o delete: la cartella dell'host ha
  spesso lo stesso path di una locale, e ogni lettura mostrerebbe i dati di
  questa macchina come fossero della sessione. `RemoteOriginContext`
  (`components/remote-origin.ts`) fa lo stesso per le foglie che aprono un
  file per path (`MarkdownImage`). Il banner dice **come** la Lens raggiunge
  l'host: sulla connessione del terminale (`ControlMaster`, client macOS/Linux)
  o con un **secondo login**, la cui domanda appare nel tab Lens. Cosa non c'è:
  transcript dei sotto-agenti, task, team, indice della memoria, definizioni,
  permission mode — stanno sull'host e non vengono letti.
- **La versione di Claude Code sull'host si controlla prima di avviarlo**, nello
  script remoto e non con un `ssh` a parte: una connessione sola, e password,
  2FA o una chiave nuova vengono chiesti nella pane stessa. La soglia è il
  `claudeCodeVersion` di `package.json`, la stessa che Settings → General usa
  per la CLI locale: sotto, lo script non avvia la sessione, e la notice offre
  **`Update Claude Code on <host>`**, che lancia `claude update` sull'host nella
  stessa pane e poi riporta a una sessione. Una versione illeggibile o un
  `claude` assente fermano allo stesso modo, ognuno col suo messaggio. Il costo
  dichiarato: siccome `prepare-release` porta quella soglia alla CLI installata
  il giorno del rilascio, quasi ogni release di ClaudeLens chiede un
  `claude update` sull'host, che è a un click.
- **L'output resta scoperto.** Lo script stampa il suo motivo nel terminale
  prima di uscire, quindi l'overlay `SESSION ENDED` della pane è spento
  (`hideExitOverlay`) e la notice sta **sopra** il terminale (`role="status"`),
  con le azioni. Un fallimento all'avvio (host non più salvato, cartella
  rifiutata dal main) tiene invece l'overlay della pane col suo Retry.
- **Riprovare è rimontare**: ogni tentativo è una `key` nuova, quindi una pane
  nuova e un `ssh` nuovo. La modalità (`claude` / `update`) è fissata per la
  vita di una pane.
- **Il sistema dell'host si sceglie nel form** (`OsPicker`: Linux / macOS o
  Windows) e non si indovina: indovinarlo costerebbe un secondo login, e chi
  entra con password o 2FA se la vedrebbe chiedere due volte. Il sistema decide
  lo script, le regole della cartella (`C:\src\app` e `~\…` su Windows, un path
  assoluto o `~/…` altrove), i placeholder e la notice di `claude` assente, che
  su Windows nomina `%USERPROFILE%\.local\bin` e l'installer PowerShell. Su
  Windows il codice d'uscita non attraversa ssh quando c'è un tty: il rifiuto
  arriva come marcatore nell'output e il main lo rimette al suo posto, quindi
  per questa vista i due sistemi rispondono uguale.
- La cartella usata l'ultima volta su un host sta in `localStorage`
  (`cl-remote-dir:<id>`): è una comodità, perderla costa riscriverla. Gli host
  invece stanno nel main (`~/.claudelens/remote-hosts.json`), perché sono dati.

Coperta da `test/remote-view.test.tsx` e `test/remote-lens-view.test.tsx`
(StrictMode, fake bridge); lo script remoto e il watcher sono eseguiti davvero in
`test/remote-ssh.test.ts` e `test/remote-watch.test.ts`.

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
- **`DuplicateProjectsNotice.tsx`** → `DuplicateProjectsBadge`, `DuplicateProjectsView` — Badge compatto nella home globale + vista dedicata dei progetti duplicati, **in sola lettura** (il merge è stato rimosso). Vedi sotto

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
`/Users/user/Projects/Cl…`). Ora passa da `homeRelativePath`
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
si troncava a `Refactor auth mod…`.

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

Il contenuto segue **5b** per la struttura e **3b** (design handoff _Project
Overview Redesign_, turni 1a → 2a → 3b) per il trattamento dell'hero progetto:

- **nome e descrizione sulla stessa linea di base** (2a), dentro un wrapper
  `.cl-h-title` che va flex **solo** sotto `.cl-hero--band` — l'hero Teams
  (`.cl-hero--compact`) monta lo stesso wrapper con un figlio solo e resta un
  blocco. In edit la descrizione va a capo su tutta la riga (`flex: 1 0 100%`):
  la textarea vuole la sua misura di lettura, non lo spazio accanto a un nome da
  64px;
- **fascia metriche a quattro colonne piatte** (`.cl-hband` dentro
  `.cl-hero--band`): etichetta + cifra, separate da spazio e non da hairline —
  Sessions/{retention}d, Tokens, Spend, **distribuzione modelli** come barra
  part-of-whole + legenda (`buildModelMix` in `../utils.ts`, quota sui **token**
  e non sulle sessioni: la cella sta accanto alla cifra dei token e ciò che la
  barra codifica è dove è finito il lavoro; unit-tested). La finestra di
  retention è dichiarata **una volta sola**, sulla prima colonna, e governa la
  riga. Con la riscrittura sono caduti **la sparkline del periodo, il delta
  sulla finestra precedente e la riga piccola di ogni cella** (`% cache read`,
  `msg avg`, `N older · N total`) — è il punto dell'esercizio, non un effetto
  collaterale. È caduto anche il `last … ago` accanto all'etichetta, che il mock
  non porta: lo dice ora la prima riga della lista sotto, che da 3b è la
  sessione **più recente** e non più una pinnata. Resta la **card di
  composizione dei token** in hover sulla cifra, portalata su `<body>` e
  annunciata dal filetto punteggiato sotto il numero;
- **una sola azione** (3b): `Open in Claude Code` come pillola terracotta e
  `SDK chat →` come etichetta accanto, **in flusso sotto le metriche**
  (`.cl-hero-cta-row`) invece che flottanti in alto a destra — due bottoni di
  vetro quasi identici non dicevano quale delle due cose la pagina serva.
  Restano due `<button>` con il `title` che dichiara **su quale budget pesa
  ciascuno** (crediti Agent SDK vs. piano di abbonamento): è l'unico posto in
  cui l'app lo scrive, e le stringhe sono hoistate (`SDK_CHAT_TITLE`,
  `CLAUDE_CODE_TITLE`) perché l'hero Teams disegna la stessa coppia in forma
  compatta e il testo non deve divergere;
- **niente `<Lens />`**: al posto degli anelli concentrici l'hero prende un
  wash caldo che sfuma sulla carta (`--cl-hero-wash`, tinta accent a 40°, più
  spenta nel tema dark dove un accent-soft a tutta fascia legge come campo di
  colore). Il bordo inferiore in ink resta: il wash finisce in carta e senza
  quel filetto la pagina non avrebbe più alcun confine lì.

`.cl-hband`/`.cl-hcell` sono **condivise** con `SearchView`, che continua a
disegnare le celle divise da hairline: il trattamento 3b vive tutto sotto `.cl-hero--band`. Il nome display
resta a `clamp(40px, 4.2vw, 64px)` perché una cifra da 30px sotto un titolo da
132px non è una gerarchia.
Le sessioni — nella **vista Sessions** e, dalla stessa riga, nella landing
(vedi sotto) — sono **righe** (`.cl-srow`): pin, indice, **titolo (che porta
il colore della sessione)**, tag, spazio elastico, il gruppo cifre
`msg · modello · token · data` e in coda il **kebab delle azioni**. Due elementi
di 5b sono caduti qui, per la stessa ragione:

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

Il **colore della sessione** — quello che l'utente le ha dato con `/color`, il
modo di Claude Code di distinguere a colpo d'occhio due run concorrenti, letto
da `agent-color` nel transcript — è **portato dal titolo**, non da un
segno suo. È l'unico punto dell'app dove vive una tinta fuori dai 40° del brand,
e a ragione: quel colore è **un dato**, l'etichetta dell'utente, non un accento
nostro — una sessione blu dipinta in terracotta sarebbe un'altra informazione.

**Perché il titolo, e non un pallino né l'indice.** Il pallino è stato provato
per primo, in testa al titolo, ed era il terzo tondo della riga: il verde di
LIVE e quello del modello dicono già due cose diverse, e un terzo accanto a
loro si leggeva come un semaforo. Poi l'**indice di riga** — mono, decorativo,
già smorzato a `--cl-ink-4`, tingerlo non aggiungeva nessuna geometria — ed
era troppo silenzioso: un `01` colorato non si leggeva come il colore della
sessione, tanto che l'utente ha segnalato l'indicatore come **sparito** e ha
chiesto il titolo. Il titolo è l'unica cosa della riga che si legge comunque,
e i token `--cl-agent-*` sono tarati per il testo (sotto), quindi a 16px
reggono. Era stata considerata anche la **sfumatura di fondo** suggerita
dall'utente e scartata per la ragione già scritta sopra per le righe pinnate —
in dark è una macchia e litiga con la tinta dell'hover. La tinta batte
l'accento dell'hover (specificità `.is-coloured.<nome>` > `:hover .title`): il
fondo della riga dice già "questa", il colore è l'unica cosa che dice **quale**
sessione è questa; e tinge anche l'italico di _Untitled_, che tiene il suo peso
smorzato. L'indice torna neutro, e in accent solo quando pinnato.

Il nome sceglie una **classe** (`.cl-srow .title.is-coloured.blue`), mai uno
`style` inline: il valore arriva da un record non documentato, `cost-tracker` lo
restringe agli otto nomi che `/color` accetta, e uno che passasse comunque non
tinge niente. I token `--cl-agent-*` sono perciò tarati **per il testo**, non
per un tondo: ognuno passa 4.5:1 sul proprio fondo (peggior caso chiaro 4.64, il
giallo — che infatti si legge ambra).

Il **pallino** (`SessionColorDot`, `.cl-scolor`, 7px) sopravvive dove non c'è un
titolo da tingere e nessun altro tondo con cui confondersi: il crumb della
`ChatView`, così il colore è sotto gli occhi anche mentre si legge la sessione,
non solo nella lista da cui la si è scelta.

Nel frame unificato **Terminal / Lens** lo stesso dato diventa una piccola
**Session Aura** (`SessionColorFrame`): il pallino precede il titolo nella
breadcrumb, che indossa a sua volta il colore. `SessionBottomGlow` porta la
stessa tinta al fondo della sola area di lavoro: una sfumatura alta 100px, senza
striscia piena sul bordo e trasparente salendo. Sta a `z-index:10`, quindi sotto
la pill strumenti del Lens (`z-index:40`) e sotto i detail overlay del frame
(`z-index:20`), e non raggiunge TopBar, selettore Terminal/Lens o Mission
Control. Tutto sparisce quando la sessione non ha un `agentColor`. Le otto classi
nominate riusano solo `--cl-agent-*`: niente colore arbitrario entra in CSS e
l'accento terracotta resta un'informazione separata.

Il glow resta montato quando si alternano le due viste: **Lens** aggiunge
`.is-active` e lo fa entrare dal basso in 220ms; **Terminal** toglie la classe e
lo spegne in 140ms. Non rimontarlo è ciò che rende possibile l'uscita animata.
Con `prefers-reduced-motion` resta la sola dissolvenza, senza traslazione.

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

**L'indice è il rango, e le due liste lo prendono dalla stessa mappa**
(`sessionRank`, posizione 1-based nella lista completa ordinata per attività,
passata a entrambe come `rankOf`). Le pinnate stanno in una sezione propria e
sono tolte da quella sotto: numerando la prima per rango e la seconda per
posizione, `02` stava sia su una pinnata sia su una sessione tre righe più
giù — lo stesso numero per due sessioni nella stessa schermata. Da qui la
**conseguenza voluta**: la lista non pinnata salta i numeri che la sezione
sopra si è presa (`01`, `04`, `06`, …), e il conteggio in testata (`15 total`)
resta quello delle righe di quella lista, non dell'ultimo indice stampato.
`rankOf` si omette solo dove il sottoinsieme è un **prefisso** dell'ordine —
le prime cinque della landing — perché lì l'ordinale sequenziale è già il
rango.

**Landing di progetto — design handoff _Project Overview Redesign_, 3b**
(`section === 'overview'`). La landing è **l'hero e una lista sola**. Le
sezioni **Memory** (griglia di index card `.cl-mem-cards`/`.cl-mcard`,
`renderMemCard`) e **CLAUDE.md**, e la **striscia di config** in fondo
(`.cl-config-strip`: Skills / Agents / MCP / Rules), sono cadute con il loro
CSS: erano anteprime di cose che il rail già conta a un clic — `Memory`,
`Skills`, `Agents`, `MCP` ci stanno con il badge, e `Rules` non aveva nemmeno
una destinazione propria (portava a `project-mcp`, dove le regole
condizionali vivono). Restava un'eccezione vera, ed è l'unica cosa che si è
spostata invece di sparire: la **cascata CLAUDE.md** era l'unico ingresso a
`project-claudemd`, e il rail non ha una voce CLAUDE.md — quindi il blocco
(`.cl-md-cascade`/`.cl-md-layer`, `claudeMdPathParts`,
`CLAUDE_MD_SCOPE_LABEL`, l'ordinamento della cascata) è emigrato in
**`ProjectConfigView`**, che per questo prende ora un `onNavigate`. Ci sta di
casa: sono istruzioni risolte a livelli, esattamente come le impostazioni
sopra di esse.

**Passata di rifinitura sull'hero 3b** (dopo il primo screenshot in app, che
il mock non poteva mostrare: finestra larga, progetto live, un solo modello).

- il **wash** è sceso a metà croma (`--cl-hero-wash`, 0.018 invece di 0.035) e
  arriva a carta al **58%**: il filetto d'inchiostro in fondo deve dividere
  carta da carta. Chiudere il gradiente sul filetto disegnava un secondo bordo
  colorato appena sopra — la banda dura che si vedeva per tutta la larghezza;
- l'**aura `is-live`** (due campi accent animati, `::before`/`::after`) è
  **spenta sotto `.cl-hero--band`**: sopra il wash era un secondo campo sul
  primo, ed è ciò che smacchiava la fascia. Un alone sfocato non ha comunque
  un bordo da leggere, quindi non dichiara granché; la `.cl-live-bar` non vive
  in questo hero (è di `AgentsLiveView`), perciò il segnale si è spostato nel
  **pip dell'eyebrow**, che con `is-live` diventa verde e pulsa come quello del
  rail — e si ferma sotto `prefers-reduced-motion`;
- la descrizione siede con l'**ultima** riga sulla baseline del nome
  (`align-items: last baseline`, col valore semplice sotto come fallback: un
  engine che non lo parsa scarterebbe la dichiarazione e stirerebbe la riga).
  Con `baseline` era la prima riga a sedersi, e una descrizione su due righe
  restava appesa in alto;
- **una misura sola** per hero e lista (`--cl-measure`, 1080px): le cifre
  dell'hero si fermavano a due terzi della finestra mentre la lista correva
  fino al bordo, e su un monitor largo la riga mono di una sessione restava
  sola contro mezzo schermo di carta;
- la **barra dei modelli** scende a 6px per 220px e ogni segmento ha
  `min-width: 2px`: con 99,6% Opus disegnava un blocco viola pieno mentre la
  legenda sotto diceva `Sonnet <1%` — la barra smentiva le sue stesse parole;
- il **path nell'eyebrow** esce dall'uppercase (`.cl-eyebrow .path`): è un dato
  case-sensitive, e `/USERS/…` è una stringa che non risolve, stampata
  nell'unico punto in cui la pagina dice dove sta il progetto;
- via **l'anello** attorno al chevron del nome: un cerchio d'inchiostro da 36px
  accanto a un titolo da 64px è una seconda cosa che chiede attenzione sulla
  stessa riga. Resta il glifo, che si accende in accent all'hover;
- `LANDING_SESSIONS` passa a **5**: il mock disegnava tre righe in un frame
  alto 720px, su una finestra vera la pagina finiva a metà.

Seconda passata, sullo stesso hero visto in app con un progetto reale:

- il gradiente del wash è **verticale** (`to bottom`), non più a 168°. La linea
  di un gradiente inclinato è lunga `|W·sin a| + |H·cos a|`: su un hero
  1500×500 anche 168° la stirava a ~820px, quindi gli stop cadevano molto più
  in basso di dove si leggono e il wash non arrivava mai a carta prima del
  filetto. Verticale, le percentuali dicono quello che sembrano dire;
- **`gap: 0`** sul nome: il gap della riga metteva uno spazio tra il nome e il
  suo punto, e il titolo si leggeva `Personal .` — un refuso, in 64px. Il punto
  appartiene alla parola; solo il chevron è una cosa a parte e prende il suo
  `margin-left`;
- la descrizione è **clampata a due righe** (con `line-clamp`, testo intero nel
  `title` insieme alla provenienza): la terza riga sale sopra l'altezza delle
  maiuscole del nome e la frase comincia a competere con ciò che descrive;
- **la barra dei modelli sparisce quando una famiglia sola tiene la finestra**
  (meno di due quote ≥ 1%): un part-of-whole ha bisogno di più di una parte
  visibile, e con 99,6% Opus disegnava un rettangolo viola pieno — "tutto" —
  mentre la legenda sotto diceva `Sonnet <1%`. Le etichette **restano** quelle
  di `pctLabels` (i floor sommano sempre a 100, `<1` per le quote non nulle:
  è unit-tested, non si tocca); è la barra a farsi da parte.

La lista è **`SessionRows`**, le stesse righe `.cl-srow` della vista
Sessions — pin, indice, titolo colorato, LIVE, expiry, tag, cifre in colonna e kebab
compresi — senza `pageSize` (la testata dice già `All {N} →`, un footer
"1–5 of 5" sotto conterebbe le stesse cinque due volte) e senza `rankOf`
(sono le prime cinque della lista, l'ordinale sequenziale è già il rango
vero). Per un po' ha avuto un record tutto suo (`RecentSessionRows`,
`.cl-rsrow`: titolo + `LiveTag` su una base, una riga mono
`N msg · modello · N tokens · quando` sotto), tenuto separato di proposito
perché "una variante sul componente condiviso è il modo in cui la vista
Sessions cambia per sbaglio" — ma la stessa sessione si leggeva in due forme
diverse a un click di distanza, e l'utente l'ha visto prima di ogni altra cosa.
Ora c'è una riga sola: chi tocca `.cl-srow` tocca entrambe le liste, ed è
il punto. La testata prende il modificatore **`.cl-sec-head--rule`** (la `h2`
scende a etichetta mono uppercase, filetto d'inchiostro da 1.5px sotto — lo
stesso peso con cui `.cl-srows` si apre in Sessions, e infatti
`.cl-sec-head--rule + .cl-srows` spegne il proprio `border-top`, altrimenti i
due filetti si sommavano in una barra) perché la base è condivisa da una
decina di viste, e a destra c'è `All {N} →`.

L'ordine è la **recenza**, non più le pinnate per prime (1c): la testata dice
"Recent sessions" e la fascia non stampa più `last … ago`, quindi la prima
riga è diventata l'unico posto in cui la pagina dichiara quando il progetto è
stato toccato — una pinnata di tre settimane fa in quella posizione farebbe
mentire la pagina. Le pinnate hanno comunque la **loro sezione** nella vista
Sessions, che è dove si agisce su di esse.

La sezione **Teams** conserva l'hero compatto (`cl-hero--compact`) e la
vecchia meta-riga: è una vista operativa, non una landing di progetto.
Il **filtro per tag** (`sessions/TagBar`) non è più una banda sotto il titolo:
sta nella **testata di sezione**, a destra, accanto al conteggio che filtra —
come banda propria costava una hairline e 28px verticali per dire "todo 1", e
la hairline era comunque ridondante col filetto d'inchiostro in cima a
`.cl-srows`. `all` e i tag sono **una sola specie** (nessun separatore tra
loro: sono un radio group) nel linguaggio dei filtri della pill chat
(l'allora `.cl-pill-filter`, oggi rimossa): niente bordo, niente riempimento, conteggio smorzato di
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

**Vista Duplicates — la chrome delle pagine catalogo, una lista minimale**
(`DuplicateProjectsView`). La vista è passata per due forme che non
somigliavano al resto dell'app: prima un `BackButton` nudo sopra una colonna da
860px (finiva **sotto i semafori macOS** — la `TopBar` esiste per il suo gutter
da 88px), poi un hero con la **fascia metriche** a quattro celle, la
spiegazione chiusa in un `<details className="set-disc">` (un idioma di
Settings) e ogni gruppo come **diff a due colonne di pannelli boxati** su
`--cl-paper-2`, con un gutter `←` per la direzione del merge. Erano le sole card
in una pagina che è una lista, e senza merge il gutter non diceva più niente.
Ora segue le pagine catalogo (`GlobalMcpView`, `GlobalSkillsView`):
**`TopBar`** con crumb `Global · Duplicates` e back di default; **hero** con
eyebrow, `Duplicates.`, una riga di prosa (`.cl-dup-lede`: il tipo di
`.cl-h-desc` senza il suo click-to-edit — che cosa sono, come si sceglie il
primary, che l'app non tocca nulla) e la **`cl-h-meta`** al posto della fascia:
quattro cifre display che leggono "1" pesavano più del contenuto. I totali di
sessioni e memoria sommano solo le cartelle **non** primarie, cioè la storia che
il primary non mostra. Poi la lista, **minimale per scelta** dell'utente, arrivata alla terza forma.
Una versione a righe della lista Sessions (filetto in ink, ordinale, tag di
ruolo a pallino, cifre in colonne fisse, una `cl-section` per progetto) e una a
nome-più-percorsi completi sono state scartate: con path lunghi e annidati —
il caso comune, perché i duplicati nascono proprio da cartelle profonde — la
seconda era per lo più **lo stesso prefisso smorzato ripetuto su ogni riga**, e
le cifre andavano a capo. Ora c'è **una sola `cl-section`**; ogni progetto è il suo nome
(`.cl-dup-name`, 15px) con accanto, **una volta sola**, la testa di path che le
sue cartelle condividono (`.cl-dup-prefix`, mono smorzato, `~` al posto della
home via `homeRelativePath`), e sotto, rientrate, le cartelle ridotte **alla
sola parte che cambia** (`.cl-dup-folder`): quella in mono, una parola solo dove
serve — `primary` in `--cl-ok` sulla prima, `estimated` sul path ricostruito —
e a destra le sessioni, più la memoria solo se ce n'è (`0 memory` era rumore).
Path completo e ultima attività stanno nel tooltip. Il gruppo è largo al più
760px, perché con code corte le cifre a tutta misura finivano lontane dalla
loro riga. Niente bordi, niente fondi, niente chip. Le righe vanno a capo
(`flex-wrap`), così in una finestra stretta le cifre scendono sotto il path.
Stati: `Loading…` mentre la scansione gira (prima diceva "No duplicates
detected." anche durante il caricamento), l'errore della scansione detto come
tale, e il vuoto.
La coda **va a capo invece di troncare** (è ciò che distingue le cartelle). La
testa condivisa viene da `sharedPathPrefix` in `shared/projectName.ts`
(unit-tested in `test/project-formatters.test.ts`): le cartelle di un gruppo
condividono il basename — è ciò che le rende candidate — quindi ciò che le
distingue sta nel mezzo del path. Un prefisso di sola `/` non conta (il helper
restituisce `''`), e allora ogni riga porta il suo path intero, sempre con `~`.
Un path ricostruito dal nome cartella (nessun transcript ne registra il `cwd`)
porta il flag `estimated`.
**La vista è in sola lettura, per scelta.** Aveva un bottone "Merge into
primary" (dialog col piano, poi spostamento dei transcript, rewrite del `cwd`,
fusione di `memory/`, cancellazione della source): rimosso, perché il match è
un'ipotesi e un merge sbagliato fonde storia reale di progetti diversi — vedi
`electron/modules/CLAUDE.md`. Non va reintrodotto: la vista segnala, il riordino
lo fa l'utente a mano.
La scelta del primary resta del reader (attività più recente, poi più sessioni —
`sortPrimaryFirst` in `duplicate-detector.ts`): è solo la cartella più viva, non
una destinazione.

---

## Convenzioni

- **Navigation:** ogni componente riceve `onNavigate(v: View)` e/o `onBack()` come callback — non gestisce stato di navigazione proprio
- **Data fetching:** tutti gli hook da `../../hooks/useIPC`; React Query gestisce cache e invalidazione
- **Styling:** Tailwind CSS + token `--cl-*` / classi `cl-*` in `index.css` (accent terracotta `#C15F3C`). Tema chiaro di default, dark derivato via `:root[data-theme='dark']`. Non introdurre nuove tinte d'accento — vedi root `CLAUDE.md`
- **Tema (light/dark/system):** la preferenza vive in `hooks/useTheme.ts` (tipi + context + hook `useTheme`) e `hooks/ThemeProvider.tsx` (il provider, montato in `App.tsx`) — separati per la stessa regola fast-refresh di `CreateFormKit`. Unica fonte di verità `preference` (`'light' | 'dark' | 'system'`) persistita in `localStorage['cl-theme']`; `resolved` (`'light' | 'dark'`) applicato su `<html data-theme>`. Con `system` segue l'OS via `matchMedia` (aggiornamento live). Il controllo è esclusivamente nella tab Appearance dei Settings (nessun toggle in top bar)
- **Import paths:** da sottocartelle usare `../types`, `../utils`, `../shared/BackButton`, ecc.
