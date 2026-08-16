import type { CSSProperties, ReactNode } from 'react';
import type { SessionSummary } from '../../../types';
import { fmtCost, fmtModel } from '../utils';
import type { ContextState } from './context-window';
import { kTok } from './mission-feed';
import {
  ReadoutShell,
  ReadoutFill,
  ReadoutCell,
  ReadoutPart,
  ReadoutRule,
} from '../shared/ReadoutCard';
import { READOUT_RAMP } from '../shared/readout';

/**
 * The hover cards behind Mission Control's vitals line.
 *
 * The feed redesign folded the rail's 52px CONTEXT WINDOW block and the
 * SPEND gauge into a single compact line, and the numbers they carried
 * (`used · left · total`, `cache −$x · y% saved`) survived only as native
 * `title` tooltips — a grey OS rectangle that arrives a second late, can't be
 * styled, and reads nothing like the rail. These cards take that job back and
 * go one step further: each pairs the recovered figures with the *composition*
 * behind them, which is the part the old blocks never showed.
 *
 * Both are pointer-transparent by design. They hold no controls, so trapping
 * the cursor would only mean the card stays up after the pointer has left the
 * number it belongs to.
 */

/** Accent ramp for a part-of-whole. Same hue, three weights — mixing against
 *  `--cl-paper` (not white) so the ramp flips correctly in the dark theme. */
const RAMP = READOUT_RAMP;

/** Mission Control pins the card across the rail; the surface itself is shared. */
const card: CSSProperties = { position: 'absolute', top: 'calc(100% + 8px)', left: 20, right: 20 };

