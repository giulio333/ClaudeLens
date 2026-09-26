// Le righe di transcript che l'Agent SDK non restituisce.
//
// Lo storico chat è letto via `getSessionMessages`, che dà SOLO messaggi di
// chat: tutto ciò che Claude Code scrive nel `.jsonl` fuori da `type: "user" |
// "assistant"` (e ogni riga `isMeta`) è irraggiungibile da quella lettura. Due
// di quelle righe però contano per il transcript:
//
//   - `queue-operation` — un messaggio digitato mentre un turno era in corso.
//     Claude Code lo assorbe nel turno e lo registra SOLO qui, mai come riga
//     `user`: senza questa passata il transcript mostra Claude che risponde a
//     una domanda che non c'è (#245).
//   - la riga `isMeta` "Base directory for this skill: …" — l'espansione che
//     segue una slash command, e l'unico segnale che dice che quella `/foo` era
//     una skill e non un comando builtin (#246).
//
// A cui si aggiungono due campi, non righe: `effort` sta sulla riga assistant
// ACCANTO a `uuid`, non dentro `message`, quindi `getSessionMessages` — che
// restituisce solo `message` — non lo vede mai. Stessa sorte per
// `toolUseResult.bashEditDiff`, il diff dei file che un comando Bash ha
// modificato: l'SDK non restituisce `toolUseResult` affatto (una riga user torna
// con type/uuid/session_id/message/parent_tool_use_id/parent_agent_id/timestamp
// e nient'altro), e senza di esso una modifica fatta con `sed` o un heredoc —
// che non produce nessuna tool call Edit — si vede come un comando con il suo
// stdout e nulla che dica che un file è cambiato (#265).
//
// Il modulo si limita a riferire cosa dice il file; cosa sia ridondante lo
// decide `mergeTranscriptExtras`, che ha sotto gli occhi i messaggi dell'SDK.
import { readTextFile } from './safe-fs';
import type {
  ArtifactPublish,
  BashEditDiff,
  BashEditFile,
  BashEditHunk,
  ChatContentBlock,
  ChatMessage,
  InboundOrigin,
  SentMessage,
  SessionNotice,
} from '../shared/chat-types';

/** Prima riga dell'espansione che Claude Code inietta dopo una skill. */
const SKILL_EXPANSION_PREFIX = 'Base directory for this skill:';

export interface TranscriptExtras {
  /** Prosa dell'utente digitata a turno in corso e assorbita in esso. */
  queued: ChatMessage[];
  /** Righe che l'SDK non restituisce affatto e che non sono dell'utente: i
   *  messaggi arrivati da un'altra sessione o da un agente interno, e le notizie
   *  dell'harness che viaggiano su righe `isMeta`. Vanno inserite al loro posto
   *  cronologico come i `queued` (#274). */
  injected: ChatMessage[];
  /** uuid della riga → notizia, per le righe che l'SDK RESTITUISCE ma che non
   *  sono conversazione (la notifica di un task, l'idle di un sub-agente): si
   *  timbrano sul messaggio esistente invece di crearne uno. */
  noticeByUuid: Map<string, SessionNotice>;
  /** uuid della riga `user` che ha invocato una skill → base dir della skill.
   *  Il `parentUuid` dell'espansione è sempre quella riga: la `<command-name>`
   *  per una slash command, il `tool_result` per il tool `Skill`. */
  skillPathByParentUuid: Map<string, string>;
  /** uuid della riga assistant → effort con cui quel turno è girato. */
  effortByUuid: Map<string, string>;
  /** `tool_use_id` del risultato Bash → i file che quel comando ha modificato. */
  bashEditDiffByToolUseId: Map<string, BashEditDiff>;
  /** `tool_use_id` del risultato `Edit`/`Write` → gli hunk con i numeri di
   *  riga (`toolUseResult.structuredPatch`). L'input della chiamata dice COSA è
   *  cambiato, mai DOVE: senza questo un diff non ha numeri di riga. */
  patchByToolUseId: Map<string, BashEditHunk[]>;
  /** `tool_use_id` del risultato `Artifact` → la pagina che quella publish ha
   *  prodotto. Stessa sorte di `bashEditDiff`: sta su `toolUseResult`, che
   *  l'SDK non restituisce, e senza di essa la publish è una tool call generica
   *  con l'URL sepolto nel testo. */
  artifactByToolUseId: Map<string, ArtifactPublish>;
  /** `tool_use_id` del risultato `SendMessage` → la consegna che ha fatto. Terza
   *  della stessa famiglia: il `msg_id` sta su `toolUseResult`, e senza di esso
   *  il messaggio che questa sessione ha mandato a un'altra è una tool card
   *  generica con dentro il JSON del risultato — mentre la metà ricevuta ha la
   *  sua bolla (#274) e la sua pagina (#280), raggiungibili solo da lì. */
  sentByToolUseId: Map<string, SentMessage>;
}

const EMPTY: TranscriptExtras = {
  queued: [],
  injected: [],
  noticeByUuid: new Map(),
  skillPathByParentUuid: new Map(),
  effortByUuid: new Map(),
  bashEditDiffByToolUseId: new Map(),
  patchByToolUseId: new Map(),
  artifactByToolUseId: new Map(),
  sentByToolUseId: new Map(),
};

/**
 * L'effort di una riga di transcript già deserializzata: `perTurnEffort` quando
 * c'è (l'override del singolo turno), altrimenti l'`effort` di sessione. Un
 * valore non-stringa vale assente — sui transcript osservati `perTurnEffort` è
 * sempre `null`, ed è esattamente il caso che il `??` non deve lasciar passare.
 */
