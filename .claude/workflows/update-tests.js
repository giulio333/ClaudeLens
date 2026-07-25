export const meta = {
  name: 'update-tests',
  description: 'Create or update the test suite of a repository: map the codebase, find coverage gaps, write/refresh tests per module, then verify',
  whenToUse: 'When the user asks to create missing tests or bring an existing test suite up to date with the current code',
  phases: [
    { title: 'Map', detail: 'understand the repo, test framework and existing tests', model: 'sonnet' },
    { title: 'Plan', detail: 'decide which modules need new or updated tests', model: 'sonnet' },
    { title: 'Write', detail: 'one agent per module writes/updates its tests', model: 'sonnet' },
    { title: 'Verify', detail: 'run the whole test suite and fix regressions' },
  ],
}

// args (tutti opzionali): { target: string, maxModules: number, focus: string }
//   target     — sottocartella su cui limitare il lavoro (default: intero repo)
//   maxModules — tetto ai moduli lavorati in un run (default 8)
//   focus      — istruzione libera, es. "solo unit test, niente e2e"
const target = (args && args.target) || '.'
const maxModules = (args && args.maxModules) || 8
const focus = (args && args.focus) || ''

// ── Fase 1: mappa del repo ────────────────────────────────────────────────
phase('Map')
log(`Mapping test setup under ${target}`)

const repoMap = await agent(
  `Analizza il repository (scope: "${target}") e restituisci SOLO dati strutturati:
- framework di test in uso (vitest/jest/pytest/…), file di config e comando esatto per lanciare i test
- convenzioni: dove vivono i test, naming, stile (mock vs integrazione)
- elenco dei moduli/file sorgente "puri" o comunque testabili, ciascuno con i test esistenti che lo coprono (se esistono)
Non modificare nulla. Leggi CLAUDE.md se presente per le convenzioni.`,
  {
    label: 'map:repo',
    phase: 'Map',
    model: 'sonnet',
    effort: 'medium',
    schema: {
      type: 'object',
      required: ['testCommand', 'framework', 'conventions', 'modules'],
      properties: {
        framework: { type: 'string' },
        testCommand: { type: 'string' },
        conventions: { type: 'string' },
        modules: {
          type: 'array',
          items: {
            type: 'object',
            required: ['sourcePath'],
            properties: {
              sourcePath: { type: 'string' },
              existingTests: { type: 'array', items: { type: 'string' } },
              notes: { type: 'string' },
            },
          },
        },
      },
    },
  }
)

if (!repoMap || !repoMap.modules.length) {
  return { error: 'Nessun modulo testabile trovato: controlla lo scope passato in args.target' }
}

// ── Fase 2: piano ─────────────────────────────────────────────────────────
phase('Plan')

const plan = await agent(
  `Ecco la mappa del repo: ${JSON.stringify(repoMap)}.
${focus ? `Vincolo dell'utente: ${focus}.` : ''}
Scegli AL MASSIMO ${maxModules} moduli su cui intervenire, ordinati per impatto. Per ciascuno indica:
- action: "create" (nessun test) oppure "update" (test esistenti ma incompleti/obsoleti rispetto al sorgente attuale)
- perché, e quali comportamenti/edge case vanno coperti
Verifica leggendo il codice, non fidarti solo della mappa. Non modificare nulla.`,
  {
    label: 'plan:coverage-gaps',
    phase: 'Plan',
    model: 'sonnet',
    effort: 'medium',
    schema: {
      type: 'object',
      required: ['items'],
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            required: ['sourcePath', 'action', 'targets'],
            properties: {
              sourcePath: { type: 'string' },
              testPath: { type: 'string' },
              action: { type: 'string', enum: ['create', 'update'] },
              targets: { type: 'string', description: 'comportamenti/edge case da coprire' },
            },
          },
        },
      },
    },
  }
)

const items = (plan && plan.items ? plan.items : []).slice(0, maxModules)
if (!items.length) return { repoMap, result: 'La suite è già allineata: nessun modulo da lavorare.' }
log(`${items.length} moduli da lavorare (cap: ${maxModules})`)

// ── Fase 3: scrittura test (pipeline: scrivi → smoke-check per modulo) ────
phase('Write')

const written = await pipeline(
  items,
  (item) =>
    agent(
      `Nel repository corrente, ${item.action === 'create' ? 'crea' : 'aggiorna'} i test per ${item.sourcePath}.
${item.testPath ? `File di test atteso: ${item.testPath}.` : ''}
Copri: ${item.targets}
Convenzioni del repo: ${repoMap.conventions}. Framework: ${repoMap.framework}.
${focus ? `Vincolo dell'utente: ${focus}.` : ''}
Regole: segui lo stile dei test esistenti; niente mock dove un test di integrazione è praticabile; NON modificare il codice sorgente sotto test — se scopri un bug reale, segnalalo in "suspectedBugs" invece di aggirarlo nel test.
Prima di chiudere esegui SOLO i test di questo modulo con il runner del repo (comando base: ${repoMap.testCommand}) e sistemali finché passano.`,
      {
        label: `write:${item.sourcePath}`,
        phase: 'Write',
        model: 'sonnet',
        effort: 'medium',
        schema: {
          type: 'object',
          required: ['testFiles', 'passing', 'summary'],
          properties: {
            testFiles: { type: 'array', items: { type: 'string' } },
            passing: { type: 'boolean' },
            summary: { type: 'string' },
            suspectedBugs: { type: 'array', items: { type: 'string' } },
          },
        },
      }
    ),
  (result, item) => (result ? { ...result, sourcePath: item.sourcePath, action: item.action } : null)
)

const done = written.filter(Boolean)

// ── Fase 4: verifica dell'intera suite ────────────────────────────────────
phase('Verify')

const verdict = await agent(
  `Esegui l'intera suite di test del repository con: ${repoMap.testCommand}
Se ci sono fallimenti introdotti dai test appena scritti/aggiornati (${JSON.stringify(done.map((d) => d.testFiles).flat())}), correggi i TEST (mai il sorgente) finché la suite è verde o i fallimenti residui sono pre-esistenti. Riporta l'esito reale, senza abbellirlo.`,
  {
    label: 'verify:full-suite',
    phase: 'Verify',
    effort: 'medium',
    schema: {
      type: 'object',
      required: ['suiteGreen', 'report'],
      properties: {
        suiteGreen: { type: 'boolean' },
        report: { type: 'string' },
        preexistingFailures: { type: 'array', items: { type: 'string' } },
      },
    },
  }
)

return {
  framework: repoMap.framework,
  testCommand: repoMap.testCommand,
  modulesWorked: done.map((d) => ({
    sourcePath: d.sourcePath,
    action: d.action,
    testFiles: d.testFiles,
    passing: d.passing,
  })),
  suspectedBugs: done.flatMap((d) => d.suspectedBugs || []),
  verify: verdict,
}
