import { useCallback, useState } from 'react';
import { claudeCodeVersion } from '../../../../package.json';
import { useDeleteRemoteHost, useRemoteHosts, useSaveRemoteHost } from '../../../hooks/useIPC';
import { useTheme } from '../../../hooks/useTheme';
import {
  remoteDirProblem,
  remoteHostProblem,
  type RemoteHost,
  type RemoteHostInput,
  type RemoteLaunchMode,
  type RemoteOs,
} from '../../../../electron/shared/remote-host';
import { TopBar } from '../shared/TopBar';
import { Lens } from '../overview/Lens';
import {
  STATUS_LABEL,
  TERMINAL_SURFACE,
  TerminalPane,
  type TerminalStatus,
} from '../terminal/TerminalPane';
import {
  remoteActionLabel,
  remoteExitNotice,
  type RemoteNotice,
  type RemoteNoticeAction,
} from './remote-exit';

/**
 * Claude Code on another machine, in the embedded terminal (#242).
 *
 * A list of saved ssh destinations and, once one is connected, the same
 * `TerminalPane` a local session uses, pointed at the host through the system
 * `ssh`. The session is the stock CLI running over there: its registry and its
 * transcript are on the host, so nothing on this machine — Lens, Mission
 * Control, the session lists — sees it, and the frame says so on screen rather
 * than leaving a remote session to pass for a local one.
 *
 * Deliberately separate from `TerminalMissionControl`: that view is built on the
 * local registry and the local transcript, and this layer is meant to be
 * removable when Claude Code ships its own way to attach to a session on another
 * machine (anthropics/claude-code#87190).
 */

interface RemoteSession {
  host: RemoteHost;
  dir: string;
  mode: RemoteLaunchMode;
  /** Bumped on every (re)connection: a new key is a new pane and a new ssh. */
  attempt: number;
}

const labelCls =
  'flex items-center font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--cl-ink-3)] mb-1.5';
const inputCls =
  'w-full rounded-none border border-[var(--cl-line)] bg-[var(--cl-paper)] px-3 py-2 text-[13px] text-[var(--cl-ink)] placeholder:text-[var(--cl-ink-4)] outline-none focus:border-[var(--cl-ink)] transition-colors';

// The folder last opened on a host is a per-viewer convenience: losing it costs
// a retype, so browser storage is enough and every access is guarded.
const lastDirKey = (id: string) => `cl-remote-dir:${id}`;
function readLastDir(id: string): string | null {
  try {
    return localStorage.getItem(lastDirKey(id));
  } catch {
    return null;
  }
}
function writeLastDir(id: string, dir: string): void {
  try {
    localStorage.setItem(lastDirKey(id), dir);
  } catch {
    // Storage unavailable — the form simply starts from the default next time.
  }
}

export function RemoteView({ onBack }: { onBack: () => void }) {
  const [session, setSession] = useState<RemoteSession | null>(null);
  const connect = useCallback((host: RemoteHost, dir: string) => {
    writeLastDir(host.id, dir);
    setSession({ host, dir, mode: 'claude', attempt: 0 });
  }, []);

  if (session) {
    return (
      <RemoteSessionView
        session={session}
        setSession={setSession}
        onLeave={() => setSession(null)}
      />
    );
  }
  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>
      <TopBar onBack={onBack} crumbs={[{ label: 'Global · Remote' }]} />
      <div className="flex-1 overflow-y-auto">
        <section className="cl-hero">
          <Lens />
          <div className="cl-eyebrow">
            <span className="pip" />
            <span>Remote · over ssh</span>
          </div>
          <h1 className="cl-h-name static">
            <span className="label-name">Remote</span>
            <span className="glyph">.</span>
          </h1>
          <p className="cl-dup-lede">
            Run Claude Code on another machine in the embedded terminal. ClaudeLens starts your
            system ssh, so ~/.ssh/config, keys, the agent and ProxyJump work as in any terminal, and
            it stores no password or key. The session runs on the host and its history stays there:
            Lens, Mission Control and the session lists on this machine do not show it. The host can
            run Linux, macOS or Windows.
          </p>
        </section>
        <HostsSection onConnect={connect} />
      </div>
    </div>
  );
}