function Shell({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) {
  return (
    <ReadoutShell title={title} meta={meta} style={card}>
      {children}
    </ReadoutShell>
  );
}
const Fill = ReadoutFill;
const Cell = ReadoutCell;
const Part = ReadoutPart;
const Rule = ReadoutRule;

function Waiting({ text }: { text: string }) {
  return (
    <div className="font-mono" style={{ marginTop: 10, fontSize: 10, color: 'var(--cl-ink-4)' }}>
      {text}
    </div>
  );
}

/** CONTEXT WINDOW: occupancy, the used/left/total figures the old block
 *  spelled out, and what fills the window on the latest turn. */
export function ContextPopover({ ctx }: { ctx: ContextState | null }) {
  if (!ctx) {
    return (
      <Shell title="CONTEXT WINDOW">
        <Waiting text="waiting for the first turn…" />
      </Shell>
    );
  }

  const danger = ctx.pct >= 90;
  const left = Math.max(0, ctx.max - ctx.used);
  const share = (n: number) => (ctx.used > 0 ? (n / ctx.used) * 100 : 0);
  const windowLabel = ctx.max >= 1_000_000 ? '1M' : `${Math.round(ctx.max / 1000)}k`;
  const meta = [ctx.model ? fmtModel(ctx.model) : null, windowLabel].filter(Boolean).join(' · ');

  return (
    <Shell title="CONTEXT WINDOW" meta={meta}>
      <div className="flex items-center" style={{ gap: 11, marginTop: 11 }}>
        <span
          style={{
            font: '700 26px/1 var(--font-sans)',
            letterSpacing: '-0.03em',
            fontVariantNumeric: 'tabular-nums',
            color: danger ? 'var(--cl-danger)' : 'var(--cl-ink)',
          }}
        >
          {ctx.pct}
          <span style={{ fontSize: 13, color: 'var(--cl-ink-3)' }}>%</span>
        </span>
        <Fill pct={ctx.pct} color={danger ? 'var(--cl-danger)' : RAMP.full} height={5} />
      </div>

      <div className="flex" style={{ gap: 10, marginTop: 13 }}>
        <Cell label="USED" value={kTok(ctx.used)} />
        <Cell label="LEFT" value={kTok(left)} color="var(--cl-ok)" />
        <Cell label="TOTAL" value={kTok(ctx.max)} />
      </div>

      <Rule />
      <Part
        label="cache read"
        value={kTok(ctx.cacheRead)}
        share={share(ctx.cacheRead)}
        color={RAMP.soft}
      />
      <Part
        label="fresh input"
        value={kTok(ctx.freshInput)}
        share={share(ctx.freshInput)}
        color={RAMP.full}
      />
      <Part
        label="cache write"
        value={kTok(ctx.cacheWrite)}
        share={share(ctx.cacheWrite)}
        color={RAMP.mid}
      />
    </Shell>
  );
}

/** SESSION SPEND: the billed figure, what the cache took off it, and the
 *  token mix underneath. Mirrors the context card so the two read as one
 *  instrument rather than two tooltips. */
export function SpendPopover({ summary }: { summary: SessionSummary | undefined }) {
  if (!summary) {
    return (
      <Shell title="SESSION SPEND">
        <Waiting text="no cost recorded yet…" />
      </Shell>
    );
  }

  const saved = summary.cacheSavings ?? 0;
  const wouldBe = summary.estimatedCost + saved;
  const savedPct = wouldBe > 0 ? Math.round((saved / wouldBe) * 100) : 0;
  const tokens =
    summary.inputTokens + summary.outputTokens + summary.cacheReadTokens + summary.cacheWriteTokens;
  const share = (n: number) => (tokens > 0 ? (n / tokens) * 100 : 0);

  return (
    <Shell
      title="SESSION SPEND"
      meta={`${summary.messageCount} ${summary.messageCount === 1 ? 'msg' : 'msgs'}`}
    >
      <div className="flex items-center" style={{ gap: 11, marginTop: 11 }}>
        <span
          style={{
            font: '700 26px/1 var(--font-sans)',
            letterSpacing: '-0.03em',
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--cl-accent-ink)',
          }}
        >
          {fmtCost(summary.estimatedCost)}
        </span>
        {/* The bar is the bill that WASN'T paid: sage fills the share the
            prompt cache took off, accent the share actually billed. */}
        <span
          style={{
            flex: 1,
            height: 5,
            borderRadius: 999,
            overflow: 'hidden',
            display: 'flex',
            background: 'var(--cl-line-soft)',
          }}
        >
          <span style={{ width: `${100 - savedPct}%`, background: RAMP.full }} />
          <span style={{ width: `${savedPct}%`, background: 'var(--cl-ok)' }} />
        </span>
      </div>

      <div className="flex" style={{ gap: 10, marginTop: 13 }}>
        <Cell label="BILLED" value={fmtCost(summary.estimatedCost)} />
        <Cell
          label="CACHE SAVED"
          value={saved > 0 ? `−${fmtCost(saved)}` : '—'}
          color={saved > 0 ? 'var(--cl-ok)' : undefined}
        />
        <Cell label="WOULD BE" value={fmtCost(wouldBe)} />
      </div>
      <div className="font-mono" style={{ marginTop: 7, fontSize: 9.5, color: 'var(--cl-ink-4)' }}>
        {saved > 0
          ? `${savedPct}% of the full-price bill saved by the cache`
          : 'no cache reuse yet'}
      </div>

      <Rule />
      <Part
        label="cache read"
        value={kTok(summary.cacheReadTokens)}
        share={share(summary.cacheReadTokens)}
        color={RAMP.soft}
      />
      <Part
        label="input"
        value={kTok(summary.inputTokens)}
        share={share(summary.inputTokens)}
        color={RAMP.full}
      />
      <Part
        label="output"
        value={kTok(summary.outputTokens)}
        share={share(summary.outputTokens)}
        color="var(--cl-accent-ink)"
      />
      <Part
        label="cache write"
        value={kTok(summary.cacheWriteTokens)}
        share={share(summary.cacheWriteTokens)}
        color={RAMP.mid}
      />
    </Shell>
  );
}
