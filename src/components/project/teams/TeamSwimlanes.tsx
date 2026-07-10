import { useMemo, useState } from 'react';
import type {
  SessionSummary,
  TeamDetail,
  TeamMemberInfo,
  TeamMemberTranscript,
} from '../../../types';
import Markdown from '../../Markdown';
import { eventTime, fmtTokens, memberColor } from './utils';

// Swimlane timeline (design 1g): the team conversation plotted across member
// lanes. Every x-position is a lane fraction resolved against the row width
// past the fixed time gutter, so the chart stretches with the viewport.
const GUTTER = 56;

function laneX(f: number): string {
  return `calc(${GUTTER}px + (100% - ${GUTTER}px) * ${f})`;
}

type Lane = { name: string; color: string; member?: TeamMemberInfo; f: number };

export function TeamSwimlanes({
  team,
  leadSession,
  onOpenChat,
  onOpenTranscript,
}: {
  team: TeamDetail;
  leadSession: SessionSummary | undefined;
  onOpenChat: (session: SessionSummary) => void;
  onOpenTranscript: (member: TeamMemberInfo, entry: TeamMemberTranscript) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const lanes = useMemo<Lane[]>(() => {
    const list = [
      { name: 'team-lead', color: 'var(--cl-accent)', member: undefined },
      ...team.members.map(m => ({ name: m.name, color: memberColor(m.color), member: m })),
    ];
    return list.map((l, i) => ({ ...l, f: (i + 0.5) / list.length }));
  }, [team.members]);
  const laneByName = useMemo(() => new Map(lanes.map(l => [l.name, l])), [lanes]);

  // Events the chart can plot (both endpoints must own a lane), tagged with
  // their original index so expansion state survives the show-all toggle.
  const plottable = useMemo(
    () =>
      team.events
        .map((e, idx) => ({ e, idx }))
        .filter(({ e }) => laneByName.has(e.from) && laneByName.has(e.to)),
    [team.events, laneByName]
  );

  // The lead often broadcasts the same request to every member; collapsing the
  // repeats keeps the chart readable (the design's "hidden request messages").
  const dupIdx = useMemo(() => {
    const seen = new Set<string>();
    const dup = new Set<number>();
    for (const { e, idx } of plottable) {
      if (e.kind !== 'message' || e.from !== 'team-lead') continue;
      const key = e.summary || e.text;
      if (!key) continue;
      if (seen.has(key)) dup.add(idx);
      else seen.add(key);
    }
    return dup;
  }, [plottable]);

  const visible = showAll ? plottable : plottable.filter(({ idx }) => !dupIdx.has(idx));
  const hiddenCount = plottable.length - visible.length;

  return (
    <>
      <section className="cl-tc-lanes">
        <div className="cl-sw-chart">
          {lanes.map(l => (
            <span key={l.name} className="cl-sw-guide" style={{ left: laneX(l.f) }} />
          ))}

          <div className="cl-sw-lanehead">
            {lanes.map(l => {
              const dot = <i style={{ background: l.color }} />;
              const nm = <span className="nm">{l.name}</span>;
              const transcript = l.member?.transcripts[0];
              if (!l.member && leadSession) {
                return (
                  <button
                    key={l.name}
                    type="button"
                    className="cl-sw-pill is-lead"
                    style={{ left: laneX(l.f) }}
                    title="Open lead chat"
                    onClick={() => onOpenChat(leadSession)}
                  >
                    {dot}
                    {nm}
                  </button>
                );
              }
              if (l.member && transcript) {
                const member = l.member;
                return (
                  <button
                    key={l.name}
                    type="button"
                    className="cl-sw-pill"
                    style={{ left: laneX(l.f) }}
                    title={`Open ${l.name} transcript`}
                    onClick={() => onOpenTranscript(member, transcript)}
                  >
                    {dot}
                    {nm}
                  </button>
                );
              }
              return (
                <span
                  key={l.name}
                  className={`cl-sw-pill${l.member ? '' : ' is-lead'}`}
                  style={{ left: laneX(l.f) }}
                >
                  {dot}
                  {nm}
                </span>
              );
            })}
          </div>

          {visible.map(({ e, idx }, i) => {
            const from = laneByName.get(e.from)!;
            const to = laneByName.get(e.to)!;
            const dispatch = e.kind === 'dispatch';
            // Dispatch rows are keyed by the teammate being launched; message
            // rows carry the sender's color end to end.
            const routeColor = dispatch ? to.color : from.color;
            const lo = Math.min(from.f, to.f);
            const span = Math.abs(to.f - from.f);
            const mid = (from.f + to.f) / 2;
            const label = e.summary || e.text;
            const gap = dispatch && visible[i + 1] && visible[i + 1].e.kind !== 'dispatch';
            return (
              <div
                key={idx}
                className={`cl-sw-row${dispatch ? ' is-dispatch' : ''}${gap ? ' is-gap' : ''}`}
              >
                <div className="cl-sw-strip">
                  <span className="cl-sw-time cl-mono">{eventTime(e.timestamp)}</span>
                  <span
                    className="cl-sw-line"
                    style={{
                      left: laneX(lo),
                      width: `calc((100% - ${GUTTER}px) * ${span})`,
                      background: routeColor,
                    }}
                  />
                  <span
                    className="cl-sw-dot"
                    style={{ left: laneX(from.f), background: from.color }}
                  />
                  <span
                    className="cl-sw-ring"
                    style={{ left: laneX(to.f), borderColor: routeColor }}
                  />
                  {dispatch ? (
                    <span className="cl-sw-kind cl-mono" style={{ left: laneX(mid) }}>
                      dispatch
                    </span>
                  ) : label ? (
                    e.text ? (
                      <button
                        type="button"
                        className={`cl-sw-msg cl-mono${e.from !== 'team-lead' ? ' is-report' : ''}`}
                        style={{ left: laneX(mid) }}
                        title={label}
                        onClick={() => setExpanded(expanded === idx ? null : idx)}
                      >
                        {label}
                      </button>
                    ) : (
                      <span
                        className={`cl-sw-msg cl-mono${e.from !== 'team-lead' ? ' is-report' : ''}`}
                        style={{ left: laneX(mid) }}
                        title={label}
                      >
                        {label}
                      </span>
                    )
                  ) : null}
                </div>
                {expanded === idx && e.text && (
                  <div className="cl-sw-expand">
                    <div className="cl-team-event-route cl-mono">
                      <span className="who">{e.from}</span>
                      <span className="arrow">→</span>
                      <span className="who">{e.to}</span>
                    </div>
                    <div className="cl-team-event-md">
                      <Markdown>{e.text}</Markdown>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {plottable.length === 0 && (
            <div className="cl-sw-empty cl-mono">
              No conversation recorded between the lead and the teammates.
            </div>
          )}
        </div>

        {plottable.length > 0 && (
          <div className="cl-sw-legend cl-mono">
            <span>
              <i />
              filled dot = sender · ring = receiver · thin line = dispatch
            </span>
            <span>
              {hiddenCount > 0 ? (
                <>
                  {hiddenCount} more request {hiddenCount === 1 ? 'message' : 'messages'} hidden ·{' '}
                  <button type="button" className="cl-sw-showall" onClick={() => setShowAll(true)}>
                    show all {plottable.length}
                  </button>
                </>
              ) : (
                <>
                  {plottable.length} {plottable.length === 1 ? 'event' : 'events'}
                  {showAll && dupIdx.size > 0 && (
                    <>
                      {' · '}
                      <button
                        type="button"
                        className="cl-sw-showall"
                        onClick={() => setShowAll(false)}
                      >
                        hide repeats
                      </button>
                    </>
                  )}
                </>
              )}
            </span>
          </div>
        )}
      </section>

      <div className="cl-sw-members">
        {team.members.map(m => {
          const transcript = m.transcripts[0];
          const body = (
            <>
              <i style={{ background: memberColor(m.color) }} />
              <span className="nm">{m.name}</span>
              {m.totalTokens > 0 && <span className="tok">{fmtTokens(m.totalTokens)}</span>}
              {transcript && <span className="go">→</span>}
            </>
          );
          return transcript ? (
            <button
              key={m.name}
              type="button"
              className="cl-sw-member"
              title={`Open ${m.name} transcript`}
              onClick={() => onOpenTranscript(m, transcript)}
            >
              {body}
            </button>
          ) : (
            <div key={m.name} className="cl-sw-member" title="Never produced a transcript">
              {body}
            </div>
          );
        })}
      </div>
    </>
  );
}
