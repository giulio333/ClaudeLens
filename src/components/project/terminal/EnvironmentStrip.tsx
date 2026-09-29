import { useState } from 'react';
import type { InitInfo } from '../../../types';
import { ReadoutRule, ReadoutShell } from '../shared/ReadoutCard';
import { failedMcpGroups } from './mcp-health';
import type { McpFailureGroup } from './mcp-health';

const PERM_LABEL: Record<string, string> = {
  default: 'DEFAULT',
  acceptEdits: 'ACCEPT EDITS',
  plan: 'PLAN MODE',
  bypassPermissions: 'BYPASS',
};

/** `PLUGIN · ACME`, `CONFIGURED · USER` — where to go to fix the group. */
function groupLabel(g: McpFailureGroup): string {
  if (g.plugin !== null) return `PLUGIN · ${g.plugin.toUpperCase()}`;
  if (!g.source) return 'CONFIGURED';
  if (g.source === 'plugin') return 'PLUGIN';
  return `CONFIGURED · ${g.source === 'claudeai' ? 'CLAUDE.AI' : g.source.toUpperCase()}`;
}

/** The failed servers behind the strip's MCP count. It rises from the strip,
 *  which sits at the bottom of the rail, over the feed above it. */
function McpFailureCard({ groups, count }: { groups: McpFailureGroup[]; count: number }) {
  return (
    <ReadoutShell
      title="MCP SERVERS"
      meta={`${count} failed`}
      className="cl-vitals-pop--up"
      style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: 20, right: 20 }}
    >
      <div style={{ marginTop: 9, fontSize: 11.5, lineHeight: 1.45, color: 'var(--cl-ink-3)' }}>
        Failed to connect when this project&apos;s configuration was read.
      </div>
      {groups.map(g => (
        <div key={`${g.plugin ?? ''}|${g.source ?? ''}`} style={{ marginTop: 11 }}>
          <div
            className="font-mono"
            style={{ fontSize: 8.5, letterSpacing: '0.16em', color: 'var(--cl-ink-4)' }}
          >
            {groupLabel(g)}
          </div>
          <div style={{ marginTop: 3, fontSize: 12, lineHeight: 1.45, color: 'var(--cl-ink)' }}>
            {g.servers.join(' · ')}
          </div>
        </div>
      ))}
      <ReadoutRule />
      <div className="font-mono" style={{ marginTop: 8, fontSize: 9.5, color: 'var(--cl-ink-4)' }}>
        /mcp in the terminal lists them and can retry the connection
      </div>
    </ReadoutShell>
  );
}

/**
 * Read-only session environment from the Agent SDK init handshake — captured by
 * aborting a one-turn query *before* any model turn, so it costs zero tokens
 * (see config-reader.ts). Surfaces what the TUI never shows: the resolved
 * permission mode and how much capability is wired up (tools/skills/agents
 * available, not just what happened to run).
 *
 * It is pinned under the feed rather than dropped into it: none of this is an
 * event — it is the session's standing setup, true for every row above it.
 *
 * MCP is deliberately *not* counted: the globally-configured gateway servers
 * (claude.ai/*) sit pending/needs-auth in every project and never get used, so
 * a total is the same noise everywhere. Only `failed` servers earn a mark, since
 * a connection that broke is the one MCP signal actually worth acting on — and
 * the mark is ONE line's worth: a count on the strip's own row, the servers in
 * the card it raises on hover or focus. They used to be listed under the row by
 * full name, which is three wrapped lines of `plugin:<name>:` for four servers
 * in a rail that has no room for a list.
 */
export function EnvironmentStrip({ init }: { init: InitInfo | null }) {
  const [showMcp, setShowMcp] = useState(false);
  if (!init) return null;
  const perm = PERM_LABEL[init.permissionMode] ?? init.permissionMode.toUpperCase();
  const danger = init.permissionMode === 'bypassPermissions';
  const mcpGroups = failedMcpGroups(init.mcpServers);
  const failed = mcpGroups.reduce((n, g) => n + g.servers.length, 0);
  const caps = [
    { label: 'TOOLS', n: init.tools.length },
    { label: 'SKILLS', n: init.skills.length },
    { label: 'AGENTS', n: init.agents.length },
  ].filter(c => c.n > 0);
  return (
    <div
      className="shrink-0"
      style={{ position: 'relative', borderTop: '1px solid var(--cl-line)', padding: '10px 20px' }}
    >
      <div className="flex items-center" style={{ gap: 10, whiteSpace: 'nowrap' }}>
        <span
          className="font-mono"
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.12em',
            padding: '3px 8px',
            borderRadius: 999,
            color: danger ? 'var(--cl-on-accent)' : 'var(--cl-ink-2)',
            background: danger ? 'var(--cl-danger)' : 'transparent',
            border: `1px solid ${danger ? 'var(--cl-danger)' : 'var(--cl-line)'}`,
          }}
          title="Resolved permission mode for this session"
        >
          {perm}
        </span>
        {failed > 0 && (
          <span
            className="cl-vitals-trigger font-mono inline-flex items-center"
            tabIndex={0}
            aria-label={`${failed} MCP ${failed === 1 ? 'server' : 'servers'} failed to connect`}
            onMouseEnter={() => setShowMcp(true)}
            onMouseLeave={() => setShowMcp(false)}
            onFocus={() => setShowMcp(true)}
            onBlur={() => setShowMcp(false)}
            style={{
              gap: 5,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.1em',
              color: 'var(--cl-danger)',
            }}
          >
            <span
              aria-hidden
              style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--cl-danger)' }}
            />
            {failed} MCP
          </span>
        )}
        {/* `margin-left: auto` rather than a spacer: a spacer is one more flex
            gap, and at the rail's minimum width the row has none to give. */}
        <span className="flex items-center" style={{ gap: 10, marginLeft: 'auto' }}>
          {caps.map(c => (
            <span
              key={c.label}
              className="font-mono"
              style={{ fontSize: 9, letterSpacing: '0.1em', color: 'var(--cl-ink-4)' }}
            >
              <b style={{ fontWeight: 700, color: 'var(--cl-ink-2)' }}>{c.n}</b> {c.label}
            </span>
          ))}
        </span>
      </div>
      {showMcp && failed > 0 && <McpFailureCard groups={mcpGroups} count={failed} />}
    </div>
  );
}
