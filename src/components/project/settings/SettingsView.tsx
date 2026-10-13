import { Fragment, useState, type ReactNode } from 'react';
import { TopBar } from '../shared/TopBar';
import {
  useEffectiveConfig,
  useTelemetryEnabled,
  useSetTelemetryEnabled,
  useNotifyPrefs,
  useSetNotifyPref,
  useUpdateCheck,
  useClaudeCodeVersion,
  useGlobalMcp,
  type EffectiveConfig,
  type InitInfo,
  type McpServer,
  type UpdateInfo,
} from '../../../hooks/useIPC';
import { mcpStatusMeta } from '../mcp/McpServerCard';
import { SlashCommandList } from './SlashCommandList';
import { isProjectTier, sourceLabel } from './config-scope';
import { useTheme, type ThemePreference } from '../../../hooks/useTheme';
import { fmtModel } from '../utils';
import { compareVersions } from '../../../../electron/shared/version-compare';
import { latestWhatsNew, openWhatsNew } from '../../../data/whats-new';
import { version as appVersion, claudeCodeVersion } from '../../../../package.json';
import { Block, OnOff, PrefRow } from './SettingsKit';
import { AiSettingsTab } from './AiSettingsTab';

const PRIVACY_POLICY_URL = 'https://github.com/giulio333/ClaudeLens/blob/main/PRIVACY.md';

// ─── Settings page ────────────────────────────────────────────────────────────
// Two ledgers on one rail. "ClaudeLens" holds the app's own preferences, which
// are edited here. "Claude Code" is the *effective* configuration read through
// the official Agent SDK (see electron/modules/config-reader.ts), which is not:
// a precise datasheet, with dotted leaders from each setting to its value and a
// source stamp naming the settings file it came from. Where a tab sits on the
// rail says whether it can be changed, so no block has to say it again. The
// read-only renderers are reused by ProjectConfigView.

type TabId =
  'general' | 'privacy' | 'ai' | 'runtime' | 'permissions' | 'tools' | 'mcp' | 'extensions';

// The rail is the project rail's (`cl-rail`): a mono tile, a label, a count.
const TAB_GROUPS: {
  label: string;
  note?: string;
  tabs: { id: TabId; label: string; mono: string }[];
}[] = [
  {
    label: 'ClaudeLens',
    tabs: [
      { id: 'general', label: 'General', mono: 'G' },
      { id: 'privacy', label: 'Privacy', mono: 'P' },
      { id: 'ai', label: 'AI', mono: 'AI' },
    ],
  },
  {
    label: 'Claude Code',
    note: 'read-only',
    tabs: [
      { id: 'runtime', label: 'Runtime', mono: 'R' },
      { id: 'permissions', label: 'Permissions', mono: 'Pm' },
      { id: 'tools', label: 'Tools', mono: 'T' },
      { id: 'mcp', label: 'MCP servers', mono: 'N' },
      { id: 'extensions', label: 'Extensions', mono: 'E' },
    ],
  },
];

