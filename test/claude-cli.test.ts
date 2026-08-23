import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, existsSync, readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  execClaude,
  spawnClaude,
  readInstalledClaudeVersion,
  ExecClaudeError,
} from '../electron/modules/claude-cli';

const E2E = process.env.CLAUDE_E2E === '1';

// ── Unit (POSIX): un finto `claude` nel PATH pilota i percorsi success/failure
// in modo deterministico. Su Windows lo shim sh non funziona: lì la copertura
// arriva dal blocco E2E sotto, che gira nel job CI `terminal-integration`.
describe.skipIf(process.platform === 'win32')('claude-cli (fake CLI on PATH)', () => {
  let binDir: string;

  beforeEach(() => {
    binDir = mkdtempSync(join(tmpdir(), 'cl-cli-'));
    const script = [
      '#!/bin/sh',
      'if [ "$1" = "fail" ]; then echo boom >&2; exit 3; fi',
      'echo "hello $1"',
    ].join('\n');
    writeFileSync(join(binDir, 'claude'), script, 'utf-8');
    chmodSync(join(binDir, 'claude'), 0o755);
  });

  afterEach(() => {
    rmSync(binDir, { recursive: true, force: true });
  });

  it('execClaude risolve con lo stdout a exit 0', async () => {
    const { stdout } = await execClaude(['world'], { env: { PATH: binDir } });
    expect(stdout.trim()).toBe('hello world');
  });

  it('execClaude rigetta con exitCode e stderr su exit non-zero', async () => {
    const e = (await execClaude(['fail'], { env: { PATH: binDir } }).catch(
      err => err
    )) as ExecClaudeError;
    expect(e).toBeInstanceOf(Error);
    expect(e.exitCode).toBe(3);
    expect(e.stderr).toContain('boom');
  });

  it('execClaude rigetta con code ENOENT quando la CLI manca dal PATH', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'cl-empty-'));
    try {
      const e = (await execClaude(['x'], { env: { PATH: empty } }).catch(
        err => err
      )) as ExecClaudeError;
      expect(e.code).toBe('ENOENT');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('execClaude usa `executable` quando la CLI non è nel PATH', async () => {
    // Percorso dell'app pacchettizzata: `claude` non è nel PATH del processo
    // Electron ma il binario unpacked è noto (resolveClaudeExecutablePath).
    const empty = mkdtempSync(join(tmpdir(), 'cl-empty-'));
    try {
      const { stdout } = await execClaude(['world'], {
        env: { PATH: empty },
        executable: join(binDir, 'claude'),
      });
      expect(stdout.trim()).toBe('hello world');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('execClaude rigetta con ETIMEDOUT oltre il timeout e uccide il processo', async () => {
    const slow = join(binDir, 'claude');
    // `read` e non `sleep`: il PATH del figlio è la sola binDir, dove `sleep`
    // non esiste e non è un builtin — lo script stampava "command not found",
    // faceva `echo` e usciva 0 in ~150-190ms, cioè in gara col timeout invece
    // che oltre. Chi vinceva dipendeva dalla latenza di spawn della macchina
    // (verde in locale, rosso sui runner CI). `read` è un builtin e blocca sullo
    // stdin del pipe, che nessuno scrive: il processo non finisce mai da solo.
    writeFileSync(slow, '#!/bin/sh\nread ignored\necho late\n', 'utf-8');
    chmodSync(slow, 0o755);
    const started = Date.now();
    const e = (await execClaude(['x'], { env: { PATH: binDir }, timeout: 150 }).catch(
      err => err
    )) as ExecClaudeError;
    expect(e.code).toBe('ETIMEDOUT');
    expect(e.message).toContain('150ms');
    // Ha atteso davvero il timeout, non è uscito da solo prima.
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
  });

  it("onTimeout: 'detach' lascia VIVO il processo, 'kill' lo uccide", async () => {
    // Il caso per cui `detach` esiste: `claude project purge` cancella una voce
    // alla volta e su una che non riesce a rimuovere si appende. Ucciderlo al cap
    // lasciava cancellato tutto ciò che veniva prima e intatto il resto, con un
    // banner rosso di fallimento sopra una cancellazione irreversibile a metà
    // (#224). La differenza fra le due modalità è la SOPRAVVIVENZA del processo,
    // quindi il test la misura sul pid: un marker su file non discriminerebbe —
    // né un processo ucciso né uno ancora bloccato lo scriverebbero.
    const pidFile = join(binDir, 'child.pid');
    const slow = join(binDir, 'claude');
    // `read` è un builtin e blocca sullo stdin del pipe, che nessuno scrive: il
    // processo non finisce mai da solo (un `sleep` non esiste in questo PATH).
    writeFileSync(slow, `#!/bin/sh\necho $$ > ${pidFile}\nread ignored\n`, 'utf-8');
    chmodSync(slow, 0o755);

    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    // Il cap è generoso di proposito: il figlio deve avere scritto il suo pid
    // PRIMA che scatti, altrimenti in modalità `kill` muore senza lasciarne
    // traccia e il test non avrebbe nulla da interrogare. Misurato: spawn +
    // avvio di /bin/sh sta sopra i 150ms su questa macchina, quindi un cap
    // stretto gareggia con l'avvio invece di misurare la sopravvivenza.
    const runWith = async (onTimeout: 'kill' | 'detach') => {
      rmSync(pidFile, { force: true });
      const err = (await execClaude(['x'], {
        env: { PATH: binDir },
        timeout: 1500,
        onTimeout,
      }).catch(e => e)) as ExecClaudeError;
      expect(existsSync(pidFile)).toBe(true);
      return { err, pid: Number(readFileSync(pidFile, 'utf-8').trim()) };
    };

    const detached = await runWith('detach');
    expect(detached.err.code).toBe('ETIMEDOUT');
    expect(detached.err.detached).toBe(true);
    // L'attesa è la parte che rende il test capace di distinguere: un segnale
    // appena inviato non ha ancora ucciso nulla, quindi interrogare il pid subito
    // dopo il reject risponderebbe "vivo" anche in modalità `kill`.
    await new Promise(r => setTimeout(r, 400));
    expect(alive(detached.pid)).toBe(true);
    process.kill(detached.pid, 'SIGKILL');

    const killed = await runWith('kill');
    expect(killed.err.code).toBe('ETIMEDOUT');
    expect(killed.err.detached).toBe(false);
    // La morte non è istantanea: si attende la consegna del segnale.
    for (let i = 0; i < 40 && alive(killed.pid); i++) {
      await new Promise(r => setTimeout(r, 25));
    }
    expect(alive(killed.pid)).toBe(false);
  });

  it('execClaude non lascia timer pendenti sul successo', async () => {
    const { stdout } = await execClaude(['world'], { env: { PATH: binDir }, timeout: 10_000 });
    expect(stdout.trim()).toBe('hello world');
  });

  it('readInstalledClaudeVersion legge la versione dal `claude` sul PATH', async () => {
    writeFileSync(join(binDir, 'claude'), '#!/bin/sh\necho "9.9.9 (Claude Code)"\n', 'utf-8');
    chmodSync(join(binDir, 'claude'), 0o755);
    await expect(readInstalledClaudeVersion({ PATH: binDir })).resolves.toBe('9.9.9');
  });

  it('readInstalledClaudeVersion dà null su output non parsabile, ENOENT se manca', async () => {
    writeFileSync(join(binDir, 'claude'), '#!/bin/sh\necho "not a version"\n', 'utf-8');
    chmodSync(join(binDir, 'claude'), 0o755);
    // Illeggibile ≠ assente: la UI dice "unknown" in un caso e "not found" nell'altro,
    // e in nessuno dei due ripiega sulla versione shippata (era il bug della #201).
    await expect(readInstalledClaudeVersion({ PATH: binDir })).resolves.toBeNull();

    const empty = mkdtempSync(join(tmpdir(), 'cl-empty-'));
    try {
      const e = (await readInstalledClaudeVersion({ PATH: empty }).catch(
        err => err
      )) as ExecClaudeError;
      expect(e.code).toBe('ENOENT');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

// ── Il binario CLI che l'SDK si porta dentro (`@anthropic-ai/claude-agent-sdk-
// {platform}-{arch}/claude`, quello che `resolveClaudeExecutablePath()` punta
// nell'app pacchettizzata) è la versione che ClaudeLens *shippa*, non quella
// installata dall'utente: interrogarlo faceva dire "2.1.220" (SDK 0.3.220) a chi
// aveva 2.1.232. Quando le due divergono davvero su questa macchina, il test
// prova che leggiamo quella dell'utente. Skippa quando coincidono o quando una
// delle due non c'è (niente CLI nel PATH sui runner del job unit).
describe('readInstalledClaudeVersion vs CLI shippata dall’SDK', () => {
  const bundled = join(
    process.cwd(),
    'node_modules',
    '@anthropic-ai',
    `claude-agent-sdk-${process.platform}-${process.arch}`,
    process.platform === 'win32' ? 'claude.exe' : 'claude'
  );

  const versionOf = (exe: string): string | null => {
    try {
      const out = execFileSync(exe, ['--version'], { encoding: 'utf-8', timeout: 20_000 });
      return /(\d+\.\d+\.\d+)/.exec(out)?.[1] ?? null;
    } catch {
      return null;
    }
  };

  it('riporta la versione installata, non quella dentro il bundle', async () => {
    if (!existsSync(bundled)) return;
    const bundledVersion = versionOf(bundled);
    const installed = await readInstalledClaudeVersion(process.env).catch(() => null);
    if (!bundledVersion || !installed || bundledVersion === installed) return;
    expect(installed).not.toBe(bundledVersion);
  }, 45_000);
});

// ── E2E (matrix win/linux/mac, vera CLI installata — vedi ci.yml
// `terminal-integration`): su Windows prova che cross-spawn risolve
// `claude.cmd`, il cuore di #60. `--version` non richiede auth.
describe.skipIf(!E2E)('claude-cli (real claude CLI)', () => {
  it('execClaude esegue `claude --version`', async () => {
    const { stdout } = await execClaude(['--version']);
    expect(stdout).toMatch(/\d+\.\d+\.\d+/);
  }, 35_000);

  it('spawnClaude streama stdout ed esce 0', async () => {
    const proc = spawnClaude(['--version']);
    let out = '';
    proc.stdout?.on('data', (c: Buffer) => {
      out += c.toString();
    });
    const code = await new Promise<number | null>((resolve, reject) => {
      proc.on('error', reject);
      proc.on('close', resolve);
    });
    expect(code).toBe(0);
    expect(out).toMatch(/\d+\.\d+\.\d+/);
  }, 35_000);
});
