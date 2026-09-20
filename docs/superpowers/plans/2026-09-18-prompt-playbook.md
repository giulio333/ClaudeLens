# Prompt Playbook Implementation Plan

**Goal:** Reuse project prompts from Mission Control and the SDK composer.

**Architecture:** A project-scoped store and pure candidate detector feed typed
`playbook:*` IPC. A shared panel in Mission Control and a popover in the SDK composer insert
into the active input without sending.

**Tech Stack:** TypeScript, Electron, React, React Query, xterm, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-18-prompt-playbook-design.md`

## Global constraints

- English UI and existing brand tokens; no new dependencies.
- Synthetic committed fixtures; real corpus probes are read-only aggregate output.

## Task 1: Backend

- [x] Add `electron/shared/playbook-types.ts`, `electron/modules/playbook*.ts`
      and `test/playbook*.test.ts` for persistence and candidate extraction.
- [x] Implement `getTemplates(hash)`, `getCandidates(hash)`,
      `create/promote(hash, {name,text})`, `update(hash,id,{name,text})`,
      `delete(hash,id)`, `dismiss(hash,text)` through main and preload.
- [x] Verify persistence, normalized exclusion, distinct sessions, queued human
      messages, corruption, input validation and isolation with temporary directories.

## Task 2: Renderer

- [x] Add typed bridge declarations and lazy query/mutation hooks in `useIPC.ts`.
- [x] Build shared `PromptPlaybook.tsx` and styles, covering saved CRUD, suggestions,
      promotion/dismissal, copy, loading/error/partial/empty states and keyboard close.
- [x] Integrate with `ChatComposer.tsx` (append draft) and
      `TerminalMissionControl.tsx` (reveal Terminal before insertion).
- [x] Test lazy scans, project changes, mutation failures, copying and draft
      preservation in StrictMode through the fake preload bridge.

## Task 3: Terminal

- [x] Expose `pastePrompt(text): Promise<void>` from `TerminalPane`.
- [x] Wait for bracketed-paste readiness; reject timeout/exit/disposal/control
      characters; paste once and focus without adding Enter.
- [x] Verify multiline insertion and lifecycle races with focused tests.

## Task 4: Integration verification

- [x] Read-only local corpus probe; retain no private text in fixtures or reports.
- [x] Review changes across IPC, popover and terminal insertion.
- [x] Run scoped tests, `npm run typecheck`, `npm run lint`, `npm test`,
      `npm run build`, and formatting checks for touched files.
- [x] Report results and the remaining manual UI check to the user.

## Verification record

- Persistence, candidate extraction, renderer interactions, and terminal insertion
  are covered by automated tests, including real xterm output and StrictMode.
- Pending insertion is cancelled when returning to Lens, superseding a request,
  opening an overlay, or leaving the session; regression tests cover these races.
- Mission Control preserves activity filters while Playbook is open and scopes
  Escape handling to the panel so terminal keyboard input remains independent.
- TypeScript, ESLint, touched-file formatting, build, and the full test suite pass.
- Fixtures are synthetic. Local corpus measurements and transcript contents are
  not retained in repository documentation or tests.
