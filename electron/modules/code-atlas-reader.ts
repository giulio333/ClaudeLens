// Read-only adapters for the local artifacts produced by Graphify and Graft.
// ClaudeLens deliberately does not install either tool, start their MCP
// servers, or copy their viewer code: it projects both JSON formats into one
// small module graph that is safe to send over IPC and cheap to render.

import { promises as fsp } from 'fs';
import { basename, extname, isAbsolute, join } from 'path';
import type {
  CodeAtlasConfidenceCounts,
  CodeAtlasData,
  CodeAtlasEdge,
  CodeAtlasLayer,
  CodeAtlasModule,
  CodeAtlasStats,
  CodeAtlasSymbol,
  CodeGraphConfidence,
  CodeGraphProvider,
} from '../shared/code-atlas-types';
import { readTextFile, withTimeout } from './safe-fs';

const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;
const TOP_SYMBOLS_PER_MODULE = 8;
const FILES_PER_MODULE = 16;

const ARTIFACTS: Record<CodeGraphProvider, string[]> = {
  graphify: ['graphify-out', 'graph.json'],
  graft: ['graft', '.graph', 'wiring.json'],
};

type UnknownRecord = Record<string, unknown>;

interface SourceNode {
  id: string;
  label: string;
  kind: string;
  file: string;
  location: string | null;
  exported: boolean | null;
  community: string | null;
}

interface SourceEdge {
  source: string;
  target: string;
  relation: string;
  confidence: CodeGraphConfidence;
}

interface SourceGraph {
  nodes: SourceNode[];
  edges: SourceEdge[];
  builtAtCommit: string | null;
  schemaVersion: string | null;
  directed: boolean;
}

interface ArtifactInfo {
  path: string;
  generatedAt: string;
  availableProviders: CodeGraphProvider[];
}

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function confidenceOf(value: unknown): CodeGraphConfidence {
  const normalized = typeof value === 'string' ? value.toLowerCase() : '';
  if (normalized === 'extracted') return 'extracted';
  if (normalized === 'inferred') return 'inferred';
  if (normalized === 'ambiguous') return 'ambiguous';
  return 'unknown';
}

function emptyConfidence(): CodeAtlasConfidenceCounts {
  return { extracted: 0, inferred: 0, ambiguous: 0, unknown: 0 };
}

function incrementConfidence(counts: CodeAtlasConfidenceCounts, value: CodeGraphConfidence): void {
  counts[value] += 1;
}

function parseGraphify(raw: unknown): SourceGraph {
  const root = record(raw);
  if (!root) throw new Error('Graphify graph.json is not a JSON object.');

  const nodes = (Array.isArray(root.nodes) ? root.nodes : []).flatMap((value): SourceNode[] => {
    const node = record(value);
    if (!node) return [];
    const id = text(node.id);
    const file = text(node.source_file);
    if (!id || !file) return [];
    const community = text(node.community_name) ?? number(node.community)?.toString() ?? null;
    return [
      {
        id,
        label: text(node.label) ?? id,
        kind: text(node.file_type) ?? 'symbol',
        file,
        location: text(node.source_location),
        exported: null,
        community,
      },
    ];
  });

  const rawEdges = Array.isArray(root.links)
    ? root.links
    : Array.isArray(root.edges)
      ? root.edges
      : [];
  const edges = rawEdges.flatMap((value): SourceEdge[] => {
    const edge = record(value);
    if (!edge) return [];
    const source = text(edge.source);
    const target = text(edge.target);
    if (!source || !target) return [];
    return [
      {
        source,
        target,
        relation: text(edge.relation) ?? 'related',
        confidence: confidenceOf(edge.confidence),
      },
    ];
  });

  return {
    nodes,
    edges,
    builtAtCommit: text(root.built_at_commit),
    schemaVersion: null,
    directed: root.directed === true,
  };
}

