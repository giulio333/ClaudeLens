# SDK Chat rendering — end-of-turn flash / "written twice"

Status: **fixed — stream as the source of truth** (the clean fix from §7 is now
implemented). The in-app SDK chat no longer reads disk for display after the
initial seed, so the end-of-turn reconcile blink is gone. The history below is
kept for context; §6 (band-aids) and the "not yet done" framing of §7 are
superseded by §9 (what shipped).

This document captures everything learned while chasing the "the message flashes /
gets written twice when a turn finishes" bug in the in-app SDK chat.

---

## 1. Symptoms reported

- Sending a message in the SDK chat: the reply streams in, but **when the turn
  finishes the chat does an ugly refresh**.
- Later framing: at the end the message looks **"written twice"**, and for a
  fraction of a second a **duplicate** of the message is visible.
- After the first-message fix (see §6): the **first** message is smooth, but
  **from the second turn on** there are "strange movements" (the reply blinks out
  and back).

All of this is in the **dedicated SDK chat** (the in-app composer), not the
Terminal/Lens read-only view.

---

## 2. How the SDK chat renders today (the architecture that causes this)

Two important facts about the current design:

1. **`ChatView` is fundamentally a disk-backed transcript viewer.** Its single
   source of truth is `useChatSession(hash, filename)` (`src/hooks/useIPC.ts`),
   which reads the session transcript from
   `~/.claude/projects/<hash>/<id>.jsonl` via the `sessions:getChat` IPC. It was
   originally built to *view* existing sessions; the SDK chat/composer was added
   on top later.

2. **The SDK live stream is an overlay, not the source of truth.** During a turn,
   `useLiveTurn` (`src/components/project/chat/useLiveTurn.ts`) overlays the SDK
   stream on top of a frozen disk snapshot:
   - `onSend` snapshots the current disk `messages` into `frozenMessages` and sets
     an optimistic `__pending_user__` user bubble.
   - `onLiveMessagesChange` accumulates the fully-formed messages the SDK emits
     (`liveMessages`), `onStreamChange` feeds the partial assistant text
     (`liveText`, rendered by the separate `LiveTurn` node), `onStreamingChange`
     drives `streaming`.
   - `displayMessages` (what gets rendered) is therefore:
     - **idle** (`pendingUser === null`): `weave(messages)` — i.e. the **disk** read.
     - **in-flight**: `frozenMessages + __pending_user__ + liveMessages`.
   - At turn end it **reconciles**: it throws the overlay away
     (`setPendingUser(null); setFrozenMessages(null); setLiveMessages([])`) and
     goes **back to rendering the disk read**.

So the data flow for one turn is: **disk → stream overlay → disk again.** The
stream is treated as ephemeral even though it already contains the whole turn
(with the *same message uuids* the disk uses — see §5).

### Two views, not one

- **`NewChatView`** (`src/components/project/chat/NewChatView.tsx`) handles a
  **new** chat. The SDK chat entry point **always opens a new chat**; existing
  sessions can only be reopened via Terminal/Lens. So in normal use the **first
  turn always happens in `NewChatView`**.
- When the first turn finishes, `NewChatView` builds a minimal `SessionSummary`
  and calls `onCreated(...)`, which **navigates to `ChatView`** for the real
  session. That navigation **remounts** into a different component, which then
  re-reads the transcript from disk.
- Turns **2+** happen in `ChatView` with its own composer, exercising the
  `useLiveTurn` overlay + reconcile path described above.

---

## 3. Root cause

Both the first-turn flash and the turn-2+ flash are the **same** underlying bug:
**the view switches to a disk read that is still being written** (a mid-write
snapshot), so the just-streamed reply momentarily disappears and then reappears
when the rest of the `.jsonl` lands.

The transcript `.jsonl` is appended **during** the turn. A `chokidar` watcher
(`electron/main.ts`) fires `data:changed` on every write, which invalidates the
`['sessions:chat', …]` React Query and triggers a refetch (the refetch is also
explicitly kicked at `chatDone` via `onTurnComplete={refetch}` in `ChatView`).

