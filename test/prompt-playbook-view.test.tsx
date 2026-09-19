// @vitest-environment jsdom
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PromptPlaybook } from '../src/components/project/chat/PromptPlaybook';
import { ChatComposer } from '../src/components/project/chat/ChatComposer';
import { installFakeElectronAPI, ok, fail, type FakeBridge } from './helpers/fake-electron-api';

const template = {
  id: 'template-1',
  name: 'Review checklist',
  text: 'Review changes carefully.\nCheck tests and report regressions.',
  createdAt: '',
  updatedAt: '',
};
let bridge: FakeBridge;
let client: QueryClient;

beforeEach(() => {
  bridge = installFakeElectronAPI();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 30_000 } },
  });
  bridge.api.playbook.getTemplates.mockResolvedValue(ok([template]));
});
afterEach(() => {
  cleanup();
  client.clear();
  bridge.restore();
});

function mount(onUse = vi.fn(), hash = 'project-a') {
  const tree = (projectHash: string) => (
    <StrictMode>
      <QueryClientProvider client={client}>
        <PromptPlaybook projectHash={projectHash} onUse={onUse} />
      </QueryClientProvider>
    </StrictMode>
  );
  const result = render(tree(hash));
  return {
    ...result,
    onUse,
    changeProject: (projectHash: string) => result.rerender(tree(projectHash)),
  };
}
async function open() {
  fireEvent.click(screen.getByRole('button', { name: 'Playbook' }));
  await screen.findByText(template.name);
}

function clickAction(name: string) {
  fireEvent.click(screen.getByRole('button', { name: /Actions for/ }));
  fireEvent.click(screen.getByRole('button', { name }));
}