function parseGraft(raw: unknown): SourceGraph {
  const root = record(raw);
  if (!root) throw new Error('Graft wiring.json is not a JSON object.');

  const nodes = (Array.isArray(root.nodes) ? root.nodes : []).flatMap((value): SourceNode[] => {
    const node = record(value);
    if (!node) return [];
    const id = text(node.id);
    const file = text(node.path);
    if (!id || !file) return [];
    return [
      {
        id,
        label: text(node.name) ?? id,
        kind: text(node.kind) ?? 'symbol',
        file,
        location: text(node.span),
        exported: typeof node.exported === 'boolean' ? node.exported : null,
        community: null,
      },
    ];
  });

  const edges = (Array.isArray(root.edges) ? root.edges : []).flatMap((value): SourceEdge[] => {
    const edge = record(value);
    if (!edge) return [];
    const source = text(edge.source);
    const target = text(edge.target);
    if (!source || !target) return [];
    return [
      {
        source,
        target,
        relation: text(edge.relation) ?? 'related',
        confidence: confidenceOf(edge.confidence),
      },
    ];
  });

  const meta = record(root.meta);
  const version = meta ? number(meta.version) : null;
  return {
    nodes,
    edges,
    builtAtCommit: null,
    schemaVersion: version?.toString() ?? null,
    directed: true,
  };
}

