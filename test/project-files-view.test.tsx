// @vitest-environment jsdom
//
// The project's Files section. The claims: the tree reads a folder only when
// it is opened; a file is drawn by what it is — code numbered in the editor
// window, markdown as its document with the source a click away, a raster
// image as the picture, SVG as source and never rendered — and a file the
// window does not draw says so and opens in its own app.

import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { ProjectDirEntry, ProjectFileAnswer } from '../src/types';
import { ProjectFilesSection } from '../src/components/project/files/ProjectFilesSection';
import { installFakeElectronAPI, ok, type FakeBridge } from './helpers/fake-electron-api';

const ROOT = '/w/acme';

const file = (rel: string, size = 10): ProjectDirEntry => {
  const name = rel.split('/').pop()!;
  const dot = name.lastIndexOf('.');
  return { name, rel, kind: 'file', ext: dot > 0 ? name.slice(dot + 1) : '', size };
};
const dir = (rel: string): ProjectDirEntry => ({
  name: rel.split('/').pop()!,
  rel,
  kind: 'dir',
  ext: '',
});

const TREE: Record<string, ProjectDirEntry[]> = {
  '': [
    dir('src'),
    file('README.md'),
    file('logo.png'),
    file('icon.svg'),
    file('data.bin'),
    file('spec.pdf'),
  ],
  src: [file('src/main.ts')],
};

const FILES: Record<string, ProjectFileAnswer> = {
  'README.md': { status: 'ok', text: '# Acme\n\nA tool.\n', bytes: 17 },
  'icon.svg': { status: 'ok', text: '<svg><script>x()</script></svg>\n', bytes: 32 },
  'data.bin': { status: 'binary', bytes: 2048 },
  'src/main.ts': { status: 'ok', text: 'const a = 1;\nexport { a };\n', bytes: 27 },
};

let bridge: FakeBridge;
let client: QueryClient;

beforeEach(() => {
  bridge = installFakeElectronAPI();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  bridge.api.files.listDir.mockImplementation(async (_root: string, rel: string) =>
    ok({ entries: TREE[rel] ?? [], truncated: false })
  );
  bridge.api.files.readText.mockImplementation(async (_root: string, rel: string) =>
    ok(FILES[rel] ?? ({ status: 'missing' } as ProjectFileAnswer))
  );
  bridge.api.images.read.mockResolvedValue(
    ok({ status: 'ok', dataUri: 'data:image/png;base64,AAAA', bytes: 3 })
  );
});

afterEach(() => {
  cleanup();
  client.clear();
  bridge.restore();
});

function mount() {
  return render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <ProjectFilesSection project={{ hash: '-w-acme', realPath: ROOT }} />
      </QueryClientProvider>
    </StrictMode>
  );
}

const row = (name: string) => screen.findByRole('button', { name: new RegExp(`^${name}`) });

it('tints a file by its family, and leaves a name with no family quiet', async () => {
  mount();
  const lead = (row: HTMLElement) => row.querySelector<HTMLElement>('.lead')!;
  const readme = lead(await row('README.md'));
  expect(readme.style.color).toBe('var(--cl-accent)');
  expect(readme.querySelector('svg')).toBeTruthy();
  const bin = lead(await row('data.bin'));
  expect(bin.style.color).toBe('');
  expect(bin.querySelector('svg')).toBeNull();
  fireEvent.click(await row('src'));
  expect(lead(await row('main.ts')).style.color).toBe('var(--cl-violet)');
});

it('reads a folder only when it is opened', async () => {
  mount();
  await row('README.md');
  expect(bridge.api.files.listDir).toHaveBeenCalledWith(ROOT, '');
  expect(bridge.api.files.listDir).not.toHaveBeenCalledWith(ROOT, 'src');
  fireEvent.click(await row('src'));
  expect(await row('main.ts')).toBeTruthy();
  expect(bridge.api.files.listDir).toHaveBeenCalledWith(ROOT, 'src');
});

it('draws code on paper, numbered from 1, with its folder and its absolute path', async () => {
  mount();
  fireEvent.click(await row('src'));
  fireEvent.click(await row('main.ts'));
  await screen.findByText('2 lines · 27 B');
  // Code has one reading: no switch, only Copy and Open.
  expect(screen.queryByRole('group', { name: 'Reading' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Copy content' })).toBeTruthy();
  const page = document.querySelector('.cl-fview')!;
  expect(page.querySelector('.cl-term')).toBeNull();
  const numbers = [...page.querySelectorAll('.cl-ctx-code-row .ln')].map(n => n.textContent);
  expect(numbers).toEqual(['1', '2']);
  const dir = page.querySelector('.cl-fview-dir')!;
  expect(dir.textContent).toBe('/w/acme/src');
  expect(dir.getAttribute('title')).toBe('/w/acme/src/main.ts');
});

it('opens markdown on its document and keeps the source a click away', async () => {
  mount();
  fireEvent.click(await row('README.md'));
  const heading = await screen.findByRole('heading', { name: 'Acme' });
  expect(heading.closest('.cl-fview-doc')).toBeTruthy();
  // The two readings are a switch: the one on screen is the pressed one.
  expect(screen.getByRole('button', { name: 'Preview' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Source' }));
  await waitFor(() => expect(document.querySelector('.cl-fview-doc')).toBeNull());
  expect(document.querySelectorAll('.cl-ctx-code-row')).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  expect(await screen.findByRole('heading', { name: 'Acme' })).toBeTruthy();
});

it('draws a raster image from images:read, under the project root', async () => {
  mount();
  fireEvent.click(await row('logo.png'));
  const img = await screen.findByRole('img', { name: 'logo.png' });
  expect(img.getAttribute('src')).toBe('data:image/png;base64,AAAA');
  expect(bridge.api.images.read).toHaveBeenCalledWith('/w/acme/logo.png', ROOT);
  expect(bridge.api.files.readText).not.toHaveBeenCalled();
});

it('shows an SVG as its source, never as markup', async () => {
  mount();
  fireEvent.click(await row('icon.svg'));
  await screen.findByText('1 line · 32 B');
  expect(document.querySelector('.cl-fview script')).toBeNull();
  expect(document.querySelector('.cl-ctx-code-row')?.textContent).toContain('<svg><script>');
  expect(bridge.api.images.read).not.toHaveBeenCalled();
});

it('says what a binary file is and opens it in its own app', async () => {
  mount();
  fireEvent.click(await row('data.bin'));
  expect(await screen.findByText('A binary file, not shown as text.')).toBeTruthy();
  expect(screen.getByText('2.0 KB')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Open in its default app' }));
  await waitFor(() => expect(bridge.api.vault.openFile).toHaveBeenCalledWith(ROOT, 'data.bin'));
});

it('does not read a PDF at all: it opens in its own app', async () => {
  mount();
  fireEvent.click(await row('spec.pdf'));
  expect(await screen.findByText('This kind of file opens in its own app.')).toBeTruthy();
  expect(bridge.api.files.readText).not.toHaveBeenCalled();
});
