// What ClaudeLens knows about Claude Code's transcript format.
//
// This file is the census oracle: `transcript-census.mjs` diffs the shapes it
// finds in `~/.claude/projects/**/*.jsonl` against the decisions recorded here,
// and reports only what neither side accounts for. It is hand-maintained on
// purpose — grepping the source for a row type produces false positives
// everywhere (`'user'` is a chat role, an IPC namespace and a directory name),
// so "do we read this?" is a decision a human makes once and writes down.
//
// Every shape gets exactly one verdict:
//
//   read     — a module consumes it. `by` names the module, so a report can say
//              where a changed field would land.
//   ignored  — deliberately not read, with the reason. Harness bookkeeping that
//              carries nothing a transcript viewer would show belongs here.
//   candidate— not read, and it probably should be. These stay in the report as
//              a standing backlog: they are known, so they are not *drift*, but
//              they are not settled either.
//
// A shape with no entry is drift: Claude Code started writing something new.
// That is the whole signal this file exists to produce, so resist the urge to
// pre-populate it with guesses — an entry means someone looked.

/** Verdict helpers, so the tables below read as prose. */
const read = by => ({ verdict: 'read', by });
const ignored = reason => ({ verdict: 'ignored', reason });
const candidate = note => ({ verdict: 'candidate', note });

/**
 * Top-level `type` of a `.jsonl` row.
 * Census axis: `rowType`.
 */
export const ROW_TYPES = {
  // ── read ────────────────────────────────────────────────────────────────
  user: read('session-reader'),
  assistant: read('session-reader'),
  'queue-operation': read('transcript-extras'),

  // ── ignored ─────────────────────────────────────────────────────────────
  'atis-latch': ignored('CLI-internal latch for the away-summary feature; no user-visible content'),
  'bridge-session': ignored(
    'links a session to a remote bridge; a transport detail, not transcript content'
  ),
  'artifact-comment-monitor': ignored('bookkeeping for the artifact comment watcher'),
  'artifact-autoreact-ledger': ignored('bookkeeping for artifact auto-replies'),
  'history-suppression': ignored(
    'marks rows the CLI hides from its own history recall; the transcript view shows the rows themselves'
  ),
  'file-history-delta': ignored(
    'incremental companion of file-history-snapshot; superseded by the snapshot'
  ),
  'last-prompt': ignored('duplicate of the most recent user row, kept for the CLI prompt recall'),
  mode: ignored(
    'transient CLI input mode (normal/plan/bash); permission-mode carries the part that matters'
  ),
  'agent-color': ignored('cosmetic: the color the CLI paints a subagent label'),

  // ── candidate ───────────────────────────────────────────────────────────
  system: candidate(
    'subtypes turn_duration/stop_hook_summary/local_command carry per-turn timing and hook output the transcript view has no way to show today'
  ),
  'ai-title': candidate(
    'the model-generated session title; the session list derives its own instead'
  ),
  'custom-title': candidate('a title the user set by hand — should win over the derived one'),
  'permission-mode': candidate(
    'records when a session switched to plan/acceptEdits/bypass; would explain why a turn ran without prompts'
  ),
  'file-history-snapshot': candidate(
    'the file states a session touched; the raw material for a per-session diff view'
  ),
  'agent-name': candidate(
    'names a subagent run; the subagent reader labels from the transcript path instead'
  ),
  'cost-state': candidate(
    "the CLI's own running cost total — a cross-check for cost-tracker's recomputation"
  ),
  relocated: candidate(
    'a project directory that moved; duplicate-detector guesses at this from path shape'
  ),
  'worktree-state': candidate(
    'the worktree a session ran in; would let the session list group by worktree'
  ),
  'pr-link': candidate('a PR the session opened'),
  'frame-link': candidate('a linked frame/artifact URL'),
  'continued-in': candidate(
    'the session that continues this one after a /clear or compaction — the missing edge for a session chain view'
  ),
  attachment: candidate('a wrapper row: see ATTACHMENT_TYPES for the per-subtype verdicts'),
};

/**
 * `attachment.type` of an `attachment` row — the context Claude Code injects
 * around a turn. Census axis: `attachmentType`.
 */
