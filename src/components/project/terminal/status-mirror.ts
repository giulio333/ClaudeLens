// The open sessions as the menu bar and the Dock read them
// (`electron/shared/status-surface.ts`): what each tab already draws, from the
// same places — the tone a tab remembers (held across a registry reading that
// missed the entry, `heldTone`), the registry's `waitingFor` for a question,
// and the "not seen yet" mark.

import type { StatusSummary } from '../../../../electron/shared/status-surface';
import type { ActiveSession } from '../../../types';
import { showsUnseen, type AttentionState } from './tab-attention';
import {
  asksQuestion,
  chipTone,
  instanceProjectName,
  instanceTitle,
  registryEntryFor,
  type TerminalInstance,
} from './terminal-instances';

export function statusSummary(
  instances: readonly TerminalInstance[],
  registry: readonly ActiveSession[] | undefined,
  attention: AttentionState
): StatusSummary {
  return {
    rows: instances.map(inst => {
      const remembered = attention.byId[inst.id];
      const tone = remembered?.tone ?? chipTone(inst.report, registry);
      const entry = registryEntryFor(inst.report, registry);
      return {
        id: inst.id,
        title: instanceTitle(inst),
        project: instanceProjectName(inst),
        tone,
        question: tone === 'waiting' && asksQuestion(entry?.waitingFor),
        unseen: showsUnseen(remembered, tone),
      };
    }),
  };
}
