import { IpcMain } from 'electron';

type IpcResult<T> = { data: T | null; error: string | null };
const ok = <T>(data: T): IpcResult<T> => ({ data, error: null });

// Istante di riferimento fissato al caricamento del modulo: tutte le date demo
// derivano da qui, così i filename di sessione sono deterministici e stabili tra
// chiamate IPC diverse (necessario per agganciare tasks/plans alle sessioni reali).
const NOW = new Date();

// Helper per date relative a NOW, così chat/memory/agent non "invecchiano":
// restano sempre coerenti con le sessioni (anch'esse ancorate a NOW).
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const daysAgo = (d: number) => minsAgo(d * 24 * 60);

// ─── Progetti finti ───────────────────────────────────────────────────────────

const MOCK_PROJECTS = [
  { hash: '-Users-alice-projects-webapp', realPath: '/Users/alice/projects/webapp' },
  { hash: '-Users-alice-projects-api-server', realPath: '/Users/alice/projects/api-server' },
  { hash: '-Users-alice-work-data-pipeline', realPath: '/Users/alice/work/data-pipeline' },
  { hash: '-Users-alice-experiments-llm-playground', realPath: '/Users/alice/experiments/llm-playground' },
  { hash: '-Users-alice-side-blog', realPath: '/Users/alice/side/blog' },
];

// ─── Numero di sessioni per progetto ──────────────────────────────────────────
// Unica fonte del conteggio: la lista sessioni e il sommario costi derivano
// entrambi da qui, così Global → Projects e il tab Sessions sono coerenti.

const SESSION_COUNTS: Record<string, number> = {
  '-Users-alice-projects-webapp': 42,
  '-Users-alice-projects-api-server': 18,
  '-Users-alice-work-data-pipeline': 9,
  '-Users-alice-experiments-llm-playground': 31,
  '-Users-alice-side-blog': 3,
};

const sessionCountFor = (hash: string) => SESSION_COUNTS[hash] ?? SESSION_COUNTS['-Users-alice-projects-webapp'];

// ─── Sessioni per progetto ────────────────────────────────────────────────────

const SESSION_TEMPLATES = [
  { days: 0,  input: 48_000,  output: 21_000, cache: 95_000,  msgs: 34, model: 'claude-sonnet-4-6', title: 'Refactor authentication module' },
  { days: 1,  input: 31_000,  output: 14_500, cache: 62_000,  msgs: 22, model: 'claude-sonnet-4-6', title: 'Fix TypeScript strict mode errors' },
  { days: 3,  input: 72_000,  output: 28_000, cache: 140_000, msgs: 51, model: 'claude-opus-4-8',   title: 'Design new API architecture' },
  { days: 5,  input: 19_000,  output: 8_200,  cache: 38_000,  msgs: 15, model: 'claude-haiku-4-5',  title: 'Write unit tests for utils' },
  { days: 8,  input: 55_000,  output: 24_000, cache: 110_000, msgs: 40, model: 'claude-sonnet-4-6', title: 'Add dark mode support' },
  { days: 12, input: 38_000,  output: 16_000, cache: 76_000,  msgs: 28, model: 'claude-sonnet-4-6', title: 'Optimize database queries' },
  { days: 18, input: 26_000,  output: 11_000, cache: 50_000,  msgs: 19, model: 'claude-haiku-4-5',  title: 'Update dependencies' },
  { days: 25, input: 61_000,  output: 27_000, cache: 122_000, msgs: 44, model: 'claude-opus-4-8',   title: 'Implement real-time sync' },
];