export const ATTACHMENT_TYPES = {
  // ── ignored ─────────────────────────────────────────────────────────────
  total_tokens_reminder: ignored(
    'the per-turn token budget line; noise at transcript scale (10k+ rows)'
  ),
  deferred_tools_delta: ignored(
    'which tool schemas were deferred this turn; an SDK transport detail'
  ),
  deferred_tools_record: ignored('as deferred_tools_delta'),
  agent_listing_delta: ignored(
    'the agent roster injected into the prompt; agents-reader reads the definitions themselves'
  ),
  mcp_instructions_delta: ignored(
    'MCP server instructions injected into the prompt; mcp-reader reads the config'
  ),
  skill_listing: ignored(
    'the skill roster injected into the prompt; skills-reader reads the definitions'
  ),
  auto_mode: ignored('which auto-mode flags were active; a harness detail'),
  date: ignored('the date line injected into the prompt'),
  date_change: ignored('as date'),
  language: ignored('the response-language line injected into the prompt'),
  model: ignored('the model identity line; the assistant rows carry `model` themselves'),
  advisor_tool: ignored('whether the advisor tool was offered this turn'),
  workflow_size_guideline_change: ignored('the workflow size guideline injected into the prompt'),
  instructions: ignored('which CLAUDE.md files were loaded; claude-md-reader reads them directly'),
  command_permissions: ignored('the allowlist a slash command ran under'),
  read_truncation_notice: ignored(
    'a banner saying a Read was truncated; the tool_result shows the truncation'
  ),

  // ── candidate ───────────────────────────────────────────────────────────
  edited_text_file: candidate(
    'filename + snippet of a file the user edited mid-session — a real transcript event with nowhere to show'
  ),
  queued_command: candidate(
    "overlaps transcript-extras' queue-operation pass (#245); may be the better source, and carries commandMode/origin that the queue rows do not"
  ),
  nested_memory: candidate(
    'a nested CLAUDE.md pulled in mid-session; the CLAUDE.md view shows only the static cascade'
  ),
  task_reminder: candidate('the todo list as of a turn — the raw material for a task timeline'),
  environment: candidate(
    'the environment snapshot and its changes (cwd, platform, git branch) per session'
  ),
  session_context: candidate('the session context block and why it changed'),
  prompt_snapshot: candidate(
    'the system prompt and tool list a turn actually ran with — what a "why did it do that" view needs'
  ),
  plan_mode: candidate(
    'plan-mode entry with the plan file path; plans-reader finds plans on disk without the link to the session'
  ),
  plan_mode_exit: candidate('as plan_mode'),
  remote_session_change: candidate(
    'commit/PR/URL of a remote (cloud) session — the only record that a session ran elsewhere'
  ),
  opened_file_in_ide: candidate('IDE context: which file the user had open'),
  selected_lines_in_ide: candidate('IDE context: the lines the user had selected, with content'),
};

/**
 * `type` of a block inside `message.content[]`.
 * Census axis: `contentBlock`. This is the axis that catches the #245/#246
 * class of bug: `parseContentArray` drops an unrecognised block with no
 * signal at all, so a block type that appears here and is not `read` is
 * content missing from the transcript view.
 */
export const CONTENT_BLOCKS = {
  text: read('session-reader/parseContentArray'),
  thinking: read('session-reader/parseContentArray'),
  tool_use: read('session-reader/parseContentArray'),
  tool_result: read('session-reader/parseContentArray'),

  image: candidate(
    'a pasted or screenshotted image in a user message — dropped entirely, so the transcript shows a turn reacting to nothing'
  ),
  server_tool_use: candidate(
    'a server-side tool call (web_search, …); dropped, so the turn shows no tool at all'
  ),
  advisor_tool_result: candidate("the advisor tool's answer; dropped like server_tool_use"),
  redacted_thinking: candidate(
    'encrypted thinking the API returns in place of a thinking block; not yet seen on disk but the API emits it'
  ),
};

/**
 * `subtype` of a `system` row. Census axis: `systemSubtype`.
 * The parent `system` row is itself a candidate; these say what would be in it.
 */
export const SYSTEM_SUBTYPES = {
  turn_duration: candidate('wall-clock duration of a turn'),
  stop_hook_summary: candidate('what a Stop hook printed'),
  away_summary: candidate('the summary written when the user stepped away'),
  local_command: candidate(
    'output of a builtin slash command — the real output session-reader drops the "No response requested." placeholder for'
  ),
  informational: candidate('a CLI notice shown inline'),
  bridge_status: ignored('remote-bridge connection state'),
  model_refusal_fallback: candidate(
    'records that the model refused and the CLI fell back — worth surfacing, it explains an odd turn'
  ),
};

