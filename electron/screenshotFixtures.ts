import { IpcMain } from 'electron';

type IpcResult<T> = { data: T | null; error: string | null };
const ok = <T>(data: T): IpcResult<T> => ({ data, error: null });

// ─── Progetti finti ───────────────────────────────────────────────────────────

const MOCK_PROJECTS = [
  { hash: '-Users-alice-projects-webapp', realPath: '/Users/alice/projects/webapp' },
  { hash: '-Users-alice-projects-api-server', realPath: '/Users/alice/projects/api-server' },
  { hash: '-Users-alice-work-data-pipeline', realPath: '/Users/alice/work/data-pipeline' },
  { hash: '-Users-alice-experiments-llm-playground', realPath: '/Users/alice/experiments/llm-playground' },
  { hash: '-Users-alice-side-blog', realPath: '/Users/alice/side/blog' },
];

// ─── Costi per progetto ───────────────────────────────────────────────────────

const MOCK_COSTS: Record<string, { inputTokens: number; outputTokens: number; cacheRead: number; sessionsCount: number; cost: number }> = {
  '-Users-alice-projects-webapp':          { inputTokens: 410_000,  outputTokens: 180_000, cacheRead: 890_000,  sessionsCount: 42, cost: 28.50 },
  '-Users-alice-projects-api-server':      { inputTokens: 160_000,  outputTokens: 72_000,  cacheRead: 340_000,  sessionsCount: 18, cost: 11.20 },
  '-Users-alice-work-data-pipeline':       { inputTokens: 78_000,   outputTokens: 33_000,  cacheRead: 120_000,  sessionsCount: 9,  cost: 5.40 },
  '-Users-alice-experiments-llm-playground': { inputTokens: 290_000, outputTokens: 130_000, cacheRead: 560_000,  sessionsCount: 31, cost: 19.70 },
  '-Users-alice-side-blog':                { inputTokens: 18_000,   outputTokens: 7_000,   cacheRead: 22_000,   sessionsCount: 3,  cost: 1.20 },
};

function getCost(hash: string) {
  const c = MOCK_COSTS[hash] ?? MOCK_COSTS['-Users-alice-projects-webapp'];
  return {
    project: hash,
    inputTokens: c.inputTokens,
    outputTokens: c.outputTokens,
    cacheReadTokens: c.cacheRead,
    totalTokens: c.inputTokens + c.outputTokens,
    cost: c.cost,
    sessionsCount: c.sessionsCount,
  };
}

// ─── Sessioni per progetto ────────────────────────────────────────────────────

const SESSION_TEMPLATES = [
  { days: 0,  input: 48_000,  output: 21_000, cache: 95_000,  msgs: 34, model: 'claude-sonnet-4-6', title: 'Refactor authentication module' },
  { days: 1,  input: 31_000,  output: 14_500, cache: 62_000,  msgs: 22, model: 'claude-sonnet-4-6', title: 'Fix TypeScript strict mode errors' },
  { days: 3,  input: 72_000,  output: 28_000, cache: 140_000, msgs: 51, model: 'claude-opus-4-6',   title: 'Design new API architecture' },
  { days: 5,  input: 19_000,  output: 8_200,  cache: 38_000,  msgs: 15, model: 'claude-haiku-4-5',  title: 'Write unit tests for utils' },
  { days: 8,  input: 55_000,  output: 24_000, cache: 110_000, msgs: 40, model: 'claude-sonnet-4-6', title: 'Add dark mode support' },
  { days: 12, input: 38_000,  output: 16_000, cache: 76_000,  msgs: 28, model: 'claude-sonnet-4-6', title: 'Optimize database queries' },
  { days: 18, input: 26_000,  output: 11_000, cache: 50_000,  msgs: 19, model: 'claude-haiku-4-5',  title: 'Update dependencies' },
  { days: 25, input: 61_000,  output: 27_000, cache: 122_000, msgs: 44, model: 'claude-opus-4-6',   title: 'Implement real-time sync' },
];