function getSessionList(hash: string) {
  // Ancorato a NOW (non a una data fissa) così le sessioni restano dentro
  // la finestra di retention dell'Overview/Analytics e i conteggi non vanno a 0.
  const now = NOW;
  // Genera tante sessioni quante ne dichiara SESSION_COUNTS,
  // così Global → Projects e il tab Sessions mostrano lo stesso numero.
  // I primi 8 sono i template "belli" con titoli unici (in cima alla lista);
  // gli eventuali extra ciclano i template, una sessione al giorno andando indietro.
  const count = sessionCountFor(hash);
  const pad = (n: number) => String(n).padStart(2, '0');
  return Array.from({ length: count }, (_, i) => {
    const t = SESSION_TEMPLATES[i % SESSION_TEMPLATES.length];
    // i < 8 → usa l'offset originale del template; oltre → un giorno in più ciascuno
    const dayOffset = i < SESSION_TEMPLATES.length ? t.days : i;
    const d = new Date(now.getTime() - dayOffset * 86_400_000);
    const filename = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}_${String(i).padStart(6,'0')}.jsonl`;
    return {
      filename,
      date: d.toISOString(),
      inputTokens: t.input,
      outputTokens: t.output,
      cacheWriteTokens: Math.floor(t.input * 0.12),
      cacheReadTokens: t.cache,
      totalTokens: t.input + t.output,
      estimatedCost: parseFloat(((t.input / 1_000_000) * 3.0 + (t.output / 1_000_000) * 15.0).toFixed(4)),
      cacheSavings: parseFloat(((t.cache / 1_000_000) * (3.0 - 0.3)).toFixed(4)),
      messageCount: t.msgs,
      model: t.model,
      models: { [t.model]: t.msgs },
      customTitle: i < SESSION_TEMPLATES.length ? t.title : `${t.title} (${Math.floor(i / SESSION_TEMPLATES.length) + 1})`,
    };
  });
}

// ─── Sommario costi per progetto ──────────────────────────────────────────────
// Derivato dalla lista sessioni, così i totali (token/costo) coincidono esattamente
// con la somma delle sessioni mostrate nel tab Sessions.

function getCost(hash: string) {
  const sessions = getSessionList(hash);
  const inputTokens = sessions.reduce((s, x) => s + x.inputTokens, 0);
  const outputTokens = sessions.reduce((s, x) => s + x.outputTokens, 0);
  const cacheReadTokens = sessions.reduce((s, x) => s + x.cacheReadTokens, 0);
  const cost = parseFloat(sessions.reduce((s, x) => s + x.estimatedCost, 0).toFixed(2));
  return {
    project: hash,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    totalTokens: inputTokens + outputTokens,
    cost,
    sessionsCount: sessions.length,
  };
}

// ─── Chat finta ───────────────────────────────────────────────────────────────

const MOCK_CHAT = [
  {
    uuid: 'msg-001',
    role: 'user' as const,
    timestamp: minsAgo(125),
    content: [{ type: 'text' as const, text: 'Can you refactor the authentication module to use JWT tokens instead of sessions?' }],
  },
  {
    uuid: 'msg-002',
    role: 'assistant' as const,
    timestamp: minsAgo(124),
    model: 'claude-sonnet-4-6',
    content: [
      { type: 'text' as const, text: "I'll start by reading the current authentication implementation to understand what needs to change." },
      { type: 'tool_use' as const, id: 'tu-001', name: 'Read', input: { file_path: '/Users/alice/projects/webapp/src/auth/session.ts' } },
    ],
  },
  {
    uuid: 'msg-003',
    role: 'user' as const,
    timestamp: minsAgo(124),
    content: [{ type: 'tool_result' as const, toolUseId: 'tu-001', content: 'import session from "express-session";\n\nexport function configureSession(app) {\n  app.use(session({ secret: process.env.SESSION_SECRET, resave: false }));\n}\n', isError: false }],
  },
  {
    uuid: 'msg-004',
    role: 'assistant' as const,
    timestamp: minsAgo(123),
    model: 'claude-sonnet-4-6',
    content: [
      { type: 'text' as const, text: "Now let me check the route handlers to understand how sessions are used." },
      { type: 'tool_use' as const, id: 'tu-002', name: 'Grep', input: { pattern: 'req\\.session', path: '/Users/alice/projects/webapp/src' } },
    ],
  },
  {
    uuid: 'msg-005',
    role: 'user' as const,
    timestamp: minsAgo(123),
    content: [{ type: 'tool_result' as const, toolUseId: 'tu-002', content: 'src/routes/auth.ts:24:  req.session.userId = user.id;\nsrc/routes/auth.ts:51:  delete req.session.userId;\nsrc/middleware/protect.ts:8:  if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });\n', isError: false }],
  },
  {
    uuid: 'msg-006',
    role: 'assistant' as const,
    timestamp: minsAgo(122),
    model: 'claude-sonnet-4-6',
    content: [
      {
        type: 'text' as const,
        text: "I have a clear picture now. Here's my plan:\n\n1. Install `jsonwebtoken` and `@types/jsonwebtoken`\n2. Create a new `src/auth/jwt.ts` module with `signToken` and `verifyToken` helpers\n3. Update login route to issue a JWT and return it in the response\n4. Replace the session middleware with a JWT verification middleware\n5. Remove `express-session`\n\nShall I proceed?",
      },
    ],
  },
  {
    uuid: 'msg-007',
    role: 'user' as const,
    timestamp: minsAgo(121),
    content: [{ type: 'text' as const, text: 'Yes, go ahead.' }],
  },
  {
    uuid: 'msg-008',
    role: 'assistant' as const,
    timestamp: minsAgo(120),
    model: 'claude-sonnet-4-6',
    content: [
      { type: 'text' as const, text: "Creating the JWT helper module." },
      {
        type: 'tool_use' as const,
        id: 'tu-003',
        name: 'Write',
        input: {
          file_path: '/Users/alice/projects/webapp/src/auth/jwt.ts',
          content: "import jwt from 'jsonwebtoken';\n\nconst SECRET = process.env.JWT_SECRET!;\n\nexport const signToken = (userId: string) =>\n  jwt.sign({ userId }, SECRET, { expiresIn: '7d' });\n\nexport const verifyToken = (token: string) =>\n  jwt.verify(token, SECRET) as { userId: string };\n",
        },
      },
    ],
  },
];

// ─── Memory per progetto ─────────────────────────────────────────────────────

function getMemoryData(_hash: string) {
  return {
    index: [
      { name: 'User profile', description: 'Senior full-stack engineer, 8yr TypeScript experience', type: 'user', filename: 'user_profile.md', createdAt: daysAgo(90), updatedAt: daysAgo(4) },
      { name: 'Code style feedback', description: 'Prefers functional patterns, no class components, terse PR descriptions', type: 'feedback', filename: 'feedback_code_style.md', createdAt: daysAgo(72), updatedAt: daysAgo(6) },
      { name: 'Testing approach', description: 'Integration tests over unit mocks — past incident with divergent mock/prod', type: 'feedback', filename: 'feedback_testing.md', createdAt: daysAgo(63), updatedAt: daysAgo(11) },
    ],
    topics: {
      'user_profile.md': '---\nname: User profile\ndescription: Senior full-stack engineer\ntype: user\n---\n\nSenior full-stack engineer with 8 years of TypeScript experience. Works primarily on React + Node.js stacks. Prefers functional patterns and concise code.',
      'feedback_code_style.md': '---\nname: Code style feedback\ndescription: Coding preferences\ntype: feedback\n---\n\nPrefers functional patterns over OOP. No class components in React. PR descriptions should be short and direct.',
      'feedback_testing.md': '---\nname: Testing approach\ndescription: Integration tests preferred\ntype: feedback\n---\n\nUse integration tests that hit real services, not mocks.\n\n**Why:** A previous incident where mock/prod divergence masked a broken migration.\n\n**How to apply:** Never mock the database layer in tests.',
    },
    memoryMd: {
      content: '# Memory Index\n\n- [user_profile.md](user_profile.md) — Senior full-stack engineer\n- [feedback_code_style.md](feedback_code_style.md) — Coding preferences\n- [feedback_testing.md](feedback_testing.md) — Integration tests preferred\n',
      lineCount: 6,
    },
    projectLevelIndex: [
      { name: 'Project goals', description: 'Q1 targets: launch beta, gather 50 signups', type: 'project', filename: 'project_goals.md', createdAt: daysAgo(95), updatedAt: daysAgo(20) },
    ],
    projectLevelTopics: {
      'project_goals.md': '---\nname: Project goals\ndescription: Q1 targets\ntype: project\n---\n\nLaunch public beta by end of Q1. Target 50 early signups.',
    },
    projectLevelMemoryMd: {
      content: '# Project Memory\n\n- [project_goals.md](project_goals.md) — Q1 targets\n',
      lineCount: 4,
    },
  };
}

// ─── CLAUDE.md ────────────────────────────────────────────────────────────────

const GLOBAL_CLAUDE_MD = `# Global Claude Configuration

## Behavior
- Prefer concise explanations over verbose ones
- Always validate with real data
- Never commit sensitive files

## Code Style
- Functions under 50 lines
- Meaningful variable names
- Comments only for non-obvious logic

## Testing
Use integration tests when possible, not mocks.
`;

const HIERARCHY_LAYERS = [
  {
    scope: 'global' as const,
    filePath: '/Users/alice/.claude/CLAUDE.md',
    content: GLOBAL_CLAUDE_MD,
  },
  {
    scope: 'project' as const,
    filePath: '/Users/alice/projects/webapp/CLAUDE.md',
    content: `# Webapp

## Stack
React 18 + TypeScript + Express + PostgreSQL.

## Commands
\`\`\`bash
npm run dev      # Start dev server
npm test         # Run integration tests
npm run build    # Production build
\`\`\`
`,
  },
];

