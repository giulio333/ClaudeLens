import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type BuiltInEdge,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { QueryError } from '../../QueryError';
import { useCodeAtlas } from '../../../hooks/useIPC';
import { useTheme } from '../../../hooks/useTheme';
import type {
  CodeAtlasData,
  CodeAtlasEdge,
  CodeAtlasLayer,
  CodeAtlasModule,
  CodeGraphProvider,
} from '../../../types';
import { TopBar } from '../shared/TopBar';
import { projectDisplayName } from '../shared/projectName';
import { ATLAS_NODE_HEIGHT, ATLAS_NODE_WIDTH, layoutAtlas } from './layout';

type Project = { hash: string; realPath: string };

interface AtlasNodeData extends Record<string, unknown> {
  module: CodeAtlasModule;
  active: boolean;
  dimmed: boolean;
}

type AtlasFlowNode = import('@xyflow/react').Node<AtlasNodeData, 'atlas'>;

const NUMBER = new Intl.NumberFormat('en-US');
const HANDLE_STYLE: React.CSSProperties = {
  opacity: 0,
  width: 1,
  height: 1,
  minWidth: 0,
  minHeight: 0,
  border: 'none',
  background: 'transparent',
};

const LAYER_LABEL: Record<CodeAtlasLayer, string> = {
  renderer: 'renderer',
  main: 'main process',
  tests: 'tests',
  tooling: 'tooling',
  other: 'other',
};

function n(value: number): string {
  return NUMBER.format(value);
}

function providerName(provider: CodeGraphProvider): string {
  return provider === 'graphify' ? 'Graphify' : 'Graft';
}

function layerAccent(layer: CodeAtlasLayer): string {
  switch (layer) {
    case 'main':
      return 'color-mix(in oklch, var(--cl-accent) 88%, var(--cl-ink))';
    case 'renderer':
      return 'var(--cl-accent)';
    case 'tests':
      return 'color-mix(in oklch, var(--cl-accent) 46%, var(--cl-ink-4))';
    case 'tooling':
      return 'color-mix(in oklch, var(--cl-accent) 28%, var(--cl-ink-3))';
    default:
      return 'var(--cl-ink-3)';
  }
}

function AtlasNode({ data }: NodeProps<AtlasFlowNode>) {
  const { module, active, dimmed } = data;
  const accent = layerAccent(module.layer);
  const hub = module.hubScore >= 20;
  return (
    <div
      title={`${module.path}\n${module.symbolCount} symbols · ${module.hubScore} cross-module links`}
      style={{
        position: 'relative',
        width: ATLAS_NODE_WIDTH,
        height: ATLAS_NODE_HEIGHT,
        borderRadius: 14,
        border: `${active ? 1.5 : 1}px ${module.layer === 'tests' ? 'dashed' : 'solid'} ${
          active ? accent : 'var(--cl-line)'
        }`,
        background: active
          ? 'color-mix(in oklch, var(--cl-accent) 10%, var(--cl-paper))'
          : 'color-mix(in oklch, var(--cl-paper) 94%, transparent)',
        boxShadow: active
          ? '0 18px 48px color-mix(in oklch, var(--cl-accent) 16%, transparent)'
          : hub
            ? '0 10px 30px color-mix(in oklch, var(--cl-ink) 8%, transparent)'
            : 'none',
        opacity: dimmed ? 0.2 : 1,
        transform: active ? 'translateY(-2px)' : undefined,
        transition: 'opacity 140ms ease, border-color 140ms ease, transform 140ms ease',
        overflow: 'hidden',
        cursor: 'pointer',
      }}
    >
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} isConnectable={false} />
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} isConnectable={false} />
      <i
        aria-hidden
        style={{
          position: 'absolute',
          inset: '0 auto 0 0',
          width: active ? 5 : 3,
          background: accent,
          opacity: active ? 1 : 0.68,
        }}
      />
      <div style={{ padding: '13px 14px 10px 17px' }}>
        <div className="flex items-center justify-between gap-3">
          <span
            className="font-mono uppercase tracking-[0.12em]"
            style={{ color: accent, fontSize: 9, fontWeight: 700 }}
          >
            {LAYER_LABEL[module.layer]}
          </span>
          <span className="font-mono" style={{ color: 'var(--cl-ink-4)', fontSize: 9 }}>
            {module.hubScore} links
          </span>
        </div>
        <div
          className="truncate"
          style={{ color: 'var(--cl-ink)', fontSize: 15, fontWeight: 650, marginTop: 7 }}
        >
          {module.label}
        </div>
        <div
          className="truncate font-mono"
          style={{ color: 'var(--cl-ink-3)', fontSize: 9.5, marginTop: 4 }}
        >
          {module.path}
        </div>
        <div className="flex items-center gap-2 font-mono" style={{ marginTop: 7, fontSize: 9 }}>
          <span style={{ color: 'var(--cl-ink-2)' }}>{n(module.symbolCount)} symbols</span>
          <span style={{ color: 'var(--cl-ink-4)' }}>·</span>
          <span style={{ color: 'var(--cl-ink-3)' }}>{n(module.fileCount)} files</span>
        </div>
      </div>
    </div>
  );
}