// Per-tab header copy, written from the user's side of the screen.
const OWN = 'ClaudeLens · editable here';
const SDK = 'Claude Code · resolved via Agent SDK';
const TAB_META: Record<TabId, { eyebrow: string; title: string; caption: string }> = {
  general: {
    eyebrow: OWN,
    title: 'General',
    caption: 'How ClaudeLens looks, how it alerts you, and which version you are running.',
  },
  privacy: {
    eyebrow: OWN,
    title: 'Privacy',
    caption: 'Anonymous, opt-out usage analytics.',
  },
  ai: {
    eyebrow: OWN,
    title: 'AI',
    caption: 'Summaries and to-dos written from a session, in its notes, when you ask for them.',
  },
  runtime: {
    eyebrow: SDK,
    title: 'Runtime',
    caption:
      'What Claude Code resolves for this scope: the model, the two CLIs, and the preferences your settings files ask for.',
  },
  permissions: {
    eyebrow: SDK,
    title: 'Permissions',
    caption: 'Which tools Claude may run, must ask about, or can never touch.',
  },
  tools: {
    eyebrow: SDK,
    title: 'Tools',
    caption: 'Every tool the model can call in this scope.',
  },
  mcp: {
    eyebrow: 'Claude Code · resolved via claude mcp list',
    title: 'MCP servers',
    caption: 'Model Context Protocol integrations and the health Claude Code reports for them.',
  },
  extensions: {
    eyebrow: SDK,
    title: 'Extensions',
    caption: 'Skills, subagents, slash commands and plugins available to Claude.',
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
            type="button"
            className="cl-btn-ghost"
            title="Reload from the Agent SDK"
            onClick={() => refetch()}
          >
            {isFetching ? 'Loading…' : 'Reload'}
          </button>
        }
      />

      <div className="flex flex-1 min-h-0">
        {/* ─── Left rail ─── */}
        <aside className="cl-rail set-rail" aria-label="Settings sections">
          <div className="set-rail-search">
            <SearchBox value={q} onChange={setQ} />
          </div>
          <nav className="cl-rail-nav">
            {TAB_GROUPS.map(g => (
              <Fragment key={g.label}>
                <div className="cl-rail-group set-rail-group">
                  <span>{g.label}</span>
                  {g.note && <span className="note">{g.note}</span>}
                </div>
                {g.tabs.map(t => {
                  // The count lives here and only here: the panel head used to
                  // repeat it one glance to the right.
                  const count = countFor(t.id, data, mcpServerCount(mcp));
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className={`cl-rail-item${tab === t.id ? ' on' : ''}`}
                      aria-current={tab === t.id ? 'page' : undefined}
                      onClick={() => setTab(t.id)}
                    >
                      <span className="mono" aria-hidden="true">
                        {t.mono}
                      </span>
                      <span className="lbl">{t.label}</span>
                      {count !== undefined && <span className="ct">{count}</span>}
                    </button>
                  );
                })}
              </Fragment>
            ))}
          </nav>
          <div className="set-rail-foot">
            {data?.cwd && (
              <>
                <span className="k">Scope</span>
                <span className="path">{data.cwd}</span>
              </>
            )}
            <span className="ver">ClaudeLens v{appVersion}</span>
          </div>
        </aside>

        {/* ─── Content panel ─── */}
        <main className="set-main">
          <div className="set-panel">
            <PanelHead meta={meta} />

            {tab === 'general' ? (
              /* All of it is ClaudeLens' own, so none of it waits on the SDK:
                 only the status tape reads the config, and it draws a dash
                 until that arrives. */
              <GeneralPanel cfg={data ?? null} />
            ) : tab === 'privacy' ? (
              <PrivacyTab />
            ) : tab === 'ai' ? (
              <AiSettingsTab />
            ) : tab === 'mcp' ? (
              /* MCP reads `claude mcp list`, not the SDK config — so it must
                 not wait on (or be hidden by) that slower, fallible read. */
              <>
                <McpTab cwd={data?.cwd} q={ql} />
                <ReadOnlyHint />
              </>
            ) : isLoading ? (
              <p className="set-dim" style={{ marginTop: 32 }}>
                Reading configuration via the Agent SDK…
              </p>
            ) : error ? (
              <p className="set-dim" style={{ marginTop: 32 }}>
                Couldn’t read configuration: {(error as Error).message}
              </p>
            ) : data ? (
              <>
                {tab === 'runtime' && <RuntimeTab cfg={data} />}
                {tab === 'permissions' && <PermissionsTab cfg={data} q={ql} />}
                {tab === 'tools' && <ToolsTab cfg={data} q={ql} />}
                {tab === 'extensions' && <ExtensionsTab cfg={data} q={ql} />}
                <ReadOnlyHint />
              </>
            ) : null}
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

