// @vitest-environment jsdom
//
// The terminal window is the one tool rendering that has to survive arbitrary
// user shell input, so the render path gets its own test on top of the pure
// splitter (`shell.test.ts`): a prompt row per statement, no duplicated
// description in the inline chip, command and output in ONE window, a status
// strip that tells the truth about the run, and a fullscreen escape hatch.

import { describe, it, expect, afterEach } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import {
  CommandBlock,
  CommandOutput,
  CommandSheet,
} from '../src/components/project/chat/CommandBlock';

afterEach(cleanup);

const CHAINED = 'echo "=== LOG ==="; oc logs -n mon deploy/grafana --tail=30 2>&1 && echo done';

function leads(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.cl-term-lead')].map(n => n.textContent ?? '');
}

/** A tool_result as `buildProcessedMessages` pairs it onto its tool_use. */
function res(content: string, isError = false) {
  return { type: 'tool_result' as const, toolUseId: 'toolu_1', content, isError };
}

const longOutput = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n');

/** Built at runtime: a literal ESC byte in a source file is invisible in an
 *  editor and gets eaten by tooling on the way in (see source-control-chars). */
const ESC = String.fromCharCode(27);

describe('CommandBlock (command only)', () => {
  it('opens the run with one prompt and leads each line with its connective', () => {
    const { container } = render(
      <CommandBlock input={{ command: CHAINED }} showDescription={false} />
    );
    // One prompt (there was one), `;` silent, `&&` opening the line it governs.
    expect(leads(container)).toEqual(['❯', '', '&&']);
    expect(container.querySelector('.cl-term-lead.is-flow')?.textContent).toBe('&&');
    // The command text survives highlighting verbatim.
    expect(container.textContent).toContain('oc logs -n mon deploy/grafana --tail=30 2>&1');
    expect(screen.getByText('3 steps')).toBeTruthy();
  });

  it('marks a broken-out pipeline stage with a pipe glyph, not a second prompt', () => {
    const { container } = render(
      <CommandBlock
        input={{
          command:
            'oc get pod -n sara-monitoring -l control-plane=controller-manager -o name 2>&1 | head -20',
        }}
        showDescription={false}
      />
    );
    expect(leads(container)).toEqual(['❯', '|']);
  });

  it('titles the window `bash` inline and with the description in the full views', () => {
    const input = { command: 'ls', description: 'List the project files' };
    const inline = render(<CommandBlock input={input} showDescription={false} />);
    // The chip header above already shows the description — repeating it here
    // would print the same sentence twice.
    expect(inline.container.textContent).not.toContain('List the project files');
    expect(inline.container.querySelector('.cl-term-title b')?.textContent).toBe('bash');
    cleanup();
    const detail = render(<CommandBlock input={input} showDescription />);
    expect(detail.container.querySelector('.cl-term-title b')?.textContent).toBe(
      'List the project files'
    );
  });

  it('carries the flags that changed how the command ran in the title meta', () => {
    const { container } = render(
      <CommandBlock
        input={{ command: 'npm run dev', run_in_background: true, timeout: 120000 }}
        showDescription={false}
      />
    );
    expect(container.querySelector('.cl-term-title .meta')?.textContent).toBe(
      'background · timeout 120s'
    );
  });

  it('has no status strip before the command has run (nothing true to report)', () => {
    const { container } = render(
      <CommandBlock input={{ command: 'rm -rf build' }} showDescription />
    );
    expect(container.querySelector('.cl-term-foot')).toBeNull();
    expect(container.querySelector('.cl-term-out')).toBeNull();
  });
});

describe('CommandSheet', () => {
  it('renders the command and its output inside one window', () => {
    const { container } = render(
      <CommandSheet
        input={{ command: 'ls -la' }}
        result={res('total 0')}
        showCommand
        showDescription={false}
      />
    );
    expect(container.querySelectorAll('.cl-term')).toHaveLength(1);
    expect(container.querySelectorAll('.cl-term-bar')).toHaveLength(1);
    const body = container.querySelector('.cl-term-body');
    expect(body?.querySelector('.cl-term-line')).toBeTruthy();
    expect(body?.querySelector('.cl-term-out')?.textContent).toBe('total 0');
    expect(container.querySelector('.cl-term-state')?.textContent).toContain('1 line');
  });

  it('carries the output alone in MIN density (tool inputs hidden)', () => {
    const { container } = render(
      <CommandSheet
        input={{ command: 'ls -la' }}
        result={res('total 0')}
        showCommand={false}
        showDescription={false}
      />
    );
    expect(container.querySelector('.cl-term-line')).toBeNull();
    expect(container.querySelector('.cl-term-out')).toBeTruthy();
  });

  it('opens fullscreen with the output unclamped, and closes on Escape', () => {
    const { container } = render(
      <CommandSheet
        input={{ command: 'ls -la', description: 'List files' }}
        result={res(longOutput)}
        showCommand
        showDescription={false}
      />
    );
    expect(container.querySelector('.cl-term-body.is-clamped')).toBeTruthy();

    act(() => screen.getByRole('button', { name: 'Open fullscreen' }).click());
    const modal = document.querySelector('.cl-term-modal');
    expect(modal).toBeTruthy();
    expect(modal?.querySelector('.cl-term.is-full')).toBeTruthy();
    // Fullscreen keeps the command for context and shows the whole output.
    expect(modal?.textContent).toContain('ls -la');
    expect(modal?.textContent).toContain('line 40');
    expect(modal?.querySelector('.cl-term-body.is-clamped')).toBeNull();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(document.querySelector('.cl-term-modal')).toBeNull();
  });

  it('says a command is still running instead of showing an empty output frame', () => {
    const { container } = render(
      <CommandSheet input={{ command: 'sleep 5' }} result={null} showCommand showDescription />
    );
    expect(screen.getByText('still running — no result recorded yet')).toBeTruthy();
    expect(container.querySelector('.cl-term-state')?.textContent).toContain('running');
  });
});

describe('CommandOutput (BashOutput)', () => {
  it('clamps long output and says how many lines there are in total', () => {
    const { container } = render(<CommandOutput result={res(longOutput)} />);
    expect(container.querySelector('.cl-term-state')?.textContent).toContain('40 lines');
    expect(container.querySelector('.cl-term-body.is-clamped')).toBeTruthy();
    expect(container.textContent).toContain('line 22');
    expect(container.textContent).not.toContain('line 23');
    act(() => screen.getByRole('button', { name: 'Show all 40 lines' }).click());
    expect(container.textContent).toContain('line 40');
    expect(container.querySelector('.cl-term-body.is-clamped')).toBeNull();
  });

  it('strips ANSI escapes so a coloured build log reads as text', () => {
    const { container } = render(
      <CommandOutput result={res(`${ESC}[32mPASS${ESC}[0m 12 tests`)} />
    );
    expect(container.textContent).toContain('PASS 12 tests');
    expect(container.textContent).not.toContain(`${ESC}[32m`);
  });

  it('marks a failed run in the window and its status strip', () => {
    const { container } = render(<CommandOutput result={res('command not found: oc', true)} />);
    expect(container.querySelector('.cl-term.is-error')).toBeTruthy();
    expect(container.querySelector('.cl-term-state.is-error')).toBeTruthy();
  });

  it('says a command finished with no output instead of showing an empty frame', () => {
    render(<CommandOutput result={res('')} />);
    expect(screen.getByText('completed with no output')).toBeTruthy();
  });
});
