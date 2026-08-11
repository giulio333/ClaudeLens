import {
  buildProcessedMessages,
  buildRenderItems,
  buildRenderRows,
  buildRowIndexByTurn,
  computeFilterCounts,
  correlateSessionAgents,
  correlateSessionSkills,
  describeTurn,
  skillInitial,
  skillHasViewableOutput,
  isSkillLaunchOutput,
  stripAnsi,
  parseClaudeSlashCommand,
  parseLocalCommandOutput,
  parseAskUserQuestions,
  parseAnswersFromResultText,
  isQuestionDismissed,
  isMemoryFile,
  buildMemoryActivity,
  memoryScopeOf,
  memoryTypeFromFilename,
  memoryTitleFromFilename,
  writeAction,
  touchedFiles,
} from '../src/components/project/chat/utils';
import { ChatMessage, ChatContentBlock, SubagentMeta, Skill, InstalledPlugin } from '../src/types';

// ---- fixture helpers ----

let uuidCounter = 0;
function msg(role: 'user' | 'assistant', content: ChatContentBlock[]): ChatMessage {
  return {
    uuid: `uuid-${uuidCounter++}`,
    role,
    timestamp: '2026-05-30T00:00:00.000Z',
    content,
  };
}

const text = (t: string): ChatContentBlock => ({ type: 'text', text: t });
const toolUse = (
  id: string,
  name: string,
  input: Record<string, unknown> = {}
): ChatContentBlock => ({ type: 'tool_use', id, name, input });
const toolResult = (toolUseId: string, content: string, isError = false): ChatContentBlock => ({
  type: 'tool_result',
  toolUseId,
  content,
  isError,
});

describe('buildProcessedMessages', () => {
  it('matches tool_use to tool_result by id into a ToolGroup', () => {
    const messages = [
      msg('assistant', [text('Running a tool'), toolUse('t1', 'Bash', { command: 'ls' })]),
      msg('user', [toolResult('t1', 'file.txt')]),
    ];
    const processed = buildProcessedMessages(messages);
    // The tool-only user message is absorbed, leaving just the assistant msg
    expect(processed).toHaveLength(1);
    expect(processed[0].toolGroups).toHaveLength(1);
    expect(processed[0].toolGroups[0].use.id).toBe('t1');
    expect(processed[0].toolGroups[0].result).not.toBeNull();
    expect(processed[0].toolGroups[0].result?.content).toBe('file.txt');
  });

  it('absorbs tool-only user messages into preceding assistant message (drops them)', () => {
    const messages = [
      msg('assistant', [toolUse('t1', 'Read')]),
      msg('user', [toolResult('t1', 'data')]),
      msg('assistant', [text('Done')]),
    ];
    const processed = buildProcessedMessages(messages);
    expect(processed.map(p => p.msg.role)).toEqual(['assistant', 'assistant']);
  });

  it('leaves result null when no matching tool_result follows', () => {
    const messages = [msg('assistant', [toolUse('t1', 'Glob')]), msg('assistant', [text('next')])];
    const processed = buildProcessedMessages(messages);
    expect(processed).toHaveLength(2);
    expect(processed[0].toolGroups[0].result).toBeNull();
  });

  it('matches multiple tool_use blocks to their respective results by id', () => {
    const messages = [
      msg('assistant', [toolUse('a', 'Read'), toolUse('b', 'Write')]),
      msg('user', [toolResult('b', 'wrote'), toolResult('a', 'read')]),
    ];
    const processed = buildProcessedMessages(messages);
    expect(processed).toHaveLength(1);
    const groups = processed[0].toolGroups;
    expect(groups.find(g => g.use.id === 'a')?.result?.content).toBe('read');
    expect(groups.find(g => g.use.id === 'b')?.result?.content).toBe('wrote');
  });

  it('matches parallel agents written as separate assistant lines with out-of-order results', () => {
    // Repro of the real-world bug: Claude Code writes each parallel Agent
    // tool_use on its own assistant line and each tool_result on its own user
    // line, often in a different order. Matching only the immediately-next
    // message left every agent with result=null ("No result available").
    const messages = [
      msg('assistant', [toolUse('a', 'Agent', { description: 'Explore A' })]),
      msg('assistant', [toolUse('b', 'Agent', { description: 'Explore B' })]),
      msg('assistant', [toolUse('c', 'Agent', { description: 'Explore C' })]),
      msg('user', [toolResult('b', 'result B')]),
      msg('user', [toolResult('a', 'result A')]),
      msg('user', [toolResult('c', 'result C')]),
    ];
    const processed = buildProcessedMessages(messages);
    // The three tool-only user messages are absorbed, leaving the 3 assistant msgs
    expect(processed).toHaveLength(3);
    const groupFor = (id: string) =>
      processed.flatMap(p => p.toolGroups).find(g => g.use.id === id);
    expect(groupFor('a')?.result?.content).toBe('result A');
    expect(groupFor('b')?.result?.content).toBe('result B');
    expect(groupFor('c')?.result?.content).toBe('result C');
  });

  it('keeps plain user/assistant messages with no tools (empty toolGroups)', () => {
    const messages = [msg('user', [text('Hello')]), msg('assistant', [text('Hi there')])];
    const processed = buildProcessedMessages(messages);
    expect(processed).toHaveLength(2);
    expect(processed[0].toolGroups).toEqual([]);
    expect(processed[1].toolGroups).toEqual([]);
  });

  it('recognizes a Claude slash command in a user message', () => {
    const messages = [msg('user', [text('<command-name>/cost</command-name>')])];
    const processed = buildProcessedMessages(messages);
    expect(processed).toHaveLength(1);
    expect(processed[0].command).toBeDefined();
    expect(processed[0].command?.command).toBe('cost');
  });

  it('absorbs a following local-command-stdout into the preceding command output', () => {
    const messages = [
      msg('user', [text('<command-name>/cost</command-name>')]),
      msg('user', [text('<local-command-stdout>Total: $1.23</local-command-stdout>')]),
    ];
    const processed = buildProcessedMessages(messages);
    expect(processed).toHaveLength(1);
    expect(processed[0].command?.output).toBe('Total: $1.23');
  });

  it('passes an orphan local-command-stdout through as a normal message', () => {
    const messages = [msg('user', [text('<local-command-stdout>orphan</local-command-stdout>')])];
    const processed = buildProcessedMessages(messages);
    // No preceding command -> not absorbed, stays as a message (no command set)
    expect(processed).toHaveLength(1);
    expect(processed[0].command).toBeUndefined();
  });

  it('returns empty array for empty input', () => {
    expect(buildProcessedMessages([])).toEqual([]);
  });
});

