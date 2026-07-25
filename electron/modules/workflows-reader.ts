import { readdir, readFile, stat } from 'fs/promises';
import { basename, join } from 'path';
import { assertWithin } from '../utils';

// Claude Code's Workflow tool (multi-agent orchestration, e.g. what /code-review
// launches at high effort) persists rich per-run state on disk that the Agent SDK
// exposes NO API for (verified: the SDK only lists sessions/subagents). We read it
// raw with defensive per-field validation — the same regime as
// sessions-registry-reader.ts, since the format is undocumented and internal.
//
// On-disk layout (verified live, CLI 2.1.205), all under a project's
// ~/.claude/projects/{hash}/ :
//   {sessionId}/workflows/<runId>.json          — the run-state "gold file"
//   {sessionId}/workflows/scripts/<name>-<runId>.js  — the script file
//   {sessionId}/subagents/workflows/<runId>/agent-*.jsonl — agent transcripts
//
// Two subtleties that shaped the design, both verified against real data:
//  1. The session dir that holds a run's state JSON is NOT always the session
//     that launched it: a run can be resumed/forked so its state lands under a
//     different {sessionId} than the one whose .jsonl actually drove it. The
//     launching session is recorded verbatim in the run's `scriptPath` (it points
//     at {launchingSessionId}/workflows/scripts/…). We group runs by that
//     LAUNCHING session, because it is the one whose .jsonl exists (header→chat
//     works) and — critically — the only one the SDK's getSubagentMessages can
//     resolve for the transcript drill-down. Grouping by the state-file's own dir
//     would strand runs under a session the SDK returns 0 subagents for.
//  2. `status:'completed'` can lie: a run can complete with most agents dead on a
//     session limit (state 'error', 0 tokens) and an empty false-negative report.
//     The UI must surface per-agent error state, so we expose errorAgentCount.

export interface WorkflowAgentRow {
  index: number;
  label: string;
  agentId: string;
  phaseIndex: number;
  phaseTitle: string;
  model: string;
  /** 'done' | 'error' | 'running' | 'queued' | … (verbatim from disk). */
  state: string;
  attempt: number;
  startedAt?: number;
  queuedAt?: number;
  completedAt?: number;
  durationMs?: number;
  tokens?: number;
  toolCalls?: number;
  lastToolName?: string;
  lastToolSummary?: string;
  promptPreview?: string;
  resultPreview?: string;
  error?: string;
}

export interface WorkflowPhase {
  title: string;
  detail?: string;
}

export interface WorkflowRunSummary {
  runId: string;
  /** Launching session (from scriptPath); its `${sessionId}.jsonl` is the real one. */
  sessionId: string;
  workflowName: string;
  /** 'completed' | … | 'unknown' (orphan / missing). */
  status: string;
  /** true when there is no run-state JSON — recovered from transcripts only. */
  degraded: boolean;
  /** Epoch ms; fallback Date.parse(timestamp) → dir mtime → 0. */
  startTime: number;
  timestamp: string;
  durationMs: number;
  agentCount: number;
  errorAgentCount: number;
  phaseCount: number;
  totalTokens: number;
  totalToolCalls: number;
  /** Non-string args are JSON.stringify'd; absent → ''. */
  args: string;
  defaultModel: string;
}

export interface WorkflowGroup {
  sessionId: string;
  /** `${sessionId}.jsonl` — matches a SessionSummary.filename for header→chat. */
  filename: string;
  runs: WorkflowRunSummary[];
}

export interface WorkflowRunDetail extends WorkflowRunSummary {
  phases: WorkflowPhase[];
  agents: WorkflowAgentRow[];
  logs: string[];
  result: unknown;
  summary: string;
  /** Inline script; fallback: read scripts/<name>-<runId>.js. */
  script: string | null;
  scriptPath: string;
  taskId: string;
  /** Degraded runs only: agentIds recovered from the transcript dir listing. */
  orphanAgentIds?: string[];
}

// ──────────────────────────────────────────────────────────────────────────
// Field helpers — every value from disk is validated, never trusted.
// ──────────────────────────────────────────────────────────────────────────

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
function asNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function optNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function optString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Renderer-supplied ids are interpolated into read paths — reject anything with
 *  a separator or traversal. runId must also carry the `wf_` prefix. */
export function isSafeRunId(runId: unknown): runId is string {
  return typeof runId === 'string' && /^wf_[A-Za-z0-9._-]+$/.test(runId) && !runId.includes('..');
}
function isSafeSessionId(sessionId: unknown): sessionId is string {
  return (
    typeof sessionId === 'string' &&
    /^[A-Za-z0-9._-]+$/.test(sessionId) &&
    sessionId !== '.' &&
    sessionId !== '..'
  );
}

