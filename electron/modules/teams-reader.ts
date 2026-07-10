import { readdir, readFile } from 'fs/promises';
import { statSync } from 'fs';
import { join } from 'path';
import { assertWithin, CLAUDE_DIR } from '../utils';

// Claude Code 2.x agent teams (in-process teammates coordinated by a team-lead)
// leave two kinds of artifacts, both undocumented internals we read raw with
// defensive per-field validation (same regime as sessions-registry-reader.ts):
//
//  1. A global registry at ~/.claude/teams/<teamName>/config.json — the dir is
//     keyed by the lead's session id AT TEAM CREATION and never renamed, so
//     `leadSessionId` goes stale when the lead session rotates ids on resume.
//     Members are appended one-by-one on spawn and are NOT removed on task
//     completion; killing the lead session leaves the whole entry behind, and
//     every session eagerly creates a lead-only dir even when no teammate is
//     ever spawned. The sibling inboxes/*.json are transient message queues
//     (drained to [] within seconds) — no history lives there.
//  2. Teammate transcripts under the project:
//     {sessionId}/subagents/agent-a<name>-<16hex>.jsonl plus a sidecar
//     agent-a<name>-<16hex>.meta.json carrying
//     { taskKind: 'in_process_teammate', teamName, name, color, model, … }.
//
// Because (1) is stale-prone and unanchored to a project, the transcripts are
// the source of truth for "which teams exist in this project"; the registry
// config only enriches them (prompts, joinedAt, members that never produced a
// transcript). All verified live on CLI 2.1.x, 2026-07-09.

export interface TeamMemberTranscript {
  /** Session dir that physically holds the transcript (the lead session CURRENT at that spawn). */
  sessionId: string;
  /** `${sessionId}.jsonl` — matches a SessionSummary.filename; arg for SubagentTranscriptPanel. */
  filename: string;
  /** Transcript file stem without the `agent-` prefix, e.g. "acheck-readme-8f02…". */
  agentId: string;
  /** mtime of the .jsonl, epoch ms — the member's last activity. */
  mtimeMs: number;
}

export interface TeamMemberInfo {
  name: string;
  color: string;
  model: string;
  description: string;
  /** Full dispatch prompt from the registry config; '' when the config is gone. */
  prompt: string;
  /** Epoch ms from the config; 0 when unknown. */
  joinedAt: number;
  planModeRequired: boolean;
  permissionMode: string;
  /** Member cwd from the config — may differ from the project (cross-project chip). */
  cwd: string;
  /** Where this member was seen: transcripts + config, config only, or transcripts only. */
  source: 'both' | 'config-only' | 'transcript-only';
  /** Newest first; a respawned member has one entry per transcript. */
  transcripts: TeamMemberTranscript[];
  /** Assistant turns across the member's transcripts. */
  messageCount: number;
  /** tool_use blocks across the member's transcripts. */
  toolCallCount: number;
  /** Sum of usage tokens (input+output+cache) across the member's transcripts. */
  totalTokens: number;
}

/** One entry of the team conversation, reconstructed from the members'
 *  transcripts: inbound `<teammate-message>` lines (lead → member; the first
 *  one is the dispatch) and the member's SendMessage tool calls (member →
 *  lead/peer). Automatic idle notifications are dropped. */
export interface TeamEvent {
  /** Epoch ms from the transcript line; 0 when the line has no timestamp. */
  timestamp: number;
  from: string;
  to: string;
  /** Sender-provided one-liner; '' when absent. */
  summary: string;
  text: string;
  kind: 'dispatch' | 'message';
}