describe('stripAnsi', () => {
  it('removes ANSI color escape codes', () => {
    const input = '\x1b[1mBold\x1b[22m and \x1b[31mred\x1b[0m';
    expect(stripAnsi(input)).toBe('Bold and red');
  });

  it('leaves plain text untouched', () => {
    expect(stripAnsi('just text')).toBe('just text');
  });

  it('handles empty string', () => {
    expect(stripAnsi('')).toBe('');
  });
});

describe('parseClaudeSlashCommand', () => {
  it('parses the XML command flow with args', () => {
    const result = parseClaudeSlashCommand(
      '<command-name>/compact</command-name><command-args>focus on tests</command-args>'
    );
    expect(result).toEqual({
      command: 'compact',
      args: 'focus on tests',
      description: 'Compact conversation with optional focus instructions',
    });
  });

  it('parses the XML command flow without args', () => {
    const result = parseClaudeSlashCommand('<command-name>cost</command-name>');
    expect(result).toEqual({
      command: 'cost',
      args: '',
      description: 'Show token usage statistics',
    });
  });

  it('lowercases the command name from XML', () => {
    const result = parseClaudeSlashCommand('<command-name>/CLEAR</command-name>');
    expect(result?.command).toBe('clear');
  });

  it('falls back to a generic description for unknown XML commands', () => {
    // Il framing XML è inequivocabile: trattalo come comando anche se non è noto,
    // così il testo grezzo non trapela mai nella chat (es. /exit, /clear).
    const result = parseClaudeSlashCommand('<command-name>/nope</command-name>');
    expect(result).toEqual({
      command: 'nope',
      args: '',
      description: 'Claude Code command',
    });
  });

  it('recognizes /exit as a known command', () => {
    const result = parseClaudeSlashCommand('<command-name>/exit</command-name>');
    expect(result?.command).toBe('exit');
    expect(result?.description).toBe('End the current session');
  });

  it('does not treat plain "/cmd words..." as a command — it is user prose (#92)', () => {
    // Without XML framing, "/clear the cache" / "/help me debug" are sentences a
    // user typed, not slash commands. Real command args always arrive via XML.
    expect(parseClaudeSlashCommand('/clear the cache')).toBeNull();
    expect(parseClaudeSlashCommand('/help me debug this')).toBeNull();
    expect(parseClaudeSlashCommand('/model opus')).toBeNull();
  });

  it('parses plain textual command without args', () => {
    const result = parseClaudeSlashCommand('/help');
    expect(result).toEqual({
      command: 'help',
      args: '',
      description: 'Get usage help',
    });
  });

  it('returns null for unknown plain command', () => {
    expect(parseClaudeSlashCommand('/unknowncmd')).toBeNull();
  });

  it('returns null for non-command text', () => {
    expect(parseClaudeSlashCommand('this is just a message')).toBeNull();
  });
});

describe('parseLocalCommandOutput', () => {
  it('extracts the stdout tag content and strips ANSI', () => {
    const result = parseLocalCommandOutput(
      '<local-command-stdout>\x1b[32mok\x1b[0m</local-command-stdout>'
    );
    expect(result).toBe('ok');
  });

  it('trims surrounding whitespace', () => {
    const result = parseLocalCommandOutput(
      '  <local-command-stdout>  padded  </local-command-stdout>  '
    );
    expect(result).toBe('padded');
  });

  it('normalizes the "(no content)" placeholder to an empty string', () => {
    expect(
      parseLocalCommandOutput('<local-command-stdout>(no content)</local-command-stdout>')
    ).toBe('');
  });

  it('returns null when text is not pure stdout', () => {
    expect(parseLocalCommandOutput('hello world')).toBeNull();
    expect(
      parseLocalCommandOutput('prefix <local-command-stdout>x</local-command-stdout>')
    ).toBeNull();
  });
});

