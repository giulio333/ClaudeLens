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
// Il modulo si limita a riferire cosa dice il file; cosa sia ridondante lo
// decide `mergeTranscriptExtras`, che ha sotto gli occhi i messaggi dell'SDK.
import { readTextFile } from './safe-fs';
import type { ChatMessage } from '../shared/chat-types';

/** Prima riga dell'espansione che Claude Code inietta dopo una skill. */
const SKILL_EXPANSION_PREFIX = 'Base directory for this skill:';

export interface TranscriptExtras {
  /** Prosa dell'utente digitata a turno in corso e assorbita in esso. */
  queued: ChatMessage[];
  /** uuid della riga `user` che ha invocato una skill → base dir della skill.
   *  Il `parentUuid` dell'espansione è sempre quella riga: la `<command-name>`
   *  per una slash command, il `tool_result` per il tool `Skill`. */
  skillPathByParentUuid: Map<string, string>;
}

const EMPTY: TranscriptExtras = { queued: [], skillPathByParentUuid: new Map() };

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
  // Quando l'utente ha scritto il messaggio, per contenuto: la `remove` porta
  // l'ora dell'assorbimento, la `enqueue` quella della digitazione.
  const enqueuedAt = new Map<string, string>();

  for (const line of raw.split('\n')) {
    if (!line) continue;
    const isQueue = line.includes('"queue-operation"');
    const isSkillExpansion = line.includes(SKILL_EXPANSION_PREFIX);
    if (!isQueue && !isSkillExpansion) continue;

    let json: Record<string, unknown>;
    try {
      json = JSON.parse(line) as Record<string, unknown>;
    } catch {
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

  return { queued, skillPathByParentUuid };
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
  const { queued, skillPathByParentUuid } = extras;
  if (queued.length === 0 && skillPathByParentUuid.size === 0) return messages;

  const stamped =
    skillPathByParentUuid.size === 0
      ? messages
      : messages.map(msg => {
          const skillPath = skillPathByParentUuid.get(msg.uuid);
          return skillPath ? { ...msg, skillPath } : msg;
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
