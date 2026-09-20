import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { copyPromptText, usePromptPlaybook } from '../../../hooks/useIPC';
import {
  MAX_PROMPT_LENGTH,
  MAX_TEMPLATE_NAME_LENGTH,
  type PromptTemplate,
} from '../../../../electron/shared/playbook-types';
import './prompt-playbook.css';

interface PlaybookProps {
  projectHash: string;
  onUse: (text: string) => void | Promise<void>;
  useDisabled?: boolean;
  useHint?: string;
}

export function PromptPlaybook(props: PlaybookProps) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  function close(restoreFocus = true) {
    setAnchor(null);
    if (restoreFocus) button.current?.focus();
  }
  return (
    <>
      <button
        ref={button}
        type="button"
        className="cl-playbook-trigger"
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        aria-controls={anchor ? id : undefined}
        onClick={() => (anchor ? close() : setAnchor(button.current!.getBoundingClientRect()))}
        title="Reusable prompts for this project"
      >
        Playbook
      </button>
      {anchor &&
        createPortal(
          <PromptPlaybookPanel
            key={props.projectHash}
            {...props}
            id={id}
            anchor={anchor}
            trigger={button}
            onClose={close}
          />,
          document.body
        )}
    </>
  );
}

type Editor = { kind: 'create' | 'promote' | 'update'; id?: string; name: string; text: string };

