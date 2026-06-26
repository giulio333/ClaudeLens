import { useEffectiveConfig } from '../../../hooks/useIPC'
import {
  GeneralTab,
  PermissionsTab,
  ToolsTab,
  McpTab,
  ExtensionsTab,
} from './SettingsView'

// Project-scoped variant of the Settings page. Resolves the effective config
// against the project's own working directory (so the `project`/`local` tiers
// of `.claude/settings*.json` are included), then renders the same building
// blocks stacked vertically — flat scroll, no inner tab rail — to fit the
// editorial project chrome (hero + subtabs). Read-only, like the global page.

type Project = { hash: string; realPath: string }

export function ProjectConfigView({ project }: { project: Project }) {
  const { data, isLoading, error, refetch, isFetching } = useEffectiveConfig(project.realPath)

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
          <McpTab cfg={data} q="" heading />
          <ExtensionsTab cfg={data} q="" heading />
          {/* Sources tab (raw merged tiers + JSON dumps) is intentionally omitted
              here — it's a low-level detail; per-field provenance badges already
              show which file each value comes from. The full Sources view lives
              on the global Settings page. */}
        </div>
      ) : null}
    </section>
  )
}
