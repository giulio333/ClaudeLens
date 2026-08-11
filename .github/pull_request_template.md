<!--
Thanks for contributing to ClaudeLens!
See CONTRIBUTING.md for setup, scripts, and conventions.
-->

## What this changes

<!-- One or two sentences: what the PR does and why. -->

Closes #

## How to verify

<!--
Steps a reviewer can follow against their own ~/.claude/ data.
Hooks and pure modules are covered by `npm test`; layout and styling are not,
so visual changes still need a manual pass.
-->

## Checklist

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] `npm run build` passes
- [ ] Visual changes validated manually with `npm run dev`
- [ ] Tests added or updated — pure modules under `electron/modules/`, and
      renderer hooks holding stream or cache state (see
      `test/helpers/fake-electron-api.ts`)
- [ ] `CLAUDE.md` updated if the architecture, an IPC namespace, or a convention changed

## Screenshots

<!-- For UI changes: before/after, and both light and dark theme. -->