const MemoAtlasNode = memo(AtlasNode);
const NODE_TYPES = { atlas: MemoAtlasNode };

export function CodeAtlasView({ project, onBack }: { project: Project; onBack: () => void }) {
  const [provider, setProvider] = useState<CodeGraphProvider | null>(null);
  const query = useCodeAtlas(project.realPath, provider);
  const data = query.data;

  return (
    <div className="h-full w-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>
      <TopBar
        onBack={onBack}
        backLabel="Project"
        crumbs={[
          { label: projectDisplayName(project.realPath) },
          { label: 'Code Atlas', accent: true },
        ]}
        right={
          <div className="flex items-center gap-2">
            {data?.availableProviders.map(item => (
              <ProviderButton
                key={item}
                provider={item}
                active={data.provider === item}
                onClick={() => setProvider(item)}
              />
            ))}
            <button
              type="button"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
              className="font-mono rounded-md border px-2.5 py-1.5 transition-colors hover:text-[var(--cl-accent)] disabled:opacity-50"
              style={{ borderColor: 'var(--cl-line)', color: 'var(--cl-ink-3)', fontSize: 10 }}
              title="Re-read graph artifacts from disk"
            >
              {query.isFetching ? 'Reading…' : 'Refresh'}
            </button>
          </div>
        }
      />

      {query.isLoading ? (
        <AtlasLoading />
      ) : query.isError ? (
        <QueryError
          error={query.error}
          onRetry={() => void query.refetch()}
          title="Code Atlas failed"
        />
      ) : !data || data.provider === null ? (
        <AtlasEmpty projectPath={project.realPath} />
      ) : (
        <ReactFlowProvider>
          <AtlasWorkspace key={data.provider} data={data} />
        </ReactFlowProvider>
      )}
    </div>
  );
}

function ProviderButton({
  provider,
  active,
  onClick,
}: {
  provider: CodeGraphProvider;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-mono uppercase tracking-[0.1em] rounded-md border px-2.5 py-1.5 transition-colors"
      style={{
        borderColor: active ? 'var(--cl-accent)' : 'var(--cl-line)',
        color: active ? 'var(--cl-accent)' : 'var(--cl-ink-3)',
        background: active
          ? 'color-mix(in oklch, var(--cl-accent) 8%, var(--cl-paper))'
          : 'transparent',
        fontSize: 9,
      }}
    >
      {providerName(provider)}
    </button>
  );
}

function AtlasLoading() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="font-mono text-center" style={{ color: 'var(--cl-ink-3)', fontSize: 11 }}>
        <span
          className="inline-block rounded-full"
          style={{ width: 7, height: 7, background: 'var(--cl-accent)', marginRight: 9 }}
        />
        Mapping the architecture…
      </div>
    </div>
  );
}

