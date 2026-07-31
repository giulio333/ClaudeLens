import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { persistToDisk } from './prefsBackend';

// ─── Theme preference ─────────────────────────────────────────────────────────
// A single source of truth shared between the top-bar toggle and the Settings
// "Appearance" section. The stored *preference* may be 'system'; the *resolved*
// theme is always 'light' | 'dark' and is what we apply to <html data-theme>.
//
//   preference = 'light' | 'dark' → manual; the top-bar toggle is editable.
//   preference = 'system'         → follows the OS via matchMedia (live), and
//                                   the top-bar toggle becomes read-only.

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'cl-theme';
// Custom event dispatched by hydratePrefs() after it loads the on-disk theme
// into localStorage at startup; keep in sync with prefsBackend's KEY_EVENTS.
const STORAGE_EVENT = 'cl-theme-changed';
const DARK_QUERY = '(prefers-color-scheme: dark)';

type ThemeContextValue = {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (p: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isPreference(v: unknown): v is ThemePreference {
  return v === 'dark' || v === 'system' || v === 'light';
}

function readStoredPreference(): ThemePreference {
  if (typeof localStorage === 'undefined') return 'light';
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === null) return 'light';
  // hydratePrefs() mirrors disk values as JSON (e.g. `"dark"`); older builds
  // wrote the bare string (`dark`). Accept both.
  if (isPreference(saved)) return saved;
  try {
    const parsed = JSON.parse(saved);
    if (isPreference(parsed)) return parsed;
  } catch {
    /* ignore */
  }
  return 'light';
}

function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);
  const [systemResolved, setSystemResolved] = useState<ResolvedTheme>(systemTheme);

  // Track the OS color scheme so the app stays in sync if the user flips their
  // OS theme while ClaudeLens is open. The listener runs regardless of the
  // current preference (the initial value already comes from systemTheme()),
  // which avoids a synchronous re-sync inside the effect; `resolved` below only
  // consumes it when the preference is 'system'.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(DARK_QUERY);
    const onChange = (e: MediaQueryListEvent) => setSystemResolved(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Re-read the preference when hydratePrefs() loads the on-disk value into
  // localStorage at startup (or another window changes it). Under the packaged
  // file:// origin localStorage isn't durable, so disk is the source of truth.
  useEffect(() => {
    const sync = () => setPreferenceState(readStoredPreference());
    window.addEventListener(STORAGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(STORAGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const resolved: ResolvedTheme = preference === 'system' ? systemResolved : preference;

  // Apply the resolved theme to <html>, and persist the *preference* (so a
  // 'system' choice survives reloads) to both localStorage and the on-disk
  // prefs store. localStorage is the synchronous cache; disk is durable.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preference));
    } catch {
      /* ignore */
    }
    persistToDisk(STORAGE_KEY, preference);
  }, [resolved, preference]);

  const value: ThemeContextValue = {
    preference,
    resolved,
    setPreference: setPreferenceState,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
