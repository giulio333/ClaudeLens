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
    const rulesPattern = join(realProjectPath, '.claude', 'rules', '**', '*.md');
    const files = await glob(rulesPattern, { absolute: true });

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