export function rowEffort(row: Record<string, unknown>): string | undefined {
  const perTurn = row.perTurnEffort;
  if (typeof perTurn === 'string' && perTurn) return perTurn;
  const effort = row.effort;
  return typeof effort === 'string' && effort ? effort : undefined;
}

/**
 * Il `bashEditDiff` di un `toolUseResult` già deserializzato, validato campo per
 * campo: la riga arriva da un file che un altro programma scrive e che nessuno
 * versiona, quindi ogni pezzo è opzionale finché non si è visto.
 *
 * Torna `undefined` quando non resta niente da mostrare — nessun file, nessun
 * path cambiato e nessun `unavailable` — così il chiamante non attacca al
 * transcript un blocco vuoto che si leggerebbe come "non è cambiato nulla".
 */
export function parseBashEditDiff(toolUseResult: unknown): BashEditDiff | undefined {
  if (!toolUseResult || typeof toolUseResult !== 'object') return undefined;
  const raw = (toolUseResult as Record<string, unknown>).bashEditDiff;
  if (!raw || typeof raw !== 'object') return undefined;
  const d = raw as Record<string, unknown>;

  const files: BashEditFile[] = [];
  if (Array.isArray(d.files)) {
    for (const entry of d.files) {
      if (!entry || typeof entry !== 'object') continue;
      const f = entry as Record<string, unknown>;
      if (typeof f.filePath !== 'string' || !f.filePath) continue;
      files.push({
        filePath: f.filePath,
        hunks: parseHunks(f.hunks),
        ...(f.created === true ? { created: true } : {}),
        ...(f.deleted === true ? { deleted: true } : {}),
      });
    }
  }

  const changedFiles = Array.isArray(d.changedFiles)
    ? d.changedFiles.filter((p): p is string => typeof p === 'string' && p.length > 0)
    : [];
  const moreFiles = typeof d.moreFiles === 'number' && d.moreFiles > 0 ? d.moreFiles : 0;
  const unavailable = d.unavailable === true;

  if (files.length === 0 && changedFiles.length === 0 && !unavailable) return undefined;
  return { files, changedFiles, moreFiles, ...(unavailable ? { unavailable: true } : {}) };
}

/**
 * Gli hunk di un `Edit`/`Write` dal suo `toolUseResult.structuredPatch`, con
 * i numeri di riga che l'input della chiamata non ha. `undefined` quando non
 * c'è o è vuoto: la `Write` di un file nuovo scrive `[]`, e lì il contenuto
 * della chiamata è già tutto il diff.
 */
export function parseEditPatch(toolUseResult: unknown): BashEditHunk[] | undefined {
  if (!toolUseResult || typeof toolUseResult !== 'object') return undefined;
  const hunks = parseHunks((toolUseResult as Record<string, unknown>).structuredPatch);
  return hunks.length > 0 ? hunks : undefined;
}

