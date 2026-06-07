import {
  buildProcessedMessages,
  correlateSessionAgents,
  correlateSessionSkills,
  skillInitial,
  stripAnsi,
  parseClaudeSlashCommand,
  parseLocalCommandOutput,
  parseAskUserQuestions,
  parseAnswersFromResultText,
  isQuestionDismissed,
} from '../src/components/project/chat/utils';
import { ChatMessage, ChatContentBlock, SubagentMeta, Skill } from '../src/types';

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

  it('parses plain textual "/cmd args" format', () => {
    const result = parseClaudeSlashCommand('/model opus');
    expect(result).toEqual({
      command: 'model',
      args: 'opus',
      description: 'Select or change the AI model',
    });
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
      msg('assistant', [toolUse('t1', 'Task', { subagent_type: 'Explore', description: 'find X', prompt: 'Search the workspace for foo' })]),
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
    const head = 'Commit the changes in /Users/me/Projects/Repo. The working tree has several staged files ready now';
    const dispatchPrompt = head + '.\n\nFull status:\n- a.ts\n- b.ts\n- c.ts';
    const storedPrompt = head + '. Full status: - a.ts - b.ts'; // truncated tail, same prefix
    const processed = buildProcessedMessages([
      msg('assistant', [toolUse('t1', 'Task', { subagent_type: 'git-committer', prompt: dispatchPrompt })]),
      msg('user', [toolResult('t1', 'done')]),
    ]);
    const agents = correlateSessionAgents(processed, [meta({ agentId: 'aGit', firstPrompt: storedPrompt })]);
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

  it('leaves agentId null when no transcript file matches', () => {
    const processed = buildProcessedMessages([
      msg('assistant', [toolUse('t1', 'Task', { subagent_type: 'Explore', prompt: 'orphan dispatch' })]),
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
    const skills = correlateSessionSkills(processed, [skillDef('build-dmg', { description: 'Builds the DMG', scope: 'project' })]);
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
});
