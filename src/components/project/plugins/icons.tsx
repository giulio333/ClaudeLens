/* The page's own small icon set, one mark per thing the page names: the two
   levels of the tree, the five kinds a plugin can add, and the four facts of
   its header. Drawn on a 16px grid with one stroke weight so they read as a
   family; `currentColor` so the place they sit in decides the colour. */

export type PluginIconName =
  | 'marketplace'
  | 'plugin'
  | 'skill'
  | 'agent'
  | 'command'
  | 'mcp'
  | 'hook'
  | 'source'
  | 'version'
  | 'author'
  | 'location';

const PATHS: Record<PluginIconName, React.ReactNode> = {
  // a storefront: awning over a box with a door
  marketplace: (
    <>
      <path d="M3 3h10l1.5 3.5h-13L3 3Z" />
      <path d="M2.5 6.5V13h11V6.5" />
      <path d="M6.5 13V9.5h3V13" />
    </>
  ),
  // a package
  plugin: (
    <>
      <path d="M8 1.5 14 4.5v7l-6 3-6-3v-7l6-3Z" />
      <path d="M2 4.5l6 3 6-3" />
      <path d="M8 7.5v7" />
    </>
  ),
  // a spark: something Claude knows how to do
  skill: (
    <path d="M8 1.5c.6 3.6 2.9 5.9 6.5 6.5-3.6.6-5.9 2.9-6.5 6.5C7.4 10.9 5.1 8.6 1.5 8 5.1 7.4 7.4 5.1 8 1.5Z" />
  ),
  // a bust: a specialist to hand work to
  agent: (
    <>
      <circle cx="8" cy="5" r="3" />
      <path d="M2.5 14.5c.5-3 2.6-4.5 5.5-4.5s5 1.5 5.5 4.5" />
    </>
  ),
  // a slash in a key: what you type
  command: (
    <>
      <rect x="2" y="2" width="12" height="12" rx="2.5" />
      <path d="M9.8 4.5 6.2 11.5" />
    </>
  ),
  // a plug: tools from outside
  mcp: (
    <>
      <path d="M5.5 1.5V5M10.5 1.5V5" />
      <path d="M3.5 5h9v2.5a4.5 4.5 0 0 1-9 0V5Z" />
      <path d="M8 12v2.5" />
    </>
  ),
  // a hook
  hook: (
    <>
      <path d="M9.5 2.5V9a3.5 3.5 0 0 1-7 0V7.5" />
      <path d="M9.5 2.5h3" />
    </>
  ),
  // a branch: the repository behind the marketplace
  source: (
    <>
      <circle cx="4.5" cy="3" r="1.5" />
      <circle cx="4.5" cy="13" r="1.5" />
      <circle cx="11.5" cy="5" r="1.5" />
      <path d="M4.5 4.5v7" />
      <path d="M11.5 6.5c0 3-7 2-7 5" />
    </>
  ),
  // a tag
  version: (
    <>
      <path d="M2 2h5.5l6.5 6.5-5.5 5.5L2 7.5V2Z" />
      <circle cx="5.5" cy="5.5" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  // a pen
  author: <path d="M10.5 2.5l3 3-8 8H2.5v-3l8-8Z" />,
  // a folder
  location: (
    <path d="M1.5 4.5a1 1 0 0 1 1-1H6l1.5 1.5h6a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4.5Z" />
  ),
};

export function PluginIcon({ name, size = 16 }: { name: PluginIconName; size?: number }) {
  return (
    <svg
      className="cl-plugin-ico"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
