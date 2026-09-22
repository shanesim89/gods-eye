// Pure stage/score logic for the Market Stress module. No I/O — takes raw
// indicator values, returns statuses/scores/copy. Kept separate from
// fetchers so it's trivially testable and the thresholds live in one place.

export type Status = "GREEN" | "YELLOW" | "ORANGE" | "RED" | "CRITICAL";
export type Trend = "IMPROVING" | "STABLE" | "DETERIORATING" | "DETERIORATING_RAPIDLY";
export type DataQuality = "OK" | "DATA_LIMITED" | "UNAVAILABLE";

export type StageId = 1 | 2 | 3 | 4 | 5 | 6;

export type ChangeSet = { w1: number | null; m1: number | null; m3: number | null };

export type IndicatorReading = {
  key: string;
  label: string;
  value: number | null;
  prev: number | null;
  change: ChangeSet;
  status: Status;
  quality: DataQuality;
  percentile: number | null; // 0-100 historical percentile, null if unknown
};

export type StageResult = {
  id: StageId;
  title: string;
  status: Status;
  quality: DataQuality;
  indicators: IndicatorReading[];
};

// ── Rate-of-change classification ───────────────────────────────────────────

/** Classify a metric's trajectory from its 1w/1m/3m deltas. Sign convention:
 * positive delta = the metric is rising. `worseWhenRising` tells us whether a
 * rising value means stress is increasing (e.g. HY OAS) or decreasing (e.g.
 * breadth %). */
export function classifyTrend(change: ChangeSet, worseWhenRising: boolean): Trend {
  const { w1, m1 } = change;
  if (m1 == null) return "STABLE";
  const dir = worseWhenRising ? m1 : -m1;
  const dir1w = w1 == null ? dir : worseWhenRising ? w1 : -w1;
  if (dir <= 0) return dir < -1e-9 ? "IMPROVING" : "STABLE";
  // Deteriorating — check if the 1w pace implies acceleration vs the 1m pace.
  const monthlyPaceOverWeek = dir / 4.3; // ~weeks per month
  if (dir1w > 0 && dir1w > monthlyPaceOverWeek * 1.75) return "DETERIORATING_RAPIDLY";
  return "DETERIORATING";
}

// ── Per-indicator status thresholds (from spec) ─────────────────────────────

function bucket(value: number, cuts: [number, number, number, number], rising: boolean): Status {
  // cuts = ascending thresholds for GREEN|YELLOW|ORANGE|RED boundaries when rising=stress-up
  const [g, y, o, r] = cuts;
  const v = rising ? value : -value;
  const [gg, yy, oo, rr] = rising ? [g, y, o, r] : [-g, -y, -o, -r];
  if (rising) {
    if (v < gg) return "GREEN";
    if (v < yy) return "YELLOW";
    if (v < oo) return "ORANGE";
    if (v < rr) return "RED";
    return "CRITICAL";
  }
  if (v > gg) return "GREEN";
  if (v > yy) return "YELLOW";
  if (v > oo) return "ORANGE";
  if (v > rr) return "RED";
  return "CRITICAL";
}

export const THRESHOLDS = {
  hyOas: [3.0, 4.0, 5.5, 7.0] as [number, number, number, number], // % — rising = worse
  nfci: [-0.3, 0.0, 0.3, 0.6] as [number, number, number, number], // index — rising = worse
  breadthPct: [70, 55, 45, 35] as [number, number, number, number], // % above MA — falling = worse
  tenYrYoY: [0.5, 1.0, 1.75, 2.5] as [number, number, number, number], // pp change YoY — rising = worse
  vix: [16, 22, 28, 36] as [number, number, number, number], // level — rising = worse
};

export function hyOasStatus(v: number): Status {
  return bucket(v, THRESHOLDS.hyOas, true);
}
export function nfciStatus(v: number): Status {
  return bucket(v, THRESHOLDS.nfci, true);
}
export function breadthStatus(pctAbove200dma: number): Status {
  return bucket(pctAbove200dma, THRESHOLDS.breadthPct, false);
}
export function vixStatus(v: number): Status {
  return bucket(v, THRESHOLDS.vix, true);
}

const STATUS_RANK: Record<Status, number> = { GREEN: 0, YELLOW: 1, ORANGE: 2, RED: 3, CRITICAL: 4 };
export function worstStatus(statuses: Status[]): Status {
  return statuses.reduce((worst, s) => (STATUS_RANK[s] > STATUS_RANK[worst] ? s : worst), "GREEN" as Status);
}

// ── Stage weights + overall score ───────────────────────────────────────────

export const STAGE_WEIGHTS: Record<StageId, number> = {
  1: 0.10, // rates
  2: 0.20, // breadth
  3: 0.25, // credit
  4: 0.15, // earnings
  5: 0.10, // trend
  6: 0.20, // forced selling / financial conditions
};

const STATUS_SCORE: Record<Status, number> = { GREEN: 5, YELLOW: 30, ORANGE: 55, RED: 80, CRITICAL: 100 };

export function overallScore(stages: StageResult[]): number {
  let total = 0;
  for (const s of stages) total += STATUS_SCORE[s.status] * STAGE_WEIGHTS[s.id];
  return Math.round(total);
}

// ── Sequential-confirmation stage classification with shock override ───────

/**
 * Determine the current "stage" (1-6) the market sits at. Sequential model:
 * stage N is reached once stage N-1 is at least YELLOW/deteriorating AND
 * stage N's own indicators confirm. A shock override lets an extreme single
 * reading (credit or forced-selling CRITICAL) jump straight ahead regardless
 * of sequence, since real crises don't always progress tidily rates->credit.
 */
export function currentStage(stages: StageResult[]): { stage: StageId; shockOverride: boolean } {
  const byId = new Map(stages.map((s) => [s.id, s]));
  const credit = byId.get(3);
  const forced = byId.get(6);
  if (credit?.status === "CRITICAL" || forced?.status === "CRITICAL") {
    return { stage: 6, shockOverride: true };
  }
  if (credit?.status === "RED" || forced?.status === "RED") {
    return { stage: 5, shockOverride: true };
  }

  let reached: StageId = 1;
  for (const id of [1, 2, 3, 4, 5, 6] as StageId[]) {
    const s = byId.get(id);
    if (!s) break;
    const confirmed = STATUS_RANK[s.status] >= STATUS_RANK.YELLOW;
    if (confirmed) reached = id;
    else break;
  }
  return { stage: reached, shockOverride: false };
}

export function riskLevel(score: number): "LOW" | "MODERATE" | "ELEVATED" | "HIGH" | "SEVERE" {
  if (score < 20) return "LOW";
  if (score < 40) return "MODERATE";
  if (score < 60) return "ELEVATED";
  if (score < 80) return "HIGH";
  return "SEVERE";
}

// ── Copy rules ───────────────────────────────────────────────────────────
// Never predict a crash or a date. Always "risk is increasing/deteriorating"
// framing, never "will crash" / "about to crash" language.

export function scoreTrendCopy(prevScore: number | null, score: number): string {
  if (prevScore == null) return "Establishing baseline.";
  const delta = score - prevScore;
  if (delta > 5) return "Risk has been increasing.";
  if (delta < -5) return "Risk has been easing.";
  return "Risk is broadly stable.";
}