describe('Prompt Playbook', () => {
  it('separates the collections and keeps secondary actions behind a menu', async () => {
    mount();
    await open();
    expect(screen.getByRole('tab', { name: /Saved/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Actions for/ }));
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('tab', { name: /Saved/ }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: /Suggested/ }).getAttribute('aria-selected')).toBe(
      'true'
    );
    expect(screen.queryByRole('button', { name: 'Use' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: /Suggested/ }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    const preview = screen.getByRole('button', { name: /Review changes carefully/ });
    expect(preview.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(preview);
    expect(preview.getAttribute('aria-expanded')).toBe('true');
  });

  it('reads lazily on each opening, never on a closed session update', async () => {
    mount();
    expect(bridge.api.playbook.getCandidates).not.toHaveBeenCalled();
    await open();
    expect(bridge.api.playbook.getCandidates).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Playbook' }));
    bridge.channels.dataChanged.emit(['sessions']);
    expect(bridge.api.playbook.getCandidates).toHaveBeenCalledTimes(1);
    await open();
    await waitFor(() => expect(bridge.api.playbook.getCandidates).toHaveBeenCalledTimes(2));
  });

  it('uses original multiline text once under StrictMode and copies via the system bridge', async () => {
    const { onUse } = mount();
    await open();
    clickAction('Copy');
    await screen.findByText('Copied to clipboard.');
    expect(bridge.api.clipboard.writeText).toHaveBeenCalledWith(template.text);
    fireEvent.click(screen.getByRole('button', { name: 'Use' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onUse).toHaveBeenCalledExactlyOnceWith(template.text);
    expect(bridge.api.sessions.sendMessage).not.toHaveBeenCalled();
  });

  it('keeps insertion and clipboard errors visible without claiming success', async () => {
    mount(vi.fn().mockRejectedValue(new Error('Terminal is not ready.')));
    bridge.api.clipboard.writeText.mockResolvedValue(fail('Clipboard unavailable.'));
    await open();
    clickAction('Copy');
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Clipboard unavailable.'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Use' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Terminal is not ready.')
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('creates, edits and confirms deletion within the current project', async () => {
    mount();
    await open();
    fireEvent.click(screen.getByRole('button', { name: /New template/ }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New review' } });
    fireEvent.change(screen.getByLabelText('Prompt'), {
      target: { value: 'Preserve this\n  indentation.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await screen.findByText('Template saved.');
    expect(bridge.api.playbook.create).toHaveBeenCalledWith('project-a', {
      name: 'New review',
      text: 'Preserve this\n  indentation.',
    });
    clickAction('Edit');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Revised checklist' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await screen.findByText('Template saved.');
    expect(bridge.api.playbook.update).toHaveBeenCalledWith('project-a', template.id, {
      name: 'Revised checklist',
      text: template.text,
    });
    clickAction('Delete');
    expect(bridge.api.playbook.delete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await screen.findByText('Template deleted.');
    expect(bridge.api.playbook.delete).toHaveBeenCalledWith('project-a', template.id);
  });

  it('preserves the editor on a failed save', async () => {
    bridge.api.playbook.update.mockResolvedValue(fail('Could not write playbook.'));
    mount();
    await open();
    clickAction('Edit');
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Unsaved draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Prompt')).toHaveProperty('value', 'Unsaved draft');
  });

  it('promotes and dismisses suggestions and discloses a partial scan', async () => {
    const text = 'A recurring prompt from three independent sessions.';
    bridge.api.playbook.getCandidates.mockResolvedValue(
      ok({
        candidates: [{ id: 'candidate-1', text, sessionCount: 3 }],
        scannedSessions: 5,
        truncated: true,
      })
    );
    mount();
    await open();
    fireEvent.click(screen.getByRole('tab', { name: /Suggested/ }));
    expect(await screen.findByText(/only part of this project/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save as template' }));
    expect(screen.getByLabelText('Prompt')).toHaveProperty('value', text);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Recurring checklist' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await screen.findByText('Template saved.');
    expect(bridge.api.playbook.promote).toHaveBeenCalledWith('project-a', {
      name: 'Recurring checklist',
      text,
    });
    fireEvent.click(screen.getByRole('tab', { name: /Suggested/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await screen.findByText('Suggestion dismissed.');
    expect(bridge.api.playbook.dismiss).toHaveBeenCalledWith('project-a', text);
  });

  it('isolates queries and editor state across project changes', async () => {
    const view = mount();
    await open();
    clickAction('Edit');
    bridge.api.playbook.getTemplates.mockResolvedValue(ok([]));
    view.changeProject('project-b');
    await screen.findByText('Save a checklist or instructions you use often.');
    expect(screen.queryByLabelText('Prompt')).toBeNull();
    expect(screen.queryByText(template.name)).toBeNull();
    expect(bridge.api.playbook.getTemplates).toHaveBeenLastCalledWith('project-b');
  });
});

describe('SDK composer insertion', () => {
  it('appends to the existing draft, focuses it and sends only on explicit Send', async () => {
    const onSend = vi.fn();
    render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <ChatComposer
            projectHash="project-a"
            realPath="/projects/acme"
            sending={false}
            onSend={onSend}
            onStop={vi.fn()}
          />
        </QueryClientProvider>
      </StrictMode>
    );
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'My existing draft' } });
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Use' }));
    await waitFor(() =>
      expect(input).toHaveProperty('value', `My existing draft\n\n${template.text}`)
    );
    expect(document.activeElement).toBe(input);
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    expect(onSend).toHaveBeenCalledWith(
      `My existing draft\n\n${template.text}`,
      expect.any(Object)
    );
  });

  it('allows copying while a locked composer refuses insertion', async () => {
    render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <ChatComposer
            projectHash="project-a"
            realPath="/projects/acme"
            sending={false}
            lockNotice="Live in terminal"
            onSend={vi.fn()}
            onStop={vi.fn()}
          />
        </QueryClientProvider>
      </StrictMode>
    );
    await open();
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('button', { name: 'Use' })).toHaveProperty('disabled', true);
    fireEvent.click(dialog.getByRole('button', { name: /Actions for/ }));
    expect(dialog.getByRole('button', { name: 'Copy' })).toHaveProperty('disabled', false);
  });
});
