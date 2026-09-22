import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useWhatsNewSeenVersion, useMarkWhatsNewSeen } from '../hooks/useIPC';
import type { ChatMessage } from '../hooks/useIPC';
import {
  latestWhatsNew,
  onOpenWhatsNew,
  releasesBefore,
  releasesBetween,
  shouldShowWhatsNew,
  whatsNewFor,
  type WhatsNewHighlight,
  type WhatsNewRelease,
} from '../data/whats-new';
import { MessageBubble } from './project/chat/MessageBubble';
import { PromptPlaybookPanel } from './project/chat/PromptPlaybook';
import { ContextRail } from './project/chat/ContextRail';
import { contextFiles } from './project/chat/context-files';
import { ComposerSelect } from './project/chat/ChatComposer';
import { composerModelOptions } from './project/chat/model-options';
import type { InitModel } from '../types';
import type { PromptCandidate, PromptTemplate } from '../../electron/shared/playbook-types';
import { buildProcessedMessages, type ProcessedMessage } from './project/chat/utils';
import type { ArtifactPublish } from '../types';
import { TopBar } from './project/shared/TopBar';
import {
  SessionBottomGlow,
  SessionColorFrame,
  SessionColorIdentity,
} from './project/shared/SessionColorIdentity';
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

// A screenshot pasted into a prompt, as the transcript carries it: an `image`
// block beside the `[Image #1]` placeholder. The picture is a synthetic 320×200
// PNG drawn for this popup (a sidebar, a title, a button — nothing from anyone's
// real work), inline so the dialog never reads a file: the path form goes
// through `images:read`, and a path answers "file is gone" on every machine
// but the one it was written on.
const SCREENSHOT_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAUAAAADICAIAAAAWZq/8AAAC2UlEQVR42u3dwQ1AMACG0c7k5NBdzGYAByNYwlFiARfutYEIaUj7vvwbyOPQJsKxb0UuSRUUAJYABlgCGGAJYIAFMMASwABLAAMsASwBDLAEMMASwAALYIAlgAGWAAZYAlgCGGAJYIAlgAGWAJYABlgCGGAJYIAFMMASwABLAAMsASwBDLAEMMASwABLAEsAAywBDLAEMMACGGAJYIAlgB9tXWaz4lcyYK9n+QIDLAEMsAQwwBLAEsAASwADLAEMsAAGWAIYYAlggCWAJYABlgAGWAIYYAngO8W2Mcs9gAE2gAEG2AAG2AxggA1ggAE2gAE2AxhgM4ABNoABltzEAlgCGGAJYIAFMMASwABLAAMsASwBDLAEMMASwAALYIAvG4fe6hnAABvAAANsAAMMsAEMsAEMMMAGMMAAG8AAS86BAZYABlgCGGABDLAEMMASwABLAEsAAywB7CaWucUFMMAGMMAAG8AAmwEMsAEMMMAGMMAAG8DOgSWAAZYAlgAGWAIYYAlggAUwwBLAAEsAAywB7CaWW00AA8wSwAADbAADDDDAAhhggAEG2AAGGGADGGDnwAIYYAlggCWAAZYAlgAGWAIYYAlggCWAJYABlgAGWAIYYAEMsAQwwBLAAEsASwADLAEMsAQwwBLAEsAASwADLAEMsAAGWAIYYAlggCWAJYABlgAGWAIYYAEMsAQwwBLAAEsAe7oCGGAJYIAlgAGWAJYABlgC+OeApy6a5R7AABvAAANsAANsBjDABjDAABvAAJsBDLAZwAAbwAADbAADbAYwwAYwwAAbwAADbAADbAYwwAYwwAAbwACbAQywGcAAG8AAA2wAA2wGMMAGMMAAG8AAA2wAA2wGMMAGMMAAG8AAmwHs74TSuwCWAAZYAhhgCWCABTDAEsAASwADLAEsAQywBDDAEsAAC2CAJYABlgAGWALY0xXAAEsAAywBDLAEsAQwwNLXneabNGklvzCeAAAAAElFTkSuQmCC';