describe('parseAskUserQuestions', () => {
  it('parses structured questions with options', () => {
    const input = {
      questions: [
        {
          question: 'Pick a color',
          header: 'Color',
          multiSelect: false,
          options: [{ label: 'Red', description: 'warm' }, { label: 'Blue' }],
        },
      ],
    };
    const result = parseAskUserQuestions(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      question: 'Pick a color',
      header: 'Color',
      multiSelect: false,
      options: [
        { label: 'Red', description: 'warm' },
        { label: 'Blue', description: undefined },
      ],
    });
  });

  it('skips entries without a question string', () => {
    const input = {
      questions: [
        { question: '', options: [] },
        { foo: 'bar' },
        { question: 'Valid?', options: [] },
      ],
    };
    const result = parseAskUserQuestions(input);
    expect(result).toHaveLength(1);
    expect(result[0].question).toBe('Valid?');
  });

  it('coerces multiSelect to boolean and defaults header to undefined', () => {
    const input = { questions: [{ question: 'Q', multiSelect: 1 }] };
    const result = parseAskUserQuestions(input);
    expect(result[0].multiSelect).toBe(true);
    expect(result[0].header).toBeUndefined();
    expect(result[0].options).toEqual([]);
  });

  it('returns empty array when questions is missing or not an array', () => {
    expect(parseAskUserQuestions({})).toEqual([]);
    expect(parseAskUserQuestions({ questions: 'nope' })).toEqual([]);
  });
});

describe('parseAnswersFromResultText', () => {
  it('extracts "Q"="A" pairs into a record', () => {
    const result = parseAnswersFromResultText(
      'Your questions have been answered: "Color"="Red", "Size"="Large".'
    );
    expect(result).toEqual({ Color: 'Red', Size: 'Large' });
  });

  it('returns empty object for empty input', () => {
    expect(parseAnswersFromResultText('')).toEqual({});
  });
});

describe('isQuestionDismissed', () => {
  it('detects a rejected AskUserQuestion result (user kept talking)', () => {
    const text =
      "The user doesn't want to proceed with this tool use. The tool use was rejected " +
      '(eg. if it was a file edit, the new_string was NOT written to the file).\n' +
      'Questions asked:\n- "Cosa deve fare il clic?"\n  (No answer provided)';
    expect(isQuestionDismissed(text)).toBe(true);
  });

  it('detects the "(No answer provided)" marker alone', () => {
    expect(isQuestionDismissed('Questions asked:\n- "Q"\n  (No answer provided)')).toBe(true);
  });

  it('returns false for an answered result and empty input', () => {
    expect(isQuestionDismissed('Your questions have been answered: "Color"="Red".')).toBe(false);
    expect(isQuestionDismissed('')).toBe(false);
  });
});

