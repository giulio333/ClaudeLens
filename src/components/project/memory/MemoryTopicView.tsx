import { useMemo, useState } from 'react';
import { MemoryTopic, SessionSummary, TopicInput } from '../../../hooks/useIPC';
import {
  useUpdateTopic,
  useDeleteTopic,
  useSessionList,
  useMemoryProject,
} from '../../../hooks/useIPC';
import { MemoryOrbit } from './MemoryOrbit';
import { EntityDetailView, EntityConfig } from '../shared/EntityDetailView';
import {
  MEMORY_OPTION_DEFS,
  readOptions,
  serializeMemory,
  initialOf,
} from '../shared/entityOptions';
import { parseMemoryContent, readingTime, formatDate } from './utils';
import { useMemoryTags } from '../../../hooks/useMemoryTags';
import { ManagedTagChip } from '../sessions/ManagedTagChip';
import { TagPicker } from '../sessions/TagPicker';

const TYPE_LABEL: Record<string, string> = {
  user: 'User',
  feedback: 'Feedback',
  project: 'Project',
  reference: 'Reference',
};

/** Estrae name/description/type/body dal markdown grezzo con frontmatter YAML. */
function parseTopicInput(raw: string, fallback: MemoryTopic): TopicInput {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  let name = fallback.name;
  let description = fallback.description;
  let type: TopicInput['type'] = fallback.type;
  let body = raw;

  let originSessionId = fallback.originSessionId;

  if (m) {
    const fm = m[1];
    const get = (k: string) =>
      fm
        .match(new RegExp(`^\\s*${k}:\\s*(.*)$`, 'm'))?.[1]
        ?.trim()
        .replace(/^["']|["']$/g, '');
    name = get('name') ?? name;
    description = get('description') ?? description;
    const t = get('type');
    if (t === 'user' || t === 'feedback' || t === 'project' || t === 'reference') type = t;
    originSessionId = get('originSessionId') ?? originSessionId;
    body = raw.slice(m[0].length);
  }

  return { name, description, type, content: body, originSessionId };
}

/**
 * Tag *gestiti* di una memoria: NON sono frontmatter, vivono nel managed-tag
 * store (`useMemoryTags`, localStorage namespaced per filename, con
 * rename/delete cross-topic). Resi sia in view che in edit dentro la superficie
 * unificata. Componente self-contained (istanziato indipendentemente nei due
 * slot): lo store è event-synced, quindi le istanze restano coerenti.
 */
function MemoryTags({ hash, filename }: { hash: string; filename: string }) {
  const { tags, tagsForMemory, toggleTagOnMemory, renameTag, deleteTag } = useMemoryTags(hash);
  const [pickerAnchor, setPickerAnchor] = useState<DOMRect | null>(null);
  const topicTags = tagsForMemory(filename);

  return (
    <div className="cl-mem-tags">
      {topicTags.map(name => (
        <ManagedTagChip
          key={name}
          name={name}
          onRemoveFromItem={() => toggleTagOnMemory(filename, name)}
          removeLabel="Remove from this topic"
          onRename={renameTag}
          onDelete={() => deleteTag(name)}
        />
      ))}
      <button
        type="button"
        className="cl-mem-tag-add"
        onClick={e => {
          // Cattura il rect in modo sincrono: React azzera `currentTarget`
          // quando l'handler ritorna, leggerlo nell'updater (più tardi) lancia.
          const rect = e.currentTarget.getBoundingClientRect();
          setPickerAnchor(prev => (prev ? null : rect));
        }}
      >
        + Add
      </button>
      {pickerAnchor && (
        <TagPicker
          anchorRect={pickerAnchor}
          allTags={tags}
          selected={topicTags}
          onToggle={name => toggleTagOnMemory(filename, name)}
          onClose={() => setPickerAnchor(null)}
        />
      )}
    </div>
  );
}

/**
 * Riga "Origin session": la sessione che ha generato la memoria. Se esiste
 * ancora nel progetto è un link alla chat; altrimenti degrada a id mono.
 */
function OriginValue({
  sessionId,
  session,
  onOpen,
}: {
  sessionId: string;
  session?: SessionSummary;
  onOpen?: (session: SessionSummary) => void;
}) {
  if (session && onOpen) {
    const title = session.customTitle ?? session.aiTitle ?? sessionId.slice(0, 8);
    return (
      <button
        type="button"
        onClick={() => onOpen(session)}
        className="cl-mem-origin-link"
        title={`Open chat · ${sessionId}`}
      >
        {title}
      </button>
    );
  }
  return (
    <span className="cl-mem-meta-mono" title="Session not found in this project">
      {sessionId}
    </span>
  );
}

/** Blocco "Metadata" in view mode: tag gestiti, sessione origine, date, file. */
function MemoryMetaPanel({
  topic,
  hash,
  originSession,
  onOpenSession,
  readOnly,
}: {
  topic: MemoryTopic;
  hash: string;
  originSession?: SessionSummary;
  onOpenSession?: (session: SessionSummary) => void;
  readOnly: boolean;
}) {
  const createdAt = topic.createdAt ?? null;
  const updatedAt = topic.updatedAt ?? null;
  const sameDate =
    createdAt && updatedAt ? createdAt.slice(0, 10) === updatedAt.slice(0, 10) : true;

  return (
    <div className="cl-entity-v2-opts">
      <h3>
        <span>Metadata</span>
        <b>tags · origin · dates</b>
      </h3>
      <div className="cl-mem-meta">
        <div className="cl-mem-meta-row">
          <div className="k">Tags</div>
          <div className="v">
            <MemoryTags hash={hash} filename={topic.filename} />
          </div>
        </div>
        {topic.originSessionId && (
          <div className="cl-mem-meta-row">
            <div className="k">Origin session</div>
            <div className="v">
              <OriginValue
                sessionId={topic.originSessionId}
                session={originSession}
                onOpen={onOpenSession}
              />
            </div>
          </div>
        )}
        {createdAt && (
          <div className="cl-mem-meta-row">
            <div className="k">Created</div>
            <div className="v">{formatDate(createdAt)}</div>
          </div>
        )}
        {updatedAt && !sameDate && (
          <div className="cl-mem-meta-row">
            <div className="k">Updated</div>
            <div className="v">{formatDate(updatedAt)}</div>
          </div>
        )}
        <div className="cl-mem-meta-row">
          <div className="k">File</div>
          <div className="v">
            <span className="cl-mem-meta-mono">{topic.filename}</span>
          </div>
        </div>
        {readOnly && (
          <div className="cl-mem-meta-row">
            <div className="k">Source</div>
            <div className="v">Committed to repo · read-only</div>
          </div>
        )}
      </div>
    </div>
  );
}

export function MemoryTopicView({
  topic,
  content,
  hash,
  onBack,
  onOpenSession,
  onOpenTopic,
}: {
  topic: MemoryTopic;
  content: string;
  hash: string;
  onBack: () => void;
  onOpenSession?: (session: SessionSummary) => void;
  onOpenTopic?: (topic: MemoryTopic, content: string) => void;
}) {
  const { body, wordCount, linkCount } = parseMemoryContent(content);
  const updateMut = useUpdateTopic(hash);
  const deleteMut = useDeleteTopic(hash);

  // Le altre memorie del progetto: servono all'orbita per sapere chi cita
  // questa. Stessa queryKey della lista, quindi già in cache — nessuna fetch.
  const { data: memory } = useMemoryProject(hash);
  const allTopics = useMemo(
    () => [...(memory?.index ?? []), ...(memory?.projectLevelIndex ?? [])],
    [memory]
  );
  const allContents = useMemo(
    () => ({ ...(memory?.topics ?? {}), ...(memory?.projectLevelTopics ?? {}) }),
    [memory]
  );

  // Risolve la sessione che ha generato la memoria (originSessionId = UUID del
  // file .jsonl nello stesso progetto). La lista è già in cache (stessa
  // queryKey della vista Sessions), quindi nessuna fetch extra.
  const { data: sessions } = useSessionList(topic.originSessionId ? hash : null);
  const originSession = topic.originSessionId
    ? sessions?.find(s => s.filename === `${topic.originSessionId}.jsonl`)
    : undefined;

  const readOnly = !!topic.isProjectLevel;

  const config: EntityConfig = {
    kind: 'memory',
    name: topic.name,
    titleGlyph: '.md',
    scopeLabel: 'Project',
    path: `memory/${topic.filename}`,
    description: topic.description || undefined,
    eyebrow: `${topic.type} · memory/${topic.filename}`,
    kindLabel: 'memory',
    backLabel: 'Memory',
    crumbs: [{ label: TYPE_LABEL[topic.type] ?? topic.type }, { label: topic.name, accent: true }],
    neutralTint: true,
    initial: initialOf(topic.name),
    tape: [
      { label: 'Type', value: TYPE_LABEL[topic.type] ?? topic.type },
      { label: 'Reading', value: readingTime(wordCount) },
      { label: 'Words', value: String(wordCount), mono: true },
      { label: 'Links', value: String(linkCount), mono: true },
    ],
    bodyLabel: 'Topic body · markdown',
    optionDefs: MEMORY_OPTION_DEFS,
    initialOptions: readOptions(topic as unknown as Record<string, unknown>, MEMORY_OPTION_DEFS),
    body,
    hasDescriptionField: true,
    descriptionValue: topic.description ?? '',
    coreRows: [{ label: 'name', value: topic.name }],
    // `type` è già nella tape + editabile in edit mode; in view i metadata
    // (tags/origin/dates) sono nel blocco `viewExtras`, quindi niente tile.
    hideViewProperties: true,
    serialize: ({ body: b, description, options }) =>
      serializeMemory(topic, b, { description, options }),
    editable: !readOnly,
    deletable: !readOnly,
    duplicable: false,
    runnable: false,
    emptyMessage: 'No content yet.',
    // Managed tags: editabili anche su memorie read-only (sono metadata d'app,
    // non contenuto del file committato).
    editExtras: (
      <>
        <h2 style={{ marginTop: 22 }}>
          <span>Tags</span>
          <b>managed · not frontmatter</b>
        </h2>
        <div className="cl-entity-edit-v2-card" style={{ padding: '14px 16px' }}>
          <MemoryTags hash={hash} filename={topic.filename} />
        </div>
      </>
    ),
    viewExtras: (
      <>
        {onOpenTopic && (
          <MemoryOrbit
            topic={topic}
            topics={allTopics}
            contents={allContents}
            onOpenTopic={t => onOpenTopic(t, allContents[t.filename] ?? '')}
          />
        )}
        <MemoryMetaPanel
          topic={topic}
          hash={hash}
          originSession={originSession}
          onOpenSession={onOpenSession}
          readOnly={readOnly}
        />
      </>
    ),
  };

  return (
    <EntityDetailView
      config={config}
      onBack={onBack}
      onSave={
        readOnly
          ? undefined
          : async raw => {
              await updateMut.mutateAsync({
                filename: topic.filename,
                input: parseTopicInput(raw, topic),
              });
            }
      }
      onDelete={
        readOnly
          ? undefined
          : async () => {
              await deleteMut.mutateAsync(topic.filename);
            }
      }
    />
  );
}
