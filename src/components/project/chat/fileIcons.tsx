import type { FunctionComponent, SVGProps } from 'react'
// devicon-plain logos — monochrome (currentColor), bundled offline & tree-shaken
// by unplugin-icons. Only the ones we map below ship in the build.
import IconTypeScript from '~icons/devicon-plain/typescript'
import IconJavaScript from '~icons/devicon-plain/javascript'
import IconPython from '~icons/devicon-plain/python'
import IconGo from '~icons/devicon-plain/go'
import IconRust from '~icons/devicon-plain/rust'
import IconJava from '~icons/devicon-plain/java'
import IconC from '~icons/devicon-plain/c'
import IconCpp from '~icons/devicon-plain/cplusplus'
import IconRuby from '~icons/devicon-plain/ruby'
import IconPhp from '~icons/devicon-plain/php'
import IconSwift from '~icons/devicon-plain/swift'
import IconKotlin from '~icons/devicon-plain/kotlin'
import IconBash from '~icons/devicon-plain/bash'
import IconLua from '~icons/devicon-plain/lua'
import IconHtml from '~icons/devicon-plain/html5'
import IconCss from '~icons/devicon-plain/css3'
import IconVue from '~icons/devicon-plain/vuejs'
import IconSvelte from '~icons/devicon-plain/svelte'
import IconJson from '~icons/devicon-plain/json'
import IconYaml from '~icons/devicon-plain/yaml'
import IconXml from '~icons/devicon-plain/xml'

type IconComp = FunctionComponent<SVGProps<SVGSVGElement>>

// Extension → real language/tech logo. tsx/jsx map to their base language (no
// monochrome React logo exists in devicon-plain); types without a logo fall back
// to the generic document glyph below.
const LOGO_BY_EXT: Record<string, IconComp> = {
  ts: IconTypeScript, mts: IconTypeScript, cts: IconTypeScript, tsx: IconTypeScript,
  js: IconJavaScript, mjs: IconJavaScript, cjs: IconJavaScript, jsx: IconJavaScript,
  py: IconPython,
  go: IconGo,
  rs: IconRust,
  java: IconJava,
  c: IconC, h: IconC,
  cpp: IconCpp, cc: IconCpp, cxx: IconCpp, hpp: IconCpp,
  rb: IconRuby,
  php: IconPhp,
  swift: IconSwift,
  kt: IconKotlin, kts: IconKotlin,
  sh: IconBash, bash: IconBash, zsh: IconBash,
  lua: IconLua,
  html: IconHtml, htm: IconHtml,
  css: IconCss, scss: IconCss, sass: IconCss, less: IconCss,
  vue: IconVue,
  svelte: IconSvelte,
  json: IconJson,
  yaml: IconYaml, yml: IconYaml,
  xml: IconXml,
}

/** Generic document glyph (line SVG, currentColor) for files without a logo. */
function FileGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="11" height="11" viewBox="0 0 12 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M2 1h5l3 3v9H2z" />
      <path d="M7 1v3h3" />
    </svg>
  )
}

/** Renders the real devicon logo for the extension, or the generic glyph. */
export function FileIcon({ ext }: { ext: string }) {
  const Logo = LOGO_BY_EXT[ext]
  if (Logo) return <Logo className="cl-file-chip-logo" width={12} height={12} aria-hidden />
  return <FileGlyph className="cl-file-chip-logo" />
}