describe('correlateSessionAgents', () => {
  const meta = (overrides: Partial<SubagentMeta>): SubagentMeta => ({
    agentId: 'a1',
    filePath: '/x/agent-a1.jsonl',
    firstPrompt: '',
    startedAt: '2026-05-30T00:00:00.000Z',
    endedAt: '2026-05-30T00:01:00.000Z',
    messageCount: 5,
    ...overrides,
  });

  it('links a Task dispatch to its transcript by prompt prefix', () => {
    const processed = buildProcessedMessages([
      msg('assistant', [
        toolUse('t1', 'Task', {
          subagent_type: 'Explore',
          description: 'find X',
          prompt: 'Search the workspace for foo',
        }),
      ]),
      msg('user', [toolResult('t1', 'found it')]),
    ]);
    const metas = [meta({ agentId: 'aExplore', firstPrompt: 'Search the workspace for foo' })];
    const agents = correlateSessionAgents(processed, metas);
    expect(agents).toHaveLength(1);
    expect(agents[0].subagentType).toBe('Explore');
    expect(agents[0].agentId).toBe('aExplore');
    expect(agents[0].turnN).toBe(1);
    expect(agents[0].isError).toBe(false);
  });

  it('matches across whitespace differences and reader truncation', () => {
    // The dispatch prompt carries raw newlines; the stored firstPrompt is the
    // same text the reader sliced to 400 chars. Only the first 100 chars (after
    // whitespace normalization) need to agree — and here they do.
    const head =
      'Commit the changes in /Users/me/Projects/Repo. The working tree has several staged files ready now';
    const dispatchPrompt = head + '.\n\nFull status:\n- a.ts\n- b.ts\n- c.ts';
    const storedPrompt = head + '. Full status: - a.ts - b.ts'; // truncated tail, same prefix
    const processed = buildProcessedMessages([
      msg('assistant', [
        toolUse('t1', 'Task', { subagent_type: 'git-committer', prompt: dispatchPrompt }),
      ]),
      msg('user', [toolResult('t1', 'done')]),
    ]);
    const agents = correlateSessionAgents(processed, [
      meta({ agentId: 'aGit', firstPrompt: storedPrompt }),
    ]);
    expect(agents[0].agentId).toBe('aGit');
  });

  it('disambiguates identical prompts by chronological order', () => {
    const p = 'Run the same task twice';
    const processed = buildProcessedMessages([
      msg('assistant', [toolUse('t1', 'Task', { subagent_type: 'Explore', prompt: p })]),
      msg('user', [toolResult('t1', 'a')]),
      msg('assistant', [toolUse('t2', 'Task', { subagent_type: 'Explore', prompt: p })]),
      msg('user', [toolResult('t2', 'b')]),
    ]);
    const metas = [
      meta({ agentId: 'first', firstPrompt: p }),
      meta({ agentId: 'second', firstPrompt: p }),
    ];
    const agents = correlateSessionAgents(processed, metas);
    expect(agents.map(a => a.agentId)).toEqual(['first', 'second']);
  });

  it('does not mis-attribute a transcript that only shares a long common preamble', () => {
    // A shared preamble longer than the retired 100-char key, then a divergent
    // tail. The old key collapsed both to the same 100 chars and would attach
    // this unrelated transcript to the dispatch; the 400-char key keeps them apart.
    const shared = 'Investigate the checkout regression. '.repeat(4).trim(); // ~147 chars
    const promptA = `${shared} Look at the PAYMENT service logs.`;
    const promptB = `${shared} Look at the SHIPPING service logs.`;
    const processed = buildProcessedMessages([
      msg('assistant', [toolUse('t1', 'Task', { subagent_type: 'Explore', prompt: promptA })]),
      msg('user', [toolResult('t1', 'ok')]),
    ]);
    // Only B's transcript exists — it must NOT be claimed by A's dispatch.
    const agents = correlateSessionAgents(processed, [
      meta({ agentId: 'bravo', firstPrompt: promptB }),
    ]);
    expect(agents[0].agentId).toBeNull();
  });

  it('disambiguates identical prompts by startedAt even when metas arrive out of order', () => {
    const p = 'Run the shared task';
    const processed = buildProcessedMessages([
      msg('assistant', [toolUse('t1', 'Task', { subagent_type: 'Explore', prompt: p })]),
      msg('user', [toolResult('t1', 'a')]),
      msg('assistant', [toolUse('t2', 'Task', { subagent_type: 'Explore', prompt: p })]),
      msg('user', [toolResult('t2', 'b')]),
    ]);
    // Metas handed in REVERSE chronological order: the later transcript first.
    const metas = [
      meta({ agentId: 'later', firstPrompt: p, startedAt: '2026-05-30T00:05:00.000Z' }),
      meta({ agentId: 'earlier', firstPrompt: p, startedAt: '2026-05-30T00:01:00.000Z' }),
    ];
    // First dispatch → earliest-started transcript, regardless of arrival order.
    const agents = correlateSessionAgents(processed, metas);
    expect(agents.map(a => a.agentId)).toEqual(['earlier', 'later']);
  });

  it('leaves agentId null when no transcript file matches', () => {
    const processed = buildProcessedMessages([
      msg('assistant', [
        toolUse('t1', 'Task', { subagent_type: 'Explore', prompt: 'orphan dispatch' }),
      ]),
      msg('user', [toolResult('t1', 'ok')]),
    ]);
    const agents = correlateSessionAgents(processed, []);
    expect(agents[0].agentId).toBeNull();
    expect(agents[0].subagentType).toBe('Explore');
  });

  it('propagates the error state from the dispatch tool_result', () => {
    const processed = buildProcessedMessages([
      msg('assistant', [toolUse('t1', 'Task', { subagent_type: 'Explore', prompt: 'boom' })]),
      msg('user', [toolResult('t1', 'failure', true)]),
    ]);
    const agents = correlateSessionAgents(processed, []);
    expect(agents[0].isError).toBe(true);
  });

  it('ignores non-agent tools', () => {
    const processed = buildProcessedMessages([
      msg('assistant', [toolUse('t1', 'Bash', { command: 'ls' })]),
      msg('user', [toolResult('t1', 'out')]),
    ]);
    expect(correlateSessionAgents(processed, [])).toHaveLength(0);
  });

  // ── runState: backgrounded vs synchronous lifecycle ──
  // The harness writes "Async agent launched…" as a backgrounded dispatch's
  // tool_result (just an ack), then reports completion later via a separate
  // <task-notification> carrying the dispatch's tool-use-id.
  const taskNotification = (toolUseId: string, status: string) =>
    text(
      `<task-notification>\n<task-id>job-${toolUseId}</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<status>${status}</status>\n<summary>Agent "x" finished</summary>\n</task-notification>`
    );

  it('marks a synchronous agent done from its result', () => {
    const processed = buildProcessedMessages([
      msg('assistant', [toolUse('t1', 'Task', { subagent_type: 'Explore', prompt: 'sync' })]),
      msg('user', [toolResult('t1', 'here is the answer')]),
    ]);
    expect(correlateSessionAgents(processed, [])[0].runState).toBe('done');
  });

  it('keeps a backgrounded agent running until its completion notification arrives', () => {
    const processed = buildProcessedMessages([
      msg('assistant', [toolUse('t1', 'Task', { subagent_type: 'Explore', prompt: 'bg' })]),
      msg('user', [toolResult('t1', 'Async agent launched successfully.\nagentId: job-t1')]),
    ]);
    expect(correlateSessionAgents(processed, [])[0].runState).toBe('running');
  });

  it('flips a backgrounded agent to done when its task-notification lands', () => {
    const processed = buildProcessedMessages([
      msg('assistant', [toolUse('t1', 'Task', { subagent_type: 'Explore', prompt: 'bg' })]),
      msg('user', [toolResult('t1', 'Async agent launched successfully.')]),
      msg('user', [taskNotification('t1', 'completed')]),
    ]);
    const a = correlateSessionAgents(processed, [])[0];
    expect(a.runState).toBe('done');
    expect(a.isError).toBe(false);
  });

  it('flips a backgrounded agent to failed on a failed task-notification', () => {
    const processed = buildProcessedMessages([
      msg('assistant', [toolUse('t1', 'Task', { subagent_type: 'Explore', prompt: 'bg' })]),
      msg('user', [toolResult('t1', 'Async agent launched successfully.')]),
      msg('user', [taskNotification('t1', 'failed')]),
    ]);
    const a = correlateSessionAgents(processed, [])[0];
    expect(a.runState).toBe('failed');
    expect(a.isError).toBe(true);
  });

  it('matches the completion to the right dispatch by tool-use-id', () => {
    const processed = buildProcessedMessages([
      msg('assistant', [toolUse('t1', 'Task', { subagent_type: 'Explore', prompt: 'first' })]),
      msg('user', [toolResult('t1', 'Async agent launched successfully.')]),
      msg('assistant', [toolUse('t2', 'Task', { subagent_type: 'Explore', prompt: 'second' })]),
      msg('user', [toolResult('t2', 'Async agent launched successfully.')]),
      // only the first one has finished
      msg('user', [taskNotification('t1', 'completed')]),
    ]);
    const agents = correlateSessionAgents(processed, []);
    expect(agents.map(a => a.runState)).toEqual(['done', 'running']);
  });
});

