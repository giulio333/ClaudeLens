import { useEffect, useMemo, useState } from 'react';
import {
  useActiveSessions,
  useChatSession,
  useMemoryProjects,
  useProjectTasks,
  useSessionActivity,
} from '../../../hooks/useIPC';
import type { ActiveSession, SessionActivity } from '../../../types';
import { TopBar } from '../shared/TopBar';
import { BetaTag } from '../shared/BetaTag';
import { projectDisplayName } from '../shared/projectName';
import { buildProcessedMessages, AGENT_TOOLS } from '../chat/utils';
import { areaOf } from '../terminal/mission-feed';
import { fmt, fmtCost, fmtModel, formatTokens } from '../utils';
import { projectForCwd } from '../monitor/project-of';
import { buildNotebook } from './notebook';
import type { NotebookModel, NotebookState } from './notebook';
import './notebook.css';

// The Notebook: ONE session read as a sentence, a plan, a diff and its checks —
// no transcript, no chat. A beta behind `NOTEBOOK_ENABLED`; every derivation is
// in `notebook.ts`, this file only draws it.
//
// Three sources, joined by sessionId: the registry says busy/waiting, the tail
// digest says which call is in flight and what it costs, and the transcript the
// Lens reads says what the session wrote. The session's tasks come from
// `~/.claude/tasks`.

const STATE_LABEL: Record<NotebookState, string> = {
  blocked: 'Needs you',
  working: 'Working',
  ready: 'Ready',
  ended: 'Ended',
};

interface Option {
  sessionId: string;
  cwd: string | null;
  title: string;
  active: ActiveSession | undefined;
  activity: SessionActivity | undefined;
  state: NotebookState;
}

