import { useMemo, useState, type ReactNode } from 'react';
import type { ClaudeMdLayer } from '../../../types';
import { useClaudeMdHierarchy, useEffectiveConfig, useGlobalMcp } from '../../../hooks/useIPC';
import { PROJECT_PURGE_ENABLED } from '../shared/project-purge';
import type { View } from '../types';
import {
  RuntimeTab,
  PermissionsTab,
  ToolsTab,
  McpTab,
  ExtensionsTab,
  Row,
  Val,
} from './SettingsView';
import {
  permissionRuleCount,
  projectSettings,
  settingsCascade,
  type CascadeTier,
} from './config-scope';

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

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// Project-scoped variant of the Settings page. Resolves the effective config
// against the project's own working directory (so the `project`/`local` tiers
// of `.claude/settings*.json` are included), then renders the same building
// blocks as a ledger: one flat scroll, no inner tab rail, each domain named in
// the margin so the page can be scanned down its left edge. Read-only, like the
// global page.
//
// What a project page is for is the difference from the user's own settings,
// so the page says it twice, cheaply: the tape names each settings file and how
// much it sets, and the filter reduces the ledger to what this project's files
// set — the answer to "what does this repo change?" without reading every row.

type Project = { hash: string; realPath: string };

/** `all` is the resolved configuration; `here` only what the project's files set. */
type Scope = 'all' | 'here';

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
  // Same query McpTab reads (React Query serves both from one fetch): the
  // margin needs the count the tab lists.
  const { data: mcp } = useGlobalMcp();
  const [scope, setScope] = useState<Scope>('all');

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

  const tiers = useMemo(
    () => (data ? settingsCascade(data.sources, project.realPath) : []),
    [data, project.realPath]
  );
  const setHere = useMemo(
    () => (data ? projectSettings(data.sources, project.realPath) : []),
    [data, project.realPath]
  );

  const init = data?.init;
  const rules = data ? permissionRuleCount(data.effective.permissions) : 0;
  const extensions = init
    ? init.skills.length +
      init.agents.length +
      (init.commands?.length || init.slashCommands.length) +
      init.plugins.length
    : undefined;
  const mcpListed = mcp ? mcp.cloudServers.length + mcp.localServers.length : undefined;

  return (
    <section className="cl-section cl-section--config" style={{ paddingTop: 38 }}>
      <div className="cl-sec-head">
        <h2>Effective configuration</h2>
        <span className="ct">resolved for this project · via Agent SDK</span>
        <div className="cl-cfg-actions">
          <div className="cl-seg cl-seg--paper" role="group" aria-label="Which values to show">
            <button
              type="button"
              className={scope === 'all' ? 'on' : undefined}
              aria-pressed={scope === 'all'}
              onClick={() => setScope('all')}
            >
              All
            </button>
            <button
              type="button"
              className={scope === 'here' ? 'on' : undefined}
              aria-pressed={scope === 'here'}
              onClick={() => setScope('here')}
            >
              This project
            </button>
          </div>
          <button type="button" className="cl-btn-ghost" onClick={() => refetch()}>
            {isFetching ? 'Loading…' : 'Reload'}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="cl-empty">Reading configuration via the Agent SDK…</div>
      ) : error ? (
        <div className="cl-empty">Failed to read configuration: {(error as Error).message}</div>
      ) : null}

      {data && <SettingsTiers tiers={tiers} />}

      <div className="cl-ledger">
        {data && scope === 'here' && (
          <Domain title="Set by this project" meta="from this project’s own settings files">
            {setHere.length === 0 ? (
              <p className="set-dim">Nothing is set by this project’s settings files.</p>
            ) : (
              setHere.map(s => (
                <Row
                  key={`${s.source}:${s.key}`}
                  k={s.label}
                  hint={s.path ?? undefined}
                  src={{ source: s.source }}
                >
                  <Val>{s.value}</Val>
                </Row>
              ))
            )}
            <p className="set-block-hint" style={{ marginTop: 14 }}>
              {setHere.length === 0 ? 'Every value' : 'Everything else'} is inherited from the other
              settings files or Claude Code’s defaults.
            </p>
          </Domain>
        )}

        {data && scope === 'all' && (
          <>
            <Domain title="General" meta="what resolves here">
              <RuntimeTab cfg={data} />
            </Domain>
            <Domain
              title="Permissions"
              meta={rules === 0 ? 'no rules' : plural(rules, 'rule', 'rules')}
            >
              <PermissionsTab cfg={data} q="" />
            </Domain>
            <Domain
              title="Tools"
              meta={init ? `${init.tools.length} the model can call` : undefined}
            >
              <ToolsTab cfg={data} q="" />
            </Domain>
            <Domain
              title="MCP servers"
              meta={mcpListed === undefined ? undefined : `${mcpListed} via claude mcp list`}
            >
              <McpTab cwd={data.cwd} q="" />
            </Domain>
            <Domain
              title="Extensions"
              meta={extensions === undefined ? undefined : `${extensions} available to Claude`}
              grid
            >
              <ExtensionsTab cfg={data} q="" />
            </Domain>
            {/* Sources tab (raw JSON dumps of every tier) is intentionally
                omitted — it's a low-level detail. The tape above names the
                files, and the stamp on each value says which one set it. */}
          </>
        )}

        {/* The CLAUDE.md cascade, moved here from the Overview when design 3b
            stripped the landing to the hero and its session list. It belongs to
            a configuration page anyway: these files are instructions resolved in
            tiers, exactly like the settings above, and this is the only way into
            a project layer. */}
        <Domain
          title="CLAUDE.md"
          meta={
            <>
              {plural(claudeMdLayers, 'layer', 'layers')}
              <br />
              global → project → local → subdir
            </>
          }
        >
          {claudeMdLayers === 0 ? (
            <div className="cl-empty">No CLAUDE.md instructions for this project.</div>
          ) : (
            /* Una colonna sola: la cascata è una sequenza ordinata, e la
               griglia a due colonne la faceva leggere a zig-zag. */
            <div className="cl-md-cascade">
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
        </Domain>

        {/* The only visible way to delete a project. It used to be a "Remove
            current" button in the search popover's status bar — findable only by
            someone who already knew it was there.

            Gated on PROJECT_PURGE_ENABLED, which was off for v2.2.13: the purge
            reached projects the user had not selected and the plan on screen did
            not say so (#224). It is on again now that the dialog names every
            project in the plan and refuses one that holds more than this project.
            The flag carries the full account. */}
        {PROJECT_PURGE_ENABLED && (
          <Domain title="Danger zone">
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
          </Domain>
        )}
      </div>
    </section>
  );
}

