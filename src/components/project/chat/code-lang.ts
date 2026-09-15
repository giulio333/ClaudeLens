/** File extension → highlight.js language, for every surface that colours a
 *  file's text: the paper `CodeBlock`, the editor window (`FileWindow`).
 *  Separate from `atoms.tsx` because that file exports components only
 *  (react-refresh rule). */
import hljs from 'highlight.js/lib/common';

// File extension (or bare language name) → highlight.js language id. Limited to
// the languages bundled in highlight.js' "common" build; anything not listed
// falls back to plain (no tokenization) so an unknown extension never throws.
const EXT_TO_LANG: Record<string, string> = {
  py: 'python',
  pyw: 'python',
  pyi: 'python',
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  rb: 'ruby',
  php: 'php',
  swift: 'swift',
  lua: 'lua',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  shell: 'bash',
  json: 'json',
  jsonc: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  xml: 'xml',
  html: 'xml',
  htm: 'xml',
  svg: 'xml',
  vue: 'xml',
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  less: 'less',
  sql: 'sql',
  md: 'markdown',
  mdx: 'markdown',
  markdown: 'markdown',
};

/** Resolves an extension/language hint to a registered highlight.js language,
 *  or null when we can't (so the block renders as plain monospace). */
export function resolveLang(hint?: string): string | null {
  if (!hint) return null;
  const key = hint.toLowerCase().replace(/^\./, '');
  const lang = EXT_TO_LANG[key] ?? key;
  return hljs.getLanguage(lang) ? lang : null;
}

/**
 * `text` highlighted as one piece and handed back one HTML fragment per line,
 * the spans still open at a line break closed there and reopened on the next
 * line. A surface that draws lines one by one (numbered, tinted, clamped)
 * cannot highlight them one by one: a `"""` docstring or a block comment is
 * one token across many lines, and the second line highlighted alone is code —
 * a `'` in it opens a string that never closes. hljs escapes the text, so the
 * only `<` in its output are its own spans and a fragment is as safe to inject
 * as the whole. `null` when hljs refuses the language.
 */
export function highlightLines(text: string, language: string): string[] | null {
  let html: string;
  try {
    html = hljs.highlight(text, { language, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
  const lines: string[] = [];
  const open: string[] = [];
  let line = '';
  let last = 0;
  const token = /<span[^>]*>|<\/span>|\n/g;
  let m: RegExpExecArray | null;
  while ((m = token.exec(html)) !== null) {
    line += html.slice(last, m.index);
    last = m.index + m[0].length;
    if (m[0] === '\n') {
      lines.push(line + '</span>'.repeat(open.length));
      line = open.join('');
    } else {
      if (m[0] === '</span>') open.pop();
      else open.push(m[0]);
      line += m[0];
    }
  }
  lines.push(line + html.slice(last) + '</span>'.repeat(open.length));
  return lines;
}
