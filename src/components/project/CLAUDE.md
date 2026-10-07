# components/project/ — i componenti delle viste

Ogni vista dell'app, divisa per dominio. Le monta `tabs/ProjectOverview.tsx` con uno `switch` sul
`View` di `types.ts`; le parti pure stanno accanto ai componenti, in file `.ts` testati sotto
`test/`. Qui ci sono solo le regole che il codice non dice da solo: cosa fa ogni file lo dicono il
file e il suo test.

## Dove sta cosa

- `chat/` — il transcript: la lettura (`ChatView`, finestrata), la chat SDK live (`LiveChatView` +
  `useLiveChat`), bolle, finestre dei tool, strisce di MIN, rail dei file letti, trova, highlight.
- `terminal/` — Mission Control: terminale embedded, tab di sessione, sessioni parcheggiate, rail
  degli eventi (`MissionRail`, `mission-feed.ts`), shell in background, dock dei messaggi.
- `overview/` — home globale, landing e rail del progetto, righe di sessione (`SessionRows`),
  Duplicates.
- `memory/` — topic e grafo dei `[[wikilink]]`; `studio/` — Agent Studio sui workflow `.js`;
  `monitor/` — i processi vivi; `agents-live/` — i job in background; `shared/` — atomi e dialog
  condivisi. `search/`, `exchange/`, `remote/`, `files/`, `settings/`, `plugins/`, `teams/`,
  `workflows/`, `plans/`, `tasks/`: una vista ciascuna.

## Navigazione

- **Un solo Back a schermo.** Il ritorno è del frame: un pannello aperto dal frame (tool, skill,
  agente, team) è `chromeless`, e la freccia della `TopBar` cammina lo stack di un passo — da un
  dettaglio torna alla sessione, solo dalla sessione esce.
- Una sessione si apre per la `SessionSummary` vera, risolta dalla lista del suo progetto, e si
  **rifiuta** se non c'è più: mai una riga fabbricata a zeri. Il salto a un turno viaggia per
  `uuid`, mai per posizione — la lettura via SDK tronca alla compaction, la scansione del file no.

## Transcript (`chat/`)

- **La colonna di lettura è finestrata** (`@tanstack/react-virtual`): sono montate solo le righe
  attorno al viewport.
  - Ciò che dipende dai vicini si deriva prima, in `buildRenderRows`; lo scroll-spy legge la
    geometria del virtualizer; il Ctrl+F del browser vede solo le righe montate, ed è per questo
    che esiste `find.ts`. Mai righe effimere iniettate nella lista.
  - Al cambio di densità **non** chiamare `rowVirtualizer.measure()`: collassa la lista sulle
    stime e perde la posizione di lettura. Niente `anchorTo: 'end'`: l'ancora di fondo è di
    `useAutoScroll`. Il `content-visibility: auto` delle liste non finestrate non deve raggiungere
    le righe virtualizzate.
  - Un overlay (dettaglio di un tool, timeline) nasconde il workspace con `display: none`, non lo
    smonta.
- **Highlight e trova dipingono con la CSS Custom Highlight API**, senza toccare il DOM di
  react-markdown, e ognuno cancella solo i nomi suoi (`cl-hl-*`, `cl-find*`). Gli offset degli
  highlight sono nel testo renderizzato, non nel markdown. Il trova risponde un booleano per turno,
  apposta: un "hit 4 di 37" vorrebbe riconciliare offset grezzi e renderizzati.
- **`describeTurn` (`chat/utils.ts`) deve conoscere ogni specie che ha una striscia sua in MIN**,
  altrimenti il turno risulta `toolsOnly` e finisce nel badge "tools hidden" (è successo a
  `SendMessage` e `Artifact`). Descrittore, bolla e trova devono concordare su cosa mostra un
  turno: per il thinking chiedono tutti a `thinkingNote`.
- `MessageBubble` è memoizzato su molte prop: uno stato trasversale passa per context (es.
  `DiffsOpenContext`), non per prop.
- Nessuno scroller verticale annidato nel transcript: si clampa, si offre "Show all N lines" e ⤢ a
  tutto schermo (`SheetModal`).