const IMAGE_TURNS: ProcessedMessage[] = [
  turn({
    uuid: 'wn-i1',
    role: 'user',
    timestamp: '2026-09-21T09:12:00.000Z',
    content: [
      { type: 'text', text: '[Image #1] The button is off the grid here — can you see why?' },
      { type: 'image', mediaType: 'image/png', data: SCREENSHOT_PNG },
    ],
  }),
  turn({
    uuid: 'wn-i2',
    role: 'assistant',
    model: 'claude-sonnet-5',
    timestamp: '2026-09-21T09:12:05.000Z',
    content: [
      { type: 'text', text: 'Yes — the button is full-width while the text column is not.' },
    ],
  }),
];

function ChatImageVisual(): ReactNode {
  return <TranscriptFrame turns={IMAGE_TURNS} />;
}

// One `Edit`, with the `structuredPatch` Claude Code records on its result row:
// the strip numbers the hunk where the result says, so the turn shows the diff
// exactly as the reader will meet it — open, at the foot, in MIN.
const FILE_CHANGES_TURN: ProcessedMessage[] = buildProcessedMessages([
  {
    uuid: 'wn-f1',
    role: 'assistant',
    model: 'claude-sonnet-5',
    timestamp: '2026-09-21T11:03:00.000Z',
    content: [
      { type: 'text', text: 'Capped the retry loop.' },
      {
        type: 'tool_use',
        id: 'wn-edit-1',
        name: 'Edit',
        input: {
          file_path: '/home/acme/app/src/retry.ts',
          old_string: 'while (true) {',
          new_string: 'while (attempt < MAX_ATTEMPTS) {',
        },
      },
    ],
  },
  {
    uuid: 'wn-f2',
    role: 'user',
    timestamp: '2026-09-21T11:03:02.000Z',
    content: [
      {
        type: 'tool_result',
        toolUseId: 'wn-edit-1',
        content: 'The file /home/acme/app/src/retry.ts has been updated successfully.',
        isError: false,
        patch: [
          {
            oldStart: 14,
            oldLines: 3,
            newStart: 14,
            newLines: 3,
            lines: [
              '  let attempt = 0;',
              '-  while (true) {',
              '+  while (attempt < MAX_ATTEMPTS) {',
              '    attempt += 1;',
            ],
          },
        ],
      },
    ],
  },
]);

function FileChangesVisual(): ReactNode {
  return <TranscriptFrame turns={FILE_CHANGES_TURN} />;
}

// The Terminal / Lens frame with a coloured session in it: the real top bar
// with the crumb wearing the colour, and the glow at the foot of the stage.
// `SessionColorFrame` is what sets `--cl-session-color`; the glow is absolute,
// so the frame is positioned here the way the stage is in Mission Control.
function SessionColorVisual(): ReactNode {
  return (
    <SessionColorFrame
      color="cyan"
      className="cl-whatsnew-frame cl-whatsnew-frame--stage"
      style={{ position: 'relative' }}
    >
      <TopBar
        onBack={() => {}}
        crumbs={[
          { label: 'ACME' },
          { label: <SessionColorIdentity color="cyan" title="acme-b4" />, accent: true },
        ]}
      />
      <div className="cl-transcript-inner">
        {PREVIEW_TURNS.slice(0, 2).map((processed, i) => (
          <MessageBubble
            key={processed.msg.uuid}
            processed={processed}
            detailsFilter="minimal"
            onOpenToolDetail={() => {}}
            turnIndex={4 + i}
          />
        ))}
      </div>
      <SessionBottomGlow color="cyan" active />
    </SessionColorFrame>
  );
}

// A short investigation — two `Read`s and two shell reads over three folders —
// run through the pipeline the Lens runs (`buildProcessedMessages` →
// `contextFiles`), so the rail beside it lists what the transcript really read.
// Read results are tab-numbered, the form current transcripts write.
const RAIL_CWD = '/home/acme/app';
const RAIL_FIRST_TURN = 7;