/** The launching session id, extracted from a run's scriptPath
 *  ({projectPath}/{sessionId}/workflows/scripts/…). Normalizes separators so a
 *  POSIX path stored on disk still parses on Windows. Returns null when the path
 *  doesn't sit under this project or the segment is unsafe. */
export function originSessionFromScriptPath(
  scriptPath: unknown,
  projectPath: string
): string | null {
  if (typeof scriptPath !== 'string' || scriptPath.length === 0) return null;
  const norm = (p: string) => p.replace(/\\/g, '/');
  const sp = norm(scriptPath);
  const base = norm(projectPath).replace(/\/+$/, '') + '/';
  if (!sp.startsWith(base)) return null;
  const seg = sp.slice(base.length).split('/')[0];
  return isSafeSessionId(seg) ? seg : null;
}

/** Parse one `workflowProgress` entry of type 'workflow_agent'. Returns null for
 *  any other type (phase markers, unknown types) so callers can filter. */
export function parseAgentEntry(raw: unknown): WorkflowAgentRow | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.type !== 'workflow_agent') return null;
  return {
    index: asNumber(r.index),
    label: asString(r.label),
    agentId: asString(r.agentId),
    phaseIndex: asNumber(r.phaseIndex),
    phaseTitle: asString(r.phaseTitle),
    model: asString(r.model),
    state: asString(r.state, 'unknown'),
    attempt: asNumber(r.attempt, 1),
    startedAt: optNumber(r.startedAt),
    queuedAt: optNumber(r.queuedAt),
    completedAt: optNumber(r.completedAt),
    durationMs: optNumber(r.durationMs),
    tokens: optNumber(r.tokens),
    toolCalls: optNumber(r.toolCalls),
    lastToolName: optString(r.lastToolName),
    lastToolSummary: optString(r.lastToolSummary),
    promptPreview: optString(r.promptPreview),
    resultPreview: optString(r.resultPreview),
    error: optString(r.error),
  };
}

function parsePhases(raw: unknown): WorkflowPhase[] {
  if (!Array.isArray(raw)) return [];
  const out: WorkflowPhase[] = [];
  for (const p of raw) {
    if (typeof p !== 'object' || p === null) continue;
    const r = p as Record<string, unknown>;
    out.push({ title: asString(r.title), ...(optString(r.detail) ? { detail: r.detail as string } : {}) });
  }
  return out;
}

function parseArgs(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw === 'string') return raw;
  try {
    return JSON.stringify(raw);
  } catch {
    return '';
  }
}

export interface ParseRunCtx {
  projectPath: string;
  /** Name of the dir physically holding the state JSON — origin fallback. */
  stateSessionId: string;
  /** mtime of the state file, epoch ms — startTime fallback of last resort. */
  fallbackMtimeMs: number;
}

/** Parse a run-state JSON object into a full detail. Pure: touches no disk (the
 *  script-file fallback lives in getWorkflowRun). Returns null when the payload
 *  isn't an object. */
export function parseRunFile(rawJson: unknown, ctx: ParseRunCtx): WorkflowRunDetail | null {
  if (typeof rawJson !== 'object' || rawJson === null) return null;
  const r = rawJson as Record<string, unknown>;

  // Same gate as getWorkflowRun: an unsafe id would list a row the detail
  // handler then refuses, leaving an unopenable entry in the UI.
  const runId = asString(r.runId);
  if (!isSafeRunId(runId)) return null;

  const progress = Array.isArray(r.workflowProgress) ? r.workflowProgress : [];
  const agents: WorkflowAgentRow[] = [];
  for (const entry of progress) {
    const a = parseAgentEntry(entry);
    if (a) agents.push(a);
  }

  const phases = parsePhases(r.phases);
  const timestamp = asString(r.timestamp);
  const startTime =
    optNumber(r.startTime) ??
    (timestamp && Number.isFinite(Date.parse(timestamp)) ? Date.parse(timestamp) : undefined) ??
    ctx.fallbackMtimeMs ??
    0;

  const sessionId = originSessionFromScriptPath(r.scriptPath, ctx.projectPath) ?? ctx.stateSessionId;
  // 'failed' is rendered as an error state everywhere in the UI — count it too.
  const errorAgentCount = agents.filter(a => a.state === 'error' || a.state === 'failed').length;

  return {
    runId,
    sessionId,
    workflowName: asString(r.workflowName),
    status: asString(r.status, 'unknown'),
    degraded: false,
    startTime,
    timestamp,
    durationMs: asNumber(r.durationMs),
    agentCount: asNumber(r.agentCount, agents.length),
    errorAgentCount,
    phaseCount: phases.length,
    totalTokens: asNumber(r.totalTokens),
    totalToolCalls: asNumber(r.totalToolCalls),
    args: parseArgs(r.args),
    defaultModel: asString(r.defaultModel),
    phases,
    agents,
    logs: Array.isArray(r.logs) ? r.logs.filter((l): l is string => typeof l === 'string') : [],
    result: r.result ?? null,
    summary: asString(r.summary),
    script: typeof r.script === 'string' ? r.script : null,
    scriptPath: asString(r.scriptPath),
    taskId: asString(r.taskId),
  };
}

