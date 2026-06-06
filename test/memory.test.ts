import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readMemory } from '../electron/modules/memory-reader';
import { createTopic, updateTopic, deleteTopic } from '../electron/modules/memory-writer';

let tmp: string;
let memoryDir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'cl-mem-'));
  // readMemory reads from `{projectPath}/memory/`
  memoryDir = join(tmp, 'memory');
  mkdirSync(memoryDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeTopicFile(
  filename: string,
  name: string,
  description: string,
  type: string,
  body: string
) {
  const content = `---\nname: ${name}\ndescription: ${description}\ntype: ${type}\n---\n\n${body}\n`;
  writeFileSync(join(memoryDir, filename), content, 'utf-8');
}

describe('readMemory', () => {
  it('parses a hand-written MEMORY.md + topic files into structured data', async () => {
    writeTopicFile(
      'feedback_ui.md',
      'UI Language',
      'UI must be English',
      'feedback',
      'Use English.'
    );
    writeTopicFile(
      'project_design.md',
      'Design System',
      'The design tokens',
      'project',
      'Tokens here.'
    );
    writeFileSync(
      join(memoryDir, 'MEMORY.md'),
      [
        '# Memory Index',
        '',
        '- [feedback_ui.md](feedback_ui.md) — UI must be English',
        '- [project_design.md](project_design.md) — The design tokens',
        '',
      ].join('\n'),
      'utf-8'
    );

    const data = await readMemory(tmp);

    expect(data.index).toHaveLength(2);

    const ui = data.index.find(t => t.filename === 'feedback_ui.md')!;
    expect(ui).toBeDefined();
    // name preferred from topic frontmatter since link text is a filename
    expect(ui.name).toBe('UI Language');
    expect(ui.description).toBe('UI must be English');
    expect(ui.type).toBe('feedback');

    const design = data.index.find(t => t.filename === 'project_design.md')!;
    expect(design.name).toBe('Design System');
    expect(design.description).toBe('The design tokens');
    expect(design.type).toBe('project');

    // topics map keyed by filename, includes full content but not MEMORY.md
    expect(data.topics.get('feedback_ui.md')).toContain('Use English.');
    expect(data.topics.has('MEMORY.md')).toBe(false);

    expect(data.memoryMd).not.toBeNull();
    expect(data.memoryMd!.content).toContain('# Memory Index');
    expect(data.memoryMd!.lineCount).toBeGreaterThan(0);
  });

  it('infers topic type from filename prefix (feedback_/project_/reference_/default user)', async () => {
    writeTopicFile('feedback_a.md', 'A', 'desc a', 'feedback', 'a');
    writeTopicFile('project_b.md', 'B', 'desc b', 'project', 'b');
    writeTopicFile('reference_c.md', 'C', 'desc c', 'reference', 'c');
    writeTopicFile('notes_d.md', 'D', 'desc d', 'user', 'd');
    writeFileSync(
      join(memoryDir, 'MEMORY.md'),
      [
        '- [feedback_a.md](feedback_a.md) — desc a',
        '- [project_b.md](project_b.md) — desc b',
        '- [reference_c.md](reference_c.md) — desc c',
        '- [notes_d.md](notes_d.md) — desc d',
      ].join('\n'),
      'utf-8'
    );

    const data = await readMemory(tmp);
    const byFile = Object.fromEntries(data.index.map(t => [t.filename, t.type]));
    expect(byFile['feedback_a.md']).toBe('feedback');
    expect(byFile['project_b.md']).toBe('project');
    expect(byFile['reference_c.md']).toBe('reference');
    // no recognized prefix => default 'user'
    expect(byFile['notes_d.md']).toBe('user');
  });

  it('prefers the frontmatter type over the filename prefix', async () => {
    // Filename says feedback_, but frontmatter declares project: the declared
    // type wins so a rename can't silently reclassify the topic.
    writeTopicFile('feedback_misnamed.md', 'Misnamed', 'desc', 'project', 'body');
    writeFileSync(
      join(memoryDir, 'MEMORY.md'),
      '- [feedback_misnamed.md](feedback_misnamed.md) — desc\n',
      'utf-8'
    );

    const data = await readMemory(tmp);
    expect(data.index[0].type).toBe('project');
  });

  it('reads type and originSessionId from a nested metadata block', async () => {
    const content =
      '---\n' +
      'name: Evaluation publishes to senders\n' +
      'description: The CorrelationEngine is bypassed\n' +
      'metadata:\n' +
      '  node_type: memory\n' +
      '  type: project\n' +
      '  originSessionId: 040655d3-6b0c-4c51-8a5a-29d6fa0d8614\n' +
      '---\n\nbody\n';
    writeFileSync(join(memoryDir, 'notes_eval.md'), content, 'utf-8');
    writeFileSync(
      join(memoryDir, 'MEMORY.md'),
      '- [notes_eval.md](notes_eval.md) — The CorrelationEngine is bypassed\n',
      'utf-8'
    );

    const data = await readMemory(tmp);
    const t = data.index[0];
    // node_type must not be mistaken for type; nested type still wins over the
    // 'user' default the filename would imply.
    expect(t.type).toBe('project');
    expect(t.originSessionId).toBe('040655d3-6b0c-4c51-8a5a-29d6fa0d8614');
  });

  it('leaves originSessionId undefined when the frontmatter omits it', async () => {
    writeTopicFile('user_plain.md', 'Plain', 'desc', 'user', 'body');
    writeFileSync(join(memoryDir, 'MEMORY.md'), '- [user_plain.md](user_plain.md) — desc\n', 'utf-8');

    const data = await readMemory(tmp);
    expect(data.index[0].originSessionId).toBeUndefined();
  });

  it('handles a missing memory dir (returns empty structures)', async () => {
    const data = await readMemory(join(tmp, 'does-not-exist'));
    expect(data.index).toEqual([]);
    expect(data.topics.size).toBe(0);
    expect(data.memoryMd).toBeNull();
  });

  it('handles an empty/absent MEMORY.md index (auto-index from topic frontmatter)', async () => {
    // No MEMORY.md present; reader falls back to scanning topic files
    writeTopicFile('reference_x.md', 'X Ref', 'desc x', 'reference', 'body x');

    const data = await readMemory(tmp);
    expect(data.memoryMd).toBeNull();
    expect(data.index).toHaveLength(1);
    expect(data.index[0].name).toBe('X Ref');
    expect(data.index[0].type).toBe('reference');
    expect(data.topics.get('reference_x.md')).toContain('body x');
  });

  it('parses index lines using a plain hyphen separator too', async () => {
    writeTopicFile('user_h.md', 'Hyphen', 'hyphen desc', 'user', 'h');
    writeFileSync(
      join(memoryDir, 'MEMORY.md'),
      '- [user_h.md](user_h.md) - hyphen desc\n',
      'utf-8'
    );
    const data = await readMemory(tmp);
    expect(data.index).toHaveLength(1);
    expect(data.index[0].description).toBe('hyphen desc');
  });
});

describe('createTopic', () => {
  it('writes a topic file with correct frontmatter and appends the index line', () => {
    const filename = createTopic(memoryDir, {
      name: 'My Topic',
      description: 'A description',
      type: 'project',
      content: 'Body content.',
    });

    expect(filename).toBe('project_my_topic.md');

    const fileContent = readFileSync(join(memoryDir, filename), 'utf-8');
    expect(fileContent).toBe(
      '---\nname: My Topic\ndescription: A description\ntype: project\n---\n\nBody content.\n'
    );

    const indexContent = readFileSync(join(memoryDir, 'MEMORY.md'), 'utf-8');
    // em-dash separator, link text and href both the filename
    expect(indexContent).toContain('- [project_my_topic.md](project_my_topic.md) — A description');
    // created from scratch with a header
    expect(indexContent.startsWith('# Memory Index')).toBe(true);
  });

  it('rejects an invalid topic type (issue #58)', () => {
    expect(() =>
      createTopic(memoryDir, {
        name: 'Evil',
        description: 'd',
        // @ts-expect-error — exercising the runtime guard for an out-of-union type
        type: '../../../etc',
        content: 'x',
      })
    ).toThrow(/Invalid topic type/);
  });

  it('rejects a name that slugs to empty (issue #58)', () => {
    expect(() =>
      createTopic(memoryDir, { name: '../../', description: 'd', type: 'user', content: 'x' })
    ).toThrow(/empty slug/);
  });

  it('appends to an existing MEMORY.md without clobbering existing lines', () => {
    writeFileSync(
      join(memoryDir, 'MEMORY.md'),
      '# Memory Index\n\n- [existing.md](existing.md) — old\n',
      'utf-8'
    );
    createTopic(memoryDir, { name: 'Second', description: 'two', type: 'user', content: 'x' });
    const index = readFileSync(join(memoryDir, 'MEMORY.md'), 'utf-8');
    expect(index).toContain('- [existing.md](existing.md) — old');
    expect(index).toContain('- [user_second.md](user_second.md) — two');
  });

  it('normalizes accented characters in the filename', () => {
    const filename = createTopic(memoryDir, {
      name: 'Caffè Però àáâ èéê ìí òó ùú',
      description: 'd',
      type: 'reference',
      content: 'c',
    });
    // accents folded to base letters, spaces/non-alnum -> single underscore, lowercased
    expect(filename).toBe('reference_caffe_pero_aaa_eee_ii_oo_uu.md');
  });

  it('trims leading/trailing underscores produced by punctuation', () => {
    const filename = createTopic(memoryDir, {
      name: '  !Hello, World!  ',
      description: 'd',
      type: 'user',
      content: 'c',
    });
    expect(filename).toBe('user_hello_world.md');
  });

  it('collapses newlines in a description so frontmatter and index stay single-line', async () => {
    const filename = createTopic(memoryDir, {
      name: 'Multi',
      description: 'line one\nline two\n  line three',
      type: 'user',
      content: 'body',
    });

    const fileContent = readFileSync(join(memoryDir, filename), 'utf-8');
    // frontmatter description must remain on a single line
    expect(fileContent).toContain('description: line one line two line three\n');
    // and the frontmatter block is still parseable end-to-end
    expect(fileContent.startsWith('---\nname: Multi\n')).toBe(true);

    const index = readFileSync(join(memoryDir, 'MEMORY.md'), 'utf-8');
    expect(index).toContain(`- [${filename}](${filename}) — line one line two line three`);

    // the reader round-trips it without corruption
    const data = await readMemory(tmp);
    const topic = data.index.find(t => t.filename === filename)!;
    expect(topic.description).toBe('line one line two line three');
  });

  it('does not overwrite an existing topic when names fold to the same slug', () => {
    const first = createTopic(memoryDir, {
      name: 'Café',
      description: 'the original',
      type: 'user',
      content: 'first body',
    });
    const second = createTopic(memoryDir, {
      name: 'Cafe',
      description: 'the second',
      type: 'user',
      content: 'second body',
    });

    expect(first).toBe('user_cafe.md');
    expect(second).toBe('user_cafe_2.md');
    expect(first).not.toBe(second);

    // both files survive with their own content
    expect(readFileSync(join(memoryDir, first), 'utf-8')).toContain('first body');
    expect(readFileSync(join(memoryDir, second), 'utf-8')).toContain('second body');

    // index has two distinct entries, no desync
    const index = readFileSync(join(memoryDir, 'MEMORY.md'), 'utf-8');
    expect(index).toContain('- [user_cafe.md](user_cafe.md) — the original');
    expect(index).toContain('- [user_cafe_2.md](user_cafe_2.md) — the second');
  });
});

describe('updateTopic', () => {
  it('rewrites the file body/frontmatter and keeps the index description in sync', () => {
    const filename = createTopic(memoryDir, {
      name: 'Topic',
      description: 'original',
      type: 'user',
      content: 'old body',
    });

    updateTopic(memoryDir, filename, {
      name: 'Topic',
      description: 'updated desc',
      type: 'user',
      content: 'new body',
    });

    const fileContent = readFileSync(join(memoryDir, filename), 'utf-8');
    expect(fileContent).toContain('description: updated desc');
    expect(fileContent).toContain('new body');
    expect(fileContent).not.toContain('old body');

    const index = readFileSync(join(memoryDir, 'MEMORY.md'), 'utf-8');
    expect(index).toContain(`- [${filename}](${filename}) — updated desc`);
    expect(index).not.toContain('original');
  });

  it('collapses newlines in the updated description', () => {
    const filename = createTopic(memoryDir, {
      name: 'Topic',
      description: 'original',
      type: 'user',
      content: 'body',
    });

    updateTopic(memoryDir, filename, {
      name: 'Topic',
      description: 'updated\nover\nlines',
      type: 'user',
      content: 'body',
    });

    const index = readFileSync(join(memoryDir, 'MEMORY.md'), 'utf-8').split('\n');
    // exactly one index line still references this file (no extra lines injected)
    expect(index.filter(l => l.includes(`(${filename})`))).toHaveLength(1);
    expect(index).toContain(`- [${filename}](${filename}) — updated over lines`);
  });
});

describe('deleteTopic', () => {
  it('removes the topic file and its index line', () => {
    const filename = createTopic(memoryDir, {
      name: 'Doomed',
      description: 'gone soon',
      type: 'user',
      content: 'bye',
    });
    expect(existsSync(join(memoryDir, filename))).toBe(true);

    deleteTopic(memoryDir, filename);

    expect(existsSync(join(memoryDir, filename))).toBe(false);
    const index = readFileSync(join(memoryDir, 'MEMORY.md'), 'utf-8');
    expect(index).not.toContain(filename);
    expect(index).not.toContain('gone soon');
  });

  it('leaves sibling index lines intact when deleting one topic', () => {
    const a = createTopic(memoryDir, {
      name: 'Keep',
      description: 'keep me',
      type: 'user',
      content: 'a',
    });
    const b = createTopic(memoryDir, {
      name: 'Drop',
      description: 'drop me',
      type: 'user',
      content: 'b',
    });

    deleteTopic(memoryDir, b);

    const index = readFileSync(join(memoryDir, 'MEMORY.md'), 'utf-8');
    expect(index).toContain(a);
    expect(index).not.toContain(b);
  });
});

describe('round-trip', () => {
  it('createTopic then readMemory returns the created topic', async () => {
    const filename = createTopic(memoryDir, {
      name: 'Round Trip',
      description: 'a full cycle',
      type: 'project',
      content: 'Round trip body.',
    });

    const data = await readMemory(tmp);

    const topic = data.index.find(t => t.filename === filename)!;
    expect(topic).toBeDefined();
    expect(topic.name).toBe('Round Trip');
    expect(topic.description).toBe('a full cycle');
    expect(topic.type).toBe('project');
    expect(data.topics.get(filename)).toContain('Round trip body.');
  });

  it('preserves originSessionId through a create/read/update cycle', async () => {
    const filename = createTopic(memoryDir, {
      name: 'With Origin',
      description: 'carries provenance',
      type: 'project',
      content: 'body',
      originSessionId: '040655d3-6b0c-4c51-8a5a-29d6fa0d8614',
    });

    let data = await readMemory(tmp);
    expect(data.index.find(t => t.filename === filename)!.originSessionId).toBe(
      '040655d3-6b0c-4c51-8a5a-29d6fa0d8614'
    );

    // A UI edit must not drop the provenance.
    updateTopic(memoryDir, filename, {
      name: 'With Origin',
      description: 'edited',
      type: 'project',
      content: 'new body',
      originSessionId: '040655d3-6b0c-4c51-8a5a-29d6fa0d8614',
    });

    data = await readMemory(tmp);
    expect(data.index.find(t => t.filename === filename)!.originSessionId).toBe(
      '040655d3-6b0c-4c51-8a5a-29d6fa0d8614'
    );
  });
});