// ─── Skills ───────────────────────────────────────────────────────────────────

const GLOBAL_SKILLS = [
  {
    name: 'commit',
    path: '/Users/alice/.claude/commands/commit.md',
    scope: 'global' as const,
    content: 'Create a conventional commit message and stage changes.',
    rawContent: '---\ndescription: Create a conventional commit\n---\n\nCreate a conventional commit message and stage changes.',
    description: 'Create a conventional commit',
    userInvocable: true,
  },
  {
    name: 'review-pr',
    path: '/Users/alice/.claude/commands/review-pr.md',
    scope: 'global' as const,
    content: 'Review a GitHub pull request and summarize key changes.',
    rawContent: '---\ndescription: Review a pull request\nargumentHint: PR number\n---\n\nReview a GitHub pull request.',
    description: 'Review a pull request',
    argumentHint: 'PR number',
    userInvocable: true,
  },
  {
    name: 'frontend-design',
    path: '/Users/alice/.claude/commands/frontend-design.md',
    scope: 'global' as const,
    content: 'Generate polished frontend UI components.',
    rawContent: '---\ndescription: Generate polished frontend UI\n---\n\nCreate distinctive, production-grade frontend interfaces.',
    description: 'Generate polished frontend UI',
    userInvocable: true,
  },
  {
    name: 'claude-api',
    path: '/Users/alice/.claude/commands/claude-api.md',
    scope: 'global' as const,
    content: 'Build integrations with the Claude API.',
    rawContent: '---\ndescription: Build Claude API integrations\n---\n\nBuild apps with the Claude API or Anthropic SDK.',
    description: 'Build Claude API integrations',
    userInvocable: true,
  },
];

const PROJECT_SKILL = {
  name: 'deploy',
  path: '/Users/alice/projects/webapp/.claude/commands/deploy.md',
  scope: 'project' as const,
  content: 'Run the production deployment pipeline.',
  rawContent: '---\ndescription: Deploy to production\n---\n\nRun the production deployment pipeline.',
  description: 'Deploy to production',
  userInvocable: true,
};

// ─── Agents ───────────────────────────────────────────────────────────────────

const GLOBAL_AGENTS = [
  {
    name: 'code-reviewer',
    path: '/Users/alice/.claude/agents/code-reviewer.md',
    scope: 'global' as const,
    content: 'Reviews code for quality, security, and best practices.',
    rawContent: '---\ndescription: Review code quality\nmodel: claude-opus-4-8\n---\n\nReview code for quality and security.',
    description: 'Review code quality',
    model: 'claude-opus-4-8',
    missingRequired: [],
    filenameHasSpaces: false,
  },
  {
    name: 'docs-writer',
    path: '/Users/alice/.claude/agents/docs-writer.md',
    scope: 'global' as const,
    content: 'Generates clear, concise technical documentation.',
    rawContent: '---\ndescription: Write technical docs\n---\n\nGenerate clear technical documentation.',
    description: 'Write technical docs',
    missingRequired: [],
    filenameHasSpaces: false,
  },
];

const PROJECT_AGENT = {
  name: 'db-migrator',
  path: '/Users/alice/projects/webapp/.claude/agents/db-migrator.md',
  scope: 'project' as const,
  content: 'Generates and validates database migration scripts.',
  rawContent: '---\ndescription: Generate DB migrations\nmodel: claude-sonnet-4-6\n---\n\nGenerate and validate database migration scripts.',
  description: 'Generate DB migrations',
  model: 'claude-sonnet-4-6',
  missingRequired: [],
  filenameHasSpaces: false,
};

// ─── MCP ─────────────────────────────────────────────────────────────────────

const MOCK_MCP = {
  cloudServers: [
    {
      name: 'github',
      source: 'cloud' as const,
      enabledInProjects: 3,
      disabledInProjects: 2,
      enabledProjectPaths: [
        '/Users/alice/projects/webapp',
        '/Users/alice/projects/api-server',
        '/Users/alice/experiments/llm-playground',
      ],
      disabledProjectPaths: ['/Users/alice/work/data-pipeline', '/Users/alice/side/blog'],
    },
    {
      name: 'linear',
      source: 'cloud' as const,
      enabledInProjects: 2,
      disabledInProjects: 3,
      enabledProjectPaths: [
        '/Users/alice/projects/webapp',
        '/Users/alice/experiments/llm-playground',
      ],
      disabledProjectPaths: [
        '/Users/alice/projects/api-server',
        '/Users/alice/work/data-pipeline',
        '/Users/alice/side/blog',
      ],
    },
  ],
  localServers: [
    {
      name: 'filesystem',
      source: 'local' as const,
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/alice'],
      enabledInProjects: 4,
      disabledInProjects: 1,
      enabledProjectPaths: [
        '/Users/alice/projects/webapp',
        '/Users/alice/projects/api-server',
        '/Users/alice/work/data-pipeline',
        '/Users/alice/experiments/llm-playground',
      ],
      disabledProjectPaths: ['/Users/alice/side/blog'],
    },
  ],
  totalProjects: 5,
};

// ─── Sessioni live ────────────────────────────────────────────────────────────

const MOCK_ACTIVE_SESSIONS = [
  {
    pid: 18423,
    sessionId: 'a3f8c2e1-4b6d-4e2a-9c1f-7d5e8b3a2c10',
    cwd: '/Users/alice/projects/webapp',
    startedAt: Date.now() - 25 * 60_000,
    status: 'busy',
    version: '2.1.191',
    source: 'registry' as const,
  },
  {
    pid: 19871,
    sessionId: 'b7d1e9f4-2a8c-4f6b-8e3d-1c9a5f7e4b22',
    cwd: '/Users/alice/experiments/llm-playground',
    startedAt: Date.now() - 4 * 60_000,
    status: 'waiting',
    waitingFor: 'permission prompt',
    version: '2.1.191',
    source: 'registry' as const,
  },
];

