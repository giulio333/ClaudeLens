// The `[[wikilink]]` chips.
//
// Claude cites its sources as `[[Procedura Upload Tesi.pdf]]` and the page used
// to render that as text, which means a citation of a file that is really on
// disk and a citation of a file Claude invented looked exactly the same. The
// chip is that distinction made visible: solid and clickable when the project
// has the file, dashed and inert when it does not.
//
// Outside a provider there are no chips at all and `[[…]]` renders byte-
// identical to before. That is deliberate — the memory views carry wikilinks of
// their own that point at topics under `~/.claude`, not at files in the project,
// and resolving those against the filesystem would mark every one of them as a
// missing source.
//
// The batching, the contexts and the hooks live in `vault-link-engine.ts`.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  createVaultLinkEngine,
  EMPTY_STATES,
  useVaultLinkState,
  useVaultLinksApi,
  VaultLinkStatesContext,
  VaultLinksApiContext,
  type VaultLinkState,
} from './vault-link-engine';

export function VaultLinksProvider({ root, children }: { root: string; children: ReactNode }) {
  const [states, setStates] = useState<ReadonlyMap<string, VaultLinkState>>(EMPTY_STATES);

  // Switching project drops every answer during render rather than in an effect,
  // so a chip never paints once with the previous project's verdict.
  const [prevRoot, setPrevRoot] = useState(root);
  if (prevRoot !== root) {
    setPrevRoot(root);
    setStates(EMPTY_STATES);
  }

  const engine = useMemo(() => createVaultLinkEngine(root, setStates), [root]);
  useEffect(() => () => engine.dispose(), [engine]);

  return (
    <VaultLinksApiContext.Provider value={engine}>
      <VaultLinkStatesContext.Provider value={states}>{children}</VaultLinkStatesContext.Provider>
    </VaultLinksApiContext.Provider>
  );
}

/** The rendered `[[…]]`: solid when the project has the file, dashed when it does not. */
export function WikiLink({ target, label }: { target: string; label: string }) {
  const api = useVaultLinksApi();
  const state = useVaultLinkState(target);

  if (state.status === 'resolved') {
    const title =
      state.match === 'fuzzy'
        ? `${state.rel} — matched on the end of the path, not the whole name`
        : state.rel;
    return (
      <button
        type="button"
        className="cl-wikilink cl-wikilink-found"
        title={title}
        onClick={() => api?.open(state.rel)}
      >
        {label}
      </button>
    );
  }

  if (state.status === 'missing') {
    return (
      <span
        className="cl-wikilink cl-wikilink-missing"
        title="No file in this project answers to this name"
      >
        {label}
      </span>
    );
  }

  // Pending or unresolvable: say nothing about the file, since nothing is known.
  return (
    <span className="cl-wikilink cl-wikilink-idle" title={target}>
      {label}
    </span>
  );
}
