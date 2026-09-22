import type { InitModel } from '../../../types';
import { fmtModel } from '../utils';

/** Model aliases the CLI resolves on `--model`. The empty value means "send no
 *  --model flag" → Claude Code falls back to its configured default. */
export const MODEL_ALIASES = ['sonnet', 'opus', 'haiku', 'fable'] as const;

export type ModelOption = { value: string; label: string };

/** A context marker (`opus[1m]`) is a setting on top of a model, not another model. */
function withoutMarker(id: string): string {
  return id.replace(/\[[^\]]*\]$/, '');
}

/**
 * The id an alias stands for today, from the CLI's own model list.
 *
 * An alias moves when a model ships, so a bare "Opus" said nothing about which
 * Opus a reply would run on — and with Opus 5.5 out, `opus` still resolved to
 * Opus 5. The list does not always carry the alias verbatim: it offered
 * `opus[1m]` for `opus`, and Fable only under its full id, so the row is found
 * by its value without the marker, else by the family its display name opens
 * with. No row, no version: the caller keeps the bare alias.
 */
export function resolveAlias(alias: string, models: InitModel[]): string | undefined {
  const row =
    models.find(m => withoutMarker(m.value) === alias) ??
    models.find(m => m.displayName.split(/\s/)[0].toLowerCase() === alias);
  return row?.resolvedModel ? withoutMarker(row.resolvedModel) : undefined;
}

/**
 * The composer's model choices: the session's own model on top, then the
 * aliases with the version each resolves to, then "Default" with the model a
 * turn sent without `--model` runs on (`init.model`, the project's effective
 * setting). An alias that resolves to the session's model would be a second
 * row with the same label, so one of the two goes: the alias, unless it is the
 * one selected — a reply sent on `opus` makes the session's model the id `opus`
 * resolved to, and dropping the pick would leave the chip with no label.
 */
export function composerModelOptions(
  inherited: string | undefined,
  init: { model: string; models: InitModel[] } | null | undefined,
  selected?: string
): ModelOption[] {
  const models = init?.models ?? [];
  let showInherited = !!inherited;
  const aliases = MODEL_ALIASES.flatMap(alias => {
    if (alias === inherited) return [];
    const resolved = resolveAlias(alias, models);
    if (resolved && inherited && resolved === withoutMarker(inherited)) {
      if (alias !== selected) return [];
      showInherited = false;
    }
    const label = resolved ? fmtModel(resolved) : alias[0].toUpperCase() + alias.slice(1);
    return [{ value: alias, label }];
  });
  return [
    ...(inherited && showInherited ? [{ value: inherited, label: fmtModel(inherited) }] : []),
    ...aliases,
    { value: '', label: init?.model ? `Default · ${fmtModel(init.model)}` : 'Default' },
  ];
}
