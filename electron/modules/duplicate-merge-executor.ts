import {
  readFileSync,
  readdirSync,
  writeFileSync,
  copyFileSync,
  renameSync,
  unlinkSync,
  rmSync,
  mkdirSync,
  existsSync,
  statSync,
  utimesSync,
  cpSync,
} from 'fs';
import { join, dirname } from 'path';
import { computeMergePlan, MergePlan } from './duplicate-merger';

export interface MergeResult {
  movedSessions: number;
  renamedSessions: number;
  movedSidecars: number;
  cwdRewrittenFiles: number;
  memoryCopied: number;
  memoryRenamed: number;
  memorySkipped: number;
  sourceDeleted: boolean;
  backupPath: string;
  warnings: string[];
}

/**
 * Riscrive in modo field-scoped il solo campo top-level `cwd` di ogni riga JSONL,
 * e soltanto quando vale esattamente `from` (la root della source): così non tocca
 * eventuali cwd inattesi e lascia intatte le righe malformate.
 */
function rewriteCwd(content: string, from: string, to: string): { text: string; changed: boolean } {
  let changed = false;
  const out = content.split('\n').map(line => {
    if (!line || line.indexOf('"cwd"') === -1) return line;
    try {
      const obj = JSON.parse(line);
      if (obj.cwd === from) {
        obj.cwd = to;
        changed = true;
        return JSON.stringify(obj);
      }
    } catch {
      // riga malformata → invariata
    }
    return line;
  });
  return { text: out.join('\n'), changed };
}

/** Sposta una directory; se source e dest sono su volumi diversi (EXDEV) ricade su copia+rimozione. */
function moveDir(srcPath: string, destPath: string): void {
  try {
    renameSync(srcPath, destPath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EXDEV') {
      cpSync(srcPath, destPath, { recursive: true });
      rmSync(srcPath, { recursive: true, force: true });
    } else {
      throw e;
    }
  }
}

/** Scrive atomico (tmp + rename nella stessa dir) e replica l'mtime di origine. */
function writeAtomicPreservingMtime(srcPath: string, destPath: string, content: string): void {
  const tmp = `${destPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, content, 'utf-8');
  renameSync(tmp, destPath);
  try {
    const st = statSync(srcPath);
    utimesSync(destPath, st.atime, st.mtime);
  } catch {
    // se non riusciamo a leggere/replicare l'mtime, non è bloccante
  }
}

function descriptionFor(filename: string, sourceMemDir: string, sourceIndexLines: string[]): string {
  // 1) riga indice della source che referenzia il file
  const line = sourceIndexLines.find(l => l.includes(`(${filename})`));
  if (line) {
    const m = line.match(/—\s*(.*)$/) || line.match(/-\s*(.*)$/);
    if (m && m[1]) return m[1].trim();
  }
  // 2) frontmatter description del topic
  try {
    const content = readFileSync(join(sourceMemDir, filename), 'utf-8');
    const fm = content.match(/^---\n([\s\S]*?)\n---/);
    const d = fm && fm[1].match(/^description:\s*(.*)$/m);
    if (d && d[1]) return d[1].trim();
  } catch {
    /* ignore */
  }
  return '';
}

function appendIndexLine(memoryMdPath: string, filename: string, description: string): void {
  const line = `- [${filename}](${filename}) — ${description}`;
  if (existsSync(memoryMdPath)) {
    const current = readFileSync(memoryMdPath, 'utf-8');
    if (current.includes(`(${filename})`)) return; // idempotente: riga già presente
    writeFileSync(memoryMdPath, current.replace(/\s*$/, '') + '\n' + line + '\n', 'utf-8');
  } else {
    writeFileSync(memoryMdPath, `# Memory Index\n\n${line}\n`, 'utf-8');
  }
}

/** Riscrive il campo `name:` del frontmatter al nuovo slug (per i conflict-rename). */
function rewriteFrontmatterName(content: string, newSlug: string): string {
  return content.replace(/^(---\n)([\s\S]*?)(\n---)/, (_full, open, body, close) => {
    const newBody = body.replace(/^name:[ \t]*.*$/m, `name: ${newSlug}`);
    return `${open}${newBody}${close}`;
  });
}

/**
 * Esegue il merge della cartella source dentro la dest applicando il piano.
 * Distruttivo: crea prima un backup completo della source (fuori da projects/),
 * poi sposta sessioni (con cwd rewrite) e i loro sidecar, fonde memory/, aggiorna
 * l'indice e — solo se la source resta effettivamente vuota — la elimina.
 *
 * In caso di errore a metà operazione esegue un **rollback best-effort**: rimuove
 * ciò che ha creato nella dest, ripristina MEMORY.md e ricostruisce la source dal
 * backup, così non resta uno stato ibrido. Il chiamante (main.ts) mette in pausa il
 * watcher e notifica un solo refresh al termine.
 */
