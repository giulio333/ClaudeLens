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
  BashEditDiff,
  BashEditFile,
  BashEditHunk,
  ChatContentBlock,
  ChatMessage,
} from '../shared/chat-types';

/** Prima riga dell'espansione che Claude Code inietta dopo una skill. */
const SKILL_EXPANSION_PREFIX = 'Base directory for this skill:';

export interface TranscriptExtras {
  /** Prosa dell'utente digitata a turno in corso e assorbita in esso. */
  queued: ChatMessage[];
  /** uuid della riga `user` che ha invocato una skill → base dir della skill.
   *  Il `parentUuid` dell'espansione è sempre quella riga: la `<command-name>`
   *  per una slash command, il `tool_result` per il tool `Skill`. */
  skillPathByParentUuid: Map<string, string>;
  /** uuid della riga assistant → effort con cui quel turno è girato. */
  effortByUuid: Map<string, string>;
  /** `tool_use_id` del risultato Bash → i file che quel comando ha modificato. */
  bashEditDiffByToolUseId: Map<string, BashEditDiff>;
}

const EMPTY: TranscriptExtras = {
  queued: [],
  skillPathByParentUuid: new Map(),
  effortByUuid: new Map(),
  bashEditDiffByToolUseId: new Map(),
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
 * Il `tool_use_id` dell'UNICO `tool_result` di una riga.
 *
 * Il diff sta sulla riga, non sul blocco, quindi con due risultati nella stessa
 * riga non si saprebbe a quale dei due appartiene: sui 124 casi osservati la
 * riga ne ha sempre esattamente uno (ed è sempre un `Bash`), e con qualunque
 * altro numero si preferisce non mostrarlo che mostrarlo sul tool sbagliato.
 */
function soleToolResultId(message: unknown): string | undefined {
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
  // Quando l'utente ha scritto il messaggio, per contenuto: la `remove` porta
  // l'ora dell'assorbimento, la `enqueue` quella della digitazione.
  const enqueuedAt = new Map<string, string>();

  for (const line of raw.split('\n')) {
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
    if (!isQueue && !isSkillExpansion && !isBashEdit) continue;

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

    if (isQueue && json.type === 'queue-operation') {
      const content = typeof json.content === 'string' ? json.content.trim() : '';
      const timestamp = String(json.timestamp ?? '');
      if (!content) continue;
      if (json.operation === 'enqueue') {
        if (!enqueuedAt.has(content)) enqueuedAt.set(content, timestamp);
      } else if (json.operation === 'remove') {
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

  return { queued, skillPathByParentUuid, effortByUuid, bashEditDiffByToolUseId };
}

/**
 * I `tool_result` di un messaggio con il diff della loro riga, quando ce n'è
 * uno da mettere. Come sopra, il contenuto torna PER RIFERIMENTO se non cambia
 * nulla — e per il lettore da file non cambia mai, perché lì il diff è già sul
 * blocco: è la stessa ragione per cui `session-search` non paga una copia per
 * ogni messaggio di ogni transcript che passa il prefiltro.
 */
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
  const { queued, skillPathByParentUuid, effortByUuid, bashEditDiffByToolUseId } = extras;
  if (
    queued.length === 0 &&
    skillPathByParentUuid.size === 0 &&
    effortByUuid.size === 0 &&
    bashEditDiffByToolUseId.size === 0
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
    bashEditDiffByToolUseId.size === 0
      ? messages
      : messages.map(msg => {
          const skillPath = skillPathByParentUuid.get(msg.uuid);
          const effort = msg.effort ? undefined : effortByUuid.get(msg.uuid);
          const content = stampBashEditDiffs(msg.content, bashEditDiffByToolUseId);
          if (!skillPath && !effort && content === msg.content) return msg;
          return {
            ...msg,
            ...(content === msg.content ? {} : { content }),
            ...(skillPath ? { skillPath } : {}),
            ...(effort ? { effort } : {}),
          };
        });
  if (queued.length === 0) return stamped;

  const alreadyShown = new Set(messages.filter(m => m.role === 'user').map(m => messageText(m)));
  const pending = queued
    .filter(m => !alreadyShown.has(messageText(m)))
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