/** The figure a rail item carries. `undefined` is "not known yet", never zero. */
function countFor(tab: TabId, cfg?: EffectiveConfig | null, mcpCount?: number): number | undefined {
  if (tab === 'mcp') return mcpCount;
  const init = cfg?.init;
  if (!init) return undefined;
  switch (tab) {
    case 'tools':
      return init.tools.length;
    case 'extensions':
      return init.skills.length + init.agents.length + init.slashCommands.length;
    default:
      return undefined;
  }
}

function PanelHead({ meta }: { meta: { eyebrow: string; title: string; caption: string } }) {
  return (
    <header className="set-head">
      <span className="set-eyebrow">
        <span className="pip" />
        {meta.eyebrow}
      </span>
      <h1 className="set-title">{meta.title}</h1>
      <p className="set-caption">{meta.caption}</p>
    </header>
  );
}

// ─── General panel ────────────────────────────────────────────────────────────
// ClaudeLens' own page. The status tape answers "is my setup ok?" before any
// reading, then the three things that can be changed here: how the app looks,
// how it alerts you, and which release it is. The resolved Claude Code
// configuration used to trail under them; it is the Runtime tab now, so this
// page no longer mixes what you can edit with what you can only read.
//
// The app version and its update state are ONE tape cell, not two: the Updates
// block below already spells out installed vs latest and carries the action.

function GeneralPanel({ cfg }: { cfg: EffectiveConfig | null }) {
  return (
    <>
      <StatusTape cfg={cfg} />
      <AppearanceBlock />
      <NotificationsBlock />
      <UpdatesBlock />
    </>
  );
}

// Shown as the tooltip of any cell the SDK handshake couldn't fill.
const NO_INIT = 'Runtime info unavailable';

// Shown when `claude --version` couldn't be read (not in PATH, timeout) or ran
// but said nothing recognizable.
const CLI_UNREADABLE = 'Couldn’t run `claude --version` — is the CLI in your PATH?';
const CLI_UNKNOWN = '`claude --version` didn’t report a version';

// The three answers the installed-CLI read can give. Kept apart because only
// one of them is a fact about the user's install: 'pending' is us, not them.
type CliReadState = 'pending' | 'failed' | 'read';

function cliReadState(isPending: boolean, failed: boolean): CliReadState {
  return failed ? 'failed' : isPending ? 'pending' : 'read';
}

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
  const { data: installedCli, error: cliError, isPending } = useClaudeCodeVersion();
  const cli = cliStatus(installedCli?.version ?? null, cliReadState(isPending, !!cliError));
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
        value={installedCli?.version ?? '—'}
        qualifier={cli.qualifier}
        dot={cli.dot}
        title={cli.title}
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

/**
 * Installed Claude Code against the version this ClaudeLens build expects.
 *
 * `installed` is what `claude --version` answered — NOT the SDK handshake's
 * `claude_code_version`, which reports the CLI bundled inside the
 * `@anthropic-ai/claude-agent-sdk` this app ships with. Those two diverge as
 * soon as the user updates their own CLI, and reading the handshake had the
 * page printing the shipped version as if it were the installed one.
 */
function cliStatus(installed: string | null, state: CliReadState): CellTone {
  // An unreadable version is stated as unknown, never filled in from the SDK:
  // a wrong number here reads as a verdict on the user's install.
  if (state === 'failed') return { qualifier: 'not found', title: CLI_UNREADABLE };
  if (state === 'pending') return { qualifier: 'reading…' };
  if (!installed) return { qualifier: 'unknown', title: CLI_UNKNOWN };
  if (compareVersions(installed, claudeCodeVersion) < 0)
    return {
      qualifier: `needs ${claudeCodeVersion}`,
      dot: 'var(--cl-warn)',
      title: `Installed ${installed} is older than the ${claudeCodeVersion} this ClaudeLens expects`,
    };
  return {
    dot: 'var(--cl-ok)',
    title: `Installed ${installed} meets the ${claudeCodeVersion} this ClaudeLens expects`,
  };
}

/**
 * The "Claude Code" row of the Runtime datasheet — installed version + verdict.
 *
 * "Installed" means the CLI on the user's PATH, the one their terminal runs and
 * the only one the update prompt is ever about. The CLI ClaudeLens carries for
 * its own chat is a different fact, printed one row below.
 */
