import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useWhatsNewSeenVersion, useMarkWhatsNewSeen } from '../hooks/useIPC';
import type { ChatMessage } from '../hooks/useIPC';
import { whatsNewFor, shouldShowWhatsNew, type WhatsNewHighlight } from '../data/whats-new';
import { MessageBubble } from './project/chat/MessageBubble';
import { PromptPlaybookPanel } from './project/chat/PromptPlaybook';
import type { PromptCandidate, PromptTemplate } from '../../electron/shared/playbook-types';
import { buildProcessedMessages, type ProcessedMessage } from './project/chat/utils';
import type { ArtifactPublish } from '../types';
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
  // The sender's half of the same conversation, drawn by the same one-line
  // component — which is the point of the pair being here.
  ...buildProcessedMessages([
    {
      uuid: 'wn-4',
      role: 'assistant',
      model: 'claude-sonnet-5',
      timestamp: '2026-09-17T14:32:06.000Z',
      content: [
        {
          type: 'tool_use',
          id: 'wn-send-1',
          name: 'SendMessage',
          input: {
            to: 'acme-b4',
            summary: 'Tests restarted, will report on the first failure.',
            message: 'Restarted the suite on your migration. I will report on the first failure.',
          },
        },
      ],
    },
    {
      uuid: 'wn-5',
      role: 'user',
      timestamp: '2026-09-17T14:32:07.000Z',
      content: [
        {
          type: 'tool_result',
          toolUseId: 'wn-send-1',
          content: '{"success":true}',
          isError: false,
          sent: { msgId: 'wn-msg-1', to: 'session' },
        },
      ],
    },
  ]),
];

