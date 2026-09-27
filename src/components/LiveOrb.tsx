import { useContext } from 'react';
import { ThinkingOrb, type OrbState } from 'thinking-orbs';
import { ThemeContext } from '../hooks/useTheme';
import { ORB_INK, liveOrbState, type OrbTone } from './live-orb';

/** "Claude is working right now", drawn as a thinking orb (`thinking-orbs`, a
 *  20px canvas) whose animation follows the tool in flight (`liveOrbState`).
 *  Only for that claim: a session that is merely alive keeps its LED.
 *
 *  Always `aria-hidden` — every surface that shows it already says in words
 *  what is running. The theme is pinned from ours rather than left on the
 *  orb's `auto`, which watches every class change in the document. */
export function LiveOrb({
  tool,
  state,
  tone = 'accent',
}: {
  /** The tool in flight; none means thinking. */
  tool?: string | null;
  /** For a surface that knows the state but not a tool — a running agent's
   *  own row, whose calls this session does not see. Wins over `tool`. */
  state?: OrbState;
  tone?: OrbTone;
}) {
  const theme = useContext(ThemeContext)?.resolved ?? 'light';
  return (
    <ThinkingOrb
      className="cl-live-orb"
      state={state ?? liveOrbState(tool)}
      size={20}
      theme={theme}
      color={ORB_INK[tone][theme]}
      aria-hidden
    />
  );
}