const RAIL_TURNS: ProcessedMessage[] = buildProcessedMessages([
  {
    uuid: 'wn-r1',
    role: 'user',
    timestamp: '2026-09-22T10:14:00.000Z',
    content: [{ type: 'text', text: 'Why does the retry loop never give up?' }],
  },
  {
    uuid: 'wn-r2',
    role: 'assistant',
    model: 'claude-opus-5-5',
    timestamp: '2026-09-22T10:14:03.000Z',
    content: [
      { type: 'text', text: 'Reading the retry path and where its limit is set.' },
      {
        type: 'tool_use',
        id: 'wn-read-1',
        name: 'Read',
        input: { file_path: `${RAIL_CWD}/src/retry.ts` },
      },
      {
        type: 'tool_use',
        id: 'wn-read-2',
        name: 'Bash',
        input: { command: "sed -n '1,4p' src/config.ts" },
      },
    ],
  },
  {
    uuid: 'wn-r3',
    role: 'user',
    timestamp: '2026-09-22T10:14:04.000Z',
    content: [
      {
        type: 'tool_result',
        toolUseId: 'wn-read-1',
        content: [
          '    12\texport async function withRetry<T>(run: () => Promise<T>) {',
          '    13\t  let attempt = 0;',
          '    14\t  while (true) {',
          '    15\t    attempt += 1;',
          '    16\t    try {',
          '    17\t      return await run();',
          '    18\t    } catch {',
          '    19\t      await sleep(backoff(attempt));',
          '    20\t    }',
          '    21\t  }',
          '    22\t}',
        ].join('\n'),
        isError: false,
      },
      {
        type: 'tool_result',
        toolUseId: 'wn-read-2',
        content:
          "import { env } from './env';\n\nexport const MAX_ATTEMPTS = 5;\nexport const BASE_DELAY_MS = 200;\n",
        isError: false,
      },
    ],
  },
  {
    uuid: 'wn-r4',
    role: 'assistant',
    model: 'claude-opus-5-5',
    timestamp: '2026-09-22T10:14:09.000Z',
    content: [
      {
        type: 'text',
        text: '`MAX_ATTEMPTS` is set to 5, but `while (true)` never reads it. Checking what the tests expect.',
      },
      {
        type: 'tool_use',
        id: 'wn-read-3',
        name: 'Read',
        input: { file_path: `${RAIL_CWD}/test/retry.test.ts` },
      },
      {
        type: 'tool_use',
        id: 'wn-read-4',
        name: 'Bash',
        input: { command: 'cat package.json' },
      },
    ],
  },
  {
    uuid: 'wn-r5',
    role: 'user',
    timestamp: '2026-09-22T10:14:10.000Z',
    content: [
      {
        type: 'tool_result',
        toolUseId: 'wn-read-3',
        content: [
          '     1\timport { withRetry } from "../src/retry";',
          '     2\t',
          '     3\ttest("gives up after MAX_ATTEMPTS", async () => {',
          '     4\t  const run = vi.fn().mockRejectedValue(new Error("down"));',
          '     5\t  await expect(withRetry(run)).rejects.toThrow("down");',
          '     6\t  expect(run).toHaveBeenCalledTimes(5);',
          '     7\t});',
        ].join('\n'),
        isError: false,
      },
      {
        type: 'tool_result',
        toolUseId: 'wn-read-4',
        content: '{\n  "name": "acme-app",\n  "scripts": { "test": "vitest run" }\n}\n',
        isError: false,
      },
    ],
  },
]);

const RAIL_FILES = contextFiles(RAIL_TURNS, RAIL_CWD);

// The rail on the left edge of a short transcript, open on its list so the
// preview shows what it is before anyone hovers; a name's hover, a click on
// it and closing are all live. The last turn is the one being read, so its
// files are the lit ones.
function ContextRailVisual(): ReactNode {
  return (
    <div className="cl-whatsnew-frame cl-whatsnew-frame--rail">
      <div className="cl-transcript-inner">
        {RAIL_TURNS.map((processed, i) => (
          <MessageBubble
            key={processed.msg.uuid}
            processed={processed}
            detailsFilter="minimal"
            onOpenToolDetail={() => {}}
            turnIndex={RAIL_FIRST_TURN + i}
          />
        ))}
      </div>
      <ContextRail
        files={RAIL_FILES}
        cwd={RAIL_CWD}
        turnOf={idx => RAIL_FIRST_TURN + idx}
        activeTurn={RAIL_FIRST_TURN + RAIL_TURNS.length - 1}
        onJump={() => {}}
        defaultOpen
      />
    </div>
  );
}