// Skill expansion message Claude Code injects right after a skill slash command.
const skillExpansion = (name: string) =>
  text(`Base directory for this skill: /Users/x/.claude/skills/${name}\n\nDo the thing.`);

const skillDef = (name: string, extra: Partial<Skill> = {}): Skill => ({
  name,
  path: `/Users/x/.claude/skills/${name}/SKILL.md`,
  scope: 'project',
  content: '',
  rawContent: '',
  ...extra,
});

const pluginDef = (name: string, skills: Skill[]): InstalledPlugin => ({
  name,
  marketplace: 'mkt',
  scope: 'user',
  version: '1.0.0',
  installPath: `/Users/x/.claude/plugins/${name}`,
  skills,
  agents: [],
  commands: [],
});

// An agentic skill invocation: the model's `Skill` tool_use + its tool_result.
const agenticSkillGroup = (skillName: string, output: string | null, isError = false) => {
  const processed = buildProcessedMessages([
    msg('assistant', [toolUse('skill-1', 'Skill', { skill: skillName })]),
    ...(output !== null ? [msg('user', [toolResult('skill-1', output, isError)])] : []),
  ]);
  return correlateSessionSkills(processed, [])[0].group;
};

describe('parseClaudeSlashCommand — namespaced (plugin) skills', () => {
  it('recognizes a namespaced skill command (colon in name)', () => {
    const result = parseClaudeSlashCommand('<command-name>/document-skills:pdf</command-name>');
    expect(result?.command).toBe('document-skills:pdf');
  });

  it('does not treat an unknown plain-text namespaced command as a command', () => {
    // The plain textual branch only recognizes known built-ins (to avoid turning
    // arbitrary "/foo" prose into a command); skills always arrive via the XML
    // <command-name> framing, which IS recognized above.
    expect(parseClaudeSlashCommand('/document-skills:pdf')).toBeNull();
  });
});

describe('skill detection in buildProcessedMessages', () => {
  it('flags a slash command followed by the skill-expansion message as a skill', () => {
    const processed = buildProcessedMessages([
      msg('user', [text('<command-name>/build-dmg</command-name>')]),
      msg('user', [skillExpansion('build-dmg')]),
    ]);
    expect(processed[0].command?.isSkill).toBe(true);
  });

  it('does not flag a plain command not followed by a skill expansion', () => {
    const processed = buildProcessedMessages([
      msg('user', [text('<command-name>/clear</command-name>')]),
      msg('user', [text('hello')]),
    ]);
    expect(processed[0].command?.isSkill).toBeFalsy();
  });
});

describe('skillInitial', () => {
  it('takes the first letter, uppercased', () => {
    expect(skillInitial('build-dmg')).toBe('B');
  });
  it('strips a plugin namespace and uses the skill segment', () => {
    expect(skillInitial('document-skills:pdf')).toBe('P');
  });
});

describe('correlateSessionSkills', () => {
  it('collects a flagged skill and links it to its definition by name', () => {
    const processed = buildProcessedMessages([
      msg('user', [text('<command-name>/build-dmg</command-name>')]),
      msg('user', [skillExpansion('build-dmg')]),
    ]);
    const skills = correlateSessionSkills(processed, [
      skillDef('build-dmg', { description: 'Builds the DMG', scope: 'project' }),
    ]);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('build-dmg');
    expect(skills[0].description).toBe('Builds the DMG');
    expect(skills[0].scope).toBe('project');
    expect(skills[0].skill).not.toBeNull();
    expect(skills[0].turnN).toBe(1);
  });

  it('collects a skill known by name even without the expansion message', () => {
    const processed = buildProcessedMessages([
      msg('user', [text('<command-name>/arch-analysis</command-name>')]),
      msg('user', [text('regular follow-up')]),
    ]);
    const skills = correlateSessionSkills(processed, [skillDef('arch-analysis')]);
    expect(skills).toHaveLength(1);
    expect(skills[0].skill).not.toBeNull();
  });

  it('includes a flagged skill with no local definition (skill: null)', () => {
    const processed = buildProcessedMessages([
      msg('user', [text('<command-name>/document-skills:pdf</command-name>')]),
      msg('user', [skillExpansion('document-skills/pdf')]),
    ]);
    const skills = correlateSessionSkills(processed, []);
    expect(skills).toHaveLength(1);
    expect(skills[0].skill).toBeNull();
  });

  it('ignores plain commands that are neither flagged nor known skills', () => {
    const processed = buildProcessedMessages([
      msg('user', [text('<command-name>/clear</command-name>')]),
      msg('user', [text('hello')]),
    ]);
    expect(correlateSessionSkills(processed, [])).toHaveLength(0);
  });

  it('resolves a namespaced agentic skill against installed plugins', () => {
    const processed = buildProcessedMessages([
      msg('assistant', [toolUse('skill-1', 'Skill', { skill: 'document-skills:pdf' })]),
      msg('user', [toolResult('skill-1', 'Launching skill: document-skills:pdf')]),
    ]);
    const plugins = [
      pluginDef('document-skills', [
        skillDef('pdf', { scope: 'plugin', description: 'PDF tools' }),
      ]),
    ];
    const skills = correlateSessionSkills(processed, [], plugins);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('document-skills:pdf');
    expect(skills[0].skill).not.toBeNull();
    expect(skills[0].skill?.scope).toBe('plugin');
    expect(skills[0].scope).toBe('plugin');
    expect(skills[0].group).toBeDefined();
  });

  it('keeps skill null for a namespaced skill with no matching plugin', () => {
    const processed = buildProcessedMessages([
      msg('assistant', [toolUse('skill-1', 'Skill', { skill: 'document-skills:pdf' })]),
      msg('user', [toolResult('skill-1', 'Launching skill: document-skills:pdf')]),
    ]);
    expect(correlateSessionSkills(processed, [])[0].skill).toBeNull();
  });
});

