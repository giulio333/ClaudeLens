// One remote pane's reading of its session (#294): the watcher channel's
// lifetime, what it says, and the state Lens and Mission Control draw. The
// process it runs in is injected — a PTY in the app, so ssh has somewhere to
// ask for a password; a plain child in the suite — which keeps this testable
// without Electron and without a host.
//
// The channel is started by the launch marker, never before: a connection the
// version check refused never opens a second one, and by then the pane's ssh
// has logged in and its control socket exists for this one to ride.

import type { RemoteHost } from '../shared/remote-host';
import type { RemoteLensState } from '../shared/remote-session';
import type { RemoteLaunch } from './remote-ssh';
import { buildRemoteWatchCommand, buildWatchSshArgs } from './remote-watch';
import {
  buildRemoteSnapshot,
  createTranscriptBuffer,
  createWatchReader,
  lastWords,
  pendingPrompt,
  type WatchMessage,
} from './remote-transcript';

/** A running watcher channel. */
export interface LensProcess {
  write(data: string): void;
  kill(): void;
}

/** Starts `ssh` with these arguments and reports what it prints and how it ends. */
export type LensSpawner = (
  args: string[],
  handlers: { onData(data: string): void; onExit(code: number): void }
) => LensProcess;

export interface RemoteLensOptions {
  terminalId: string;
  host: Pick<RemoteHost, 'target' | 'port' | 'os'>;
  dir: string;
  /** The pane's control socket, or null when the channel logs in on its own. */
  controlPath: string | null;
  spawn: LensSpawner;
  onChange(state: RemoteLensState): void;
  /** Seconds between the host's polls — tests shorten it. */
  pollInterval?: number;
  /** How long the transcript may keep changing before it is parsed again. */
  parseDelayMs?: number;
  /** Silence after which the channel counts as dead (the host ticks every 5 polls). */
  stallMs?: number;
  /** How long a closed channel waits for the pane's own end before it is a failure. */
  exitGraceMs?: number;
}

// Reading the file again from zero after a lost frame is cheap once; a channel
// that keeps losing them is broken, and saying so beats looping.
const MAX_RESTARTS = 3;

export class RemoteLens {
  private readonly opts: RemoteLensOptions;
  private state: RemoteLensState;
  private launch: RemoteLaunch | null = null;
  private proc: LensProcess | null = null;
  private reader = createWatchReader();
  private buffer = createTranscriptBuffer();
  private parseTimer: ReturnType<typeof setTimeout> | null = null;
  private stallTimer: ReturnType<typeof setTimeout> | null = null;
  private exitTimer: ReturnType<typeof setTimeout> | null = null;
  private restarts = 0;
  private closed = false;

  constructor(opts: RemoteLensOptions) {
    this.opts = opts;
    this.state = {
      terminalId: opts.terminalId,
      phase: 'starting',
      channel: opts.controlPath ? 'shared' : 'separate',
      prompt: null,
      detail: null,
      cwd: null,
      sessionId: null,
      status: null,
      messages: [],
      summary: null,
      revision: 0,
    };
  }

  snapshot(): RemoteLensState {
    return this.state;
  }

  /** The connect script said Claude Code is starting: open the channel. */
  launched(launch: RemoteLaunch): void {
    if (this.launch || this.closed) return;
    this.launch = launch;
    // A connect script too old to name its process cannot be followed without
    // guessing which session is this one — and guessing is what the pid is for.
    if (launch.pid < 1) {
      this.fail('The host did not say which process is this session. Connect again.');
      return;
    }
    this.open();
  }

  /** Types an answer to what ssh asked on the channel. */
  answer(text: string): void {
    if (this.state.phase !== 'prompt' || !this.proc) return;
    this.proc.write(`${text}\r`);
    this.update({ phase: 'connecting', prompt: null });
  }

  /** Opens the channel again after it failed. */
  retry(): void {
    if (this.closed || !this.launch || this.state.phase !== 'failed') return;
    this.restarts = 0;
    this.open();
  }

  /** The pane's own connection ended, and with it the session — whatever the
   *  channel, which usually dies a moment earlier with it, said last. */
  terminalExited(): void {
    if (this.closed) return;
    this.update({ phase: 'ended', prompt: null, detail: null });
    this.dispose();
  }

  dispose(): void {
    this.closed = true;
    this.stopChannel();
    if (this.parseTimer) clearTimeout(this.parseTimer);
    this.parseTimer = null;
    if (this.exitTimer) clearTimeout(this.exitTimer);
    this.exitTimer = null;
  }

