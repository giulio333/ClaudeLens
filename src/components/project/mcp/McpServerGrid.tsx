import { useMemo, useState } from 'react';
import type { McpServer } from '../../../hooks/useIPC';

type McpSortKey = 'projects' | 'name' | 'source';
const MCP_SORT_OPTIONS: { key: McpSortKey; label: string }[] = [
  { key: 'projects', label: 'projects' },
  { key: 'name', label: 'name' },
  { key: 'source', label: 'source' },
];

function pageWindow(current: number, total: number): (number | 'gap')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);
  const out: (number | 'gap')[] = [0];
  const start = Math.max(1, current - 1);
  const end = Math.min(total - 2, current + 1);
  if (start > 1) out.push('gap');
  for (let i = start; i <= end; i++) out.push(i);
  if (end < total - 2) out.push('gap');
  out.push(total - 1);
  return out;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function McpServerGrid({
  servers,
  onSelect,
  pageSize = 6,
  showSort = true,
  headerAction,
}: {
  servers: McpServer[];
  onSelect: (s: McpServer) => void;
  pageSize?: number;
  showSort?: boolean;
  headerAction?: React.ReactNode;
}) {
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<McpSortKey>('projects');

  const sorted = useMemo(() => {
    const arr = [...servers];
    const displayName = (n: string) => n.replace(/^claude\.ai\s*/i, '').toLowerCase();
    switch (sortKey) {
      case 'name':
        return arr.sort((a, b) => displayName(a.name).localeCompare(displayName(b.name)));
      case 'source':
        return arr.sort(
          (a, b) =>
            a.source.localeCompare(b.source) ||
            displayName(a.name).localeCompare(displayName(b.name))
        );
      case 'projects':
      default:
        return arr.sort((a, b) => b.enabledInProjects - a.enabledInProjects);
    }
  }, [servers, sortKey]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const paged = sorted.slice(safePage * pageSize, (safePage + 1) * pageSize);
  const rangeFrom = sorted.length === 0 ? 0 : safePage * pageSize + 1;
  const rangeTo = Math.min((safePage + 1) * pageSize, sorted.length);

  return (
    <>
      <div className="cl-sec-head">
        <h2>MCP servers</h2>
        <span className="ct">
          {`${rangeFrom}–${rangeTo} of ${sorted.length} · sorted by ${MCP_SORT_OPTIONS.find(o => o.key === sortKey)?.label ?? 'projects'}`}
        </span>
        {headerAction}
        {showSort && sorted.length > 1 && (
          <span className="cl-sortbar" style={{ marginLeft: 'auto' }}>
            <span className="label">SORT BY</span>
            {MCP_SORT_OPTIONS.map((o, i) => (
              <span key={o.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {i > 0 && <span className="sep">·</span>}
                <button
                  type="button"
                  className={`opt${sortKey === o.key ? ' on' : ''}`}
                  onClick={() => {
                    setSortKey(o.key);
                    setPage(0);
                  }}
                >
                  {o.label}
                </button>
              </span>
            ))}
          </span>
        )}
      </div>

      {chunk(paged, 3).map((group, gi) => (
        <div
          key={gi}
          className="cl-mcp-row"
          style={{ gridTemplateColumns: `repeat(${group.length}, 1fr)` }}
        >
          {group.map((s, i) => {
            const tone = ['', 'violet', 'cyan'][(gi * 3 + i) % 3];
            const total = s.enabledInProjects + s.disabledInProjects;
            return (
              <button
                key={s.name}
                type="button"
                className={`cl-mcp-cell ${tone}`}
                onClick={() => onSelect(s)}
              >
                <div className="led-row">
                  <span className="led" /> {s.source}
                </div>
                <div className="mcp-name">{s.name.replace(/^claude\.ai\s*/i, '')}</div>
                <div className="tools">
                  active in <b>{s.enabledInProjects}</b> of {total} projects
                </div>
                <div className="frac">
                  {s.enabledInProjects}
                  <small>/{total}</small>
                </div>
              </button>
            );
          })}
        </div>
      ))}

      {pageCount > 1 && (
        <div className="cl-pag">
          <span className="cl-pag-meter">
            PAGE <b>{String(safePage + 1).padStart(2, '0')}</b> /{' '}
            {String(pageCount).padStart(2, '0')}
          </span>
          <div className="cl-pag-side">
            <button
              type="button"
              className="cl-pag-btn"
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
            >
              <span className="arrow">←</span> PREV
            </button>
            <div className="cl-pag-nums">
              {pageWindow(safePage, pageCount).map((p, i) =>
                p === 'gap' ? (
                  <span key={`gap-${i}`} className="cl-pag-ellipsis">
                    …
                  </span>
                ) : (
                  <button
                    key={p}
                    type="button"
                    className={`cl-pag-num${p === safePage ? ' on' : ''}`}
                    onClick={() => setPage(p)}
                  >
                    {String(p + 1).padStart(2, '0')}
                  </button>
                )
              )}
            </div>
            <button
              type="button"
              className="cl-pag-btn"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(safePage + 1)}
            >
              NEXT <span className="arrow">→</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