/** One domain of the ledger: its name in the margin, its blocks beside it, an
 *  ink rule above. The margin is what makes a long page scannable — read down
 *  the left edge and you have the table of contents. `grid` lays the blocks out
 *  side by side where the column is wide enough (Extensions' short lists). */
function Domain({
  title,
  meta,
  grid,
  children,
}: {
  title: string;
  meta?: ReactNode;
  grid?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="cl-ledger-domain">
      <div className="side">
        <h3>{title}</h3>
        {meta != null && <span className="meta">{meta}</span>}
      </div>
      <div className={grid ? 'body is-grid' : 'body'}>{children}</div>
    </section>
  );
}

/** The settings cascade as a legend: each file, and how many keys it sets. A
 *  tier that sets nothing still has its cell — that is the answer the reader
 *  came for, and a missing cell would read as "not checked". */
export function SettingsTiers({ tiers }: { tiers: CascadeTier[] }) {
  return (
    <div className="cl-cfg-tiers">
      <div className="legend">Settings files · later wins</div>
      <div className="cells">
        {tiers.map(t => (
          <div key={t.key} className={`cell${t.keys === 0 ? ' is-empty' : ''}`}>
            <div className="top">
              <span className={`tier${t.here ? ' here' : ''}`}>{t.label}</span>
              <span className="n">
                {t.keys === 0 ? 'sets nothing' : plural(t.keys, 'key', 'keys')}
              </span>
            </div>
            <span className="path">{t.path ?? '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
