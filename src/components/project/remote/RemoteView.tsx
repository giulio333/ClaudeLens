import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { claudeCodeVersion } from '../../../../package.json';
import {
  useDeleteRemoteHost,
  useRemoteHosts,
  useRemoteLens,
  useSaveRemoteHost,
} from '../../../hooks/useIPC';
import { useTheme } from '../../../hooks/useTheme';
import {
  remoteDirProblem,
  remoteHostProblem,
  type RemoteHost,
  type RemoteHostInput,
  type RemoteLaunchMode,
  type RemoteOs,
} from '../../../../electron/shared/remote-host';
import type { RemoteLensChannel } from '../../../../electron/shared/remote-session';
import { RemoteOriginContext } from '../../remote-origin';
import { TopBar } from '../shared/TopBar';
import { CloseOverlayButton } from '../shared/CloseOverlayButton';
import { BetaTag } from '../shared/BetaTag';
import { ToolDetailPanel } from '../chat/ToolDetailPanel';
import { FileChangePage } from '../chat/FileChangesStrip';
import type { ToolGroup } from '../chat/utils';
import { MissionRail } from '../terminal/MissionRail';
import type { FileChange } from '../terminal/mission-feed';
import { RailToggle, ViewTabs, type View } from '../terminal/TerminalMissionControl';
import { Lens } from '../overview/Lens';
import { TERMINAL_SURFACE, TerminalPane, type TerminalStatus } from '../terminal/TerminalPane';
import {
  remoteActionLabel,
  remoteExitNotice,
  type RemoteNotice,
  type RemoteNoticeAction,
} from './remote-exit';
import { RemoteBanner, RemoteStatus } from './RemoteChrome';
import { RemoteLensPane } from './RemoteLensPane';
import { remoteProjectHash, remoteSessionSummary, remoteTranscript } from './remote-lens';

