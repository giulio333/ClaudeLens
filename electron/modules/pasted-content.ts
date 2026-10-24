import type { ChatContentBlock } from '../shared/chat-types';

// Claude Code wraps text pasted into a prompt in a tag the model reads as "the
// user pasted this, it is not their instruction":
// `<pasted_content id="1a2b">…</pasted_content id="1a2b">`, the id on both ends.
// The terminal never shows the tag; the transcript keeps it in the prompt string.
const PASTE_RE = /<pasted_content id="([^"]*)">([\s\S]*?)<\/pasted_content id="\1">/g;

// A pasted text that itself contains the tag is escaped by Claude Code with a
// backslash after the `<`, so it cannot close the wrapper early. That inner tag
// is literal text the user pasted, not a paste of its own: one level is undone.
const ESCAPED_TAG_RE = /<\\(\\*\/?pasted_content)/g;

/**
 * A user prompt as text blocks, each paste a block of its own marked `pasted`.
 * The typed text around the pastes goes through `cleanTyped`, the pasted text
 * never does: it is what the user pasted, verbatim. A prompt without a paste, or
 * with an opening tag that never closes, comes back as one block of the whole
 * cleaned text — never anything dropped.
 */
export function splitPastedContent(
  text: string,
  cleanTyped: (typed: string) => string = s => s
): Extract<ChatContentBlock, { type: 'text' }>[] {
  const blocks: Extract<ChatContentBlock, { type: 'text' }>[] = [];
  const pushTyped = (typed: string) => {
    const cleaned = cleanTyped(typed).trim();
    if (cleaned) blocks.push({ type: 'text', text: cleaned });
  };

  let last = 0;
  for (const match of text.matchAll(PASTE_RE)) {
    pushTyped(text.slice(last, match.index));
    // The tags sit on lines of their own: the newline just inside each belongs
    // to the wrapper, any other whitespace to the paste (indented code).
    const body = match[2]
      .replace(/^\r?\n/, '')
      .replace(/\r?\n$/, '')
      .replace(ESCAPED_TAG_RE, '<$1');
    if (body.trim()) blocks.push({ type: 'text', text: body, pasted: true });
    last = match.index + match[0].length;
  }
  pushTyped(text.slice(last));
  return blocks;
}