- **Turn 2+ (in `ChatView`):** the reconcile in `useLiveTurn` fired as soon as
  the disk read grew past the pre-send length (`messages.length >
  pendingBaseCount`). But the disk often grows by the **user-echo line first**,
  before the assistant reply is flushed. So the reconcile swapped the live
  transcript (reply present) for a disk snapshot that had the user line but **not
  the assistant reply** → the reply blinked out, then came back on the next
  refetch.
- **Turn 1 (`NewChatView` → `ChatView`):** `NewChatView` navigated the instant the
  turn ended; `ChatView` mounted and read disk while it was still mid-write
  (user line only), so the reply the user had just watched stream in disappeared,
  then reappeared.

---

## 4. The diagnostic that nailed it (re-usable)

Guessing failed repeatedly. What worked was a **render trace** gated behind a
window flag. To re-add it, drop this right after `processed` is computed in
`ChatView`:

```ts
if (typeof window !== 'undefined' && (window as unknown as { __CL_DEBUG_CHAT?: boolean }).__CL_DEBUG_CHAT) {
  const last = processed[processed.length - 1];
  const lastText = last?.msg.content.find(b => b.type === 'text');
  const len = lastText && lastText.type === 'text' ? lastText.text.length : 0;
  console.log(
    `[cl-chat] streaming=${streaming} fromDisk=${displayMessages === messages} liveText=${liveText.length} liveMsgs=${liveMessageCount} turns=${processed.length} lastRole=${last?.msg.role} lastTextLen=${len} lastUuid=${last?.msg.uuid?.slice(0, 8)}`
  );
}
```

Then in DevTools: `window.__CL_DEBUG_CHAT = true`, send a message, read the lines.
`fromDisk = displayMessages === messages` tells you whether the render is the disk
read (idle/reconciled) or the live overlay.

> ⚠️ Lint notes for the trace: do **not** use a `useRef` counter or
> `performance.now()` in the render body — `react-hooks/refs` and
> `react-hooks/purity` reject them. A plain flat `console.log` is fine.

### Captured data (annotated)

**Turn 1 (in `ChatView`, after navigating from `NewChatView`):**

```
streaming=false fromDisk=false len=0  ...                      // mount, loading
streaming=false fromDisk=true  len=1  lastRole=user      ...   // disk: user only — REPLY GONE
streaming=false fromDisk=true  len=3  lastRole=assistant ...   // disk caught up — reply back
```

`streaming` is **always false** here → the SDK stream path never runs in
`ChatView` for turn 1; the streaming the user saw was in `NewChatView`. The flash
is the remount + mid-write disk read.

**Turn 3 (in `ChatView`, its own composer):**

```
streaming=true  fromDisk=false ... turns=3 lastRole=user        // optimistic prompt + thinking
streaming=true  fromDisk=false liveText=2/48/81 ... turns=3     // assistant text streaming (LiveTurn)
streaming=true  fromDisk=false liveMsgs=1 turns=4 lastRole=assistant lastUuid=5fd8921f   // reply completed (live)
streaming=false fromDisk=false liveMsgs=1 turns=4 lastRole=assistant lastUuid=5fd8921f   // chatDone, still live
streaming=false fromDisk=true  turns=3 lastRole=user  lastUuid=cadb0162   // RECONCILE to mid-write disk — REPLY GONE
streaming=false fromDisk=true  turns=4 lastRole=assistant lastUuid=5fd8921f               // disk caught up — reply back
```

The blink is the `turns=4 → turns=3 (user) → turns=4` sequence at reconcile.

---

## 5. Key facts discovered

- **Stream uuid == disk uuid.** The assistant message the SDK streams
  (`5fd8921f` above) has the **same uuid** as the persisted one on disk. The SDK
  and the transcript reader (`mapSdkMessageToChat` / `session-reader`) produce
  equivalent messages. This is what makes a uuid-based reconcile gate reliable.
- **The SDK chat always opens a *new* chat.** Existing sessions are only
  reopenable via Terminal/Lens. So turn 1 is always the `NewChatView → ChatView`
  remount path.
