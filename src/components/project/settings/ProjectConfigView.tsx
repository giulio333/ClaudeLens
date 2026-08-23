import { useEffectiveConfig } from '../../../hooks/useIPC';
import { PROJECT_PURGE_ENABLED } from '../shared/project-purge';
import { GeneralTab, PermissionsTab, ToolsTab, McpTab, ExtensionsTab } from './SettingsView';

// Project-scoped variant of the Settings page. Resolves the effective config
// against the project's own working directory (so the `project`/`local` tiers
// of `.claude/settings*.json` are included), then renders the same building
// blocks stacked vertically — flat scroll, no inner tab rail — to fit the
// editorial project chrome (hero + subtabs). Read-only, like the global page.

type Project = { hash: string; realPath: string };

export function ProjectConfigView({
  project,
  onDeleteProject,
}: {
  project: Project;
  onDeleteProject: () => void;
}) {
  const { data, isLoading, error, refetch, isFetching } = useEffectiveConfig(project.realPath);

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
