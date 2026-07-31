// Session timeline view — swimlane layout with file-grouped lanes, a turn
// heartbeat strip on top, user prompts as vertical anchors and tool calls as
// glyphs on the lane baseline. Pure SVG + DOM, no graph library.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ProcessedMessage, ToolGroup } from '../utils';
import { buildTimeline, type Lane, type ToolEvent, type UserMark } from './buildGraph';
import { createTimeScale, fmtClockTime, fmtDuration } from './useForceLayout';
import {
  HeartbeatStrip,
  HEADER_HEIGHT,
  LANE_HEIGHT,
  LANE_LABEL_WIDTH,
  LaneLabels,
  LaneRow,
  RIGHT_PAD,
  TOP_PAD,
  TimeAxis,
  UserMarkers,
} from './nodes';

type Props = {
  processed: ProcessedMessage[];
  onSelectTool?: (group: ToolGroup) => void;
};

type Tooltip =
  | { kind: 'event'; ev: ToolEvent; lane: Lane; x: number; y: number }
  | { kind: 'user'; mark: UserMark; x: number; y: number }
  | null;

const KIND_FILTERS: Array<{ id: Lane['kind']; label: string }> = [
  { id: 'file', label: 'Files' },
  { id: 'memory', label: 'Memory' },
  { id: 'bash', label: 'Bash' },
  { id: 'web', label: 'Web' },
  { id: 'agent', label: 'Sub-agents' },
  { id: 'other', label: 'Other' },
];

