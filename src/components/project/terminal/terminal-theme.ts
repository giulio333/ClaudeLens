// The pane's status labels and per-theme palettes, apart from TerminalPane so
// that file exports only components (react-refresh/only-export-components).

export type TerminalStatus = 'starting' | 'running' | 'exited' | 'error';

export const STATUS_LABEL: Record<TerminalStatus, string> = {
  starting: 'Starting…',
  running: 'Running',
  exited: 'Ended',
  error: 'Error',
};

// Per-theme terminal palettes — the Lens ground (`--cl-paper`) and `--cl-ink`,
// plus a terracotta cursor. xterm needs concrete colors; `scrim`/`muted`/`body`
// drive the exit overlay so it sits on the matching ground. The `term` field is
// the xterm theme; the CLI reads `term.background` (OSC 11) to pick its palette.
//
// The 16 ANSI colors are what the CLI's `*-ansi` themes and every other program
// in the pane (shells, git, test runners) paint with. xterm's defaults assume a
// dark ground, so they are set here: each one meant as text clears 4.5:1 on its
// ground (test/terminal-theme.test.ts). Dark `black` is the exception — programs
// use it as a fill, so it is a lifted surface rather than legible ink. In light,
// `white`/`brightWhite` are warm grays, since programs write them as text too.
export const PALETTES = {
  dark: {
    term: {
      background: '#191713',
      foreground: '#cfccc3',
      cursor: '#C15F3C',
      cursorAccent: '#191713',
      selectionBackground: 'rgba(193, 95, 60, 0.28)',
      black: '#4b4743',
      red: '#e66f62',
      green: '#77b779',
      yellow: '#e6b55d',
      blue: '#73a9e1',
      magenta: '#d686bc',
      cyan: '#6cbec2',
      white: '#cdcac5',
      brightBlack: '#8a8580',
      brightRed: '#fd8c7e',
      brightGreen: '#8bd28d',
      brightYellow: '#fecb74',
      brightBlue: '#8cc3fc',
      brightMagenta: '#eea2d4',
      brightCyan: '#89dbdf',
      brightWhite: '#f0eeea',
    },
    scrim: 'color-mix(in srgb, #191713 82%, transparent)',
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
      black: '#2b2521',
      red: '#b6322b',
      green: '#357339',
      yellow: '#8a6000',
      blue: '#1666aa',
      magenta: '#98397e',
      cyan: '#00787d',
      white: '#6b6961',
      brightBlack: '#74716a',
      brightRed: '#d02d27',
      brightGreen: '#2d8336',
      brightYellow: '#9c6a00',
      brightBlue: '#0071c7',
      brightMagenta: '#ae388f',
      brightCyan: '#008188',
      brightWhite: '#716e68',
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
