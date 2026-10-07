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
import { LiveTurn } from './project/chat/LiveTurn';
import { PromptPlaybookPanel } from './project/chat/PromptPlaybook';
import { ContextRail } from './project/chat/ContextRail';
import { contextFiles } from './project/chat/context-files';
import { ComposerSelect } from './project/chat/ChatComposer';
import { composerModelOptions } from './project/chat/model-options';
import type { ActiveSession, InitModel, SessionActivity } from '../types';
import type { PromptCandidate, PromptTemplate } from '../../electron/shared/playbook-types';
import { buildProcessedMessages, type ProcessedMessage } from './project/chat/utils';
import type { ArtifactPublish } from '../types';
import { TopBar } from './project/shared/TopBar';
import {
  SessionBottomGlow,
  SessionColorFrame,
  SessionColorIdentity,
} from './project/shared/SessionColorIdentity';
import {
  TabBarBack,
  TabBarRailToggle,
  ViewSwitch,
  ViewTabs,
} from './project/terminal/TerminalMissionControl';
import { ParkedTerminals } from './project/terminal/ParkedTerminals';
import { SessionTabs } from './project/terminal/SessionTabs';
import { TabAttentionContext } from './project/terminal/use-tab-attention';
import type { AttentionState } from './project/terminal/tab-attention';
import { EnvironmentStrip } from './project/terminal/EnvironmentStrip';
import type { SessionGitState } from './project/chat/git-state';
import { SideQuestionCard } from './project/chat/SideQuestionCard';
import type { SideQuestions } from './project/chat/useSideQuestions';
import type { TerminalInstance } from './project/terminal/terminal-instances';
import { RemoteBanner, RemoteStatus } from './project/remote/RemoteChrome';
import { BackgroundShells } from './project/terminal/BackgroundShells';
import type { BackgroundShell } from './project/terminal/background-shells';
import type { RemoteHost } from '../../electron/shared/remote-host';
import { FilesRailPanel } from './project/files/FilesRailPanel';
import type { FileTreePreview } from './project/files/FileTree';
import type { SessionMarks } from './project/files/session-marks';
import type { ProjectDirEntry } from '../types';
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

// A connected remote pane, on its Lens tab: the real top bar with the host in
// the crumbs and the status that says where the session runs, the TERMINAL /
// LENS tabs, the banner — Beta tag included — and the host's transcript under
// it. The host is synthetic, and so is the exchange.
const REMOTE_HOST: RemoteHost = {
  id: 'preview',
  name: 'Build server',
  target: 'dev@build.example.com',
};

const REMOTE_TURNS: ProcessedMessage[] = [
  turn({
    uuid: 'wn-remote-1',
    role: 'user',
    timestamp: '2026-09-23T09:14:00.000Z',
    content: [{ type: 'text', text: 'Run the full test suite here, on the build server.' }],
  }),
  turn({
    uuid: 'wn-remote-2',
    role: 'assistant',
    model: 'claude-opus-5-5',
    timestamp: '2026-09-23T09:16:40.000Z',
    content: [{ type: 'text', text: 'Done: 412 tests passed on the build server, none failed.' }],
  }),
];

function RemoteVisual(): ReactNode {
  return (
    <div className="cl-whatsnew-frame cl-whatsnew-frame--remote">
      <TopBar
        onBack={() => {}}
        backLabel="Disconnect"
        crumbs={[
          { label: 'REMOTE' },
          { label: REMOTE_HOST.name, accent: true },
          { label: '~/projects/acme' },
        ]}
        right={<RemoteStatus status="running" hostName={REMOTE_HOST.name} />}
      />
      <ViewTabs view="lens" setView={() => {}} />
      <div className="cl-whatsnew-remote-banner">
        <RemoteBanner host={REMOTE_HOST} channel="shared" />
      </div>
      <div className="cl-transcript-inner">
        {REMOTE_TURNS.map((processed, i) => (
          <MessageBubble
            key={processed.msg.uuid}
            processed={processed}
            detailsFilter="minimal"
            onOpenToolDetail={() => {}}
            turnIndex={2 + i}
          />
        ))}
      </div>
    </div>
  );
}

