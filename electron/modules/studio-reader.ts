// Agent Studio reader — native workflow scripts are the only source of truth.
// Claude Code resolves named workflows from BOTH the global ~/.claude/workflows/
// and each project's local .claude/workflows/, so the Studio library scans both:
// global scripts plus the project-local ones of every project ClaudeLens knows
// (cwd resolved from ~/.claude/projects, same as the projects list). The visual
// Brief/Flow is a projection of each native script, never a parallel ClaudeLens
// manifest. Scripts outside the representable DSL remain first-class and open
// in the same editor with their source preserved.

import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { CLAUDE_DIR, isAbsolutePath, resolveRealPath } from '../utils';
import type { Blueprint, BlueprintIssue } from './studio-compiler';
import { validateBlueprint, blueprintSteps, countCodeNodes } from './studio-compiler';
import { parseWorkflowScript } from './studio-script';
import { readTextFile } from './safe-fs';

export const WORKFLOWS_DIR = join(CLAUDE_DIR, 'workflows');

export type StudioScope = 'global' | 'project';

export function projectWorkflowsDir(projectPath: string): string {
  if (!isAbsolutePath(projectPath)) {
    throw new Error(`Invalid project path "${projectPath}".`);
  }
  return join(projectPath, '.claude', 'workflows');
}

function workflowsDirFor(projectPath?: string | null): string {
  return projectPath ? projectWorkflowsDir(projectPath) : WORKFLOWS_DIR;
}

export interface BlueprintSummary {
  fileName: string;
  name: string;
  description: string;
  version: string;
  phaseCount: number;
  stepCount: number;
  parallelStepCount: number;
  agentTypes: string[];
  updatedAt: string | null;
  structured: boolean;
  /** Verbatim JS nodes (code chips): 0 = fully visual, >0 = hybrid. */
  codeNodeCount: number;
  errorCount: number;
  warningCount: number;
  scope: StudioScope;
  projectPath: string | null;
}

export interface BlueprintDetail {
  blueprint: Blueprint;
  fileName: string;
  scriptPath: string;
  source: string;
  structured: boolean;
  parseError: string | null;
  issues: BlueprintIssue[];
  scope: StudioScope;
  projectPath: string | null;
}

export interface StudioLibrary {
  blueprints: BlueprintSummary[];
  workflowsDir: string;
}

const SCRIPT_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/;

export function validateScriptFileName(fileName: string): string {
  const trimmed = (fileName ?? '').trim();
  if (!SCRIPT_FILE_RE.test(trimmed) || trimmed.includes('..')) {
    throw new Error(`Invalid workflow script name "${fileName}".`);
  }
  return trimmed;
}

function fileNameFor(identifier: string): string {
  return validateScriptFileName(identifier.endsWith('.js') ? identifier : `${identifier}.js`);
}

export function scriptPathFor(identifier: string, projectPath?: string | null): string {
  return join(workflowsDirFor(projectPath), fileNameFor(identifier));
}

export function parseScriptMeta(source: string): {
  name: string | null;
  description: string | null;
} {
  const parsed = parseWorkflowScript(source, 'workflow.js').blueprint;
  return {
    name: parsed.name === 'workflow' ? null : parsed.name,
    description: parsed.description || null,
  };
}

/** Project cwds known to ClaudeLens, whether or not Studio files exist yet. */
export function discoverKnownProjectPaths(): string[] {
  const projectsDir = join(CLAUDE_DIR, 'projects');
  const paths = new Set<string>();
  try {
    for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const realPath = resolveRealPath(projectsDir, entry.name);
      if (isAbsolutePath(realPath)) paths.add(realPath);
    }
  } catch {
    return [];
  }
  return [...paths].sort();
}

/**
 * Known project cwds that already have local workflows. Doubles as the
 * allowlist for project-scoped write IPC: a projectPath not discoverable here
 * is rejected.
 */
export function discoverProjectsWithWorkflows(): string[] {
  return discoverKnownProjectPaths().filter(projectPath =>
    existsSync(projectWorkflowsDir(projectPath))
  );
}

