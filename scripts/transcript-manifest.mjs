// What ClaudeLens knows about Claude Code's transcript format.
//
// This file is the census oracle: `transcript-census.mjs` diffs the shapes it
// finds in `~/.claude/projects/**/*.jsonl` against the decisions recorded here,
// and reports only what neither side accounts for. It is hand-maintained on
// purpose — grepping the source for a row type produces false positives
// everywhere (`'user'` is a chat role, an IPC namespace and a directory name),
// so "do we read this?" is a decision a human makes once and writes down.
//
// A shape that appears here has been looked at. It gets one of four verdicts:
//
//   read     — a module consumes it. `by` names the module, so a report can say
//              where a changed field would land.
//   ignored  — deliberately not read, with the reason. Harness bookkeeping that
//              carries nothing a transcript viewer would show belongs here.
//   candidate— not read, and it probably should be. These stay in the report as
//              a standing backlog: they are known, so they are not *drift*, but
//              they are not settled either.
//   unknown  — looked at, and the rows did not say enough to decide. Say what
//              you saw and what would settle it.
//
// `unknown` exists because the first three forced a choice between guessing and
// letting a finding return identically forever. A shape whose only evidence is
// its name and an opaque payload is not `ignored` — every `ignored` above names
// what the thing *is*, and none of them says "it had no fields". Nor is it a
// `candidate`, which claims the app could use it. Recording it as `unknown`
// stops it being re-reported as fresh drift while keeping it visible as an open
// question, which is what it actually is.
//
// A shape with no entry at all is drift: Claude Code started writing something
// new. That is the whole signal this file exists to produce, so resist the urge
// to pre-populate it with guesses — an entry means someone looked.

/** Verdict helpers, so the tables below read as prose. */
const read = by => ({ verdict: 'read', by });
const ignored = reason => ({ verdict: 'ignored', reason });
const candidate = note => ({ verdict: 'candidate', note });
/**
 * Looked at, not decidable. `note` says what was seen and what would settle it.
 *
 * Exported, unlike its three siblings, because no undecidable shape is on record
 * yet — the tables below use the other three. The export is what keeps it from
 * reading as dead code, and it lets the test that pins the verdict's behaviour
 * build one with this helper instead of hand-rolling the shape.
 */
export const unknown = note => ({ verdict: 'unknown', note });

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

  // Not a row type Claude Code writes — the census's own name for a
  // `subagents/agent-*.meta.json`, which is one flat object per sub-agent run
  // rather than a stream of rows. It sits in ROW_TYPES so its fields get walked
  // and triaged like everything else.
  'agent-meta': candidate(
    'the sub-agent sidecar. `teams-reader` reads it, but only when taskKind is "in_process_teammate" — 1 of the 35 on disk; for the rest nothing reads it at all. See FIELDS for agentType'
  ),
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

  // The `Agent` tool's result when the dispatch is a *named teammate* rather
  // than an anonymous sub-agent (`status: 'teammate_spawned'`). One row in the
  // corpus so far — the spawn that launched the drift check that first saw it —
  // but every team run writes this shape, so it is triaged now rather than
  // absorbed into the baseline.
  'user.toolUseResult.team_name': candidate(
    'the team a spawn belongs to; teams-reader only ever sees a team name inside a message tag, so nothing today links a dispatch to the team run it was part of'
  ),
  'user.toolUseResult.agent_id': candidate(
    'the addressable `<name>@<team>` teammate id, in the same form teams-reader parses out of message tags — the spawn row is where it is declared. Note it does NOT key the `subagents/agent-*.jsonl` sidecar, whose own key is a separate `<name>-<hex>` slug'
  ),
  'user.toolUseResult.teammate_id': candidate(
    'held the identical value to agent_id in the one row observed; kept separate until a row shows them diverge'
  ),

  'user.toolUseResult.agent_type': ignored(
    "duplicates the dispatch input's `subagent_type`, which is what the renderer already reads (MessageBubble.tsx, ToolGroupCard.tsx, session-tails.ts)"
  ),
  'user.toolUseResult.model': ignored(
    "teams-reader already reads `model` from the teammate's `agent-*.meta.json` sidecar, and the spawned agent's own rows carry `message.model` — this is the third copy"
  ),
  'user.toolUseResult.color': ignored(
    "teams-reader already reads `color` from the teammate's `agent-*.meta.json` sidecar; the chat view resolves its own agent colors from `subagent_type` (MessageBubble.tsx:532)"
  ),
  'user.toolUseResult.plan_mode_required': ignored(
    'spawn-time configuration of the agent definition, readable from the definition itself; the `permission-mode` row type is what records the mode a session actually ran in'
  ),
  'user.toolUseResult.is_splitpane': ignored(
    'terminal layout bookkeeping — where the teammate is displayed, not what it did'
  ),
  'user.toolUseResult.tmux_session_name': ignored(
    'terminal layout bookkeeping; `"in-process"` for an in-process teammate, a real tmux name only when one backs it'
  ),
  'agent-meta.agentType': candidate(
    'the sub-agent\'s readable type ("Explore", "general-purpose", …), present in all 35 sidecars on disk since 2026-08-22 and read by nothing. subagents-reader reconstructs the same fact indirectly and its header comment (lines 14-20) still claims it "is NOT in the subagent file" and must be matched by prompt prefix — which is doubly stale, since the code itself already joins on parent_tool_use_id (line 166). Reading this field would replace an inference with a fact; the comment needs correcting either way'
  ),
  'agent-meta.toolUseId': candidate(
    'the parent tool_use this sidecar belongs to — the same join subagents-reader makes from the transcript side, available here directly'
  ),
  'agent-meta.spawnDepth': candidate(
    'how deep a nested spawn is; would let a sub-agent tree be shown as a tree'
  ),
  'agent-meta.description': ignored(
    "the dispatch's own description, already on the parent's tool_use input"
  ),
  'agent-meta.type': ignored(
    'synthetic — the census stamps the `agent-meta` row type onto these objects itself, since the files carry no type field of their own'
  ),

  // The rest appear only on a *teammate* spawn: 1-2 of the 35 sidecars on disk,
  // so the shape is thinly observed and these verdicts are provisional.
  'agent-meta.teamName': candidate(
    'the team a sub-agent run belonged to; the same gap as user.toolUseResult.team_name, from the sidecar side'
  ),
  'agent-meta.parentAgentId': candidate(
    'the spawning agent — with spawnDepth, the other half of a sub-agent tree'
  ),
  'agent-meta.taskKind': candidate(
    'what kind of dispatch this was; it is the field teams-reader gates on, so it decides whether the sidecar is read at all'
  ),
  'agent-meta.permissionMode': candidate(
    'the mode the sub-agent ran under — the per-agent counterpart of the permission-mode row'
  ),
  'agent-meta.model': ignored("the sub-agent's own transcript rows carry message.model"),
  'agent-meta.name': ignored(
    'the teammate name, also the addressable id in toolUseResult.agent_id'
  ),
  'agent-meta.color': ignored('CLI label colour; the app resolves its own from the agent type'),
  'agent-meta.planModeRequired': ignored(
    'spawn-time configuration, readable from the agent definition'
  ),
  'agent-meta.requestShape': ignored('SDK request bookkeeping'),
  'agent-meta.requestNonInteractive': ignored('SDK request bookkeeping'),

  'user.toolUseResult.tmux_window_name': ignored('as tmux_session_name'),
  'user.toolUseResult.tmux_pane_id': ignored('as tmux_session_name'),
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
