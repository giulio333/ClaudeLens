import { useState, type ReactNode } from 'react';
import { TopBar } from '../shared/TopBar';
import {
  useEffectiveConfig,
  useTelemetryEnabled,
  useSetTelemetryEnabled,
  useNotifyPrefs,
  useSetNotifyPref,
  useUpdateCheck,
  useGlobalMcp,
  type EffectiveConfig,
  type McpServer,
  type UpdateInfo,
} from '../../../hooks/useIPC';
import { mcpStatusMeta } from '../mcp/McpServerCard';
import { useTheme, type ThemePreference } from '../../../hooks/useTheme';
import { fmtModel } from '../utils';
import { compareVersions } from '../../../../electron/shared/version-compare';
import { version as appVersion, claudeCodeVersion } from '../../../../package.json';

const PRIVACY_POLICY_URL = 'https://github.com/giulio333/ClaudeLens/blob/main/PRIVACY.md';

// ─── Settings page ────────────────────────────────────────────────────────────
// Reads the *effective* Claude Code configuration through the official Agent SDK
// (see electron/modules/config-reader.ts). Left rail of tabs; the right panel is
// an "instrument readout" of the resolved config — a precise datasheet, with
// dotted leaders from each setting to its value and a source stamp showing which
// settings file it came from. Read-only except Appearance + Privacy (ClaudeLens
// preferences). The tab content renderers are also reused by ProjectConfigView.

type TabId =
  'general' | 'permissions' | 'tools' | 'mcp' | 'extensions' | 'notifications' | 'privacy';

const TABS: { id: TabId; label: string; icon: ReactNode }[] = [
  { id: 'general', label: 'General', icon: <GearIcon /> },
  { id: 'permissions', label: 'Permissions', icon: <ShieldIcon /> },
  { id: 'tools', label: 'Tools', icon: <WrenchIcon /> },
  { id: 'mcp', label: 'MCP Servers', icon: <PlugIcon /> },
  { id: 'extensions', label: 'Extensions', icon: <BlocksIcon /> },
  { id: 'notifications', label: 'Notifications', icon: <BellIcon /> },
  { id: 'privacy', label: 'Privacy', icon: <LockIcon /> },
];

// Per-tab header copy, written from the user's side of the screen.
const SDK = 'Resolved via Agent SDK';
const PREF = 'ClaudeLens preference';
const TAB_META: Record<TabId, { eyebrow: string; title: string; caption: string; ro: boolean }> = {
  privacy: {
    eyebrow: PREF,
    title: 'Privacy',
    caption: 'Anonymous, opt-out usage analytics. Editable here.',
    ro: false,
  },
  notifications: {
    eyebrow: PREF,
    title: 'Notifications',
    caption: 'How ClaudeLens alerts you when a session needs you or fails. Editable here.',
    ro: false,
  },
  general: {
    eyebrow: 'App & runtime',
    title: 'General',
    caption:
      'Versions and updates, how ClaudeLens looks, and the configuration Claude Code resolves for this scope.',
    ro: true,
  },
  permissions: {
    eyebrow: SDK,
    title: 'Permissions',
    caption: 'Which tools Claude may run, must ask about, or can never touch.',
    ro: true,
  },
  tools: {
    eyebrow: SDK,
    title: 'Tools',
    caption: 'Every tool the model can call in this scope.',
    ro: true,
  },
  mcp: {
    eyebrow: 'Resolved via claude mcp list',
    title: 'MCP servers',
    caption: 'Model Context Protocol integrations and the health Claude Code reports for them.',
    ro: true,
  },
  extensions: {
    eyebrow: SDK,
    title: 'Extensions',
    caption: 'Skills, subagents, slash commands and plugins available to Claude.',
    ro: true,
  },
};