export function isKnownProjectPath(projectPath: string): boolean {
  return discoverProjectsWithWorkflows().includes(projectPath);
}

export async function readBlueprint(
  identifier: string,
  projectPath?: string | null
): Promise<Blueprint | null> {
  const fileName = fileNameFor(identifier);
  const path = join(workflowsDirFor(projectPath), fileName);
  if (!existsSync(path)) return null;
  try {
    return parseWorkflowScript(await readTextFile(path), fileName).blueprint;
  } catch {
    return null;
  }
}

async function readSummary(
  fileName: string,
  dir: string,
  scope: StudioScope,
  projectPath: string | null
): Promise<BlueprintSummary | null> {
  const path = join(dir, fileName);
  try {
    const source = await readTextFile(path);
    const parsed = parseWorkflowScript(source, fileName);
    const bp = parsed.blueprint;
    const steps = blueprintSteps(bp);
    const allNodes = [...(bp.preamble ?? []), ...bp.phases.flatMap(phase => phase.nodes)];
    const issues = parsed.structured ? validateBlueprint(bp) : [];
    return {
      fileName,
      name: bp.name,
      description: bp.description || bp.brief.goal,
      version: bp.version,
      phaseCount: bp.phases.length,
      stepCount: steps.length,
      parallelStepCount: allNodes
        .filter(n => n.kind === 'parallel')
        .reduce((count, n) => count + (n.kind === 'parallel' ? n.steps.length : 0), 0),
      agentTypes: [
        ...new Set(steps.map(step => step.agentType).filter((name): name is string => !!name)),
      ],
      updatedAt: statSync(path).mtime.toISOString(),
      structured: parsed.structured,
      codeNodeCount: countCodeNodes(bp),
      errorCount: issues.filter(issue => issue.severity === 'error').length,
      warningCount: issues.filter(issue => issue.severity === 'warning').length,
      scope,
      projectPath,
    };
  } catch {
    return null;
  }
}

function workflowFileNames(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isFile() && SCRIPT_FILE_RE.test(entry.name))
      .map(entry => entry.name);
  } catch {
    return [];
  }
}

export async function getBlueprints(projectPaths: string[] = []): Promise<BlueprintSummary[]> {
  const scopes: Array<{ dir: string; scope: StudioScope; projectPath: string | null }> = [
    { dir: WORKFLOWS_DIR, scope: 'global', projectPath: null },
    ...projectPaths.map(projectPath => ({
      dir: projectWorkflowsDir(projectPath),
      scope: 'project' as const,
      projectPath,
    })),
  ];
  const summaries = await Promise.all(
    scopes.flatMap(({ dir, scope, projectPath }) =>
      workflowFileNames(dir).map(fileName => readSummary(fileName, dir, scope, projectPath))
    )
  );
  return summaries
    .filter((summary): summary is BlueprintSummary => summary !== null)
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
}

export async function getBlueprintDetail(
  identifier: string,
  agentTypes?: string[],
  projectPath?: string | null
): Promise<BlueprintDetail | null> {
  const fileName = fileNameFor(identifier);
  const scriptPath = join(workflowsDirFor(projectPath), fileName);
  if (!existsSync(scriptPath)) return null;
  try {
    const source = await readTextFile(scriptPath);
    const parsed = parseWorkflowScript(source, fileName);
    return {
      blueprint: parsed.blueprint,
      fileName,
      scriptPath,
      source,
      structured: parsed.structured,
      parseError: parsed.parseError,
      issues: parsed.structured ? validateBlueprint(parsed.blueprint, { agentTypes }) : [],
      scope: projectPath ? 'project' : 'global',
      projectPath: projectPath ?? null,
    };
  } catch {
    return null;
  }
}

export async function getStudioLibrary(
  projectPaths: string[] = discoverProjectsWithWorkflows()
): Promise<StudioLibrary> {
  const blueprints = await getBlueprints(projectPaths);
  return { blueprints, workflowsDir: WORKFLOWS_DIR };
}
