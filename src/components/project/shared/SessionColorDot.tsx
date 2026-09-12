import type { AgentColor } from '../../../types';

/** The colour a session carries from `/color` (Claude Code's own way of telling
 *  concurrent sessions apart in the terminal), drawn as a dot.
 *
 *  The colour is DATA — the user's own label, not one of the app's accents — so
 *  it is the one place a hue outside the brand 40° is allowed.
 *
 *  A dot only where nothing else is one: the chat's top bar, where the crumb has
 *  no ordinal to tint and no other dot to be confused with. On a SESSIONS ROW
 *  the colour is worn by the row's ordinal instead — a third dot next to the
 *  green LIVE one and the model's read as a traffic light, three marks
 *  competing to say three unrelated things.
 *
 *  The name selects a class, never an inline `background`: the value comes from
 *  an undocumented transcript record, and `cost-tracker` already narrows it to
 *  the eight `/color` accepts — a value that somehow got past that renders as
 *  nothing rather than as arbitrary CSS. */
export function SessionColorDot({ color }: { color?: AgentColor }) {
  if (!color) return null;
  return (
    <span className={`cl-scolor ${color}`} role="img" aria-label={`Session colour ${color}`} />
  );
}