export interface TeamSummary {
  /** Registry dir name ("session-<8hex>") — the stable join/navigation key. */
  teamName: string;
  /** config.name when available, else teamName. */
  displayName: string;
  /** Session dir with the newest teammate transcript (header→chat target). */
  sessionId: string;
  /** `${sessionId}.jsonl` — matches a SessionSummary.filename. */
  filename: string;
  /** Every session dir holding transcripts of this team (rotated ids), newest first. */
  sessionIds: string[];
  /** config.createdAt, else the oldest transcript mtime. */
  createdAt: number;
  /** Newest transcript mtime. */
  lastActivity: number;
  /** false when the registry entry is gone — degraded row. */
  hasConfig: boolean;
  memberCount: number;
  memberNames: string[];
  /** Parallel to memberNames. */
  memberColors: string[];
  transcriptCount: number;
  /** Usage tokens (input+output+cache) per member, parallel to memberNames.
   *  List-level rollup served by an mtime-keyed cache — a transcript is parsed
   *  once and re-read only when its mtime moves. */
  memberTokens: number[];
  /** Sum of memberTokens. */
  totalTokens: number;
  /** Assistant turns across all member transcripts. */
  messageCount: number;
  /** Lead id from the registry config (stale after a lead resume — sessionIds
   *  stay the liveness source of truth; this only closes the config-only gap). */
  leadSessionIdFromConfig: string | null;
}

export interface TeamDetail extends TeamSummary {
  /** joinedAt asc (spawn order), fallback oldest-transcript order. */
  members: TeamMemberInfo[];
  /** Team conversation timeline, oldest first (see TeamEvent). */
  events: TeamEvent[];
  configPath: string | null;
}

export interface TeamsReaderOpts {
  /** Registry root, injectable for tests. Default ~/.claude/teams. */
  teamsDir?: string;
}

const DEFAULT_TEAMS_DIR = join(CLAUDE_DIR, 'teams');

// ──────────────────────────────────────────────────────────────────────────
// Field helpers — every value from disk is validated, never trusted.
// ──────────────────────────────────────────────────────────────────────────

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
function asNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function asBool(v: unknown): boolean {
  return v === true;
}

/** teamName comes from files on disk and is interpolated into a registry read
 *  path — reject separators and traversal outright. */
export function isSafeTeamName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    /^[A-Za-z0-9._-]+$/.test(name) &&
    name !== '.' &&
    !name.includes('..')
  );
}

const META_SUFFIX = '.meta.json';
const AGENT_PREFIX = 'agent-';

// ──────────────────────────────────────────────────────────────────────────
// Disk scanning
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

function safeMtimeMs(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

interface ScannedMember {
  name: string;
  color: string;
  model: string;
  description: string;
  planModeRequired: boolean;
  permissionMode: string;
  /** mtime of the transcript whose sidecar supplied the meta fields above —
   *  a respawned member's newest sidecar must win over readdir order. */
  metaMtimeMs: number;
  transcripts: TeamMemberTranscript[];
}

/** teamName → memberName → scanned member (meta fields + transcript refs). */
type ScanResult = Map<string, Map<string, ScannedMember>>;

/** Pass 1 — walk every session dir's subagents/ for teammate sidecar metas.
 *  A meta only counts when taskKind is 'in_process_teammate', its teamName is
 *  safe, and the twin .jsonl transcript actually exists. */
async function scanTranscripts(projectPath: string): Promise<ScanResult> {
  const teams: ScanResult = new Map();
  for (const dirName of await sessionDirs(projectPath)) {
    const subagentsDir = join(projectPath, dirName, 'subagents');
    let files: string[];
    try {
      files = await readdir(subagentsDir);
    } catch {
      continue; // no subagents/ in this session dir
    }
    for (const file of files) {
      if (!file.startsWith(AGENT_PREFIX) || !file.endsWith(META_SUFFIX)) continue;
      const metaPath = join(subagentsDir, file);
      let meta: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(await readFile(metaPath, 'utf-8'));
        if (typeof parsed !== 'object' || parsed === null) continue;
        meta = parsed as Record<string, unknown>;
      } catch {
        continue; // malformed / mid-write JSON: next data:changed re-reads
      }
      if (meta.taskKind !== 'in_process_teammate') continue; // plain Task subagents
      const teamName = meta.teamName;
      if (!isSafeTeamName(teamName)) continue;
      const name = asString(meta.name);
      if (!name) continue;

      const stem = file.slice(0, -META_SUFFIX.length);
      const jsonlPath = join(subagentsDir, `${stem}.jsonl`);
      const mtimeMs = safeMtimeMs(jsonlPath);
      if (mtimeMs === 0) continue; // meta without a twin transcript

      const members = teams.get(teamName) ?? new Map<string, ScannedMember>();
      teams.set(teamName, members);
      const member = members.get(name) ?? {
        name,
        color: '',
        model: '',
        description: '',
        planModeRequired: false,
        permissionMode: '',
        metaMtimeMs: -1,
        transcripts: [],
      };
      members.set(name, member);
      if (mtimeMs > member.metaMtimeMs) {
        member.color = asString(meta.color);
        member.model = asString(meta.model);
        member.description = asString(meta.description);
        member.planModeRequired = asBool(meta.planModeRequired);
        member.permissionMode = asString(meta.permissionMode);
        member.metaMtimeMs = mtimeMs;
      }
      member.transcripts.push({
        sessionId: dirName,
        filename: `${dirName}.jsonl`,
        agentId: stem.slice(AGENT_PREFIX.length),
        mtimeMs,
      });
    }
  }
  for (const members of teams.values()) {
    for (const m of members.values()) m.transcripts.sort((a, b) => b.mtimeMs - a.mtimeMs);
  }
  return teams;
}