export function PromptPlaybookPanel({
  projectHash,
  onUse,
  useDisabled,
  useHint,
  id,
  anchor,
  trigger,
  onClose,
}: PlaybookProps & {
  id: string;
  anchor?: DOMRect;
  trigger?: RefObject<HTMLButtonElement | null>;
  onClose: (restoreFocus?: boolean) => void;
}) {
  const { templates, candidates, change } = usePromptPlaybook(projectHash);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [tab, setTab] = useState<'saved' | 'suggested'>('saved');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    panel.current?.focus();
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !panel.current?.contains(event.target) &&
        !trigger?.current?.contains(event.target)
      ) {
        closeRef.current(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      const withinPanel =
        event.target instanceof Node &&
        (panel.current?.contains(event.target) || trigger?.current?.contains(event.target));
      if (event.key === 'Escape' && (anchor || withinPanel)) {
        event.preventDefault();
        event.stopPropagation();
        const menu = panel.current?.querySelector<HTMLElement>(
          '.cl-playbook-options[data-open="true"]'
        );
        if (menu) {
          const toggle = menu.querySelector<HTMLButtonElement>('button');
          toggle?.click();
          toggle?.focus();
          return;
        }
        closeRef.current();
      }
    };
    if (anchor) document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [anchor, trigger]);

  async function perform(action: () => Promise<unknown>) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The action could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  function saveEditor() {
    if (!editor) return;
    const input = { name: editor.name, text: editor.text };
    void perform(async () => {
      await change.mutateAsync(
        editor.kind === 'update'
          ? { kind: 'update', id: editor.id!, input }
          : { kind: editor.kind, input }
      );
      setEditor(null);
      setTab('saved');
      setNotice('Template saved.');
    });
  }

  const below = anchor && window.innerHeight - anchor.bottom > 300;
  const width = Math.min(480, window.innerWidth - 24);
  return (
    <div
      ref={panel}
      id={id}
      role={anchor ? 'dialog' : 'region'}
      aria-label="Prompt Playbook"
      tabIndex={-1}
      className={`cl-playbook${anchor ? '' : ' cl-playbook--embedded'}`}
      style={
        anchor
          ? {
              width,
              left: Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12)),
              ...(below
                ? { top: anchor.bottom + 8 }
                : { bottom: window.innerHeight - anchor.top + 8 }),
              maxHeight: Math.min(
                620,
                Math.max(180, (below ? window.innerHeight - anchor.bottom : anchor.top) - 20)
              ),
            }
          : undefined
      }
    >
      <header className="cl-playbook-heading">
        <strong>
          {editor ? (editor.kind === 'update' ? 'Edit template' : 'New template') : 'Playbook'}
        </strong>
        {!editor && (
          <button
            className="cl-playbook-new"
            type="button"
            disabled={busy}
            onClick={() => {
              setError(null);
              setNotice(null);
              setEditor({ kind: 'create', name: '', text: '' });
            }}
          >
            + New template
          </button>
        )}
        <button
          className="cl-playbook-close"
          type="button"
          aria-label={anchor ? 'Close playbook' : 'Back to activity'}
          title={anchor ? 'Close playbook' : 'Back to activity'}
          onClick={() => onClose()}
        >
          ×
        </button>
      </header>
      {!editor && (
        <div
          className="cl-playbook-tabs"
          role="tablist"
          aria-label="Prompt collections"
          onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next =
              event.key === 'Home'
                ? 'saved'
                : event.key === 'End'
                  ? 'suggested'
                  : tab === 'saved'
                    ? 'suggested'
                    : 'saved';
            setTab(next);
            event.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
          }}
        >
          <button
            type="button"
            role="tab"
            data-tab="saved"
            id={`${id}-saved-tab`}
            aria-selected={tab === 'saved'}
            aria-controls={`${id}-saved`}
            tabIndex={tab === 'saved' ? 0 : -1}
            onClick={() => setTab('saved')}
          >
            Saved <span>{templates.data?.length ?? '—'}</span>
          </button>
          <button
            type="button"
            role="tab"
            data-tab="suggested"
            id={`${id}-suggested-tab`}
            aria-selected={tab === 'suggested'}
            aria-controls={`${id}-suggested`}
            tabIndex={tab === 'suggested' ? 0 : -1}
            onClick={() => setTab('suggested')}
          >
            Suggested <span>{candidates.data?.candidates.length ?? '—'}</span>
          </button>
        </div>
      )}
      <div className="cl-playbook-body">
        {error && (
          <p role="alert" className="cl-playbook-error">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {busy && <p role="status">Working…</p>}
        {editor ? (
          <form
            onSubmit={e => {
              e.preventDefault();
              saveEditor();
            }}
          >
            <label>
              Name
              <input
                autoFocus
                required
                maxLength={MAX_TEMPLATE_NAME_LENGTH}
                value={editor.name}
                onChange={e => setEditor({ ...editor, name: e.target.value })}
              />
            </label>
            <label>
              Prompt
              <textarea
                required
                rows={7}
                maxLength={MAX_PROMPT_LENGTH}
                value={editor.text}
                onChange={e => setEditor({ ...editor, text: e.target.value })}
              />
            </label>
            <div className="cl-playbook-actions">
              <button
                className="cl-playbook-primary"
                type="submit"
                disabled={busy || !editor.name.trim() || !editor.text.trim()}
              >
                Save template
              </button>
              <button type="button" disabled={busy} onClick={() => setEditor(null)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            <section
              id={`${id}-saved`}
              role="tabpanel"
              aria-labelledby={`${id}-saved-tab`}
              hidden={tab !== 'saved'}
            >
              {templates.isPending && <p role="status">Loading templates…</p>}
              {templates.error && (
                <p role="alert">
                  {templates.error.message}{' '}
                  <button type="button" onClick={() => void templates.refetch()}>
                    Retry templates
                  </button>
                </p>
              )}
              {templates.data?.length === 0 && (
                <div className="cl-playbook-empty">
                  <strong>Your go-to prompts, kept here.</strong>
                  <p>Save a checklist or instructions you use often.</p>
                </div>
              )}
              {templates.data?.map(template => (
                <SavedPrompt
                  key={template.id}
                  template={template}
                  busy={busy}
                  useDisabled={useDisabled}
                  useHint={useHint}
                  onUse={() =>
                    void perform(async () => {
                      await onUse(template.text);
                      onClose(false);
                    })
                  }
                  onCopy={() =>
                    void perform(async () => {
                      await copyPromptText(template.text);
                      setNotice('Copied to clipboard.');
                    })
                  }
                  onEdit={() => {
                    setError(null);
                    setNotice(null);
                    setEditor({ kind: 'update', ...template });
                  }}
                  onDelete={() =>
                    void perform(async () => {
                      await change.mutateAsync({ kind: 'delete', id: template.id });
                      setNotice('Template deleted.');
                    })
                  }
                />
              ))}
            </section>
            <section
              id={`${id}-suggested`}
              role="tabpanel"
              aria-labelledby={`${id}-suggested-tab`}
              hidden={tab !== 'suggested'}
            >
              <p className="cl-playbook-intro">Prompts you’ve used in at least 3 sessions.</p>
              {candidates.isPending && (
                <p role="status">Looking through this project’s sessions…</p>
              )}
              {candidates.error && (
                <p role="alert">
                  {candidates.error.message}{' '}
                  <button type="button" onClick={() => void candidates.refetch()}>
                    Retry suggestions
                  </button>
                </p>
              )}
              {candidates.data?.truncated && (
                <p role="status">
                  Suggestions cover only part of this project’s history (
                  {candidates.data.scannedSessions} sessions read).
                </p>
              )}
              {candidates.data?.candidates.length === 0 && (
                <div className="cl-playbook-empty">
                  <strong>Nothing recurring yet.</strong>
                  <p>No recurring prompts found in the sessions checked.</p>
                </div>
              )}
              {candidates.data?.candidates.map(candidate => (
                <article key={candidate.id} className="cl-playbook-entry">
                  <small className="cl-playbook-frequency">
                    Used in {candidate.sessionCount} sessions
                  </small>
                  <PromptPreview text={candidate.text} />
                  <div className="cl-playbook-actions">
                    <button
                      className="cl-playbook-primary"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setError(null);
                        setNotice(null);
                        setEditor({ kind: 'promote', name: '', text: candidate.text });
                      }}
                    >
                      Save as template
                    </button>
                    <button
                      className="cl-playbook-quiet"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await change.mutateAsync({ kind: 'dismiss', text: candidate.text });
                          setNotice('Suggestion dismissed.');
                        })
                      }
                    >
                      Dismiss
                    </button>
                  </div>
                </article>
              ))}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function PromptPreview({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <button
      type="button"
      className="cl-playbook-preview"
      aria-expanded={expanded}
      title={expanded ? 'Collapse prompt' : 'Show full prompt'}
      onClick={() => setExpanded(value => !value)}
    >
      {text}
    </button>
  );
}

