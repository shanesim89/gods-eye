// Pure decision resolver: turns a council verdict + trade levels + the user's
// position + current price into a single actionable directive. No React, no
// server-only, no I/O — fully testable.
//
// Answers two questions per asset:
//   • not holding → LONG / SHORT / WAIT, with entry/stop/target
//   • holding     → ADD / HOLD / TRIM / EXIT, with a trigger price
//
// Conservatism: never LONG/SHORT/ADD below the action gate (confidence < 55);
// never SHORT on a long-only spot venue; a stop breach forces EXIT first;
// missing price or levels degrade to WAIT (flat) / HOLD (holding) — never throw.

import type { TradeLevels, VerdictType } from "./types";

export const ACTION_GATE = 55; // min confidence to take a directional action

export type Position =
  | { held: false }
  | { held: true; qty: number; costBasis: number | null }; // costBasis = TOTAL cost

export type WheelState = {
  kind: "wheel";
  state: "cash" | "holding_stock";
  shares: number;
  costBasisPerShare: number | null;
};

export type Venue = "research" | "spot" | "wheel";

export type DirectiveInput = {
  verdict: VerdictType;
  confidence: number;
  tradeLevels: TradeLevels | null | undefined;
  currentPrice: number | null;
  position: Position | WheelState;
  venue: Venue;
};

export type DirectiveStance =
  | "LONG" | "SHORT" | "WAIT"      // not holding
  | "ADD" | "HOLD" | "TRIM" | "EXIT"; // holding

export type DirectiveTone = "bullish" | "bearish" | "neutral" | "caution";

export type Directive = {
  held: boolean;
  stance: DirectiveStance;
  headline: string;      // short stance phrase, e.g. "Open a long"
  oneLiner: string;      // single plain sentence with the action + price
  triggerPrice: number | null;
  entry?: { low: number; high: number } | null;
  stop?: number | null;
  target?: { low: number; high: number } | null;
  pnlContext?: string | null;
  tone: DirectiveTone;
};

function isWheel(p: Position | WheelState): p is WheelState {
  return (p as WheelState).kind === "wheel";
}