function parseHunks(raw: unknown): BashEditHunk[] {
  if (!Array.isArray(raw)) return [];
  const hunks: BashEditHunk[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const h = entry as Record<string, unknown>;
    const lines = Array.isArray(h.lines)
      ? h.lines.filter((l): l is string => typeof l === 'string')
      : [];
    if (lines.length === 0) continue;
    hunks.push({
      oldStart: num(h.oldStart),
      oldLines: num(h.oldLines),
      newStart: num(h.newStart),
      newLines: num(h.newLines),
      lines,
    });
  }
  return hunks;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * La pagina che una publish dell'`Artifact` tool ha prodotto, dal `toolUseResult`
 * della riga di risultato.
 *
 * Si legge solo ciò che Claude Code scrive come dato: niente è recuperato dalla
 * prosa del risultato, che di quella pagina parla ma mescolandola a un kilobyte
 * di istruzioni sulle live subscription. `url` e `artifact_id` insieme sono il
 * discriminante: una `read`, una `list` o una quickstart rispondono senza
 * pubblicare niente, e una card che le disegnasse come pagine direbbe il falso.
 *
 * `seq` è l'ordinale di versione — sugli 8 risultati del corpus che portano
 * entrambi coincide sempre con il `(Version N)` della prosa — ma manca sui
 * transcript più vecchi: lì resta assente, invece di essere dedotto dal numero
 * di publish visibili, che conterebbe solo quelle di questa sessione.
 */
export function parseArtifactPublish(toolUseResult: unknown): ArtifactPublish | undefined {
  if (!toolUseResult || typeof toolUseResult !== 'object') return undefined;
  const r = toolUseResult as Record<string, unknown>;
  const url = str(r.url);
  // A page created from a published Artifact type records no `artifact_id`: its
  // result has the URL, the title and a version string, and the publishes that
  // follow carry the id together with that same URL. The URL stands in for the
  // id there — the two are one-to-one wherever both are written — so the
  // creation draws as the page it made instead of a plain chip.
  const id = str(r.artifact_id) ?? (r.created_from_type === true ? url : undefined);
  if (!id || !url) return undefined;
  return {
    id,
    url,
    title: str(r.title) ?? '',
    updated: r.updated === true,
    ...(typeof r.seq === 'number' && Number.isFinite(r.seq) ? { seq: r.seq } : {}),
    ...(str(r.audience) ? { audience: str(r.audience) } : {}),
    ...(str(r.path) ? { path: str(r.path) } : {}),
    ...(str(r.icon) ? { icon: str(r.icon) } : {}),
  };
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

/**
 * La consegna che una `SendMessage` ha fatto, dal `toolUseResult` della riga di
 * risultato. Il `msg_id` è il discriminante: una chiamata che non ha consegnato
 * — nome irraggiungibile, risposta alla conversazione principale da dentro un
 * agente — non lo scrive, e non c'è consegna da attaccare. Il `routing` è ciò
 * che distingue la inbox di un teammate da un'altra sessione: `session-exchange`
 * tiene gli agenti fuori da ogni thread, e la bolla deve saperlo per non offrire
 * uno scambio che risponderebbe null. `display` è l'unica riga che Claude Code
 * scrive PER essere mostrata, e si porta com'è.
 */
export function parseSentMessage(toolUseResult: unknown): SentMessage | undefined {
  if (!toolUseResult || typeof toolUseResult !== 'object') return undefined;
  const r = toolUseResult as Record<string, unknown>;
  const msgId = str(r.msg_id);
  if (!msgId) return undefined;
  const toAgent = !!r.routing && typeof r.routing === 'object';
  return {
    msgId,
    to: toAgent ? 'agent' : 'session',
    ...(str(r.display) ? { display: str(r.display) } : {}),
  };
}

/** Attacca la consegna all'unico `tool_result` dei blocchi — come le due sopra. */
export function withSentMessage(blocks: ChatContentBlock[], sent: SentMessage): ChatContentBlock[] {
  if (blocks.filter(b => b.type === 'tool_result').length !== 1) return blocks;
  return blocks.map(b => (b.type === 'tool_result' ? { ...b, sent } : b));
}

/**
 * Attacca la pagina all'unico `tool_result` dei blocchi già deserializzati —
 * gemella di `withBashEditDiff`, per lo stesso motivo: il dato sta sulla riga,
 * non sul blocco.
 */
export function withArtifactPublish(
  blocks: ChatContentBlock[],
  artifact: ArtifactPublish
): ChatContentBlock[] {
  if (blocks.filter(b => b.type === 'tool_result').length !== 1) return blocks;
  return blocks.map(b => (b.type === 'tool_result' ? { ...b, artifact } : b));
}

/** Gemella di `withBashEditDiff` per gli hunk di un `Edit`/`Write`. */
export function withEditPatch(
  blocks: ChatContentBlock[],
  patch: BashEditHunk[]
): ChatContentBlock[] {
  if (blocks.filter(b => b.type === 'tool_result').length !== 1) return blocks;
  return blocks.map(b => (b.type === 'tool_result' ? { ...b, patch } : b));
}

/**
 * Il `tool_use_id` dell'UNICO `tool_result` di una riga.
 *
 * Il diff sta sulla riga, non sul blocco, quindi con due risultati nella stessa
 * riga non si saprebbe a quale dei due appartiene: sui 124 casi osservati la
 * riga ne ha sempre esattamente uno (ed è sempre un `Bash`), e con qualunque
 * altro numero si preferisce non mostrarlo che mostrarlo sul tool sbagliato.
 */
export function soleToolResultId(message: unknown): string | undefined {
  const content = (message as Record<string, unknown> | undefined)?.content;
  if (!Array.isArray(content)) return undefined;
  const ids = content
    .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
    .filter(b => b.type === 'tool_result' && typeof b.tool_use_id === 'string')
    .map(b => b.tool_use_id as string);
  return ids.length === 1 ? ids[0] : undefined;
}

/**
 * Attacca il diff all'unico `tool_result` dei blocchi già deserializzati — la
 * metà di `soleToolResultId` per chi ha in mano i blocchi e non la riga grezza
 * (il lettore da file, che la riga ce l'ha tutta e non deve ricostruire niente).
 */
export function withBashEditDiff(
  blocks: ChatContentBlock[],
  diff: BashEditDiff
): ChatContentBlock[] {
  if (blocks.filter(b => b.type === 'tool_result').length !== 1) return blocks;
  return blocks.map(b => (b.type === 'tool_result' ? { ...b, bashEditDiff: diff } : b));
}

/**
 * Il valore di un campo stringa dalla CODA di metadati di una riga grezza, senza
 * `JSON.parse`.
 *
 * Le chiavi che interessano qui (`uuid`, `effort`, `perTurnEffort`) stanno tutte
 * dopo `message` nell'ordine che Claude Code scrive, quindi `lastIndexOf` prende
 * quella della riga anche se il contenuto di un tool_result cita un transcript.
 * Niente `JSON.parse`: questa passata gira anche dentro `session-search`, su ogni
 * transcript che supera il prefiltro, accanto a un parse completo che già c'è —
 * raddoppiarlo per un campo di otto caratteri non si giustifica.
 */
function tailString(line: string, key: string): string | undefined {
  const marker = `"${key}":"`;
  const at = line.lastIndexOf(marker);
  if (at === -1) return undefined;
  const from = at + marker.length;
  const end = line.indexOf('"', from);
  return end > from ? line.slice(from, end) : undefined;
}

/** Il testo di un messaggio di chat, per confronti di contenuto. */
function messageText(msg: ChatMessage): string {
  return msg.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();
}

/** Il primo blocco di testo di una riga `.jsonl` grezza (content stringa o array). */
function rawFirstText(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  for (const block of content) {
    if (block && typeof block === 'object') {
      const b = block as { type?: unknown; text?: unknown };
      if (b.type === 'text' && typeof b.text === 'string') return b.text;
    }
  }
  return '';
}

/**
 * Una passata sul `.jsonl` per le sole righe che l'SDK scarta.
 *
 * Materializza **solo** le `queue-operation` con `operation: "remove"`: la
 * coppia `enqueue`/`dequeue` è il caso normale — un messaggio accodato e poi
 * consegnato come turno proprio, quindi già nel transcript — e renderla
 * duplicherebbe i turni. Una `remove` invece dice che quel messaggio non è
 * diventato un turno: `reason: "absorbed_mid_turn"` sulle versioni recenti,
 * nessun `reason` sulle più vecchie, `delivered_to_agent` quando è finito a un
 * sub-agente. Il timestamp mostrato è quello della `enqueue` gemella (quando
 * l'utente ha scritto), non quello dell'assorbimento.
 *
 * Tollerante come gli altri lettori di transcript: reject a stringa prima di
 * `JSON.parse`, errori per riga ignorati, e un file illeggibile vale "niente da
 * aggiungere" invece di far cadere la lettura dello storico.
 */
export async function readTranscriptExtras(filePath: string): Promise<TranscriptExtras> {
  let raw: string;
  try {
    raw = await readTextFile(filePath);
  } catch {
    return EMPTY;
  }
  return parseTranscriptExtras(raw);
}

// ─── Provenienza: chi ha messo una riga utente nel transcript (#274) ─────────
//
// Claude Code scrive su ogni riga utente un `origin` che dice da dove viene:
// `human` (l'ha digitata l'utente), `peer` (un'altra sessione, o un agente
// dentro questa), `task-notification`, `auto-continuation`, `coordinator`.
// Nessun lettore lo guardava, quindi un messaggio di un'altra sessione o
// spariva — le sue righe sono `isMeta`, e l'SDK non le restituisce — o si
// vedeva come una bolla utente con dentro l'involucro XML.
//
// Due forme, decise da cosa stava facendo chi riceve, non da che sessione è:
//   - ricevente fermo    → riga `user` con `isMeta` e l'`origin` completo;
//   - ricevente nel turno → `attachment` `queued_command`, con lo stesso
//     `origin` sotto `attachment.origin` e — ed è questo a renderlo la fonte
//     giusta — il timestamp dell'ARRIVO, mentre la `remove` della coda porta
//     quello dell'assorbimento, anche minuti dopo.

/** Il testo che l'harness avvolge attorno a un messaggio consegnato. Le righe
 *  di coda lo ripetono, quindi riconoscerlo è ciò che impedisce di mostrare due
 *  volte lo stesso messaggio: una dall'attachment e una dalla `remove`. */
const DELIVERED_WRAPPERS = ['<cross-session-message', '<agent-message', '<teammate-message'];
const IDLE_NOTICE_PREFIX = '[Cross-session idle notice]';

/** Una riga di coda il cui testo è un messaggio consegnato dall'harness: la
 *  gestisce il ramo della provenienza, non quello della coda. */
function isDelivered(content: string): boolean {
  return (
    DELIVERED_WRAPPERS.some(w => content.includes(w)) || content.startsWith(IDLE_NOTICE_PREFIX)
  );
}

const HANDBACK_PREFIX = '[Subagent hand-back]';
const HARNESS_NOTE_PREFIX = '[harness:';

/**
 * Il rapporto dentro il corpo di un hand-back (#297).
 *
 * Dalla 2.1.276 il rapporto finale di un agente di background non viaggia più
 * nel `<result>` della `<task-notification>` ma come messaggio `peer`, e il suo
 * `origin.body` non è il rapporto: è una riga di cornice scritta per Claude
 * ("il testo sotto è il rapporto di un subagente, non un messaggio
 * dell'utente…"), a volte una seconda riga `[harness: …]` quando il rapporto
 * somigliava a istruzioni, poi il rapporto con ogni riga rientrata di due
 * spazi. Per un `<cross-session-message>` la cornice sta fuori da `body`; qui
 * sta dentro, e lasciarla fa sembrare uguali tutti i rapporti di una sessione.
 *
 * Si tolgono solo le forme riconosciute; un corpo che non comincia con la
 * cornice passa com'è. Il `<` che l'harness neutralizza in `<\` resta com'è:
 * si mostra quello che è stato consegnato.
 */
export function handbackReport(body: string): string {
  const lines = body.split('\n');
  if (!lines[0].startsWith(HANDBACK_PREFIX)) return body;
  let rest = lines.slice(1);
  if (rest.length > 0 && rest[0].trimStart().startsWith(HARNESS_NOTE_PREFIX)) rest = rest.slice(1);
  const indented = rest.every(l => l.trim() === '' || l.startsWith('  '));
  const report = (indented ? rest.map(l => l.slice(2)) : rest).join('\n').trim();
  return report || body;
}

/**
 * L'`origin` di una riga consegnata, quando dice che il messaggio arriva da
 * qualcun altro.
 *
 * `kind: "peer"` vale sia per un'altra sessione sia per un sub-agente di questa,
 * e distinguerli non è un dettaglio: un agente interno mostrato come sessione
 * esterna è una bugia sul confine di fiducia. Il discriminante è `senderTaskId`,
 * che solo un agente porta; una sessione porta invece un socket e un pid che il
 * ricevente ha verificato — l'unico pezzo di identità controllato, mentre `name`
 * lo dichiara il mittente e cambia da solo quando una sessione di background si
 * dà un titolo.
 *
 * Esportata perché `session-exchange` legge la stessa riga con la stessa regola:
 * le due metà di un messaggio si uniscono su `msg_id`, e chi le unisce non deve
 * poter divergere da chi le disegna su cosa sia un mittente.
 */
export function parseInbound(
  raw: unknown,
  queued: boolean
): { origin: InboundOrigin; body: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.kind !== 'peer') return null;
  const rawBody = typeof o.body === 'string' ? o.body.trim() : '';
  if (!rawBody) return null;
  const taskId = typeof o.senderTaskId === 'string' && o.senderTaskId ? o.senderTaskId : undefined;
  const agent = taskId !== undefined;
  const handback = agent && o.handback === true;
  const body = handback ? handbackReport(rawBody) : rawBody;
  const name = typeof o.name === 'string' && o.name ? o.name : undefined;
  const pid = !agent && typeof o.verifiedPeerPid === 'number' ? o.verifiedPeerPid : undefined;
  const msgId = typeof o.msg_id === 'string' && o.msg_id ? o.msg_id : undefined;
  const hops = Array.isArray(o.hopChain)
    ? o.hopChain.filter((h): h is string => typeof h === 'string')
    : undefined;
  return {
    body,
    origin: {
      from: agent ? 'agent' : 'session',
      ...(name ? { name } : {}),
      ...(pid !== undefined ? { pid } : {}),
      ...(taskId ? { taskId } : {}),
      ...(handback ? { handback: true as const } : {}),
      ...(msgId ? { msgId } : {}),
      ...(hops && hops.length > 0 ? { hopChain: hops } : {}),
      ...(queued ? { queued: true as const } : {}),
    },
  };
}

/** L'avviso che una sessione a cui si era chiesto di farlo sapere è tornata
 *  ferma. È l'unica forma della famiglia senza `origin`: si riconosce dal
 *  prefisso e da nient'altro. */
function parseIdleNotice(text: string): SessionNotice | null {
  if (!text.startsWith(IDLE_NOTICE_PREFIX)) return null;
  const rest = text.slice(IDLE_NOTICE_PREFIX.length).trim();
  const subject = rest.match(/^"([^"]+)"/)?.[1];
  const line = rest.split('\n')[0].trim();
  if (!line) return null;
  return { kind: 'session-idle', ...(subject ? { subject } : {}), text: line };
}