// Exported for the "What's new" popup, which renders a couple of rows from a
// synthetic template list: a preview drawn with the shipped component cannot
// drift from the panel, and takes no data of the user's own to do it.
export function SavedPrompt({
  template,
  busy,
  useDisabled,
  useHint,
  onUse,
  onCopy,
  onEdit,
  onDelete,
}: {
  template: PromptTemplate;
  busy: boolean;
  useDisabled?: boolean;
  useHint?: string;
  onUse: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  function action(run: () => void) {
    setMenuOpen(false);
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus();
    run();
  }
  return (
    <article className="cl-playbook-entry">
      <div className="cl-playbook-entry-heading">
        <strong>{template.name}</strong>
        {!deleting && (
          <div className="cl-playbook-entry-tools">
            <button
              className="cl-playbook-primary"
              type="button"
              disabled={busy || useDisabled}
              title={useHint}
              onClick={onUse}
            >
              Use
            </button>
            <div
              ref={menu}
              className="cl-playbook-options"
              data-open={menuOpen}
              onBlur={event => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                  setMenuOpen(false);
              }}
            >
              <button
                type="button"
                className="cl-playbook-options-trigger"
                aria-expanded={menuOpen}
                aria-label={`Actions for ${template.name}`}
                onClick={() => setMenuOpen(value => !value)}
              >
                ···
              </button>
              <div className="cl-playbook-options-list" hidden={!menuOpen}>
                <button type="button" disabled={busy} onClick={() => action(onCopy)}>
                  Copy
                </button>
                <button type="button" disabled={busy} onClick={() => action(onEdit)}>
                  Edit
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => action(() => setDeleting(true))}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <PromptPreview text={template.text} />
      {deleting && (
        <div className="cl-playbook-actions cl-playbook-delete">
          <span>Delete this template?</span>
          <button type="button" disabled={busy} onClick={onDelete}>
            Confirm delete
          </button>
          <button type="button" disabled={busy} onClick={() => setDeleting(false)}>
            Keep
          </button>
        </div>
      )}
    </article>
  );
}
