#!/usr/bin/env node
// Make Claude Code write the transcript rows we want to look at.
//
//   node scripts/transcript-exercise.mjs --list
//   node scripts/transcript-exercise.mjs --yes                 # every scenario
//   node scripts/transcript-exercise.mjs --yes --only skill,plan
//   node scripts/transcript-exercise.mjs --census              # census the result
//
// The census reads whatever happens to be on disk, which is a corpus of the
// user's own work: it covers the features the user happens to use, and says
// nothing about the rest. A feature nobody exercised writes no rows, so the
// census cannot tell "Claude Code doesn't do this" from "we never tried".
//
// This script closes that gap by running `claude -p` against prompts chosen to
// produce specific row shapes. It is the third stage on purpose, and opt-in on
// purpose: it spends real tokens on real model turns, so it never runs as part
// of a verify and refuses to start without `--yes`.
//
// Every run works inside a throwaway directory under the system temp dir. That
// matters for more than tidiness: Claude Code derives a project's data
// directory from its cwd, so a run in a temp dir lands in its own
// `~/.claude/projects/<hash>` and the corpus the census reads stays untouched.
// `--census` then points the census at that one directory, so what comes back
// is what *this* run produced and nothing else.

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The scenarios. Each one names the shapes it is trying to provoke, so a run
 * that produces nothing new is a finding in itself: either the prompt no longer
 * exercises the feature, or Claude Code stopped recording it that way.
 *
 * `prompt` is deliberately cheap — one turn, no real work. We want the row, not
 * the answer. `setup` writes whatever the scenario needs into the sandbox
 * before the turn.
 */
const SCENARIOS = [
  {
    key: 'plain',
    provokes: ['assistant', 'user', 'system/turn_duration'],
    why: 'the floor: a single turn with no tools, to pin what an ordinary exchange writes',
    prompt: 'Reply with exactly the word: ok',
    args: [],
  },
  {
    key: 'tool',
    provokes: ['tool_use', 'tool_result', 'toolUseResult'],
    why: 'a read-only tool call, for the tool_use/tool_result pair and the toolUseResult sidecar',
    prompt: 'Read the file NOTES.md in this directory and reply with its first word only.',
    args: ['--allowed-tools', 'Read'],
    setup: dir => writeFileSync(join(dir, 'NOTES.md'), 'sentinel line\n'),
  },
  {
    key: 'skill',
    provokes: ['attachment/skill_listing', 'assistant.attributionSkill', 'isMeta skill expansion'],
    why: 'the #246 shape: the "Base directory for this skill" row is the only thing that says a /foo was a skill',
    prompt: '/drift-probe',
    args: ['--allowed-tools', 'Skill'],
    setup: dir => {
      const skill = join(dir, '.claude', 'skills', 'drift-probe');
      mkdirSync(skill, { recursive: true });
      writeFileSync(
        join(skill, 'SKILL.md'),
        [
          '---',
          'name: drift-probe',
          'description: A no-op skill used to provoke the skill-invocation transcript rows.',
          '---',
          '',
          'Reply with exactly the word: probed',
        ].join('\n') + '\n'
      );
    },
  },
  {
    key: 'subagent',
    provokes: [
      'isSidechain rows',
      'subagents/ transcripts',
      'agent-name',
      'assistant.attributionAgent',
    ],
    why: 'sub-agent transcripts live one level deeper than the main one; the watcher depth and subagents-reader both depend on that layout',
    prompt: 'Use the Explore agent to find the file NOTES.md here, then reply with one word.',
    args: ['--allowed-tools', 'Agent,Read,Glob'],
    setup: dir => writeFileSync(join(dir, 'NOTES.md'), 'sentinel line\n'),
  },
  {
    key: 'plan',
    provokes: ['attachment/plan_mode', 'attachment/plan_mode_exit', 'permission-mode'],
    why: 'plan mode records the plan file path against the session — the link plans-reader has no way to make',
    prompt: 'Plan (do not implement) how you would add a line to NOTES.md. Keep it to two bullets.',
    args: ['--permission-mode', 'plan', '--allowed-tools', 'Read'],
    setup: dir => writeFileSync(join(dir, 'NOTES.md'), 'sentinel line\n'),
  },
  {
    key: 'thinking',
    provokes: ['thinking blocks', 'assistant.effort'],
    why: 'thinking is 6k+ blocks in the observed corpus and the reader skips empty ones; a fresh sample keeps that path honest',
    prompt: 'Think briefly, then reply with the number of letters in the word "drift".',
    args: [],
  },
  {
    key: 'interrupt',
    provokes: ['assistant.isAbortedMidStream', 'assistant.truncatedAfterOutput'],
    why: 'a turn cut short leaves a fragment the transcript renders as if complete; the 1-turn cap is the closest a print-mode run can get to an interrupt. UNVERIFIED — the cap may end the turn cleanly and write neither field, in which case this scenario reports success while proving nothing. Confirm with --census before trusting its silence.',
    prompt:
      'Read NOTES.md, then read NOTES.md again, then reply with its first word. Do all three.',
    args: ['--allowed-tools', 'Read', '--max-turns', '1'],
    setup: dir => writeFileSync(join(dir, 'NOTES.md'), 'sentinel line\n'),
  },
];

// Deliberately absent: a scenario for `system/model_refusal_fallback` and
// `assistant.isApiErrorMessage`. Both are real shapes worth reading — a
// transcript that renders a refusal or an API failure as ordinary assistant
// prose is misleading — but neither can be provoked by asking nicely. A
// compliant prompt produces a compliant turn and would report success while
// proving nothing, and a *non*-compliant prompt is not something this script
// should be sending. They stay `candidate` in the manifest on the strength of
// the rows already in the corpus, and the fixtures in
// `test/transcript-drift.test.ts` are where their handling gets pinned.