/** Il rapporto di fine lavoro di un sub-agente: un `<teammate-message>` che
 *  contiene un JSON `idle_notification`. Non è prosa, e oggi si vede come bolla
 *  utente col JSON dentro. Un `<teammate-message>` che NON è una idle
 *  notification è un messaggio vero e passa dal ramo `origin`. */
function parseAgentIdleNotice(text: string): SessionNotice | null {
  const m = text.match(
    /<teammate-message teammate_id="([^"]+)"[^>]*>\s*([\s\S]*?)\s*<\/teammate-message>/
  );
  if (!m) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(m[2]);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (p.type !== 'idle_notification') return null;
  const result = typeof p.result === 'string' ? p.result.trim() : '';
  return { kind: 'agent-idle', subject: m[1], text: result || 'finished' };
}

/**
 * La metà pura di `readTranscriptExtras`, su testo già in memoria.
 *
 * Esportata per lo stesso motivo di `parseChatSessionText`: `session-search`
 * legge ogni transcript UNA volta — grezzo, per il suo reject a substring — e
 * deve ricavare gli extra da quella stessa stringa invece di riaprire il file.
 * Condividere la funzione è anche ciò che tiene ricerca e transcript d'accordo
 * su quali righe sono un messaggio: senza, la ricerca non vedrebbe i messaggi
 * assorbiti a turno in corso, che la vista invece mostra — si cercherebbe una
 * frase che si ha sotto gli occhi e non si troverebbe nulla.
 */