function optionsOf(sessions: ActiveSession[], activity: SessionActivity[]): Option[] {
  const byId = new Map(activity.filter(a => !a.endedAt).map(a => [a.sessionId, a]));
  const live = new Set(sessions.map(s => s.sessionId));
  const rows: Option[] = sessions
    .filter(s => s.sessionId)
    .map(s => {
      const a = byId.get(s.sessionId);
      const state: NotebookState =
        s.status === 'waiting'
          ? 'blocked'
          : s.status === 'busy' || (a?.delegates.length ?? 0) > 0
            ? 'working'
            : 'ready';
      return {
        sessionId: s.sessionId,
        cwd: s.cwd,
        title: a?.title?.trim() || 'not named yet',
        active: s,
        activity: a,
        state,
      };
    });
  for (const a of activity) {
    if (a.endedAt && !live.has(a.sessionId)) {
      rows.push({
        sessionId: a.sessionId,
        cwd: a.cwd,
        title: a.title?.trim() || 'not named yet',
        active: undefined,
        activity: a,
        state: 'ended',
      });
    }
  }
  const order: Record<NotebookState, number> = { blocked: 0, working: 1, ready: 2, ended: 3 };
  return rows.sort((x, y) => order[x.state] - order[y.state]);
}

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function useTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export function NotebookView({ onBack }: { onBack: () => void }) {
  const { data: sessions = [], isLoading } = useActiveSessions();
  const { data: activity = [] } = useSessionActivity();
  const { data: allProjects = [] } = useMemoryProjects();
  const options = useMemo(() => optionsOf(sessions, activity), [sessions, activity]);
  const [picked, setPicked] = useState<string | null>(null);
  const option = options.find(o => o.sessionId === picked) ?? options[0] ?? null;

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>
      <TopBar
        onBack={onBack}
        backLabel="Back"
        crumbs={[{ label: 'NOTEBOOK' }]}
        right={<BetaTag />}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="cl-nb">
          {options.length > 1 && (
            <div className="cl-nb-pick" role="group" aria-label="Session">
              {options.map(o => (
                <button
                  key={o.sessionId}
                  type="button"
                  aria-pressed={o.sessionId === option?.sessionId}
                  onClick={() => setPicked(o.sessionId)}
                >
                  <i className={`pip is-${o.state}`} />
                  <span className="t">
                    {o.cwd ? projectDisplayName(o.cwd) : 'Unknown project'} · {o.title}
                  </span>
                </button>
              ))}
            </div>
          )}
          {isLoading ? (
            <p className="cl-nb-none">Loading…</p>
          ) : !option ? (
            <p className="cl-nb-none">
              No session is running. Start one in a terminal and it shows up here.
            </p>
          ) : (
            <NotebookBody
              key={option.sessionId}
              option={option}
              projects={allProjects.map(p => ({ hash: p.hash, realPath: p.realPath }))}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function NotebookBody({
  option,
  projects,
}: {
  option: Option;
  projects: { hash: string; realPath: string }[];
}) {
  const project = projectForCwd(option.cwd, projects);
  const hash = project?.hash ?? '';
  const chat = useChatSession(hash, project ? `${option.sessionId}.jsonl` : null);
  const { data: taskGroups } = useProjectTasks(project?.hash ?? null);
  const now = useTick(option.state === 'blocked');

  const model = useMemo(() => {
    const processed = chat.data ? buildProcessedMessages(chat.data) : [];
    const ownTools = processed.flatMap(p => p.toolGroups).filter(g => !AGENT_TOOLS.has(g.use.name));
    const tasks = taskGroups?.find(g => g.sessionId === option.sessionId)?.tasks ?? [];
    return buildNotebook({
      ownTools,
      tasks,
      active: option.active,
      activity: option.activity,
      realPath: project?.realPath ?? '',
    });
  }, [chat.data, taskGroups, option, project]);

  if (!project) {
    return (
      <p className="cl-nb-none">
        This session's folder is not one of your projects, so its transcript cannot be read.
      </p>
    );
  }
  const waitingSince = option.active?.statusUpdatedAt ?? option.active?.updatedAt ?? null;
  return (
    <div className="cl-nb-cols">
      <section aria-label="Now">
        <Now option={option} model={model} waitingMs={waitingSince ? now - waitingSince : null} />
      </section>
      <section aria-label="Result">
        <Result model={model} realPath={project.realPath} />
      </section>
    </div>
  );
}

function Now({
  option,
  model,
  waitingMs,
}: {
  option: Option;
  model: NotebookModel;
  waitingMs: number | null;
}) {
  const { plan } = model;
  const a = option.activity;
  const ctx = a?.context ? Math.min(100, Math.round((a.context.used / a.context.max) * 100)) : null;
  const tokens = a ? formatTokens(a.tokens) : null;
  return (
    <>
      <div className="cl-nb-eyebrow">
        <span className={`state is-${model.state}`}>{STATE_LABEL[model.state]}</span>
        <span>
          {option.cwd ? projectDisplayName(option.cwd) : 'Unknown project'}
          {a?.model ? ` · ${fmtModel(a.model)}` : ''}
        </span>
      </div>
      <p className="cl-nb-title">{option.title}</p>

      <h1 className={`cl-nb-say${model.state === 'blocked' ? ' is-blocked' : ''}`}>
        {model.headline.lead}
        {model.headline.subject && (
          <>
            {' '}
            <code>{model.headline.subject}</code>
          </>
        )}
      </h1>
      {model.note && (
        <p className="cl-nb-note">
          <i>{model.noteKind}</i>
          <span>{model.note}</span>
        </p>
      )}
      {model.state === 'blocked' && waitingMs !== null && (
        <div className="cl-nb-wait">
          <span>{clock(waitingMs)}</span>
          <small>you have been the bottleneck</small>
        </div>
      )}

      <div className="cl-nb-sec">
        <div className="cl-nb-label">
          <span>Plan</span>
          <span>
            {plan.tasks.length === 0
              ? 'no tasks'
              : plan.current >= 0
                ? `${plan.current + 1} of ${plan.tasks.length}`
                : `${plan.done} of ${plan.tasks.length} done`}
          </span>
        </div>
        {plan.tasks.length > 0 ? (
          <>
            <div className="cl-nb-steps">
              {plan.tasks.map((t, i) => (
                <i
                  key={t.id}
                  title={t.subject}
                  className={
                    t.status === 'completed' ? 'is-done' : i === plan.current ? 'is-now' : ''
                  }
                />
              ))}
            </div>
            {plan.nowLabel && (
              <p className="cl-nb-task">
                <span>NOW</span>
                {plan.nowLabel}
              </p>
            )}
            {plan.next && <p className="cl-nb-next">Next: {plan.next}</p>}
          </>
        ) : (
          <p className="cl-nb-none">This session has not written a plan.</p>
        )}
      </div>

      {a && (
        <dl className="cl-nb-vitals">
          <div>
            <dt>Spend</dt>
            <dd>{a.spend === null ? '—' : fmtCost(a.spend)}</dd>
          </div>
          <div>
            <dt>Tokens</dt>
            <dd>{tokens && a.tokens > 0 ? `${tokens.value}${tokens.unit}` : '—'}</dd>
          </div>
          <div>
            <dt>Tools</dt>
            <dd>{fmt(a.toolCount)}</dd>
          </div>
          <div>
            <dt>Failed</dt>
            <dd className={a.errorCount > 0 ? 'bad' : undefined}>{fmt(a.errorCount)}</dd>
          </div>
          {ctx !== null && (
            <div>
              <dt>Context {ctx}%</dt>
              <dd>
                <div className={`cl-nb-gauge${ctx >= 75 ? ' is-high' : ''}`}>
                  <i style={{ width: `${ctx}%` }} />
                </div>
              </dd>
            </div>
          )}
        </dl>
      )}
    </>
  );
}

function Result({ model, realPath }: { model: NotebookModel; realPath: string }) {
  const { changes, totals, checks, reads } = model;
  const green = checks.filter(c => c.verdict === 'pass').length;
  const biggest = Math.max(40, ...changes.map(c => c.added + c.removed));
  return (
    <>
      <div className="cl-nb-sec">
        <div className="cl-nb-label">
          <span>Changed</span>
          {changes.length > 0 && (
            <span className="tot">
              {changes.length} files ·{' '}
              <span style={{ color: 'var(--cl-ok)' }}>+{fmt(totals.added)}</span>{' '}
              <span style={{ color: 'var(--cl-danger)' }}>−{fmt(totals.removed)}</span>
            </span>
          )}
        </div>
        {changes.length === 0 ? (
          <p className="cl-nb-none">Nothing written yet.</p>
        ) : (
          <ul className="cl-nb-files">
            {changes.map(c => (
              <li
                key={c.path}
                className={`cl-nb-file${c.path === model.liveFile ? ' is-live' : ''}`}
              >
                <div className="nm">
                  <b>
                    <span title={c.path}>{c.name}</span>
                    {c.created && <span className="tag">new</span>}
                    {c.deleted && <span className="tag bad">deleted</span>}
                    {c.hasError && !c.deleted && <span className="tag bad">error</span>}
                  </b>
                  <span className="dir">{areaOf(c.path, realPath)}</span>
                </div>
                <div className="bar" aria-hidden>
                  <i className="a" style={{ width: `${Math.round((c.added / biggest) * 96)}px` }} />
                  <i
                    className="d"
                    style={{
                      width: c.removed
                        ? `${Math.max(3, Math.round((c.removed / biggest) * 96))}px`
                        : 0,
                    }}
                  />
                </div>
                <span
                  className="font-mono"
                  style={{
                    fontSize: 11.5,
                    fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ color: 'var(--cl-ok)' }}>+{fmt(c.added)}</span>{' '}
                  <span style={{ color: 'var(--cl-danger)' }}>−{fmt(c.removed)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="cl-nb-sec">
        <div className="cl-nb-label">
          <span>Checks</span>
          {checks.length > 0 && (
            <span className="tot">
              {green} of {checks.length} green
            </span>
          )}
        </div>
        {checks.length === 0 ? (
          <p className="cl-nb-none">No test, typecheck or lint command run yet.</p>
        ) : (
          <ul className="cl-nb-checks">
            {checks.map(c => (
              <li key={c.command} className="cl-nb-check">
                <code title={c.command}>{c.command}</code>
                <span className="cl-nb-runs" aria-hidden>
                  {c.runs.map((r, i) => (
                    <i key={i} className={r} />
                  ))}
                </span>
                <span className={`cl-nb-verdict ${c.verdict}`}>
                  {c.verdict === 'pass' ? 'passes' : c.verdict === 'fail' ? 'fails' : 'pending'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {reads.length > 0 && (
        <details className="cl-nb-reads">
          <summary>
            <div className="cl-nb-label">
              <span>Also read · {reads.length} files</span>
            </div>
          </summary>
          <ul>
            {reads.map(r => (
              <li key={r} title={r}>
                {r.slice(r.lastIndexOf('/') + 1)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