function InstalledCliRow() {
  const { data, error } = useClaudeCodeVersion();
  return (
    <Row
      k="Claude Code"
      hint={`On your PATH — this ClaudeLens expects ${claudeCodeVersion} or newer`}
    >
      {error ? (
        <Dim title={CLI_UNREADABLE}>not found in PATH</Dim>
      ) : data?.version ? (
        <>
          <Val>{data.version}</Val>
          {compareVersions(data.version, claudeCodeVersion) < 0 && (
            <span className="set-chip warn">outdated</span>
          )}
        </>
      ) : (
        <Dim />
      )}
    </Row>
  );
}

/**
 * The Claude Code the Agent SDK inside ClaudeLens runs — `claude_code_version`
 * from the `system/init` handshake, i.e. the CLI binary vendored in the
 * `@anthropic-ai/claude-agent-sdk` this build ships.
 *
 * Stated as its own row because it is a real, separate fact: the in-app chat and
 * the config reads run on THIS version, while the user's terminal runs the one
 * above. Printing it as "installed" is what made Settings lie (2.1.220 to a user
 * on 2.1.232), and hiding it left the app unable to say which Claude Code its
 * own chat was speaking to. Divergence is normal, so there is no verdict here —
 * no chip, no dot: updating your CLI cannot move this number, only a new
 * ClaudeLens can.
 */
