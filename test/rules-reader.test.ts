import { readProjectRules } from '../electron/modules/rules-reader';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let projectPath: string; // simula la root reale di un progetto

beforeEach(() => {
  projectPath = mkdtempSync(join(tmpdir(), 'cl-rules-'));
});

afterEach(() => {
  rmSync(projectPath, { recursive: true, force: true });
});

describe('readProjectRules', () => {
  it('legge le regole in .claude/rules/, incluse le sottocartelle', async () => {
    const rulesDir = join(projectPath, '.claude', 'rules');
    mkdirSync(join(rulesDir, 'backend'), { recursive: true });
    writeFileSync(join(rulesDir, 'general.md'), '# Always\n', 'utf-8');
    writeFileSync(
      join(rulesDir, 'backend', 'api.md'),
      '---\npaths:\n  - "src/api/**"\n---\n# API rules\n',
      'utf-8'
    );

    const rules = await readProjectRules(projectPath);
    const byName = new Map(rules.map(r => [r.filename, r]));

    expect(rules).toHaveLength(2);
    expect(byName.get('general.md')?.paths).toBeUndefined();
    expect(byName.get('api.md')?.paths).toEqual(['src/api/**']);
    expect(byName.get('api.md')?.content).toContain('# API rules');
  });

  it('ignora file non-md e restituisce [] senza directory rules', async () => {
    expect(await readProjectRules(projectPath)).toEqual([]);

    const rulesDir = join(projectPath, '.claude', 'rules');
    mkdirSync(rulesDir, { recursive: true });
    writeFileSync(join(rulesDir, 'notes.txt'), 'not a rule', 'utf-8');
    expect(await readProjectRules(projectPath)).toEqual([]);
  });
});