/**
 * Claude Code on another machine, in the embedded terminal (#242).
 *
 * A list of saved ssh destinations and, once one is connected, the same
 * `TerminalPane` a local session uses, pointed at the host through the system
 * `ssh`. The session is the stock CLI running over there, so its registry and
 * its transcript are on the host: a second channel reads them (#294) and the
 * Lens tab and the Mission Control rail draw the session from memory — nothing
 * of it is written on this machine, and the session lists here still do not
 * see it. The frame says all of this on screen rather than leaving a remote
 * session to pass for a local one.
 *
 * Deliberately separate from `TerminalMissionControl`: that view is built on the
 * local registry and the local transcript, and this layer is meant to be
 * removable when Claude Code ships its own way to attach to a session on another
 * machine (anthropics/claude-code#87190). It borrows that view's tab row and
 * rail toggle, and hands `ChatView` and `MissionRail` their `remote` prop.
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
            <BetaTag />
          </div>
          <h1 className="cl-h-name static">
            <span className="label-name">Remote</span>
            <span className="glyph">.</span>
          </h1>
          <p className="cl-dup-lede">
            Run Claude Code on another machine in the embedded terminal. ClaudeLens starts your
            system ssh, so ~/.ssh/config, keys, the agent and ProxyJump work as in any terminal, and
            it stores no password or key. The session runs on the host and its history stays there:
            while you are connected, Lens and Mission Control read it from the host and keep it in
            memory only, and the session lists on this machine do not show it. The host can run
            Linux, macOS or Windows. Remote is in beta: expect rough edges.
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
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [view, setViewRaw] = useState<View>('terminal');
  const [railCollapsed, setRailCollapsed] = useState(() => readPref(RAIL_COLLAPSED_KEY) === '1');
  const [railWidth, setRailWidth] = useState(() => {
    const saved = Number(readPref(RAIL_WIDTH_KEY));
    return Number.isFinite(saved) && saved >= RAIL_MIN && saved <= RAIL_MAX ? saved : RAIL_DEFAULT;
  });
  const [overlay, setOverlay] = useState<Overlay>(null);
  const jumpToTurnRef = useRef<((n: number) => void) | null>(null);
  const { host, dir, mode } = session;
  // Only a session has something to read: `claude update` is the terminal alone.
  const withLens = mode === 'claude';
  const lens = useRemoteLens(withLens ? terminalId : null);

  const setView = useCallback((next: View) => setViewRaw(next), []);
  const closeOverlay = useCallback(() => setOverlay(null), []);
  useEffect(() => {
    if (!overlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeOverlay();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlay, closeOverlay]);

  const relaunch = (next: RemoteLaunchMode) => {
    setExitCode(null);
    setTerminalId(null);
    setOverlay(null);
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

  const project = useMemo(
    () => ({ hash: remoteProjectHash(host.id), realPath: lens?.cwd ?? dir }),
    [host.id, lens?.cwd, dir]
  );
  const transcript = useMemo(() => remoteTranscript(lens, host.name), [lens, host.name]);
  const chatSession = useMemo(() => remoteSessionSummary(lens), [lens]);
  const jumpToTurn = useCallback(
    (turnN: number) => {
      setView('lens');
      requestAnimationFrame(() => jumpToTurnRef.current?.(turnN));
    },
    [setView]
  );
  const onWidthChange = useCallback((w: number) => {
    setRailWidth(w);
    writePref(RAIL_WIDTH_KEY, String(w));
  }, []);
  const toggleRail = useCallback(() => {
    setRailCollapsed(c => {
      writePref(RAIL_COLLAPSED_KEY, c ? '0' : '1');
      return !c;
    });
  }, []);

  return (
    // Every path a remote transcript names is on the host: the leaves that
    // would open one here read this and do not.
    <RemoteOriginContext.Provider value={host.name}>
      <div
        className="h-full flex flex-col cl-chat"
        style={{
          background:
            view === 'terminal' || !withLens ? TERMINAL_SURFACE[resolved] : 'var(--cl-paper)',
        }}
      >
        <TopBar
          onBack={overlay ? closeOverlay : onLeave}
          backLabel={overlay ? 'Back to session' : running ? 'Disconnect' : 'Back'}
          crumbs={[
            { label: 'REMOTE' },
            { label: host.name, accent: !overlay },
            { label: mode === 'update' ? 'claude update' : (lens?.cwd ?? dir) },
            ...(overlay ? [{ label: overlayLabel(overlay), accent: true }] : []),
          ]}
          right={<RemoteStatus status={status} hostName={host.name} />}
        />
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            {withLens && (
              <ViewTabs
                view={view}
                setView={setView}
                right={
                  <>
                    <RailToggle collapsed={railCollapsed} onToggle={toggleRail} />
                    {overlay && (
                      <CloseOverlayButton label="Back to session" onClose={closeOverlay} />
                    )}
                  </>
                }
              />
            )}
            <div
              className="flex-1 min-h-0 flex flex-col"
              style={{ padding: '10px 26px 22px', gap: 10, position: 'relative' }}
            >
              <RemoteBanner
                host={host}
                channel={withLens ? (lens?.channel ?? expectedChannel()) : null}
              />
              {notice && <RemoteNoticeBar notice={notice} hostName={host.name} onAction={act} />}
              <div
                className="flex-1 min-h-0"
                style={{ display: view === 'terminal' || !withLens ? 'block' : 'none' }}
              >
                <TerminalPane
                  key={session.attempt}
                  cwd={dir}
                  remote={{ hostId: host.id, mode, dir, minVersion: claudeCodeVersion }}
                  onPid={noop}
                  onStatus={setStatus}
                  onExit={setExitCode}
                  onTerminalId={setTerminalId}
                  hideExitOverlay
                />
              </div>
              {withLens && (
                <div
                  className="flex-1 min-h-0"
                  style={{ display: view === 'lens' ? 'block' : 'none' }}
                >
                  <RemoteLensPane
                    lens={lens}
                    host={host}
                    project={project}
                    transcript={transcript}
                    session={chatSession}
                    onOpenTool={group => setOverlay({ kind: 'tool', group })}
                    jumpToTurnRef={jumpToTurnRef}
                    onBack={onLeave}
                  />
                </div>
              )}
              {overlay && (
                <div
                  className="absolute z-20 flex flex-col overflow-hidden"
                  style={{
                    top: 10,
                    right: 26,
                    bottom: 22,
                    left: 26,
                    background: 'var(--cl-paper)',
                  }}
                >
                  {overlay.kind === 'tool' ? (
                    <ToolDetailPanel group={overlay.group} onBack={closeOverlay} chromeless />
                  ) : (
                    <div className="cl-file-change-scroll">
                      <FileChangePage file={overlay.change.file} />
                    </div>
                  )}
                </div>
              )}
            </div>
          </main>
          {withLens && !railCollapsed && (
            <MissionRail
              hash={project.hash}
              sessionId={lens?.sessionId ?? null}
              realPath={project.realPath}
              width={railWidth}
              onWidthChange={onWidthChange}
              onOpenTool={group => setOverlay({ kind: 'tool', group })}
              onOpenChange={change => setOverlay({ kind: 'change', change })}
              // A sub-agent's transcript, a definition and a team live on the
              // host and are not read from here; the rows stay where they are.
              onOpenAgent={noop}
              onOpenSkillDef={noop}
              onOpenAgentDef={noop}
              onOpenTeam={noop}
              onLocateTurn={jumpToTurn}
              onUsePrompt={noPrompt}
              showVitals={view === 'terminal'}
              remote={
                transcript ?? { hostName: host.name, messages: [], status: null, summary: null }
              }
            />
          )}
        </div>
      </div>
    </RemoteOriginContext.Provider>
  );
}

type Overlay = { kind: 'tool'; group: ToolGroup } | { kind: 'change'; change: FileChange } | null;

function overlayLabel(overlay: NonNullable<Overlay>): string {
  return overlay.kind === 'tool' ? overlay.group.use.name.toUpperCase() : overlay.change.name;
}

const RAIL_DEFAULT = 432;
const RAIL_MIN = 380;
const RAIL_MAX = 560;
const RAIL_WIDTH_KEY = 'cl-remote-rail-width';
const RAIL_COLLAPSED_KEY = 'cl-remote-rail-collapsed';

// Per-viewer conveniences, like the last folder: guarded, and lost at no cost.
function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable — the default comes back next time.
  }
}

// What the main process will choose before it has said so: OpenSSH's control
// socket everywhere but on a Windows client.
function expectedChannel(): RemoteLensChannel {
  return typeof navigator !== 'undefined' && /win/i.test(navigator.platform)
    ? 'separate'
    : 'shared';
}

function noPrompt(): Promise<void> {
  return Promise.resolve();
}

function noop() {}

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
