import { FileIcon } from '../chat/fileIcons';
import { fileCategory, fileCategoryTint } from '../chat/utils';

/**
 * A file's icon in its family's tint — the colour the Lens rail already gives
 * a file it read: code violet, data cyan, web haiku, documents terracotta. A
 * language's logo where there is one, the page glyph for a known family with
 * no logo (a note, a CSV), and nothing for a name the extension says nothing
 * about, so a tree of such names stays quiet. Always in a 14px slot, so the
 * names line up whatever the icon.
 */
export function FileKindIcon({ ext }: { ext: string }) {
  const known = fileCategory(ext) !== null;
  return (
    <span className="lead" aria-hidden style={known ? { color: fileCategoryTint(ext) } : undefined}>
      <FileIcon ext={ext} bare={!known} />
    </span>
  );
}