function px(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "the level";
  const dec = Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 1 ? 2 : 4;
  return v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// ── Wheel (options) ─────────────────────────────────────────────────────────
function resolveWheel(input: DirectiveInput, w: WheelState): Directive {
  const { verdict, confidence } = input;
  const lowConv = confidence < ACTION_GATE;

  if (w.state === "cash") {
    if (verdict === "BUY" && confidence >= 65) {
      return {
        held: false, stance: "ADD", tone: "bullish",
        headline: "Sell cash-secured puts",
        oneLiner: "Sell cash-secured puts — happy to be assigned near support.",
        triggerPrice: null,
      };
    }
    if (verdict === "SELL") {
      return {
        held: false, stance: "WAIT", tone: "bearish",
        headline: "Pause new puts",
        oneLiner: "Pause new puts — council is bearish on the underlying.",
        triggerPrice: null,
      };
    }
    return {
      held: false, stance: "HOLD", tone: "neutral",
      headline: "Keep selling puts",
      oneLiner: lowConv ? "Low conviction — keep selling puts at target delta." : "Keep selling puts at target delta.",
      triggerPrice: null,
    };
  }

  // holding_stock
  if (verdict === "SELL") {
    return {
      held: true, stance: "TRIM", tone: "bearish",
      headline: "Sell covered calls",
      oneLiner: "Sell covered calls at/above cost — let the shares get called away.",
      triggerPrice: w.costBasisPerShare,
      pnlContext: w.costBasisPerShare != null ? `Cost basis ${px(w.costBasisPerShare)}/sh` : null,
    };
  }
  if (verdict === "BUY") {
    return {
      held: true, stance: "HOLD", tone: "bullish",
      headline: "Hold shares",
      oneLiner: "Hold the shares; sell calls further out of the money.",
      triggerPrice: null,
      pnlContext: w.costBasisPerShare != null ? `Cost basis ${px(w.costBasisPerShare)}/sh` : null,
    };
  }
  return {
    held: true, stance: "HOLD", tone: "neutral",
    headline: "Hold shares",
    oneLiner: "Hold the shares; sell covered calls at target delta.",
    triggerPrice: null,
    pnlContext: w.costBasisPerShare != null ? `Cost basis ${px(w.costBasisPerShare)}/sh` : null,
  };
}

// ── Not holding (research / spot) ───────────────────────────────────────────
function resolveFlat(input: DirectiveInput): Directive {
  const { verdict, confidence, tradeLevels: L, currentPrice: p, venue } = input;
  const lowConv = confidence < ACTION_GATE;
  const levels = L
    ? { entry: L.entry, stop: L.stopLoss, target: L.target }
    : { entry: null, stop: null, target: null };

  const wait = (oneLiner: string, tone: DirectiveTone, trigger: number | null = null): Directive => ({
    held: false, stance: "WAIT", tone, headline: "Stay flat", oneLiner,
    triggerPrice: trigger, entry: levels.entry, stop: levels.stop, target: levels.target,
  });

  if (p == null || L == null) return wait("No actionable price levels yet — wait for the next read.", "neutral");
  if (lowConv) return wait("Conviction too low to commit — wait for a clearer signal.", "neutral");

  const inEntry = p >= L.entry.low && p <= L.entry.high;
  const belowEntry = p < L.entry.low;
  const aboveEntry = p > L.entry.high;
  const atTarget = p >= L.target.low;

  if (verdict === "BUY") {
    if (inEntry || belowEntry) {
      return {
        held: false, stance: "LONG", tone: "bullish",
        headline: "Open a long",
        oneLiner: `Long here — buy up to ${px(L.entry.high)}, stop ${px(L.stopLoss)}, target ${px(L.target.low)}–${px(L.target.high)}.`,
        triggerPrice: L.entry.high, entry: L.entry, stop: L.stopLoss, target: L.target,
      };
    }
    if (aboveEntry && !atTarget) return wait(`Above the buy zone — wait for a pullback to ${px(L.entry.high)}.`, "caution", L.entry.high);
    return wait("Already near target — don't chase; wait for a reset.", "caution");
  }

  if (verdict === "HOLD") {
    if (L.buyTrigger != null && p <= L.buyTrigger) {
      return {
        held: false, stance: "LONG", tone: "bullish",
        headline: "Open a long",
        oneLiner: `Dipped below ${px(L.buyTrigger)} — start a long, stop ${px(L.stopLoss)}.`,
        triggerPrice: L.buyTrigger, entry: L.entry, stop: L.stopLoss, target: L.target,
      };
    }
    return wait(
      L.buyTrigger != null ? `Neutral — only buy on a dip to ${px(L.buyTrigger)}.` : "Neutral — no edge yet, stay flat.",
      "neutral", L.buyTrigger ?? null
    );
  }

  // SELL
  if (venue === "spot") return wait("Bearish, but the bot is long-only spot — stay flat (no short).", "bearish");
  if (belowEntry || inEntry) return wait("Bearish, but price is already low — poor short reward/risk; wait.", "caution");
  return {
    held: false, stance: "SHORT", tone: "bearish",
    headline: "Open a short",
    oneLiner: `Short here — entry ${px(L.entry.high)}, stop ${px(L.stopLoss)}, target ${px(L.target.low)}–${px(L.target.high)}.`,
    triggerPrice: L.entry.high, entry: L.entry, stop: L.stopLoss, target: L.target,
  };
}

// ── Holding (research / spot) ───────────────────────────────────────────────
function resolveHeld(input: DirectiveInput, pos: { qty: number; costBasis: number | null }): Directive {
  const { verdict, confidence, tradeLevels: L, currentPrice: p } = input;
  const lowConv = confidence < ACTION_GATE;

  let pnlContext: string | null = null;
  if (p != null && pos.costBasis != null && pos.costBasis > 0) {
    const pnlPct = ((p * pos.qty - pos.costBasis) / pos.costBasis) * 100;
    pnlContext = `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}% on position`;
  }

  const base = (stance: DirectiveStance, tone: DirectiveTone, headline: string, oneLiner: string, trigger: number | null): Directive => ({
    held: true, stance, tone, headline, oneLiner, triggerPrice: trigger,
    entry: L?.entry ?? null, stop: L?.stopLoss ?? null, target: L?.target ?? null, pnlContext,
  });

  // Stop breach overrides everything.
  if (p != null && L != null && p < L.stopLoss) {
    return base("EXIT", "bearish", "Exit now", `Price broke the stop at ${px(L.stopLoss)} — exit the position.`, L.stopLoss);
  }
  if (p == null || L == null) {
    return base("HOLD", "neutral", "Hold", "No fresh levels — hold and reassess next read.", null);
  }

  const inEntry = p >= L.entry.low && p <= L.entry.high;
  const belowEntry = p < L.entry.low;
  const aboveEntry = p > L.entry.high;
  const atTarget = p >= L.target.low;

  if (verdict === "BUY") {
    if (lowConv) return base("HOLD", "neutral", "Hold", "Bullish but low conviction — hold what you have.", null);
    if (inEntry || belowEntry) return base("ADD", "bullish", "Add to position", `Add up to ${px(L.entry.high)}; stop ${px(L.stopLoss)}.`, L.entry.high);
    if (atTarget) return base("TRIM", "caution", "Take some profit", `Near target — trim into ${px(L.target.low)}–${px(L.target.high)}.`, L.target.low);
    return base("HOLD", "bullish", "Hold", `Hold toward target ${px(L.target.low)}–${px(L.target.high)}.`, L.target.low);
  }

  if (verdict === "HOLD") {
    if (L.sellTrigger != null && p >= L.sellTrigger) return base("TRIM", "caution", "Take some profit", `Rallied past ${px(L.sellTrigger)} — trim and lock gains.`, L.sellTrigger);
    if (L.buyTrigger != null && p <= L.buyTrigger) return base("ADD", "bullish", "Add to position", `Dipped to ${px(L.buyTrigger)} — add on weakness.`, L.buyTrigger);
    return base("HOLD", "neutral", "Hold", "Neutral — hold; no add or trim trigger hit.", null);
  }

  // SELL
  if (lowConv) return base("HOLD", "caution", "Hold, tighten stop", `Weak sell — hold but tighten stop to ${px(L.stopLoss)}.`, L.stopLoss);
  if (atTarget || aboveEntry) return base("TRIM", "caution", "Trim", `Trim into strength toward ${px(L.target.low)}; hard stop ${px(L.stopLoss)}.`, L.target.low);
  return base("EXIT", "bearish", "Exit", `Bearish — exit; stop ${px(L.stopLoss)}.`, L.stopLoss);
}

export function resolveDirective(input: DirectiveInput): Directive {
  const { position } = input;
  if (isWheel(position)) return resolveWheel(input, position);
  if (position.held) return resolveHeld(input, position);
  return resolveFlat(input);
}