function HostsSection({ onConnect }: { onConnect: (host: RemoteHost, dir: string) => void }) {
  const { data: hosts = [], isLoading, error } = useRemoteHosts();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<RemoteHost | 'new' | null>(null);
  const selected = hosts.find(h => h.id === selectedId) ?? hosts[0] ?? null;

  if (isLoading) {
    return (
      <section className="cl-section">
        <p style={{ color: 'var(--cl-ink-3)', fontSize: 13 }}>Loading…</p>
      </section>
    );
  }
  if (error) {
    return (
      <section className="cl-section">
        <div className="cl-empty">
          Could not read the saved hosts: {error instanceof Error ? error.message : String(error)}
        </div>
      </section>
    );
  }
  return (
    <section className="cl-section" style={{ maxWidth: 1120 }}>
      <div className="grid items-start gap-x-12 gap-y-8 md:grid-cols-[260px_minmax(0,1fr)]">
        <HostList
          hosts={hosts}
          selectedId={editing ? null : (selected?.id ?? null)}
          onSelect={id => {
            setEditing(null);
            setSelectedId(id);
          }}
          onAdd={() => setEditing('new')}
        />
        {editing || !selected ? (
          <HostForm
            key={editing === 'new' || !editing ? 'new' : editing.id}
            initial={editing && editing !== 'new' ? editing : null}
            onSaved={host => {
              setEditing(null);
              setSelectedId(host.id);
            }}
            onCancel={hosts.length > 0 ? () => setEditing(null) : undefined}
          />
        ) : (
          <ConnectPanel
            key={selected.id}
            host={selected}
            onConnect={onConnect}
            onEdit={() => setEditing(selected)}
          />
        )}
      </div>
    </section>
  );
}