- **Slash-command output is never persisted to disk.** `/context`, `/usage`,
  `/compact` stream their real output as `<synthetic>`-model messages, but Claude
  Code writes only a placeholder line. This is why `useLiveTurn` has the
  `pinnedSlash` hack: it re-weaves the synthetic output back in after the
  reconcile. **This hack exists only because the reconcile throws the stream
  away.** A stream-as-truth design would not need it.
- The auto-scroll (`useAutoScroll`) pins to the bottom on every height change, so
  a reconcile that changes content height also produces a scroll jump on top of
  the visual flash.

---

## 6. Current mitigations in place (band-aids)

These reduce the symptom but keep the disk-reconcile design. They are **not** the
real fix.

1. **`NewChatView` — wait-for-disk + cache seed before navigating**
   (`onTurnComplete`):
   - Polls `sessions.getChat` until the on-disk transcript contains the live
     reply (by last-assistant-text length), up to ~2s.
   - Then `queryClient.setQueryData(['sessions:chat', hash, filename], disk)` to
     **seed** the cache so `ChatView` paints the complete transcript on its first
     render (the follow-up refetch returns identical content).
   - Status: **confirmed working** — turn 1 is now smooth.

2. **`useLiveTurn` — uuid-gated reconcile** (the reconcile `useEffect`):
   - Before reconciling, find the last non-synthetic assistant message in
     `liveMessages` and **do not reconcile until a message with that uuid exists
     on disk**. This prevents swapping to a mid-write snapshot.
   - Status: **applied, logically matches the captured data, pending final live
     confirmation by the user.**

Both are contained and tested (typecheck + lint + unit tests green). Neither
touches the SDK runner or the IPC layer.

---

## 7. The real fix: make the stream the source of truth for the SDK chat

The disk round-trip is the root of this whole class of bugs. For an in-app SDK
chat, **the live stream already has everything** (same uuids, same content, plus
the synthetic slash output the disk lacks). The clean design:

### Design

- On **mount**, read the transcript from disk **once** to load prior history
  (for a brand-new chat this is empty; for a resumed session it's the backlog).
- Keep a single in-memory **`sessionMessages`** array as the source of truth.
- On each completed turn, **append** the stream's messages (the existing
  `liveMessages`) to `sessionMessages`. Do **not** re-read disk.
- `displayMessages = sessionMessages + in-flight overlay` (optimistic prompt +
  current `liveText`/`liveMessages`). No reconcile step.
- Ignore the watcher's `sessions:chat` invalidation **for display** in this view
  (it can still refresh list-level metadata like cost/tokens via other queries).

### What this removes

- The **reconcile** entirely → no mid-write disk reads → **no blink**, for both
  turn 1 and turn 2+.
- The **`pinnedSlash` hack** → synthetic slash output is just part of the stream
  and stays naturally.
- The **`NewChatView` poll-and-seed band-aid** (§6.1).
- Likely the **`NewChatView` / `ChatView` split** itself: if the chat view starts
  from an in-memory array, a "new chat" is just that array starting empty — no
  remount/navigation handoff. Collapsing the two views would remove the turn-1
  remount class of bugs at the root. (Bigger change; optional follow-up.)

### Trade-offs / risks

- If something **external** modifies the `.jsonl` while the chat is open
  (Claude Code compaction, or the same session running in a terminal), the in-app
  view won't reflect it until remount. Acceptable for an actively-driven in-app
  chat; could be handled with an explicit "refresh from disk" affordance if ever
  needed.
- Long sessions hold all messages in React state (already effectively the case).
- Resumed sessions need the one-time disk load to be correct (history + the
  optimistic continuation appended after).
- Highlights anchor to message uuids; since stream uuid == disk uuid, anchoring
  against stream messages is fine. The only synthetic uuids are
  `__pending_user__` (already excluded via `isPersistableMessageUuid`).

### Suggested incremental, log-verifiable steps