// A terminal pane's top bar with the real pill beside RUNNING: one dev server
// still running, one build that ended a few minutes ago. The times are taken
// when the popup opens — the pill measures against the clock, and a finished
// shell leaves the list after 10 minutes, so dates written here would read as
// days old, or as nothing, by the time anyone updates.
function PreviewBackgroundShells(): ReactNode {
  const [shells] = useState(() => {
    const now = Date.now();
    const min = 60_000;
    const list: BackgroundShell[] = [
      {
        toolUseId: 'wn-bg-1',
        taskId: 'wn-task-1',
        title: 'Start the dev server',
        command: 'npm run dev',
        state: 'running',
        startedAt: now - 12 * min,
        via: 'requested',
      },
      {
        toolUseId: 'wn-bg-2',
        taskId: 'wn-task-2',
        title: 'Build the app',
        command: 'npm run build',
        state: 'done',
        startedAt: now - 9 * min,
        endedAt: now - 3 * min,
        exitCode: 0,
        via: 'timeout',
        timeoutS: 120,
      },
    ];
    return { list, liveSince: now - 40 * min };
  });
  return <BackgroundShells shells={shells.list} liveSince={shells.liveSince} />;
}

const SHELLS_TURNS: ProcessedMessage[] = [
  turn({
    uuid: 'wn-bg-t1',
    role: 'assistant',
    model: 'claude-opus-5-5',
    timestamp: '2026-09-24T10:12:00.000Z',
    content: [
      {
        type: 'text',
        text: 'The build is green and the dev server is still up in the background — I will hear when it exits.',
      },
    ],
  }),
];

// The pane status the terminal's top bar prints while its process is up.
function PreviewRunning(): ReactNode {
  return (
    <span
      className="flex items-center font-mono uppercase"
      style={{ gap: 7, fontSize: 9.5, letterSpacing: '0.16em', color: 'var(--cl-ink-3)' }}
    >
      <span
        aria-hidden
        className="cl-live-dot"
        style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--cl-ok)' }}
      />
      RUNNING
    </span>
  );
}

function BackgroundShellsVisual(): ReactNode {
  return (
    <div className="cl-whatsnew-frame cl-whatsnew-frame--shells">
      <TopBar
        onBack={() => {}}
        crumbs={[{ label: 'ACME' }, { label: 'Wire the retry loop', accent: true }]}
        right={
          <span className="flex items-center" style={{ gap: 14 }}>
            <PreviewBackgroundShells />
            <PreviewRunning />
          </span>
        }
      />
      <div className="cl-transcript-inner">
        {SHELLS_TURNS.map((processed, i) => (
          <MessageBubble
            key={processed.msg.uuid}
            processed={processed}
            detailsFilter="minimal"
            onOpenToolDetail={() => {}}
            turnIndex={18 + i}
          />
        ))}
      </div>
    </div>
  );
}

// The SDK chat's live turn while a call runs: the real `LiveTurn`, its chip
// opening on the orb in the tool's own animation and carrying the call's note,
// as the chat draws it. The elapsed seconds are fixed — the SDK's heartbeat is
// what moves them, and nothing here streams.
const ORB_TURNS: ProcessedMessage[] = [
  turn({
    uuid: 'wn-orb-1',
    role: 'user',
    timestamp: '2026-09-27T11:02:00.000Z',
    content: [{ type: 'text', text: 'Run the suite before you push.' }],
  }),
];

function LiveOrbVisual(): ReactNode {
  return (
    <div className="cl-whatsnew-frame">
      <div className="cl-transcript-inner">
        {ORB_TURNS.map((processed, i) => (
          <MessageBubble
            key={processed.msg.uuid}
            processed={processed}
            detailsFilter="minimal"
            onOpenToolDetail={() => {}}
            turnIndex={30 + i}
          />
        ))}
        <LiveTurn
          text=""
          tool={{ toolName: 'Bash', elapsedSeconds: 14 }}
          thought="Run the full test suite"
          turnNumber={31}
        />
      </div>
    </div>
  );
}