// ──────────────────────────────────────────────────────────────────────────
// Member-transcript parsing. The detail re-reads every transcript on demand
// (it needs the conversation events); the list only rolls up the numeric
// metrics, served by the mtime-keyed cache below so watcher churn never
// re-parses an unchanged transcript.
// ──────────────────────────────────────────────────────────────────────────

export interface TranscriptScan {
  events: TeamEvent[];
  messageCount: number;
  toolCallCount: number;
  totalTokens: number;
}

// The opening tag is matched whole and its attributes extracted separately:
// attribute order is not fixed (member-sent messages carry `color` between
// `teammate_id` and `summary`; lead messages don't), and an optional group
// after a lazy quantifier never backtracks to capture a later attribute.
const TEAMMATE_MSG_RE = /<teammate-message\s([^>]*)>\n?([\s\S]*?)<\/teammate-message>/;

function tagAttr(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs);
  return m ? m[1] : null;
}

function unescapeAttr(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Text of a message whose content is either a plain string or content blocks. */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b): b is Record<string, unknown> => typeof b === 'object' && b !== null)
    .filter(b => b.type === 'text')
    .map(b => asString(b.text))
    .join('\n');
}

function isIdleNotification(text: string): boolean {
  return text.trimStart().startsWith('{"type":"idle_notification"');
}

/** Parse one member transcript: conversation events (inbound teammate-messages
 *  + outbound SendMessage calls) and lightweight per-member metrics. Defensive
 *  line-by-line — a malformed line is skipped, never fatal. Pure over the file
 *  content, exported for unit tests. */
export function scanMemberTranscript(raw: string, memberName: string): TranscriptScan {
  const out: TranscriptScan = { events: [], messageCount: 0, toolCallCount: 0, totalTokens: 0 };
  let sawDispatch = false;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed !== 'object' || parsed === null) continue;
      entry = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    const message =
      typeof entry.message === 'object' && entry.message !== null
        ? (entry.message as Record<string, unknown>)
        : null;
    if (!message) continue;
    const timestamp = Date.parse(asString(entry.timestamp)) || 0;

    if (entry.type === 'user') {
      const m = TEAMMATE_MSG_RE.exec(contentText(message.content));
      if (!m) continue;
      const from = tagAttr(m[1], 'teammate_id');
      if (from === null) continue;
      const text = m[2].trim();
      if (isIdleNotification(text)) continue;
      out.events.push({
        timestamp,
        from: unescapeAttr(from),
        to: memberName,
        summary: unescapeAttr(tagAttr(m[1], 'summary') ?? ''),
        text,
        kind: sawDispatch ? 'message' : 'dispatch',
      });
      sawDispatch = true;
    } else if (entry.type === 'assistant') {
      out.messageCount += 1;
      const usage =
        typeof message.usage === 'object' && message.usage !== null
          ? (message.usage as Record<string, unknown>)
          : null;
      if (usage) {
        out.totalTokens +=
          asNumber(usage.input_tokens) +
          asNumber(usage.output_tokens) +
          asNumber(usage.cache_creation_input_tokens) +
          asNumber(usage.cache_read_input_tokens);
      }
      if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (typeof block !== 'object' || block === null) continue;
          const b = block as Record<string, unknown>;
          if (b.type !== 'tool_use') continue;
          out.toolCallCount += 1;
          if (b.name !== 'SendMessage') continue;
          const input =
            typeof b.input === 'object' && b.input !== null
              ? (b.input as Record<string, unknown>)
              : null;
          if (!input) continue;
          // Trimmed like the inbound <teammate-message> body, so the peer
          // dedup key below matches the receiver's copy of the same message.
          const text = asString(input.message).trim();
          if (!text || isIdleNotification(text)) continue;
          // 'main' is an accepted alias for the lead in SendMessage routing —
          // normalize so the timeline shows one consistent name.
          const to = asString(input.to, 'team-lead');
          out.events.push({
            timestamp,
            from: memberName,
            to: to === 'main' ? 'team-lead' : to,
            summary: asString(input.summary),
            text,
            kind: 'message',
          });
        }
      }
    }
  }
  return out;
}

