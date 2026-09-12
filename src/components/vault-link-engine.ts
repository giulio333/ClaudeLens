// The machinery behind the `[[wikilink]]` chips: contexts, the batching engine,
// and the hooks `Markdown.tsx` and the chip use. The components themselves live
// in `VaultLinks.tsx` — same split as `CreateFormKit`/`formKit`, for the same
// reason (a file exporting both components and non-components loses fast
// refresh, and `--max-warnings 0` makes that a build failure).
//
// ── Why a provider and not a hook per link ───────────────────────────────────
// Resolution is an IPC round trip and a transcript holds hundreds of messages.
// The engine collects the names every `<Markdown>` reports in a tick and asks
// once, so a whole visible transcript costs one call rather than one per link.
// It also means the renderer receives an ANSWER, not a listing: the index stays
// in the main process (`electron/modules/vault-index.ts`).
//
// ── Why two contexts ─────────────────────────────────────────────────────────
// `<Markdown>` is memoized because re-parsing markdown and re-highlighting every
// fenced block is the costliest thing the renderer does per paint. It consumes
// only the API context, which is stable for as long as the project is, so
// answers arriving cannot re-render every bubble in the transcript. The states
// context changes on every answer and is consumed only by the chips, which
// re-render on their own without their parents.
//
// ── Why an engine object and not refs ────────────────────────────────────────
// All the mutable bookkeeping (what has been asked, what is queued, the timer)
// belongs to one project root and must be replaced wholesale when the root
// changes. A plain closure created in a `useMemo` says exactly that, and keeps
// the component free of refs mutated during render.

import { createContext, useContext, useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { VaultLinkAnswer } from '../types';

export type VaultLinkState =
  | { status: 'pending' }
  | { status: 'resolved'; rel: string; match: 'exact' | 'fuzzy' }
  | { status: 'missing' }
  /** The lookup failed. Not the same as missing — we do not know, so we do not say. */
  | { status: 'unknown' };

export interface VaultLinksApi {
  root: string;
  /** Report names a message cites; unknown ones are queued for the next batch. */
  request: (targets: string[]) => void;
  /** Hand a resolved file to the OS — the citations are PDFs as often as notes. */
  open: (rel: string) => void;
}

export interface VaultLinkEngine extends VaultLinksApi {
  /** Stop answering: a reply that arrives after this changes nothing. */
  dispose: () => void;
}

export const EMPTY_STATES: ReadonlyMap<string, VaultLinkState> = new Map();

export const VaultLinksApiContext = createContext<VaultLinksApi | null>(null);
export const VaultLinkStatesContext =
  createContext<ReadonlyMap<string, VaultLinkState>>(EMPTY_STATES);

/** Must match `MAX_VAULT_TARGETS` in `electron/main.ts`, which truncates past it. */
const BATCH_SIZE = 64;

type SetStates = Dispatch<SetStateAction<ReadonlyMap<string, VaultLinkState>>>;

export function createVaultLinkEngine(root: string, setStates: SetStates): VaultLinkEngine {
  /** Every name already asked about: what keeps a repeated citation to one call. */
  const asked = new Set<string>();
  let queue = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function apply(slice: string[], answers: VaultLinkAnswer[] | null): void {
    // An answer for a project the view has already left changes nothing.
    if (disposed) return;
    setStates(prev => {
      const next = new Map(prev);
      if (answers) {
        for (const a of answers) {
          next.set(
            a.target,
            a.rel ? { status: 'resolved', rel: a.rel, match: a.match } : { status: 'missing' }
          );
        }
      } else {
        // A failed lookup must not read as "the file is not there".
        for (const t of slice) next.set(t, { status: 'unknown' });
      }
      return next;
    });
  }

  function flush(): void {
    timer = null;
    if (disposed) return;
    const names = [...queue];
    queue = new Set();
    for (let i = 0; i < names.length; i += BATCH_SIZE) {
      const slice = names.slice(i, i + BATCH_SIZE);
      void window.electronAPI.vault
        .resolveLinks(root, slice)
        .then(({ data }) => apply(slice, data))
        .catch(() => apply(slice, null));
    }
  }

  return {
    root,
    request(targets) {
      if (disposed) return;
      let queued = false;
      for (const t of targets) {
        if (asked.has(t)) continue;
        asked.add(t);
        queue.add(t);
        queued = true;
      }
      // A zero delay, not a microtask: it coalesces the whole batch of bubbles
      // React mounts in one commit into a single call.
      if (queued && timer === null) timer = setTimeout(flush, 0);
    },
    open(rel) {
      if (disposed) return;
      void window.electronAPI.vault.openFile(root, rel);
    },
    dispose() {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

/** Null outside a provider — which is what keeps `[[…]]` plain text there. */
export function useVaultLinksApi(): VaultLinksApi | null {
  return useContext(VaultLinksApiContext);
}

export function useVaultLinkState(target: string): VaultLinkState {
  return useContext(VaultLinkStatesContext).get(target) ?? { status: 'pending' };
}

/**
 * Reports the names a message cites, so the engine can ask about them.
 *
 * Called from `<Markdown>` with the targets parsed out of its own text. The
 * effect — not the render — is what queues them, so a double render under
 * StrictMode costs nothing beyond a set lookup.
 */
export function useReportWikiLinks(targets: string[]): void {
  const request = useVaultLinksApi()?.request;
  useEffect(() => {
    if (request && targets.length > 0) request(targets);
  }, [request, targets]);
}