function HostList({
  hosts,
  selectedId,
  onSelect,
  onAdd,
}: {
  hosts: RemoteHost[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div>
      <div className={labelCls}>Hosts</div>
      {hosts.length === 0 && <div className="cl-empty">No host saved yet.</div>}
      <ul role="list" aria-label="Remote hosts">
        {hosts.map(h => (
          <li key={h.id}>
            <button
              type="button"
              aria-current={h.id === selectedId ? 'true' : undefined}
              onClick={() => onSelect(h.id)}
              className="w-full text-left px-3 py-2 border-l-2 transition-colors"
              style={{
                borderColor: h.id === selectedId ? 'var(--cl-accent)' : 'transparent',
                background: h.id === selectedId ? 'var(--cl-paper-2)' : 'transparent',
              }}
            >
              <div style={{ fontSize: 13, color: 'var(--cl-ink)' }}>{h.name}</div>
              <div className="font-mono" style={{ fontSize: 11, color: 'var(--cl-ink-4)' }}>
                {h.target}
                {h.port ? `:${h.port}` : ''}
                {h.os === 'windows' ? ' · Windows' : ''}
              </div>
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="cl-btn cl-btn--quiet"
        style={{ marginTop: 12 }}
        onClick={onAdd}
      >
        + Add host
      </button>
    </div>
  );
}

function ConnectPanel({
  host,
  onConnect,
  onEdit,
}: {
  host: RemoteHost;
  onConnect: (host: RemoteHost, dir: string) => void;
  onEdit: () => void;
}) {
  const [dir, setDir] = useState(() => readLastDir(host.id) ?? host.defaultDir ?? '~');
  const problem = remoteDirProblem(dir.trim(), host.os);
  const del = useDeleteRemoteHost();
  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        if (!problem) onConnect(host, dir.trim());
      }}
    >
      <div className={labelCls}>Connect to</div>
      <div style={{ fontSize: 18, color: 'var(--cl-ink)' }}>{host.name}</div>
      <div
        className="font-mono"
        style={{ fontSize: 11, color: 'var(--cl-ink-4)', marginBottom: 20 }}
      >
        ssh {host.port ? `-p ${host.port} ` : ''}
        {host.target}
      </div>
      <label className={labelCls} htmlFor="remote-dir">
        Folder on the host
      </label>
      <input
        id="remote-dir"
        className={inputCls + (problem ? ' !border-[var(--cl-danger)]' : '')}
        value={dir}
        onChange={e => setDir(e.target.value)}
        placeholder={host.os === 'windows' ? '~\\projects\\acme' : '~/projects/acme'}
        spellCheck={false}
      />
      {problem && <p className="mt-1 font-mono text-[10px] text-[var(--cl-danger)]">{problem}</p>}
      <p className="mt-2" style={{ fontSize: 12, color: 'var(--cl-ink-3)' }}>
        Claude Code starts in this folder. On a host older than {claudeCodeVersion} it is not
        started, and ClaudeLens offers to update it.
      </p>
      <div className="flex gap-3" style={{ marginTop: 20 }}>
        <button className="cl-btn cl-btn--primary" type="submit" disabled={!!problem}>
          Connect
        </button>
        <button className="cl-btn cl-btn--quiet" type="button" onClick={onEdit}>
          Edit host
        </button>
        <button
          className="cl-btn cl-btn--quiet"
          type="button"
          disabled={del.isPending}
          onClick={() => del.mutate(host.id)}
        >
          Remove
        </button>
      </div>
      {del.error && (
        <p className="mt-2 font-mono text-[10px] text-[var(--cl-danger)]">
          {del.error instanceof Error ? del.error.message : String(del.error)}
        </p>
      )}
    </form>
  );
}

function HostForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial: RemoteHost | null;
  onSaved: (host: RemoteHost) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [target, setTarget] = useState(initial?.target ?? '');
  const [port, setPort] = useState(initial?.port ? String(initial.port) : '');
  const [defaultDir, setDefaultDir] = useState(initial?.defaultDir ?? '');
  const [os, setOs] = useState<RemoteOs>(initial?.os ?? 'posix');
  const save = useSaveRemoteHost();
  const input: RemoteHostInput = {
    ...(initial && { id: initial.id }),
    name,
    target,
    ...(port.trim() && { port: Number(port.trim()) }),
    os,
    defaultDir: defaultDir.trim(),
  };
  const problem = remoteHostProblem(input);
  const field = (
    label: string,
    id: string,
    value: string,
    set: (v: string) => void,
    ph: string
  ) => (
    <div>
      <label className={labelCls} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={inputCls}
        value={value}
        onChange={e => set(e.target.value)}
        placeholder={ph}
        spellCheck={false}
      />
    </div>
  );
  return (
    <form
      className="space-y-4"
      aria-label={initial ? `Edit ${initial.name}` : 'Add a host'}
      onSubmit={e => {
        e.preventDefault();
        if (!problem) save.mutate(input, { onSuccess: onSaved });
      }}
    >
      <div className={labelCls}>{initial ? 'Edit host' : 'Add a host'}</div>
      {field('Name', 'remote-name', name, setName, 'Build server')}
      {field('ssh destination', 'remote-target', target, setTarget, 'user@build.example.com')}
      {field('Port', 'remote-port', port, setPort, '22')}
      <OsPicker value={os} onChange={setOs} />
      {field(
        'Default folder',
        'remote-default-dir',
        defaultDir,
        setDefaultDir,
        os === 'windows' ? '~\\projects' : '~/projects'
      )}
      <p style={{ fontSize: 12, color: 'var(--cl-ink-3)' }}>
        The destination is what you would type after <code>ssh</code>: an alias from ~/.ssh/config,
        a host name or user@host. Authentication is left to ssh. A Windows host needs OpenSSH Server
        running; the check before Claude Code starts runs in the PowerShell Windows ships with.
      </p>
      {(problem || save.error) && (
        <p className="font-mono text-[10px] text-[var(--cl-danger)]">
          {problem ?? (save.error instanceof Error ? save.error.message : String(save.error))}
        </p>
      )}
      <div className="flex gap-3">
        <button
          className="cl-btn cl-btn--primary"
          type="submit"
          disabled={!!problem || save.isPending}
        >
          Save host
        </button>
        {onCancel && (
          <button className="cl-btn cl-btn--quiet" type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

// Which connect script the host gets. Chosen, not detected: detecting would
// cost a second login, and a password or 2FA user would be asked twice.
function OsPicker({ value, onChange }: { value: RemoteOs; onChange: (os: RemoteOs) => void }) {
  const options: Array<[RemoteOs, string]> = [
    ['posix', 'Linux / macOS'],
    ['windows', 'Windows'],
  ];
  return (
    <div>
      <div className={labelCls} id="remote-os-label">
        System
      </div>
      <div role="radiogroup" aria-labelledby="remote-os-label" className="flex gap-1.5">
        {options.map(([os, label]) => (
          <button
            key={os}
            type="button"
            role="radio"
            aria-checked={value === os}
            onClick={() => onChange(os)}
            className={`px-2.5 py-1 font-mono text-[11px] border transition-colors ${value === os ? 'bg-[var(--cl-ink)] text-[var(--cl-paper)] border-[var(--cl-ink)]' : 'bg-[var(--cl-paper)] text-[var(--cl-ink-2)] border-[var(--cl-line)] hover:border-[var(--cl-ink-4)]'}`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function RemoteSessionView({
  session,
  setSession,
  onLeave,
}: {
  session: RemoteSession;
  setSession: (s: RemoteSession) => void;
  onLeave: () => void;
}) {
  const { resolved } = useTheme();
  const [status, setStatus] = useState<TerminalStatus>('starting');
  const [exitCode, setExitCode] = useState<number | null>(null);
  const { host, dir, mode } = session;
  const relaunch = (next: RemoteLaunchMode) => {
    setExitCode(null);
    setSession({ ...session, mode: next, attempt: session.attempt + 1 });
  };
  const act = (action: RemoteNoticeAction) => {
    if (action === 'hosts') onLeave();
    else if (action === 'update') relaunch('update');
    else if (action === 'reconnect') relaunch('claude');
    else relaunch(mode);
  };
  const notice =
    exitCode === null
      ? null
      : remoteExitNotice(exitCode, {
          mode,
          hostName: host.name,
          target: host.target,
          os: host.os ?? 'posix',
          dir,
          minVersion: claudeCodeVersion,
        });
  const running = status === 'running';
  return (
    <div className="h-full flex flex-col" style={{ background: TERMINAL_SURFACE[resolved] }}>
      <TopBar
        onBack={onLeave}
        backLabel={running ? 'Disconnect' : 'Back'}
        crumbs={[
          { label: 'REMOTE' },
          { label: host.name, accent: true },
          { label: mode === 'update' ? 'claude update' : dir },
        ]}
        right={<RemoteStatus status={status} hostName={host.name} />}
      />
      <div className="flex-1 min-h-0 flex flex-col" style={{ padding: '4px 26px 22px', gap: 10 }}>
        <RemoteBanner host={host} />
        {notice && <RemoteNoticeBar notice={notice} hostName={host.name} onAction={act} />}
        <div className="flex-1 min-h-0">
          <TerminalPane
            key={session.attempt}
            cwd={dir}
            remote={{ hostId: host.id, mode, dir, minVersion: claudeCodeVersion }}
            onPid={noop}
            onStatus={setStatus}
            onExit={setExitCode}
            hideExitOverlay
          />
        </div>
      </div>
    </div>
  );
}

function noop() {}

function RemoteStatus({ status, hostName }: { status: TerminalStatus; hostName: string }) {
  const running = status === 'running';
  return (
    <span
      className="flex items-center font-mono uppercase"
      style={{ gap: 7, fontSize: 9.5, letterSpacing: '0.16em', color: 'var(--cl-ink-3)' }}
    >
      <span
        aria-hidden
        className={running ? 'cl-live-dot' : ''}
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: running ? 'var(--cl-ok)' : 'var(--cl-ink-4)',
        }}
      />
      {(running ? 'RUNNING' : STATUS_LABEL[status].toUpperCase()) + ` ON ${hostName.toUpperCase()}`}
    </span>
  );
}

// Always on screen while connected: a remote session must never read as a local one.
function RemoteBanner({ host }: { host: RemoteHost }) {
  return (
    <div
      role="note"
      className="flex items-baseline flex-wrap"
      style={{ gap: 10, fontSize: 12, color: 'var(--cl-ink-3)' }}
    >
      <span
        className="font-mono uppercase"
        style={{ fontSize: 9.5, letterSpacing: '0.16em', color: 'var(--cl-accent)' }}
      >
        Remote · {host.target}
      </span>
      <span>
        This session runs on {host.name}. Its history stays there, so Lens and Mission Control on
        this machine do not show it.
      </span>
    </div>
  );
}

function RemoteNoticeBar({
  notice,
  hostName,
  onAction,
}: {
  notice: RemoteNotice;
  hostName: string;
  onAction: (action: RemoteNoticeAction) => void;
}) {
  const edge =
    notice.tone === 'warn'
      ? 'var(--cl-warn)'
      : notice.tone === 'ok'
        ? 'var(--cl-ok)'
        : 'var(--cl-line)';
  return (
    <div
      role="status"
      className="flex items-center flex-wrap"
      style={{
        gap: 14,
        padding: '10px 14px',
        borderLeft: `2px solid ${edge}`,
        background: 'var(--cl-paper)',
      }}
    >
      <div style={{ flex: '1 1 320px' }}>
        <div style={{ fontSize: 13, color: 'var(--cl-ink)' }}>{notice.title}</div>
        <div style={{ fontSize: 12, color: 'var(--cl-ink-3)' }}>{notice.body}</div>
      </div>
      <div className="flex gap-2">
        {notice.actions.map((a, i) => (
          <button
            key={a}
            type="button"
            className={i === 0 ? 'cl-btn cl-btn--primary' : 'cl-btn cl-btn--quiet'}
            onClick={() => onAction(a)}
          >
            {remoteActionLabel(a, hostName)}
          </button>
        ))}
      </div>
    </div>
  );
}