1. Add the §4 render trace; capture a clean baseline for turns 1–3.
2. In `useLiveTurn`, stop reconciling to `messages`; instead append `liveMessages`
   to a persistent `sessionMessages` state at turn end, seeded once from the
   initial disk read. Keep `displayMessages` building from `sessionMessages`.
   Verify with the trace that `fromDisk` no longer flips at end-of-turn and the
   `turns=N → turns=N-1 → turns=N` blink is gone.
3. Remove `pinnedSlash` and confirm `/context` output survives a following turn
   purely from the stream.
4. (Optional, larger) Unify `NewChatView` into `ChatView` starting from an empty
   `sessionMessages`, removing the navigation handoff and the §6.1 band-aid.
5. Decide what (if anything) the watcher should still refresh for this view.

---

## 8. File reference

| File | Role |
|---|---|
| `src/components/project/chat/ChatView.tsx` | Disk-backed transcript view; hosts the composer for turns 2+; renders `displayMessages` from `useLiveTurn`. |
| `src/components/project/chat/useLiveTurn.ts` | The in-flight overlay state machine + the **reconcile** (the thing to remove for the real fix). Current uuid-gate band-aid lives here. |
| `src/components/project/chat/NewChatView.tsx` | New-chat view; streams turn 1, then navigates to `ChatView`. Current poll-and-seed band-aid lives here. |
| `src/components/project/chat/ChatComposer.tsx` | Wires the SDK stream events (`chatChunk`/`chatMessage`/`chatToolActivity`/`chatDone`) up to the parent handlers. |
| `src/components/project/chat/LiveTurn.tsx` | The separate provisional node for streaming text / "Using X…" indicator. |
| `src/hooks/useIPC.ts` | `useChatSession` (disk read + `keepLastGood`), the watcher-driven invalidation (`useDataChangedRefetch`). |
| `electron/modules/chat-runner.ts` | The SDK `ChatSession` that produces the stream + persists the `.jsonl`. |

---

## 9. What shipped (stream-as-truth)

The §7 design, contained scope (the `NewChatView`/`ChatView` split was kept; the
optional unification in §7 step 4 was **not** done).

**`useLiveTurn.ts`** now takes `(messages, { streamAsTruth, initialMessages })`:

- `streamAsTruth = false` → **Terminal/Lens** (`embedded`, read-only):
  `displayMessages = messages` (disk), watcher-driven. Nothing else runs — the
  live session belongs to the terminal's PTY, so the view must reflect disk.
- `streamAsTruth = true` → **in-app SDK chat**: an in-memory `sessionMessages`
  array is the source of truth. Seeded **once** (from `initialMessages` handed off
  by `NewChatView`, else the first loaded disk read), then disk is **ignored for
  display**. Each finished turn is **appended** straight from the stream — the
  optimistic user bubble (the SDK doesn't echo the prompt; materialized with a
  fresh uuid) + the streamed messages, deduped by uuid. **No reconcile.**

**Removed:** the reconcile `useEffect`, the uuid-gate band-aid, and **`pinnedSlash`
entirely** — `<synthetic>` slash-command output is just part of the stream now and
survives by being appended to `sessionMessages` like any other message.

**`NewChatView.tsx`:** the poll-and-seed band-aid (§6.1) is gone. On turn 1 it
hands the streamed turn to `ChatView` via `onCreated(summary, initialMessages)` →
the `chat` View's `initialMessages` → `useLiveTurn`'s seed, so `ChatView` paints
the finished turn immediately with **no disk read on mount** (no remount flash).

**`ChatView`** is keyed by `session.filename` in `ProjectOverview` so switching
sessions remounts and re-seeds (the in-memory transcript is per-mount state).
`onTurnComplete={refetch}` is kept but is now display-irrelevant (the watcher
keeps `messages` fresh only for metadata derivations like `inheritedModel`).

**Known trade-off:** a text highlight placed on a **user prompt** sent from the
in-app chat anchors to the generated uuid (≠ the disk uuid), so it won't survive a
full remount. Assistant content uses stream uuids that equal the disk ones, so it
survives. Acceptable; revisit only if user-prompt highlighting becomes important.
