// @vitest-environment jsdom
//
// The chip is the whole feature: a citation of a file the project really has
// and a citation of one it does not used to render identically. Four claims,
// and the last two are the ones that keep the feature from leaking:
//
//  - a resolved `[[…]]` is a button carrying the path it found;
//  - an unresolved one is inert and says so, in both the plain and the
//    backticked form Claude actually writes;
//  - a fenced block keeps its brackets — a transcript quoting markdown source
//    is quoting, not citing;
//  - outside a provider nothing is transformed and nothing is asked, which is
//    what keeps the memory views (whose wikilinks point at `~/.claude` topics)
//    from sprouting chips that resolve against the project tree.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import Markdown from '../src/components/Markdown';
import { VaultLinksProvider } from '../src/components/VaultLinks';
import { installFakeElectronAPI, ok, type FakeBridge } from './helpers/fake-electron-api';
import type { VaultLinkAnswer } from '../src/types';

const ROOT = '/Users/tester/Vault';

let bridge: FakeBridge;

beforeEach(() => {
  bridge = installFakeElectronAPI();
});

afterEach(() => {
  cleanup();
  bridge.restore();
});

/** Script the main process: every listed name resolves, everything else misses. */
function resolvesTo(found: Record<string, string>): void {
  bridge.api.vault.resolveLinks.mockImplementation(async (_root: string, targets: string[]) =>
    ok<VaultLinkAnswer[]>(
      targets.map(target =>
        found[target]
          ? { target, rel: found[target], match: 'exact' as const }
          : { target, rel: null, match: null }
      )
    )
  );
}

function inChat(markdown: string) {
  return render(
    <VaultLinksProvider root={ROOT}>
      <Markdown>{markdown}</Markdown>
    </VaultLinksProvider>
  );
}

describe('wikilink chips', () => {
  it('draws a resolved citation as a button carrying the path it found', async () => {
    resolvesTo({ 'Procedura Upload Tesi.pdf': 'Progetti/Laurea/Procedura Upload Tesi.pdf' });
    inChat('Fonte: [[Procedura Upload Tesi.pdf]] in fondo alla nota.');

    const chip = await screen.findByRole('button', { name: 'Procedura Upload Tesi.pdf' });
    expect(chip.className).toContain('cl-wikilink-found');
    expect(chip.getAttribute('title')).toBe('Progetti/Laurea/Procedura Upload Tesi.pdf');

    chip.click();
    expect(bridge.api.vault.openFile).toHaveBeenCalledWith(
      ROOT,
      'Progetti/Laurea/Procedura Upload Tesi.pdf'
    );
  });

  it('draws an unresolved citation as inert, and says why', async () => {
    resolvesTo({});
    inChat('Fonte: [[Nota Inventata]].');

    await waitFor(() => {
      const chip = screen.getByText('Nota Inventata');
      expect(chip.className).toContain('cl-wikilink-missing');
    });
    const chip = screen.getByText('Nota Inventata');
    expect(chip.tagName).toBe('SPAN');
    expect(chip.getAttribute('title')).toMatch(/No file in this project/);
  });

  it('catches the backticked form too — the one in the screenshot', async () => {
    resolvesTo({ 'Domanda di Laurea Delphi': 'Progetti/Domanda di Laurea Delphi.md' });
    inChat('L’upload è sbloccato (`[[Domanda di Laurea Delphi]]`).');

    const chip = await screen.findByRole('button', { name: 'Domanda di Laurea Delphi' });
    expect(chip.className).toContain('cl-wikilink-found');
  });

  it('shows the alias and resolves the target behind it', async () => {
    resolvesTo({ Nota: 'notes/Nota.md' });
    inChat('Vedi [[Nota#Sezione|questa sezione]].');

    const chip = await screen.findByRole('button', { name: 'questa sezione' });
    expect(chip.className).toContain('cl-wikilink-found');
    expect(bridge.api.vault.resolveLinks).toHaveBeenCalledWith(ROOT, ['Nota']);
  });

  it('asks once for a name a message cites twice', async () => {
    resolvesTo({ Nota: 'notes/Nota.md' });
    inChat('[[Nota]] e ancora [[Nota]].');

    await waitFor(() => expect(bridge.api.vault.resolveLinks).toHaveBeenCalledTimes(1));
    expect(bridge.api.vault.resolveLinks).toHaveBeenCalledWith(ROOT, ['Nota']);
    expect(await screen.findAllByRole('button', { name: 'Nota' })).toHaveLength(2);
  });

  it('leaves a fenced block alone', async () => {
    resolvesTo({ Nota: 'notes/Nota.md' });
    const { container } = inChat('```md\nVedi [[Nota]].\n```');

    await waitFor(() => expect(container.querySelector('pre')).not.toBeNull());
    expect(container.querySelector('pre')!.textContent).toContain('[[Nota]]');
    expect(container.querySelector('.cl-wikilink')).toBeNull();
    expect(bridge.api.vault.resolveLinks).not.toHaveBeenCalled();
  });

  it('does not say a file is missing when the lookup itself failed', async () => {
    bridge.api.vault.resolveLinks.mockResolvedValue({ data: null, error: 'nope' });
    const { container } = inChat('Fonte: [[Nota]].');

    await waitFor(() => expect(container.querySelector('.cl-wikilink-idle')).not.toBeNull());
    expect(container.querySelector('.cl-wikilink-missing')).toBeNull();
  });

  it('asks again about a name that was missing, once the answer could have changed', async () => {
    // Claude cites a note before writing it — the normal order in a session
    // that works with its own vault. A permanent "already asked" latch would
    // have kept that chip dashed for the life of the view.
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    resolvesTo({});
    const { rerender } = inChat('Fonte: [[Nota]].');
    await waitFor(() => expect(screen.getByText('Nota').className).toContain('missing'));

    // The note now exists, and a later message cites it again.
    resolvesTo({ Nota: 'notes/Nota.md' });
    clock.mockReturnValue(1_000_000 + 31_000);
    rerender(
      <VaultLinksProvider root={ROOT}>
        <Markdown>{'Ancora [[Nota]], stavolta scritta.'}</Markdown>
      </VaultLinksProvider>
    );

    const chip = await screen.findByRole('button', { name: 'Nota' });
    expect(chip.className).toContain('cl-wikilink-found');
    expect(bridge.api.vault.resolveLinks).toHaveBeenCalledTimes(2);
    clock.mockRestore();
  });

  it('does not ask again about a name it already found', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    resolvesTo({ Nota: 'notes/Nota.md' });
    const { rerender } = inChat('[[Nota]] uno.');
    await screen.findByRole('button', { name: 'Nota' });

    clock.mockReturnValue(1_000_000 + 10 * 60_000);
    rerender(
      <VaultLinksProvider root={ROOT}>
        <Markdown>{'[[Nota]] due.'}</Markdown>
      </VaultLinksProvider>
    );

    await screen.findByRole('button', { name: 'Nota' });
    expect(bridge.api.vault.resolveLinks).toHaveBeenCalledTimes(1);
    clock.mockRestore();
  });

  it('renders plain text outside a provider, and asks nothing', () => {
    const { container } = render(<Markdown>{'Fonte: [[Nota]].'}</Markdown>);
    expect(container.textContent).toContain('[[Nota]]');
    expect(container.querySelector('.cl-wikilink')).toBeNull();
    expect(bridge.api.vault.resolveLinks).not.toHaveBeenCalled();
  });
});