function normalizeFilePath(file: string): string {
  return file.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function stem(file: string): string {
  return basename(file, extname(file));
}

function electronModuleFamily(file: string): string {
  const raw = stem(file).split('-')[0] || 'core';
  if (raw === 'sessions') return 'session';
  if (raw === 'agents') return 'agent';
  if (raw === 'skills') return 'skill';
  if (raw === 'plans') return 'plan';
  if (raw === 'tasks') return 'task';
  if (raw === 'teams') return 'team';
  if (raw === 'plugins') return 'plugin';
  if (raw === 'workflows') return 'workflow';
  if (raw === 'notifications') return 'notification';
  return raw;
}

/** Stable, provider-agnostic architecture bucket for a source file. */
export function modulePathForFile(input: string): string {
  const file = normalizeFilePath(input);
  const parts = file.split('/').filter(Boolean);
  if (parts.length <= 1) return 'tooling';

  if (parts[0] === 'test' || parts[0] === 'tests' || parts[0] === '__tests__') return 'test';

  if (parts[0] === 'electron') {
    if (parts[1] === 'modules') {
      if (parts.length > 3) return `electron/modules/${parts[2]}`;
      return `electron/modules/${electronModuleFamily(parts[2] ?? file)}`;
    }
    if (parts[1] === 'shared') return 'electron/shared';
    return 'electron/core';
  }

  if (parts[0] === 'src') {
    if (parts[1] === 'components' && parts[2] === 'project' && parts[3]) {
      if (parts[3] === 'studio' && parts[4] === 'canvas') {
        return 'src/components/project/studio/canvas';
      }
      return `src/components/project/${parts[3]}`;
    }
    if (parts[1] === 'components') {
      return parts.length > 3 ? `src/components/${parts[2]}` : 'src/components/core';
    }
    return parts[1] ? `src/${parts[1]}` : 'src';
  }

  if (parts[0] === 'scripts' || parts[0] === 'public' || parts[0] === 'docs') return parts[0];
  return parts[0] ?? 'other';
}

function layerForModule(path: string): CodeAtlasLayer {
  if (path === 'test') return 'tests';
  if (path.startsWith('src/')) return 'renderer';
  if (path.startsWith('electron/')) return 'main';
  if (path === 'tooling' || path === 'scripts' || path === 'public' || path === 'docs') {
    return 'tooling';
  }
  return 'other';
}

function titleFromPath(path: string): string {
  const parts = path.split('/');
  const raw = parts[parts.length - 1] ?? path;
  return raw
    .split(/[-_]/)
    .filter(Boolean)
    .map(part => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
}

interface MutableModule {
  id: string;
  label: string;
  path: string;
  layer: CodeAtlasLayer;
  files: Set<string>;
  symbols: CodeAtlasSymbol[];
  communities: Set<string>;
  inbound: number;
  outbound: number;
}

interface MutableEdge {
  source: string;
  target: string;
  weight: number;
  relations: Map<string, number>;
  confidence: CodeAtlasConfidenceCounts;
}

function emptyStats(): CodeAtlasStats {
  return {
    rawNodeCount: 0,
    rawEdgeCount: 0,
    fileCount: 0,
    communityCount: 0,
    extractedEdges: 0,
    inferredEdges: 0,
    ambiguousEdges: 0,
    moduleCount: 0,
    crossModuleEdgeCount: 0,
  };
}

export function emptyCodeAtlas(availableProviders: CodeGraphProvider[] = []): CodeAtlasData {
  return {
    provider: null,
    availableProviders,
    artifactPath: null,
    generatedAt: null,
    builtAtCommit: null,
    schemaVersion: null,
    directed: true,
    stats: emptyStats(),
    modules: [],
    edges: [],
  };
}

function buildAtlas(
  graph: SourceGraph,
  provider: CodeGraphProvider,
  info: ArtifactInfo
): CodeAtlasData {
  const nodeById = new Map(graph.nodes.map(node => [node.id, node]));
  const degree = new Map<string, number>();
  const confidenceTotals = emptyConfidence();
  for (const edge of graph.edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
    incrementConfidence(confidenceTotals, edge.confidence);
  }

  const modules = new Map<string, MutableModule>();
  const nodeToModule = new Map<string, string>();
  const allFiles = new Set<string>();
  const allCommunities = new Set<string>();

  for (const node of graph.nodes) {
    const file = normalizeFilePath(node.file);
    const moduleId = modulePathForFile(file);
    let module = modules.get(moduleId);
    if (!module) {
      module = {
        id: moduleId,
        label: titleFromPath(moduleId),
        path: moduleId,
        layer: layerForModule(moduleId),
        files: new Set(),
        symbols: [],
        communities: new Set(),
        inbound: 0,
        outbound: 0,
      };
      modules.set(moduleId, module);
    }
    module.files.add(file);
    allFiles.add(file);
    nodeToModule.set(node.id, moduleId);
    if (node.community) {
      module.communities.add(node.community);
      allCommunities.add(node.community);
    }
    if (node.kind !== 'file') {
      module.symbols.push({
        id: node.id,
        label: node.label,
        kind: node.kind,
        file,
        location: node.location,
        degree: degree.get(node.id) ?? 0,
        exported: node.exported,
      });
    }
  }

  const edgeMap = new Map<string, MutableEdge>();
  for (const edge of graph.edges) {
    if (edge.relation === 'contains') continue;
    let source = nodeToModule.get(edge.source);
    let target = nodeToModule.get(edge.target);
    if (!source || !target || source === target) continue;
    if (!graph.directed && source.localeCompare(target) > 0) [source, target] = [target, source];
    const key = `${source}\u0000${target}`;
    let aggregate = edgeMap.get(key);
    if (!aggregate) {
      aggregate = {
        source,
        target,
        weight: 0,
        relations: new Map(),
        confidence: emptyConfidence(),
      };
      edgeMap.set(key, aggregate);
    }
    aggregate.weight += 1;
    aggregate.relations.set(edge.relation, (aggregate.relations.get(edge.relation) ?? 0) + 1);
    incrementConfidence(aggregate.confidence, edge.confidence);
    const sourceModule = modules.get(source);
    const targetModule = modules.get(target);
    if (sourceModule) sourceModule.outbound += 1;
    if (targetModule) targetModule.inbound += 1;
  }

  const atlasModules: CodeAtlasModule[] = [...modules.values()]
    .map(module => {
      const files = [...module.files].sort();
      const topSymbols = module.symbols
        .sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label))
        .slice(0, TOP_SYMBOLS_PER_MODULE);
      return {
        id: module.id,
        label: module.label,
        path: module.path,
        layer: module.layer,
        fileCount: module.files.size,
        symbolCount: module.symbols.length,
        inbound: module.inbound,
        outbound: module.outbound,
        hubScore: module.inbound + module.outbound,
        communities: [...module.communities].sort(),
        files: files.slice(0, FILES_PER_MODULE),
        topSymbols,
      };
    })
    .sort((a, b) => b.hubScore - a.hubScore || a.path.localeCompare(b.path));

  const atlasEdges: CodeAtlasEdge[] = [...edgeMap.values()]
    .map(edge => ({
      id: `${edge.source}->${edge.target}`,
      source: edge.source,
      target: edge.target,
      weight: edge.weight,
      relations: [...edge.relations]
        .map(([relation, count]) => ({ relation, count }))
        .sort((a, b) => b.count - a.count || a.relation.localeCompare(b.relation)),
      confidence: edge.confidence,
    }))
    .sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));

  return {
    provider,
    availableProviders: info.availableProviders,
    artifactPath: info.path,
    generatedAt: info.generatedAt,
    builtAtCommit: graph.builtAtCommit,
    schemaVersion: graph.schemaVersion,
    directed: graph.directed,
    stats: {
      rawNodeCount: graph.nodes.length,
      rawEdgeCount: graph.edges.length,
      fileCount: allFiles.size,
      communityCount: allCommunities.size,
      extractedEdges: confidenceTotals.extracted,
      inferredEdges: confidenceTotals.inferred,
      ambiguousEdges: confidenceTotals.ambiguous,
      moduleCount: atlasModules.length,
      crossModuleEdgeCount: atlasEdges.reduce((sum, edge) => sum + edge.weight, 0),
    },
    modules: atlasModules,
    edges: atlasEdges,
  };
}

