import { useState } from 'react';
import {
  Skill,
  SkillFile,
  SkillFileRole,
  useSkillFile,
  useWriteSkillFile,
  useOpenSkillFile,
} from '../../../hooks/useIPC';
import { Lens } from '../overview/Lens';
import { TopBar } from '../shared/TopBar';
import { FileIcon } from '../chat/fileIcons';
import { fileExt } from '../chat/utils';
import Markdown from '../../Markdown';

// Display order + labels for the role buckets. Referenced files float to the top
// of each bucket (the reader already sorted `skill.files` that way).
const ROLE_ORDER: SkillFileRole[] = [
  'doc',
  'script',
  'template',
  'asset',
  'extension',
  'eval',
  'meta',
];
const ROLE_LABEL: Record<SkillFileRole, string> = {
  doc: 'Reference docs',
  script: 'Scripts',
  template: 'Templates',
  asset: 'Assets',
  extension: 'Extensions',
  eval: 'Evals',
  meta: 'Other files',
};

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileTile({
  glyph,
  name,
  desc,
  meta,
  accent,
  dense,
  onOpen,
}: {
  glyph: React.ReactNode;
  name: React.ReactNode;
  desc?: React.ReactNode;
  meta?: React.ReactNode;
  accent?: boolean;
  dense?: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={`cl-tile ${accent ? 'accent' : ''} ${dense ? 'cl-tile--file' : ''}`}
      onClick={onOpen}
    >
      <span className="glyph">{glyph}</span>
      <div style={{ minWidth: 0 }}>
        <div className="t-name">{name}</div>
        {desc && <div className="t-desc">{desc}</div>}
      </div>
      {meta && <span className="t-meta">{meta}</span>}
    </button>
  );
}

/**
 * Landing page for a skill: a file explorer. SKILL.md is the primary card
 * (opens the manifest editor); supporting files are grouped by role (open the
 * lightweight read/edit view).
 */
export function SkillExplorer({
  skill,
  onBack,
  onOpenManifest,
  onOpenFile,
}: {
  skill: Skill;
  onBack: () => void;
  onOpenManifest: () => void;
  onOpenFile: (f: SkillFile) => void;
}) {
  const files = skill.files ?? [];
  const groups = ROLE_ORDER.map(role => ({
    role,
    items: files.filter(f => f.role === role),
  })).filter(g => g.items.length > 0);
  const scope =
    skill.scope === 'global' ? 'Global' : skill.scope === 'plugin' ? 'Plugin' : 'Project';

  const meta: string[] = [scope];
  if (skill.model) meta.push(skill.model);
  meta.push(
    files.length === 0 ? 'no extra files' : `${files.length} file${files.length === 1 ? '' : 's'}`
  );

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>
      <TopBar onBack={onBack} crumbs={[{ label: 'Skills' }, { label: skill.name, accent: true }]} />

      <div className="flex-1 overflow-y-auto">
        <section className="cl-hero">
          <Lens />
          <div className="cl-eyebrow">
            <span className="pip" />
            <span>{scope} · skill</span>
          </div>
          <h1 className="cl-h-name static">
            <span className="label-name">{skill.name}</span>
            <span className="glyph">/</span>
          </h1>
          {skill.description && (
            <p style={{ color: 'var(--cl-ink-3)', fontSize: 14, maxWidth: 720, marginTop: 8 }}>
              {skill.description}
            </p>
          )}
          <div className="cl-h-meta">
            {meta.map((m, i) => (
              <span key={m}>
                {i > 0 && <span className="sep">·</span>} {m}
              </span>
            ))}
          </div>
        </section>

        <section className="cl-section">
          <div className="cl-sec-head">
            <h2>Manifest</h2>
          </div>
          <div className="cl-tile-grid cl-tile-grid--list">
            <FileTile
              glyph={<FileIcon ext="md" />}
              name="SKILL.md"
              desc="Skill instructions · frontmatter + body"
              accent
              onOpen={onOpenManifest}
            />
          </div>
        </section>

        {groups.map(({ role, items }) => (
          <section className="cl-section" key={role}>
            <div className="cl-sec-head">
              <h2>{ROLE_LABEL[role]}</h2>
              <span className="ct">{items.length}</span>
            </div>
            <div className="cl-tile-grid">
              {items.map(f => (
                <FileTile
                  key={f.relPath}
                  dense
                  glyph={<FileIcon ext={fileExt(f.relPath)} />}
                  name={
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {f.relPath}
                      </span>
                      {f.referenced && <span className="cl-skill-ref-tag">referenced</span>}
                    </span>
                  }
                  meta={`${fmtSize(f.size)}${!f.isText ? ' · binary' : ''}`}
                  onOpen={() => onOpenFile(f)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/** Inline view/edit of a single supporting file (drill from the explorer). */
export function SkillFileDetail({
  skill,
  file,
  onBack,
  readOnly = false,
}: {
  skill: Skill;
  file: SkillFile;
  onBack: () => void;
  readOnly?: boolean;
}) {
  const { data: content, isLoading } = useSkillFile(skill.path, file);
  const write = useWriteSkillFile();
  const openExt = useOpenSkillFile();
  // `draft` holds the in-edit buffer; null means "not editing". Seeded from the
  // loaded content at the moment Edit is pressed (no content→state effect).
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;

  const ext = fileExt(file.relPath);
  const isMarkdown = ext === 'md' || ext === 'mdx';
  const dirty = editing && draft !== (content ?? '');

  const save = async () => {
    if (draft === null) return;
    await write.mutateAsync({ skillPath: skill.path, relPath: file.relPath, content: draft });
    setDraft(null);
  };

  const right = file.isText ? (
    editing ? (
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="cl-btn-ghost" onClick={() => setDraft(null)}>
          Discard
        </button>
        <button
          type="button"
          className="cl-btn-solid"
          disabled={!dirty || write.isPending}
          onClick={save}
        >
          Save
        </button>
      </div>
    ) : (
      !readOnly &&
      content !== undefined &&
      content !== null && (
        <button type="button" className="cl-btn-ghost" onClick={() => setDraft(content)}>
          Edit
        </button>
      )
    )
  ) : (
    <button
      type="button"
      className="cl-btn-ghost"
      onClick={() => openExt.mutate({ skillPath: skill.path, relPath: file.relPath })}
    >
      Open externally
    </button>
  );

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>
      <TopBar
        onBack={onBack}
        crumbs={[{ label: skill.name }, { label: file.relPath, accent: true }]}
        right={right || undefined}
      />
      <div className="flex-1 overflow-y-auto">
        <section className="cl-section">
          <div className="cl-sec-head">
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FileIcon ext={ext} />
              {file.relPath}
            </h2>
            <span className="ct">
              {ROLE_LABEL[file.role]} · {fmtSize(file.size)}
            </span>
          </div>

          {!file.isText ? (
            <div className="cl-empty">
              Binary / non-text file — open it in the default app to inspect.
            </div>
          ) : isLoading ? (
            <div className="cl-empty">Loading…</div>
          ) : editing ? (
            <textarea
              className="cl-skill-file-editor"
              value={draft ?? ''}
              onChange={e => setDraft(e.target.value)}
              spellCheck={false}
            />
          ) : isMarkdown ? (
            <div className="prose">
              <Markdown>{content ?? ''}</Markdown>
            </div>
          ) : (
            <div className="prose">
              <Markdown>{'```' + (ext || '') + '\n' + (content ?? '') + '\n```'}</Markdown>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