// A short `thinking` block is the update Claude Code prints inline while it
// works. MIN used to drop it with every other thinking block; here it sits
// between the ask and the answer, as the terminal showed it.
const THINKING_TURNS: ProcessedMessage[] = buildProcessedMessages([
  {
    uuid: 'wn-t1',
    role: 'user',
    timestamp: '2026-09-22T10:20:00.000Z',
    content: [{ type: 'text', text: 'Run the suite and fix whatever is red.' }],
  },
  {
    uuid: 'wn-t2',
    role: 'assistant',
    model: 'claude-opus-5-5',
    timestamp: '2026-09-22T10:20:41.000Z',
    content: [
      {
        type: 'thinking',
        thinking:
          'Two failures, both in `retry.test.ts`: they expect the loop to stop after `MAX_ATTEMPTS`. The loop is wrong, not the tests.',
      },
      {
        type: 'text',
        text: 'Capped the loop at `MAX_ATTEMPTS` — all 48 tests pass now.',
      },
    ],
  },
]);

function ThinkingNoteVisual(): ReactNode {
  return <TranscriptFrame turns={THINKING_TURNS} />;
}

// The model list the SDK handshake answers with — the shape `model-options`
// is tested against: `opus` offered as `opus[1m]`, Fable under its full id —
// so the choices below are what `composerModelOptions` really builds for a
// session on Opus 5.5, where the bare `opus` alias still means Opus 5.
const PICKER_SESSION_MODEL = 'claude-opus-5-5';
const PICKER_MODELS: InitModel[] = [
  { value: 'sonnet', resolvedModel: 'claude-sonnet-5', displayName: 'Sonnet' },
  { value: 'opus[1m]', resolvedModel: 'claude-opus-5[1m]', displayName: 'Opus (1M context)' },
  { value: 'haiku', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku' },
  { value: 'claude-fable-5-1[1m]', resolvedModel: 'claude-fable-5-1', displayName: 'Fable' },
];
const PICKER_OPTIONS = composerModelOptions(
  PICKER_SESSION_MODEL,
  { model: PICKER_SESSION_MODEL, models: PICKER_MODELS },
  PICKER_SESSION_MODEL
);

const PICKER_TURNS: ProcessedMessage[] = [
  turn({
    uuid: 'wn-m1',
    role: 'assistant',
    model: PICKER_SESSION_MODEL,
    timestamp: '2026-09-22T10:31:00.000Z',
    content: [{ type: 'text', text: 'The loop is capped and the suite is green.' }],
  }),
];

// The Model picker, open, and live: picking another model moves the selection
// and nothing is sent. A component of its own because it holds state, and the
// VISUALS below are called as functions from inside the dialog's render.
function PreviewModelPicker(): ReactNode {
  const [model, setModel] = useState(PICKER_SESSION_MODEL);
  return (
    <ComposerSelect
      label="Model"
      value={model}
      options={PICKER_OPTIONS}
      onChange={setModel}
      defaultOpen
    />
  );
}

// The last turn of a session on Opus 5.5, and under it the composer with its
// Model picker open: the real `ComposerSelect`, inside the sheet and control
// rail it sits in.
function ModelPickerVisual(): ReactNode {
  return (
    <div className="cl-whatsnew-frame cl-whatsnew-frame--composer">
      <div className="cl-transcript-inner">
        {PICKER_TURNS.map((processed, i) => (
          <MessageBubble
            key={processed.msg.uuid}
            processed={processed}
            detailsFilter="minimal"
            onOpenToolDetail={() => {}}
            turnIndex={24 + i}
          />
        ))}
      </div>
      <div className="cl-composer-sheet">
        <div className="cl-composer-row">
          <textarea
            className="cl-composer-input"
            placeholder="Continue this session…   ⏎ send · ⇧⏎ newline"
            rows={1}
            readOnly
            tabIndex={-1}
          />
        </div>
        <div className="cl-composer-meta">
          <span className="cl-composer-meta-note">resumes this session</span>
          <span className="cl-composer-meta-tags">
            <PreviewModelPicker />
          </span>
        </div>
      </div>
    </div>
  );
}

const VISUALS: Record<NonNullable<WhatsNewHighlight['visual']>, () => ReactNode> = {
  'cross-session-message': CrossSessionMessageVisual,
  'prompt-playbook': PromptPlaybookVisual,
  artifact: ArtifactVisual,
  'chat-image': ChatImageVisual,
  'file-changes': FileChangesVisual,
  'session-color': SessionColorVisual,
  'context-rail': ContextRailVisual,
  'thinking-note': ThinkingNoteVisual,
  'model-picker': ModelPickerVisual,
};

/** The sections of the release on screen — the card's own children, never the
 *  sections of an earlier release opened further down, which have a thread of
 *  their own and nothing to do with the index or the lit dot. */
const OWN_SECTIONS = ':scope > .cl-whatsnew-item';

/** The names of everything in this release, beside the title. A card that opens
 *  on its first feature gives no sign the others are there; a list of them does,
 *  and it is navigation rather than a hint — each name carries the reader to its
 *  section. The names hang on the transcript's own thread, one dot each, and
 *  say where in the app each one lives. One authored highlight needs no index
 *  and gets none. `--i` staggers the thread drawing itself in on open. */
function ReleaseIndex({
  highlights,
  scroller,
}: {
  highlights: WhatsNewHighlight[];
  scroller: RefObject<HTMLDivElement | null>;
}) {
  if (highlights.length < 2) return null;
  return (
    <nav className="cl-whatsnew-index" aria-label="What's in this release">
      {highlights.map((highlight, i) => (
        <button
          key={highlight.title}
          type="button"
          style={{ '--i': i } as CSSProperties}
          onClick={() => {
            const box = scroller.current;
            const el = box?.querySelectorAll<HTMLElement>(OWN_SECTIONS)[i];
            if (!box || !el) return;
            // Measured against the scroller's own box, never `offsetTop`: the
            // card is animated, so its offset parent is not the one the sections
            // are laid out in, and the arithmetic silently landed at the end.
            const top =
              box.scrollTop + (el.getBoundingClientRect().top - box.getBoundingClientRect().top);
            box.scrollTo({ top: Math.max(0, top - 24), behavior: 'smooth' });
          }}
        >
          <span className="dot" aria-hidden />
          <span className="name">{highlight.title}</span>
          {highlight.where && <span className="where">{highlight.where}</span>}
        </button>
      ))}
    </nav>
  );
}

/** The section being read: the one crossing a band a third of the way down the
 *  card, the line the eye reads at — the way the Lens rail lights the turn in
 *  view. The first section until the card has scrolled; with no
 *  IntersectionObserver (jsdom) it simply stays there. */
function useCurrentSection(
  scroller: RefObject<HTMLDivElement | null>,
  active: boolean,
  count: number
): number {
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    const box = scroller.current;
    if (!active || !box || typeof IntersectionObserver === 'undefined') return;
    const items = [...box.querySelectorAll<HTMLElement>(OWN_SECTIONS)];
    const io = new IntersectionObserver(
      entries => {
        for (const entry of entries)
          if (entry.isIntersecting) setCurrent(items.indexOf(entry.target as HTMLElement));
      },
      { root: box, rootMargin: '-30% 0px -60% 0px' }
    );
    items.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, [scroller, active, count]);
  return current;
}

