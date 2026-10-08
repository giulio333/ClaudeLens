import { useState } from 'react';
import { usePinnedSessions } from '../../../hooks/usePinnedSessions';
import { useSessionTags } from '../../../hooks/useSessionTags';
import { PinIcon } from '../shared/SearchPopover';
import { TagGlyph } from '../sessions/SessionRowMenu';
import { TagPicker } from '../sessions/TagPicker';

/** Pin and tags for the session on screen, as two icons of the bar: it is shared
 *  by Terminal and Lens, and chips here would crowd the tabs. Each icon wears
 *  the accent only when it has something to say (pinned, tagged). */
export function SessionActions({
  projectHash,
  filename,
}: {
  projectHash: string;
  filename: string;
}) {
  const { isPinned, togglePin } = usePinnedSessions();
  const { tags, tagsForSession, toggleTagOnSession } = useSessionTags(projectHash);
  const [pickerAnchor, setPickerAnchor] = useState<DOMRect | null>(null);
  const pinned = isPinned(projectHash, filename);
  const selected = tagsForSession(filename);
  const tagTitle = selected.length ? `Tags: ${selected.join(', ')}` : 'Add tag';
  return (
    <>
      <button
        type="button"
        className="cl-stabs-icon cl-stabs-mark"
        aria-pressed={pinned}
        aria-label={pinned ? 'Unpin session' : 'Pin session'}
        title={pinned ? 'Unpin session' : 'Pin session'}
        onClick={() => togglePin(projectHash, filename)}
      >
        <span className="cl-stabs-glyph">
          <PinIcon filled={pinned} />
        </span>
      </button>
      <button
        type="button"
        className="cl-stabs-icon cl-stabs-mark"
        aria-pressed={selected.length > 0}
        aria-expanded={pickerAnchor !== null}
        aria-label={tagTitle}
        title={tagTitle}
        onClick={e => {
          const rect = e.currentTarget.getBoundingClientRect();
          setPickerAnchor(prev => (prev ? null : rect));
        }}
      >
        <span className="cl-stabs-glyph">
          <TagGlyph />
        </span>
        {selected.length > 0 && <span className="cl-stabs-count">{selected.length}</span>}
      </button>
      {pickerAnchor && (
        <TagPicker
          anchorRect={pickerAnchor}
          allTags={tags}
          selected={selected}
          onToggle={name => toggleTagOnSession(filename, name)}
          onClose={() => setPickerAnchor(null)}
        />
      )}
    </>
  );
}
