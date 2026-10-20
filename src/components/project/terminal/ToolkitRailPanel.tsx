import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { Agent, Skill } from '../../../hooks/useIPC';
import { mcpGroupLabel } from './mcp-health';
import { splitNamespace, type Toolkit, type ToolkitList } from './toolkit';

type Species = 'skill' | 'agent';

/**
 * The skills, agents and tools this project loads, in the rail where the files
 * and the pages open. They used to be three bare counts on the strip under the
 * feed (`41 SKILLS`), beside the permission mode and the failed MCP servers —
 * four kinds of fact in four styles on one line, and nothing behind the
 * numbers. A list needs room, so it has a panel, one icon in the rail's head.
 *
 * Each species leads with what the session actually called, ×N from the
 * transcript, and folds the rest under a count: the reader's question is which
 * of the forty skills this session used, not the alphabet of all of them. A
 * row opens its definition when one resolves; the built-in agents have none,
 * so their rows are not buttons. Descriptions wait in the tooltip, as in the
 * feed.
 *
 * As with the other panels, the rail's title reads TOOLKIT while it is open
 * and the icon closes it; Escape does too while focus is inside.
 */
export function ToolkitRailPanel({
  id,
  toolkit,
  skillDef,
  agentDef,
  onOpenSkillDef,
  onOpenAgentDef,
  onClose,
}: {
  id: string;
  toolkit: Toolkit;
  skillDef: (name: string) => Skill | null;
  agentDef: (name: string) => Agent | undefined;
  onOpenSkillDef: (skill: Skill) => void;
  onOpenAgentDef: (agent: Agent) => void;
  onClose: (restoreFocus?: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    onClose(true);
  };
  const skill = (name: string) => {
    const def = skillDef(name);
    return def ? { open: () => onOpenSkillDef(def), hint: def.description } : null;
  };
  const agent = (name: string) => {
    const def = agentDef(name);
    return def ? { open: () => onOpenAgentDef(def), hint: def.description } : null;
  };

  return (
    <div
      ref={ref}
      id={id}
      className="cl-pages-rail"
      role="region"
      aria-label="Toolkit"
      tabIndex={-1}
      onKeyDown={onKey}
    >
      <div className="cl-pages-rail-head">
        What this project loads · ×N is this session&apos;s calls
      </div>
      <div className="cl-pages-rail-body cl-toolkit-body">
        <SpeciesSection title="SKILLS" species="skill" list={toolkit.skills} resolve={skill} />
        <SpeciesSection title="AGENTS" species="agent" list={toolkit.agents} resolve={agent} />
        <McpSection toolkit={toolkit} />
        <ToolsSection tools={toolkit.tools} />
      </div>
    </div>
  );
}

function Section({
  title,
  meta,
  children,
}: {
  title: string;
  meta: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="cl-toolkit-sec" aria-label={title.toLowerCase()}>
      <div className="cl-toolkit-sec-head">
        <span>{title}</span>
        <span className="meta">{meta}</span>
      </div>
      {children}
    </section>
  );
}

/** A fold under a section: closed, it is one line that says what it holds. */
function Fold({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="cl-toolkit-fold"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        {open ? '▾' : '▸'} {label}
      </button>
      {open && children}
    </>
  );
}

type Resolve = (name: string) => { open: () => void; hint?: string } | null;

function SpeciesSection({
  title,
  species,
  list,
  resolve,
}: {
  title: string;
  species: Species;
  list: ToolkitList;
  resolve: Resolve;
}) {
  const offered = list.used.length + list.available.length;
  const meta =
    offered === 0
      ? 'none'
      : `${offered} · ${list.used.length > 0 ? list.used.length : 'none'} used`;
  return (
    <Section title={title} meta={meta}>
      {list.used.map(u => (
        <ToolkitRow key={u.name} species={species} name={u.name} uses={u.uses} resolve={resolve} />
      ))}
      {list.available.length > 0 && (
        <Fold label={`${list.available.length} available`}>
          {list.available.map(name => (
            <ToolkitRow key={name} species={species} name={name} resolve={resolve} />
          ))}
        </Fold>
      )}
    </Section>
  );
}

function ToolkitRow({
  species,
  name,
  uses,
  resolve,
}: {
  species: Species;
  name: string;
  uses?: number;
  resolve: Resolve;
}) {
  const target = resolve(name);
  const { ns, base } = splitNamespace(name);
  const body = (
    <>
      <span className={`cl-toolkit-glyph is-${species}`} aria-hidden>
        {species === 'skill' ? '✦' : 'A'}
      </span>
      <span className="name">
        {ns && <span className="ns">{ns}</span>}
        {base}
      </span>
      <span className="uses">{uses ? `×${uses}` : ''}</span>
    </>
  );
  if (!target) {
    return (
      <div className="cl-toolkit-row" title={name}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      className="cl-toolkit-row"
      title={[name, target.hint].filter(Boolean).join('\n')}
      onClick={target.open}
    >
      {body}
    </button>
  );
}

function McpSection({ toolkit }: { toolkit: Toolkit }) {
  const n = toolkit.mcpFailedCount;
  return (
    <Section
      title="MCP"
      meta={n > 0 ? <span className="cl-toolkit-bad">{n} failed</span> : 'none failed'}
    >
      {toolkit.mcpFailed.map(g => (
        <div key={`${g.plugin ?? ''}|${g.source ?? ''}`} className="cl-toolkit-mcp">
          <div className="label">{mcpGroupLabel(g)}</div>
          <div className="servers">{g.servers.join(' · ')}</div>
        </div>
      ))}
      {n > 0 && (
        <div className="cl-toolkit-note">
          failed to connect when this project&apos;s configuration was read · /mcp in the terminal
          lists them and can retry
        </div>
      )}
    </Section>
  );
}

function ToolsSection({ tools }: { tools: string[] }) {
  return (
    <Section title="TOOLS" meta={tools.length > 0 ? `${tools.length} built-in` : 'none'}>
      {tools.length > 0 && (
        <Fold label="show">
          <div className="cl-toolkit-names">{tools.join(' · ')}</div>
        </Fold>
      )}
    </Section>
  );
}