function AtlasEmpty({ projectPath }: { projectPath: string }) {
  return (
    <div className="flex-1 overflow-auto">
      <div style={{ maxWidth: 980, margin: '0 auto', padding: '64px 48px 80px' }}>
        <p
          className="font-mono uppercase tracking-[0.16em]"
          style={{ color: 'var(--cl-accent)', fontSize: 10 }}
        >
          Local architecture layer
        </p>
        <h1
          style={{
            color: 'var(--cl-ink)',
            fontSize: 'clamp(42px, 6vw, 76px)',
            lineHeight: 0.98,
            letterSpacing: '-0.045em',
            marginTop: 14,
          }}
        >
          Give ClaudeLens a graph to look through.
        </h1>
        <p
          style={{
            color: 'var(--cl-ink-3)',
            fontSize: 15,
            lineHeight: 1.7,
            maxWidth: 670,
            marginTop: 24,
          }}
        >
          Code Atlas reads existing Graphify or Graft artifacts. It does not install either tool,
          modify agent instructions, start MCP servers, or send source code anywhere.
        </p>

        <div className="grid md:grid-cols-2" style={{ gap: 18, marginTop: 42 }}>
          <SetupCard
            index="01"
            title="Graphify"
            description="Best first source for communities, confidence provenance and a broad knowledge map."
            command="uvx --from graphifyy graphify extract . --code-only"
            output="graphify-out/graph.json"
          />
          <SetupCard
            index="02"
            title="Graft"
            description="Best first source for signatures, symbol kinds, callers and deterministic wiring."
            command="npx --yes @nanonets/graft build ."
            output="graft/.graph/wiring.json"
          />
        </div>

        <div
          className="font-mono truncate"
          title={projectPath}
          style={{
            color: 'var(--cl-ink-4)',
            borderTop: '1px solid var(--cl-line)',
            marginTop: 34,
            paddingTop: 14,
            fontSize: 10,
          }}
        >
          Watching fixed artifact locations under {projectPath}
        </div>
      </div>
    </div>
  );
}

function SetupCard({
  index,
  title,
  description,
  command,
  output,
}: {
  index: string;
  title: string;
  description: string;
  command: string;
  output: string;
}) {
  return (
    <section
      style={{
        border: '1px solid var(--cl-line)',
        borderRadius: 16,
        padding: 22,
        background: 'var(--cl-paper-2)',
      }}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono" style={{ color: 'var(--cl-accent)', fontSize: 10 }}>
          {index}
        </span>
        <span
          className="font-mono uppercase tracking-[0.12em]"
          style={{ color: 'var(--cl-ink-4)', fontSize: 9 }}
        >
          read only
        </span>
      </div>
      <h2 style={{ color: 'var(--cl-ink)', fontSize: 24, fontWeight: 650, marginTop: 20 }}>
        {title}
      </h2>
      <p
        style={{
          color: 'var(--cl-ink-3)',
          fontSize: 12.5,
          lineHeight: 1.6,
          minHeight: 60,
          marginTop: 8,
        }}
      >
        {description}
      </p>
      <code
        className="block overflow-x-auto whitespace-nowrap"
        style={{
          color: 'var(--cl-paper)',
          background: 'var(--cl-ink)',
          borderRadius: 9,
          padding: '11px 12px',
          marginTop: 18,
          fontSize: 10,
        }}
      >
        {command}
      </code>
      <div className="font-mono" style={{ color: 'var(--cl-ink-4)', fontSize: 9, marginTop: 10 }}>
        → {output}
      </div>
    </section>
  );
}