export function parseTranscriptExtras(raw: string): TranscriptExtras {
  const queued: ChatMessage[] = [];
  const skillPathByParentUuid = new Map<string, string>();
  const effortByUuid = new Map<string, string>();
  const bashEditDiffByToolUseId = new Map<string, BashEditDiff>();
  const patchByToolUseId = new Map<string, BashEditHunk[]>();
  const artifactByToolUseId = new Map<string, ArtifactPublish>();
  const sentByToolUseId = new Map<string, SentMessage>();
  const injected: ChatMessage[] = [];
  const noticeByUuid = new Map<string, SessionNotice>();
  // Quando l'utente ha scritto il messaggio, per contenuto: la `remove` porta
  // l'ora dell'assorbimento, la `enqueue` quella della digitazione.
  const enqueuedAt = new Map<string, string>();

  const lines = raw.split('\n');
  for (const line of lines) {
    if (!line) continue;
    // L'effort è un campo su una riga che l'SDK restituisce comunque, non una
    // riga a sé: si legge qui e si esce, senza passare dal `JSON.parse` sotto.
    if (line.includes('"type":"assistant"')) {
      const uuid = tailString(line, 'uuid');
      const effort = tailString(line, 'perTurnEffort') ?? tailString(line, 'effort');
      if (uuid && effort) effortByUuid.set(uuid, effort);
    }
    const isQueue = line.includes('"queue-operation"');
    const isSkillExpansion = line.includes(SKILL_EXPANSION_PREFIX);
    const isBashEdit = line.includes('"bashEditDiff"');
    // `structuredPatch` sta solo sul risultato di un `Edit`/`Write`.
    const isPatch = line.includes('"structuredPatch"');
    // `artifact_id` sta solo sul risultato di una publish: una `read` o una
    // `list` dell'Artifact tool non lo scrivono, quindi il prefiltro è già il
    // discriminante e non c'è da deserializzare il resto del corpus. L'unica
    // pagina senza id è quella creata da un tipo, che dice di esserlo.
    const isArtifact = line.includes('"artifact_id"') || line.includes('"created_from_type":true');
    // `"msg_id"` sta su ENTRAMBE le metà di un messaggio: sul `toolUseResult`
    // del mittente e sull'`origin` del ricevente. Qui interessa la prima; la
    // seconda passa dal ramo della provenienza sotto, quindi questo prefiltro
    // non chiude la riga da solo.
    const isSent = line.includes('"msg_id"');
    // Il prefiltro resta stretto apposta: `"origin"` da solo sta su ogni riga
    // che l'utente ha digitato (1297 su 1500 nel corpus di prova), e questo
    // modulo passa su ogni transcript che supera il prefiltro di
    // `session-search`. Si cercano i soli valori discriminanti.
    const isProvenance =
      line.includes('"kind":"peer"') ||
      line.includes('"kind":"auto-continuation"') ||
      line.includes(IDLE_NOTICE_PREFIX) ||
      line.includes('<teammate-message');
    if (
      !isQueue &&
      !isSkillExpansion &&
      !isBashEdit &&
      !isPatch &&
      !isArtifact &&
      !isSent &&
      !isProvenance
    )
      continue;

    let json: Record<string, unknown>;
    try {
      json = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (isBashEdit) {
      // Una riga col diff è una `user` con un solo `tool_result`: non è né una
      // riga di coda né l'espansione di una skill, quindi si chiude qui.
      const diff = parseBashEditDiff(json.toolUseResult);
      const toolUseId = soleToolResultId(json.message);
      if (diff && toolUseId) bashEditDiffByToolUseId.set(toolUseId, diff);
      continue;
    }

    if (isPatch) {
      const patch = parseEditPatch(json.toolUseResult);
      const toolUseId = soleToolResultId(json.message);
      if (patch && toolUseId) {
        patchByToolUseId.set(toolUseId, patch);
        continue;
      }
    }

    if (isArtifact) {
      // Come sopra: la pagina sta sulla riga, quindi con due `tool_result` non
      // si saprebbe a quale appartiene e si preferisce non mostrarla.
      const artifact = parseArtifactPublish(json.toolUseResult);
      const toolUseId = soleToolResultId(json.message);
      if (artifact && toolUseId) artifactByToolUseId.set(toolUseId, artifact);
      continue;
    }

    if (isSent) {
      const sent = parseSentMessage(json.toolUseResult);
      const toolUseId = soleToolResultId(json.message);
      if (sent && toolUseId) {
        sentByToolUseId.set(toolUseId, sent);
        continue;
      }
    }

    // Una riga di coda che PARLA di un messaggio consegnato resta affare del
    // ramo della coda: qui si guardano le righe che il messaggio lo portano.
    if (isProvenance && json.type !== 'queue-operation') {
      const uuid = typeof json.uuid === 'string' && json.uuid ? json.uuid : '';
      const timestamp = String(json.timestamp ?? '');
      const attachment = json.attachment as Record<string, unknown> | undefined;

      // Ricevente nel turno: l'attachment è la fonte migliore delle righe di
      // coda che lo circondano — stesso `origin`, testo già pulito, e il
      // timestamp dell'arrivo invece che quello dell'assorbimento.
      if (json.type === 'attachment' && attachment && attachment.type === 'queued_command') {
        const parsed = parseInbound(attachment.origin, true);
        if (parsed) {
          injected.push({
            uuid: uuid || `inbound-${timestamp}-${injected.length}`,
            role: 'user',
            timestamp: String(attachment.timestamp ?? timestamp),
            content: [{ type: 'text', text: parsed.body }],
            inbound: parsed.origin,
          });
        }
        continue;
      }

      if (json.type !== 'user') continue;
      const origin = json.origin as Record<string, unknown> | undefined;

      // Ricevente fermo: la riga `user` porta tutto, ed è `isMeta`, quindi
      // l'SDK non la restituisce e questa passata è l'unica che la vede.
      const parsed = parseInbound(origin, false);
      if (parsed) {
        injected.push({
          uuid: uuid || `inbound-${timestamp}-${injected.length}`,
          role: 'user',
          timestamp,
          content: [{ type: 'text', text: parsed.body }],
          inbound: parsed.origin,
        });
        continue;
      }

      const text = rawFirstText(json.message).trim();
      const notice =
        parseIdleNotice(text) ??
        parseAgentIdleNotice(text) ??
        (origin && origin.kind === 'auto-continuation' && text
          ? ({ kind: 'auto-continuation', text: text.split('\n')[0].trim() } as SessionNotice)
          : null);
      if (!notice) continue;
      // `isMeta` decide da che parte esce: l'SDK restituisce le righe che non lo
      // sono (la notifica di un task, il rapporto di un sub-agente), e quelle si
      // timbrano sul messaggio già in lista invece di duplicarlo.
      if (json.isMeta === true) {
        injected.push({
          uuid: uuid || `notice-${timestamp}-${injected.length}`,
          role: 'user',
          timestamp,
          content: [{ type: 'text', text: notice.text }],
          notice,
        });
      } else if (uuid) {
        noticeByUuid.set(uuid, notice);
      }
      continue;
    }

    if (isQueue && json.type === 'queue-operation') {
      const content = typeof json.content === 'string' ? json.content.trim() : '';
      const timestamp = String(json.timestamp ?? '');
      if (!content) continue;
      // L'ora della `enqueue` si prende sempre, anche per ciò che questo ramo
      // non materializza: è l'unica che dice QUANDO il messaggio è arrivato.
      if (json.operation === 'enqueue') {
        if (!enqueuedAt.has(content)) enqueuedAt.set(content, timestamp);
        continue;
      }
      // Un messaggio consegnato dall'harness passa di qui come qualsiasi altra
      // cosa in coda, ma ha già la sua riga (l'attachment, o la `user` isMeta):
      // materializzarlo anche qui lo mostrerebbe due volte, e con l'ora
      // sbagliata — la `remove` porta l'assorbimento, non l'arrivo (#275).
      // Le notizie dell'harness sono l'eccezione: una riga propria non sempre
      // ce l'hanno, e perderle è peggio che datarle all'assorbimento.
      if (isDelivered(content)) {
        const notice = parseIdleNotice(content) ?? parseAgentIdleNotice(content);
        if (notice && json.operation === 'remove') {
          const arrivedAt = enqueuedAt.get(content) ?? timestamp;
          injected.push({
            uuid: `notice-${arrivedAt}-${injected.length}`,
            role: 'user',
            timestamp: arrivedAt,
            content: [{ type: 'text', text: notice.text }],
            notice,
          });
        }
        continue;
      }
      if (json.operation === 'remove') {
        const typedAt = enqueuedAt.get(content) ?? timestamp;
        queued.push({
          // Le righe di coda non hanno uuid: ne serve uno stabile tra due
          // letture, perché è la key React della bolla.
          uuid: `queued-${typedAt}-${queued.length}`,
          role: 'user',
          timestamp: typedAt,
          content: [{ type: 'text', text: content }],
          queued: true,
        });
      }
      continue;
    }

    if (isSkillExpansion && json.isMeta === true && typeof json.parentUuid === 'string') {
      const text = rawFirstText(json.message).trim();
      if (!text.startsWith(SKILL_EXPANSION_PREFIX)) continue;
      const path = text.slice(SKILL_EXPANSION_PREFIX.length).split('\n')[0].trim();
      if (path) skillPathByParentUuid.set(json.parentUuid, path);
    }
  }

  nameHandbacks(lines, injected);

  return {
    queued,
    injected,
    noticeByUuid,
    skillPathByParentUuid,
    effortByUuid,
    bashEditDiffByToolUseId,
    patchByToolUseId,
    artifactByToolUseId,
    sentByToolUseId,
  };
}

/**
 * Il nome dei rapporti di fine lavoro che non ne portano uno (#297).
 *
 * L'`origin` di un hand-back ha solo l'id del task, che è l'`agentId` scritto
 * sul risultato della chiamata `Agent` che ha lanciato l'agente, nello stesso
 * file: da lì si prende la `description` del dispatch, la riga che la lista
 * Agents mette sotto il tipo. Il tipo da solo non basterebbe: nove agenti
 * `general-purpose` sarebbero nove volte lo stesso nome.
 *
 * Seconda passata apposta, e solo per i file che hanno hand-back senza nome: le
 * righe con `"agentId"` sono circa il 2% del corpus, e deserializzarle tutte
 * nel ciclo sopra lo farebbe pagare a ogni transcript che `session-search`
 * legge.
 */
function nameHandbacks(lines: string[], injected: ChatMessage[]): void {
  const unnamed = new Map<string, InboundOrigin[]>();
  for (const m of injected) {
    const o = m.inbound;
    if (!o?.handback || !o.taskId || o.name) continue;
    const list = unnamed.get(o.taskId);
    if (list) list.push(o);
    else unnamed.set(o.taskId, [o]);
  }
  if (unnamed.size === 0) return;

  for (const line of lines) {
    if (!line.includes('"toolUseResult"')) continue;
    const id = [...unnamed.keys()].find(k => line.includes(`"agentId":"${k}"`));
    if (!id) continue;
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const result = json.toolUseResult as Record<string, unknown> | undefined;
    // Anche le righe dell'agente stesso nominano il suo id: conta solo il
    // risultato del dispatch, che lo porta come `agentId` di primo livello.
    if (!result || typeof result !== 'object' || result.agentId !== id) continue;
    const description = typeof result.description === 'string' ? result.description.trim() : '';
    if (!description) continue;
    for (const o of unnamed.get(id)!) o.name = description;
    unnamed.delete(id);
    if (unnamed.size === 0) return;
  }
}

function stampSentMessages(
  content: ChatContentBlock[],
  byToolUseId: Map<string, SentMessage>
): ChatContentBlock[] {
  if (byToolUseId.size === 0) return content;
  const needs = (b: ChatContentBlock): boolean =>
    b.type === 'tool_result' && !b.sent && byToolUseId.has(b.toolUseId);
  if (!content.some(needs)) return content;
  return content.map(b =>
    needs(b) ? { ...b, sent: byToolUseId.get((b as { toolUseId: string }).toolUseId) } : b
  );
}

/**
 * I `tool_result` di un messaggio con il diff della loro riga, quando ce n'è
 * uno da mettere. Come sopra, il contenuto torna PER RIFERIMENTO se non cambia
 * nulla — e per il lettore da file non cambia mai, perché lì il diff è già sul
 * blocco: è la stessa ragione per cui `session-search` non paga una copia per
 * ogni messaggio di ogni transcript che passa il prefiltro.
 */
function stampArtifacts(
  content: ChatContentBlock[],
  byToolUseId: Map<string, ArtifactPublish>
): ChatContentBlock[] {
  if (byToolUseId.size === 0) return content;
  const needs = (b: ChatContentBlock): boolean =>
    b.type === 'tool_result' && !b.artifact && byToolUseId.has(b.toolUseId);
  if (!content.some(needs)) return content;
  return content.map(b =>
    needs(b) ? { ...b, artifact: byToolUseId.get((b as { toolUseId: string }).toolUseId) } : b
  );
}

function stampEditPatches(
  content: ChatContentBlock[],
  byToolUseId: Map<string, BashEditHunk[]>
): ChatContentBlock[] {
  if (byToolUseId.size === 0) return content;
  const needs = (b: ChatContentBlock): boolean =>
    b.type === 'tool_result' && !b.patch && byToolUseId.has(b.toolUseId);
  if (!content.some(needs)) return content;
  return content.map(b =>
    needs(b) ? { ...b, patch: byToolUseId.get((b as { toolUseId: string }).toolUseId) } : b
  );
}

function stampBashEditDiffs(
  content: ChatContentBlock[],
  byToolUseId: Map<string, BashEditDiff>
): ChatContentBlock[] {
  if (byToolUseId.size === 0) return content;
  const needs = (b: ChatContentBlock): boolean =>
    b.type === 'tool_result' && !b.bashEditDiff && byToolUseId.has(b.toolUseId);
  if (!content.some(needs)) return content;
  return content.map(b =>
    needs(b) ? { ...b, bashEditDiff: byToolUseId.get((b as { toolUseId: string }).toolUseId) } : b
  );
}

/**
 * Rimette nel transcript ciò che l'SDK ha perso: i messaggi accodati al loro
 * posto cronologico e la base dir della skill sul messaggio che l'ha invocata.
 *
 * Un messaggio accodato il cui testo è già quello di un messaggio utente viene
 * scartato: sui transcript osservati non capita (una `remove` non è mai anche
 * una riga `user`), ma è ciò che separa "assorbito" da "consegnato" e non vale
 * la pena fidarsi della sola `operation`.
 */
export function mergeTranscriptExtras(
  messages: ChatMessage[],
  extras: TranscriptExtras
): ChatMessage[] {
  const {
    queued,
    injected,
    noticeByUuid,
    skillPathByParentUuid,
    effortByUuid,
    bashEditDiffByToolUseId,
    patchByToolUseId,
    artifactByToolUseId,
    sentByToolUseId,
  } = extras;
  if (
    queued.length === 0 &&
    injected.length === 0 &&
    noticeByUuid.size === 0 &&
    skillPathByParentUuid.size === 0 &&
    effortByUuid.size === 0 &&
    bashEditDiffByToolUseId.size === 0 &&
    patchByToolUseId.size === 0 &&
    artifactByToolUseId.size === 0 &&
    sentByToolUseId.size === 0
  ) {
    return messages;
  }

  // `parseChatSessionText` legge l'effort dalla riga che ha già deserializzato,
  // quindi per il lettore da file il campo è già pieno e qui non c'è nulla da
  // fare: il messaggio torna PER RIFERIMENTO, non riscritto col valore che ha
  // già. È il caso normale di `session-search`, che passa di qui ogni transcript
  // superi il prefiltro — copiarli tutti per riaffermare un campo letto dalla
  // stessa riga sarebbe un'allocazione per turno assistant e per file.
  const stamped =
    skillPathByParentUuid.size === 0 &&
    effortByUuid.size === 0 &&
    bashEditDiffByToolUseId.size === 0 &&
    patchByToolUseId.size === 0 &&
    artifactByToolUseId.size === 0 &&
    sentByToolUseId.size === 0 &&
    noticeByUuid.size === 0
      ? messages
      : messages.map(msg => {
          const skillPath = skillPathByParentUuid.get(msg.uuid);
          const effort = msg.effort ? undefined : effortByUuid.get(msg.uuid);
          const notice = noticeByUuid.get(msg.uuid);
          const content = stampSentMessages(
            stampArtifacts(
              stampEditPatches(
                stampBashEditDiffs(msg.content, bashEditDiffByToolUseId),
                patchByToolUseId
              ),
              artifactByToolUseId
            ),
            sentByToolUseId
          );
          if (!skillPath && !effort && !notice && content === msg.content) return msg;
          return {
            ...msg,
            ...(content === msg.content ? {} : { content }),
            ...(skillPath ? { skillPath } : {}),
            ...(effort ? { effort } : {}),
            ...(notice ? { notice } : {}),
          };
        });
  if (queued.length === 0 && injected.length === 0) return stamped;

  const alreadyShown = new Set(messages.filter(m => m.role === 'user').map(m => messageText(m)));
  // Le righe iniettate non passano dal filtro per testo: non sono dell'utente e
  // l'SDK non le restituisce affatto, quindi un testo uguale a quello di un
  // messaggio utente è una coincidenza, non un doppione.
  const pending = queued
    .filter(m => !alreadyShown.has(messageText(m)))
    .concat(injected)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  if (pending.length === 0) return stamped;

  // I messaggi dell'SDK sono già in ordine cronologico: un merge lineare basta.
  const merged: ChatMessage[] = [];
  let next = 0;
  for (const msg of stamped) {
    while (next < pending.length && pending[next].timestamp <= msg.timestamp) {
      merged.push(pending[next++]);
    }
    merged.push(msg);
  }
  while (next < pending.length) merged.push(pending[next++]);
  return merged;
}