export function executeMerge(projectsDir: string, sourceHash: string, destHash: string): MergeResult {
  // ── Ricalcola il piano (TOCTOU): lo stato su disco potrebbe essere cambiato ──
  const plan: MergePlan = computeMergePlan(projectsDir, sourceHash, destHash);
  if (plan.blockers.length > 0) {
    throw new Error(`Merge blocked: ${plan.blockers.join('; ')}`);
  }

  const sourceDir = join(projectsDir, sourceHash);
  const destDir = join(projectsDir, destHash);

  // ── Backup completo della source, fuori dalla dir watchata da chokidar ──
  const backupRoot = join(dirname(projectsDir), '.claudelens-backups');
  mkdirSync(backupRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(backupRoot, `${sourceHash}__${stamp}`);
  cpSync(sourceDir, backupPath, { recursive: true });

  const warnings = [...plan.warnings];

  // ── Stato per il rollback ──────────────────────────────────────────────────────
  const sourceMemDir = join(sourceDir, 'memory');
  const destMemDir = join(destDir, 'memory');
  const memoryMdPath = join(destMemDir, 'MEMORY.md');
  const createdInDest: string[] = []; // percorsi creati nella dest, da rimuovere su rollback
  const destMemDirExisted = existsSync(destMemDir);
  const destMemoryMdExisted = existsSync(memoryMdPath);
  const destMemoryMdOriginal = destMemoryMdExisted ? readFileSync(memoryMdPath, 'utf-8') : null;

  function rollback(): void {
    for (const p of [...createdInDest].reverse()) {
      try { rmSync(p, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
    try {
      if (!destMemDirExisted) {
        rmSync(destMemDir, { recursive: true, force: true });
      } else if (destMemoryMdExisted && destMemoryMdOriginal !== null) {
        writeFileSync(memoryMdPath, destMemoryMdOriginal, 'utf-8');
      } else if (!destMemoryMdExisted && existsSync(memoryMdPath)) {
        rmSync(memoryMdPath, { force: true });
      }
    } catch { /* best-effort */ }
    try {
      rmSync(sourceDir, { recursive: true, force: true });
      cpSync(backupPath, sourceDir, { recursive: true });
    } catch { /* best-effort: il backup resta comunque disponibile */ }
  }

  let movedSessions = 0;
  let renamedSessions = 0;
  let cwdRewrittenFiles = 0;
  let movedSidecars = 0;
  let memoryCopied = 0;
  let memoryRenamed = 0;
  let memorySkipped = 0;

  try {
    // ── Sessioni ─────────────────────────────────────────────────────────────────
    for (const s of plan.sessions) {
      const srcPath = join(sourceDir, s.filename);
      const destPath = join(destDir, s.targetName);
      let content = readFileSync(srcPath, 'utf-8');
      if (plan.cwdRewrite) {
        const r = rewriteCwd(content, plan.cwdRewrite.from, plan.cwdRewrite.to);
        content = r.text;
        if (r.changed) cwdRewrittenFiles += 1;
      }
      writeAtomicPreservingMtime(srcPath, destPath, content);
      createdInDest.push(destPath);
      unlinkSync(srcPath);
      movedSessions += 1;
      if (s.collides) renamedSessions += 1;
    }

    // ── Directory sidecar di sessione (tool-results/, subagents/, …) ───────────────
    for (const sc of plan.sidecars) {
      if (sc.collides) continue; // già avvisato nel piano: non sovrascrivere la dest
      const destSidecar = join(destDir, sc.name);
      moveDir(join(sourceDir, sc.name), destSidecar);
      createdInDest.push(destSidecar);
      movedSidecars += 1;
    }

    // ── Memory ─────────────────────────────────────────────────────────────────────
    const sourceIndexLines = (() => {
      try {
        return readFileSync(join(sourceMemDir, 'MEMORY.md'), 'utf-8').split('\n');
      } catch {
        return [];
      }
    })();
    const hasMemoryWork = plan.memory.some(m => m.kind === 'copy' || m.kind === 'conflict-rename');
    if (hasMemoryWork && !destMemDirExisted) mkdirSync(destMemDir, { recursive: true });

    for (const m of plan.memory) {
      if (m.kind === 'identical') {
        memorySkipped += 1;
        continue;
      }
      const srcPath = join(sourceMemDir, m.filename);
      const desc = descriptionFor(m.filename, sourceMemDir, sourceIndexLines);
      if (m.kind === 'copy') {
        const dest = join(destMemDir, m.filename);
        copyFileSync(srcPath, dest);
        createdInDest.push(dest);
        appendIndexLine(memoryMdPath, m.filename, desc);
        memoryCopied += 1;
      } else if (m.kind === 'conflict-rename' && m.targetName) {
        const newSlug = m.targetName.replace(/\.md$/, '');
        const content = rewriteFrontmatterName(readFileSync(srcPath, 'utf-8'), newSlug);
        const dest = join(destMemDir, m.targetName);
        writeFileSync(dest, content, 'utf-8');
        createdInDest.push(dest);
        appendIndexLine(memoryMdPath, m.targetName, desc);
        memoryRenamed += 1;
      }
    }

    // ── Cleanup source ──────────────────────────────────────────────────────────────
    // Recheck reale (non il valore pre-merge del piano): tutte le sessioni e i sidecar
    // spostabili sono stati consumati, e memory/ è stata fusa nella dest. La source è
    // cancellabile solo se non resta nient'altro oltre a memory/ e .DS_Store.
    let remaining: string[] = [];
    try {
      remaining = readdirSync(sourceDir).filter(n => n !== '.DS_Store' && n !== 'memory');
    } catch { /* source assente: nessun residuo */ }

    let sourceDeleted = false;
    if (remaining.length === 0) {
      rmSync(sourceDir, { recursive: true, force: true });
      sourceDeleted = true;
    } else {
      warnings.push(`Source folder kept: still contains ${remaining.join(', ')}. Backup at ${backupPath}.`);
    }

    return {
      movedSessions,
      renamedSessions,
      movedSidecars,
      cwdRewrittenFiles,
      memoryCopied,
      memoryRenamed,
      memorySkipped,
      sourceDeleted,
      backupPath,
      warnings,
    };
  } catch (e) {
    rollback();
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Merge failed and was rolled back (backup at ${backupPath}): ${msg}`);
  }
}
