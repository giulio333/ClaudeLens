import { useEffect, useRef, useState } from 'react';
import { useProjectDescription } from '../../../hooks/useIPC';
import { useProjectDescriptions } from '../../../hooks/useProjectDescriptions';
import { PROJECT_DESCRIPTION_MAX } from '../../../../electron/modules/project-description';

// The one line under the project name: what this project *is*.
//
// Two sources, one line. The project's CLAUDE.md is read for a default
// (`projects:getDescription`) and the user's own wording — stored in
// ClaudeLens' prefs, never in the repo's CLAUDE.md — takes precedence when it
// exists. Clearing the field drops back to the derived text instead of leaving
// the project blank, so the CLAUDE.md keeps working as a source.

interface Props {
  hash: string;
  realPath: string;
}

export function ProjectDescription({ hash, realPath }: Props) {
  const { data: derived } = useProjectDescription(realPath);
  const { descriptionFor, setDescription } = useProjectDescriptions();
  const override = descriptionFor(hash);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const shown = override ?? derived?.text ?? null;

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const startEditing = () => {
    setDraft(shown ?? '');
    setEditing(true);
  };

  const save = () => {
    // Storing text identical to the derived line would freeze today's CLAUDE.md
    // into prefs; leave it derived so the file stays the source.
    setDescription(hash, draft.trim() === derived?.text ? '' : draft);
    setEditing(false);
  };

  const revertToSource = () => {
    setDescription(hash, '');
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="cl-h-desc-edit">
        <textarea
          ref={inputRef}
          className="cl-h-desc-input"
          value={draft}
          maxLength={PROJECT_DESCRIPTION_MAX}
          rows={2}
          placeholder="What is this project?"
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              e.preventDefault();
              setEditing(false);
            } else if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              save();
            }
          }}
        />
        <div className="cl-h-desc-actions">
          <span className="count">
            {draft.length}/{PROJECT_DESCRIPTION_MAX}
          </span>
          <span className="hint">
            {derived
              ? 'Saved in ClaudeLens — your CLAUDE.md is not modified'
              : 'Saved in ClaudeLens'}
          </span>
          <span className="grow" />
          {override && derived && (
            <button type="button" className="cl-h-desc-btn" onClick={revertToSource}>
              Use CLAUDE.md
            </button>
          )}
          <button type="button" className="cl-h-desc-btn" onClick={() => setEditing(false)}>
            Cancel
          </button>
          <button type="button" className="cl-h-desc-btn is-primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    );
  }

  if (!shown) {
    return (
      <button type="button" className="cl-h-desc-add" onClick={startEditing}>
        + Add a description
      </button>
    );
  }

  // The sentence IS the control: no edit button and no provenance tag beside
  // it, both of which cost a line's worth of room to say what a click and a
  // tooltip already say.
  return (
    <button
      type="button"
      className="cl-h-desc"
      onClick={startEditing}
      title={
        override
          ? 'Your description (stored in ClaudeLens) — click to edit'
          : `From ${derived?.filePath ?? 'CLAUDE.md'} — click to edit`
      }
    >
      {shown}
    </button>
  );
}
