import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

// ─── Theme preference ─────────────────────────────────────────────────────────
// A single source of truth shared between the top-bar toggle and the Settings
// "Appearance" section. The stored *preference* may be 'system'; the *resolved*
// theme is always 'light' | 'dark' and is what we apply to <html data-theme>.
//
//   preference = 'light' | 'dark' → manual; the top-bar toggle is editable.
//   preference = 'system'         → follows the OS via matchMedia (live), and
//                                   the top-bar toggle becomes read-only.

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'cl-theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

type ThemeContextValue = {
  preference: ThemePreference
  resolved: ResolvedTheme
  setPreference: (p: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function readStoredPreference(): ThemePreference {
  if (typeof localStorage === 'undefined') return 'light'
  const saved = localStorage.getItem(STORAGE_KEY)
  return saved === 'dark' || saved === 'system' ? saved : 'light'
}

function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference)
  const [systemResolved, setSystemResolved] = useState<ResolvedTheme>(systemTheme)

  // Track the OS color scheme so the app stays in sync if the user flips their
  // OS theme while ClaudeLens is open. The listener runs regardless of the
  // current preference (the initial value already comes from systemTheme()),
  // which avoids a synchronous re-sync inside the effect; `resolved` below only
  // consumes it when the preference is 'system'.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(DARK_QUERY)
    const onChange = (e: MediaQueryListEvent) => setSystemResolved(e.matches ? 'dark' : 'light')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolved: ResolvedTheme = preference === 'system' ? systemResolved : preference

  // Apply the resolved theme to <html>, but persist the *preference* so a
  // 'system' choice survives reloads.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved)
    try { localStorage.setItem(STORAGE_KEY, preference) } catch { /* ignore */ }
  }, [resolved, preference])

  const value: ThemeContextValue = {
    preference,
    resolved,
    setPreference: setPreferenceState,
  }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
