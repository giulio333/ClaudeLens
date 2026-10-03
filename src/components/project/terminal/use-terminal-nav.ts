import { useCallback, useReducer } from 'react';
import type { View } from '../types';
import { initNav, navReducer, type InstanceReport } from './terminal-instances';

/** ProjectOverview's navigation, with the embedded terminals it keeps alive.
 *  Every callback is stable: `navigate` stands in for a `useState` setter and is
 *  passed down as one (`onNavigate`), where memos depend on its identity. */
export function useTerminalNav(initial: View) {
  const [state, dispatch] = useReducer(navReducer, initial, initNav);
  const navigate = useCallback(
    (next: View | ((prev: View) => View)) => dispatch({ type: 'navigate', next }),
    []
  );
  const park = useCallback(() => dispatch({ type: 'park' }), []);
  const restore = useCallback((id: string) => dispatch({ type: 'restore', id }), []);
  const close = useCallback((id: string) => dispatch({ type: 'close', id }), []);
  const closeTab = useCallback((id: string) => dispatch({ type: 'closeTab', id }), []);
  const openNew = useCallback(() => dispatch({ type: 'openNew' }), []);
  const report = useCallback(
    (id: string, patch: Partial<InstanceReport>) => dispatch({ type: 'report', id, patch }),
    []
  );
  return { state, navigate, park, restore, close, closeTab, openNew, report };
}