// Two rounds of plan mode, as the transcript carries them: a first plan the
// user turned down — Claude Code's own refusal, with what they said after it —
// and the revised one they approved, which the result repeats in full. Each
// card reads its outcome off that result, as it does in a real session.
const REJECTED_PLAN =
  '# Split the reader into two passes\n\n## Steps\n\n1. Read the rows\n2. Merge the extras\n';
const APPROVED_PLAN =
  '# Merge the extras in the same pass\n\n## Steps\n\n1. Read each row once\n2. Attach its extras as it goes\n';

function planRound(id: string, plan: string, minute: number, result: string, isError: boolean) {
  return [
    {
      uuid: `wn-plan-${id}-a`,
      role: 'assistant' as const,
      model: 'claude-opus-5-5',
      timestamp: `2026-09-28T10:${minute}:00.000Z`,
      content: [
        {
          type: 'tool_use' as const,
          id: `wn-plan-${id}`,
          name: 'ExitPlanMode',
          input: { plan, planFilePath: '/home/acme/.claude/plans/quiet-river-fox.md' },
        },
      ],
    },
    {
      uuid: `wn-plan-${id}-u`,
      role: 'user' as const,
      timestamp: `2026-09-28T10:${minute + 1}:00.000Z`,
      content: [
        { type: 'tool_result' as const, toolUseId: `wn-plan-${id}`, content: result, isError },
      ],
    },
  ];
}

const PLAN_TURNS: ProcessedMessage[] = buildProcessedMessages([
  {
    uuid: 'wn-plan-ask',
    role: 'user',
    timestamp: '2026-09-28T10:10:00.000Z',
    content: [{ type: 'text', text: 'Plan how the reader should merge the extras.' }],
  },
  ...planRound(
    '1',
    REJECTED_PLAN,
    12,
    "The user doesn't want to proceed with this tool use. The tool use was rejected. " +
      'To tell you how to proceed, the user said:\nkeep the single pass',
    true
  ),
  ...planRound(
    '2',
    APPROVED_PLAN,
    14,
    `User has approved your plan. You can now start coding.\n\n## Approved Plan:\n${APPROVED_PLAN}`,
    false
  ),
]);

function PlanVisual(): ReactNode {
  return <TranscriptFrame turns={PLAN_TURNS} />;
}

// A top bar with two sessions sent to the background: the real badge, wearing
// the state of the one that needs the user. The round button that sent a
// session there is gone — Mission Control's back arrow does it since 2.2.33 —
// so the preview no longer draws it. The registry the badge
// reads is synthetic and passed in — the user's own would match none of these
// sessions, or one of theirs — and the uptimes are taken when the popup opens,
// as the shells preview does.
function PreviewParkedTerminals(): ReactNode {
  const [preview] = useState(() => {
    const now = Date.now();
    const min = 60_000;
    const parked = (
      n: number,
      realPath: string,
      title: string,
      color: TerminalInstance['report']['color']
    ): TerminalInstance => ({
      id: `wn-park-${n}`,
      view: {
        type: 'terminal',
        project: { hash: `wn-park-project-${n}`, realPath },
        resumeSessionId: `wn-park-session-${n}`,
      },
      report: {
        pid: null,
        sessionId: `wn-park-session-${n}`,
        title,
        color,
        termStatus: 'running',
        gitBranch: null,
      },
    });
    const instances = [
      parked(1, '/home/acme/billing', 'Migrate the invoice tables', 'blue'),
      parked(2, '/home/acme/web', 'Fix the flaky login test', null),
    ];
    const registry: ActiveSession[] = [
      {
        pid: 0,
        sessionId: 'wn-park-session-1',
        cwd: '/home/acme/billing',
        status: 'waiting',
        waitingFor: 'permission prompt',
        startedAt: now - 34 * min,
        source: 'registry',
      },
      {
        pid: 0,
        sessionId: 'wn-park-session-2',
        cwd: '/home/acme/web',
        status: 'busy',
        startedAt: now - 12 * min,
        source: 'registry',
      },
    ];
    return { instances, registry };
  });
  return (
    <ParkedTerminals
      instances={preview.instances}
      activeSessions={preview.registry}
      onRestore={() => {}}
      onClose={() => {}}
    />
  );
}

