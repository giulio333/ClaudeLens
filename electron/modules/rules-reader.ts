import { readFileSync } from 'fs';
import { join, basename } from 'path';
import { glob } from 'glob';
import { parseFrontmatter, getStringArray } from './frontmatter';

export interface RuleFile {
  filename: string;
  content: string;
  paths?: string[];
}

// Route through the shared parseFrontmatter (single CRLF-tolerant chokepoint) +
// getStringArray so a CRLF-authored rule file keeps its path scoping instead of
// silently being treated as always-applied.
function extractFrontmatterPaths(content: string): string[] | undefined {
  const { frontmatter } = parseFrontmatter(content);
  return getStringArray(frontmatter, 'paths');
}

export async function readProjectRules(realProjectPath: string): Promise<RuleFile[]> {
  try {
    // La dir passa da `cwd` e il pattern resta relativo con soli `/`: glob
    // tratta `\` nel pattern come escape anche su Windows, quindi un pattern
    // costruito con path.join lì non matcherebbe mai nulla (#59).
    const rulesDir = join(realProjectPath, '.claude', 'rules');
    const files = await glob('**/*.md', { cwd: rulesDir, absolute: true });

    const rules: RuleFile[] = [];

    for (const filePath of files) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const paths = extractFrontmatterPaths(content);

        rules.push({
          filename: basename(filePath),
          content,
          ...(paths !== undefined ? { paths } : {}),
        });
      } catch {
        // Ignora file non leggibili
      }
    }

    return rules;
  } catch (error) {
    console.error(`Errore leggendo regole progetto: ${error}`);
    return [];
  }
}