/** Focus and Escape for an open card. Focus moves into it on open, so the keys
 *  reach it and a screen reader lands in it, and goes back where it was on
 *  close. Escape dismisses it — unless another modal is on top: a preview can
 *  open one of its own (the rail's file window), and Escape is that one's. */
function useDialogKeys(
  card: RefObject<HTMLDivElement | null>,
  open: boolean,
  onDismiss: () => void
): void {
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    card.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const modals = document.querySelectorAll('[aria-modal="true"]');
      if ([...modals].some(m => m !== card.current)) return;
      onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      before?.focus?.({ preventScroll: true });
    };
  }, [card, open, onDismiss]);
}

/** One feature: its words, held while its screen scrolls past, and its screen
 *  as a stop on the thread — the line that hangs the names in the masthead
 *  runs on down the page, one dot per section. */
function HighlightSection({
  highlight,
  current = false,
}: {
  highlight: WhatsNewHighlight;
  current?: boolean;
}) {
  return (
    <section className={`cl-whatsnew-item${current ? ' is-current' : ''}`}>
      <div className="cl-whatsnew-copy">
        <h3 className="cl-whatsnew-subtitle">{highlight.title}</h3>
        <p className="cl-whatsnew-desc">{highlight.description}</p>
        {highlight.where && <p className="cl-whatsnew-where">{highlight.where}</p>}
      </div>
      <div className="cl-whatsnew-stop">
        <span className="cl-whatsnew-dot" aria-hidden />
        {highlight.visual && VISUALS[highlight.visual]()}
      </div>
    </section>
  );
}

