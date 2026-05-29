import { useMemo } from 'react'
import { useProjectPlans, useSessionList } from '../../../hooks/useIPC'
import type { Plan, SessionSummary } from '../../../types'
import { fmtDate, sessionTitle } from '../utils'

type Project = { hash: string; realPath: string }

function StatusPill({ plan }: { plan: Plan }) {
  if (!plan.exists) {
    return <span className="t-status pend" title="Plan file no longer on disk"><i />Deleted</span>
  }
  const approved = plan.status === 'approved'
  return (
    <span className={`t-status ${approved ? 'done' : 'prog'}`}>
      <i />
      {approved ? 'Approved' : 'Proposed'}
    </span>
  )
}

const PLAN_PREVIEW_MAX = 140

// Ripulisce il markdown del piano per un'anteprima su due righe.
function planPreview(raw: string | null): string {
  if (!raw) return ''
  const clean = raw
    .replace(/^---\n[\s\S]*?\n---\n?/, '')   // frontmatter
    .replace(/```[\s\S]*?```/g, ' ')         // blocchi codice
    .replace(/`([^`]+)`/g, '$1')             // codice inline
    .replace(/^#{1,6}\s+/gm, '')             // heading
    .replace(/[*_~>#]/g, '')                 // marcatori
    .replace(/\s+/g, ' ')
    .trim()
  return clean.length > PLAN_PREVIEW_MAX ? clean.slice(0, PLAN_PREVIEW_MAX).trimEnd() + '…' : clean
}

export function PlansSection({
  project,
  onOpenChat,
  onOpenPlan,
}: {
  project: Project
  onOpenChat: (session: SessionSummary) => void
  onOpenPlan: (plan: Plan) => void
}) {
  const { data: groups = [], isLoading } = useProjectPlans(project.hash)
  const { data: sessions = [] } = useSessionList(project.hash)

  const sessionByFilename = useMemo(() => {
    const map = new Map<string, SessionSummary>()
    for (const s of sessions) map.set(s.filename, s)
    return map
  }, [sessions])

  const planCount = groups.reduce((n, g) => n + g.plans.length, 0)

  return (
    <section className="cl-section" style={{ paddingTop: 38 }}>
      <div className="cl-sec-head">
        <h2>Plans</h2>
        <span className="ct">
          {planCount} across {groups.length} {groups.length === 1 ? 'session' : 'sessions'}
        </span>
      </div>

      {isLoading ? (
        <div className="cl-empty">Loading plans…</div>
      ) : groups.length === 0 ? (
        <div className="cl-empty">No plans recorded for this project.</div>
      ) : (
        <>
          <div className="cl-task-legend">
            <span className="done"><i />Approved</span>
            <span className="prog"><i />Proposed</span>
            <span className="pend"><i />Deleted</span>
          </div>
          <div className="cl-tasks">
            {groups.map(group => {
              const session = sessionByFilename.get(group.filename)
              const title = session ? sessionTitle(session) : group.sessionId.slice(0, 8)
              const Head = session ? 'button' : 'div'
              return (
                <div key={group.sessionId} className="group">
                  <Head
                    {...(session
                      ? { type: 'button' as const, onClick: () => onOpenChat(session), title: 'Open session chat' }
                      : {})}
                    className="cl-task-group-head"
                  >
                    <span className="gt">
                      <span className="name">{title}</span>
                    </span>
                    {session && <span className="date">{fmtDate(session.date)}</span>}
                  </Head>

                  <div className="cl-tlist">
                    {group.plans.map((plan, i) => {
                      const tone = !plan.exists ? 'pend' : plan.status === 'approved' ? 'done' : 'prog'
                      const clickable = plan.exists
                      const Card = clickable ? 'button' : 'div'
                      return (
                        <Card
                          key={`${plan.filePath}-${i}`}
                          {...(clickable
                            ? { type: 'button' as const, onClick: () => onOpenPlan(plan), title: 'Open plan' }
                            : {})}
                          className={`cl-task ${tone}`}
                          style={clickable ? { cursor: 'pointer', textAlign: 'left', width: '100%' } : undefined}
                        >
                          <div className="rail">
                            <span className="line" />
                            <span className={`marker ${tone}`} />
                          </div>
                          <div className="t-main">
                            <div className="t-row1">
                              <span className="t-title">{plan.title || '(untitled plan)'}</span>
                            </div>
                            {plan.content
                              ? <p className="t-desc">{planPreview(plan.content)}</p>
                              : <p className="t-desc" style={{ fontStyle: 'italic' }}>Plan file no longer on disk.</p>}
                          </div>
                          <StatusPill plan={plan} />
                        </Card>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}
