import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useWhatsNewSeenVersion, useMarkWhatsNewSeen } from '../hooks/useIPC';
import type { ChatMessage } from '../hooks/useIPC';
import { whatsNewFor, shouldShowWhatsNew, type WhatsNewHighlight } from '../data/whats-new';
import { MessageBubble } from './project/chat/MessageBubble';
import { SavedPrompt } from './project/chat/PromptPlaybook';
import type { PromptTemplate } from '../../electron/shared/playbook-types';
import type { ProcessedMessage } from './project/chat/utils';
import { version as appVersion } from '../../package.json';

function turn(msg: ChatMessage): ProcessedMessage {
  return { msg, toolGroups: [] };
}

// A short, ordinary exchange around the one new thing — the real transcript
// UI (`MessageBubble`, unmodified) is what makes this a preview rather than a
// screenshot: it can never drift from what the feature actually looks like.
const PREVIEW_TURNS: ProcessedMessage[] = [
  turn({
    uuid: 'wn-1',
    role: 'user',
    timestamp: '2026-09-17T14:28:00.000Z',
    content: [{ type: 'text', text: 'Any update on the migration?' }],
  }),
  turn({
    uuid: 'wn-2',
    role: 'assistant',
    model: 'claude-sonnet-5',
    timestamp: '2026-09-17T14:28:04.000Z',
    content: [{ type: 'text', text: "Still running — I'll let you know as soon as it's done." }],
  }),
  turn({
    uuid: 'wn-3',
    role: 'user',
    timestamp: '2026-09-17T14:32:00.000Z',
    content: [{ type: 'text', text: 'Migration is done, you can restart the tests.' }],
    inbound: { from: 'session', name: 'acme-b4', pid: 41213 },
  }),
];

function CrossSessionMessageVisual(): ReactNode {
  return (
    <div className="cl-whatsnew-frame">
      <div className="cl-transcript-inner">
        {PREVIEW_TURNS.map((processed, i) => (
          <MessageBubble
            key={processed.msg.uuid}
            processed={processed}
            detailsFilter="minimal"
            onOpenToolDetail={() => {}}
            turnIndex={12 + i}
          />
        ))}
      </div>
    </div>
  );
}

// Two ordinary templates, the way the panel lists them. Nothing here comes
// from the reader's own playbook: the popup must never mount the panel itself,
// which would query `playbook:*` and put their real prompts in a dialog they
// did not open.
const PREVIEW_TEMPLATES: PromptTemplate[] = [
  {
    id: 'wn-tpl-1',
    name: 'Review the diff',
    text: 'Review the pending diff for regressions, and say which ones you verified.',
    createdAt: '2026-09-15T09:10:00.000Z',
    updatedAt: '2026-09-15T09:10:00.000Z',
  },
  {
    id: 'wn-tpl-2',
    name: 'Explain a failing test',
    text: 'Run the failing test, then explain what it asserts and why it broke.',
    createdAt: '2026-09-16T17:02:00.000Z',
    updatedAt: '2026-09-16T17:02:00.000Z',
  },
];

function PromptPlaybookVisual(): ReactNode {
  return (
    <div className="cl-whatsnew-frame">
      <div className="cl-playbook">
        {PREVIEW_TEMPLATES.map(template => (
          <SavedPrompt
            key={template.id}
            template={template}
            busy={false}
            onUse={() => {}}
            onCopy={() => {}}
            onEdit={() => {}}
            onDelete={() => {}}
          />
        ))}
      </div>
    </div>
  );
}

const VISUALS: Record<NonNullable<WhatsNewHighlight['visual']>, () => ReactNode> = {
  'cross-session-message': CrossSessionMessageVisual,
  'prompt-playbook': PromptPlaybookVisual,
};

export function WhatsNewDialog() {
  const { data: seenVersion, isLoading } = useWhatsNewSeenVersion();
  const markSeen = useMarkWhatsNewSeen();
  const release = whatsNewFor(appVersion);

  const visible = !isLoading && shouldShowWhatsNew(appVersion, seenVersion ?? null, !!release);
  // Multiple highlights would need their own moment each; for now this only
  // ever renders the first one, and stays simple until a release needs more.
  const highlight = release?.highlights[0];

  return (
    <AnimatePresence>
      {visible && release && highlight && (
        <motion.div
          className="fixed inset-0 bg-black/45 flex items-center justify-center z-50 p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="What's new"
            className="cl-whatsnew-card"
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
          >
            <div className="cl-whatsnew-mark" aria-hidden="true">
              <img src="./brand-mark.png" alt="" />
            </div>
            <div className="cl-whatsnew-eyebrow">New in ClaudeLens {release.version}</div>
            <h2 className="cl-whatsnew-title">{highlight.title}</h2>
            <p className="cl-whatsnew-desc">{highlight.description}</p>

            {highlight.visual && VISUALS[highlight.visual]()}

            <button
              type="button"
              className="cl-hero-cta cl-whatsnew-ok"
              onClick={() => markSeen.mutate(appVersion)}
            >
              Got it
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