function BundledCliRow({
  version,
  source,
}: {
  version: string | undefined;
  source: InitInfo['cliSource'] | undefined;
}) {
  // The handshake names whichever CLI answered it: when the bundled one is
  // missing that is the user's own, and calling it "bundled" would put one
  // install's number in the other's row (#289).
  if (source === 'path')
    return (
      <Row
        k="Chat CLI"
        hint="The CLI bundled with ClaudeLens is missing, so the in-app chat runs the claude on your PATH"
      >
        {version ? <Val>{version}</Val> : <Dim />}
      </Row>
    );
  return (
    <Row
      k="Bundled CLI"
      hint="Ships inside ClaudeLens and runs the in-app chat — your terminal doesn’t use it"
    >
      {version ? <Val>{version}</Val> : <Dim />}
    </Row>
  );
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
// Shared with ProjectConfigView, which stacks them down one page: each renders
// its blocks and nothing above them — the title is the caller's (a panel head
// here, a ledger domain there).

export function RuntimeTab({ cfg }: { cfg: EffectiveConfig }) {
  const s = cfg.effective;
  const init = cfg.init;
  return (
    <>
      {cfg.initError && (
        <div className="set-banner" style={{ marginTop: 24 }}>
          Runtime (init) info unavailable: {cfg.initError}
        </div>
      )}
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
            bare numbers left the reader to compare them. Asked to the CLI
            itself, not to the handshake above — see cliStatus.

            The bundled row below is the handshake number, and the two rows are
            adjacent on purpose: they are the same question asked of two
            different installs ("what do you run in your terminal" vs "what does
            ClaudeLens run for you"), and the whole bug was the app answering
            one with the other. Only the first carries the verdict. */}
        <InstalledCliRow />
        <BundledCliRow version={init?.claudeCodeVersion || undefined} source={init?.cliSource} />
        <Row k="Working directory" stack full>
          {init ? <Val sm>{init.cwd}</Val> : <Dim />}
        </Row>
      </Block>

      <Block label="Claude Code preferences" grid>
        {/* "CLI theme", not "Theme": this is the terminal's own theme from the
            settings cascade, and the Appearance block in General — ClaudeLens' theme
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

export function PermissionsTab({ cfg, q }: { cfg: EffectiveConfig; q: string }) {
  const p = (cfg.effective.permissions as Record<string, unknown>) ?? {};
  return (
    <>
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

export function ToolsTab({ cfg, q }: { cfg: EffectiveConfig; q: string }) {
  const all = cfg.init?.tools ?? [];
  const tools = all.filter(t => !q || t.toLowerCase().includes(q));
  if (!cfg.init) return <RuntimeUnavailable />;
  return (
    <Block>
      {tools.length === 0 ? <p className="set-dim">No tools match.</p> : <InvList items={tools} />}
    </Block>
  );
}

export function McpTab({ cwd, q }: { cwd?: string; q: string }) {
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
      <Block>
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
                  {offHere(s) && <Stamp>off in this scope</Stamp>}
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

export function ExtensionsTab({ cfg, q }: { cfg: EffectiveConfig; q: string }) {
  const init = cfg.init;
  const filt = (arr: string[] = []) => arr.filter(x => !q || x.toLowerCase().includes(q));
  return (
    <>
      <Block label="Skills" count={init?.skills.length}>
        <InvList items={filt(init?.skills)} empty={!init} />
      </Block>
      <Block label="Subagents" count={init?.agents.length}>
        <InvList items={filt(init?.agents)} empty={!init} />
      </Block>
      <Block
        wide
        label="Slash commands"
        count={init ? init.commands?.length || init.slashCommands.length : undefined}
      >
        <SlashCommandList init={init} q={q} />
      </Block>
      <Block wide label="Plugins" count={init?.plugins.length}>
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

// ─── Appearance (ClaudeLens-own preference) ───────────────────────────────────

const THEME_OPTIONS: { id: ThemePreference; label: string; hint: string }[] = [
  { id: 'light', label: 'Light', hint: 'Always light.' },
  { id: 'dark', label: 'Dark', hint: 'Always dark.' },
  { id: 'system', label: 'System', hint: 'Follows your system.' },
];

function AppearanceBlock() {
  const { preference, resolved, setPreference } = useTheme();
  const chosen = THEME_OPTIONS.find(o => o.id === preference);
  return (
    <Block label="Appearance" note="ClaudeLens only">
      <PrefRow
        label="Theme"
        hint={
          preference === 'system'
            ? `Following your system, which is ${resolved} right now.`
            : chosen?.hint
        }
      >
        <div className="cl-seg cl-seg--paper" role="group" aria-label="Theme">
          {THEME_OPTIONS.map(opt => (
            <button
              key={opt.id}
              type="button"
              className={preference === opt.id ? 'on' : undefined}
              aria-pressed={preference === opt.id}
              onClick={() => setPreference(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </PrefRow>
    </Block>
  );
}

// ─── Notifications (ClaudeLens-own preference) ────────────────────────────────
// Two switches, so they sit in General rather than behind a tab of their own.

function NotificationsBlock() {
  const { data, isLoading } = useNotifyPrefs();
  const setPref = useSetNotifyPref();
  const enabled = data?.enabled ?? true;
  const os = data?.os ?? true;
  return (
    <Block label="Notifications">
      <PrefRow
        label="Show notifications"
        hint="A toast when a session is waiting for you, such as a permission prompt, or when a chat turn fails."
      >
        <OnOff
          label="Show notifications"
          checked={enabled}
          disabled={isLoading || setPref.isPending}
          onChange={v => setPref.mutate({ key: 'enabled', value: v })}
        />
      </PrefRow>
      <PrefRow
        label="Native OS notifications"
        hint="Also a system notification and a dock badge, sent only while ClaudeLens is in the background."
        off={!enabled}
      >
        <OnOff
          label="Native OS notifications"
          checked={os}
          disabled={isLoading || setPref.isPending || !enabled}
          onChange={v => setPref.mutate({ key: 'os', value: v })}
        />
      </PrefRow>
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
/** The newest release notes this build has — the installed version's, or the
 *  last release before it that had something to show. */
const LATEST_NOTES = latestWhatsNew(appVersion);

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
        {LATEST_NOTES && (
          <Row k="Release notes" hint="The popup this version opened with, and the ones before it">
            <button type="button" onClick={openWhatsNew} className="set-val set-link">
              What’s new in {LATEST_NOTES.version}
            </button>
          </Row>
        )}
        {update?.updateAvailable && (
          <Row k="Download" hint="Opens the GitHub release page in your browser">
            <a
              href={update.releaseUrl}
              target="_blank"
              rel="noreferrer"
              className="set-val set-link"
            >
              {update.releaseName ?? `ClaudeLens ${update.latestVersion}`} →
            </a>
          </Row>
        )}
      </div>

      {/* One closing line: the note that matters once on the left, the action on
          the right. The disclosure stays collapsed — it's a once-per-install
          command, and left open it was the longest thing on the page. */}
      <div className="set-actions">
        {IS_MAC && (
          <details className="set-disc">
            <summary>macOS: app can’t be opened after updating</summary>
            <p className="set-block-hint" style={{ marginTop: 10 }}>
              ClaudeLens isn’t code-signed, so after installing an update macOS quarantines the new
              app (“can’t be opened”). Clear it once from Terminal:
            </p>
            <div className="set-cmd">
              <code>{QUARANTINE_CMD}</code>
              <button
                type="button"
                onClick={copyCmd}
                className="cl-btn-ghost"
                style={copied ? { color: 'var(--cl-ok)' } : undefined}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </details>
        )}
        <button
          type="button"
          className="cl-btn-ghost"
          style={{ marginLeft: 'auto' }}
          onClick={() => refetch()}
          disabled={isFetching}
        >
          {isFetching ? 'Checking…' : 'Check now'}
        </button>
      </div>
    </Block>
  );
}

// ─── Privacy (ClaudeLens-own preference) ──────────────────────────────────────

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
        <PrefRow
          label="Share anonymous usage data"
          hint={
            on
              ? 'Anonymous usage events and error reports are sent via Aptabase (EU).'
              : 'Nothing is sent.'
          }
        >
          <OnOff
            label="Share anonymous usage data"
            checked={on}
            disabled={isLoading || setEnabled.isPending}
            onChange={v => setEnabled.mutate(v)}
          />
        </PrefRow>
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
            className="set-val set-link"
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
            className="set-val set-link"
          >
            Read PRIVACY.md →
          </a>
        </Row>
      </Block>
    </>
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

// ─── Building blocks ────────────────────────────────────────────────────────

export function Row({
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
          {src && <SourceBadge source={src.source} path={src.path} />}
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
        {/* The tone is one dot on the label. It used to tint every chip, and
            sage or amber text on its own soft ground did not clear AA. */}
        <span className="k">
          {tone && <span className={`set-tone ${tone}`} aria-hidden="true" />}
          {label}
        </span>
        <span className="leader" />
        <span className="v">
          <span className="set-val sm">{list.length || 'none'}</span>
        </span>
      </div>
      {list.length > 0 && (
        <div className="set-cloud" style={{ marginTop: 10 }}>
          {list.map((x, i) => (
            <span key={i} className="set-chip">
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

function RuntimeUnavailable() {
  return (
    <Block>
      <p className="set-dim">Runtime info unavailable.</p>
    </Block>
  );
}

export function Val({ children, sm }: { children: ReactNode; sm?: boolean }) {
  return <span className={`set-val${sm ? ' sm' : ''}`}>{children}</span>;
}

function Pill({ children }: { children: ReactNode }) {
  return <span className="set-pill">{children}</span>;
}

function Dim({ children, title }: { children?: ReactNode; title?: string }) {
  return (
    <span className="set-dim" title={title}>
      {children ?? '—'}
    </span>
  );
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

/** Which settings file a value came from, by tier. A project-tier stamp takes
 *  the accent — the same mark the project layer carries in the CLAUDE.md
 *  cascade — so "set here" can be picked out of a column of stamps. */
export function SourceBadge({ source, path }: { source: string; path?: string }) {
  return (
    <span className={`set-src${isProjectTier(source) ? ' here' : ''}`} title={path}>
      {sourceLabel(source)}
    </span>
  );
}

/** A stamp that is not a settings tier (an MCP server switched off here). */
function Stamp({ children }: { children: ReactNode }) {
  return <span className="set-src">{children}</span>;
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
