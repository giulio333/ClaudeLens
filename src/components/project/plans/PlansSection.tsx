import { useMemo, useState } from 'react';
import { useProjectPlans, useSessionList, useUnlinkedPlans } from '../../../hooks/useIPC';
import type { Plan, SessionSummary } from '../../../types';
import { fmtDate, sessionTitle } from '../utils';

type Project = { hash: string; realPath: string };
type StatusKey = 'approved' | 'proposed' | 'deleted' | 'unlinked';
type FilterKey = 'all' | StatusKey;
type SortKey = 'recent' | 'status';

// I piani non collegati non hanno sessione: entrano nella stessa lista piatta
// sotto un id sentinella, così filtri, conteggi e ordinamento restano un solo
// percorso e il gruppo sintetico si ordina in fondo da sé (data 0).
const UNLINKED_GROUP = '__unlinked__';

const STATUS_LABEL: Record<StatusKey, string> = {
  approved: 'APPROVED',
  proposed: 'PROPOSED',
  deleted: 'DELETED',
  unlinked: 'UNLINKED',
};

function statusKey(p: Plan): StatusKey {
  if (p.status === 'unlinked') return 'unlinked';
  if (!p.exists) return 'deleted';
  return p.status === 'approved' ? 'approved' : 'proposed';
}

const PLAN_PREVIEW_MAX = 180;
const PLAN_EXCERPT_MAX = 460;

