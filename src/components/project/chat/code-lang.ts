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
