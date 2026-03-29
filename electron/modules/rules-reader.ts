import { readFileSync } from 'fs';
import { join, basename } from 'path';
import { glob } from 'glob';
import yaml from 'js-yaml';

export interface RuleFile {
  filename: string;
  content: string;
  paths?: string[];
}

function extractFrontmatterPaths(content: string): string[] | undefined {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return undefined;

  try {
    const parsed = yaml.load(match[1]) as Record<string, unknown>;
    if (parsed && Array.isArray(parsed.paths)) {
      return parsed.paths as string[];
    }
  } catch {
    // Frontmatter non valido
  }

  return undefined;
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