export function SessionGraphView({ processed, onSelectTool }: Props) {
  const model = useMemo(() => buildTimeline(processed), [processed]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [viewportWidth, setViewportWidth] = useState(1000);
  const [search, setSearch] = useState('');
  const [enabledKinds, setEnabledKinds] = useState<Set<Lane['kind']>>(
    () => new Set(['file', 'memory', 'bash', 'web', 'agent', 'other'])
  );
  const [selectedLane, setSelectedLane] = useState<string | null>(null);
  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<Tooltip>(null);
  const [zoom, setZoom] = useState(1);

  // Observe wrapper width — drives the SVG width and time-scale range.
  // Defer setState to the next frame and ignore sub-pixel deltas so the
  // ResizeObserver does not enter a feedback loop with the inner scrollbar.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let frame: number | null = null;
    let lastW = 0;
    const apply = (raw: number) => {
      const next = Math.max(640, Math.round(raw));
      if (Math.abs(next - lastW) < 2) return;
      lastW = next;
      setViewportWidth(next);
    };
    apply(el.clientWidth);
    const obs = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width ?? 1000;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => apply(w));
    });
    obs.observe(el);
    return () => {
      obs.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, []);

  // Apply lane filtering (kinds + free-text search).
  const filteredLanes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return model.lanes.filter(lane => {
      if (!enabledKinds.has(lane.kind)) return false;
      if (
        q &&
        !lane.label.toLowerCase().includes(q) &&
        !(lane.fullPath ?? '').toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [model.lanes, enabledKinds, search]);

  const innerWidth = Math.max(viewportWidth * zoom, viewportWidth);
  const svgWidth = innerWidth;
  const svgHeight = HEADER_HEIGHT + TOP_PAD + filteredLanes.length * LANE_HEIGHT + 24;

  const { scale } = useMemo(
    () => createTimeScale(model.domain, { from: LANE_LABEL_WIDTH, to: svgWidth - RIGHT_PAD }),
    [model.domain, svgWidth]
  );

  // Cmd/Ctrl + wheel = zoom in/out. Guard against zero-delta and identity
  // updates so trackpad inertia or stray wheel events can't loop zoom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (!Number.isFinite(e.deltaY) || e.deltaY === 0) return;
      e.preventDefault();
      setZoom(z => {
        const next = Math.max(1, Math.min(20, z * (e.deltaY > 0 ? 0.92 : 1.08)));
        return Math.abs(next - z) < 0.001 ? z : next;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  function toggleKind(k: Lane['kind']) {
    setEnabledKinds(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function handleSelectEvent(ev: ToolEvent) {
    if (!onSelectTool) return;
    const group = processed[ev.processedIndex]?.toolGroups[ev.toolGroupIndex];
    if (group) onSelectTool(group);
  }

  function handleEventHover(ev: ToolEvent | null, lane?: Lane, rect?: DOMRect | null) {
    if (!ev || !lane || !rect) {
      setTooltip(null);
      return;
    }
    setTooltip({
      kind: 'event',
      ev,
      lane,
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
    });
  }

  function handleUserHover(mark: UserMark | null, x?: number, y?: number) {
    if (!mark || x === undefined || y === undefined) {
      setTooltip(null);
      return;
    }
    setTooltip({ kind: 'user', mark, x, y });
  }

  if (processed.length === 0) {
    return <div className="cl-tl-empty">No messages to plot.</div>;
  }

  const duration = model.domain.end - model.domain.start;
  const totalTools = model.lanes.reduce((s, l) => s + l.events.length, 0);
  const filteredTools = filteredLanes.reduce((s, l) => s + l.events.length, 0);

  return (
    <div className="cl-tl-wrap" ref={wrapRef}>
      {/* ── Filters bar ── */}
      <div className="cl-tl-filters">
        <div className="cl-tl-filters-l">
          <input
            type="search"
            className="cl-tl-search"
            placeholder="Filter lanes by file path…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div className="cl-tl-kinds" role="group" aria-label="Filter by lane kind">
            {KIND_FILTERS.map(k => {
              const count = model.lanes.filter(l => l.kind === k.id).length;
              if (count === 0) return null;
              const on = enabledKinds.has(k.id);
              return (
                <button
                  key={k.id}
                  type="button"
                  className={`cl-tl-kind is-${k.id}${on ? ' on' : ''}`}
                  onClick={() => toggleKind(k.id)}
                  title={`${k.label} · ${count}`}
                >
                  <span className="cl-tl-kind-sw" />
                  {k.label}
                  <span className="cl-tl-kind-n">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="cl-tl-filters-r">
          <div className="cl-tl-meta">
            <b>{filteredLanes.length}</b>/{model.lanes.length} lanes · <b>{filteredTools}</b>/
            {totalTools} tools · {fmtDuration(duration)}
          </div>
          <div className="cl-tl-zoom" role="group" aria-label="Zoom">
            <button
              type="button"
              onClick={() => setZoom(z => Math.max(1, z * 0.8))}
              title="Zoom out"
            >
              −
            </button>
            <span className="cl-tl-zoom-val">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              onClick={() => setZoom(z => Math.min(20, z * 1.25))}
              title="Zoom in"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => setZoom(1)}
              title="Reset zoom"
              className="cl-tl-zoom-reset"
            >
              ⤺
            </button>
          </div>
        </div>
      </div>

      {/* ── Timeline body ── */}
      <div className="cl-tl-body">
        <LaneLabels
          lanes={filteredLanes}
          selectedLane={selectedLane}
          onSelectLane={setSelectedLane}
        />
        <div className="cl-tl-canvas-scroll" ref={scrollRef}>
          <svg
            width={svgWidth}
            height={svgHeight}
            className="cl-tl-canvas"
            xmlns="http://www.w3.org/2000/svg"
            onClick={() => setSelectedLane(null)}
          >
            {/* Heartbeat */}
            <g transform={`translate(0, 6)`}>
              <HeartbeatStrip
                heartbeat={model.heartbeat}
                domain={model.domain}
                width={svgWidth}
                height={HEADER_HEIGHT - 30}
                scale={scale}
              />
            </g>

            {/* Time axis */}
            <TimeAxis domain={model.domain} width={svgWidth} y={HEADER_HEIGHT - 4} scale={scale} />

            {/* User prompts as vertical anchors */}
            <UserMarkers
              marks={model.userMarks}
              scale={scale}
              height={svgHeight - HEADER_HEIGHT}
              onHover={m => {
                if (!m) handleUserHover(null);
                else {
                  const x = scale(m.t);
                  handleUserHover(
                    m,
                    x +
                      (wrapRef.current?.getBoundingClientRect().left ?? 0) -
                      (scrollRef.current?.scrollLeft ?? 0) +
                      LANE_LABEL_WIDTH,
                    HEADER_HEIGHT
                  );
                }
              }}
            />

            {/* Lanes */}
            {filteredLanes.map((lane, i) => (
              <LaneRowWrap
                key={lane.id}
                lane={lane}
                index={i}
                scale={scale}
                totalWidth={svgWidth}
                selected={
                  selectedLane === lane.id || selectedLane === null
                    ? selectedLane === lane.id
                    : false
                }
                onSelectLane={setSelectedLane}
                onSelectEvent={handleSelectEvent}
                hoveredEventId={hoveredEventId}
                setHoveredEventId={id => {
                  setHoveredEventId(id);
                  if (!id) handleEventHover(null);
                  else {
                    const ev = lane.events.find(e => e.id === id);
                    if (!ev) return;
                    const x = scale(ev.t);
                    const y = HEADER_HEIGHT + TOP_PAD + i * LANE_HEIGHT + LANE_HEIGHT / 2;
                    const wrapRect = wrapRef.current?.getBoundingClientRect();
                    const scrollLeft = scrollRef.current?.scrollLeft ?? 0;
                    const scrollTop = scrollRef.current?.scrollTop ?? 0;
                    handleEventHover(ev, lane, {
                      left:
                        (wrapRect?.left ?? 0) +
                        LANE_LABEL_WIDTH +
                        (x - scrollLeft) -
                        LANE_LABEL_WIDTH,
                      top: (wrapRect?.top ?? 0) + y - scrollTop + 40,
                      width: 0,
                      height: 0,
                    } as DOMRect);
                  }
                }}
              />
            ))}
          </svg>
        </div>
      </div>

      {/* ── Tooltip ── */}
      {tooltip && (
        <div
          className="cl-tl-tip"
          style={{
            left: Math.max(8, Math.min(tooltip.x ?? 0, viewportWidth - 280)),
            top: tooltip.y,
          }}
        >
          {tooltip.kind === 'event' ? (
            <>
              <div className="cl-tl-tip-h">
                <b>{tooltip.ev.toolName}</b>
                <span className="cl-tl-tip-t">{fmtClockTime(tooltip.ev.t)}</span>
              </div>
              <div className="cl-tl-tip-lane">{tooltip.lane.label}</div>
              <div className="cl-tl-tip-hint">Click to open tool details</div>
            </>
          ) : (
            <>
              <div className="cl-tl-tip-h">
                <b>{tooltip.mark.isCommand ? 'Slash command' : 'User prompt'}</b>
                <span className="cl-tl-tip-t">{fmtClockTime(tooltip.mark.t)}</span>
              </div>
              <div className="cl-tl-tip-lane">{tooltip.mark.label}</div>
            </>
          )}
        </div>
      )}

      {filteredLanes.length === 0 && (
        <div className="cl-tl-noresults">No lanes match the current filters.</div>
      )}
    </div>
  );
}

// Thin wrapper to let LaneRow propagate hover with closure-friendly refs.
function LaneRowWrap(props: Parameters<typeof LaneRow>[0]) {
  return <LaneRow {...props} />;
}
