import { createContext } from 'react';

/**
 * Whether the diffs at the foot of the turns are open — the pill's one switch
 * over them (#265's strip, `FileChangesStrip`). Open by default: the change is
 * what the turn did. `true` also serves as the value outside a provider, so a
 * strip mounted on its own (a test, a preview) draws the diff.
 *
 * A context and not a prop: `MessageBubble` is memoised on a dozen props and
 * the strip sits three components under it, on both the turn and the folded
 * tool-run badge; threading one boolean through every layer for a switch that
 * flips a few times a session is not worth the surface.
 */
export const DiffsOpenContext = createContext<boolean>(true);