// Ripulisce il markdown del piano in testo piano.
function planText(raw: string | null): string {
  if (!raw) return '';
  return raw
    .replace(/^---\n[\s\S]*?\n---\n?/, '') // frontmatter
    .replace(/```[\s\S]*?```/g, ' ') // blocchi codice
    .replace(/`([^`]+)`/g, '$1') // codice inline
    .replace(/^#{1,6}\s+/gm, '') // heading
    .replace(/[*_~>#]/g, '') // marcatori
    .replace(/\s+/g, ' ')
    .trim();
}

function clamp(s: string, max: number): string {
  return s.length > max ? s.slice(0, max).trimEnd() + '…' : s;
}

// Anteprima su due righe per la riga del piano.
function planPreview(raw: string | null): string {
  return clamp(planText(raw), PLAN_PREVIEW_MAX);
}

// Estratto più ampio mostrato nell'espansione inline (non l'intero piano).
function planExcerpt(raw: string | null): string {
  return clamp(planText(raw), PLAN_EXCERPT_MAX);
}

function StatusBadge({ k }: { k: StatusKey }) {
  return (
    <span className={`cl-plan-badge cl-mono ${k}`}>
      <i />
      {STATUS_LABEL[k]}
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`cl-plan-chev${open ? ' is-open' : ''}`}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

type FlatPlan = {
  plan: Plan;
  key: string;
  k: StatusKey;
  sessionId: string;
  sessionName: string;
  sessionDate: number;
};

export function PlansSection({
  project,
  onOpenChat,
  onOpenPlan,
}: {
  project: Project;
  onOpenChat: (session: SessionSummary) => void;
  onOpenPlan: (plan: Plan) => void;
}) {
  const { data: groups = [], isLoading: loadingGroups } = useProjectPlans(project.hash);
  const { data: unlinked = [], isLoading: loadingUnlinked } = useUnlinkedPlans();
  const { data: sessions = [] } = useSessionList(project.hash);
  // Entrambe le sorgenti: attendere solo i gruppi farebbe lampeggiare "No plans
  // recorded" su un progetto che ha solo piani non collegati.
  const isLoading = loadingGroups || loadingUnlinked;

  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [openKey, setOpenKey] = useState<string | null>(null);

  const sessionByFilename = useMemo(() => {
    const map = new Map<string, SessionSummary>();
    for (const s of sessions) map.set(s.filename, s);
    return map;
  }, [sessions]);

  // Lista piatta arricchita con info di sessione (nome + data) per filtri e ordinamento.
  const flat = useMemo<FlatPlan[]>(() => {
    const arr: FlatPlan[] = [];
    for (const g of groups) {
      const session = sessionByFilename.get(g.filename);
      const sessionName = session ? sessionTitle(session) : g.sessionId.slice(0, 8);
      const sessionDate = session ? new Date(session.date).getTime() || 0 : 0;
      g.plans.forEach((plan, i) => {
        arr.push({
          plan,
          key: `${g.sessionId}:${plan.filePath}:${i}`,
          k: statusKey(plan),
          sessionId: g.sessionId,
          sessionName,
          sessionDate,
        });
      });
    }
    // Data 0: nessuna sessione da cui ereditarla, e i gruppi si ordinano per
    // data decrescente — il gruppo sintetico finisce così in coda.
    unlinked.forEach((plan, i) => {
      arr.push({
        plan,
        key: `${UNLINKED_GROUP}:${plan.filePath}:${i}`,
        k: statusKey(plan),
        sessionId: UNLINKED_GROUP,
        sessionName: 'Unlinked plans',
        sessionDate: 0,
      });
    });
    return arr;
  }, [groups, unlinked, sessionByFilename]);

  const counts = useMemo(() => {
    const c = { all: flat.length, approved: 0, proposed: 0, deleted: 0, unlinked: 0 };
    for (const f of flat) c[f.k] += 1;
    return c;
  }, [flat]);

  const q = query.trim().toLowerCase();
  const match = (f: FlatPlan) =>
    (filter === 'all' || f.k === filter) &&
    (q === '' ||
      `${f.plan.title} ${f.plan.content ?? ''} ${f.sessionName}`.toLowerCase().includes(q));

  const STATUS_ORDER: Record<StatusKey, number> = {
    proposed: 0,
    approved: 1,
    deleted: 2,
    unlinked: 3,
  };

  // Gruppi per sessione, rispettando filtro + ricerca, ordinati.
  const visibleGroups = useMemo(() => {
    const bySession = new Map<
      string,
      { sessionId: string; name: string; date: number; session?: SessionSummary; items: FlatPlan[] }
    >();
    for (const f of flat) {
      if (!match(f)) continue;
      let g = bySession.get(f.sessionId);
      if (!g) {
        const filename = groups.find(gr => gr.sessionId === f.sessionId)?.filename;
        g = {
          sessionId: f.sessionId,
          name: f.sessionName,
          date: f.sessionDate,
          session: filename ? sessionByFilename.get(filename) : undefined,
          items: [],
        };
        bySession.set(f.sessionId, g);
      }
      g.items.push(f);
    }
    const arr = [...bySession.values()];
    arr.sort((a, b) => b.date - a.date);
    if (sort === 'status') {
      for (const g of arr) g.items.sort((a, b) => STATUS_ORDER[a.k] - STATUS_ORDER[b.k]);
    }
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flat, filter, q, sort, groups, sessionByFilename]);

  const visibleCount = visibleGroups.reduce((n, g) => n + g.items.length, 0);

  // Header: conta i piani distinti per filePath (lo stesso piano può comparire
  // in più sessioni; nella lista lo mostriamo comunque per ogni sessione).
  const distinctCount = useMemo(() => {
    const seen = new Set<string>();
    for (const g of visibleGroups) for (const it of g.items) seen.add(it.plan.filePath);
    return seen.size;
  }, [visibleGroups]);

  const chips: [FilterKey, string][] = [
    ['all', 'ALL'],
    ['approved', 'APPROVED'],
    ['proposed', 'PROPOSED'],
    ['deleted', 'DELETED'],
    ['unlinked', 'UNLINKED'],
  ];

  return (
    <section className="cl-section cl-plans" style={{ paddingTop: 38 }}>
      <div className="cl-plans-head">
        <div className="cl-plans-title-wrap">
          <h2>Plans</h2>
          <span className="cl-plans-sub cl-mono">
            {distinctCount} {distinctCount === 1 ? 'plan' : 'plans'} · {visibleGroups.length}{' '}
            {visibleGroups.length === 1 ? 'session' : 'sessions'}
          </span>
        </div>
        <div className="cl-plans-search">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            className="cl-mono"
            placeholder="filter plans…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="cl-plans-controls">
        <div className="cl-plans-chips">
          {chips.map(([id, label]) => (
            <button
              key={id}
              className={`cl-plan-chip cl-mono ${id}${filter === id ? ' is-on' : ''}`}
              onClick={() => setFilter(id)}
            >
              <i />
              {label}
              <span className="ct">{counts[id]}</span>
            </button>
          ))}
        </div>
        <div className="cl-plans-sort cl-mono">
          <span className="lbl">sort</span>
          <button className={sort === 'recent' ? 'is-on' : ''} onClick={() => setSort('recent')}>
            recent
          </button>
          <button className={sort === 'status' ? 'is-on' : ''} onClick={() => setSort('status')}>
            status
          </button>
        </div>
      </div>

      <div className="cl-plans-body">
        {isLoading ? (
          <div className="cl-empty">Loading plans…</div>
        ) : flat.length === 0 ? (
          <div className="cl-empty">No plans recorded for this project.</div>
        ) : visibleCount === 0 ? (
          <div className="cl-empty">No plans match your filters.</div>
        ) : (
          visibleGroups.map(g => (
            <section key={g.sessionId} className="cl-plan-group">
              <div className="cl-plan-eyebrow cl-mono">
                <span className="dot" />
                <span className="name">{g.name}</span>
                <span className="meta">
                  {g.items.length} {g.items.length === 1 ? 'plan' : 'plans'}
                  {g.sessionId === UNLINKED_GROUP
                    ? ' · in ~/.claude/plans, not referenced by any session'
                    : g.date
                      ? ` · ${fmtDate(new Date(g.date).toISOString())}`
                      : ''}
                  {g.session && (
                    <button type="button" className="open" onClick={() => onOpenChat(g.session!)}>
                      open chat ↗
                    </button>
                  )}
                </span>
              </div>

              <div className="cl-plan-rows">
                {g.items.map(f => {
                  const { plan, key } = f;
                  const expanded = openKey === key;
                  // Status reale (proposed/approved/unlinked) e cancellazione sono
                  // dimensioni ortogonali: il badge mostra sempre lo status, la
                  // cancellazione è indicata dal titolo barrato + opacità ridotta.
                  const statusK: StatusKey =
                    plan.status === 'unlinked'
                      ? 'unlinked'
                      : plan.status === 'approved'
                        ? 'approved'
                        : 'proposed';
                  return (
                    <div
                      key={key}
                      className={`cl-plan-row ${statusK}${plan.exists ? '' : ' is-deleted'}${expanded ? ' is-expanded' : ''}`}
                    >
                      <div
                        className="cl-plan-row-head"
                        role="button"
                        tabIndex={0}
                        onClick={() => setOpenKey(cur => (cur === key ? null : key))}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setOpenKey(cur => (cur === key ? null : key));
                          }
                        }}
                      >
                        <div className="cl-plan-row-body">
                          <div className="cl-plan-title-line">
                            <span className={`cl-plan-title${plan.exists ? '' : ' is-deleted'}`}>
                              {plan.title || '(untitled plan)'}
                            </span>
                            <StatusBadge k={statusK} />
                          </div>
                          {plan.content ? (
                            <p className="cl-plan-summary">{planPreview(plan.content)}</p>
                          ) : (
                            <p className="cl-plan-summary is-muted">Plan file no longer on disk.</p>
                          )}
                          <div className="cl-plan-meta cl-mono">
                            <span className="path">plans/{plan.slug}.md</span>
                            {plan.gitBranch && (
                              <>
                                <span className="sep">·</span>
                                <span>{plan.gitBranch}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="cl-plan-row-aside">
                          {plan.exists && (
                            <button
                              type="button"
                              className="cl-plan-action"
                              title="Open plan"
                              aria-label="Open plan"
                              onClick={e => {
                                e.stopPropagation();
                                onOpenPlan(plan);
                              }}
                            >
                              ↗
                            </button>
                          )}
                          <Chevron open={expanded} />
                        </div>
                      </div>
                      {expanded && (
                        <div className="cl-plan-detail">
                          {plan.content ? (
                            <>
                              <p className="cl-plan-excerpt">{planExcerpt(plan.content)}</p>
                              <button
                                type="button"
                                className="cl-plan-full"
                                onClick={e => {
                                  e.stopPropagation();
                                  onOpenPlan(plan);
                                }}
                              >
                                View full plan ↗
                              </button>
                            </>
                          ) : (
                            <p className="cl-plan-summary is-muted">Plan file no longer on disk.</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </section>
  );
}