function fail(msg) {
  console.error(msg);
  process.exit(2);
}

/**
 * `~/.claude/projects/<hash>` for a cwd: the absolute path with `/` → `-`.
 *
 * The path has to be the *real* one. On macOS the system temp dir is
 * `/var/folders/…`, a symlink to `/private/var/folders/…`, and Claude Code
 * resolves before hashing — so a sandbox run lands under
 * `-private-var-folders-…` and looking for `-var-folders-…` finds nothing.
 * Verified the hard way: the first run reported "NO TRANSCRIPT WRITTEN" for a
 * turn that had in fact written one. The same gotcha is why `SessionSource.cwd`
 * in session-reader insists on a resolved path.
 */
function projectDirFor(cwd) {
  let real = cwd;
  try {
    real = realpathSync(cwd);
  } catch {
    // Not yet created, or gone: the unresolved path is the best guess left.
  }
  return join(homedir(), '.claude', 'projects', real.replace(/[/\\:]/g, '-'));
}

function runScenario(scenario, sandbox) {
  const dir = join(sandbox, scenario.key);
  mkdirSync(dir, { recursive: true });
  scenario.setup?.(dir);

  const args = ['-p', scenario.prompt, ...scenario.args];
  const started = Date.now();
  const res = spawnSync('claude', args, {
    cwd: dir,
    encoding: 'utf8',
    timeout: 180_000,
    // A scenario that stalls waiting for a permission answer would hang the
    // whole run; in print mode nobody is there to answer one.
    env: { ...process.env, CLAUDE_CODE_NONINTERACTIVE: '1' },
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  const projectDir = projectDirFor(dir);
  return {
    key: scenario.key,
    provokes: scenario.provokes,
    cwd: dir,
    projectDir,
    wrote: existsSync(projectDir),
    status: res.status,
    seconds,
    stdout: (res.stdout ?? '').trim().slice(0, 200),
    stderr: (res.stderr ?? '').trim().slice(0, 400),
    error: res.error?.message,
  };
}

function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('--list')) {
    console.log('Scenarios (each is one `claude -p` turn):\n');
    for (const s of SCENARIOS) {
      console.log(`  ${s.key}`);
      console.log(`    provokes: ${s.provokes.join(', ')}`);
      console.log(`    why:      ${s.why}\n`);
    }
    console.log('Run with --yes. Each scenario is a real model turn and costs tokens.');
    return;
  }

  if (!argv.includes('--yes')) {
    fail(
      'This spends tokens on real model turns. Re-run with --yes to confirm,\n' +
        'or --list to see what each scenario provokes.'
    );
  }

  const onlyFlag = argv.indexOf('--only');
  const only = onlyFlag >= 0 ? new Set(argv[onlyFlag + 1].split(',')) : null;
  const chosen = only ? SCENARIOS.filter(s => only.has(s.key)) : SCENARIOS;
  if (chosen.length === 0) fail(`No scenario matched --only ${argv[onlyFlag + 1]}`);

  const keep = argv.includes('--keep');
  const sandbox = mkdtempSync(join(tmpdir(), 'cl-exercise-'));
  console.log(`Sandbox: ${sandbox}\n`);

  const results = [];
  for (const scenario of chosen) {
    process.stdout.write(`  ${scenario.key} … `);
    const result = runScenario(scenario, sandbox);
    results.push(result);
    console.log(
      result.error
        ? `failed to start (${result.error})`
        : `${result.status === 0 ? 'ok' : `exit ${result.status}`} in ${result.seconds}s` +
            (result.wrote ? '' : ' — NO TRANSCRIPT WRITTEN')
    );
  }

  console.log('\nTranscripts written to:');
  for (const r of results.filter(r => r.wrote)) console.log(`  ${r.key}: ${r.projectDir}`);

  const silent = results.filter(r => !r.wrote && !r.error);
  if (silent.length) {
    console.log('\nScenarios that wrote nothing — the prompt may no longer exercise the feature:');
    for (const r of silent) {
      console.log(`  ${r.key} (wanted ${r.provokes.join(', ')})`);
      if (r.stderr) console.log(`    stderr: ${r.stderr}`);
    }
  }

  if (argv.includes('--census')) {
    // Census the sandbox's project dirs only, so what comes back is what this
    // run produced. Their names all derive from the sandbox path.
    console.log('\n── census of this run ──');
    for (const r of results.filter(r => r.wrote)) {
      console.log(`\n[${r.key}]`);
      const census = spawnSync(
        process.execPath,
        [resolve(__dirname, 'transcript-census.mjs'), '--root', r.projectDir],
        { encoding: 'utf8' }
      );
      console.log((census.stdout ?? '').trim() || census.stderr);
    }
  }

  if (keep) {
    console.log(`\nSandbox kept at ${sandbox}`);
  } else {
    rmSync(sandbox, { recursive: true, force: true });
    console.log(`\nSandbox removed. The transcripts under ~/.claude/projects/ remain.`);
  }

  if (argv.includes('--clean')) {
    for (const r of results.filter(r => r.wrote)) {
      rmSync(r.projectDir, { recursive: true, force: true });
    }
    console.log('Generated project dirs removed (--clean).');
  } else {
    console.log(
      '\nThe generated project dirs are throwaway. The census skips them by name, so\n' +
        'leaving them costs nothing; `--clean` removes them once triaged.'
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

export { SCENARIOS, projectDirFor };