describe('buildRenderItems', () => {
  it('folds a minimal-mode tool-only run into the preceding assistant turn', () => {
    const processed = buildProcessedMessages([
      msg('assistant', [text('Working on it')]),
      msg('assistant', [toolUse('t1', 'Bash', { command: 'ls' })]),
      msg('user', [toolResult('t1', 'out')]),
    ]);
    const descriptors = processed.map(p => describeTurn(p, 'minimal'));
    const items = buildRenderItems(processed, descriptors);
    // The tool-only turn collapses into the assistant turn's "tools hidden" chip.
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'turn', idx: 0, hiddenCount: 1 });
  });

  it('keeps a leading tool-only run as a standalone badge', () => {
    const processed = buildProcessedMessages([
      msg('assistant', [toolUse('t1', 'Read', { file_path: '/a.ts' })]),
      msg('user', [toolResult('t1', 'data')]),
    ]);
    const descriptors = processed.map(p => describeTurn(p, 'minimal'));
    const items = buildRenderItems(processed, descriptors);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'tools', count: 1 });
    // The touched file is carried on the badge for the file chips.
    expect(items[0].kind === 'tools' && items[0].files.map(f => f.path)).toEqual(['/a.ts']);
  });

  it('renders tool turns as their own rows in full mode (no folding)', () => {
    const processed = buildProcessedMessages([
      msg('assistant', [text('Working on it')]),
      msg('assistant', [toolUse('t1', 'Bash', { command: 'ls' })]),
      msg('user', [toolResult('t1', 'out')]),
    ]);
    const descriptors = processed.map(p => describeTurn(p, 'all'));
    const items = buildRenderItems(processed, descriptors);
    expect(items.map(i => i.kind)).toEqual(['turn', 'turn']);
  });
});

describe('buildRenderRows', () => {
  // The windowed transcript renders each row from its index alone, so every
  // flag that used to be derived by walking neighbours in render order has to
  // be resolved here — a mounted predecessor is no longer guaranteed.
  const rowsFor = (messages: ChatMessage[], filter: 'minimal' | 'all' = 'all') => {
    const processed = buildProcessedMessages(messages);
    const descriptors = processed.map(p => describeTurn(p, filter));
    return buildRenderRows(processed, buildRenderItems(processed, descriptors));
  };

  it('marks a text-less assistant turn following another assistant turn as a continuation', () => {
    const rows = rowsFor([
      msg('assistant', [text('First half')]),
      msg('assistant', [toolUse('t1', 'Bash', { command: 'ls' })]),
      msg('user', [toolResult('t1', 'out')]),
    ]);
    expect(rows.map(r => r.isContinuation)).toEqual([false, true]);
  });

  it('breaks the continuation after a turn that folded a tool run', () => {
    const rows = rowsFor(
      [
        msg('assistant', [text('First')]),
        msg('assistant', [toolUse('t1', 'Bash', { command: 'ls' })]),
        msg('user', [toolResult('t1', 'out')]),
        msg('assistant', [toolUse('t2', 'Read', { file_path: '/a.ts' })]),
        msg('user', [toolResult('t2', 'body')]),
      ],
      'minimal'
    );
    // Minimal mode folds both tool turns into the assistant turn's chip, so the
    // single remaining row can't be a continuation of anything.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ turnN: 1, isContinuation: false });
  });

  it('never marks a user turn as a continuation', () => {
    const rows = rowsFor([
      msg('assistant', [text('Answer')]),
      msg('user', [text('Follow-up')]),
      msg('assistant', [text('Second answer')]),
    ]);
    expect(rows.map(r => r.isContinuation)).toEqual([false, false, false]);
  });

  it('gives a collapsed tool run no turn number, and keys every row uniquely', () => {
    const rows = rowsFor(
      [
        msg('assistant', [toolUse('t1', 'Read', { file_path: '/a.ts' })]),
        msg('user', [toolResult('t1', 'body')]),
        msg('assistant', [text('Done')]),
      ],
      'minimal'
    );
    expect(rows.map(r => r.turnN)).toEqual([null, 2]);
    expect(new Set(rows.map(r => r.key)).size).toBe(rows.length);
  });

  it('indexes turn numbers back to their row', () => {
    const rows = rowsFor(
      [
        msg('assistant', [toolUse('t1', 'Read', { file_path: '/a.ts' })]),
        msg('user', [toolResult('t1', 'body')]),
        msg('assistant', [text('Done')]),
      ],
      'minimal'
    );
    const byTurn = buildRowIndexByTurn(rows);
    // Turn 2 is the second row (the collapsed tool badge sits above it).
    expect(byTurn.get(2)).toBe(1);
    expect(byTurn.has(1)).toBe(false);
  });

  it('returns nothing for an empty transcript', () => {
    expect(buildRenderRows([], [])).toEqual([]);
    expect(buildRowIndexByTurn([]).size).toBe(0);
  });
});