/** An earlier release, folded to its version and the names of what it brought;
 *  opened, its sections as the popup first showed them. Folded, its screens are
 *  not mounted at all — they are real components, and a page of history should
 *  not cost what reading it would. */
function PastRelease({ release }: { release: WhatsNewRelease }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`cl-whatsnew-past${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="cl-whatsnew-past-head"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <span className="version">{release.version}</span>
        <span className="names">
          {release.highlights.map(h => (
            <span key={h.title}>{h.title}</span>
          ))}
        </span>
        <span className="caret" aria-hidden />
      </button>
      {open && (
        <div className="cl-whatsnew-past-body">
          {release.highlights.map(h => (
            <HighlightSection key={h.title} highlight={h} />
          ))}
        </div>
      )}
    </div>
  );
}

/** The releases before the one on screen: the ones skipped since the reader
 *  last dismissed the popup, or — reopened from Settings — all of them. */
function EarlierReleases({
  releases,
  since,
}: {
  releases: WhatsNewRelease[];
  since: string | null;
}) {
  if (releases.length === 0) return null;
  return (
    // A div, not a section: the card's last `section` is where the thread ends
    // (`:last-of-type`), and that has to stay the last feature on screen.
    <div className="cl-whatsnew-earlier">
      <h3 className="cl-whatsnew-earlier-title">
        {since ? `Also new since ${since}` : 'Earlier releases'}
      </h3>
      <div className="cl-whatsnew-earlier-list">
        {releases.map(r => (
          <PastRelease key={r.version} release={r} />
        ))}
      </div>
    </div>
  );
}

/** What the card shows. On launch: the installed version's entry, plus any
 *  release skipped since the last one dismissed — a reader who went from
 *  2.2.24 to 2.2.27 would otherwise never see 2.2.26's. Asked for from
 *  Settings: the newest entry this build has, and every one before it. */
function useWhatsNewView(asked: boolean) {
  const { data: seenVersion, isLoading } = useWhatsNewSeenVersion();
  const seen = seenVersion ?? null;
  const installed = whatsNewFor(appVersion);
  if (asked) {
    const release = installed ?? latestWhatsNew(appVersion);
    return release ? { release, earlier: releasesBefore(release.version), since: null } : null;
  }
  if (isLoading || !installed || !shouldShowWhatsNew(appVersion, seen, true)) return null;
  const earlier = seen ? releasesBetween(seen, installed.version) : [];
  return { release: installed, earlier, since: seen };
}

export function WhatsNewDialog() {
  const markSeen = useMarkWhatsNewSeen();
  // Opened from Settings, after the launch showing was dismissed.
  const [asked, setAsked] = useState(false);
  useEffect(() => onOpenWhatsNew(() => setAsked(true)), []);

  const view = useWhatsNewView(asked);
  const highlights = view?.release.highlights ?? [];
  const visible = !!view && highlights.length > 0;
  const card = useRef<HTMLDivElement>(null);
  const current = useCurrentSection(card, visible, highlights.length);
  const { mutate } = markSeen;
  const dismiss = useCallback(() => {
    setAsked(false);
    mutate(appVersion);
  }, [mutate]);
  useDialogKeys(card, visible, dismiss);

  return (
    <AnimatePresence>
      {visible && view && (
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
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
          >
            <header className="cl-whatsnew-masthead">
              <div className="cl-whatsnew-brand">
                <img src="./brand-mark.png" alt="" />
                <span>
                  Claude<span className="lens">Lens</span>
                </span>
              </div>
              <h2 className="cl-whatsnew-title">
                <span>What&rsquo;s new</span> <span>in {view.release.version}</span>
              </h2>
              <ReleaseIndex highlights={highlights} scroller={card} />
            </header>

            {highlights.map((highlight, i) => (
              <HighlightSection
                key={highlight.title}
                highlight={highlight}
                current={i === current}
              />
            ))}

            <EarlierReleases releases={view.earlier} since={view.since} />

            {/* Pinned to the card's foot, so dismissing never waits on
                scrolling past every screen above it. */}
            <footer className="cl-whatsnew-foot">
              <button type="button" className="cl-hero-cta cl-whatsnew-ok" onClick={dismiss}>
                Got it
              </button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
