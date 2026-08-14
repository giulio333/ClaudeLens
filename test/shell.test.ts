import { describe, expect, it } from 'vitest';
import {
  parseShellCommand,
  splitPipeline,
  normalizeOutput,
  promptRows,
  ownsToolBody,
  ownsOutputHead,
  isShellOutput,
} from '../src/components/project/chat/shell';

/** Convenience: the statement texts of a parsed one-liner. */
function steps(command: string): string[] {
  const parsed = parseShellCommand(command);
  if (parsed.mode !== 'steps') throw new Error('expected steps mode');
  return parsed.steps.map(s => s.parts.join(' | '));
}

function ops(command: string): string[] {
  const parsed = parseShellCommand(command);
  if (parsed.mode !== 'steps') throw new Error('expected steps mode');
  return parsed.steps.map(s => s.op);
}

describe('parseShellCommand — statement splitting', () => {
  it('cuts a `;`-chained one-liner into one step per statement', () => {
    // The command that motivated the rewrite: rendered as a single paragraph it
    // was unreadable; as five steps it tells its own story.
    const cmd =
      'echo "=== LOG GRAFANA ==="; oc logs -n sara-monitoring deploy/grafana --tail=30 2>&1; echo; echo "=== OPERATOR ==="; oc get pod -n sara-monitoring 2>&1';
    expect(steps(cmd)).toEqual([
      'echo "=== LOG GRAFANA ==="',
      'oc logs -n sara-monitoring deploy/grafana --tail=30 2>&1',
      'echo',
      'echo "=== OPERATOR ==="',
      'oc get pod -n sara-monitoring 2>&1',
    ]);
  });

  it('keeps `2>&1`, `>&2` and `&>log` intact — they are redirections, not a background job', () => {
    expect(steps('cmd 2>&1')).toEqual(['cmd 2>&1']);
    expect(steps('echo boom >&2')).toEqual(['echo boom >&2']);
    expect(steps('build &> out.log')).toEqual(['build &> out.log']);
  });

  it('reads a real trailing `&` as a backgrounded step', () => {
    expect(steps('server start & tail -f log')).toEqual(['server start', 'tail -f log']);
    expect(ops('server start & tail -f log')).toEqual(['&', '']);
  });

  it('records the joining operator so causality stays visible', () => {
    expect(ops('a && b || c; d')).toEqual(['&&', '||', ';', '']);
    expect(steps('a && b || c; d')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('never cuts inside quotes', () => {
    expect(steps(`echo 'one; two && three'`)).toEqual([`echo 'one; two && three'`]);
    expect(steps('echo "semi; colon"; ls')).toEqual(['echo "semi; colon"', 'ls']);
    expect(steps('echo `date; hostname`')).toEqual(['echo `date; hostname`']);
  });

  it('never cuts inside `$(…)` or a brace group', () => {
    expect(steps('echo $(hostname; date)')).toEqual(['echo $(hostname; date)']);
    expect(steps('{ a; b; }')).toEqual(['{ a; b; }']);
  });

  it('keeps a jsonpath expression whole (braces and escapes live inside quotes)', () => {
    const cmd = `oc get pod -o jsonpath='{range .items[*]}{.metadata.name}{"\\n"}{end}' 2>&1`;
    expect(steps(cmd)).toEqual([cmd]);
  });

  it('is empty for an empty command', () => {
    expect(steps('')).toEqual([]);
    expect(steps('   ')).toEqual([]);
  });
});

describe('parseShellCommand — pipelines', () => {
  it('leaves a short pipeline on one line', () => {
    const parsed = parseShellCommand('ls | wc -l');
    expect(parsed.mode === 'steps' && parsed.steps[0].parts).toEqual(['ls | wc -l']);
  });

  it('breaks a long pipeline into its stages', () => {
    const cmd =
      'oc get pod -n sara-monitoring -l control-plane=controller-manager -o name 2>&1 | head -20';
    const parsed = parseShellCommand(cmd);
    expect(parsed.mode === 'steps' && parsed.steps[0].parts).toEqual([
      'oc get pod -n sara-monitoring -l control-plane=controller-manager -o name 2>&1',
      'head -20',
    ]);
  });

  it('splits pipes at top level only', () => {
    expect(splitPipeline(`awk '{print $1 | "sort"}' file | wc -l`)).toEqual([
      `awk '{print $1 | "sort"}' file`,
      'wc -l',
    ]);
    // `|&` pipes stderr too: consumed as one operator, no stray `&` left behind.
    expect(splitPipeline('make |& tee log')).toEqual(['make', 'tee log']);
  });
});

describe('parseShellCommand — script mode', () => {
  it('keeps an already-formatted multi-line command verbatim', () => {
    const src = 'if [ -f a ]; then\n  echo yes\nfi';
    const parsed = parseShellCommand(src);
    expect(parsed).toEqual({ mode: 'script', source: src, lines: 3 });
  });

  it('never cuts through a heredoc', () => {
    const src = `cat <<'EOF' > f.txt; echo done`;
    expect(parseShellCommand(src).mode).toBe('script');
  });

  it('drops trailing whitespace but keeps the body', () => {
    const parsed = parseShellCommand('line1\nline2\n\n');
    expect(parsed).toEqual({ mode: 'script', source: 'line1\nline2', lines: 2 });
  });
});

describe('normalizeOutput', () => {
  it('strips ANSI colour sequences', () => {
    expect(normalizeOutput('\u001B[32mPASS\u001B[0m tests')).toBe('PASS tests');
  });

  it('strips OSC sequences (window titles) too', () => {
    expect(normalizeOutput('\u001B]0;title\u0007done')).toBe('done');
  });

  it('collapses a carriage-return rewrite to what the terminal would show', () => {
    expect(normalizeOutput('10%\r50%\r100% done\nnext')).toBe('100% done\nnext');
    expect(normalizeOutput('a\r\nb\r\n')).toBe('a\nb');
  });

  it('leaves plain output alone', () => {
    expect(normalizeOutput('  indented\n\tline')).toBe('  indented\n\tline');
  });
});

describe('promptRows — how a run is laid out for reading', () => {
  const leads = (cmd: string) => promptRows(cmd).map(r => r.lead);

  it('shows exactly ONE prompt: the command was typed at one prompt', () => {
    // The regression this encodes: a `❯` per statement invented six prompts for
    // a run that had one, which is a lie about how the command was invoked.
    const cmd = 'cd /tmp && rg -o pat file.jsonl | head -1; echo done && ls';
    expect(promptRows(cmd).filter(r => r.lead === '\u276f')).toHaveLength(1);
    expect(promptRows(cmd)[0].lead).toBe('\u276f');
  });

  it('opens each line with the connective that governs it, never trailing', () => {
    expect(leads('a && b')).toEqual(['\u276f', '&&']);
    expect(leads('a || b')).toEqual(['\u276f', '||']);
    // ...and the operator is not left dangling at the end of the line before.
    expect(promptRows('a && b')[0]).toEqual({ lead: '\u276f', code: 'a' });
  });

  it('prints nothing for `;` — to the shell it is the line break itself', () => {
    expect(leads('a; b; c')).toEqual(['\u276f', '', '']);
  });

  it('keeps `&` a suffix of the line it backgrounds', () => {
    const rows = promptRows('server start & tail -f log');
    expect(rows[0]).toEqual({ lead: '\u276f', code: 'server start', suffix: '&' });
    expect(rows[1].lead).toBe('');
  });

  it('marks broken-out pipeline stages with a pipe', () => {
    const cmd =
      'oc get pod -n sara-monitoring -l control-plane=controller-manager -o name 2>&1 | head -20';
    expect(leads(cmd)).toEqual(['\u276f', '|']);
  });

  it('keeps a multi-line script line by line, indentation intact', () => {
    const rows = promptRows('if [ -f a ]; then\n  echo yes\nfi');
    expect(rows.map(r => r.lead)).toEqual(['\u276f', '', '']);
    expect(rows[1].code).toBe('  echo yes');
  });

  it('is empty for an empty command (the caller renders its own note)', () => {
    expect(promptRows('  ')).toEqual([]);
  });
});

describe('section ownership', () => {
  it('gives Bash the whole body (one unit) and BashOutput just the result side', () => {
    expect(ownsToolBody('Bash')).toBe(true);
    expect(ownsToolBody('BashOutput')).toBe(false);
    expect(ownsOutputHead('BashOutput')).toBe(true);
    // A tool that owns its body owns its result head too — the host must never
    // print a "Result" title above a sheet that already labels its output.
    expect(ownsOutputHead('Bash')).toBe(true);
    expect(ownsToolBody('Read')).toBe(false);
    expect(ownsOutputHead('Read')).toBe(false);
    // A WebSearch result opens with its own SOURCES head, so the host's "Output"
    // would be a second title for one block — but it is not shell output.
    expect(ownsOutputHead('WebSearch')).toBe(true);
    expect(isShellOutput('WebSearch')).toBe(false);
    expect(isShellOutput('BashOutput')).toBe(true);
  });
});
