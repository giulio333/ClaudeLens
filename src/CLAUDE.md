# src/ — renderer

The React app in the Electron renderer. `main.tsx` mounts `App` inside `React.StrictMode`; `App.tsx`
sets up the providers and `useDataChangedRefetch()`; `tabs/ProjectOverview.tsx` is the navigation
shell. The feature components and their rules are in `components/project/CLAUDE.md`, the shared
ones (`Markdown`, wikilinks, `LiveOrb`, the banners) in `components/CLAUDE.md`.

## Adding a view

1. Add the case to the `View` union in `components/project/types.ts`.
2. Add the IPC hook to `hooks/useIPC.ts` if the view needs data.
3. Put the component in `components/project/<domain>/`.
4. Add the `case` to the `switch (view.type)` in `tabs/ProjectOverview.tsx`.
5. Reach it with `onNavigate({ type: '…' })`.

## Conventions

- Navigation state has one owner: `ProjectOverview`, through the `useTerminalNav` reducer
  (`components/project/terminal/use-terminal-nav.ts`), which also keeps the embedded terminals
  alive. Components receive `onNavigate`/`onBack`.
- Data comes from the React Query hooks in `hooks/useIPC.ts`; `unwrap()` throws on an error result.
  `useDataChangedRefetch()` invalidates only the namespaces a `data:changed` names, and everything
  when the event carries none.
- Theme: `hooks/useTheme.ts` + `hooks/ThemeProvider.tsx` (split for the fast-refresh rule). The
  preference lives in `localStorage['cl-theme']` and is applied as `<html data-theme>`.