async function scanMemberTranscriptFile(path: string, memberName: string): Promise<TranscriptScan> {
  try {
    return scanMemberTranscript(await readFile(path, 'utf-8'), memberName);
  } catch {
    return { events: [], messageCount: 0, toolCallCount: 0, totalTokens: 0 };
  }
}

interface MemberMetrics {
  messageCount: number;
  toolCallCount: number;
  totalTokens: number;
}

/** path → metrics at a given mtime. Entries are tiny (numbers only) and teams
 *  per project are few, so the map is left unbounded like cost-tracker's. */
const metricsCache = new Map<string, { mtimeMs: number } & MemberMetrics>();

function cacheMetrics(path: string, mtimeMs: number, scan: MemberMetrics): MemberMetrics {
  const entry = {
    mtimeMs,
    messageCount: scan.messageCount,
    toolCallCount: scan.toolCallCount,
    totalTokens: scan.totalTokens,
  };
  metricsCache.set(path, entry);
  return entry;
}

function transcriptPath(projectPath: string, t: TeamMemberTranscript): string | null {
  const path = join(projectPath, t.sessionId, 'subagents', `agent-${t.agentId}.jsonl`);
  try {
    assertWithin(projectPath, path);
    return path;
  } catch {
    return null;
  }
}

async function cachedTranscriptMetrics(
  projectPath: string,
  member: string,
  t: TeamMemberTranscript
): Promise<MemberMetrics> {
  const path = transcriptPath(projectPath, t);
  if (!path) return { messageCount: 0, toolCallCount: 0, totalTokens: 0 };
  const hit = metricsCache.get(path);
  if (hit && hit.mtimeMs === t.mtimeMs) return hit;
  return cacheMetrics(path, t.mtimeMs, await scanMemberTranscriptFile(path, member));
}

/** Promote the per-member metrics onto the team-level summary fields. */
function rollupMetrics(detail: TeamDetail): void {
  detail.memberTokens = detail.members.map(m => m.totalTokens);
  detail.totalTokens = detail.members.reduce((sum, m) => sum + m.totalTokens, 0);
  detail.messageCount = detail.members.reduce((sum, m) => sum + m.messageCount, 0);
}

interface ConfigMember {
  name: string;
  color: string;
  model: string;
  prompt: string;
  joinedAt: number;
  planModeRequired: boolean;
  cwd: string;
}

interface TeamConfig {
  displayName: string;
  createdAt: number;
  leadSessionId: string | null;
  /** Lead excluded — it is represented by the session itself. */
  members: ConfigMember[];
}

/** Pass 2 — enrich from the global registry. Returns null when the config is
 *  missing or unreadable (degraded team). */
