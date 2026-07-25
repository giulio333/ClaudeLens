export const meta = {
  name: 'fix-issue',
  description: 'Pick an open GitHub issue, implement the fix on a branch and open a PR that closes it',
  whenToUse: 'When the user wants an open GitHub issue picked up and carried through to a pull request',
  phases: [
    { title: 'Pick', detail: 'list open issues and choose one' },
    { title: 'Fix', detail: 'implement on a branch, then typecheck + lint + test' },
    { title: 'Ship', detail: 'commit, push and open the PR closing the issue' },
  ],
}

// args (opzionale): { issue: number } per forzare un'issue specifica.
// L'input va normalizzato: se arriva come stringa JSON (`'{"issue":154}'`)
// il vecchio `args && args.issue` dava undefined e l'issue forzata veniva
// ignorata in silenzio, con la fase Pick che ne scegliva un'altra.
function forcedIssueFrom(raw) {
  if (raw === null || raw === undefined) return null
  let v = raw
  if (typeof v === 'string') {
    const trimmed = v.trim()
    try {
      v = JSON.parse(trimmed)
    } catch (_e) {
      v = trimmed.replace(/^#/, '')
    }
  }
  const n = Number(v && typeof v === 'object' ? v.issue : v)
  return Number.isInteger(n) && n > 0 ? n : null
}

const forcedIssue = forcedIssueFrom(args)

// Un args presente ma illeggibile è un errore, non un via libera a scegliere.
if (args !== null && args !== undefined && forcedIssue === null) {
  return {
    error: `args presente ma non interpretabile come issue: ${JSON.stringify(args)}. Attesi { issue: 154 }, "154" o 154.`,
  }
}

// ── Fase 1: scegli l'issue ────────────────────────────────────────────────
phase('Pick')

if (forcedIssue) log(`Issue forzata da args: #${forcedIssue}`)

const picked = await agent(
  `Nel repository corrente usa \`gh issue list --state open --limit 30\` e \`gh issue view <n> --comments\`.
${forcedIssue ? `Lavora sull'issue #${forcedIssue}: leggila e riassumila.` : `Scegli UNA issue da risolvere: impatto alto, scope contenuto, risolvibile in una sola PR. Scarta epic e tracking issue.`}
Sola lettura: non modificare nulla.`,
  {
    label: 'pick-issue',
    schema: {
      type: 'object',
      required: ['number', 'title', 'summary'],
      properties: {
        number: { type: 'number' },
        title: { type: 'string' },
        summary: { type: 'string', description: 'cosa chiede e quando si può considerare risolta' },
      },
    },
  }
)

if (!picked || !picked.number) {
  return { error: 'Fase Pick non conclusa (agente interrotto o nessuna issue adatta): rilancia, oppure forza con args.issue.' }
}
// Un'issue forzata è un'istruzione, non un suggerimento: fermarsi subito se
// la fase Pick ne ha scelta un'altra, prima che la fase Fix scriva codice.
if (forcedIssue && picked.number !== forcedIssue) {
  return {
    error: `Fase Pick fuori rotta: chiesta #${forcedIssue}, scelta #${picked.number} (${picked.title}). Niente modificato, nessuna PR aperta.`,
  }
}

log(`Issue scelta: #${picked.number} — ${picked.title}`)

// ── Fase 2: implementa e verifica ─────────────────────────────────────────
phase('Fix')

const branch = `fix/issue-${picked.number}`

const fix = await agent(
  `Risolvi l'issue #${picked.number} — ${picked.title}
${picked.summary}

Crea il branch \`${branch}\` da \`main\` aggiornato e implementa la fix minima, seguendo le convenzioni di CLAUDE.md. Aggiungi/aggiorna i test dove ha senso.
Poi verifica con \`npm run typecheck\`, \`npm run lint\`, \`npm test\` e sistema i fallimenti che hai introdotto.
Non committare, non lanciare l'app. Riporta l'esito reale, senza abbellirlo.`,
  {
    label: `fix:issue-${picked.number}`,
    effort: 'high',
    schema: {
      type: 'object',
      required: ['green', 'changedFiles', 'summary'],
      properties: {
        green: { type: 'boolean', description: 'true solo se typecheck, lint e test sono verdi' },
        changedFiles: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
      },
    },
  }
)

if (!fix || !fix.green || !fix.changedFiles.length) {
  return { issue: picked, branch, fix, result: 'Verifica non verde: modifiche lasciate sul branch, nessuna PR aperta.' }
}

// ── Fase 3: commit, push, PR ──────────────────────────────────────────────
phase('Ship')

const shipped = await agent(
  `Sul branch \`${branch}\`: committa (messaggio in inglese, conventional commits, senza co-autore Claude), \`git push -u origin ${branch}\`, poi apri la PR con \`gh pr create\` — titolo e corpo in inglese, con la riga \`Closes #${picked.number}\` così che l'issue si chiuda al merge.
Contesto: ${fix.summary}
Non fare merge: la review resta all'utente.`,
  {
    label: `ship:issue-${picked.number}`,
    agentType: 'git-committer',
    schema: {
      type: 'object',
      required: ['prUrl'],
      properties: { prUrl: { type: 'string' } },
    },
  }
)

return { issue: { number: picked.number, title: picked.title }, branch, changedFiles: fix.changedFiles, pr: shipped }
