import { useState } from 'react';
import { SheetModal } from './project/chat/CommandBlock';
import { useVaultLinksApi } from './vault-link-engine';
import { useLocalImage } from '../hooks/useIPC';
import { localImagePath } from './image-src';
import { useRemoteOrigin } from './remote-origin';

/**
 * An image in the transcript: a screenshot pasted into a prompt, a `Read` of a
 * `.png`, a picture a message links by path. Drawn at reading size, and
 * opened whole — in the same window the terminal and the editor use — on a
 * click, because a screenshot of a UI is read at its own pixels or not at all.
 */
export function ImageFigure({
  src,
  alt,
  caption,
}: {
  src: string;
  alt?: string;
  /** Printed under the image; the file name, where there is one. */
  caption?: string;
}) {
  const [full, setFull] = useState(false);
  // Spans, not a <figure>: markdown puts the image inside a <p>, where a
  // block element is invalid nesting React warns about on every paint.
  return (
    <>
      <span className="cl-image">
        <button
          type="button"
          className="cl-image-open"
          onClick={() => setFull(true)}
          title="Open full size"
        >
          <img src={src} alt={alt ?? ''} loading="lazy" />
        </button>
        {caption && <span className="cl-image-caption">{caption}</span>}
      </span>
      {full && (
        <SheetModal onClose={() => setFull(false)}>
          <div className="cl-image-full" onClick={() => setFull(false)}>
            <img src={src} alt={alt ?? ''} />
          </div>
        </SheetModal>
      )}
    </>
  );
}

/**
 * The `<img>` markdown produces. A `data:` source draws directly; a path is
 * read through the main process (see `electron/modules/local-image.ts`), and
 * the answer — the picture, "gone", or why it was refused — is what shows,
 * never the browser's broken-image glyph. A relative path resolves against
 * the project root when the markdown is inside a chat (a `VaultLinksProvider`
 * is what says so) and stays as it is elsewhere.
 */
export function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const root = useVaultLinksApi()?.root ?? null;
  const remoteHost = useRemoteOrigin();
  const path = src ? localImagePath(src, root) : null;
  // A path in a remote transcript names a file on the host: reading it here
  // would draw this machine's file at that path, or call the host's one gone.
  const local = useLocalImage(remoteHost ? null : path, root ?? undefined);

  if (!src) return null;
  if (!path) return <ImageFigure src={src} alt={alt} />;

  const name = path.split('/').pop() ?? path;
  if (remoteHost) {
    return (
      <span className="cl-image-note is-unknown" title={path}>
        {name} — on {remoteHost}, not read from this machine
      </span>
    );
  }
  if (local.isPending) {
    return <span className="cl-image-note is-pending">{alt || name}</span>;
  }
  const answer = local.data;
  if (local.isError || !answer) {
    return (
      <span className="cl-image-note is-unknown" title={path}>
        {name} — could not be read
      </span>
    );
  }
  if (answer.status === 'ok') return <ImageFigure src={answer.dataUri} alt={alt} caption={name} />;
  return (
    <span className="cl-image-note is-missing" title={path}>
      {name} — {answer.status === 'missing' ? 'file is gone' : answer.reason}
    </span>
  );
}