const PARKED_TURNS: ProcessedMessage[] = [
  turn({
    uuid: 'wn-park-t1',
    role: 'assistant',
    model: 'claude-opus-5-5',
    timestamp: '2026-10-01T16:40:00.000Z',
    content: [
      {
        type: 'text',
        text: 'The retry loop now backs off twice before it gives up, and the suite is green.',
      },
    ],
  }),
];

function ParkedTerminalsVisual(): ReactNode {
  return (
    <div className="cl-whatsnew-frame cl-whatsnew-frame--parked">
      <TopBar
        onBack={() => {}}
        crumbs={[{ label: 'ACME' }, { label: 'Wire the retry loop', accent: true }]}
        right={
          <span className="flex items-center" style={{ gap: 14 }}>
            <PreviewParkedTerminals />
            <PreviewRunning />
          </span>
        }
      />
      <div className="cl-transcript-inner">
        {PARKED_TURNS.map((processed, i) => (
          <MessageBubble
            key={processed.msg.uuid}
            processed={processed}
            detailsFilter="minimal"
            onOpenToolDetail={() => {}}
            turnIndex={24 + i}
          />
        ))}
      </div>
    </div>
  );
}

// Mission Control's first row with three sessions open: the one on screen, one
// Claude is working in — the orb — and one waiting on a permission prompt. The
// registry the tabs read is synthetic and passed in, as for the background
// badge above, and the uptimes are taken when the popup opens.
function PreviewSessionTabs(): ReactNode {
  const [preview] = useState(() => {
    const now = Date.now();
    const min = 60_000;
    const tab = (
      n: number,
      realPath: string,
      title: string,
      color: TerminalInstance['report']['color']
    ): TerminalInstance => ({
      id: `wn-tab-${n}`,
      view: {
        type: 'terminal',
        project: { hash: `wn-tab-project-${n}`, realPath },
        resumeSessionId: `wn-tab-session-${n}`,
      },
      report: {
        pid: null,
        sessionId: `wn-tab-session-${n}`,
        title,
        color,
        termStatus: 'running',
        gitBranch: null,
      },
    });
    // In the order the app keeps them: a project's tabs together.
    const instances = [
      tab(1, '/home/acme/web', 'Wire the retry loop', null),
      tab(3, '/home/acme/web', 'Fix the flaky login test', null),
      tab(2, '/home/acme/billing', 'Migrate the invoice tables', 'blue'),
    ];
    const entry = (n: number, cwd: string, status: string, since: number): ActiveSession => ({
      pid: 0,
      sessionId: `wn-tab-session-${n}`,
      cwd,
      status,
      startedAt: now - since * min,
      source: 'registry',
    });
    const registry: ActiveSession[] = [
      entry(1, '/home/acme/web', 'idle', 48),
      entry(2, '/home/acme/billing', 'busy', 34),
      { ...entry(3, '/home/acme/web', 'waiting', 12), waitingFor: 'permission prompt' },
    ];
    return { instances, registry };
  });
  return (
    <SessionTabs
      instances={preview.instances}
      currentId="wn-tab-1"
      onSelect={() => {}}
      onClose={() => {}}
      onNew={() => {}}
      activeSessions={preview.registry}
    />
  );
}

const TABS_TURNS: ProcessedMessage[] = [
  turn({
    uuid: 'wn-tabs-t1',
    role: 'assistant',
    model: 'claude-opus-5-5',
    timestamp: '2026-10-04T16:40:00.000Z',
    content: [
      {
        type: 'text',
        text: 'The retry loop now backs off twice before it gives up, and the suite is green.',
      },
    ],
  }),
];

