import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  atlasFromGraft,
  atlasFromGraphify,
  getCodeAtlas,
  modulePathForFile,
} from '../electron/modules/code-atlas-reader';

const artifact = {
  path: '/repo/graph.json',
  generatedAt: '2026-08-13T10:00:00.000Z',
  availableProviders: ['graphify', 'graft'] as const,
};

const temporaryProjects: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryProjects.splice(0).map(path => rm(path, { recursive: true })));
});

describe('Code Atlas adapters', () => {
  it('groups source files into stable architecture modules', () => {
    expect(modulePathForFile('src/components/project/chat/ChatView.tsx')).toBe(
      'src/components/project/chat'
    );
    expect(modulePathForFile('src/components/project/studio/canvas/graph.ts')).toBe(
      'src/components/project/studio/canvas'
    );
    expect(modulePathForFile('electron/modules/session-reader.ts')).toBe(
      'electron/modules/session'
    );
    expect(modulePathForFile('test/chat-utils.test.ts')).toBe('test');
    expect(modulePathForFile('vite.config.ts')).toBe('tooling');
  });

  it('normalizes Graft wiring and collapses symbol edges between modules', () => {
    const atlas = atlasFromGraft(
      {
        meta: { version: 1 },
        nodes: [
          {
            id: 'src/components/project/chat/ChatView.tsx#ChatView',
            name: 'ChatView',
            kind: 'function',
            path: 'src/components/project/chat/ChatView.tsx',
            span: 'L10-L40',
            exported: true,
          },
          {
            id: 'electron/modules/session-reader.ts#readChat',
            name: 'readChat',
            kind: 'function',
            path: 'electron/modules/session-reader.ts',
            span: 'L20-L60',
            exported: true,
          },
          {
            id: 'electron/modules/session-reader.ts',
            name: 'session-reader.ts',
            kind: 'file',
            path: 'electron/modules/session-reader.ts',
          },
        ],
        edges: [
          {
            source: 'electron/modules/session-reader.ts',
            target: 'electron/modules/session-reader.ts#readChat',
            relation: 'contains',
            confidence: 'extracted',
          },
          {
            source: 'src/components/project/chat/ChatView.tsx#ChatView',
            target: 'electron/modules/session-reader.ts#readChat',
            relation: 'calls',
            confidence: 'extracted',
          },
          {
            source: 'src/components/project/chat/ChatView.tsx#ChatView',
            target: 'electron/modules/session-reader.ts',
            relation: 'imports',
            confidence: 'extracted',
          },
        ],
      },
      { ...artifact, availableProviders: [...artifact.availableProviders] }
    );

    expect(atlas.provider).toBe('graft');
    expect(atlas.directed).toBe(true);
    expect(atlas.schemaVersion).toBe('1');
    expect(atlas.modules.map(module => module.id)).toEqual([
      'electron/modules/session',
      'src/components/project/chat',
    ]);
    expect(atlas.edges).toHaveLength(1);
    expect(atlas.edges[0]).toMatchObject({
      source: 'src/components/project/chat',
      target: 'electron/modules/session',
      weight: 2,
      relations: [
        { relation: 'calls', count: 1 },
        { relation: 'imports', count: 1 },
      ],
    });
    expect(atlas.stats).toMatchObject({
      rawNodeCount: 3,
      rawEdgeCount: 3,
      fileCount: 2,
      extractedEdges: 3,
      crossModuleEdgeCount: 2,
    });
  });

  it('keeps Graphify provenance and communities while using its undirected flag', () => {
    const atlas = atlasFromGraphify(
      {
        directed: false,
        built_at_commit: 'abc123def',
        nodes: [
          {
            id: 'reader',
            label: 'readChat',
            file_type: 'code',
            source_file: 'electron/modules/session-reader.ts',
            source_location: 'L20',
            community: 7,
            community_name: 'Sessions',
          },
          {
            id: 'view',
            label: 'ChatView',
            file_type: 'code',
            source_file: 'src/components/project/chat/ChatView.tsx',
            source_location: 'L10',
            community: 3,
            community_name: 'Chat UI',
          },
        ],
        links: [
          {
            source: 'view',
            target: 'reader',
            relation: 'references',
            confidence: 'INFERRED',
          },
        ],
      },
      { ...artifact, availableProviders: [...artifact.availableProviders] }
    );

    expect(atlas.provider).toBe('graphify');
    expect(atlas.directed).toBe(false);
    expect(atlas.builtAtCommit).toBe('abc123def');
    expect(atlas.stats.communityCount).toBe(2);
    expect(atlas.stats.inferredEdges).toBe(1);
    expect(atlas.edges[0].confidence.inferred).toBe(1);
  });

  it('discovers fixed project-local artifacts and honors the requested provider', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'claudelens-code-atlas-'));
    temporaryProjects.push(projectPath);
    const graphifyPath = join(projectPath, 'graphify-out');
    const graftPath = join(projectPath, 'graft', '.graph');
    await Promise.all([
      mkdir(graphifyPath, { recursive: true }),
      mkdir(graftPath, { recursive: true }),
    ]);

    await Promise.all([
      writeFile(
        join(graphifyPath, 'graph.json'),
        JSON.stringify({
          directed: false,
          nodes: [
            { id: 'a', label: 'A', source_file: 'src/a.ts' },
            { id: 'b', label: 'B', source_file: 'electron/b.ts' },
          ],
          links: [{ source: 'a', target: 'b', relation: 'references' }],
        })
      ),
      writeFile(
        join(graftPath, 'wiring.json'),
        JSON.stringify({
          meta: { version: 1 },
          nodes: [
            { id: 'a', name: 'A', kind: 'function', path: 'src/a.ts' },
            { id: 'b', name: 'B', kind: 'function', path: 'electron/b.ts' },
          ],
          edges: [{ source: 'a', target: 'b', relation: 'calls' }],
        })
      ),
    ]);

    const atlas = await getCodeAtlas(projectPath, 'graft');
    expect(atlas.provider).toBe('graft');
    expect(atlas.availableProviders).toEqual(['graphify', 'graft']);
    expect(atlas.artifactPath).toBe(join(graftPath, 'wiring.json'));
    expect(atlas.stats).toMatchObject({ rawNodeCount: 2, rawEdgeCount: 1 });
  });
});