// ─── Rules ────────────────────────────────────────────────────────────────────

const MOCK_RULES = [
  {
    filename: 'no-console.md',
    content: '---\npaths:\n  - "src/**/*.ts"\n  - "src/**/*.tsx"\n---\n\nDo not use `console.log` in production code. Use the structured logger instead.',
    paths: ['src/**/*.ts', 'src/**/*.tsx'],
  },
  {
    filename: 'test-conventions.md',
    content: '---\npaths:\n  - "**/*.test.ts"\n---\n\nAll tests must use integration style with real dependencies. No mocks for database calls.',
    paths: ['**/*.test.ts'],
  },
];

// ─── Tasks per progetto ───────────────────────────────────────────────────────

const MOCK_TASKS = [
  {
    sessionId: '20260329T091500',
    filename: '20260329T091500_000000.jsonl',
    tasks: [
      {
        id: 'task-1',
        subject: 'Add jsonwebtoken dependency',
        description: 'Install jsonwebtoken and @types/jsonwebtoken, then add JWT_SECRET to the env schema.',
        status: 'completed' as const,
        blocks: ['task-2'],
        blockedBy: [],
      },
      {
        id: 'task-2',
        subject: 'Create JWT helper module',
        description: 'Implement signToken / verifyToken in src/auth/jwt.ts and cover them with integration tests.',
        status: 'in_progress' as const,
        blocks: ['task-3'],
        blockedBy: ['task-1'],
        activeForm: 'Creating the JWT helper module',
      },
      {
        id: 'task-3',
        subject: 'Replace session middleware',
        description: 'Swap express-session for the JWT verification middleware across all protected routes.',
        status: 'pending' as const,
        blocks: [],
        blockedBy: ['task-2'],
      },
      {
        id: 'task-4',
        subject: 'Remove express-session',
        description: 'Drop the express-session dependency and its configuration once routes are migrated.',
        status: 'pending' as const,
        blocks: [],
        blockedBy: ['task-3'],
      },
    ],
  },
  {
    sessionId: '20260326T140000',
    filename: '20260326T140000_000002.jsonl',
    tasks: [
      {
        id: 'task-a',
        subject: 'Audit slow database queries',
        description: 'Profile the dashboard endpoints and identify queries missing indexes.',
        status: 'completed' as const,
        blocks: [],
        blockedBy: [],
      },
      {
        id: 'task-b',
        subject: 'Add composite index on (user_id, created_at)',
        description: 'Create the migration and verify the query planner picks it up.',
        status: 'completed' as const,
        blocks: [],
        blockedBy: [],
      },
    ],
  },
];

// ─── Plans per progetto ───────────────────────────────────────────────────────

const PLAN_AUTH = `# Migrate authentication to JWT

## Goal
Replace server-side sessions with stateless JWT tokens.

## Steps
1. Install \`jsonwebtoken\` and \`@types/jsonwebtoken\`
2. Add \`src/auth/jwt.ts\` with \`signToken\` / \`verifyToken\`
3. Issue a JWT on login and return it in the response body
4. Replace the \`express-session\` middleware with JWT verification
5. Remove \`express-session\` and its configuration

## Risks
- Existing logged-in users will be signed out on deploy
- Token revocation needs a short expiry + refresh strategy
`;

const PLAN_DARKMODE = `# Add dark mode support

## Goal
Ship a system-aware dark theme toggled from the settings menu.

## Steps
1. Define semantic color tokens in \`theme.css\`
2. Add a \`data-theme\` attribute driven by \`prefers-color-scheme\`
3. Persist the user's explicit choice in localStorage
4. Audit components for hardcoded colors

## Open questions
- Do we animate the transition or swap instantly?
`;

const MOCK_PLANS = [
  {
    sessionId: '20260329T091500',
    filename: '20260329T091500_000000.jsonl',
    plans: [
      {
        filePath: '/Users/alice/.claude/plans/migrate-auth-to-jwt.md',
        slug: 'migrate-auth-to-jwt',
        title: 'Migrate authentication to JWT',
        status: 'approved' as const,
        exists: true,
        content: PLAN_AUTH,
        timestamp: minsAgo(122),
        gitBranch: 'feat/jwt-auth',
      },
    ],
  },
  {
    sessionId: '20260321T100000',
    filename: '20260321T100000_000004.jsonl',
    plans: [
      {
        filePath: '/Users/alice/.claude/plans/add-dark-mode-support.md',
        slug: 'add-dark-mode-support',
        title: 'Add dark mode support',
        status: 'proposed' as const,
        exists: true,
        content: PLAN_DARKMODE,
        timestamp: daysAgo(8),
        gitBranch: 'feat/dark-mode',
      },
    ],
  },
];

