import { useState } from 'react';
import {
  useAiCatalog,
  useAiSettings,
  useSetAiSettings,
  type AiSettingsPatch,
} from '../../../hooks/useIPC';
import {
  AI_EFFORTS,
  AI_LANGUAGES,
  AI_LENGTHS,
  AI_MODELS,
  DEFAULT_PROMPTS,
  MAX_LANGUAGE_CHARS,
  MAX_PROMPT_CHARS,
  validLanguage,
  type AiLength,
  type AiSettings,
  type InsightKind,
} from '../../../../electron/shared/ai-settings';
import { Block, OnOff, PrefRow } from './SettingsKit';

const LENGTH_LABEL: Record<AiLength, string> = {
  brief: 'Brief',
  standard: 'Standard',
  detailed: 'Detailed',
};
const PROMPT_LABEL: Record<InsightKind, string> = { summary: 'Summary', todos: 'To-dos' };
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const money = (n: number) => `$${n.toFixed(2)}`;

/** Settings → AI: what the Notes AI runs on and how it writes. */
export function AiSettingsTab() {
  const { data: s, error } = useAiSettings();
  const set = useSetAiSettings();
  // The rows seed local state (the free language) from what is stored, so they
  // mount only once it has been read.
  if (error) return <p className="set-dim">Couldn&apos;t read the AI settings: {error.message}</p>;
  if (!s) return <p className="set-dim">Loading…</p>;
  const save = set.save;
  const off = !s.enabled;
  return (
    <>
      <Block label="AI in ClaudeLens">
        <p className="set-block-hint">
          The AI button in a session&apos;s notes writes a summary or a to-do list from the session.
          A run sends the session&apos;s transcript to Anthropic through your Claude Code login, and
          only when you click. It reads no settings.json, so a provider or key set there (Bedrock,
          Vertex, a proxy) is not used.
        </p>
        <PrefRow
          label="Enable AI in ClaudeLens"
          hint={s.enabled ? 'The AI button shows in Notes.' : 'No AI button, nothing is sent.'}
        >
          <OnOff
            label="Enable AI in ClaudeLens"
            checked={s.enabled}
            onChange={v => save({ enabled: v })}
          />
        </PrefRow>
      </Block>
      <ModelBlock s={s} off={off} save={save} />
      <Block label="Prompts" note="the format and the language are added after yours">
        {(['summary', 'todos'] as InsightKind[]).map(kind => (
          <PromptRow key={kind} kind={kind} s={s} off={off} save={save} />
        ))}
      </Block>
    </>
  );
}

function ModelBlock({
  s,
  off,
  save,
}: {
  s: AiSettings;
  off: boolean;
  save: (patch: AiSettingsPatch) => void;
}) {
  const { data: prices } = useAiCatalog();
  const price = prices?.find(p => p.id === s.model);
  return (
    <Block label="How it writes">
      <PrefRow
        label="Model"
        off={off}
        hint={
          price
            ? `${money(price.inputPerM)} in · ${money(price.outputPerM)} out per million tokens`
            : undefined
        }
      >
        <Seg
          label="Model"
          options={AI_MODELS.map(m => ({ id: m.id, label: m.label }))}
          value={s.model}
          onPick={id => save({ model: id })}
        />
      </PrefRow>
      <PrefRow label="Effort" off={off} hint="How much the model thinks before it writes.">
        <Seg
          label="Effort"
          options={AI_EFFORTS.map(e => ({ id: e, label: cap(e) }))}
          value={s.effort}
          onPick={id => save({ effort: id })}
        />
      </PrefRow>
      <PrefRow label="Length" off={off} hint={`At most ${AI_LENGTHS[s.length]} lines per run.`}>
        <Seg
          label="Length"
          options={(Object.keys(AI_LENGTHS) as AiLength[]).map(l => ({
            id: l,
            label: LENGTH_LABEL[l],
          }))}
          value={s.length}
          onPick={id => save({ length: id })}
        />
      </PrefRow>
      <LanguageRow s={s} off={off} save={save} />
    </Block>
  );
}

function Seg<T extends string>({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: { id: T; label: string }[];
  value: T;
  onPick: (id: T) => void;
}) {
  return (
    <div className="cl-seg cl-seg--paper" role="group" aria-label={label}>
      {options.map(o => (
        <button
          key={o.id}
          type="button"
          className={value === o.id ? 'on' : undefined}
          aria-pressed={value === o.id}
          onClick={() => onPick(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function LanguageRow({
  s,
  off,
  save,
}: {
  s: AiSettings;
  off: boolean;
  save: (patch: AiSettingsPatch) => void;
}) {
  const listed =
    s.language === 'session' || (AI_LANGUAGES as readonly string[]).includes(s.language);
  const [other, setOther] = useState(!listed);
  const [draft, setDraft] = useState(listed ? '' : s.language);
  const [bad, setBad] = useState(false);
  return (
    <PrefRow
      label="Output language"
      off={off}
      hint={
        bad
          ? 'Letters, spaces and hyphens only, up to 40 characters.'
          : 'The prompts stay in English.'
      }
    >
      <div className="set-ai-lang">
        <select
          aria-label="Output language"
          value={other ? 'other' : s.language}
          onChange={e => {
            const v = e.target.value;
            setBad(false);
            if (v === 'other') return setOther(true);
            setOther(false);
            save({ language: v });
          }}
        >
          <option value="session">Same as the session</option>
          {AI_LANGUAGES.map(l => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
          <option value="other">Other…</option>
        </select>
        {other && (
          <input
            aria-label="Other language"
            value={draft}
            maxLength={MAX_LANGUAGE_CHARS}
            onChange={e => setDraft(e.target.value)}
            onBlur={() => {
              const v = draft.trim();
              const ok = v !== 'session' && validLanguage(v);
              setBad(!ok);
              if (ok && v !== s.language) save({ language: v });
            }}
          />
        )}
      </div>
    </PrefRow>
  );
}

function PromptRow({
  kind,
  s,
  off,
  save,
}: {
  kind: InsightKind;
  s: AiSettings;
  off: boolean;
  save: (patch: AiSettingsPatch) => void;
}) {
  const stored = s.prompts[kind];
  const label = PROMPT_LABEL[kind];
  // From the newest settings, not this render's: another row may have saved since.
  const write = (value: string | null) =>
    save(current => ({ prompts: { ...current.prompts, [kind]: value } }));
  return (
    <div className={`set-pref set-ai-prompt${off ? ' is-off' : ''}`}>
      <div className="txt">
        <div className="lbl">{label}</div>
        <textarea
          // Remounts on a reset or a save, so the box always shows what is stored.
          key={stored ?? 'default'}
          aria-label={`${label} prompt`}
          defaultValue={stored ?? DEFAULT_PROMPTS[kind]}
          maxLength={MAX_PROMPT_CHARS}
          rows={3}
          onBlur={e => {
            const v = e.target.value.trim();
            const next = v && v !== DEFAULT_PROMPTS[kind] ? e.target.value : null;
            if (next !== stored) write(next);
          }}
        />
      </div>
      <button
        type="button"
        className="cl-btn-ghost"
        aria-label={`Reset ${label} prompt to default`}
        disabled={stored === null}
        onClick={() => write(null)}
      >
        Reset to default
      </button>
    </div>
  );
}
