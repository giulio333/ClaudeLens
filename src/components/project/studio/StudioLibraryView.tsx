import { useStudioLibrary } from '../../../hooks/useIPC';
import type { BlueprintSummary } from '../../../types';
import { QueryError } from '../../QueryError';
import { Lens } from '../overview/Lens';
import { TopBar } from '../shared/TopBar';
import { fmtDate } from '../utils';

function StatusPill({ bp }: { bp: BlueprintSummary }) {
  const state =
    bp.errorCount > 0
      ? { label: 'INVALID', color: 'var(--cl-danger)' }
      : !bp.structured
        ? { label: 'SOURCE', color: 'var(--cl-ink-3)' }
        : bp.codeNodeCount > 0
          ? { label: 'HYBRID', color: 'var(--cl-accent)' }
          : { label: 'VISUAL', color: 'var(--cl-ok)' };
  return (
    <span
      className="justify-self-end px-2.5 py-1 rounded-full border font-mono"
      style={{
        fontSize: 9.5,
        letterSpacing: '0.12em',
        color: state.color,
        borderColor: `color-mix(in oklch, ${state.color} 50%, transparent)`,
        background: `color-mix(in oklch, ${state.color} 10%, transparent)`,
      }}
    >
      {state.label}
    </span>
  );
}

function projectLabel(projectPath: string | null): string {
  if (!projectPath) return '';
  const parts = projectPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? projectPath;
}

function composition(bp: BlueprintSummary): string {
  const parts = [`${bp.stepCount}S`];
  if (bp.agentTypes.length > 0) parts.push(`${bp.agentTypes.length}A`);
  if (bp.parallelStepCount > 0) parts.push(`${bp.parallelStepCount}∥`);
  if (bp.codeNodeCount > 0) parts.push(`${bp.codeNodeCount}{}`);
  return parts.join(' · ');
}

function BlueprintRow({ bp, onOpen }: { bp: BlueprintSummary; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-left grid items-center gap-x-5 px-1 py-4 border-b border-[var(--cl-line-soft)] hover:bg-[var(--cl-paper-2)] transition-colors"
      style={{ gridTemplateColumns: '32px minmax(0,1fr) 130px 150px 100px' }}
    >
      <span
        className="inline-flex items-center justify-center w-8 h-8 rounded-[7px] font-mono font-semibold text-[13px]"
        style={
          bp.structured && bp.errorCount === 0
            ? { background: 'var(--cl-accent)', color: 'var(--cl-on-accent)' }
            : {
                background: 'var(--cl-paper-2)',
                border: '1px solid var(--cl-line)',
                color: 'var(--cl-ink-3)',
              }
        }
      >
        {(bp.name[0] ?? '?').toUpperCase()}
      </span>
      <span className="min-w-0">
        <span className="text-[17px] font-medium tracking-[-0.015em] text-[var(--cl-ink)]">
          {bp.name}
        </span>
        {bp.scope === 'project' && (
          <span
            className="ml-2 align-[3px] px-1.5 py-0.5 border font-mono text-[9px] tracking-[0.12em] uppercase"
            style={{ color: 'var(--cl-ink-3)', borderColor: 'var(--cl-line)' }}
            title={bp.projectPath ?? undefined}
          >
            {projectLabel(bp.projectPath)}
          </span>
        )}
        <span className="block truncate font-mono text-[10.5px] text-[var(--cl-ink-4)] mt-1">
          {bp.description || 'no description'}
        </span>
      </span>
      <span className="font-mono text-[11px] text-[var(--cl-ink-2)]">{composition(bp)}</span>
      <span className="font-mono text-[12px] text-[var(--cl-ink)] text-right tabular-nums">
        {bp.updatedAt ? fmtDate(bp.updatedAt) : '—'}
      </span>
      <StatusPill bp={bp} />
    </button>
  );
}