// ─── Sessioni agent live / background ──────────────────────────────────────────
// Timestamp ancorati a NOW (minuti fa, via l'helper in cima) così la Agent View
// mostra tempi relativi realistici ("just now", "5m ago") invece di date statiche.
const MOCK_BG_SESSIONS = [
  // ── Progetto webapp: spettro completo di stati per popolare ogni bucket della
  // Agent View (Needs input · Working · Ready · Completed · Failed · Stopped) ──
  {
    id: 'a1b2c3',
    sessionId: '20260329T101500_000123',
    name: 'Refactor auth to JWT',
    state: 'running',
    tempo: 'busy',
    detail: 'Editing src/middleware/protect.ts',
    intent: 'Replace the session middleware with JWT verification across all protected routes.',
    result: null,
    cwd: '/Users/alice/projects/webapp',
    projectName: 'webapp',
    template: 'bg',
    inFlightTasks: 2,
    alive: true,
    pid: 24817,
    createdAt: minsAgo(18),
    updatedAt: minsAgo(0),
    needs: null,
    hasPendingQuestion: false,
  },
  {
    id: 'b2c3d4',
    sessionId: '20260531T094000_000201',
    name: 'Add Stripe checkout flow',
    state: 'running',
    tempo: 'blocked',
    detail: 'Paused — needs a decision before continuing',
    intent: 'Wire up Stripe Checkout for the Pro plan and handle the success webhook.',
    result: null,
    cwd: '/Users/alice/projects/webapp',
    projectName: 'webapp',
    template: 'bg',
    inFlightTasks: 1,
    alive: true,
    pid: 25104,
    createdAt: minsAgo(32),
    updatedAt: minsAgo(2),
    needs: 'Should I store the Stripe customer ID on the users table or in a separate billing table?',
    hasPendingQuestion: true,
  },
  {
    id: 'c3d4e5',
    sessionId: '20260531T093000_000202',
    name: 'Investigate flaky e2e test',
    state: 'running',
    tempo: 'thinking',
    detail: 'Analyzing test/login.e2e.ts retry logs',
    intent: 'Find why the login e2e test fails ~1 in 5 runs on CI.',
    result: null,
    cwd: '/Users/alice/projects/webapp',
    projectName: 'webapp',
    template: 'claude',
    inFlightTasks: 1,
    alive: true,
    pid: 25210,
    createdAt: minsAgo(11),
    updatedAt: minsAgo(1),
    needs: null,
    hasPendingQuestion: false,
  },
  {
    id: 'd4e5f6',
    sessionId: '20260531T090500_000203',
    name: 'Bump dependencies',
    state: 'idle',
    tempo: 'idle',
    detail: 'Idle — awaiting your next prompt',
    intent: 'Upgrade React, Vite and TypeScript to their latest minor versions.',
    result: null,
    cwd: '/Users/alice/projects/webapp',
    projectName: 'webapp',
    template: 'bg',
    inFlightTasks: 0,
    alive: true,
    pid: 25288,
    createdAt: minsAgo(46),
    updatedAt: minsAgo(9),
    needs: null,
    hasPendingQuestion: false,
  },
  {
    id: 'e5f6a7',
    sessionId: '20260531T083000_000204',
    name: 'Add dark mode toggle',
    state: 'done',
    tempo: 'idle',
    detail: 'Completed — toggle shipped, 6 files changed',
    intent: 'Add a system-aware dark theme switch to the settings menu.',
    result: 'Added data-theme switching with localStorage persistence; audited 12 components for hardcoded colors.',
    cwd: '/Users/alice/projects/webapp',
    projectName: 'webapp',
    template: 'bg',
    inFlightTasks: 0,
    alive: false,
    pid: null,
    createdAt: minsAgo(180),
    updatedAt: minsAgo(64),
    needs: null,
    hasPendingQuestion: false,
  },
  {
    id: 'f6a7b8',
    sessionId: '20260531T080000_000205',
    name: 'Migrate to ESM',
    state: 'failed',
    tempo: 'idle',
    detail: 'Failed — build broke on circular import',
    intent: 'Convert the server bundle from CommonJS to native ESM.',
    result: 'Stopped after the build failed: circular dependency between src/db.ts and src/models/user.ts.',
    cwd: '/Users/alice/projects/webapp',
    projectName: 'webapp',
    template: 'claude',
    inFlightTasks: 0,
    alive: false,
    pid: null,
    createdAt: minsAgo(240),
    updatedAt: minsAgo(120),
    needs: null,
    hasPendingQuestion: false,
  },
  // ── Altri progetti: variano la Global Agent View ──
  {
    id: 'a7b8c9',
    sessionId: '20260531T095500_000098',
    name: 'Generate API docs',
    state: 'running',
    tempo: 'thinking',
    detail: 'Summarizing OpenAPI schema',
    intent: 'Write reference docs for every endpoint in the api-server project.',
    result: null,
    cwd: '/Users/alice/projects/api-server',
    projectName: 'api-server',
    template: 'claude',
    inFlightTasks: 1,
    alive: true,
    pid: 24990,
    createdAt: minsAgo(25),
    updatedAt: minsAgo(3),
    needs: 'Waiting for confirmation: overwrite existing docs/api.md?',
    hasPendingQuestion: true,
  },
  {
    id: 'g7h8i9',
    sessionId: '20260531T084000_000071',
    name: 'Add unit tests for utils',
    state: 'done',
    tempo: 'idle',
    detail: 'Completed — 14 tests added, all passing',
    intent: 'Write integration-style tests for the date and currency helpers.',
    result: 'Added 14 tests in test/utils.test.ts; coverage on src/utils.ts is now 96%.',
    cwd: '/Users/alice/experiments/llm-playground',
    projectName: 'llm-playground',
    template: 'bg',
    inFlightTasks: 0,
    alive: false,
    pid: null,
    createdAt: minsAgo(140),
    updatedAt: minsAgo(95),
    needs: null,
    hasPendingQuestion: false,
  },
];

// ─── Risposta AI Assistant simulata (streaming) ────────────────────────────────

const MOCK_AI_RESPONSE = `Here's a summary of the **webapp** project's authentication setup:

## Current state
- Sessions are handled by \`express-session\` and stored server-side
- \`req.session.userId\` gates the protected routes via \`src/middleware/protect.ts\`
- The secret comes from \`process.env.SESSION_SECRET\`

## Observations
1. **Stateless tokens** would remove the server-side session store and simplify horizontal scaling.
2. The login route in \`src/routes/auth.ts\` is the single place that establishes identity — a good seam to issue a JWT.
3. Three call sites reference \`req.session\`, so the migration surface is small.

## Suggested next step
Introduce \`src/auth/jwt.ts\` with \`signToken\`/\`verifyToken\`, then swap the middleware. The change is well-contained and low-risk.
`;

// ─── Subagents per sessione ────────────────────────────────────────────────────
// Transcript interni che Claude Code salva in {sessionId}/subagents/agent-*.jsonl.
// Il renderer li correla al tool_use Task/Agent nella chat tramite firstPrompt.

const MOCK_SUBAGENTS = [
  {
    agentId: 'agent-001',
    filePath: '/Users/alice/.claude/projects/-Users-alice-projects-webapp/subagents/agent-001.jsonl',
    firstPrompt: 'Audit every call site of req.session across the codebase and list the files that need migrating to JWT.',
    startedAt: minsAgo(123),
    endedAt: minsAgo(121),
    messageCount: 14,
  },
  {
    agentId: 'agent-002',
    filePath: '/Users/alice/.claude/projects/-Users-alice-projects-webapp/subagents/agent-002.jsonl',
    firstPrompt: 'Write integration tests for signToken and verifyToken in src/auth/jwt.ts.',
    startedAt: minsAgo(120),
    endedAt: minsAgo(118),
    messageCount: 9,
  },
];

// ─── Plugins installati (user scope) ───────────────────────────────────────────