export function SettingsView({ onBack }: { onBack: () => void }) {
  const { data, isLoading, error, refetch, isFetching } = useEffectiveConfig();
  // The MCP panel reads its own source (see McpTab), so its count must too.
  const { data: mcp } = useGlobalMcp();
  const [tab, setTab] = useState<TabId>('general');
  const [q, setQ] = useState('');
  const meta = TAB_META[tab];
  const ql = q.trim().toLowerCase();

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--cl-paper)' }}>
      <TopBar
        onBack={onBack}
        backLabel="Close"
        crumbs={[{ label: 'Settings', accent: true }]}
        right={
          <button
            onClick={() => refetch()}
            title="Reload from the Agent SDK"
            className="font-mono uppercase rounded-md px-2.5 py-1 transition-colors hover:text-[var(--cl-accent)]"
            style={{
              fontSize: 11,
              letterSpacing: '0.16em',
              color: 'var(--cl-ink-3)',
              border: '1px solid var(--cl-line)',
            }}
          >
            {isFetching ? 'Loading…' : 'Reload'}
          </button>
        }
      />

      <div className="flex flex-1 min-h-0">
        {/* ─── Left rail ─── */}
        <aside
          className="shrink-0 flex flex-col gap-1 p-3 border-r overflow-y-auto"
          style={{ width: 232, borderColor: 'var(--cl-line)', background: 'var(--cl-paper-2)' }}
        >
          <div
            className="px-2 pt-1 pb-3"
            style={{ fontSize: 11, letterSpacing: '0.18em', color: 'var(--cl-ink-4)' }}
          >
            <span className="font-mono uppercase">Settings</span>
          </div>
          <SearchBox value={q} onChange={setQ} />
          <div className="h-2" />
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors"
              style={{
                background: tab === t.id ? 'var(--cl-accent-soft)' : 'transparent',
                color: tab === t.id ? 'var(--cl-accent-ink)' : 'var(--cl-ink-2)',
                fontWeight: tab === t.id ? 600 : 500,
                fontSize: 13.5,
              }}
            >
              <span style={{ opacity: tab === t.id ? 1 : 0.7, display: 'flex' }}>{t.icon}</span>
              {t.label}
            </button>
          ))}
          <div className="mt-auto px-2 pt-4" style={{ fontSize: 10.5, color: 'var(--cl-ink-4)' }}>
            {data?.cwd && (
              <>
                <div className="font-mono uppercase" style={{ letterSpacing: '0.14em' }}>
                  Scope
                </div>
                <div className="mt-1 break-all" style={{ color: 'var(--cl-ink-3)' }}>
                  {data.cwd}
                </div>
              </>
            )}
            <div
              className="mt-3 font-mono"
              style={{ letterSpacing: '0.1em', color: 'var(--cl-ink-3)' }}
            >
              ClaudeLens v{appVersion}
            </div>
          </div>
        </aside>

        {/* ─── Content panel ─── */}
        <main className="set-main">
          <div className="set-panel">
            <PanelHead meta={meta} count={countFor(tab, data, mcpServerCount(mcp))} />

            {tab === 'privacy' ? (
              <PrivacyTab />
            ) : tab === 'notifications' ? (
              <NotificationsTab />
            ) : tab === 'general' ? (
              /* General composes its own order and gating — see GeneralPanel:
                 part of it is ClaudeLens' own and must not wait on the SDK. */
              <GeneralPanel cfg={data ?? null} isLoading={isLoading} error={error} q={ql} />
            ) : (
              <>
                {/* MCP reads `claude mcp list`, not the SDK config — so it must
                    not wait on (or be hidden by) that slower, fallible read. */}
                {tab === 'mcp' && (
                  <>
                    <McpTab cwd={data?.cwd} q={ql} />
                    <ReadOnlyHint />
                  </>
                )}
                {tab === 'mcp' ? null : isLoading ? (
                  <p className="set-dim" style={{ marginTop: 32 }}>
                    Reading configuration via the Agent SDK…
                  </p>
                ) : error ? (
                  <p className="set-dim" style={{ marginTop: 32 }}>
                    Couldn’t read configuration: {(error as Error).message}
                  </p>
                ) : data ? (
                  <>
                    {tab === 'permissions' && <PermissionsTab cfg={data} q={ql} />}
                    {tab === 'tools' && <ToolsTab cfg={data} q={ql} />}
                    {tab === 'extensions' && <ExtensionsTab cfg={data} q={ql} />}
                    {meta.ro && <ReadOnlyHint />}
                  </>
                ) : null}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function mcpServerCount(
  mcp?: { cloudServers: McpServer[]; localServers: McpServer[] } | null
): number | undefined {
  return mcp ? mcp.cloudServers.length + mcp.localServers.length : undefined;
}

function countFor(tab: TabId, cfg?: EffectiveConfig | null, mcpCount?: number): string | undefined {
  if (tab === 'mcp') return mcpCount === undefined ? undefined : `${mcpCount} servers`;
  const init = cfg?.init;
  if (!init) return undefined;
  switch (tab) {
    case 'tools':
      return `${init.tools.length} tools`;
    case 'extensions':
      return `${init.skills.length + init.agents.length + init.slashCommands.length} items`;
    default:
      return undefined;
  }
}

function PanelHead({
  meta,
  count,
}: {
  meta: { eyebrow: string; title: string; caption: string; ro: boolean };
  count?: string;
}) {
  return (
    <header className="set-head">
      <div className="set-head-top">
        <span className="set-eyebrow">
          <span className="pip" />
          {meta.eyebrow}
        </span>
        {count && <span className="set-head-count">{count}</span>}
      </div>
      <h1 className="set-title">{meta.title}</h1>
      <p className="set-caption">{meta.caption}</p>
    </header>
  );
}

// ─── General panel ────────────────────────────────────────────────────────────
// The one tab that mixes ClaudeLens' own preferences with the resolved Claude
// Code config, so it composes its own order instead of the shared gate: the
// status tape answers "is my setup ok?" before any reading, then Updates (which
// version is this, which one shipped, and the button to re-ask) and Appearance
// — both ClaudeLens' own, both shown immediately — and finally the read-only
// datasheet, which waits on the SDK read and is closed by the read-only hint.
// With Updates sitting right under the tape, the app version and its update
// state are ONE tape cell, not two: the block 16px below already spells out
// installed vs latest and carries the action, so a second cell restating it was
// the same sentence three times in one screenful.

function GeneralPanel({
  cfg,
  isLoading,
  error,
  q,
}: {
  cfg: EffectiveConfig | null;
  isLoading: boolean;
  error: unknown;
  q: string;
}) {
  return (
    <>
      <StatusTape cfg={cfg} />
      <UpdatesBlock />
      <AppearanceTab />
      {isLoading ? (
        <p className="set-dim" style={{ marginTop: 32 }}>
          Reading configuration via the Agent SDK…
        </p>
      ) : error ? (
        <p className="set-dim" style={{ marginTop: 32 }}>
          Couldn’t read configuration: {(error as Error).message}
        </p>
      ) : cfg ? (
        <>
          <GeneralTab cfg={cfg} q={q} />
          <ReadOnlyHint />
        </>
      ) : null}
    </>
  );
}

// Shown as the tooltip of any cell the SDK handshake couldn't fill.
const NO_INIT = 'Runtime info unavailable';

/**
 * Four cells: what Claude Code runs here (model, CLI version + whether it
 * satisfies this build, how permissive the session starts) and which ClaudeLens
 * this is (version + whether a newer one shipped). Tones are the existing state
 * tokens — sage for fine, warn for a CLI behind the requirement or a permission
 * mode that waives the prompts, accent for "an update is there to install" (an
 * action, not a fault).
 */
function StatusTape({ cfg }: { cfg: EffectiveConfig | null }) {
  const { data: update, isFetching, error } = useUpdateCheck();
  const init = cfg?.init;
  const cli = init ? cliStatus(init.claudeCodeVersion) : null;
  const app = updateStatus(update ?? null, isFetching, !!error);
  return (
    <section className="set-tape">
      <TapeCell
        label="Model"
        value={init ? fmtModel(init.model) : '—'}
        title={init?.model ?? NO_INIT}
      />
      <TapeCell
        label="Claude Code"
        value={init?.claudeCodeVersion ?? '—'}
        qualifier={cli?.qualifier}
        dot={cli?.dot}
        title={cli?.title ?? NO_INIT}
      />
      <TapeCell
        label="Permission mode"
        value={init?.permissionMode ?? '—'}
        {...(init ? permissionStatus(init.permissionMode) : { title: NO_INIT })}
      />
      <TapeCell
        label="ClaudeLens"
        value={`v${appVersion}`}
        qualifier={app.qualifier}
        dot={app.dot}
        title={app.title}
      />
    </section>
  );
}

function TapeCell({
  label,
  value,
  qualifier,
  dot,
  title,
}: {
  label: string;
  value: string;
  qualifier?: string;
  dot?: string;
  title?: string;
}) {
  return (
    <div className="cell">
      <div className="l">{label}</div>
      {/* `title` only when it says more than the cell already shows — a tooltip
          that repeats the visible text is noise on every hover. */}
      <div className="v" title={title}>
        {dot && <span className="d" style={{ background: dot }} />}
        <span className="t">{value}</span>
        {qualifier && <span className="q">{qualifier}</span>}
      </div>
    </div>
  );
}

type CellTone = { qualifier?: string; dot?: string; title?: string };

/** Installed Claude Code against the version this ClaudeLens build expects. */
function cliStatus(installed: string): CellTone {
  if (compareVersions(installed, claudeCodeVersion) < 0)
    return {
      qualifier: `needs ${claudeCodeVersion}`,
      dot: 'var(--cl-warn)',
      title: `Installed ${installed} is older than the ${claudeCodeVersion} this ClaudeLens expects`,
    };
  return {
    dot: 'var(--cl-ok)',
    title: `Meets the ${claudeCodeVersion} this ClaudeLens expects`,
  };
}

// Modes that waive tool prompts. Deliberately not "anything but default":
// `plan` is *more* restrictive than default, so flagging it would read as a
// warning about the safest mode there is.
const LOOSE_MODES = new Set(['bypassPermissions', 'acceptEdits']);

/** The permission mode the session starts in, after the CLI trust filter. */
function permissionStatus(mode: string): CellTone {
  if (LOOSE_MODES.has(mode))
    return {
      dot: 'var(--cl-warn)',
      title: `Tools run with fewer prompts in ${mode} — effective at startup, after the CLI trust filter`,
    };
  return { title: 'Effective at startup, after the CLI trust filter' };
}

/** The running app's own release state — qualifies the ClaudeLens version cell. */
function updateStatus(update: UpdateInfo | null, isFetching: boolean, failed: boolean): CellTone {
  if (isFetching) return { qualifier: 'checking…' };
  if (failed || !update)
    return { qualifier: 'update unknown', title: 'Couldn’t reach the GitHub releases API' };
  if (update.updateAvailable)
    return {
      qualifier: `v${update.latestVersion} available`,
      dot: 'var(--cl-accent)',
      title: `A newer release (v${update.latestVersion}) is published on GitHub`,
    };
  return { qualifier: 'up to date', dot: 'var(--cl-ok)' };
}

// ─── Tab content renderers ────────────────────────────────────────────────────
// `heading` makes a renderer print its own domain label — used by
// ProjectConfigView, which stacks them all without a per-tab PanelHead.

export function GeneralTab({
  cfg,
  heading,
}: {
  cfg: EffectiveConfig;
  q: string;
  heading?: boolean;
}) {
  const s = cfg.effective;
  const init = cfg.init;
  return (
    <>
      {cfg.initError && (
        <div className="set-banner" style={{ marginTop: 24 }}>
          Runtime (init) info unavailable: {cfg.initError}
        </div>
      )}
      {heading && <DomainLabel>General</DomainLabel>}
      <Block label="Runtime" grid>
        <Row k="Model" hint="Resolved model id for this scope">
          {init ? <Val>{init.model}</Val> : <Dim />}
        </Row>
        <Row k="Permission mode" hint="Effective at startup, after the trust filter">
          {init ? <Pill>{init.permissionMode}</Pill> : <Dim />}
        </Row>
        <Row k="Output style">{init ? <Val>{init.outputStyle || 'default'}</Val> : <Dim />}</Row>
        <Row k="API key source">{init ? <Val>{init.apiKeySource}</Val> : <Dim />}</Row>
        {/* One version row instead of installed + required side by side: the
            requirement only matters as a verdict on what's installed, and two
            bare numbers left the reader to compare them. */}
        <Row k="Claude Code" hint={`This ClaudeLens expects ${claudeCodeVersion} or newer`}>
          {init ? (
            <>
              <Val>{init.claudeCodeVersion}</Val>
              {compareVersions(init.claudeCodeVersion, claudeCodeVersion) < 0 && (
                <span className="set-chip warn">outdated</span>
              )}
            </>
          ) : (
            <Dim />
          )}
        </Row>
        <Row k="Working directory" stack full>
          {init ? <Val sm>{init.cwd}</Val> : <Dim />}
        </Row>
      </Block>

      <Block label="Claude Code preferences" grid>
        {/* "CLI theme", not "Theme": this is the terminal's own theme from the
            settings cascade, and the Appearance block above — ClaudeLens' theme
            — was reading as the same setting under the same name. */}
        <Row
          k="CLI theme"
          hint="Claude Code’s terminal theme, not the app’s"
          src={prov(cfg, 'theme')}
        >
          {val(s.theme) ?? <Dim>system default</Dim>}
        </Row>
        <Row
          k="Configured model"
          hint="What settings ask for — Runtime shows what resolved"
          src={prov(cfg, 'model')}
        >
          {val(s.model) ?? <Dim>default</Dim>}
        </Row>
        <Row k="Language" src={prov(cfg, 'language')}>
          {val(s.language) ?? <Dim>default</Dim>}
        </Row>
        <Row k="Effort level" src={prov(cfg, 'effortLevel')}>
          {val(s.effortLevel) ?? <Dim>default</Dim>}
        </Row>
        <Row k="Transcript retention" src={prov(cfg, 'cleanupPeriodDays')}>
          {s.cleanupPeriodDays != null ? (
            <Val>{String(s.cleanupPeriodDays)} days</Val>
          ) : (
            <Dim>30 days (default)</Dim>
          )}
        </Row>
      </Block>
    </>
  );
}

export function PermissionsTab({
  cfg,
  q,
  heading,
}: {
  cfg: EffectiveConfig;
  q: string;
  heading?: boolean;
}) {
  const p = (cfg.effective.permissions as Record<string, unknown>) ?? {};
  return (
    <>
      {heading && <DomainLabel>Permissions</DomainLabel>}
      <Block label="Mode" grid>
        <Row k="Default mode" src={prov(cfg, 'permissions')}>
          <Pill>{String(p.defaultMode ?? 'default')}</Pill>
        </Row>
        {cfg.init && (
          <Row k="Effective at startup" hint="After the CLI trust filter">
            <Pill>{cfg.init.permissionMode}</Pill>
          </Row>
        )}
      </Block>
      <Block label="Rules">
        <RuleRow label="Allow" items={filterList(p.allow as string[], q)} tone="ok" />
        <RuleRow label="Ask" items={filterList(p.ask as string[], q)} tone="warn" />
        <RuleRow label="Deny" items={filterList(p.deny as string[], q)} tone="danger" />
        <RuleRow
          label="Additional directories"
          items={filterList(p.additionalDirectories as string[], q)}
        />
      </Block>
    </>
  );
}

export function ToolsTab({
  cfg,
  q,
  heading,
}: {
  cfg: EffectiveConfig;
  q: string;
  heading?: boolean;
}) {
  const all = cfg.init?.tools ?? [];
  const tools = all.filter(t => !q || t.toLowerCase().includes(q));
  if (!cfg.init) return <RuntimeUnavailable label={heading ? 'Tools' : undefined} />;
  return (
    <Block
      label={heading ? 'Tools' : undefined}
      bare={!heading}
      count={heading ? all.length : undefined}
    >
      {tools.length === 0 ? <p className="set-dim">No tools match.</p> : <InvList items={tools} />}
    </Block>
  );
}

export function McpTab({ cwd, q, heading }: { cwd?: string; q: string; heading?: boolean }) {
  // Deliberately NOT cfg.init.mcpServers: the SDK handshake is scoped to the
  // queried directory, and this panel is resolved against the home dir — which
  // Claude Code treats as untrusted, so it loads no MCP server there and the
  // list came back empty. mcp:getGlobal reads `claude mcp list` instead (same
  // source as /mcp) and is directory-independent. See modules/mcp-reader.ts.
  const { data: mcp, isLoading } = useGlobalMcp();
  const match = (s: McpServer) => !q || s.name.toLowerCase().includes(q);
  const listed = [...(mcp?.cloudServers ?? []), ...(mcp?.localServers ?? [])].filter(match);
  const unlisted = (mcp?.unlistedServers ?? []).filter(match);
  const probeError = mcp?.probe?.error ?? null;

  // In the project-scoped variant, `cwd` is the project: flag the connectors
  // that project has turned off rather than implying they are off everywhere.
  const offHere = (s: McpServer) => !!cwd && s.live && s.disabledProjectPaths.includes(cwd);

  if (isLoading)
    return (
      <p className="set-dim">
        Reading MCP servers via <code>claude mcp list</code>…
      </p>
    );
  return (
    <>
      <Block label={heading ? 'MCP servers' : undefined} bare={!heading}>
        {probeError && <p className="set-dim">Live status unavailable: {probeError}</p>}
        {listed.length === 0 ? (
          <p className="set-dim">
            {q ? 'No servers match.' : 'No MCP servers are currently listed.'}
          </p>
        ) : (
          <div>
            {listed.map(s => (
              <div key={s.name} className="set-line">
                <span className="set-val">{s.name}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {offHere(s) && <SourceBadge source="off in this scope" />}
                  <StatusDot
                    status={mcpStatusMeta(s.status).label}
                    color={mcpStatusMeta(s.status).color}
                  />
                </span>
              </div>
            ))}
          </div>
        )}
      </Block>

      {unlisted.length > 0 && (
        <Block label="Not listed" count={unlisted.length}>
          <p className="set-dim" style={{ marginBottom: 10 }}>
            Recorded in <code>~/.claude.json</code> but absent from the last{' '}
            <code>claude mcp list</code>. Claude Code never removes a connector from that file when
            you disconnect it, so these are leftovers <code>/mcp</code> will not show.
          </p>
          <div>
            {unlisted.map(s => (
              <div key={s.name} className="set-line" style={{ opacity: 0.65 }}>
                <span className="set-val">{s.name}</span>
                <StatusDot
                  status={mcpStatusMeta(s.status).label}
                  color={mcpStatusMeta(s.status).color}
                />
              </div>
            ))}
          </div>
        </Block>
      )}
    </>
  );
}

export function ExtensionsTab({
  cfg,
  q,
  heading,
}: {
  cfg: EffectiveConfig;
  q: string;
  heading?: boolean;
}) {
  const init = cfg.init;
  const filt = (arr: string[] = []) => arr.filter(x => !q || x.toLowerCase().includes(q));
  return (
    <>
      {heading && <DomainLabel>Extensions</DomainLabel>}
      <Block label="Skills" count={init?.skills.length}>
        <InvList items={filt(init?.skills)} empty={!init} />
      </Block>
      <Block label="Subagents" count={init?.agents.length}>
        <InvList items={filt(init?.agents)} empty={!init} />
      </Block>
      <Block label="Slash commands" count={init?.slashCommands.length}>
        <InvList items={filt(init?.slashCommands)} empty={!init} />
      </Block>
      <Block label="Plugins" count={init?.plugins.length}>
        {!init ? (
          <p className="set-dim">Runtime info unavailable.</p>
        ) : (init.plugins?.length ?? 0) === 0 ? (
          <p className="set-dim">None.</p>
        ) : (
          <div>
            {init.plugins
              .filter(p => !q || p.name.toLowerCase().includes(q))
              .map(p => (
                <div key={p.name} className="set-line">
                  <span className="set-val">{p.name}</span>
                  <span
                    className="set-val sm"
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {p.path}
                  </span>
                </div>
              ))}
          </div>
        )}
      </Block>
    </>
  );
}

// ─── Appearance (editable, ClaudeLens-own preference) ─────────────────────────

const THEME_OPTIONS: { id: ThemePreference; label: string; icon: ReactNode; hint: string }[] = [
  { id: 'light', label: 'Light', icon: <SunIcon />, hint: 'Always light' },
  { id: 'dark', label: 'Dark', icon: <MoonIcon />, hint: 'Always dark' },
  { id: 'system', label: 'System', icon: <DisplayIcon />, hint: 'Follow the OS' },
];

export function AppearanceTab() {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <Block label="Appearance" hint="Applies to ClaudeLens only." editable>
      <div className="set-seg">
        {THEME_OPTIONS.map(opt => (
          <button
            key={opt.id}
            type="button"
            className={preference === opt.id ? 'on' : ''}
            onClick={() => setPreference(opt.id)}
          >
            {opt.icon}
            {opt.label}
          </button>
        ))}
      </div>
      {preference === 'system' && (
        <p style={{ fontSize: 12, color: 'var(--cl-ink-4)', marginTop: 10 }}>
          Following your system: <strong style={{ color: 'var(--cl-ink-3)' }}>{resolved}</strong>.
        </p>
      )}
    </Block>
  );
}

// ─── Updates (GitHub releases check) ──────────────────────────────────────────
// No auto-install — ClaudeLens ships unsigned, so updates are a manual download
// from the GitHub release page. The check runs once at launch (useUpdateCheck);
// "Check now" re-asks the API. On macOS the freshly installed app carries the
// quarantine flag, so the one-off clearing command from the README is offered
// here with a copy button.

const QUARANTINE_CMD = 'xattr -d com.apple.quarantine /Applications/ClaudeLens.app';
const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

function UpdatesBlock() {
  const { data: update, error, isFetching, refetch } = useUpdateCheck();
  const [copied, setCopied] = useState(false);

  const copyCmd = () => {
    navigator.clipboard
      .writeText(QUARANTINE_CMD)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => {});
  };

  return (
    <Block label="Updates">
      <div className="set-rows">
        <Row k="Installed">
          <Val>v{appVersion}</Val>
        </Row>
        <Row k="Latest release" hint="Checked against GitHub releases at launch">
          {isFetching ? (
            <Dim>checking…</Dim>
          ) : error ? (
            <Dim>couldn’t reach GitHub</Dim>
          ) : update ? (
            <>
              <Val>v{update.latestVersion}</Val>
              <Pill>{update.updateAvailable ? 'update available' : 'up to date'}</Pill>
            </>
          ) : (
            <Dim />
          )}
        </Row>
        {update?.updateAvailable && (
          <Row k="Download" hint="Opens the GitHub release page in your browser">
            <a
              href={update.releaseUrl}
              target="_blank"
              rel="noreferrer"
              className="set-val"
              style={{ color: 'var(--cl-accent)' }}
            >
              {update.releaseName ?? `ClaudeLens ${update.latestVersion}`} →
            </a>
          </Row>
        )}
      </div>

      <button
        onClick={() => refetch()}
        disabled={isFetching}
        className="font-mono uppercase rounded-md px-2.5 py-1 transition-colors hover:text-[var(--cl-accent)]"
        style={{
          fontSize: 11,
          letterSpacing: '0.16em',
          color: 'var(--cl-ink-3)',
          border: '1px solid var(--cl-line)',
          marginTop: 16,
          opacity: isFetching ? 0.6 : 1,
        }}
      >
        {isFetching ? 'Checking…' : 'Check now'}
      </button>

      {/* Collapsed: it's a once-per-install command, and left open it was the
          longest thing on the tab — now that Updates sits at the top, that
          weight would push the rest of General below the fold. */}
      {IS_MAC && (
        <details className="set-disc">
          <summary>macOS: app can’t be opened after updating</summary>
          <p className="set-block-hint" style={{ marginTop: 12 }}>
            ClaudeLens isn’t code-signed, so after installing an update macOS quarantines the new
            app (“can’t be opened”). Clear it once from Terminal:
          </p>
          <div
            className="flex items-center gap-2 rounded-lg px-3 py-2"
            style={{ background: 'var(--cl-paper)', border: '1px solid var(--cl-line)' }}
          >
            <code
              className="font-mono flex-1 min-w-0"
              style={{
                fontSize: 12,
                color: 'var(--cl-ink-2)',
                overflowX: 'auto',
                whiteSpace: 'nowrap',
              }}
            >
              {QUARANTINE_CMD}
            </code>
            <button
              onClick={copyCmd}
              className="font-mono uppercase rounded-md px-2 py-0.5 shrink-0 transition-colors hover:text-[var(--cl-accent)]"
              style={{
                fontSize: 10.5,
                letterSpacing: '0.14em',
                color: copied ? 'var(--cl-ok)' : 'var(--cl-ink-3)',
                border: '1px solid var(--cl-line)',
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </details>
      )}
    </Block>
  );
}

// ─── Privacy (editable, ClaudeLens-own preference) ────────────────────────────

const COLLECTED = [
  'App launch and exit, including how long the app was open',
  'Which sections you open, and a few feature actions (new chat, export, terminal, delete)',
  'App version, operating system, and language',
  'A rotating session id (not tied to your identity)',
  'When the app breaks: the error type, message and stack trace — with every path, username and project name stripped out',
];
const NOT_COLLECTED = [
  'Your Claude Code sessions, prompts, or responses',
  'Any file from ~/.claude (transcripts, memory, plans)',
  'File paths, usernames, project names, or API keys',
];

function PrivacyTab() {
  const { data: enabled, isLoading } = useTelemetryEnabled();
  const setEnabled = useSetTelemetryEnabled();
  const on = enabled ?? true;
  return (
    <>
      <Block label="Usage analytics">
        <p className="set-block-hint">
          Helps us understand how many people use ClaudeLens and on which platforms, and catch the
          crashes nobody reports. Data is anonymous, aggregate, and never identifies you.
        </p>
        <div className="set-card">
          <div className="min-w-0">
            <div style={{ fontSize: 13.5, color: 'var(--cl-ink)', fontWeight: 600 }}>
              Share anonymous usage data
            </div>
            <div style={{ fontSize: 12, color: 'var(--cl-ink-4)', marginTop: 3 }}>
              {on
                ? 'On — anonymous usage events and error reports are sent via Aptabase (EU).'
                : 'Off — nothing is sent.'}
            </div>
          </div>
          <ToggleSwitch
            checked={on}
            disabled={isLoading || setEnabled.isPending}
            onChange={v => setEnabled.mutate(v)}
          />
        </div>
      </Block>

      <Block label="Collected">
        <ul className="set-ledger">
          {COLLECTED.map((x, i) => (
            <LedgerItem key={i} tone="neutral">
              {x}
            </LedgerItem>
          ))}
        </ul>
      </Block>
      <Block label="Never collected">
        <ul className="set-ledger">
          {NOT_COLLECTED.map((x, i) => (
            <LedgerItem key={i} tone="block">
              {x}
            </LedgerItem>
          ))}
        </ul>
      </Block>

      <Block label="Details" grid>
        <Row k="Processor" hint="Privacy-first analytics for desktop apps">
          <a
            href="https://aptabase.com"
            target="_blank"
            rel="noreferrer"
            className="set-val"
            style={{ color: 'var(--cl-accent)' }}
          >
            Aptabase (EU)
          </a>
        </Row>
        <Row k="Legal basis" hint="GDPR Art. 6(1)(f) — lawful because the data is anonymous">
          <Val>Legitimate interest</Val>
        </Row>
        <Row k="Privacy policy">
          <a
            href={PRIVACY_POLICY_URL}
            target="_blank"
            rel="noreferrer"
            className="set-val"
            style={{ color: 'var(--cl-accent)' }}
          >
            Read PRIVACY.md →
          </a>
        </Row>
      </Block>
    </>
  );
}

function NotificationsTab() {
  const { data, isLoading } = useNotifyPrefs();
  const setPref = useSetNotifyPref();
  const enabled = data?.enabled ?? true;
  const os = data?.os ?? true;
  return (
    <>
      <Block label="Alerts">
        <p className="set-block-hint">
          A transient toast appears when a session is waiting for you (e.g. a permission prompt) or
          a chat turn fails. When the app is in the background these can also raise a native OS
          notification and a dock badge.
        </p>
        <div className="set-card">
          <div className="min-w-0">
            <div style={{ fontSize: 13.5, color: 'var(--cl-ink)', fontWeight: 600 }}>
              Show notifications
            </div>
            <div style={{ fontSize: 12, color: 'var(--cl-ink-4)', marginTop: 3 }}>
              {enabled
                ? 'On — you’ll be alerted when a session needs attention.'
                : 'Off — nothing is surfaced.'}
            </div>
          </div>
          <ToggleSwitch
            checked={enabled}
            disabled={isLoading || setPref.isPending}
            onChange={v => setPref.mutate({ key: 'enabled', value: v })}
          />
        </div>
        <div className="set-card">
          <div className="min-w-0">
            <div
              style={{
                fontSize: 13.5,
                color: enabled ? 'var(--cl-ink)' : 'var(--cl-ink-4)',
                fontWeight: 600,
              }}
            >
              Native OS notifications
            </div>
            <div style={{ fontSize: 12, color: 'var(--cl-ink-4)', marginTop: 3 }}>
              {os
                ? 'On — sent only while ClaudeLens is in the background.'
                : 'Off — in-app toasts only.'}
            </div>
          </div>
          <ToggleSwitch
            checked={os}
            disabled={isLoading || setPref.isPending || !enabled}
            onChange={v => setPref.mutate({ key: 'os', value: v })}
          />
        </div>
      </Block>
    </>
  );
}

function BellIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

function LedgerItem({ tone, children }: { tone: 'neutral' | 'block'; children: ReactNode }) {
  const color = tone === 'block' ? 'var(--cl-danger)' : 'var(--cl-ok)';
  return (
    <li>
      <span style={{ color, marginTop: 1, flexShrink: 0, display: 'flex' }}>
        {tone === 'block' ? (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        ) : (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
      </span>
      <span>{children}</span>
    </li>
  );
}

function ToggleSwitch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative shrink-0 rounded-full transition-colors"
      style={{
        width: 44,
        height: 26,
        background: checked ? 'var(--cl-accent)' : 'var(--cl-ink-4)',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      <span
        className="absolute rounded-full transition-all"
        style={{
          top: 3,
          left: checked ? 21 : 3,
          width: 20,
          height: 20,
          background: 'var(--cl-paper)',
          boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
        }}
      />
    </button>
  );
}

// ─── Building blocks ────────────────────────────────────────────────────────

function DomainLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="set-title" style={{ fontSize: 21, marginTop: 30 }}>
      {children}
    </h2>
  );
}

function Block({
  label,
  hint,
  bare,
  grid,
  count,
  editable,
  children,
}: {
  label?: string;
  hint?: string;
  bare?: boolean;
  grid?: boolean;
  count?: number;
  /** Marks a writable block inside an otherwise read-only datasheet. */
  editable?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="set-block">
      {label && !bare && (
        <div className="set-block-head">
          <span className="lbl">{label}</span>
          {count != null && <span className="ct">{count}</span>}
          {editable && <span className="ed">editable</span>}
        </div>
      )}
      {hint && <p className="set-block-hint">{hint}</p>}
      <div className={grid ? 'set-rows' : undefined}>{children}</div>
    </section>
  );
}

function Row({
  k,
  hint,
  src,
  stack,
  full,
  children,
}: {
  k: string;
  hint?: string;
  src?: SrcInfo;
  stack?: boolean;
  full?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`set-row${stack ? ' stack' : ''}${full ? ' full' : ''}`}>
      <div className="set-row-line">
        <span className="k">{k}</span>
        <span className="leader" />
        <span className="v">
          {children}
          {src && <SourceBadge source={src.source} />}
        </span>
      </div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

function RuleRow({
  label,
  items,
  tone,
}: {
  label: string;
  items?: string[];
  tone?: 'ok' | 'warn' | 'danger';
}) {
  const list = items ?? [];
  return (
    <div className="set-row">
      <div className="set-row-line" style={{ alignItems: 'baseline' }}>
        <span className="k">{label}</span>
        <span className="leader" />
        <span className="v">
          <span className="set-val sm">{list.length || 'none'}</span>
        </span>
      </div>
      {list.length > 0 && (
        <div className="set-cloud" style={{ marginTop: 10 }}>
          {list.map((x, i) => (
            <span key={i} className={`set-chip${tone ? ` ${tone}` : ''}`}>
              {x}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function InvList({ items, empty }: { items: string[]; empty?: boolean }) {
  if (empty) return <p className="set-dim">Runtime info unavailable.</p>;
  if (items.length === 0) return <p className="set-dim">None.</p>;
  return (
    <div className="set-inv">
      {items.map((x, i) => (
        <span key={i} className="set-inv-item" title={x}>
          {x}
        </span>
      ))}
    </div>
  );
}

function RuntimeUnavailable({ label }: { label?: string }) {
  return (
    <Block label={label} bare={!label}>
      <p className="set-dim">Runtime info unavailable.</p>
    </Block>
  );
}

function Val({ children, sm }: { children: ReactNode; sm?: boolean }) {
  return <span className={`set-val${sm ? ' sm' : ''}`}>{children}</span>;
}

function Pill({ children }: { children: ReactNode }) {
  return <span className="set-pill">{children}</span>;
}

function Dim({ children }: { children?: ReactNode }) {
  return <span className="set-dim">{children ?? '—'}</span>;
}

function StatusDot({ status, color: given }: { status: string; color?: string }) {
  // `color` wins when the caller already knows the semantics (MCP statuses come
  // with their own tone); the regex stays for free-form SDK status strings.
  const ok = /connect|ready|running|ok/i.test(status);
  const failed = /fail|error|disconnect/i.test(status);
  const color = given ?? (ok ? 'var(--cl-ok)' : failed ? 'var(--cl-danger)' : 'var(--cl-warn)');
  return (
    <span className="set-status">
      <span className="dot" style={{ background: color }} />
      {status}
    </span>
  );
}

function SourceBadge({ source }: { source: string }) {
  return <span className="set-src">{source}</span>;
}

export function ReadOnlyHint() {
  return (
    <div className="set-foot">
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0, marginTop: 1 }}
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4M12 8h.01" />
      </svg>
      <span>
        Read-only. To change these, run{' '}
        <code className="font-mono" style={{ color: 'var(--cl-ink-3)' }}>
          /config
        </code>{' '}
        in Claude Code or edit your{' '}
        <code className="font-mono" style={{ color: 'var(--cl-ink-3)' }}>
          settings.json
        </code>{' '}
        files. The source stamp on each value shows which file it came from.
      </span>
    </div>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div
      className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
      style={{ background: 'var(--cl-paper)', border: '1px solid var(--cl-line)' }}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--cl-ink-4)"
        strokeWidth="2"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Filter"
        className="bg-transparent outline-none w-full"
        style={{ fontSize: 13, color: 'var(--cl-ink)' }}
      />
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function filterList(items: string[] | undefined, q: string): string[] {
  const list = items ?? [];
  return q ? list.filter(x => x.toLowerCase().includes(q)) : list;
}

type SrcInfo = { source: string; path?: string };

function prov(cfg: EffectiveConfig, key: string): SrcInfo | undefined {
  return cfg.provenance[key];
}

function val(v: unknown): ReactNode | null {
  if (v == null) return null;
  if (typeof v === 'object') return <Val sm>{JSON.stringify(v)}</Val>;
  return <Val>{String(v)}</Val>;
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function GearIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
function WrenchIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.1 2.1-2.4-2.4z" />
    </svg>
  );
}
function PlugIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22v-5M9 8V2M15 8V2M5 8h14v3a7 7 0 0 1-14 0z" />
    </svg>
  );
}
function BlocksIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="8" height="8" rx="1" />
      <rect x="13" y="13" width="8" height="8" rx="1" />
      <path d="M13 7h8M17 3v8M3 17h8M7 13v8" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4.5" y="11" width="15" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      <circle cx="12" cy="16" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}
function SunIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
    </svg>
  );
}
function DisplayIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2.5" y="3.5" width="19" height="13" rx="1.6" />
      <path d="M8 21h8M12 16.5V21" />
    </svg>
  );
}

/** Gear glyph for the top-bar trigger (exported for ProjectOverview). */
export function SettingsGearIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