  private open(): void {
    this.stopChannel();
    if (this.exitTimer) clearTimeout(this.exitTimer);
    this.exitTimer = null;
    this.reader = createWatchReader();
    this.buffer.reset();
    this.update({ phase: 'connecting', prompt: null, detail: null });
    const launch = this.launch!;
    const command = buildRemoteWatchCommand(this.opts.host.os ?? 'posix', {
      pid: launch.pid,
      launchedAt: launch.at,
      dir: this.opts.dir,
      interval: this.opts.pollInterval,
    });
    const args = buildWatchSshArgs(this.opts.host, command, this.opts.controlPath);
    let proc: LensProcess | null = null;
    proc = this.opts.spawn(args, {
      onData: data => {
        if (this.proc === proc) this.onData(data);
      },
      onExit: code => {
        if (this.proc === proc) this.onExit(code);
      },
    });
    this.proc = proc;
  }

  private stopChannel(): void {
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.stallTimer = null;
    const proc = this.proc;
    this.proc = null;
    proc?.kill();
  }

  private onData(data: string): void {
    const messages = this.reader.feed(data);
    if (!this.reader.started()) {
      const prompt = pendingPrompt(this.reader.preamble());
      this.update(prompt ? { phase: 'prompt', prompt } : { phase: 'connecting', prompt: null });
      return;
    }
    this.armStall();
    for (const message of messages) {
      if (!this.proc) return;
      this.handle(message);
    }
  }

  private handle(message: WatchMessage): void {
    switch (message.kind) {
      case 'hello':
        if (this.state.phase === 'connecting' || this.state.phase === 'prompt') {
          this.update({ phase: 'searching', prompt: null });
        }
        return;
      case 'cwd':
        this.update({ cwd: message.cwd });
        return;
      case 'search':
        if (!this.state.sessionId) this.update({ phase: 'searching', detail: null });
        return;
      case 'ambiguous':
        this.update({ phase: 'ambiguous', detail: String(message.count) });
        return;
      case 'session':
        if (message.sessionId !== this.state.sessionId) {
          // `/clear` or `/resume`: a different transcript under the same process.
          this.buffer.reset();
          this.cancelParse();
          this.update({
            phase: 'waiting',
            detail: null,
            sessionId: message.sessionId,
            messages: [],
            summary: null,
          });
        }
        return;
      case 'status':
        if (message.status !== this.state.status) this.update({ status: message.status });
        return;
      case 'wait':
        if (this.buffer.received() === 0) this.update({ phase: 'waiting' });
        return;
      case 'reset':
        this.buffer.reset();
        this.scheduleParse();
        return;
      case 'data':
        this.onFrame(message.offset, message.bytes);
        return;
      case 'tick':
        return;
      case 'gone':
        this.update({ phase: 'ended' });
        this.stopChannel();
        return;
    }
  }

  private onFrame(offset: number, bytes: Buffer): void {
    if (!this.state.sessionId) return;
    if (this.buffer.append(offset, bytes) === 'gap') {
      if (++this.restarts > MAX_RESTARTS) {
        this.fail('The transcript arrived with pieces missing, more than once.');
      } else {
        this.open();
      }
      return;
    }
    if (this.state.phase !== 'live') this.update({ phase: 'live' });
    this.scheduleParse();
  }

  private onExit(code: number): void {
    this.proc = null;
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.stallTimer = null;
    if (this.closed || this.state.phase === 'ended') return;
    const said = lastWords(this.reader.preamble());
    const detail = !this.reader.started()
      ? (said ?? `ssh ended with code ${code} before the host answered.`)
      : `The connection that reads the session closed (code ${code}).`;
    // Closing the pane kills this channel a moment before the pane itself
    // reports its end; waiting that moment keeps an ended session from
    // flashing up as a failure first (measured on a real host: same tick).
    this.exitTimer = setTimeout(() => {
      this.exitTimer = null;
      if (!this.closed && this.state.phase !== 'ended') this.fail(detail);
    }, this.opts.exitGraceMs ?? 500);
  }

  private armStall(): void {
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.stallTimer = setTimeout(() => {
      this.stallTimer = null;
      this.stopChannel();
      this.fail('The host stopped answering.');
    }, this.opts.stallMs ?? 30_000);
  }

  private fail(detail: string): void {
    this.stopChannel();
    this.update({ phase: 'failed', prompt: null, detail });
  }

  private scheduleParse(): void {
    if (this.parseTimer) return;
    this.parseTimer = setTimeout(() => {
      this.parseTimer = null;
      this.parse();
    }, this.opts.parseDelayMs ?? 250);
  }

  private cancelParse(): void {
    if (this.parseTimer) clearTimeout(this.parseTimer);
    this.parseTimer = null;
  }

  private parse(): void {
    const sessionId = this.state.sessionId;
    if (!sessionId) return;
    const { messages, summary } = buildRemoteSnapshot(this.buffer.text(), sessionId);
    this.update({ messages, summary: this.buffer.lineCount() ? summary : null });
  }

  private update(patch: Partial<Omit<RemoteLensState, 'terminalId' | 'revision'>>): void {
    const next = { ...this.state, ...patch };
    const changed = (Object.keys(patch) as Array<keyof typeof patch>).some(
      key => next[key] !== this.state[key]
    );
    if (!changed) return;
    this.state = { ...next, revision: this.state.revision + 1 };
    this.opts.onChange(this.state);
  }
}