const MOCK_PLUGINS = [
  {
    name: 'git-flow',
    marketplace: 'anthropic-community',
    scope: 'user' as const,
    version: '1.4.0',
    installPath: '/Users/alice/.claude/plugins/git-flow',
    description: 'Conventional commits, branch helpers and PR review commands.',
    author: 'Anthropic Community',
    repo: 'https://github.com/anthropic-community/git-flow',
    skills: [
      {
        name: 'changelog',
        path: '/Users/alice/.claude/plugins/git-flow/skills/changelog/SKILL.md',
        scope: 'plugin' as const,
        content: 'Generate a changelog entry from the staged diff.',
        rawContent: '---\nname: changelog\ndescription: Generate a changelog entry from the staged diff\n---\n\nGenerate a changelog entry from the staged diff.',
        description: 'Generate a changelog entry from the staged diff',
        userInvocable: true,
      },
    ],
    agents: [
      {
        name: 'pr-reviewer',
        path: '/Users/alice/.claude/plugins/git-flow/agents/pr-reviewer.md',
        scope: 'plugin' as const,
        content: 'Reviews a pull request and flags risky changes.',
        rawContent: '---\ndescription: Review a pull request\n---\n\nReviews a pull request and flags risky changes.',
        description: 'Review a pull request',
        missingRequired: [],
        filenameHasSpaces: false,
      },
    ],
    commands: [
      {
        name: 'commit',
        path: '/Users/alice/.claude/plugins/git-flow/commands/commit.md',
        description: 'Stage and write a conventional commit',
        content: 'Stage changes and write a conventional commit message.',
        rawContent: '---\ndescription: Stage and write a conventional commit\n---\n\nStage changes and write a conventional commit message.',
      },
    ],
  },
  {
    name: 'test-runner',
    marketplace: 'anthropic-community',
    scope: 'user' as const,
    version: '0.9.2',
    installPath: '/Users/alice/.claude/plugins/test-runner',
    description: 'Run, watch and triage test suites without leaving the session.',
    author: 'Anthropic Community',
    repo: 'https://github.com/anthropic-community/test-runner',
    skills: [],
    agents: [],
    commands: [
      {
        name: 'test',
        path: '/Users/alice/.claude/plugins/test-runner/commands/test.md',
        description: 'Run the project test suite',
        content: 'Run the project test suite and summarize failures.',
        rawContent: '---\ndescription: Run the project test suite\n---\n\nRun the project test suite and summarize failures.',
      },
    ],
  },
];

// ─── Config effettiva (vista Settings → System / Project config) ───────────────

const MOCK_EFFECTIVE_CONFIG = {
  cwd: '/Users/alice/projects/webapp',
  init: {
    permissionMode: 'default',
    model: 'claude-opus-4-8',
    cwd: '/Users/alice/projects/webapp',
    apiKeySource: 'subscription',
    claudeCodeVersion: '2.1.191',
    tools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Task', 'WebFetch', 'WebSearch'],
    mcpServers: [
      { name: 'github', status: 'connected' },
      { name: 'linear', status: 'connected' },
      { name: 'filesystem', status: 'connected' },
    ],
    slashCommands: ['commit', 'review-pr', 'frontend-design', 'claude-api', 'deploy'],
    outputStyle: 'default',
    skills: ['changelog', 'deploy'],
    agents: ['code-reviewer', 'docs-writer', 'db-migrator'],
    plugins: [
      { name: 'git-flow', path: '/Users/alice/.claude/plugins/git-flow' },
      { name: 'test-runner', path: '/Users/alice/.claude/plugins/test-runner' },
    ],
  },
  initError: null,
  effective: {
    model: 'claude-opus-4-8',
    cleanupPeriodDays: 30,
    includeCoAuthoredBy: false,
    permissions: { defaultMode: 'default' },
  },
  provenance: {
    model: { source: 'projectSettings', path: '/Users/alice/projects/webapp/.claude/settings.json' },
    cleanupPeriodDays: { source: 'userSettings', path: '/Users/alice/.claude/settings.json' },
    includeCoAuthoredBy: { source: 'userSettings', path: '/Users/alice/.claude/settings.json' },
  },
  sources: [
    {
      source: 'userSettings',
      path: '/Users/alice/.claude/settings.json',
      settings: { cleanupPeriodDays: 30, includeCoAuthoredBy: false },
    },
    {
      source: 'projectSettings',
      path: '/Users/alice/projects/webapp/.claude/settings.json',
      settings: { model: 'claude-opus-4-8' },
    },
  ],
  settingsError: null,
};

// ─── Pricing metadata (Analytics) ──────────────────────────────────────────────

const MOCK_PRICING_META = {
  lastUpdated: '2026-06-01',
  knownModels: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
};

// ─── Progetti duplicati (vista Duplicates) ─────────────────────────────────────
// Due cartelle history che puntano allo stesso path autoritativo (differiscono
// solo per il case di "Projects"), così la vista Duplicates mostra un gruppo.

const DUP_SOURCE_HASH = '-Users-alice-Projects-webapp';
const DUP_DEST_HASH = '-Users-alice-projects-webapp';

const MOCK_DUPLICATES = [
  {
    key: '/users/alice/projects/webapp',
    name: 'webapp',
    folders: [
      {
        hash: DUP_DEST_HASH,
        realPath: '/Users/alice/projects/webapp',
        realPathAuthoritative: true,
        sessionCount: 42,
        lastActivity: minsAgo(0),
        memoryTopicCount: 3,
        hasMemoryIndex: true,
      },
      {
        hash: DUP_SOURCE_HASH,
        realPath: '/Users/alice/Projects/webapp',
        realPathAuthoritative: false,
        sessionCount: 5,
        lastActivity: daysAgo(14),
        memoryTopicCount: 1,
        hasMemoryIndex: false,
      },
    ],
  },
];

const MOCK_MERGE_PLAN = {
  source: { hash: DUP_SOURCE_HASH, realPath: '/Users/alice/Projects/webapp', authoritative: false },
  dest: { hash: DUP_DEST_HASH, realPath: '/Users/alice/projects/webapp', authoritative: true },
  cwdRewrite: { from: '/Users/alice/Projects/webapp', to: '/Users/alice/projects/webapp' },
  sessions: [
    { filename: '20260615T101500_000300.jsonl', collides: false, targetName: '20260615T101500_000300.jsonl' },
    { filename: '20260612T084500_000301.jsonl', collides: false, targetName: '20260612T084500_000301.jsonl' },
  ],
  sidecars: [{ name: 'subagents', collides: false }],
  memory: [{ filename: 'feedback_naming.md', kind: 'copy' as const }],
  regenerateIndex: true,
  sourceEmptyAfter: true,
  blockers: [],
  warnings: [],
};

