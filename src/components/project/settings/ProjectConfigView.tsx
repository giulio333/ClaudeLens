import { useMemo } from 'react';
import type { ClaudeMdLayer } from '../../../types';
import { useClaudeMdHierarchy, useEffectiveConfig } from '../../../hooks/useIPC';
import { PROJECT_PURGE_ENABLED } from '../shared/project-purge';
import type { View } from '../types';
import { GeneralTab, PermissionsTab, ToolsTab, McpTab, ExtensionsTab } from './SettingsView';

const CLAUDE_MD_SCOPE_LABEL: Record<'global' | 'project' | 'local' | 'subdir', string> = {
  project: 'Project',
  local: 'Local',
  subdir: 'Subdir',
  global: 'Global',
};

/** Ogni layer è un CLAUDE.md, quindi lo scope da solo non distingue una riga
 *  dall'altra: quattro righe su sei si chiamavano "Subdir". Quello che le
 *  distingue è la cartella che governano, così il path diventa il nome della
 *  riga e viene spezzato in genitori (smorzati) + segmento identificante +
 *  nome file (smorzato): la lista si legge sul segmento in evidenza senza
 *  perdere il path intero. */
function claudeMdPathParts(layer: ClaudeMdLayer, rootPath: string) {
  if (layer.scope === 'global') {
    return { prefix: '~/.claude/', focus: 'CLAUDE.md', suffix: '' };
  }
  const rel = layer.filePath.startsWith(rootPath + '/')
    ? layer.filePath.slice(rootPath.length + 1)
    : layer.filePath;
  const cut = rel.lastIndexOf('/');
  if (cut === -1) return { prefix: '', focus: rel, suffix: '' };
  const dir = rel.slice(0, cut);
  const up = dir.lastIndexOf('/');
  return {
    prefix: up === -1 ? '' : dir.slice(0, up + 1),
    focus: dir.slice(up + 1) + '/',
    suffix: rel.slice(cut + 1),
  };
}

// Project-scoped variant of the Settings page. Resolves the effective config
// against the project's own working directory (so the `project`/`local` tiers
// of `.claude/settings*.json` are included), then renders the same building
// blocks stacked vertically — flat scroll, no inner tab rail — to fit the
// editorial project chrome (hero + subtabs). Read-only, like the global page.

type Project = { hash: string; realPath: string };

