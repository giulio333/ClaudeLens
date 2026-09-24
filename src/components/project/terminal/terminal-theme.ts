// The pane's status labels and per-theme palettes, apart from TerminalPane so
// that file exports only components (react-refresh/only-export-components).

export type TerminalStatus = 'starting' | 'running' | 'exited' | 'error';

export const STATUS_LABEL: Record<TerminalStatus, string> = {
  starting: 'Starting…',
  running: 'Running',
  exited: 'Ended',
  error: 'Error',
};

// Per-theme terminal palettes — the brand surfaces (`--cl-paper-2`/`--cl-ink`)
// plus a terracotta cursor. xterm needs concrete colors; `scrim`/`muted`/`body`
// drive the exit overlay so it sits on the matching ground. The `term` field is
// the xterm theme; the CLI reads `term.background` (OSC 11) to pick its palette.
export const PALETTES = {
  dark: {
    term: {
      background: '#262421',
      foreground: '#cfccc3',
      cursor: '#C15F3C',
      cursorAccent: '#262421',
      selectionBackground: 'rgba(193, 95, 60, 0.28)',
    },
    scrim: 'color-mix(in srgb, #262421 82%, transparent)',
    muted: '#8d897f',
    body: '#cfccc3',
  },
  light: {
    term: {
      background: '#FFFFFF',
      foreground: '#2b2722',
      cursor: '#C15F3C',
      cursorAccent: '#FFFFFF',
      selectionBackground: 'rgba(193, 95, 60, 0.20)',
    },
    scrim: 'color-mix(in srgb, #FFFFFF 82%, transparent)',
    muted: '#7c7669',
    body: '#2b2722',
  },
} as const;

// The terminal's surface color per theme — exported so the unified Terminal/Lens
// view can paint its frame the same color when TERMINAL is active (seamless edge,
// matches in both light and dark since it's the very color xterm renders).
export const TERMINAL_SURFACE: Record<'light' | 'dark', string> = {
  light: PALETTES.light.term.background,
  dark: PALETTES.dark.term.background,
};
