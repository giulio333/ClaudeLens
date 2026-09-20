/** The pure half of `MessageLine` — what a message row says before it is opened.
 *  It lives apart from the component for the fast-refresh rule (a component file
 *  exports components only). */

/** Direction of the message relative to the session whose transcript this is. */
export type MessageDirection = 'in' | 'out';

/** The one line a message shows before it is asked to say more. Markdown is not
 *  rendered here — it is a label, not prose — so its own syntax is stripped to
 *  what it stands for rather than printed as punctuation. */
export function previewLine(text: string): string {
  const line = text
    .split('\n')
    .map(l => l.trim())
    .find(l => l.length > 0 && !l.startsWith('```'));
  if (!line) return '';
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^>\s+/, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}