- **Chat SDK live**: tutto lo stato è in `useLiveChat`, `ChatComposer` è solo presentazione. Il
  resume semina il transcript con una lettura da disco al mount, mai con una query osservata (niente
  refetch a metà turno). Con la sessione viva in un terminale il composer è bloccato: risponderle
  gareggerebbe col CLI sullo stesso file.
- **Approvazioni**: la serratura è il main (`electron/modules/chat-permissions.ts`), non il dialog.
  Nessuna scorciatoia approva, con `defaultToNo` il focus parte su Deny, e il dialog è keyed per
  `requestId`.
- `/btw` va solo alla query viva della chat; in Mission Control manca apposta, perché il `claude`
  nel PTY non ha un canale verso l'app.
- Il commento in corsa (#236) usa solo `input.description` di una chiamata: dove manca non si dice
  niente (mai una frase ricavata da `command` o `file_path`), e nella UI non si chiama "thinking".
- La pill ha un'anatomia fissa: stesse celle, stesso ordine in ogni sessione. ⌘F è del search
  globale, non del trova della pill, che conta "N turns" e mai "2/12".

## Mission Control e terminale (`terminal/`)

- Smontare una `TerminalMissionControl` uccide il suo PTY. Parcheggiare è tenerla montata e nascosta
  (`display: none`); navigare via da un PTY vivo senza parcheggiarlo lo uccide.
- Mai due `claude --resume` sulla stessa sessione: `navigate` riusa l'istanza che la gira già
  (`matchInstance` in `terminal-instances.ts`). L'`ErrorBoundary` è keyed per istanza: keyed sulla
  vista rimontava — e uccideva il PTY — al passaggio dall'hash provvisorio a quello reale.
- **Una sessione in attesa non ha ancora la domanda nel transcript**: Claude Code scrive la riga
  `tool_use` di una domanda insieme alla risposta. L'attesa si legge solo dal registro
  (`status: 'waiting'` + `waitingFor`, testo libero che non dice se è una domanda o un permesso, né
  porta il testo della domanda); `TerminalMissionControl` la passa al Lens (`WaitingLine`).
- Limiti noti: un reload del renderer lascia orfani i PTY parcheggiati; il preload alza
  `setMaxListeners` perché ogni Mission Control tiene circa 5 listener IPC.
- Ciò che un programma nel terminale può chiedere alla macchina passa da `terminal-osc.ts`: una
  copia OSC 52 (fino a 1 MB) sì, una lettura degli appunti mai, un link OSC 8 solo se http(s).
- **Sessione remota** (`remote/`, #242/#294): arriva solo con prop opzionali. Con `remote`,
  `ChatView`, `MissionRail` e il resto **non leggono niente del progetto di questa macchina** — la
  cartella dell'host ha spesso lo stesso path di una locale — e `RemoteOriginContext` fa lo stesso
  per le foglie che aprono un file per path. Il pannello dei file non c'è.

## Altre viste

- **Cancellare una sessione o un progetto legge l'esito, non lo presume** (#193, #224): una
  cancellazione parziale resta a schermo col report per path. Un piano di `claude project purge`
  che tocca più di un progetto, o che non si legge, è rifiutato — anche dal modulo (`refusePurge`),
  così una UI che dimentica il controllo non lo aggira. Una sessione viva nel registro blocca, una
  trovata solo da `ps` avvisa.
- **Memoria**: le viste non scrivono mai su disco; le relazioni sono solo i `[[wikilink]]` scritti
  nei file, e le affinità restano tratteggiate. `MemoryTopic.filename` è il target grezzo di
  `MEMORY.md` e può essere un path, anche assoluto: i nomi si derivano con `baseName`.
- **Studio**: lo script `.js` è l'unica fonte di verità, nessun manifest nostro. Le viste visuali si
  spengono se il file non parsa o se `meta` è dinamico (la riscrittura perderebbe pezzi), e un save
  rifiuta un file cambiato fuori. `PromptPreview` non usa il `Markdown` condiviso: `remark-math`
  mangerebbe i `$` delle interpolazioni.
- **Agents live** (`agents-live/status.ts`): `tempo` dice cosa sta facendo un job, `state` è un nome
  d'esito. Needs-input è `tempo === 'blocked'` con `needs` diverso da `send a prompt to start`, uno
  stato terminale vale solo con `tempo !== 'active'`, un ricorrente riuscito non è finito: sono i
  predicati della CLI, non congetture.
- **Monitor** osserva e basta: dispatch, stop e respawn stanno solo in Agent View.
- **Ricerca nelle conversazioni**: parte con Invio, mai a ogni tasto, e non è nel set di
  `data:changed` — un result set è l'istantanea di una scansione su tutta la storia.
- **File del progetto**: sola lettura; SVG e HTML si mostrano come sorgente, mai renderizzati.
- **Settings**: la versione di Claude Code è `claude --version` (`useClaudeCodeVersion`), mai il
  `claude_code_version` dell'handshake SDK, che è la CLI impacchettata nell'app. La tab MCP legge
  `claude mcp list` (`mcp:getGlobal`): l'handshake è scoped alla cwd, e la home è untrusted.
  Read-only tranne Appearance e Privacy.
- **Descrizione del progetto**: l'edit va nelle prefs, mai nel CLAUDE.md del progetto; svuotarla
  toglie l'override.

## Principi della UI

- **Non affermare ciò che il transcript non registra.** Un risultato assente è `Pending`, mai un
  successo (`toolRunStatus`), e una riga in attesa non è mai `live`: il file non distingue una
  sessione che aspetta da una CLI morta. Niente versione inventata, niente "privato" senza
  `audience`, niente cifra di spesa forse parziale. Assente non è zero.
- Una cella che può valere zero lo dice (`—`, `no changes`) invece di sparire, e la stessa cifra
  non sta mai due volte a schermo.
- Un controllo non promette ciò che l'app non sa fare.
- Link esterni: `window.open` → `setWindowOpenHandler` del main → `shell.openExternal`, solo
  http(s); mai una navigazione nel renderer.
- La UI è in inglese, date comprese (en-US).

## Stile

- Tailwind più i token `--cl-*` e le classi `cl-*` di `index.css`; nessuna tinta d'accento nuova
  (vedi la root). L'unica tinta fuori dai 40° del brand è il colore che l'utente dà a una sessione
  con `/color`: è un dato, passa per classe (`.is-coloured.<nome>`, token `--cl-agent-*`), mai per
  `style` inline.
- L'app è su carta. Le superfici scure sono eccezioni: le finestre terminale/editor (`.cl-term`,
  scure in entrambi i temi coi valori dei code fence — niente `.cl-code-pre`, che rimappa per la
  carta) e la band "bloccato" del Monitor.
- Un solo `backdrop-filter` per pila: uno annidato campiona la tinta del livello sopra ed è un
  no-op. Un pannello aperto da una barra con `backdrop-filter` va in portal su `<body>`.
- Due famiglie di hover: neutra (`--cl-hover-bg`) per le liste fitte, accento
  (`--cl-glass-hover-bg`) per i controlli azionabili; la durata è `--cl-hover-ms`.
- Una `var()` non definita invalida l'intera dichiarazione: un token usato senza fallback va
  dichiarato in `:root`.
- Mai un path in maiuscolo: è un dato case-sensitive. `homeRelativePath` riconosce la home per
  forma, perché il renderer non ha `os.homedir()`.
- `.cl-srow` è la stessa riga nella landing e nella vista Sessions: toccarla cambia entrambe, ed è
  voluto.
- Il tema si sceglie solo in Settings → Appearance.

## Tolti apposta, da non rimettere

- Il merge dei progetti duplicati: la vista Duplicates segnala e basta (vedi
  `electron/modules/CLAUDE.md`).
- I filtri per tipo di turno, ovunque: resta solo il toggle di densità MIN/FULL.
- Il toggle `Notes` del commento in corsa (la chiave `cl-thoughts-hidden` nelle prefs è inerte).
- Un secondo ingresso alla ricerca: c'è solo la lente della top bar (⌘F).

## Codice

- Un `.tsx` esporta solo componenti (`react-refresh/only-export-components` è un errore in CI): il
  resto va in un `.ts` accanto, come `CreateFormKit.tsx` e `formKit.ts`.
- I dati passano dagli hook di `hooks/useIPC.ts`. `localStorage` solo per comodità (una larghezza,
  l'ultima cartella usata); i dati veri stanno nel main.