/** A few turns of a transcript, drawn by the transcript's own components. */
function TranscriptFrame({ turns }: { turns: ProcessedMessage[] }): ReactNode {
  return (
    <div className="cl-whatsnew-frame">
      <div className="cl-transcript-inner">
        {turns.map((processed, i) => (
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

function CrossSessionMessageVisual(): ReactNode {
  return <TranscriptFrame turns={PREVIEW_TURNS} />;
}

// Two ordinary templates and one suggestion, handed to the panel as fixed
// contents. Nothing here comes from the reader's own playbook: the panel is
// the real one, drawn in the embedded form Mission Control's rail uses, and
// `preview` is what keeps it from querying `playbook:*` and putting their
// prompts in a dialog they did not open.
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

const PREVIEW_CANDIDATES: PromptCandidate[] = [
  {
    id: 'wn-cand-1',
    text: 'Run the test suite and fix whatever is red.',
    sessionCount: 4,
  },
];

function PromptPlaybookVisual(): ReactNode {
  return (
    <div className="cl-whatsnew-frame">
      <PromptPlaybookPanel
        projectHash=""
        id="whats-new-playbook"
        onUse={() => {}}
        onClose={() => {}}
        preview={{ templates: PREVIEW_TEMPLATES, candidates: PREVIEW_CANDIDATES }}
      />
    </div>
  );
}

// A page the `Artifact` tool published, drawn by the transcript itself: the
// turn is built with `buildProcessedMessages`, so what the popup shows is the
// card the reader will meet in a real session, result prose included.
const ARTIFACT_PAGE: ArtifactPublish = {
  id: 'wn-art-1',
  url: 'https://claude.ai/artifact/AbCdEf',
  title: 'Release checklist',
  updated: true,
  seq: 3,
  audience: 'owner',
  path: '/tmp/scratch/checklist.html',
};

const ARTIFACT_TURN: ProcessedMessage[] = buildProcessedMessages([
  {
    uuid: 'wn-a1',
    role: 'assistant',
    model: 'claude-sonnet-5',
    timestamp: '2026-09-18T18:41:00.000Z',
    content: [
      { type: 'text', text: 'Published the checklist — the link is on the card.' },
      {
        type: 'tool_use',
        id: 'wn-art-call',
        name: 'Artifact',
        input: { action: 'publish', description: 'Every step, in the order they run' },
      },
    ],
  },
  {
    uuid: 'wn-a2',
    role: 'user',
    timestamp: '2026-09-18T18:41:04.000Z',
    content: [
      {
        type: 'tool_result',
        toolUseId: 'wn-art-call',
        content:
          'Published /tmp/scratch/checklist.html at https://claude.ai/artifact/AbCdEf (Version 3)',
        isError: false,
        artifact: ARTIFACT_PAGE,
      },
    ],
  },
]);

function ArtifactVisual(): ReactNode {
  return <TranscriptFrame turns={ARTIFACT_TURN} />;
}

const VISUALS: Record<NonNullable<WhatsNewHighlight['visual']>, () => ReactNode> = {
  'cross-session-message': CrossSessionMessageVisual,
  'prompt-playbook': PromptPlaybookVisual,
  artifact: ArtifactVisual,
};

/** The card scrolls, and a card that opens on its first highlight gives no sign
 *  that two more are under the fold. This is that sign: a chevron pinned to the
 *  bottom of the scroll area that carries the reader to the next section and
 *  retires as soon as there is nothing left below — an affordance, not a
 *  decoration, so it is a real button and never appears when the card fits. */
function ScrollCue({ scroller }: { scroller: RefObject<HTMLDivElement | null> }) {
  const [more, setMore] = useState(false);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setMore(el.scrollHeight - el.clientHeight - el.scrollTop > 24);
    el.addEventListener('scroll', measure, { passive: true });
    // The first measurement rides the observer rather than the effect body: the
    // visuals are transcripts and a panel, which settle a frame or two after
    // mount, and a cue measured before that would decide the card does not
    // scroll and never come back.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [scroller]);

  function next() {
    const el = scroller.current;
    if (!el) return;
    const sections = [...el.querySelectorAll<HTMLElement>('.cl-whatsnew-item')];
    const target = sections.find(s => s.offsetTop > el.scrollTop + 24);
    const top = target ? target.offsetTop - 24 : el.scrollHeight;
    el.scrollTo({ top, behavior: 'smooth' });
  }

  return (
    <button
      type="button"
      className="cl-whatsnew-cue"
      hidden={!more}
      aria-label="Show what else is new"
      title="Show what else is new"
      onClick={next}
    >
      <span aria-hidden>▾</span>
    </button>
  );
}

export function WhatsNewDialog() {
  const { data: seenVersion, isLoading } = useWhatsNewSeenVersion();
  const markSeen = useMarkWhatsNewSeen();
  const release = whatsNewFor(appVersion);

  const visible = !isLoading && shouldShowWhatsNew(appVersion, seenVersion ?? null, !!release);
  // Every highlight gets its own moment: the first one is the hero the card
  // opens on, the rest follow as sections of the same scroll. A release that
  // authored one entry renders exactly as it did before.
  const highlights = release?.highlights ?? [];
  const card = useRef<HTMLDivElement>(null);

  return (
    <AnimatePresence>
      {visible && release && highlights.length > 0 && (
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
            ref={card}
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
          >
            <header className="cl-whatsnew-masthead">
              <div className="cl-whatsnew-mark" aria-hidden="true">
                <img src="./brand-mark.png" alt="" />
              </div>
              <div className="cl-whatsnew-eyebrow">ClaudeLens {release.version}</div>
              <h2 className="cl-whatsnew-title">What&rsquo;s new</h2>
            </header>

            {highlights.map(highlight => (
              <section key={highlight.title} className="cl-whatsnew-item">
                <div className="cl-whatsnew-copy">
                  <h3 className="cl-whatsnew-subtitle">{highlight.title}</h3>
                  <p className="cl-whatsnew-desc">{highlight.description}</p>
                  {highlight.where && <p className="cl-whatsnew-where">{highlight.where}</p>}
                </div>
                {highlight.visual && VISUALS[highlight.visual]()}
              </section>
            ))}

            <button
              type="button"
              className="cl-hero-cta cl-whatsnew-ok"
              onClick={() => markSeen.mutate(appVersion)}
            >
              Got it
            </button>
            <ScrollCue scroller={card} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
