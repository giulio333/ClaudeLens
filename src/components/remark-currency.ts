// `remark-math` reads every `$…$` pair as a formula, so prose that carries
// amounts — "da $295 a $265) e … (da $298 a $278)" — came out as italic TeX with
// the spaces eaten. Pandoc's rule tells the two apart: an inline `$…$` is math
// only when the opening `$` is not followed by a space, the closing `$` is not
// preceded by one, and the closing `$` is not followed by a digit. A pair that
// breaks the rule is put back as the text it was. `$$…$$` is left alone.

import type { Parents, Root, Text } from 'mdast';
import type { VFile } from 'vfile';

const isSpace = (ch: string | undefined) => ch !== undefined && /\s/.test(ch);

function isCurrency(source: string, start: number, end: number): boolean {
  if (source[start + 1] === '$') return false;
  const inner = source.slice(start + 1, end - 1);
  return isSpace(inner[0]) || isSpace(inner[inner.length - 1]) || /\d/.test(source[end] ?? '');
}

function restore(parent: Parents, source: string): void {
  parent.children.forEach((child, i) => {
    if (child.type === 'inlineMath') {
      const start = child.position?.start.offset;
      const end = child.position?.end.offset;
      if (start === undefined || end === undefined || !isCurrency(source, start, end)) return;
      const text: Text = {
        type: 'text',
        value: source.slice(start, end),
        position: child.position,
      };
      parent.children[i] = text;
    } else if ('children' in child) {
      restore(child as Parents, source);
    }
  });
}

export function remarkCurrencyDollar() {
  return (tree: Root, file: VFile) => restore(tree, String(file.value));
}