export function ProjectConfigView({
  project,
  onNavigate,
  onDeleteProject,
}: {
  project: Project;
  onNavigate: (v: View) => void;
  onDeleteProject: () => void;
}) {
  const { data, isLoading, error, refetch, isFetching } = useEffectiveConfig(project.realPath);
  const { data: claudeMd } = useClaudeMdHierarchy(project.realPath);

  // Ordinati come la cascata che l'intestazione annuncia (global → project →
  // local → subdir), non con il project in testa: la riga d'intestazione fa da
  // legenda della lista solo se la lista la segue. I subdir vengono dopo, per
  // profondità e poi alfabetici, così il ramo si legge dall'alto.
  const claudeMdLayerList = useMemo(() => {
    const order = { global: 0, project: 1, local: 2, subdir: 3 } as const;
    const rows = [...(claudeMd?.layers ?? [])]
      .map(layer => ({ layer, lines: layer.content.split('\n').length }))
      .sort((a, b) => {
        const byScope = order[a.layer.scope] - order[b.layer.scope];
        if (byScope !== 0) return byScope;
        const depth = a.layer.filePath.split('/').length - b.layer.filePath.split('/').length;
        return depth !== 0 ? depth : a.layer.filePath.localeCompare(b.layer.filePath);
      });
    const maxLines = rows.reduce((m, r) => Math.max(m, r.lines), 1);
    return rows.map(r => ({ ...r, weight: r.lines / maxLines }));
  }, [claudeMd]);
  const claudeMdLayers = claudeMdLayerList.length;

  return (
    <section className="cl-section" style={{ paddingTop: 38 }}>
      <div className="cl-sec-head">
        <h2>Effective configuration</h2>
        <span className="ct">resolved for this project · via Agent SDK</span>
        <button className="all" type="button" onClick={() => refetch()}>
          {isFetching ? 'Loading…' : 'Reload'}
        </button>
      </div>

      {isLoading ? (
        <div className="cl-empty">Reading configuration via the Agent SDK…</div>
      ) : error ? (
        <div className="cl-empty">Failed to read configuration: {(error as Error).message}</div>
      ) : data ? (
        <div style={{ maxWidth: 660, marginTop: 22 }}>
          <GeneralTab cfg={data} q="" heading />
          <PermissionsTab cfg={data} q="" heading />
          <ToolsTab cfg={data} q="" heading />
          <McpTab cwd={data.cwd} q="" heading />
          <ExtensionsTab cfg={data} q="" heading />
          {/* Sources tab (raw merged tiers + JSON dumps) is intentionally omitted
              here — it's a low-level detail; per-field provenance badges already
              show which file each value comes from. The full Sources view lives
              on the global Settings page. */}
        </div>
      ) : null}

      {/* The CLAUDE.md cascade, moved here from the Overview when design 3b
          stripped the landing to the hero and its session list. It belongs to
          a configuration page anyway: these files are instructions resolved in
          tiers, exactly like the settings above, and this is the only way into
          a project layer. */}
      <div className="cl-sec-head" style={{ marginTop: 44 }}>
        <h2>CLAUDE.md</h2>
        <span className="ct">
          {claudeMdLayers} {claudeMdLayers === 1 ? 'layer' : 'layers'} · global → project → local →
          subdir
        </span>
      </div>
      {claudeMdLayers === 0 ? (
        <div className="cl-empty">No CLAUDE.md instructions for this project.</div>
      ) : (
        /* Una colonna sola: la cascata è una sequenza ordinata, e la
           griglia a due colonne la faceva leggere a zig-zag. */
        <div className="cl-md-cascade" style={{ maxWidth: 660 }}>
          {claudeMdLayerList.map(({ layer: l, lines, weight }) => {
            const { prefix, focus, suffix } = claudeMdPathParts(l, project.realPath);
            return (
              <button
                key={l.filePath}
                type="button"
                className="cl-md-layer"
                data-scope={l.scope}
                title={l.scope === 'global' ? '~/.claude/CLAUDE.md' : l.filePath}
                onClick={() =>
                  l.scope === 'global'
                    ? onNavigate({ type: 'global-claudemd' })
                    : onNavigate({ type: 'project-claudemd', project, layer: l })
                }
              >
                <span className="scope">{CLAUDE_MD_SCOPE_LABEL[l.scope]}</span>
                <span className="path">
                  {prefix && <span className="dim">{prefix}</span>}
                  <span className="focus">{focus}</span>
                  {suffix && <span className="dim">{suffix}</span>}
                </span>
                {/* 36 righe contro 882: la barra dice a colpo d'occhio
                    quale layer pesa davvero nel contesto. */}
                <span className="weight" aria-hidden="true">
                  <i style={{ width: `${Math.max(4, Math.round(weight * 100))}%` }} />
                </span>
                <span className="lines">
                  <b>{lines}</b> lines
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* The only visible way to delete a project. It used to be a "Remove
          current" button in the search popover's status bar — findable only by
          someone who already knew it was there.

          Gated on PROJECT_PURGE_ENABLED, which was off for v2.2.13: the purge
          reached projects the user had not selected and the plan on screen did
          not say so (#224). It is on again now that the dialog names every
          project in the plan and refuses one that holds more than this project.
          The flag carries the full account. */}
      {PROJECT_PURGE_ENABLED && (
        <div style={{ maxWidth: 660, marginTop: 44 }}>
          <div className="set-block-head">
            <span className="lbl">Danger zone</span>
          </div>
          <div className="cl-danger-zone">
            <div className="cl-danger-zone-body">
              <strong>Delete this project&rsquo;s Claude Code state</strong>
              <span>
                Transcripts, tasks, file history and its entry in{' '}
                <span className="font-mono">~/.claude.json</span>. Your source files are never
                touched. You&rsquo;ll see exactly what goes — named project by project — before
                confirming.
              </span>
            </div>
            <button type="button" className="cl-danger-zone-btn" onClick={onDeleteProject}>
              Delete state…
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