const MOCK_MERGE_RESULT = {
  movedSessions: 5,
  renamedSessions: 0,
  movedSidecars: 1,
  cwdRewrittenFiles: 5,
  memoryCopied: 1,
  memoryRenamed: 0,
  memorySkipped: 0,
  sourceDeleted: true,
  backupPath: '/Users/alice/.claude/.claudelens-backups/webapp-merge.zip',
  warnings: [],
};

// ─── Artifacts di una sessione (dialog di cancellazione) ───────────────────────

function getSessionArtifacts(filename: string) {
  const sessionId = filename.replace(/\.jsonl$/, '');
  return {
    sessionId,
    artifacts: [
      { kind: 'session' as const, label: 'Transcript', path: `/Users/alice/.claude/projects/-Users-alice-projects-webapp/${filename}`, isDir: false, locked: true, defaultSelected: true },
      { kind: 'subagents' as const, label: 'Sub-agent transcripts', path: `/Users/alice/.claude/projects/-Users-alice-projects-webapp/${sessionId}/subagents`, isDir: true, count: 2, defaultSelected: true },
      { kind: 'tasks' as const, label: 'Tasks', path: `/Users/alice/.claude/tasks/${sessionId}`, isDir: true, count: 4, defaultSelected: true },
      { kind: 'plan' as const, label: 'Plan: migrate-auth-to-jwt.md', path: '/Users/alice/.claude/plans/migrate-auth-to-jwt.md', isDir: false, shared: true, referencedBy: 1, defaultSelected: false },
    ],
  };
}

// ─── Prefs UI persistite (tag gestiti, pin, tema) ──────────────────────────────
// I tag/pin vivono in localStorage lato renderer e vengono idratati da disco via
// `prefs:getAll` all'avvio. In screenshot mode il disco non esiste, quindi qui
// seminiamo direttamente lo store così Memory/Session view mostrano i tag (e i
// progetti/sessioni pinnati) invece di superfici vuote.

const WEBAPP_HASH = '-Users-alice-projects-webapp';

function getPrefs() {
  // Tag di sessione agganciati ai filename reali delle prime sessioni webapp
  // (generati da NOW), così combaciano con la lista mostrata nel tab Sessions.
  const sessions = getSessionList(WEBAPP_HASH);
  const sessionTags: Record<string, string[]> = {};
  if (sessions[0]) sessionTags[sessions[0].filename] = ['auth', 'in-progress'];
  if (sessions[2]) sessionTags[sessions[2].filename] = ['architecture'];
  if (sessions[4]) sessionTags[sessions[4].filename] = ['ui'];

  return {
    'cl-pinned-projects': [WEBAPP_HASH],
    'cl-pinned-sessions': sessions[0] ? [sessions[0].filename] : [],
    'cl-memory-tags': {
      [WEBAPP_HASH]: {
        tags: [
          { name: 'important', createdAt: daysAgo(30) },
          { name: 'convention', createdAt: daysAgo(20) },
        ],
        memoryTags: {
          'feedback_testing.md': ['important', 'convention'],
          'feedback_code_style.md': ['convention'],
        },
      },
    },
    'cl-session-tags': {
      [WEBAPP_HASH]: {
        tags: [
          { name: 'auth', createdAt: daysAgo(2) },
          { name: 'in-progress', createdAt: daysAgo(2) },
          { name: 'architecture', createdAt: daysAgo(5) },
          { name: 'ui', createdAt: daysAgo(8) },
        ],
        sessionTags,
      },
    },
  };
}

// ─── Registrazione handler mock ───────────────────────────────────────────────