function summaryOf(detail: WorkflowRunDetail): WorkflowRunSummary {
  return {
    runId: detail.runId,
    sessionId: detail.sessionId,
    workflowName: detail.workflowName,
    status: detail.status,
    degraded: detail.degraded,
    startTime: detail.startTime,
    timestamp: detail.timestamp,
    durationMs: detail.durationMs,
    agentCount: detail.agentCount,
    errorAgentCount: detail.errorAgentCount,
    phaseCount: detail.phaseCount,
    totalTokens: detail.totalTokens,
    totalToolCalls: detail.totalToolCalls,
    args: detail.args,
    defaultModel: detail.defaultModel,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Disk helpers
// ──────────────────────────────────────────────────────────────────────────

/** Direct child directories of `dir` (the session dirs of a project). */
async function sessionDirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return [];
  }
}

/** agentIds recovered from a transcript dir's `agent-*.jsonl` files. */
async function readOrphanAgentIds(transcriptDir: string): Promise<string[]> {
  try {
    const files = await readdir(transcriptDir);
    return files
      .filter(f => f.startsWith('agent-') && f.endsWith('.jsonl'))
      .map(f => f.slice('agent-'.length, -'.jsonl'.length))
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Recover a workflow name from a `scripts/<name>-<runId>.js` filename. */
async function recoverNameFromScript(scriptsDir: string, runId: string): Promise<string> {
  try {
    const files = await readdir(scriptsDir);
    const match = files.find(f => f.endsWith(`-${runId}.js`));
    if (match) return match.slice(0, match.length - `-${runId}.js`.length);
  } catch {
    // no scripts dir
  }
  return '';
}

/** 0 when missing/unreadable. Async on purpose: the project pass stats a file
 *  per run/transcript dir of every session, and a synchronous stat storm blocks
 *  the main process' event loop (visible jank while a chat streams). */
async function safeMtimeMs(path: string): Promise<number> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return 0;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────

/** All workflow runs of a project, grouped by their LAUNCHING session (from
 *  scriptPath), newest run first, empty groups dropped. Orphan runs (transcripts
 *  with no state JSON anywhere in the project) surface as degraded summaries.
 *  Never throws — returns [] on any top-level failure, skips malformed files. */
export async function getProjectWorkflows(projectPath: string): Promise<WorkflowGroup[]> {
  try {
    const dirs = await sessionDirs(projectPath);

    const summaries: WorkflowRunSummary[] = [];
    const knownRunIds = new Set<string>();

    // Pass 1 — run-state JSON files.
    for (const dirName of dirs) {
      const wfDir = join(projectPath, dirName, 'workflows');
      let files: string[];
      try {
        files = (await readdir(wfDir)).filter(f => f.endsWith('.json'));
      } catch {
        continue; // no workflows/ in this session dir
      }
      for (const file of files) {
        const full = join(wfDir, file);
        try {
          const [raw, fallbackMtimeMs] = await Promise.all([
            readFile(full, 'utf-8'),
            safeMtimeMs(full),
          ]);
          const detail = parseRunFile(JSON.parse(raw), {
            projectPath,
            stateSessionId: dirName,
            fallbackMtimeMs,
          });
          if (!detail || knownRunIds.has(detail.runId)) continue;
          knownRunIds.add(detail.runId);
          summaries.push(summaryOf(detail));
        } catch {
          // Malformed / mid-write JSON: skip; next data:changed re-reads.
        }
      }
    }

    // Pass 2 — orphan transcripts (no state JSON for this runId anywhere).
    const seenOrphans = new Set<string>();
    for (const dirName of dirs) {
      const tRoot = join(projectPath, dirName, 'subagents', 'workflows');
      let runDirs: string[];
      try {
        runDirs = (await readdir(tRoot, { withFileTypes: true }))
          .filter(e => e.isDirectory() && isSafeRunId(e.name))
          .map(e => e.name);
      } catch {
        continue;
      }
      for (const runId of runDirs) {
        if (knownRunIds.has(runId) || seenOrphans.has(runId)) continue;
        seenOrphans.add(runId);
        const transcriptDir = join(tRoot, runId);
        const orphanIds = await readOrphanAgentIds(transcriptDir);
        const name = await recoverNameFromScript(
          join(projectPath, dirName, 'workflows', 'scripts'),
          runId
        );
        summaries.push({
          runId,
          sessionId: dirName,
          workflowName: name,
          status: 'unknown',
          degraded: true,
          startTime: await safeMtimeMs(transcriptDir),
          timestamp: '',
          durationMs: 0,
          agentCount: orphanIds.length,
          errorAgentCount: 0,
          phaseCount: 0,
          totalTokens: 0,
          totalToolCalls: 0,
          args: '',
          defaultModel: '',
        });
      }
    }

    // Group by launching session, newest run first, drop empties, newest group first.
    const bySession = new Map<string, WorkflowRunSummary[]>();
    for (const s of summaries) {
      const arr = bySession.get(s.sessionId) ?? [];
      arr.push(s);
      bySession.set(s.sessionId, arr);
    }
    const groups: WorkflowGroup[] = [];
    for (const [sessionId, runs] of bySession) {
      runs.sort((a, b) => b.startTime - a.startTime);
      groups.push({ sessionId, filename: `${sessionId}.jsonl`, runs });
    }
    groups.sort((a, b) => (b.runs[0]?.startTime ?? 0) - (a.runs[0]?.startTime ?? 0));
    return groups;
  } catch (error) {
    console.error(`Error reading project workflows: ${error}`);
    return [];
  }
}

/** Full detail of a single run, re-read on demand (watcher-live). Finds the run
 *  by id across all session dirs (state and launching session can diverge). Falls
 *  back to a degraded detail (transcripts only) for orphan runs. Rejects unsafe
 *  ids and any path escaping the project. Returns null when nothing is found. */
export async function getWorkflowRun(
  projectPath: string,
  sessionId: string,
  runId: string
): Promise<WorkflowRunDetail | null> {
  if (!isSafeRunId(runId)) return null;
  const dirs = await sessionDirs(projectPath);

  // Locate the state file by runId (may live under a different session than
  // the caller's grouping sessionId).
  for (const dirName of dirs) {
    const candidate = join(projectPath, dirName, 'workflows', `${runId}.json`);
    try {
      assertWithin(projectPath, candidate);
    } catch {
      continue;
    }
    if (!(await pathExists(candidate))) continue;
    try {
      const [raw, fallbackMtimeMs] = await Promise.all([
        readFile(candidate, 'utf-8'),
        safeMtimeMs(candidate),
      ]);
      const detail = parseRunFile(JSON.parse(raw), {
        projectPath,
        stateSessionId: dirName,
        fallbackMtimeMs,
      });
      if (!detail) continue;
      // Script fallback: if not inlined, read the .js from the LAUNCHING
      // session's scripts/ (detail.sessionId, from scriptPath) — on a
      // resumed/forked run the state JSON dir (dirName) is a different session.
      if (detail.script === null && detail.scriptPath) {
        const scriptFile = join(projectPath, detail.sessionId, 'workflows', 'scripts', basename(detail.scriptPath));
        try {
          assertWithin(projectPath, scriptFile);
          detail.script = await readFile(scriptFile, 'utf-8');
        } catch {
          // leave null
        }
      }
      return detail;
    } catch {
      continue; // malformed; try other dirs
    }
  }

  // No state file: try to recover a degraded detail from transcripts.
  const hint = isSafeSessionId(sessionId) ? sessionId : null;
  const searchOrder = hint ? [hint, ...dirs.filter(d => d !== hint)] : dirs;
  for (const dirName of searchOrder) {
    const transcriptDir = join(projectPath, dirName, 'subagents', 'workflows', runId);
    try {
      assertWithin(projectPath, transcriptDir);
    } catch {
      continue;
    }
    if (!(await pathExists(transcriptDir))) continue;
    const orphanAgentIds = await readOrphanAgentIds(transcriptDir);
    const name = await recoverNameFromScript(
      join(projectPath, dirName, 'workflows', 'scripts'),
      runId
    );
    return {
      runId,
      sessionId: dirName,
      workflowName: name,
      status: 'unknown',
      degraded: true,
      startTime: await safeMtimeMs(transcriptDir),
      timestamp: '',
      durationMs: 0,
      agentCount: orphanAgentIds.length,
      errorAgentCount: 0,
      phaseCount: 0,
      totalTokens: 0,
      totalToolCalls: 0,
      args: '',
      defaultModel: '',
      phases: [],
      agents: [],
      logs: [],
      result: null,
      summary: '',
      script: null,
      scriptPath: '',
      taskId: '',
      orphanAgentIds,
    };
  }

  return null;
}