function AtlasWorkspace({ data }: { data: CodeAtlasData }) {
  const { resolved } = useTheme();
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showTests, setShowTests] = useState(false);
  const [showTooling, setShowTooling] = useState(false);

  const visibleModules = useMemo(
    () =>
      data.modules.filter(
        module =>
          (showTests || module.layer !== 'tests') && (showTooling || module.layer !== 'tooling')
      ),
    [data.modules, showTests, showTooling]
  );
  const visibleIds = useMemo(
    () => new Set(visibleModules.map(module => module.id)),
    [visibleModules]
  );
  const visibleEdges = useMemo(
    () => data.edges.filter(edge => visibleIds.has(edge.source) && visibleIds.has(edge.target)),
    [data.edges, visibleIds]
  );
  const visibleSelection = selected && visibleIds.has(selected) ? selected : null;
  const selectedModule = visibleSelection
    ? (data.modules.find(module => module.id === visibleSelection) ?? null)
    : null;

  const neighbors = useMemo(() => {
    if (!visibleSelection) return new Set<string>();
    const result = new Set<string>([visibleSelection]);
    for (const edge of visibleEdges) {
      if (edge.source === visibleSelection) result.add(edge.target);
      if (edge.target === visibleSelection) result.add(edge.source);
    }
    return result;
  }, [visibleSelection, visibleEdges]);

  const searchMatches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return null;
    return new Set(
      visibleModules
        .filter(module =>
          [
            module.label,
            module.path,
            ...module.files,
            ...module.topSymbols.map(symbol => symbol.label),
          ]
            .join(' ')
            .toLowerCase()
            .includes(needle)
        )
        .map(module => module.id)
    );
  }, [search, visibleModules]);

  const connectedEdges = useMemo(
    () =>
      visibleSelection
        ? visibleEdges.filter(
            edge => edge.source === visibleSelection || edge.target === visibleSelection
          )
        : [],
    [visibleSelection, visibleEdges]
  );

  return (
    <div className="relative flex-1 min-h-0 overflow-hidden">
      <AtlasCanvas
        modules={visibleModules}
        edges={visibleEdges}
        directed={data.directed}
        selected={visibleSelection}
        neighbors={neighbors}
        searchMatches={searchMatches}
        colorMode={resolved}
        onSelect={setSelected}
      />

      <AtlasHeader
        data={data}
        search={search}
        setSearch={setSearch}
        showTests={showTests}
        setShowTests={setShowTests}
        showTooling={showTooling}
        setShowTooling={setShowTooling}
        visibleCount={visibleModules.length}
      />

      <AtlasInspector
        modules={visibleModules}
        selected={selectedModule}
        edges={connectedEdges}
        onSelect={setSelected}
        onClear={() => setSelected(null)}
      />

      <div
        className="absolute left-1/2 -translate-x-1/2 bottom-4 z-10 flex items-center gap-3 rounded-full border px-3.5 py-2 font-mono"
        style={{
          borderColor: 'var(--cl-line)',
          background: 'color-mix(in oklch, var(--cl-paper) 90%, transparent)',
          color: 'var(--cl-ink-4)',
          backdropFilter: 'blur(14px)',
          fontSize: 9,
        }}
      >
        <span>
          <b style={{ color: 'var(--cl-accent)' }}>●</b> module
        </span>
        <span>line width = relationship count</span>
        <span>{data.directed ? 'arrows = direction' : 'undirected artifact'}</span>
      </div>
    </div>
  );
}

function AtlasHeader({
  data,
  search,
  setSearch,
  showTests,
  setShowTests,
  showTooling,
  setShowTooling,
  visibleCount,
}: {
  data: CodeAtlasData;
  search: string;
  setSearch: (value: string) => void;
  showTests: boolean;
  setShowTests: (value: boolean) => void;
  showTooling: boolean;
  setShowTooling: (value: boolean) => void;
  visibleCount: number;
}) {
  const extractedRatio = data.stats.rawEdgeCount
    ? Math.round((data.stats.extractedEdges / data.stats.rawEdgeCount) * 100)
    : 0;
  return (
    <aside
      className="absolute left-4 top-4 z-10 rounded-2xl border"
      style={{
        width: 318,
        borderColor: 'var(--cl-line)',
        background: 'color-mix(in oklch, var(--cl-paper) 92%, transparent)',
        boxShadow: '0 18px 54px color-mix(in oklch, var(--cl-ink) 8%, transparent)',
        backdropFilter: 'blur(18px)',
        padding: 18,
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p
            className="font-mono uppercase tracking-[0.16em]"
            style={{ color: 'var(--cl-accent)', fontSize: 9 }}
          >
            {providerName(data.provider!)} projection
          </p>
          <h1
            style={{
              color: 'var(--cl-ink)',
              fontSize: 28,
              lineHeight: 1,
              letterSpacing: '-0.035em',
              marginTop: 7,
            }}
          >
            Code Atlas
          </h1>
        </div>
        <span
          className="font-mono rounded-full border px-2 py-1"
          style={{ borderColor: 'var(--cl-line)', color: 'var(--cl-ink-3)', fontSize: 9 }}
        >
          {visibleCount} modules
        </span>
      </div>

      <div
        className="grid grid-cols-3"
        style={{ gap: 1, marginTop: 17, background: 'var(--cl-line)' }}
      >
        <Metric label="nodes" value={n(data.stats.rawNodeCount)} />
        <Metric label="edges" value={n(data.stats.rawEdgeCount)} />
        <Metric label="extracted" value={`${extractedRatio}%`} />
      </div>

      <input
        type="search"
        value={search}
        onChange={event => setSearch(event.target.value)}
        placeholder="Find module, file or symbol…"
        className="w-full font-mono outline-none rounded-lg border"
        style={{
          marginTop: 15,
          padding: '9px 10px',
          borderColor: 'var(--cl-line)',
          background: 'var(--cl-paper)',
          color: 'var(--cl-ink)',
          fontSize: 10,
        }}
      />

      <div className="flex items-center gap-2" style={{ marginTop: 11 }}>
        <Toggle
          label="Runtime"
          active={!showTests && !showTooling}
          onClick={() => {
            setShowTests(false);
            setShowTooling(false);
          }}
        />
        <Toggle label="Tests" active={showTests} onClick={() => setShowTests(!showTests)} />
        <Toggle label="Tooling" active={showTooling} onClick={() => setShowTooling(!showTooling)} />
      </div>

      <div
        className="font-mono truncate"
        title={data.artifactPath ?? undefined}
        style={{
          color: 'var(--cl-ink-4)',
          borderTop: '1px solid var(--cl-line)',
          marginTop: 14,
          paddingTop: 10,
          fontSize: 8.5,
        }}
      >
        {data.builtAtCommit ? `commit ${data.builtAtCommit.slice(0, 10)} · ` : ''}
        {data.generatedAt ? new Date(data.generatedAt).toLocaleString() : 'local artifact'}
      </div>
    </aside>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'var(--cl-paper-2)', padding: '9px 8px' }}>
      <div className="font-mono" style={{ color: 'var(--cl-ink)', fontSize: 12, fontWeight: 650 }}>
        {value}
      </div>
      <div
        className="font-mono uppercase tracking-[0.1em]"
        style={{ color: 'var(--cl-ink-4)', fontSize: 7.5, marginTop: 2 }}
      >
        {label}
      </div>
    </div>
  );
}

function Toggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-mono rounded-full border px-2.5 py-1 transition-colors"
      style={{
        borderColor: active ? 'var(--cl-accent)' : 'var(--cl-line)',
        color: active ? 'var(--cl-accent)' : 'var(--cl-ink-3)',
        background: active
          ? 'color-mix(in oklch, var(--cl-accent) 7%, transparent)'
          : 'transparent',
        fontSize: 8.5,
      }}
    >
      {label}
    </button>
  );
}

function AtlasInspector({
  modules,
  selected,
  edges,
  onSelect,
  onClear,
}: {
  modules: CodeAtlasModule[];
  selected: CodeAtlasModule | null;
  edges: CodeAtlasEdge[];
  onSelect: (id: string) => void;
  onClear: () => void;
}) {
  const byId = useMemo(() => new Map(modules.map(module => [module.id, module])), [modules]);
  const hubs = useMemo(
    () => [...modules].sort((a, b) => b.hubScore - a.hubScore).slice(0, 7),
    [modules]
  );
  return (
    <aside
      className="absolute right-4 top-4 bottom-4 z-10 rounded-2xl border overflow-hidden flex flex-col"
      style={{
        width: 330,
        borderColor: 'var(--cl-line)',
        background: 'color-mix(in oklch, var(--cl-paper) 94%, transparent)',
        boxShadow: '0 18px 54px color-mix(in oklch, var(--cl-ink) 8%, transparent)',
        backdropFilter: 'blur(18px)',
      }}
    >
      {selected ? (
        <>
          <div style={{ padding: '18px 18px 14px', borderBottom: '1px solid var(--cl-line)' }}>
            <button
              type="button"
              onClick={onClear}
              className="font-mono"
              style={{ color: 'var(--cl-ink-4)', fontSize: 9 }}
            >
              ← all modules
            </button>
            <p
              className="font-mono uppercase tracking-[0.14em]"
              style={{ color: layerAccent(selected.layer), fontSize: 8.5, marginTop: 18 }}
            >
              {LAYER_LABEL[selected.layer]}
            </p>
            <h2
              style={{
                color: 'var(--cl-ink)',
                fontSize: 26,
                letterSpacing: '-0.035em',
                lineHeight: 1.05,
                marginTop: 6,
              }}
            >
              {selected.label}
            </h2>
            <p
              className="font-mono break-all"
              style={{ color: 'var(--cl-ink-3)', fontSize: 9, lineHeight: 1.5, marginTop: 8 }}
            >
              {selected.path}
            </p>
          </div>
          <div className="overflow-auto" style={{ padding: '15px 18px 22px' }}>
            <div className="grid grid-cols-4" style={{ gap: 1, background: 'var(--cl-line)' }}>
              <Metric label="symbols" value={n(selected.symbolCount)} />
              <Metric label="files" value={n(selected.fileCount)} />
              <Metric label="in" value={n(selected.inbound)} />
              <Metric label="out" value={n(selected.outbound)} />
            </div>
            <InspectorSection label="Strongest connections">
              {edges.length ? (
                [...edges]
                  .sort((a, b) => b.weight - a.weight)
                  .slice(0, 10)
                  .map(edge => {
                    const otherId = edge.source === selected.id ? edge.target : edge.source;
                    const other = byId.get(otherId);
                    if (!other) return null;
                    return (
                      <button
                        key={edge.id}
                        type="button"
                        onClick={() => onSelect(other.id)}
                        className="w-full flex items-center gap-2 text-left group"
                        style={{ padding: '7px 0', borderBottom: '1px solid var(--cl-line)' }}
                      >
                        <span
                          className="truncate"
                          style={{ color: 'var(--cl-ink-2)', fontSize: 11 }}
                        >
                          {other.label}
                        </span>
                        <span
                          className="flex-1 border-b border-dotted"
                          style={{ borderColor: 'var(--cl-line)' }}
                        />
                        <span
                          className="font-mono"
                          style={{ color: 'var(--cl-accent)', fontSize: 9 }}
                        >
                          {edge.weight}
                        </span>
                      </button>
                    );
                  })
              ) : (
                <Muted>Only internal relationships in this projection.</Muted>
              )}
            </InspectorSection>
            <InspectorSection label="Hub symbols">
              {selected.topSymbols.length ? (
                selected.topSymbols.map(symbol => (
                  <div
                    key={symbol.id}
                    style={{ padding: '7px 0', borderBottom: '1px solid var(--cl-line)' }}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="truncate"
                        style={{ color: 'var(--cl-ink-2)', fontSize: 10.5 }}
                      >
                        {symbol.label}
                      </span>
                      <span
                        className="font-mono ml-auto"
                        style={{ color: 'var(--cl-ink-4)', fontSize: 8 }}
                      >
                        {symbol.kind} · {symbol.degree}
                      </span>
                    </div>
                    <div
                      className="font-mono truncate"
                      title={symbol.file}
                      style={{ color: 'var(--cl-ink-4)', fontSize: 8, marginTop: 3 }}
                    >
                      {symbol.file}
                      {symbol.location ? ` · ${symbol.location}` : ''}
                    </div>
                  </div>
                ))
              ) : (
                <Muted>No symbol detail in this artifact.</Muted>
              )}
            </InspectorSection>
            <InspectorSection label="Files">
              {selected.files.map(file => (
                <div
                  key={file}
                  className="font-mono truncate"
                  title={file}
                  style={{ color: 'var(--cl-ink-3)', fontSize: 8.5, padding: '4px 0' }}
                >
                  {file}
                </div>
              ))}
              {selected.fileCount > selected.files.length && (
                <Muted>+ {selected.fileCount - selected.files.length} more</Muted>
              )}
            </InspectorSection>
          </div>
        </>
      ) : (
        <div className="overflow-auto" style={{ padding: 18 }}>
          <p
            className="font-mono uppercase tracking-[0.14em]"
            style={{ color: 'var(--cl-accent)', fontSize: 8.5 }}
          >
            Orientation
          </p>
          <h2
            style={{
              color: 'var(--cl-ink)',
              fontSize: 25,
              lineHeight: 1.05,
              letterSpacing: '-0.035em',
              marginTop: 8,
            }}
          >
            Start with the hubs.
          </h2>
          <p style={{ color: 'var(--cl-ink-3)', fontSize: 11.5, lineHeight: 1.6, marginTop: 10 }}>
            Click a module to isolate its one-hop neighborhood, then walk the strongest connections.
          </p>
          <InspectorSection label="Most connected modules">
            {hubs.map((module, index) => (
              <button
                key={module.id}
                type="button"
                onClick={() => onSelect(module.id)}
                className="w-full flex items-center gap-2 text-left"
                style={{ padding: '9px 0', borderBottom: '1px solid var(--cl-line)' }}
              >
                <span className="font-mono" style={{ color: 'var(--cl-ink-4)', fontSize: 8 }}>
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="truncate" style={{ color: 'var(--cl-ink-2)', fontSize: 11 }}>
                  {module.label}
                </span>
                <span
                  className="font-mono ml-auto"
                  style={{ color: 'var(--cl-accent)', fontSize: 9 }}
                >
                  {module.hubScore}
                </span>
              </button>
            ))}
          </InspectorSection>
        </div>
      )}
    </aside>
  );
}

function InspectorSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 20 }}>
      <h3
        className="font-mono uppercase tracking-[0.13em]"
        style={{ color: 'var(--cl-ink-4)', fontSize: 8.5, marginBottom: 6 }}
      >
        {label}
      </h3>
      {children}
    </section>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ color: 'var(--cl-ink-4)', fontSize: 10, lineHeight: 1.5, padding: '6px 0' }}>
      {children}
    </p>
  );
}

function AtlasCanvas({
  modules,
  edges,
  directed,
  selected,
  neighbors,
  searchMatches,
  colorMode,
  onSelect,
}: {
  modules: CodeAtlasModule[];
  edges: CodeAtlasEdge[];
  directed: boolean;
  selected: string | null;
  neighbors: Set<string>;
  searchMatches: Set<string> | null;
  colorMode: 'light' | 'dark';
  onSelect: (id: string | null) => void;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<AtlasFlowNode>([]);
  const rf = useReactFlow<AtlasFlowNode>();
  const request = useRef(0);

  useEffect(() => {
    const current = ++request.current;
    void layoutAtlas(modules, edges).then(positions => {
      if (current !== request.current) return;
      setNodes(
        modules.map(module => ({
          id: module.id,
          type: 'atlas',
          position: positions.get(module.id) ?? { x: 0, y: 0 },
          data: { module, active: false, dimmed: false },
          style: { width: ATLAS_NODE_WIDTH, height: ATLAS_NODE_HEIGHT },
          draggable: true,
          connectable: false,
          selectable: false,
          deletable: false,
        }))
      );
      requestAnimationFrame(() => void rf.fitView({ padding: 0.2, duration: 360 }));
    });
    return () => {
      request.current += 1;
    };
  }, [modules, edges, rf, setNodes]);

  const renderedNodes = useMemo(
    () =>
      nodes.map(node => ({
        ...node,
        data: {
          ...node.data,
          active: node.id === selected,
          dimmed:
            (selected !== null && !neighbors.has(node.id)) ||
            (searchMatches !== null && !searchMatches.has(node.id)),
        },
      })),
    [nodes, selected, neighbors, searchMatches]
  );

  const renderedEdges = useMemo<BuiltInEdge[]>(
    () =>
      edges.map(edge => {
        const active = selected !== null && (edge.source === selected || edge.target === selected);
        const dimmed = selected !== null && !active;
        const relation = edge.relations[0];
        const stroke = active ? 'var(--cl-accent)' : 'var(--cl-ink-4)';
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: 'smoothstep',
          label: active && relation ? `${relation.relation} ×${edge.weight}` : undefined,
          labelStyle: { fill: 'var(--cl-ink-3)', fontSize: 9, fontFamily: 'monospace' },
          labelBgStyle: { fill: 'var(--cl-paper)', fillOpacity: 0.9 },
          labelBgPadding: [5, 3] as [number, number],
          labelBgBorderRadius: 4,
          style: {
            stroke,
            strokeWidth: active ? 2.4 : Math.min(2.4, 0.75 + Math.log2(edge.weight + 1) * 0.38),
            opacity: dimmed ? 0.08 : active ? 1 : 0.3,
          },
          markerEnd:
            directed && active
              ? { type: MarkerType.ArrowClosed, width: 13, height: 13, color: stroke }
              : undefined,
          animated: active,
        };
      }),
    [edges, selected, directed]
  );

  const onPaneClick = useCallback(() => onSelect(null), [onSelect]);

  return (
    <ReactFlow
      nodes={renderedNodes}
      edges={renderedEdges}
      nodeTypes={NODE_TYPES}
      onNodesChange={onNodesChange}
      onNodeClick={(_, node) => onSelect(node.id)}
      onPaneClick={onPaneClick}
      colorMode={colorMode}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.15}
      maxZoom={2.2}
      nodesDraggable
      nodesConnectable={false}
      elementsSelectable={false}
      panOnScroll
      zoomOnScroll={false}
      zoomOnPinch
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={25}
        size={1.05}
        color="color-mix(in oklch, var(--cl-line) 70%, transparent)"
        bgColor="var(--cl-paper)"
      />
      <Controls showInteractive={false} position="bottom-left" orientation="horizontal" />
    </ReactFlow>
  );
}
