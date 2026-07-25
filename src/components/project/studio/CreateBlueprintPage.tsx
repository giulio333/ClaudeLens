import { useState } from 'react';
import { useCreateBlueprint } from '../../../hooks/useIPC';
import type { Blueprint } from '../../../types';
import { TopBar } from '../shared/TopBar';
import {
  FieldHint,
  CharCounter,
  useCreateFormKeys,
  NAME_MAX,
  DESC_MAX,
} from '../shared/CreateFormKit';

const BLUEPRINT_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export function CreateBlueprintPage({
  onBack,
  onSaved,
}: {
  onBack: () => void;
  onSaved: (name: string) => void;
}) {
  const createBlueprint = useCreateBlueprint();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [goal, setGoal] = useState('');
  const [error, setError] = useState<string | null>(null);

  const nameError =
    name && !BLUEPRINT_NAME_RE.test(name)
      ? 'Lowercase letters, digits and dashes only — the name becomes the /command.'
      : null;
  const canSubmit = name.length > 0 && !nameError;

  async function submit() {
    if (!canSubmit) return;
    const blueprint: Blueprint = {
      name,
      description,
      version: '0.1.0',
      brief: { goal, inputs: [], expectedOutput: '', successCriteria: [], onError: '' },
      phases: [
        { title: 'Phase 1', nodes: [{ kind: 'step', step: { id: 'step-1', prompt: goal } }] },
      ],
    };
    try {
      await createBlueprint.mutateAsync(blueprint);
      onSaved(name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useCreateFormKeys({
    canSubmit,
    isLoading: createBlueprint.isPending,
    onSubmit: submit,
    onCancel: onBack,
  });

  const labelCls =
    'flex items-center font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--cl-ink-3)] mb-1.5';
  const inputCls =
    'w-full rounded-none border border-[var(--cl-line)] bg-[var(--cl-paper)] px-3 py-2 text-[13px] text-[var(--cl-ink)] placeholder:text-[var(--cl-ink-4)] outline-none focus:border-[var(--cl-ink)] transition-colors';

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>
      <TopBar onBack={onBack} crumbs={[{ label: 'Global · Agent Studio · New' }]} />

      <div className="flex-1 overflow-y-auto">
        <section className="cl-hero">
          <div className="cl-eyebrow">
            <span className="pip" />
            <span>New · Native workflow</span>
          </div>
          <h1 className="cl-h-name static">
            <span className="label-name">Workflow</span>
            <span className="glyph">.</span>
          </h1>
          <div className="cl-h-meta">
            <span>design a multi-agent workflow</span>
            <span className="sep">·</span>
            <span className="font-mono" style={{ fontSize: 12 }}>
              ~/.claude/workflows/&lt;name&gt;.js
            </span>
          </div>
        </section>

        <form
          onSubmit={e => {
            e.preventDefault();
            void submit();
          }}
          className="cl-section"
          style={{ paddingTop: 24, paddingBottom: 80, maxWidth: 720 }}
        >
          <div className="space-y-5">
            <div>
              <label className={labelCls}>
                <span>Name</span> <span className="text-[var(--cl-accent)] ml-1">*</span>
                <FieldHint text="Command-safe identifier: the workflow runs as /name from any Claude Code session. E.g.: release-triage" />
                <CharCounter n={name.length} max={NAME_MAX} accentVar="--cl-accent" />
              </label>
              <input
                className={inputCls + (nameError ? ' !border-[var(--cl-danger)]' : '')}
                placeholder="release-triage"
                value={name}
                onChange={e => setName(e.target.value)}
              />
              {nameError && (
                <p className="mt-1 font-mono text-[10px] text-[var(--cl-danger)]">{nameError}</p>
              )}
            </div>
            <div>
              <label className={labelCls}>
                <span>Description</span>
                <FieldHint text="One line on what this workflow produces. Becomes the workflow description shown by Claude Code." />
                <CharCounter n={description.length} max={DESC_MAX} accentVar="--cl-accent" />
              </label>
              <input
                className={inputCls}
                placeholder="triage a release diff → verdict + changelog draft"
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>
                <span>Goal · Brief</span>
                <FieldHint text="What the workflow should achieve. Seeds the brief and the first step — you refine everything in the editor." />
              </label>
              <textarea
                className={inputCls + ' min-h-[120px] resize-y'}
                placeholder="Given a release tag, triage the diff: inspect changes, audit security, produce a verdict."
                value={goal}
                onChange={e => setGoal(e.target.value)}
              />
            </div>

            {error && <p className="font-mono text-[11px] text-[var(--cl-danger)]">{error}</p>}

            <div className="flex items-center gap-3 pt-2">
              <button type="button" className="cl-btn" onClick={onBack}>
                Cancel
              </button>
              <button
                type="submit"
                className="cl-btn cl-btn--primary"
                disabled={!canSubmit || createBlueprint.isPending}
              >
                Create workflow
              </button>
              <span className="ml-auto font-mono text-[10px] text-[var(--cl-ink-4)]">
                ⌘↵ create · esc cancel
              </span>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
