export type CodeGraphProvider = 'graphify' | 'graft';

export type CodeAtlasLayer = 'renderer' | 'main' | 'tests' | 'tooling' | 'other';

export type CodeGraphConfidence = 'extracted' | 'inferred' | 'ambiguous' | 'unknown';

export interface CodeAtlasConfidenceCounts {
  extracted: number;
  inferred: number;
  ambiguous: number;
  unknown: number;
}

export interface CodeAtlasSymbol {
  id: string;
  label: string;
  kind: string;
  file: string;
  location: string | null;
  degree: number;
  exported: boolean | null;
}

export interface CodeAtlasModule {
  id: string;
  label: string;
  path: string;
  layer: CodeAtlasLayer;
  fileCount: number;
  symbolCount: number;
  inbound: number;
  outbound: number;
  hubScore: number;
  communities: string[];
  files: string[];
  topSymbols: CodeAtlasSymbol[];
}

export interface CodeAtlasRelationCount {
  relation: string;
  count: number;
}

export interface CodeAtlasEdge {
  id: string;
  source: string;
  target: string;
  weight: number;
  relations: CodeAtlasRelationCount[];
  confidence: CodeAtlasConfidenceCounts;
}

export interface CodeAtlasStats {
  rawNodeCount: number;
  rawEdgeCount: number;
  fileCount: number;
  communityCount: number;
  extractedEdges: number;
  inferredEdges: number;
  ambiguousEdges: number;
  moduleCount: number;
  crossModuleEdgeCount: number;
}

export interface CodeAtlasData {
  provider: CodeGraphProvider | null;
  availableProviders: CodeGraphProvider[];
  artifactPath: string | null;
  generatedAt: string | null;
  builtAtCommit: string | null;
  schemaVersion: string | null;
  directed: boolean;
  stats: CodeAtlasStats;
  modules: CodeAtlasModule[];
  edges: CodeAtlasEdge[];
}
