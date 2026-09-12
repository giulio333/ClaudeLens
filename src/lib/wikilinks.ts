// Reading the `[[wikilinks]]` out of a message.
//
// Claude cites its sources in Obsidian's notation, and until now the transcript
// rendered them as text — so a citation of a file that exists and a citation of
// a file that does not looked identical. Resolution happens in the main process
// (`electron/modules/vault-index.ts`); this is the renderer's half: which names
// a given message claims, and what each one should read as on screen.
//
// Kept pure and free of React so the grammar is testable on its own, and kept
// here rather than in the memory graph because the two answer different
// questions with the same notation: the graph resolves a link to another
// MEMORY, this resolves it to a file in the project.

/** One occurrence of `[[…]]` in a message. */
export interface WikiLinkRef {
  /** What to resolve: `[[Note#Heading|alias]]` → `Note`. */
  target: string;
  /** What to show: the alias when there is one, else the target as written. */
  label: string;
}

/**
 * `[[` … `]]` with no nested bracket and no newline inside. The newline matters:
 * without it an unclosed `[[` swallows the rest of the message and a paragraph
 * turns into one chip.
 */
const WIKILINK_RE = /\[\[([^[\]\n]+)\]\]/g;

/** A fresh regex per call — a module-level /g regex carries `lastIndex` between calls. */
export function wikiLinkRegex(): RegExp {
  return new RegExp(WIKILINK_RE.source, 'g');
}

/**
 * Splits the notation into what it points at and what it says.
 *
 * `#` names a heading inside the note and `|` renames it on screen; both leave
 * the file the same. The same stripping is done again in the main process
 * (`wikiLinkTarget` there) — the renderer's copy is what picks the label, and
 * the handler never trusts a target it did not normalize itself.
 */
export function parseWikiLink(raw: string): WikiLinkRef {
  const [beforeAlias, ...aliasParts] = raw.split('|');
  const alias = aliasParts.join('|').trim();
  const target = (beforeAlias ?? '').split('#')[0]?.trim() ?? '';
  const heading = (beforeAlias ?? '').split('#').slice(1).join('#').trim();
  // No alias: show what was written, minus the `#heading` the reader can't follow.
  const label = alias || (heading && !target ? heading : target);
  return { target, label };
}

/** Every `[[…]]` in `text`, in order, including repeats. */
export function parseWikiLinks(text: string): WikiLinkRef[] {
  const out: WikiLinkRef[] = [];
  const re = wikiLinkRegex();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const ref = parseWikiLink(m[1]);
    if (ref.target) out.push(ref);
  }
  return out;
}

/**
 * Drops fenced code blocks, which the chip pass never rewrites.
 *
 * The two passes have to agree on what counts as a citation: the rehype pass
 * skips `<pre>` wholesale (a transcript quoting markdown source is quoting, not
 * citing), so collecting a name from inside a fence would ask the main process
 * about something that can never be drawn. Line-based rather than a regex over
 * the whole string: an unclosed fence — a message still streaming — has to
 * swallow the rest of the text, exactly as the markdown parser will read it.
 *
 * Inline code is deliberately kept: `` `[[Nota]]` `` IS drawn as a chip.
 */
function stripFencedCode(text: string): string {
  if (!text.includes('```') && !text.includes('~~~')) return text;
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of text.split('\n')) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence === null) {
      if (marker) fence = marker[0];
      else out.push(line);
      continue;
    }
    // A closing fence is the same character, at least as long as the opening one.
    if (marker && marker[0] === fence) fence = null;
  }
  return out.join('\n');
}

/** The distinct names a message cites — what gets asked about over IPC. */
export function wikiLinkTargets(text: string): string[] {
  const seen = new Set<string>();
  for (const ref of parseWikiLinks(stripFencedCode(text))) seen.add(ref.target);
  return [...seen];
}
