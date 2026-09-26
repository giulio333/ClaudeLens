import type { ProcessedMessage } from '../chat/utils';
import {
  isMessageTool,
  messageBody,
  messageDeliveryState,
  messageExchangeId,
  messageRecipient,
  messageSummary,
} from '../chat/sent-message';
import type { MessageDeliveryState } from '../chat/sent-message';

/**
 * The data model behind Mission Control's **messages dock** — the conversations
 * this session is having with other sessions, and with agents inside itself.
 *
 * Both halves are in the transcript, on different rows: a received message is a
 * turn carrying `inbound` (#274), a sent one a `SendMessage` tool call in an
 * assistant turn (`chat/sent-message.ts`). They are NOT feed events: a feed row
 * is one operation with a time and an outcome, and a message is a line in a
 * conversation — what the reader wants is the conversation, who it is with and
 * where it stands, which is the shape a messenger's sidebar has and a feed
 * cannot. So the dock groups them by counterpart and keeps them out of the
 * stream.
 *
 * **Who the counterpart is.** The name on a message is the other party's own
 * claim and changes on its own (a background session renames itself once it
 * has a topic), so it labels a thread and never keys one on its own. What was
 * verified is the sender's pid on a received message; a sent message names a
 * socket (`uds:/tmp/cc-socks/<pid>.sock`) or a name. A thread is keyed by pid
 * whenever either side gives one, and a message that only carries a name joins
 * the pid-keyed thread whose received messages declared that name — otherwise
 * it stands under the name, which is honest: nothing tied it to a process.
 * Agents key the same way on their task id, which Claude Code wrote rather than
 * the agent declared — a hand-back (#297) carries no name at all, and keyed by
 * name every report of a session fell into one thread — and a message that
 * names a teammate joins the thread of the task that declared that name.
 */

export type ThreadMessage = {
  direction: 'in' | 'out';
  /** Epoch ms of the turn; 0 when the timestamp could not be read. */
  at: number;
  /** The message text — `origin.body` on the way in, `input.message` out. */
  text: string;
  /** The one-line summary the sender gave a sent message. */
  summary?: string;
  /** Delivery state of a sent message; absent on a received one. */
  state?: MessageDeliveryState;
  /** The id the exchange reader joins on: present on a message to or from
   *  another session that was delivered. */
  msgId?: string;
  /** 1-based turn index in `processed` — where the dock can locate it. */
  turnN: number;
  /** Arrived while a turn was running. */
  queued?: boolean;
};

export type MessageThread = {
  key: string;
  /** What the counterpart is called: the latest name it declared, else what
   *  the calls addressed it as, else the pid. */
  party: string;
  kind: 'session' | 'agent';
  /** Oldest first. */
  messages: ThreadMessage[];
  last: ThreadMessage;
  received: number;
  sent: number;
  /** The newest message with an id — the door to the exchange page, which
   *  shows the whole conversation from either message. */
  msgId?: string;
};

