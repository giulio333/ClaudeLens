import os from 'os';
import { resolveClaudeExecutablePath } from '../utils';

// Reads the *effective* Claude Code configuration through the official Agent SDK
// (`@anthropic-ai/claude-agent-sdk`) instead of hand-parsing the settings files.
// Two complementary sources are merged:
//   1. `resolveSettings()` — the merged settings cascade (user/project/local) with
//      per-key provenance. Pure, no CLI spawn, no token cost.
//   2. the `system/init` message of a `query()` — the runtime-resolved view the
//      settings files do not expose: resolved model id, live MCP status, the
//      active tool list, slash commands, skills, agents, plugins and version.
// The SDK is ESM-only, so it is loaded with a dynamic `import()` from the
// CommonJS main process (same approach as chokidar in live-monitor.ts).

// Packaged app only: points at the asar-unpacked CLI binary; undefined in dev.
const claudeExecutable = resolveClaudeExecutablePath();

/** Runtime view captured from the SDK `system/init` message. */
export interface InitInfo {
  permissionMode: string;
  model: string;
  cwd: string;
  apiKeySource: string;
  claudeCodeVersion: string;
  tools: string[];
  mcpServers: { name: string; status: string }[];
  slashCommands: string[];
  outputStyle: string;
  skills: string[];
  agents: string[];
  plugins: { name: string; path: string }[];
}

/** One tier of the settings cascade, with its file path when filesystem-backed. */
export interface SettingsSourceEntry {
  source: string;
  path?: string;
  settings: Record<string, unknown>;
}

export interface EffectiveConfig {
  /** Directory the configuration was resolved against. */
  cwd: string;
  init: InitInfo | null;
  initError: string | null;
  /** Merged settings after applying every enabled source in precedence order. */
  effective: Record<string, unknown>;
  /** For each top-level key in `effective`, which tier supplied it. */
  provenance: Record<string, { source: string; path?: string }>;
  sources: SettingsSourceEntry[];
  settingsError: string | null;
}

const INIT_TIMEOUT_MS = 30_000;

async function loadSdk() {
  return import('@anthropic-ai/claude-agent-sdk');
}

type Sdk = Awaited<ReturnType<typeof loadSdk>>;

function mapInit(m: Record<string, unknown>): InitInfo {
  return {
    permissionMode: String(m.permissionMode ?? ''),
    model: String(m.model ?? ''),
    cwd: String(m.cwd ?? ''),
    apiKeySource: String(m.apiKeySource ?? ''),
    claudeCodeVersion: String(m.claude_code_version ?? ''),
    tools: (m.tools as string[]) ?? [],
    mcpServers: (m.mcp_servers as { name: string; status: string }[]) ?? [],
    slashCommands: (m.slash_commands as string[]) ?? [],
    outputStyle: String(m.output_style ?? ''),
    skills: (m.skills as string[]) ?? [],
    agents: (m.agents as string[]) ?? [],
    plugins: (m.plugins as { name: string; path: string }[]) ?? [],
  };
}

// Drive a one-turn query just far enough to read the init message, then abort.
// We break *before* any model turn runs, so this incurs no completion cost.
async function captureInit(sdk: Sdk, cwd: string): Promise<InitInfo | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), INIT_TIMEOUT_MS);
  let result: InitInfo | null = null;
  try {
    const q = sdk.query({
      prompt: 'noop',
      options: {
        cwd,
        maxTurns: 1,
        abortController: abort,
        // Packaged app: the CLI binary is unpacked outside app.asar (see utils).
        ...(claudeExecutable && { pathToClaudeCodeExecutable: claudeExecutable }),
      },
    });
    for await (const msg of q) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        result = mapInit(msg as unknown as Record<string, unknown>);
        break; // closing the iterator tears down the query before a turn runs
      }
    }
  } catch (e) {
    if (!result) throw e; // ignore teardown/abort errors once we have the init
  } finally {
    abort.abort();
    clearTimeout(timer);
  }
  return result;
}

export async function readEffectiveConfig(cwd?: string): Promise<EffectiveConfig> {
  const dir = cwd && cwd.length ? cwd : os.homedir();
  const sdk = await loadSdk();

  let effective: Record<string, unknown> = {};
  let provenance: Record<string, { source: string; path?: string }> = {};
  let sources: SettingsSourceEntry[] = [];
  let settingsError: string | null = null;
  try {
    const resolved = await sdk.resolveSettings({ cwd: dir });
    effective = (resolved.effective as Record<string, unknown>) ?? {};
    provenance = Object.fromEntries(
      Object.entries(resolved.provenance ?? {}).map(([k, v]) => [
        k,
        { source: (v as { source: string }).source, path: (v as { path?: string }).path },
      ])
    );
    sources = (resolved.sources ?? []).map(s => ({
      source: s.source,
      path: s.path,
      settings: (s.settings as Record<string, unknown>) ?? {},
    }));
  } catch (e) {
    settingsError = e instanceof Error ? e.message : String(e);
  }

  let init: InitInfo | null = null;
  let initError: string | null = null;
  try {
    init = await captureInit(sdk, dir);
    if (!init) initError = 'No init message received from the Agent SDK.';
  } catch (e) {
    initError = e instanceof Error ? e.message : String(e);
  }

  return { cwd: dir, init, initError, effective, provenance, sources, settingsError };
}