export function registerScreenshotHandlers(ipcMain: IpcMain) {
  const channels = [
    'memory:listProjects', 'memory:getProject', 'memory:createTopic', 'memory:updateTopic', 'memory:deleteTopic',
    'cost:getSummary', 'cost:getByProject',
    'claudeMd:getGlobal', 'claudeMd:getHierarchy', 'claudeMd:writeGlobal', 'claudeMd:writeFile',
    'claudeMd:deleteGlobal', 'claudeMd:deleteFile',
    'markdownFile:write', 'markdownFile:delete',
    'export:markdown', 'export:pdf',
    'sessions:listByProject', 'sessions:getChat',
    'rules:getByProject',
    'skills:getGlobal', 'skills:getAll', 'skills:create',
    'agents:getGlobal', 'agents:getByProject', 'agents:create',
    'projects:delete',
    'mcp:getGlobal',
    'ai:run', 'ai:stop',
    'live:getActiveSessions', 'live:getSessions', 'live:startWatch', 'live:stopWatch',
    'tasks:getByProject', 'plans:getByProject',
    'settings:getCleanupPeriodDays',
    'sessions:getSubagents', 'sessions:getArtifacts', 'sessions:deleteSession',
    'plugins:getAll',
    'config:getEffective',
    'cost:getPricingMeta',
    'projects:detectDuplicates', 'projects:planMerge', 'projects:executeMerge',
    'telemetry:isEnabled', 'telemetry:setEnabled', 'telemetry:track',
    'agents:attachBg', 'agents:stopBg', 'agents:respawnBg', 'agents:deleteBg',
    'notifications:clearBadge',
    'prefs:getAll', 'prefs:set',
  ];

  // Rimuovi handler reali prima di registrare i mock
  channels.forEach(ch => ipcMain.removeHandler(ch));

  ipcMain.handle('memory:listProjects', () => ok(MOCK_PROJECTS));
  ipcMain.handle('memory:getProject', (_e: unknown, hash: string) => ok(getMemoryData(hash)));
  ipcMain.handle('memory:createTopic', () => ok({ filename: 'new_topic.md' }));
  ipcMain.handle('memory:updateTopic', () => ok(null));
  ipcMain.handle('memory:deleteTopic', () => ok(null));

  ipcMain.handle('cost:getSummary', () =>
    ok(MOCK_PROJECTS.map(p => getCost(p.hash)))
  );
  ipcMain.handle('cost:getByProject', (_e: unknown, hash: string) => ok(getCost(hash)));

  ipcMain.handle('claudeMd:getGlobal', () => ok(GLOBAL_CLAUDE_MD));
  ipcMain.handle('claudeMd:getHierarchy', () => ok({ layers: HIERARCHY_LAYERS }));
  ipcMain.handle('claudeMd:writeGlobal', () => ok(null));
  ipcMain.handle('claudeMd:writeFile', () => ok(null));
  ipcMain.handle('claudeMd:deleteGlobal', () => ok(null));
  ipcMain.handle('claudeMd:deleteFile', () => ok(null));
  ipcMain.handle('markdownFile:write', () => ok(null));
  ipcMain.handle('markdownFile:delete', () => ok(null));
  ipcMain.handle('export:markdown', () => ok({ canceled: false, filePath: '/tmp/claudelens-export.md' }));
  ipcMain.handle('export:pdf', () => ok({ canceled: false, filePath: '/tmp/claudelens-export.pdf' }));

  ipcMain.handle('sessions:listByProject', (_e: unknown, hash: string) => ok(getSessionList(hash)));
  ipcMain.handle('sessions:getChat', () => ok(MOCK_CHAT));

  ipcMain.handle('rules:getByProject', () => ok(MOCK_RULES));

  ipcMain.handle('skills:getGlobal', () => ok(GLOBAL_SKILLS));
  ipcMain.handle('skills:getAll', () => ok([...GLOBAL_SKILLS, PROJECT_SKILL]));
  ipcMain.handle('skills:create', () => ok({ filePath: '/Users/alice/.claude/commands/new-skill.md' }));

  ipcMain.handle('agents:getGlobal', () => ok(GLOBAL_AGENTS));
  ipcMain.handle('agents:getByProject', () => ok([PROJECT_AGENT]));
  ipcMain.handle('agents:create', () => ok({ filePath: '/Users/alice/.claude/agents/new-agent.md' }));

  ipcMain.handle('projects:delete', () => ok(null));

  ipcMain.handle('mcp:getGlobal', () => ok(MOCK_MCP));

  // Streaming AI simulato: invia la risposta a blocchi via `ai:chunk`, poi `ai:done`.
  ipcMain.handle('ai:run', (event: { sender: { send: (channel: string, ...args: unknown[]) => void } }) => {
    const words = MOCK_AI_RESPONSE.split(/(\s+)/);
    let i = 0;
    const tick = () => {
      if (i >= words.length) {
        event.sender.send('ai:done');
        return;
      }
      // Spedisce qualche token alla volta per simulare lo streaming
      const slice = words.slice(i, i + 4).join('');
      event.sender.send('ai:chunk', slice);
      i += 4;
      setTimeout(tick, 40);
    };
    setTimeout(tick, 120);
    return ok(null);
  });
  ipcMain.handle('ai:stop', () => ok(null));

  ipcMain.handle('live:getActiveSessions', () => ok(MOCK_ACTIVE_SESSIONS));
  ipcMain.handle('live:getSessions', () => ok(MOCK_BG_SESSIONS));
  ipcMain.handle('live:startWatch', () => ok({ started: true }));
  ipcMain.handle('live:stopWatch', () => ok(null));

  // Aggancia i gruppi task/plan alle sessioni reali del progetto (per filename),
  // così la UI mostra il titolo e la data della sessione e l'header è cliccabile.
  const attachToSessions = <T extends { sessionId: string; filename: string }>(hash: string, groups: T[]): T[] => {
    const sessions = getSessionList(hash);
    return groups.map((g, i) => {
      const s = sessions[i];
      return s ? { ...g, sessionId: s.filename.replace(/\.jsonl$/, ''), filename: s.filename } : g;
    });
  };

  ipcMain.handle('tasks:getByProject', (_e: unknown, hash: string) => ok(attachToSessions(hash, MOCK_TASKS)));
  ipcMain.handle('plans:getByProject', (_e: unknown, hash: string) => ok(attachToSessions(hash, MOCK_PLANS)));

  // Finestra di retention fissa così i conteggi demo sono deterministici
  // a prescindere dalle settings reali della macchina.
  ipcMain.handle('settings:getCleanupPeriodDays', () => ok(30));

  // Sub-agent transcripts + artifacts/cancellazione sessione
  ipcMain.handle('sessions:getSubagents', () => ok(MOCK_SUBAGENTS));
  ipcMain.handle('sessions:getArtifacts', (_e: unknown, _hash: string, filename: string) => ok(getSessionArtifacts(filename)));
  ipcMain.handle('sessions:deleteSession', (_e: unknown, paths: string[]) => ok({ deleted: paths, warnings: [] }));

  // Plugins installati (user scope)
  ipcMain.handle('plugins:getAll', () => ok(MOCK_PLUGINS));

  // Config effettiva (Settings → System / Project config)
  ipcMain.handle('config:getEffective', () => ok(MOCK_EFFECTIVE_CONFIG));

  // Pricing metadata (Analytics)
  ipcMain.handle('cost:getPricingMeta', () => ok(MOCK_PRICING_META));

  // Progetti duplicati + merge
  ipcMain.handle('projects:detectDuplicates', () => ok(MOCK_DUPLICATES));
  ipcMain.handle('projects:planMerge', () => ok(MOCK_MERGE_PLAN));
  ipcMain.handle('projects:executeMerge', () => ok(MOCK_MERGE_RESULT));

  // Telemetria: in screenshot mode sempre OFF, toggle no-op, track scartato
  ipcMain.handle('telemetry:isEnabled', () => ok(false));
  ipcMain.handle('telemetry:setEnabled', (_e: unknown, enabled: boolean) => ok(enabled));
  ipcMain.handle('telemetry:track', () => ok(null));

  // Azioni background agent: no-op (la lista resta MOCK_BG_SESSIONS)
  ipcMain.handle('agents:attachBg', () => ok(null));
  ipcMain.handle('agents:stopBg', () => ok(null));
  ipcMain.handle('agents:respawnBg', () => ok(null));
  ipcMain.handle('agents:deleteBg', () => ok(null));

  // Badge notifiche
  ipcMain.handle('notifications:clearBadge', () => ok(true));

  // Stato UI persistito (tag gestiti, pin, tema): seminato così le viste
  // Memory/Session mostrano i tag invece di superfici vuote.
  ipcMain.handle('prefs:getAll', () => ok(getPrefs()));
  ipcMain.handle('prefs:set', () => ok(true));
}
