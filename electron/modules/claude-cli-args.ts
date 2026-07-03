/**
 * Costruzione degli argv per le invocazioni della CLI `claude`.
 *
 * `execFile`/`spawn` evitano la *shell* injection, ma non l'*argument*
 * injection: qualsiasi valore che inizia con `-` verrebbe interpretato dalla
 * CLI come flag (es. un prompt "--model x" altererebbe l'invocazione).
 * Qui ogni positional utente è isolato dietro il sentinel end-of-options
 * `--`, e i valori bound a flag (`--name`, `--agent`, `--model`) — che il
 * sentinel non può proteggere — sono validati prima dell'uso.
 */

/** Modelli accettati dal dispatch background (le opzioni offerte dalla UI). */
export const BG_MODEL_ALLOWLIST = ['opus', 'sonnet', 'haiku'] as const;

/** Rifiuta i valori bound a flag che la CLI leggerebbe come flag a loro volta. */
function assertNotFlagLike(value: string, label: string): void {
  if (value.startsWith('-')) {
    throw new Error(`Invalid ${label}: must not start with "-" (got ${JSON.stringify(value)})`);
  }
}

export interface DispatchBgInput {
  prompt: string;
  name?: string;
  agent?: string;
  model?: string;
}

/** Argv per `claude --bg [...] -- <prompt>` (agents:dispatchBg). */
export function buildDispatchBgArgs({ prompt, name, agent, model }: DispatchBgInput): string[] {
  const args = ['--bg'];
  if (name) {
    assertNotFlagLike(name, 'session name');
    args.push('--name', name);
  }
  if (agent) {
    assertNotFlagLike(agent, 'agent name');
    args.push('--agent', agent);
  }
  if (model) {
    if (!(BG_MODEL_ALLOWLIST as readonly string[]).includes(model)) {
      throw new Error(
        `Invalid model ${JSON.stringify(model)}: expected one of ${BG_MODEL_ALLOWLIST.join(', ')}`
      );
    }
    args.push('--model', model);
  }
  args.push('--', prompt);
  return args;
}

/** Argv per `claude -p [...] -- <instruction>` (ai:run). */
export function buildAiRunArgs(instruction: string): string[] {
  return [
    '-p',
    '--model',
    'Haiku',
    '--allowedTools',
    'Read,Glob,Grep,WebSearch,WebFetch',
    '--no-session-persistence',
    '--',
    instruction,
  ];
}
