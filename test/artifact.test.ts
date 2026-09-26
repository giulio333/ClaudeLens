import { describe, it, expect } from 'vitest';
import {
  artifactAction,
  artifactDescription,
  artifactIsPrivate,
  artifactOf,
  artifactStatusLabel,
  artifactVersion,
  buildArtifactActivity,
  shortArtifactUrl,
} from '../src/components/project/chat/artifact';
import type { ArtifactPublish } from '../src/types';
import type { ToolGroup } from '../src/components/project/chat/utils';

const page = (over: Partial<ArtifactPublish> = {}): ArtifactPublish => ({
  id: 'a1',
  url: 'https://claude.ai/artifact/AbCdEf',
  title: 'Release checklist',
  updated: true,
  seq: 2,
  audience: 'owner',
  ...over,
});

function call(
  input: Record<string, unknown>,
  artifact?: ArtifactPublish,
  opts: { isError?: boolean; name?: string; id?: string } = {}
): ToolGroup {
  return {
    use: { type: 'tool_use', id: opts.id ?? 't1', name: opts.name ?? 'Artifact', input },
    result: {
      type: 'tool_result',
      toolUseId: opts.id ?? 't1',
      content: 'Published …',
      isError: opts.isError ?? false,
      ...(artifact ? { artifact } : {}),
    },
  } as ToolGroup;
}

describe('reading one Artifact call', () => {
  it('tells a publish from a call that produced no page', () => {
    expect(artifactOf(call({ action: 'publish' }, page()))?.title).toBe('Release checklist');
    // A quickstart answers a question. There is no page, so there is nothing to
    // draw as one — and the action is what names the chip that stands in.
    expect(artifactOf(call({ action: 'quickstart', intent: 'design' }))).toBeUndefined();
    expect(artifactAction(call({ action: 'quickstart', intent: 'design' }))).toBe('quickstart');
  });

  it('calls a call with no action a publish, because that is what it is', () => {
    expect(artifactAction(call({ file_path: '/tmp/p.html' }))).toBe('publish');
  });

  it('reads the summary off the call that carried it', () => {
    expect(artifactDescription(call({ description: '  Before and after  ' }))).toBe(
      'Before and after'
    );
    expect(artifactDescription(call({ description: '   ' }))).toBeUndefined();
    expect(artifactDescription(call({}))).toBeUndefined();
  });

  it('drops the scheme from the link but never the host', () => {
    expect(shortArtifactUrl('https://claude.ai/artifact/AbCdEf')).toBe('claude.ai/artifact/AbCdEf');
    expect(shortArtifactUrl('https://claude.ai/artifact/AbCdEf/')).toBe(
      'claude.ai/artifact/AbCdEf'
    );
  });

  it('says nothing about the version when the transcript does not', () => {
    expect(artifactVersion(page({ seq: 4 }))).toBe('v4');
    expect(artifactVersion(page({ seq: undefined }))).toBe('');
    expect(artifactVersion(page({ seq: 0 }))).toBe('');
  });

  it('separates the publish that created the page from a republish', () => {
    expect(artifactStatusLabel(page({ updated: false }))).toBe('CREATED');
    expect(artifactStatusLabel(page({ updated: true }))).toBe('UPDATED');
  });

  it('does not claim a page is private when it does not know', () => {
    expect(artifactIsPrivate(page({ audience: 'owner' }))).toBe(true);
    expect(artifactIsPrivate(page({ audience: 'users' }))).toBe(false);
    expect(artifactIsPrivate(page({ audience: undefined }))).toBeUndefined();
  });
});

describe('the pages a session published', () => {
  it('folds every publish of one page into one entry', () => {
    const groups = [
      call({ description: 'Before and after' }, page({ updated: false, seq: 1 }), { id: 't1' }),
      call({}, page({ seq: 2 }), { id: 't2' }),
      call({}, page({ seq: 3, title: 'Renamed' }), { id: 't3' }),
    ];
    const [a] = buildArtifactActivity(groups);
    expect(a.publishes).toBe(3);
    // The newest title wins: a page can be retitled between publishes.
    expect(a.title).toBe('Renamed');
    expect(a.seq).toBe(3);
    expect(a.created).toBe(true);
    expect(a.description).toBe('Before and after');
    expect(a.items).toHaveLength(3);
  });

  it('keeps two different pages apart', () => {
    const groups = [
      call({}, page({ id: 'a1', title: 'One' }), { id: 't1' }),
      call({}, page({ id: 'a2', title: 'Two', url: 'https://claude.ai/artifact/Zz' }), {
        id: 't2',
      }),
    ];
    expect(buildArtifactActivity(groups).map(a => a.title)).toEqual(['One', 'Two']);
  });

  it('joins a page created from a type to the publishes that followed it', () => {
    // The creation records only the URL, so its id is the URL; the publishes
    // after it carry the real id with that same URL.
    const url = 'https://claude.ai/artifact/Xy12Zw';
    const groups = [
      call({}, page({ id: url, url, updated: false, seq: undefined }), { id: 't1' }),
      call({}, page({ id: 'real-id', url, updated: true, seq: 2 }), { id: 't2' }),
    ];
    const activity = buildArtifactActivity(groups);
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ publishes: 2, created: true, seq: 2 });
  });

  it('says the page was only updated when this session never created it', () => {
    const [a] = buildArtifactActivity([call({}, page({ updated: true, seq: 7 }))]);
    expect(a.created).toBe(false);
    expect(a.seq).toBe(7);
  });

  it('leaves out the calls that published nothing', () => {
    const groups = [
      call({ action: 'quickstart' }),
      call({ action: 'list' }),
      call({ action: 'publish' }, page()),
      // A refusal answers with no page at all, so it cannot be keyed to one.
      call({ action: 'publish' }, undefined, { isError: true }),
      call({ command: 'ls' }, undefined, { name: 'Bash' }),
    ];
    expect(buildArtifactActivity(groups)).toHaveLength(1);
  });

  it('has no entry for a session that published nothing', () => {
    expect(buildArtifactActivity([])).toEqual([]);
  });
});