/**
 * Fields of a chat row that carry something, keyed by the dotted key-path the
 * census reports. Census axis: `field` — but a *partial* one, and the only
 * table that is allowed to be incomplete.
 *
 * Enumerating every field of every row by hand would be a second copy of the
 * format, wrong within a week, so the key-path axis is otherwise baseline-only:
 * a field with no entry here is reported once as new and then goes quiet. What
 * this table adds is a place to keep the ones worth keeping — a field we looked
 * at and decided about stays visible in the backlog instead of being absorbed
 * into the baseline and forgotten.
 *
 * Coverage: the census walks the fields of every row type in ROW_TYPES that is
 * not `ignored`, three levels deep. So a field added to a `read` or `candidate`
 * row is caught, and a field added to an `ignored` one is not — which is the
 * intended trade, since `ignored` says we decided the row carries nothing. If
 * you move a row out of `ignored`, its fields start being collected and the
 * next run reports all of them at once.
 */
export const FIELDS = {
  'assistant.message.usage.input_tokens': read('session-reader/parseUsage'),
  'assistant.message.usage.output_tokens': read('session-reader/parseUsage'),
  'assistant.message.usage.cache_read_input_tokens': read('session-reader/parseUsage'),
  'assistant.message.usage.cache_creation_input_tokens': read('session-reader/parseUsage'),
  'assistant.message.model': read('session-reader'),
  'assistant.uuid': read('session-reader'),
  'assistant.timestamp': read('session-reader'),
  'assistant.isSidechain': read('session-reader'),
  'user.isMeta': read('session-reader + transcript-extras'),
  'user.parentUuid': read('transcript-extras'),
  'queue-operation.operation': read('transcript-extras'),
  'queue-operation.content': read('transcript-extras'),
  'queue-operation.timestamp': read('transcript-extras'),

  'assistant.isApiErrorMessage': candidate(
    'the turn failed against the API; the transcript renders it as ordinary assistant prose'
  ),
  'assistant.isAbortedMidStream': candidate(
    'the turn was interrupted mid-stream, so its content is a fragment — worth marking, the way "sent mid-turn" marks an absorbed message'
  ),
  'assistant.truncatedAfterOutput': candidate(
    'output was cut; the transcript shows the fragment as if complete'
  ),
  'assistant.apiErrorStatus': candidate('the HTTP status behind isApiErrorMessage'),
  'assistant.forkedFrom': candidate(
    'session + message this one forked from — the missing edge for a fork/branch view, alongside the continued-in row type'
  ),
  'assistant.supersedesUuids': candidate(
    'messages this row replaces after a rewind; the reader dedupes by uuid only, so a superseded message may still be shown'
  ),
  'assistant.attributionSkill': candidate(
    'which skill produced the turn — the direct signal transcript-extras reconstructs from the "Base directory for this skill" row (#246)'
  ),
  'assistant.attributionAgent': candidate('which subagent produced the turn'),
  'assistant.attributionPlugin': candidate('which plugin produced the turn'),
  'assistant.attributionMcpServer': candidate('which MCP server produced the turn'),
  'assistant.message.stop_reason': candidate(
    'why the turn ended (max_tokens, refusal, tool_use); explains a truncated-looking turn'
  ),
  'assistant.message.context_management': candidate(
    'what the API dropped from context — the compaction record the SDK read truncates at'
  ),
  'assistant.effort': candidate('the reasoning effort a turn ran at'),
  'assistant.slug': candidate("the CLI's short session slug"),
  'assistant.gitBranch': candidate('branch the turn ran on; the session list has no branch column'),
  'assistant.version': candidate(
    'the Claude Code version that wrote the row — the field a drift report should group by'
  ),
  'queue-operation.reason': candidate(
    'absorbed_mid_turn / delivered_to_agent; transcript-extras deliberately ignores it (#245) but it is the only thing distinguishing the two'
  ),
};

/** The census axes, in report order. Each names its table and a label. */
export const AXES = [
  { key: 'rowType', label: 'row type', table: ROW_TYPES },
  { key: 'attachmentType', label: 'attachment.type', table: ATTACHMENT_TYPES },
  { key: 'contentBlock', label: 'message.content[].type', table: CONTENT_BLOCKS },
  { key: 'systemSubtype', label: 'system.subtype', table: SYSTEM_SUBTYPES },
];

/** The key-path axis. Partial by design (see FIELDS), so it is kept out of
 *  `AXES`: the census diffs it against the baseline, not against a table, and
 *  consults `FIELDS` only to decide what belongs in the backlog. */
export const FIELD_AXIS = { key: 'field', label: 'field', table: FIELDS };

/** The verdict recorded for `value` on `axis`, or `undefined` when it is drift. */
export function verdictFor(axisKey, value) {
  const axis = AXES.find(a => a.key === axisKey);
  return axis?.table[value];
}
