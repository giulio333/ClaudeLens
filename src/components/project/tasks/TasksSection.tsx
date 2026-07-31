import { useMemo } from 'react';
import { useProjectTasks, useSessionList } from '../../../hooks/useIPC';
import type { SessionSummary, TaskGroup, TaskStatus } from '../../../types';
import { fmtDate, sessionTitle } from '../utils';

type Project = { hash: string; realPath: string };

const STATUS_TONE: Record<TaskStatus, 'done' | 'prog' | 'pend'> = {
  completed: 'done',
  in_progress: 'prog',
  pending: 'pend',
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  completed: 'Done',
  in_progress: 'In progress',
  pending: 'Pending',
};

function CheckIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function Marker({ status }: { status: TaskStatus }) {
  const tone = STATUS_TONE[status];
  return <span className={`marker ${tone}`}>{tone === 'done' && <CheckIcon />}</span>;
}

function StatusPill({ status }: { status: TaskStatus }) {
  const tone = STATUS_TONE[status];
  return (
    <span className={`t-status ${tone}`}>
      <i />
      {STATUS_LABEL[status]}
    </span>
  );
}

function TaskDeps({ blockedBy, blocks }: { blockedBy: string[]; blocks: string[] }) {
  if (blockedBy.length === 0 && blocks.length === 0) return null;
  return (
    <div className="t-deps">
      {blockedBy.length > 0 && (
        <span className="dep wait">
          <span className="lbl">blocked by</span> {blockedBy.map(id => `#${id}`).join(' ')}
        </span>
      )}
      {blocks.length > 0 && (
        <span className="dep">
          <span className="lbl">blocks</span> {blocks.map(id => `#${id}`).join(' ')}
        </span>
      )}
    </div>
  );
}

function GroupProgress({ tasks }: { tasks: TaskGroup['tasks'] }) {
  const total = tasks.length || 1;
  const done = tasks.filter(t => t.status === 'completed').length;
  const running = tasks.filter(t => t.status === 'in_progress').length;
  const pending = tasks.filter(t => t.status === 'pending').length;

  const parts: React.ReactNode[] = [];
  if (done)
    parts.push(
      <b key="d" className="d">
        {done} done
      </b>
    );
  if (running)
    parts.push(
      <b key="p" className="p">
        {running} in progress
      </b>
    );
  if (pending) parts.push(<span key="x">{pending} pending</span>);

  return (
    <div className="cl-task-prog">
      <span className="bar">
        {done > 0 && <i className="d" style={{ width: `${(done / total) * 100}%` }} />}
        {running > 0 && <i className="p" style={{ width: `${(running / total) * 100}%` }} />}
      </span>
      <span className="counts">
        {parts.map((p, i) => (
          <span key={i}>
            {i > 0 && ' · '}
            {p}
          </span>
        ))}
      </span>
    </div>
  );
}

export function TasksSection({
  project,
  onOpenChat,
}: {
  project: Project;
  onOpenChat: (session: SessionSummary) => void;
}) {
  const { data: groups = [], isLoading } = useProjectTasks(project.hash);
  const { data: sessions = [] } = useSessionList(project.hash);

  const sessionByFilename = useMemo(() => {
    const map = new Map<string, SessionSummary>();
    for (const s of sessions) map.set(s.filename, s);
    return map;
  }, [sessions]);

  return (
    <section className="cl-section" style={{ paddingTop: 38 }}>
      <div className="cl-sec-head">
        <h2>Tasks</h2>
        <span className="ct">
          {groups.reduce((n, g) => n + g.tasks.length, 0)} across {groups.length}{' '}
          {groups.length === 1 ? 'session' : 'sessions'}
        </span>
      </div>

      {isLoading ? (
        <div className="cl-empty">Loading tasks…</div>
      ) : groups.length === 0 ? (
        <div className="cl-empty">No tasks recorded for this project.</div>
      ) : (
        <>
          <div className="cl-task-legend">
            <span className="done">
              <i />
              Done
            </span>
            <span className="prog">
              <i />
              In progress
            </span>
            <span className="pend">
              <i />
              Pending
            </span>
          </div>
          <div className="cl-tasks">
            {groups.map(group => {
              const session = sessionByFilename.get(group.filename);
              const title = session ? sessionTitle(session) : group.sessionId.slice(0, 8);
              const Head = session ? 'button' : 'div';
              return (
                <div key={group.sessionId} className="group">
                  <Head
                    {...(session
                      ? {
                          type: 'button' as const,
                          onClick: () => onOpenChat(session),
                          title: 'Open session chat',
                        }
                      : {})}
                    className="cl-task-group-head"
                  >
                    <span className="gt">
                      <span className="name">{title}</span>
                    </span>
                    {session && <span className="date">{fmtDate(session.date)}</span>}
                  </Head>

                  <GroupProgress tasks={group.tasks} />

                  <div className="cl-tlist">
                    {group.tasks.map(task => {
                      const tone = STATUS_TONE[task.status];
                      return (
                        <article key={task.id} className={`cl-task ${tone}`}>
                          <div className="rail">
                            <span className="line" />
                            <Marker status={task.status} />
                          </div>
                          <div className="t-main">
                            <div className="t-row1">
                              <span className="t-idx">{task.id}</span>
                              <span className="t-title">{task.subject || '(untitled task)'}</span>
                            </div>
                            {task.status === 'in_progress' && task.activeForm && (
                              <div className="t-active">⟳ {task.activeForm}…</div>
                            )}
                            {task.description && <p className="t-desc">{task.description}</p>}
                            <TaskDeps blockedBy={task.blockedBy} blocks={task.blocks} />
                          </div>
                          <StatusPill status={task.status} />
                        </article>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
