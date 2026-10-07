import { createContext, useContext } from 'react';
import { NO_ATTENTION, type AttentionState } from './tab-attention';

/** What every open session's tab remembers between two looks at it, from
 *  `TabAttentionProvider`. Outside one (the "What's new" preview) nothing is
 *  remembered, and the tabs draw exactly as before. */
export const TabAttentionContext = createContext<AttentionState>(NO_ATTENTION);

export function useTabAttention(): AttentionState {
  return useContext(TabAttentionContext);
}