export function atlasFromGraphify(raw: unknown, info: ArtifactInfo): CodeAtlasData {
  return buildAtlas(parseGraphify(raw), 'graphify', info);
}

export function atlasFromGraft(raw: unknown, info: ArtifactInfo): CodeAtlasData {
  return buildAtlas(parseGraft(raw), 'graft', info);
}

async function artifactInfo(
  projectPath: string,
  provider: CodeGraphProvider
): Promise<{
  path: string;
  size: number;
  generatedAt: string;
} | null> {
  const path = join(projectPath, ...ARTIFACTS[provider]);
  try {
    const stat = await withTimeout(
      fsp.stat(path),
      5000,
      `Graph artifact stat timed out after 5000ms: ${path}`
    );
    if (!stat.isFile()) return null;
    return { path, size: stat.size, generatedAt: stat.mtime.toISOString() };
  } catch (error) {
    const code = record(error)?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw error;
  }
}

export async function getCodeAtlas(
  projectPath: string,
  requestedProvider?: CodeGraphProvider | null
): Promise<CodeAtlasData> {
  if (typeof projectPath !== 'string' || !isAbsolute(projectPath)) {
    throw new Error(`Invalid project path "${projectPath}".`);
  }
  if (
    requestedProvider !== undefined &&
    requestedProvider !== null &&
    requestedProvider !== 'graphify' &&
    requestedProvider !== 'graft'
  ) {
    throw new Error(`Unsupported code graph provider "${requestedProvider}".`);
  }

  const [graphifyInfo, graftInfo] = await Promise.all([
    artifactInfo(projectPath, 'graphify'),
    artifactInfo(projectPath, 'graft'),
  ]);
  const availableProviders: CodeGraphProvider[] = [];
  if (graphifyInfo) availableProviders.push('graphify');
  if (graftInfo) availableProviders.push('graft');
  if (availableProviders.length === 0) return emptyCodeAtlas();

  const provider =
    requestedProvider && availableProviders.includes(requestedProvider)
      ? requestedProvider
      : availableProviders[0];
  const selected = provider === 'graphify' ? graphifyInfo : graftInfo;
  if (!selected) return emptyCodeAtlas(availableProviders);
  if (selected.size > MAX_ARTIFACT_BYTES) {
    throw new Error(
      `${provider} artifact is ${(selected.size / 1024 / 1024).toFixed(1)} MiB; ` +
        `Code Atlas currently caps a graph at ${MAX_ARTIFACT_BYTES / 1024 / 1024} MiB.`
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await readTextFile(selected.path, 15_000)) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read ${provider} graph artifact: ${message}`, { cause: error });
  }

  const info: ArtifactInfo = {
    path: selected.path,
    generatedAt: selected.generatedAt,
    availableProviders,
  };
  return provider === 'graphify' ? atlasFromGraphify(raw, info) : atlasFromGraft(raw, info);
}