describe('computeFilterCounts', () => {
  it('counts visible turns by type', () => {
    const processed = buildProcessedMessages([
      msg('user', [text('hello')]),
      msg('assistant', [text('hi'), toolUse('t1', 'Bash', { command: 'ls' })]),
      msg('user', [toolResult('t1', 'out')]),
    ]);
    const visible = processed.map(p => describeTurn(p, 'all')).filter(d => d.visible);
    const counts = computeFilterCounts(visible);
    expect(counts.all).toBe(2);
    expect(counts.tools).toBe(1);
    expect(counts.thinking).toBe(0);
    expect(counts.questions).toBe(0);
    expect(counts.plan).toBe(0);
  });
});

describe('isSkillLaunchOutput', () => {
  it('is true for the bare "Launching skill: …" sentinel', () => {
    expect(isSkillLaunchOutput('Launching skill: document-skills:pdf')).toBe(true);
    expect(isSkillLaunchOutput('  Launching skill: x')).toBe(true);
  });
  it('is false for a real result, an empty string, or null', () => {
    expect(isSkillLaunchOutput('Skill "pdf" completed.\n\nResult:\n# Analysis')).toBe(false);
    expect(isSkillLaunchOutput('')).toBe(false);
    expect(isSkillLaunchOutput(null)).toBe(false);
    expect(isSkillLaunchOutput(undefined)).toBe(false);
  });
});

describe('skillHasViewableOutput', () => {
  it('is false for a launch-only output (nothing worth opening)', () => {
    expect(
      skillHasViewableOutput(
        agenticSkillGroup('document-skills:pdf', 'Launching skill: document-skills:pdf')
      )
    ).toBe(false);
  });
  it('is true for a real completed result', () => {
    expect(
      skillHasViewableOutput(
        agenticSkillGroup('a:b', 'Skill "b" completed.\n\nResult:\n# Analysis')
      )
    ).toBe(true);
  });
  it('is true for an error result', () => {
    expect(skillHasViewableOutput(agenticSkillGroup('a:b', 'boom', true))).toBe(true);
  });
  it('is false when the run is still pending (no result)', () => {
    expect(skillHasViewableOutput(agenticSkillGroup('a:b', null))).toBe(false);
  });
});

describe('isMemoryFile', () => {
  it('recognises the project-level memory dir', () => {
    expect(isMemoryFile({ file_path: '/Users/t/app/.claude/memory/decisions.md' })).toBe(true);
  });

  it('recognises the user-level memory dir under the project history folder', () => {
    expect(isMemoryFile({ file_path: '/Users/t/.claude/projects/-Users-t-app/memory/x.md' })).toBe(
      true
    );
  });

  it('recognises a topic nested below the memory dir', () => {
    expect(isMemoryFile({ file_path: '/Users/t/app/.claude/memory/sub/topic.md' })).toBe(true);
  });

  it('normalizes Windows separators', () => {
    expect(isMemoryFile({ file_path: 'C:\\Users\\t\\app\\.claude\\memory\\notes.md' })).toBe(true);
  });

  // The old check was `includes('/.claude/') && includes('/memory/')`, so any
  // path with a `memory` segment anywhere under `.claude` was dressed up as a
  // memory operation — violet tint, M monogram, "Memory operation" subtitle.
  it('rejects an unrelated .claude path that merely has a memory segment', () => {
    expect(isMemoryFile({ file_path: '/Users/t/.claude/skills/memory/SKILL.md' })).toBe(false);
    expect(isMemoryFile({ file_path: '/Users/t/.claude/agents/memory/keeper.md' })).toBe(false);
  });

  it('rejects a memory dir outside .claude, and an input with no path', () => {
    expect(isMemoryFile({ file_path: '/Users/t/app/src/memory/store.ts' })).toBe(false);
    expect(isMemoryFile({})).toBe(false);
  });
});

describe('touchedFiles', () => {
  const group = (name: string, input: Record<string, unknown>) => ({
    use: { id: 't', name, input },
    result: null,
  });

  it('collects the files of every file-oriented tool, deduped and in order', () => {
    const files = touchedFiles([
      group('Read', { file_path: '/a/one.ts' }),
      group('Write', { file_path: '/a/two.tsx' }),
      group('Read', { file_path: '/a/one.ts' }),
      group('Bash', { command: 'ls' }),
    ] as never);
    expect(files.map(f => f.path)).toEqual(['/a/one.ts', '/a/two.tsx']);
    expect(files.map(f => f.ext)).toEqual(['ts', 'tsx']);
  });

  // MultiEdit carries a file_path and mutates it (MissionRail counts it among
  // EDIT_TOOLS), but it was missing here — so a turn made only of MultiEdits
  // showed no file chips at all in the minimal turn footer.
  it('counts MultiEdit as a file tool', () => {
    const files = touchedFiles([
      group('MultiEdit', { file_path: '/a/three.py', edits: [] }),
    ] as never);
    expect(files.map(f => f.path)).toEqual(['/a/three.py']);
  });
});

