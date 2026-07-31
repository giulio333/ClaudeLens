import { createContext, useContext } from 'react';

// ─── Theme preference ─────────────────────────────────────────────────────────
// A single source of truth shared between the top-bar toggle and the Settings
// "Appearance" section. The stored *preference* may be 'system'; the *resolved*
// theme is always 'light' | 'dark' and is what we apply to <html data-theme>.
//
//   preference = 'light' | 'dark' → manual; the top-bar toggle is editable.
//   preference = 'system'         → follows the OS via matchMedia (live), and
//                                   the top-bar toggle becomes read-only.
//
// The contract (types + context + hook) lives here, apart from the provider
// component in ThemeProvider.tsx, so neither file mixes components with
// non-component exports (react-refresh/only-export-components).

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export type ThemeContextValue = {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (p: ThemePreference) => void;
};

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