export function StudioLibraryView({
  embedded = false,
  onBack,
  onCreate,
  onOpenBlueprint,
}: {
  embedded?: boolean;
  onBack: () => void;
  onCreate: () => void;
  onOpenBlueprint: (name: string, projectPath?: string) => void;
}) {
  const { data, isLoading, error, refetch } = useStudioLibrary();

  const blueprints = data?.blueprints ?? [];
  const visual = blueprints.filter(b => b.structured && b.codeNodeCount === 0).length;
  const hybrid = blueprints.filter(b => b.structured && b.codeNodeCount > 0).length;
  const sourceOnly = blueprints.filter(b => !b.structured).length;
  const invalid = blueprints.filter(b => b.errorCount > 0).length;
  const projectLocal = blueprints.filter(b => b.scope === 'project').length;

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>
      {!embedded && <TopBar onBack={onBack} crumbs={[{ label: 'Global · Agent Studio' }]} />}

      <div className="flex-1 overflow-y-auto">
        <section className="cl-hero">
          <Lens />
          <div className="cl-hero-actions">
            <button type="button" className="cl-btn cl-btn--primary" onClick={onCreate}>
              + New workflow
            </button>
          </div>
          <div className="cl-eyebrow">
            <span className="pip" />
            <span>Agent Studio · Native workflow library</span>
          </div>
          <h1 className="cl-h-name static">
            <span className="label-name">Studio</span>
            <span className="glyph">.</span>
          </h1>
          <div className="cl-h-meta">
            <span>
              <b>{blueprints.length}</b> {blueprints.length === 1 ? 'workflow' : 'workflows'}
            </span>
            <span className="sep">·</span>
            <span>one script · one source of truth</span>
            <span className="sep">·</span>
            <span className="font-mono" style={{ fontSize: 12 }}>
              ~/.claude/workflows + project .claude/workflows
            </span>
          </div>
        </section>

        <div className="cl-stats">
          <div className="cl-stat">
            <span className="lbl">Workflows</span>
            <div className="num">{blueprints.length}</div>
          </div>
          <div className="cl-stat">
            <span className="lbl">Visual</span>
            <div className="num">{visual}</div>
          </div>
          <div className="cl-stat">
            <span className="lbl">Hybrid</span>
            <div className="num">{hybrid}</div>
          </div>
          <div className="cl-stat">
            <span className="lbl">Source only</span>
            <div className="num">{sourceOnly}</div>
          </div>
          <div className="cl-stat">
            <span className="lbl">Invalid</span>
            <div className="num">{invalid}</div>
          </div>
        </div>

        {error ? (
          <section className="cl-section">
            <QueryError error={error} onRetry={() => void refetch()} />
          </section>
        ) : isLoading ? (
          <section className="cl-section">
            <p style={{ color: 'var(--cl-ink-3)', fontSize: 13 }}>Loading…</p>
          </section>
        ) : (
          <>
            <section className="cl-section">
              <div className="cl-sec-head">
                <h2>Workflows</h2>
                <span className="ct">
                  {blueprints.length} scripts · {blueprints.length - projectLocal} global ·{' '}
                  {projectLocal} project-local
                </span>
              </div>
              {blueprints.length === 0 ? (
                <div className="cl-empty">
                  No workflows yet. Create one visually or add a native .js script to
                  ~/.claude/workflows.
                </div>
              ) : (
                <div style={{ borderTop: '1px solid var(--cl-ink)' }}>
                  {blueprints.map(bp => (
                    <BlueprintRow
                      key={`${bp.projectPath ?? 'global'}:${bp.fileName}`}
                      bp={bp}
                      onOpen={() => onOpenBlueprint(bp.fileName, bp.projectPath ?? undefined)}
                    />
                  ))}
                </div>
              )}
              <div className="pt-3.5 px-1 font-mono text-[10.5px] leading-relaxed text-[var(--cl-ink-4)]">
                Every row is read directly from{' '}
                <span className="text-[var(--cl-ink-2)]">~/.claude/workflows</span> or a project's
                local <span className="text-[var(--cl-ink-2)]">.claude/workflows</span> (tagged with
                the project name). Visual Brief and Flow are projections of the JavaScript file,
                never separate data.
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