function ms(iso: string | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

const SOCKET_PID = /^uds:.*\/(\d+)\.sock$/;

/** The pid a `to` names when it names a socket. */
export function socketPid(to: string): number | undefined {
  const m = SOCKET_PID.exec(to);
  return m ? Number(m[1]) : undefined;
}

type Raw = ThreadMessage & {
  kind: 'session' | 'agent';
  pid?: number;
  taskId?: string;
  name?: string;
};

function collect(processed: ProcessedMessage[]): Raw[] {
  const out: Raw[] = [];
  processed.forEach((p, i) => {
    const at = ms(p.msg.timestamp);
    const inbound = p.msg.inbound;
    if (inbound) {
      const text = p.msg.content
        .map(b => (b.type === 'text' ? b.text : ''))
        .join('\n')
        .trim();
      const fromSession = inbound.from === 'session';
      out.push({
        direction: 'in',
        at,
        text,
        turnN: i + 1,
        kind: fromSession ? 'session' : 'agent',
        ...(inbound.pid !== undefined ? { pid: inbound.pid } : {}),
        ...(inbound.taskId ? { taskId: inbound.taskId } : {}),
        ...(inbound.name ? { name: inbound.name } : {}),
        ...(fromSession && inbound.msgId ? { msgId: inbound.msgId } : {}),
        ...(inbound.queued ? { queued: true } : {}),
      });
    }
    for (const g of p.toolGroups) {
      if (!isMessageTool(g.use.name)) continue;
      const state = messageDeliveryState(g);
      const to = messageRecipient(g);
      const pid = socketPid(to);
      const summary = messageSummary(g);
      const msgId = messageExchangeId(g);
      out.push({
        direction: 'out',
        at,
        text: messageBody(g),
        turnN: i + 1,
        state,
        // A delivery to a teammate's inbox is the one shape that says "agent";
        // everything else — delivered, pending or not — is addressed to a
        // session, which is what `SendMessage` to a name means when the name
        // is not a teammate's.
        kind: state === 'sent-to-agent' ? 'agent' : 'session',
        ...(pid !== undefined ? { pid } : { name: to }),
        ...(summary ? { summary } : {}),
        ...(msgId ? { msgId } : {}),
      });
    }
  });
  return out;
}

/** Every conversation of the session, most recently active first. */
export function buildMessageThreads(processed: ProcessedMessage[]): MessageThread[] {
  const raws = collect(processed);

  // A name a verified pid declared, from the received side: the one link that
  // lets a message addressed by name join the thread of the process behind it.
  const pidByName = new Map<string, number>();
  const taskByName = new Map<string, string>();
  for (const r of raws) {
    if (r.direction !== 'in' || !r.name) continue;
    if (r.kind === 'session' && r.pid !== undefined && !pidByName.has(r.name))
      pidByName.set(r.name, r.pid);
    if (r.kind === 'agent' && r.taskId && !taskByName.has(r.name)) taskByName.set(r.name, r.taskId);
  }

  const keyOf = (r: Raw): string => {
    if (r.kind === 'agent') {
      const task = r.taskId ?? (r.name ? taskByName.get(r.name) : undefined);
      return task ? `task:${task}` : `agent:${r.name ?? '?'}`;
    }
    const pid = r.pid ?? (r.name ? pidByName.get(r.name) : undefined);
    return pid !== undefined ? `pid:${pid}` : `name:${r.name ?? '?'}`;
  };

  const threads = new Map<string, MessageThread & { nameAt: number }>();
  for (const r of raws) {
    const key = keyOf(r);
    const { kind, pid, taskId, name, ...message } = r;
    let t = threads.get(key);
    if (!t) {
      t = {
        key,
        party:
          name ??
          (pid !== undefined ? `pid ${pid}` : taskId !== undefined ? `agent ${taskId}` : 'unknown'),
        kind,
        messages: [],
        last: message,
        received: 0,
        sent: 0,
        nameAt: -1,
      };
      threads.set(key, t);
    }
    t.messages.push(message);
    if (message.direction === 'in') t.received++;
    else t.sent++;
    // The latest declared name labels the thread — a label, never an identity.
    // A received name is the party's own; a sent one is what this session
    // called it, and is used only until the party speaks for itself.
    const declared = message.direction === 'in' ? name : undefined;
    if (declared && message.at >= t.nameAt) {
      t.party = declared;
      t.nameAt = message.at;
    } else if (t.nameAt < 0 && name) t.party = name;
  }

  return [...threads.values()]
    .map(({ nameAt: _nameAt, ...t }) => {
      t.messages.sort((a, b) => a.at - b.at || a.turnN - b.turnN);
      t.last = t.messages[t.messages.length - 1];
      const withId = [...t.messages].reverse().find(m => m.msgId);
      return withId ? { ...t, msgId: withId.msgId } : t;
    })
    .sort((a, b) => b.last.at - a.last.at);
}
