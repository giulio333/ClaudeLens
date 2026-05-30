import {
  buildProcessedMessages,
  stripAnsi,
  parseClaudeSlashCommand,
  parseLocalCommandOutput,
  parseAskUserQuestions,
  parseAnswersFromResultText,
} from '../src/components/project/chat/utils';
import { ChatMessage, ChatContentBlock } from '../src/types';

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

  it('returns null for unknown XML command', () => {
    expect(parseClaudeSlashCommand('<command-name>/nope</command-name>')).toBeNull();
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