function getSessionList(_hash: string) {
  const now = new Date('2026-03-29T10:00:00Z');
  return SESSION_TEMPLATES.map((t, i) => {
    const d = new Date(now.getTime() - t.days * 86_400_000);
    const pad = (n: number) => String(n).padStart(2, '0');
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
      messageCount: t.msgs,
      model: t.model,
      models: { [t.model]: t.msgs },
      customTitle: t.title,
    };
  });
}

// ─── Chat finta ───────────────────────────────────────────────────────────────

const MOCK_CHAT = [
  {
    uuid: 'msg-001',
    role: 'user' as const,
    timestamp: '2026-03-29T09:05:00Z',
    content: [{ type: 'text' as const, text: 'Can you refactor the authentication module to use JWT tokens instead of sessions?' }],
  },
  {
    uuid: 'msg-002',
    role: 'assistant' as const,
    timestamp: '2026-03-29T09:05:04Z',
    model: 'claude-sonnet-4-6',
    content: [
      { type: 'text' as const, text: "I'll start by reading the current authentication implementation to understand what needs to change." },
      { type: 'tool_use' as const, id: 'tu-001', name: 'Read', input: { file_path: '/Users/alice/projects/webapp/src/auth/session.ts' } },
    ],
  },
  {
    uuid: 'msg-003',
    role: 'user' as const,
    timestamp: '2026-03-29T09:05:05Z',
    content: [{ type: 'tool_result' as const, toolUseId: 'tu-001', content: 'import session from "express-session";\n\nexport function configureSession(app) {\n  app.use(session({ secret: process.env.SESSION_SECRET, resave: false }));\n}\n', isError: false }],
  },
  {
    uuid: 'msg-004',
    role: 'assistant' as const,
    timestamp: '2026-03-29T09:05:10Z',
    model: 'claude-sonnet-4-6',
    content: [
      { type: 'text' as const, text: "Now let me check the route handlers to understand how sessions are used." },
      { type: 'tool_use' as const, id: 'tu-002', name: 'Grep', input: { pattern: 'req\\.session', path: '/Users/alice/projects/webapp/src' } },
    ],
  },
  {
    uuid: 'msg-005',
    role: 'user' as const,
    timestamp: '2026-03-29T09:05:11Z',
    content: [{ type: 'tool_result' as const, toolUseId: 'tu-002', content: 'src/routes/auth.ts:24:  req.session.userId = user.id;\nsrc/routes/auth.ts:51:  delete req.session.userId;\nsrc/middleware/protect.ts:8:  if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });\n', isError: false }],
  },
  {
    uuid: 'msg-006',
    role: 'assistant' as const,
    timestamp: '2026-03-29T09:05:18Z',
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
    timestamp: '2026-03-29T09:06:01Z',
    content: [{ type: 'text' as const, text: 'Yes, go ahead.' }],
  },
  {
    uuid: 'msg-008',
    role: 'assistant' as const,
    timestamp: '2026-03-29T09:06:05Z',
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
      { name: 'User profile', description: 'Senior full-stack engineer, 8yr TypeScript experience', type: 'user', filename: 'user_profile.md', createdAt: '2026-01-15T10:00:00Z', updatedAt: '2026-03-20T14:30:00Z' },
      { name: 'Code style feedback', description: 'Prefers functional patterns, no class components, terse PR descriptions', type: 'feedback', filename: 'feedback_code_style.md', createdAt: '2026-02-01T09:00:00Z', updatedAt: '2026-03-18T11:00:00Z' },
      { name: 'Testing approach', description: 'Integration tests over unit mocks — past incident with divergent mock/prod', type: 'feedback', filename: 'feedback_testing.md', createdAt: '2026-02-10T08:00:00Z', updatedAt: '2026-03-10T16:00:00Z' },
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
      { name: 'Project goals', description: 'Q1 targets: launch beta, gather 50 signups', type: 'project', filename: 'project_goals.md', createdAt: '2026-01-10T10:00:00Z', updatedAt: '2026-02-28T15:00:00Z' },
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
    rawContent: '---\ndescription: Review code quality\nmodel: claude-opus-4-6\n---\n\nReview code for quality and security.',
    description: 'Review code quality',
    model: 'claude-opus-4-6',
  },
  {
    name: 'docs-writer',
    path: '/Users/alice/.claude/agents/docs-writer.md',
    scope: 'global' as const,
    content: 'Generates clear, concise technical documentation.',
    rawContent: '---\ndescription: Write technical docs\n---\n\nGenerate clear technical documentation.',
    description: 'Write technical docs',
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
};

// ─── MCP ─────────────────────────────────────────────────────────────────────

const MOCK_MCP = {
  cloudServers: [
    {
      name: 'github',
      source: 'cloud' as const,
      enabledInProjects: 4,
      disabledInProjects: 2,
      disabledProjectPaths: ['/Users/alice/side/blog', '/Users/alice/work/data-pipeline'],
    },
    {
      name: 'linear',
      source: 'cloud' as const,
      enabledInProjects: 2,
      disabledInProjects: 3,
      disabledProjectPaths: [
        '/Users/alice/projects/api-server',
        '/Users/alice/side/blog',
        '/Users/alice/work/data-pipeline',
      ],
    },
  ],
  localServers: [
    {
      name: 'filesystem',
      source: 'local' as const,
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/alice'],
      enabledInProjects: 5,
      disabledInProjects: 1,
      disabledProjectPaths: ['/Users/alice/side/blog'],
    },
  ],
  totalProjects: 5,
};

// ─── Processi live ────────────────────────────────────────────────────────────

const MOCK_PROCESSES = [
  { pid: 18423, cwd: '/Users/alice/projects/webapp', cmdline: 'claude --resume 20260329T091500_000042' },
  { pid: 19871, cwd: '/Users/alice/experiments/llm-playground', cmdline: 'claude' },
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

// ─── Registrazione handler mock ───────────────────────────────────────────────

export function registerScreenshotHandlers(ipcMain: IpcMain) {
  const channels = [
    'memory:listProjects', 'memory:getProject', 'memory:createTopic', 'memory:updateTopic', 'memory:deleteTopic',
    'cost:getSummary', 'cost:getByProject',
    'claudeMd:getGlobal', 'claudeMd:getHierarchy',
    'sessions:listByProject', 'sessions:getChat', 'sessions:openInTerminal', 'sessions:newInTerminal',
    'rules:getByProject',
    'skills:getGlobal', 'skills:getAll', 'skills:create',
    'agents:getGlobal', 'agents:getByProject', 'agents:create',
    'projects:delete',
    'mcp:getGlobal',
    'ai:run', 'ai:stop',
    'live:getProcesses', 'live:startWatch', 'live:stopWatch',
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

  ipcMain.handle('sessions:listByProject', (_e: unknown, hash: string) => ok(getSessionList(hash)));
  ipcMain.handle('sessions:getChat', () => ok(MOCK_CHAT));
  ipcMain.handle('sessions:openInTerminal', () => ok(null));
  ipcMain.handle('sessions:newInTerminal', () => ok(null));

  ipcMain.handle('rules:getByProject', () => ok(MOCK_RULES));

  ipcMain.handle('skills:getGlobal', () => ok(GLOBAL_SKILLS));
  ipcMain.handle('skills:getAll', () => ok([...GLOBAL_SKILLS, PROJECT_SKILL]));
  ipcMain.handle('skills:create', () => ok({ filePath: '/Users/alice/.claude/commands/new-skill.md' }));

  ipcMain.handle('agents:getGlobal', () => ok(GLOBAL_AGENTS));
  ipcMain.handle('agents:getByProject', () => ok([PROJECT_AGENT]));
  ipcMain.handle('agents:create', () => ok({ filePath: '/Users/alice/.claude/agents/new-agent.md' }));

  ipcMain.handle('projects:delete', () => ok(null));

  ipcMain.handle('mcp:getGlobal', () => ok(MOCK_MCP));

  ipcMain.handle('ai:run', () => ok(null));
  ipcMain.handle('ai:stop', () => ok(null));

  ipcMain.handle('live:getProcesses', () => ok(MOCK_PROCESSES));
  ipcMain.handle('live:startWatch', () => ok({ started: true }));
  ipcMain.handle('live:stopWatch', () => ok(null));
}