describe('memory activity', () => {
  const MEM = '/Users/t/.claude/projects/-Users-t-app/memory';
  const op = (name: string, input: Record<string, unknown>, result?: string, isError = false) => ({
    use: { id: `t-${name}-${input.file_path}`, name, input },
    result:
      result === undefined
        ? null
        : { type: 'tool_result', toolUseId: 't', content: result, isError },
  });
  const frontmatter = (name: string, description: string, type: string, body = 'the fact') =>
    `---\nname: ${name}\ndescription: ${description}\nmetadata:\n  type: ${type}\n---\n\n${body}\n`;

  it('reads scope from the two memory dirs and nothing else', () => {
    expect(memoryScopeOf(`${MEM}/x.md`)).toBe('user');
    expect(memoryScopeOf('/Users/t/app/.claude/memory/x.md')).toBe('project');
    expect(memoryScopeOf('/Users/t/.claude/skills/memory/SKILL.md')).toBeNull();
  });

  it('derives type and title from the filename when frontmatter is absent', () => {
    expect(memoryTypeFromFilename('feedback_no_manual_app_launch.md')).toBe('feedback');
    expect(memoryTypeFromFilename('reference_icloud.md')).toBe('reference');
    expect(memoryTypeFromFilename('project_x.md')).toBe('project');
    expect(memoryTypeFromFilename('plain_note.md')).toBe('user');
    expect(memoryTitleFromFilename(`${MEM}/feedback_no_manual_app_launch.md`)).toBe(
      'no-manual-app-launch'
    );
  });

  // The wording of the Write result is the only place that says whether the file
  // existed; when it doesn't say, neither do we.
  it('distinguishes a created topic from an overwritten one via the tool result', () => {
    expect(writeAction(`File created successfully at: ${MEM}/x.md`)).toBe('new');
    expect(writeAction(`The file ${MEM}/x.md has been updated successfully.`)).toBe('revised');
    expect(writeAction(null)).toBe('wrote');
    expect(writeAction('something else entirely')).toBe('wrote');
  });

  it('groups the Write + MEMORY.md Edit pair into one topic plus an index op', () => {
    const { touches, indexOps } = buildMemoryActivity([
      op(
        'Write',
        {
          file_path: `${MEM}/feedback_no_manual_app_launch.md`,
          content: frontmatter(
            'no-manual-app-launch',
            'Non lanciare l app manualmente',
            'feedback'
          ),
        },
        `File created successfully at: ${MEM}/feedback_no_manual_app_launch.md`
      ),
      op('Edit', { file_path: `${MEM}/MEMORY.md`, old_string: 'a', new_string: 'b' }, 'updated'),
    ] as never);

    expect(touches).toHaveLength(1);
    expect(touches[0]).toMatchObject({
      title: 'no-manual-app-launch',
      type: 'feedback',
      scope: 'user',
      description: 'Non lanciare l app manualmente',
      action: 'new',
      writes: 1,
      reads: 0,
    });
    expect(indexOps).toHaveLength(1);
  });

  it('keeps a read-only topic, and lets the on-disk index name an Edit', () => {
    const lookup = (path: string) =>
      path.endsWith('reference_icloud.md')
        ? {
            name: 'icloud-dataless-files',
            description: 'File dataless stallano',
            type: 'reference' as const,
          }
        : undefined;
    const { touches } = buildMemoryActivity(
      [
        op('Read', { file_path: `${MEM}/project_x.md` }, 'body'),
        op(
          'Edit',
          { file_path: `${MEM}/reference_icloud.md`, old_string: 'a', new_string: 'b' },
          'ok'
        ),
        op(
          'Edit',
          { file_path: `${MEM}/reference_icloud.md`, old_string: 'c', new_string: 'd' },
          'ok'
        ),
      ] as never,
      lookup
    );

    // Mutated topics float first, read-only ones follow.
    expect(touches.map(t => t.title)).toEqual(['icloud-dataless-files', 'x']);
    expect(touches[0]).toMatchObject({
      action: 'revised',
      writes: 2,
      description: 'File dataless stallano',
    });
    expect(touches[1]).toMatchObject({ action: 'read', reads: 1, writes: 0 });
  });

  it('ranks a create above later revisions of the same topic, and flags failures', () => {
    const { touches } = buildMemoryActivity([
      op(
        'Write',
        { file_path: `${MEM}/user_me.md`, content: 'no frontmatter' },
        `File created successfully at: ${MEM}/user_me.md`
      ),
      op('Edit', { file_path: `${MEM}/user_me.md` }, 'String not found', true),
    ] as never);
    expect(touches[0]).toMatchObject({ action: 'new', writes: 2, hasError: true });
  });

  it('ignores tools outside the memory dirs and tools with no path', () => {
    const { touches, indexOps } = buildMemoryActivity([
      op('Write', { file_path: '/Users/t/app/src/index.ts', content: 'x' }, 'created'),
      op('Bash', { command: `rm ${MEM}/user_me.md` }, ''),
    ] as never);
    expect(touches).toEqual([]);
    expect(indexOps).toEqual([]);
  });
});
