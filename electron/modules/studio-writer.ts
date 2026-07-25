// Agent Studio writer — native workflow scripts are the only persisted model.
// Brief and Flow edits compile directly to <scope>/workflows/<name>.js, where
// the scope is the global ~/.claude/workflows or, when a projectPath is given,
// the project-local .claude/workflows (both are native Claude Code locations).

import { writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { dirname } from 'path';
import os from 'os';
import { assertWithin } from '../utils';
import { readTextFile } from './safe-fs';
import {
  type Blueprint,
  BLUEPRINT_NAME_RE,
  compileBlueprint,
  validateBlueprint,
} from './studio-compiler';
import {
  WORKFLOWS_DIR,
  projectWorkflowsDir,
  scriptPathFor,
  validateScriptFileName,
} from './studio-reader';
import { parseWorkflowScript } from './studio-script';

function validateBlueprintName(name: string): string {
  const trimmed = (name ?? '').trim();
  if (!BLUEPRINT_NAME_RE.test(trimmed)) {
    throw new Error(
      `Invalid workflow name "${name}": use lowercase letters, digits and dashes (it becomes the /${trimmed || 'name'} command).`
    );
  }
  return trimmed;
}

function checkedScriptPath(identifier: string, projectPath?: string | null): string {
  const dir = projectPath ? projectWorkflowsDir(projectPath) : WORKFLOWS_DIR;
  const path = scriptPathFor(identifier, projectPath);
  if (!projectPath) assertWithin(os.homedir(), path);
  assertWithin(dir, path);
  return path;
}

async function assertSourceUnchanged(path: string, expectedSource?: string): Promise<void> {
  if (expectedSource === undefined) return;
  let current: string | null = null;
  if (existsSync(path)) {
    // Read async: the on-disk script may live on an iCloud/network volume where
    // a sync read of a dataless file would freeze the whole main process. A read
    // that fails/times out leaves `current` null → treated as "changed".
    try {
      current = await readTextFile(path);
    } catch {
      current = null;
    }
  }
  if (current !== expectedSource) {
    throw new Error(
      'Workflow changed on disk after this editor was opened. Copy any draft changes, then discard or reload before saving.'
    );
  }
}

export async function saveBlueprint(
  input: Blueprint,
  fileName?: string,
  projectPath?: string | null,
  expectedSource?: string
): Promise<{ scriptPath: string; script: string }> {
  const name = validateBlueprintName(input.name);
  const blueprint = { ...input, name };
  const errors = validateBlueprint(blueprint).filter(issue => issue.severity === 'error');
  if (errors.length > 0) {
    throw new Error(`Cannot save workflow: ${errors.map(error => error.message).join(' · ')}`);
  }

  const script = compileBlueprint(blueprint);
  // Verbatim code nodes and schema literals are user-supplied JS: refuse to
  // write a script that no longer parses instead of breaking the workflow.
  const syntaxCheck = parseWorkflowScript(script, `${name}.js`);
  if (syntaxCheck.parseError) {
    throw new Error(
      `Cannot save workflow: the compiled script has a syntax error (${syntaxCheck.parseError}). Check code blocks and schema literals.`
    );
  }
  const scriptPath = checkedScriptPath(
    fileName ? validateScriptFileName(fileName) : name,
    projectPath
  );
  await assertSourceUnchanged(scriptPath, expectedSource);
  mkdirSync(dirname(scriptPath), { recursive: true });
  writeFileSync(scriptPath, script, 'utf-8');
  return { scriptPath, script };
}

export async function createBlueprint(
  input: Blueprint,
  projectPath?: string | null
): Promise<{ scriptPath: string; script: string }> {
  const name = validateBlueprintName(input.name);
  if (existsSync(checkedScriptPath(name, projectPath))) {
    throw new Error(`A workflow named "${name}" already exists.`);
  }
  return saveBlueprint(input, undefined, projectPath);
}

export function deleteBlueprint(
  name: string,
  _alsoScript = false,
  projectPath?: string | null
): void {
  const scriptPath = checkedScriptPath(name, projectPath);
  rmSync(scriptPath, { force: true });
}

export async function writeNativeScript(
  fileName: string,
  content: string,
  projectPath?: string | null,
  expectedSource?: string
): Promise<{ path: string }> {
  const path = checkedScriptPath(validateScriptFileName(fileName), projectPath);
  if (!existsSync(path)) {
    throw new Error(`Workflow script "${fileName}" not found in ${dirname(path)}.`);
  }
  await assertSourceUnchanged(path, expectedSource);
  writeFileSync(path, content, 'utf-8');
  return { path };
}