function SessionTabsVisual(): ReactNode {
  return (
    <div className="cl-whatsnew-frame cl-whatsnew-frame--tabs">
      <div className="cl-stabs-bar">
        <TabBarBack label="Back to app" title="Back to the app" onClick={() => {}} />
        <PreviewSessionTabs />
        <div className="cl-stabs-end">
          <ViewSwitch view="lens" setView={() => {}} />
          <BackgroundShells shells={[]} liveSince={null} compact />
          <TabBarRailToggle collapsed onToggle={() => {}} />
        </div>
      </div>
      <div className="cl-transcript-inner">
        {TABS_TURNS.map((processed, i) => (
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

// Mission Control with the files panel open in its rail: the tab bar, the turn
// that did the work, and the project tree with what the session read, edited
// or created marked on each file and on every folder above it. The tree's
// folders are handed in (`preview`) — main refuses a project it does not know,
// and this one is synthetic. The rail's head is drawn here: in MissionRail it
// is part of a component that reads the live session.
const FILES_ROOT = '/home/acme/web';

function listing(...entries: [rel: string, kind: 'dir' | 'file'][]) {
  return {
    entries: entries.map(([rel, kind]): ProjectDirEntry => {
      const name = rel.slice(rel.lastIndexOf('/') + 1);
      const dot = name.lastIndexOf('.');
      return { name, rel, kind, ext: kind === 'file' && dot > 0 ? name.slice(dot + 1) : '' };
    }),
    truncated: false,
  };
}

const PREVIEW_TREE: FileTreePreview = {
  listings: {
    '': listing(['src', 'dir'], ['test', 'dir'], ['README.md', 'file'], ['package.json', 'file']),
    src: listing(['src/net', 'dir'], ['src/index.ts', 'file']),
    'src/net': listing(
      ['src/net/backoff.ts', 'file'],
      ['src/net/http.ts', 'file'],
      ['src/net/retry.ts', 'file']
    ),
    test: listing(['test/retry.test.ts', 'file']),
  },
  expanded: ['src', 'src/net'],
};

const PREVIEW_MARKS: SessionMarks = {
  files: new Map([
    ['README.md', 'read'],
    ['src/net/backoff.ts', 'created'],
    ['src/net/retry.ts', 'edited'],
    ['test/retry.test.ts', 'edited'],
  ]),
  dirs: new Map([
    ['src', 'created'],
    ['src/net', 'created'],
    ['test', 'edited'],
  ]),
  writes: new Map(),
};

const FILES_TURNS: ProcessedMessage[] = [
  turn({
    uuid: 'wn-files-t1',
    role: 'assistant',
    model: 'claude-opus-5-5',
    timestamp: '2026-10-05T18:12:00.000Z',
    content: [
      {
        type: 'text',
        text: 'Moved the delays into `backoff.ts` and capped the retry loop; the test covers both.',
      },
    ],
  }),
];

function ProjectFilesVisual(): ReactNode {
  return (
    <div className="cl-whatsnew-frame cl-whatsnew-frame--files">
      <div className="cl-stabs-bar">
        <TabBarBack label="Back to app" title="Back to the app" onClick={() => {}} />
        <PreviewSessionTabs />
        <div className="cl-stabs-end">
          <ViewSwitch view="lens" setView={() => {}} />
          <TabBarRailToggle collapsed={false} onToggle={() => {}} />
        </div>
      </div>
      <div className="cl-whatsnew-files-stage">
        <div className="cl-transcript-inner">
          {FILES_TURNS.map((processed, i) => (
            <MessageBubble
              key={processed.msg.uuid}
              processed={processed}
              detailsFilter="minimal"
              onOpenToolDetail={() => {}}
              turnIndex={18 + i}
            />
          ))}
        </div>
        <aside className="cl-whatsnew-files-rail">
          <div className="cl-whatsnew-files-rail-head">
            <span aria-hidden className="cl-live-dot cl-whatsnew-files-led" />
            <span className="cl-whatsnew-files-title">FILES</span>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              className="cl-playbook-rail-trigger"
              aria-label="Files"
              aria-expanded
              tabIndex={-1}
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2.2h8.4A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5Z" />
              </svg>
            </button>
          </div>
          <FilesRailPanel
            id="whats-new-files"
            root={FILES_ROOT}
            marks={PREVIEW_MARKS}
            openFile="src/net/retry.ts"
            onOpen={() => {}}
            onClose={() => {}}
            preview={PREVIEW_TREE}
          />
        </aside>
      </div>
    </div>
  );
}

// A turn that searched and then read two of the pages it found, one of which
// was gone: the strip at its foot says so line by line, in MIN.
const WEB_SOURCES_TURN: ProcessedMessage[] = buildProcessedMessages([
  {
    uuid: 'wn-w1',
    role: 'assistant',
    model: 'claude-opus-5-5',
    timestamp: '2026-10-05T10:00:00.000Z',
    content: [
      { type: 'text', text: 'The client retries on 429 and 503, honouring `Retry-After`.' },
      {
        type: 'tool_use',
        id: 'wn-ws-1',
        name: 'WebSearch',
        input: { query: 'retry-after header' },
      },
      {
        type: 'tool_use',
        id: 'wn-wf-1',
        name: 'WebFetch',
        input: { url: 'https://docs.example.com/http/retry-after.html', prompt: 'Summarise' },
      },
      {
        type: 'tool_use',
        id: 'wn-wf-2',
        name: 'WebFetch',
        input: { url: 'https://example.org/blog/backoff.html', prompt: 'Summarise' },
      },
    ],
  },
  {
    uuid: 'wn-w2',
    role: 'user',
    timestamp: '2026-10-05T10:00:04.000Z',
    content: [
      {
        type: 'tool_result',
        toolUseId: 'wn-ws-1',
        content:
          'Web search results for query: "retry-after header"\n\nLinks: [{"title":"Retry-After","url":"https://docs.example.com/http/retry-after.html"},{"title":"Backoff","url":"https://example.org/blog/backoff.html"}]',
        isError: false,
      },
      {
        type: 'tool_result',
        toolUseId: 'wn-wf-1',
        content: '# Retry-After\nThe delay before a client should retry.',
        isError: false,
      },
      {
        type: 'tool_result',
        toolUseId: 'wn-wf-2',
        content: 'The server returned HTTP 404 Not Found.',
        isError: false,
      },
    ],
  },
]);

function WebSourcesVisual(): ReactNode {
  return <TranscriptFrame turns={WEB_SOURCES_TURN} />;
}

// 2.2.35's tabs: two projects, five sessions, each tab in a state the strip
// draws at rest — the orb with two sub-agents circling it, a `?` asked minutes
// ago, a turn that finished while its tab was out of sight, a context window
// near compaction, a session that ended. The registry and the tails are handed
// in, and so is what the strip remembers between looks (`TabAttentionContext`):
// every change older than the state's `seq`, so none of the one-shot
// animations plays when the popup opens.
function previewTabs(now: number, ids: number[]) {
  const min = 60_000;
  const all: Record<number, [string, string, TerminalInstance['report']['color'], string, number]> =
    {
      1: ['/home/acme/web', 'Wire the retry loop', null, 'busy', 22],
      2: ['/home/acme/web', 'Fix the flaky login test', null, 'waiting', 9],
      3: ['/home/acme/web', 'Bump the router', 'green', 'idle', 6],
      4: ['/home/acme/billing', 'Migrate the invoice tables', 'blue', 'idle', 41],
      5: ['/home/acme/billing', 'Draft the refund API', null, 'ended', 70],
      6: ['/home/acme/billing', 'Audit the tax rounding', 'purple', 'busy', 3],
      7: ['/home/acme/docs', 'Rewrite the quickstart', null, 'idle', 15],
      8: ['/home/acme/docs', 'Check the broken links', null, 'waiting', 4],
    };
  const instances = ids.map((n): TerminalInstance => {
    const [realPath, title, color, status] = all[n];
    return {
      id: `wn-live-${n}`,
      view: {
        type: 'terminal',
        project: { hash: `wn-live-project-${realPath}`, realPath },
        resumeSessionId: `wn-live-session-${n}`,
      },
      report: {
        pid: null,
        sessionId: `wn-live-session-${n}`,
        title,
        color,
        termStatus: status === 'ended' ? 'exited' : 'running',
        gitBranch: n === 4 ? 'invoices-v2' : 'main',
      },
    };
  });
  const registry = ids
    .filter(n => all[n][3] !== 'ended')
    .map((n): ActiveSession => {
      const [cwd, , , status, since] = all[n];
      return {
        pid: 0,
        sessionId: `wn-live-session-${n}`,
        cwd,
        status,
        startedAt: now - (since + 30) * min,
        statusUpdatedAt: now - since * min,
        source: 'registry',
        ...(status === 'waiting'
          ? { waitingFor: n === 2 ? 'input needed' : 'permission prompt' }
          : {}),
      };
    });
  const activity = (
    n: number,
    tool: { name: string; arg: string } | null,
    used: number,
    delegates: string[] = []
  ): SessionActivity => ({
    sessionId: `wn-live-session-${n}`,
    title: null,
    titleSource: null,
    transcriptPath: null,
    activity: null,
    lastTool: tool,
    delegates: delegates.map((name, i) => ({ id: `wn-agent-${n}-${i}`, name, at: now })),
    lastActivityAt: now,
    toolCount: 0,
    errorCount: 0,
    model: 'claude-opus-5-5',
    context: { used, max: 200_000 },
    spend: null,
    spendEstimated: false,
    tokens: 0,
    cwd: all[n][0],
    recent: [],
    endedAt: null,
  });
  const tails = [
    activity(1, { name: 'Edit', arg: '/home/acme/web/src/net/retry.ts' }, 92_000, [
      'Explore',
      'code-reviewer',
    ]),
    activity(2, null, 64_000),
    activity(3, null, 30_000),
    activity(4, null, 174_000),
    activity(6, { name: 'Bash', arg: 'cd ledger && npm test' }, 51_000),
    activity(7, null, 22_000),
    activity(8, { name: 'WebFetch', arg: 'https://example.com/docs' }, 12_000),
  ];
  // Session 4's turn ended while another tab was on screen.
  const attention: AttentionState = {
    seq: 10,
    byId: {
      'wn-live-4': { tone: 'idle', from: 'busy', seq: 3, unseen: true },
      'wn-live-7': { tone: 'idle', from: 'busy', seq: 4, unseen: true },
    },
  };
  return { instances, registry, tails, attention };
}

function PreviewLiveTabs({ ids, currentId }: { ids: number[]; currentId: string }): ReactNode {
  const [preview] = useState(() => previewTabs(Date.now(), ids));
  return (
    <TabAttentionContext.Provider value={preview.attention}>
      <SessionTabs
        instances={preview.instances}
        currentId={currentId}
        onSelect={() => {}}
        onClose={() => {}}
        onNew={() => {}}
        activeSessions={preview.registry}
        activity={preview.tails}
      />
    </TabAttentionContext.Provider>
  );
}

function TabBarFrame({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="cl-whatsnew-frame cl-whatsnew-frame--tabs">
      <div className="cl-stabs-bar">
        <TabBarBack label="Back to app" title="Back to the app" onClick={() => {}} />
        {/* No view switch or rail toggle: the tabs are the subject, and the
            frame is narrower than a window. */}
        {children}
      </div>
      <div className="cl-transcript-inner">
        {TABS_TURNS.map((processed, i) => (
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

function TabLiveVisual(): ReactNode {
  return (
    <TabBarFrame>
      <PreviewLiveTabs ids={[1, 3, 4]} currentId="wn-live-3" />
    </TabBarFrame>
  );
}

function TabAttentionVisual(): ReactNode {
  return (
    <TabBarFrame>
      <PreviewLiveTabs ids={[2, 3, 4, 5]} currentId="wn-live-3" />
    </TabBarFrame>
  );
}

// More sessions than the bar holds: the row scrolls, and the edge past which
// sessions wait or finished unseen carries the mark that brings them back.
function TabOverflowVisual(): ReactNode {
  return (
    <TabBarFrame>
      <PreviewLiveTabs ids={[1, 2, 3, 4, 5, 6, 7, 8]} currentId="wn-live-1" />
    </TabBarFrame>
  );
}

// The branch the last turn ran on, in the strip at the foot of Mission
// Control's rail; its card names the worktree and the branches before it.
const PREVIEW_GIT: SessionGitState = {
  branch: 'invoices-v2',
  runs: [
    { branch: 'main', uuid: 'wn-git-1', timestamp: '2026-10-06T09:12:00.000Z' },
    { branch: 'invoices-v2', uuid: 'wn-git-2', timestamp: '2026-10-06T10:40:00.000Z' },
  ],
  worktree: {
    name: 'invoices-v2',
    path: '/home/acme/billing/.claude/worktrees/invoices-v2',
    branch: 'invoices-v2',
    originalBranch: 'main',
  },
};

function GitBranchVisual(): ReactNode {
  return (
    // Tall enough for the card the chip raises above the strip.
    <div className="cl-whatsnew-frame flex flex-col justify-end" style={{ minHeight: 260 }}>
      <EnvironmentStrip init={null} git={PREVIEW_GIT} />
    </div>
  );
}

// A side question answered above the composer: the thread is handed in, so
// nothing here reaches a session.
const PREVIEW_BTW: SideQuestions = {
  exchanges: [
    {
      id: 'wn-btw-1',
      question: 'Which file holds the retry delays now?',
      status: 'answered',
      response:
        '`src/net/backoff.ts` — `retry.ts` imports `delayFor(attempt)` from it and no longer keeps its own table.',
    },
  ],
  pending: false,
  ask: () => {},
  stop: () => {},
  retry: () => {},
  clear: () => {},
};

function SideQuestionVisual(): ReactNode {
  return (
    <div className="cl-whatsnew-frame">
      <div className="cl-transcript-inner">
        {TABS_TURNS.map((processed, i) => (
          <MessageBubble
            key={processed.msg.uuid}
            processed={processed}
            detailsFilter="minimal"
            onOpenToolDetail={() => {}}
            turnIndex={12 + i}
          />
        ))}
        <SideQuestionCard thread={PREVIEW_BTW} />
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
  remote: RemoteVisual,
  'background-shells': BackgroundShellsVisual,
  'live-orb': LiveOrbVisual,
  plan: PlanVisual,
  'parked-terminals': ParkedTerminalsVisual,
  'session-tabs': SessionTabsVisual,
  'project-files': ProjectFilesVisual,
  'web-sources': WebSourcesVisual,
  'tab-live': TabLiveVisual,
  'tab-attention': TabAttentionVisual,
  'tab-overflow': TabOverflowVisual,
  'git-branch': GitBranchVisual,
  'side-question': SideQuestionVisual,
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
 *  2.2.24 to 2.2.27 would otherwise never see 2.2.26's — or, on a fix-only
 *  release, the newest skipped entry leading the rest. Asked for from
 *  Settings: the newest entry this build has, and every one before it. */
function useWhatsNewView(asked: boolean) {
  const { data: seenVersion, isLoading } = useWhatsNewSeenVersion();
  const seen = seenVersion ?? null;
  const installed = whatsNewFor(appVersion);
  if (asked) {
    const release = installed ?? latestWhatsNew(appVersion);
    return release ? { release, earlier: releasesBefore(release.version), since: null } : null;
  }
  if (isLoading || !shouldShowWhatsNew(appVersion, seen, true)) return null;
  const skipped = seen ? releasesBetween(seen, appVersion) : [];
  if (installed) return { release: installed, earlier: skipped, since: seen };
  // A fix-only release authored nothing, but the ones skipped to reach it did:
  // the newest of them leads, or a jump past them would never show them.
  if (!skipped.length) return null;
  return { release: skipped[0], earlier: skipped.slice(1), since: seen };
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