async function readTeamConfig(teamsDir: string, teamName: string): Promise<TeamConfig | null> {
  const configPath = join(teamsDir, teamName, 'config.json');
  try {
    assertWithin(teamsDir, configPath);
    const parsed: unknown = JSON.parse(await readFile(configPath, 'utf-8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const r = parsed as Record<string, unknown>;
    const members: ConfigMember[] = [];
    if (Array.isArray(r.members)) {
      for (const raw of r.members) {
        if (typeof raw !== 'object' || raw === null) continue;
        const m = raw as Record<string, unknown>;
        // The lead carries agentType 'team-lead' / tmuxPaneId 'leader'; regular
        // members have neither field set that way.
        if (m.agentType === 'team-lead' || m.tmuxPaneId === 'leader') continue;
        const name = asString(m.name);
        if (!name) continue;
        members.push({
          name,
          color: asString(m.color),
          model: asString(m.model),
          prompt: asString(m.prompt),
          joinedAt: asNumber(m.joinedAt),
          planModeRequired: asBool(m.planModeRequired),
          cwd: asString(m.cwd),
        });
      }
    }
    return {
      displayName: asString(r.name, teamName),
      createdAt: asNumber(r.createdAt),
      leadSessionId: asString(r.leadSessionId) || null,
      members,
    };
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Assembly
// ──────────────────────────────────────────────────────────────────────────

function buildDetail(
  teamName: string,
  scanned: Map<string, ScannedMember>,
  config: TeamConfig | null,
  configPath: string | null
): TeamDetail {
  const byName = new Map<string, TeamMemberInfo>();

  for (const s of scanned.values()) {
    byName.set(s.name, {
      name: s.name,
      color: s.color,
      model: s.model,
      description: s.description,
      prompt: '',
      joinedAt: 0,
      planModeRequired: s.planModeRequired,
      permissionMode: s.permissionMode,
      cwd: '',
      source: 'transcript-only',
      transcripts: s.transcripts,
      messageCount: 0,
      toolCallCount: 0,
      totalTokens: 0,
    });
  }

  for (const c of config?.members ?? []) {
    const existing = byName.get(c.name);
    if (existing) {
      existing.prompt = c.prompt;
      existing.joinedAt = c.joinedAt;
      existing.cwd = c.cwd;
      if (!existing.color) existing.color = c.color;
      if (!existing.model) existing.model = c.model;
      existing.source = 'both';
    } else {
      byName.set(c.name, {
        name: c.name,
        color: c.color,
        model: c.model,
        description: '',
        prompt: c.prompt,
        joinedAt: c.joinedAt,
        planModeRequired: c.planModeRequired,
        permissionMode: '',
        cwd: c.cwd,
        source: 'config-only',
        transcripts: [],
        messageCount: 0,
        toolCallCount: 0,
        totalTokens: 0,
      });
    }
  }

  const members = [...byName.values()];
  // Single spawn-order key per member (joinedAt when the config still has it,
  // else the oldest transcript mtime — both epoch ms): switching the key per
  // pair is not a consistent total order when only some members carry joinedAt.
  const spawnOrder = (m: TeamMemberInfo) =>
    m.joinedAt ||
    (m.transcripts.length
      ? m.transcripts[m.transcripts.length - 1].mtimeMs
      : Number.MAX_SAFE_INTEGER);
  members.sort((a, b) => spawnOrder(a) - spawnOrder(b));

  const allTranscripts = members.flatMap(m => m.transcripts);
  // Session dirs by their newest transcript, newest session first.
  const newestBySession = new Map<string, number>();
  for (const t of allTranscripts) {
    newestBySession.set(t.sessionId, Math.max(newestBySession.get(t.sessionId) ?? 0, t.mtimeMs));
  }
  const sessionIds = [...newestBySession.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const sessionId = sessionIds[0] ?? '';
  const lastActivity = allTranscripts.reduce((mx, t) => Math.max(mx, t.mtimeMs), 0);
  const oldest = allTranscripts.reduce((mn, t) => Math.min(mn, t.mtimeMs), Number.MAX_SAFE_INTEGER);

  return {
    teamName,
    displayName: config?.displayName ?? teamName,
    sessionId,
    filename: sessionId ? `${sessionId}.jsonl` : '',
    sessionIds,
    createdAt: config?.createdAt || (allTranscripts.length ? oldest : 0),
    lastActivity,
    hasConfig: config !== null,
    memberCount: members.length,
    memberNames: members.map(m => m.name),
    memberColors: members.map(m => m.color),
    transcriptCount: allTranscripts.length,
    memberTokens: members.map(() => 0),
    totalTokens: 0,
    messageCount: 0,
    members,
    events: [],
    leadSessionIdFromConfig: config?.leadSessionId ?? null,
    configPath: config !== null ? configPath : null,
  };
}

function summaryOf(d: TeamDetail): TeamSummary {
  const { members: _members, events: _e, configPath: _c, ...summary } = d;
  return summary;
}

// ──────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────

/** All agent teams of a project, anchored by teammate transcripts (the registry
 *  alone is stale-prone and its eager lead-only dirs are noise), enriched from
 *  ~/.claude/teams when the entry still exists. Sorted by lastActivity desc.
 *  Never throws — returns [] on any top-level failure, skips malformed files. */
export async function getProjectTeams(
  projectPath: string,
  opts: TeamsReaderOpts = {}
): Promise<TeamSummary[]> {
  try {
    const teamsDir = opts.teamsDir ?? DEFAULT_TEAMS_DIR;
    const scanned = await scanTranscripts(projectPath);
    const summaries: TeamSummary[] = [];
    for (const [teamName, members] of scanned) {
      const config = await readTeamConfig(teamsDir, teamName);
      const configPath = join(teamsDir, teamName, 'config.json');
      const detail = buildDetail(teamName, members, config, configPath);
      for (const member of detail.members) {
        for (const t of member.transcripts) {
          const m = await cachedTranscriptMetrics(projectPath, member.name, t);
          member.messageCount += m.messageCount;
          member.toolCallCount += m.toolCallCount;
          member.totalTokens += m.totalTokens;
        }
      }
      rollupMetrics(detail);
      summaries.push(summaryOf(detail));
    }
    summaries.sort((a, b) => b.lastActivity - a.lastActivity);
    return summaries;
  } catch (error) {
    console.error(`Error reading project teams: ${error}`);
    return [];
  }
}

/** Full detail of one team, re-read on demand (watcher-live). Rejects unsafe
 *  team names; returns null when the team has no transcripts in this project. */
export async function getTeamDetail(
  projectPath: string,
  teamName: string,
  opts: TeamsReaderOpts = {}
): Promise<TeamDetail | null> {
  if (!isSafeTeamName(teamName)) return null;
  try {
    const teamsDir = opts.teamsDir ?? DEFAULT_TEAMS_DIR;
    const scanned = await scanTranscripts(projectPath);
    const members = scanned.get(teamName);
    if (!members) return null;
    const config = await readTeamConfig(teamsDir, teamName);
    const configPath = join(teamsDir, teamName, 'config.json');
    const detail = buildDetail(teamName, members, config, configPath);

    // Detail enrichment: open each member transcript for the conversation
    // timeline (events are never cached) and the per-member metrics; the
    // metrics land in the cache so the next list read is free.
    for (const member of detail.members) {
      for (const t of member.transcripts) {
        const path = transcriptPath(projectPath, t);
        if (!path) continue;
        const scan = await scanMemberTranscriptFile(path, member.name);
        cacheMetrics(path, t.mtimeMs, scan);
        member.messageCount += scan.messageCount;
        member.toolCallCount += scan.toolCallCount;
        member.totalTokens += scan.totalTokens;
        detail.events.push(...scan.events);
      }
    }
    // A member→member message is recorded twice — as the sender's SendMessage
    // tool call and as the receiver's inbound <teammate-message> — with
    // slightly different timestamps. Same peer route + same text = the same
    // message: sort first so the earliest record (the sender's) survives, and
    // bound the match in time so two genuinely distinct identical messages
    // (e.g. two "done" A→B minutes apart) don't collapse. Lead routes are
    // recorded once only.
    detail.events.sort((a, b) => a.timestamp - b.timestamp);
    const DEDUP_WINDOW_MS = 60_000;
    const lastKeptAt = new Map<string, number>();
    detail.events = detail.events.filter(e => {
      if (e.from === 'team-lead' || e.to === 'team-lead') return true;
      const key = `${e.from}\u0000${e.to}\u0000${e.text}`;
      const prev = lastKeptAt.get(key);
      if (prev !== undefined && e.timestamp - prev <= DEDUP_WINDOW_MS) return false;
      lastKeptAt.set(key, e.timestamp);
      return true;
    });
    rollupMetrics(detail);
    return detail;
  } catch (error) {
    console.error(`Error reading team detail: ${error}`);
    return null;
  }
}
