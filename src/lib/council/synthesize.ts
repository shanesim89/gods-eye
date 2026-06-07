import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { currencySymbol } from "@/lib/format";
import type {
  AgentResult,
  AggregateRanking,
  CouncilContext,
  LaymanExplanation,
  PriceRange,
  TradeLevels,
  Verdict,
  VerdictType,
} from "./types";

const SONNET = "claude-sonnet-4-6";

const EMIT_VERDICT_TOOL: Anthropic.Tool = {
  name: "emit_verdict",
  description: "Emit the synthesized Investment Council verdict with actionable trade levels.",
  input_schema: {
    type: "object" as const,
    properties: {
      verdict: {
        type: "string" as const,
        enum: ["BUY", "HOLD", "SELL"],
        description: "Synthesized verdict",
      },
      confidence: {
        type: "integer" as const,
        description: "Overall confidence 0–100 (weighted average of agent confidences adjusted for disagreement)",
      },
      summary: {
        type: "string" as const,
        description: "3–4 sentence synthesis narrative explaining the verdict",
      },
      tradeLevels: {
        type: "object" as const,
        description: "Actionable price levels for the position",
        properties: {
          entry: {
            type: "object" as const,
            properties: {
              low: { type: "number" as const },
              high: { type: "number" as const },
            },
            required: ["low", "high"],
          },
          target: {
            type: "object" as const,
            properties: {
              low: { type: "number" as const },
              high: { type: "number" as const },
            },
            required: ["low", "high"],
          },
          stopLoss: { type: "number" as const, description: "Hard stop-loss price" },
          buyTrigger: {
            type: "number" as const,
            description: "HOLD only: price below which a BUY becomes attractive",
          },
          sellTrigger: {
            type: "number" as const,
            description: "HOLD only: price above which a SELL becomes attractive",
          },
          rationale: {
            type: "string" as const,
            description: "One sentence justifying the levels in terms of MA / support / resistance",
          },
        },
        required: ["entry", "target", "stopLoss", "rationale"],
      },
      laymanExplanation: {
        type: "object" as const,
        description: "Plain-English translation of the verdict + trade levels for a non-technical user. No jargon.",
        properties: {
          action: {
            type: "string" as const,
            description: "One short sentence starting with a verb (Buy/Sell/Wait/Avoid/Trim) telling the user what to do.",
          },
          why: {
            type: "array" as const,
            items: { type: "string" as const },
            description: "Exactly 3 short bullet reasons, <15 words each, plain English, anchored in the agents' findings. NO ticker symbols, NO indicator names (MA20, RSI, P/E), NO percentages — translate into everyday language ('the stock has been steadily rising', 'earnings have been growing', 'the company carries a lot of debt').",
          },
          whenToReconsider: {
            type: "string" as const,
            description: "One concrete sentence referencing a specific price from tradeLevels (buyTrigger / sellTrigger / stopLoss). Example: 'Sell if the price drops below $145.'",
          },
          whatToWatch: {
            type: "array" as const,
            items: { type: "string" as const },
            description: "1–2 short plain-English risks the user should watch for. Example: 'Earnings report on Jan 30 could swing the price.'",
          },
        },
        required: ["action", "why", "whenToReconsider", "whatToWatch"],
      },
    },
    required: ["verdict", "confidence", "summary", "tradeLevels", "laymanExplanation"],
  },
};

function computeRefs(ctx: CouncilContext) {
  const closes = ctx.candles?.closes ?? [];
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  return {
    current: ctx.price,
    high90d: closes.length ? closes.reduce((a, b) => Math.max(a, b), -Infinity) : null,
    low90d:  closes.length ? closes.reduce((a, b) => Math.min(a, b),  Infinity) : null,
    ma20:    closes.length >= 20 ? avg(closes.slice(-20)) : null,
    ma50:    closes.length >= 50 ? avg(closes.slice(-50)) : null,
    high52w: ctx.financials?.["52WeekHigh"] ?? null,
    low52w:  ctx.financials?.["52WeekLow"]  ?? null,
  };
}

function fmtRef(v: number | null | undefined, cur: string, dec = 2): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  return `${cur}${v.toFixed(dec)}`;
}

function buildReferenceBlock(ctx: CouncilContext): string {
  const r = computeRefs(ctx);
  const isCrypto = ctx.assetClass === "crypto";
  const priceDec = ctx.price < 1 ? 4 : 2;
  const cur = currencySymbol(ctx.currency);

  const lines = [
    `Current: ${fmtRef(r.current, cur, priceDec)}`,
    `90d High / Low: ${fmtRef(r.high90d, cur, priceDec)} / ${fmtRef(r.low90d, cur, priceDec)}`,
  ];
  if (r.ma20 != null) {
    const side = r.current > r.ma20 ? "ABOVE" : "BELOW";
    lines.push(`MA20: ${fmtRef(r.ma20, cur, priceDec)} (price ${side})`);
  }
  if (r.ma50 != null) {
    const side = r.current > r.ma50 ? "ABOVE" : "BELOW";
    lines.push(`MA50: ${fmtRef(r.ma50, cur, priceDec)} (price ${side})`);
  }
  if (!isCrypto && (r.high52w != null || r.low52w != null)) {
    lines.push(`52W High / Low: ${fmtRef(r.high52w, cur, priceDec)} / ${fmtRef(r.low52w, cur, priceDec)}`);
  }
  return lines.join("\n");
}

function buildKronosBlock(ctx: CouncilContext): string | null {
  const k = ctx.kronos;
  if (!k) return null;
  const sign = k.priceDeltaPct >= 0 ? "+" : "";
  const conviction =
    k.sampleStd < 1 ? "HIGH" : k.sampleStd < 3 ? "MODERATE" : "LOW";
  return [
    "KRONOS AI FORECAST",
    `Direction: ${k.direction.toUpperCase()} | Change: ${sign}${k.priceDeltaPct.toFixed(2)}% | Model conviction: ${conviction} (std-dev ${k.sampleStd.toFixed(2)}%)`,
  ].join("\n");
}

function fmtPct(v: number | null | undefined, dec = 1): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  return `${v.toFixed(dec)}%`;
}

function fmtNum(v: number | null | undefined, dec = 2): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  return v.toFixed(dec);
}

function buildFundamentalsBlock(ctx: CouncilContext): string | null {
  const f = ctx.financials;
  if (!f) return null;
  const pe = f.peNormalizedAnnual;
  const eps = f.epsTTM;
  const beta = f.beta;
  const roe = f.roeTTM;
  const margin = f.netProfitMarginTTM;
  const de = f.totalDebt_totalEquityQuarterly;
  const dy = f.dividendYieldIndicatedAnnual;
  const hasAny = [pe, eps, beta, roe, margin, de, dy].some((v) => v != null);
  if (!hasAny) return null;
  return [
    "FUNDAMENTALS",
    `P/E (TTM): ${fmtNum(pe, 1)} | EPS (TTM): ${fmtNum(eps, 2)} | Beta: ${fmtNum(beta, 2)}`,
    `ROE: ${fmtPct(roe)} | Profit margin: ${fmtPct(margin)} | Debt/Equity: ${fmtNum(de, 2)} | Div yield: ${fmtPct(dy, 2)}`,
  ].join("\n");
}

function buildAnalystSynthBlock(ctx: CouncilContext): string | null {
  const a = ctx.analyst;
  if (!a) return null;
  const cur = currencySymbol(ctx.currency);
  const priceDec = ctx.price < 1 ? 4 : 2;
  const hasTarget = a.targetMean != null;
  const hasRating = a.rating != null || a.ratingCount != null;
  if (!hasTarget && !hasRating) return null;
  const lines: string[] = [`ANALYST CONSENSUS (${a.ratingCount ?? "?"} analysts)`];
  if (hasTarget) {
    lines.push(
      `Target low / mean / high: ${fmtRef(a.targetLow, cur, priceDec)} / ${fmtRef(a.targetMean, cur, priceDec)} / ${fmtRef(a.targetHigh, cur, priceDec)}`
    );
    lines.push(`Implied upside (mean vs current): ${fmtPct(a.upsidePct, 1)}`);
  }
  if (hasRating) {
    const rk = (a.rating ?? "n/a").toUpperCase();
    const t = a.trend;
    const trendStr = t
      ? ` (strongBuy ${t.strongBuy} / buy ${t.buy} / hold ${t.hold} / sell ${t.sell} / strongSell ${t.strongSell})`
      : "";
    lines.push(`Rating: ${rk} [mean ${fmtNum(a.ratingMean, 2)}]${trendStr}`);
  }
  if (a.sector || a.industry) {
    lines.push(`Sector / Industry: ${a.sector ?? "n/a"} / ${a.industry ?? "n/a"}`);
  }
  return lines.join("\n");
}

function validateLevels(verdict: VerdictType, t: TradeLevels | undefined | null): TradeLevels | null {
  if (!t) return null;
  if (!t.entry || !t.target) return null;
  if (!(t.entry.low > 0 && t.entry.high >= t.entry.low)) return null;
  if (!(t.target.low > 0 && t.target.high >= t.target.low)) return null;
  if (!(t.stopLoss > 0)) return null;
  if (verdict === "BUY"  && t.stopLoss >= t.entry.low)  return null;
  if (verdict === "SELL" && t.stopLoss <= t.entry.high) return null;
  return t;
}

function buildPeerConsensusBlock(aggregateRankings: AggregateRanking[]): string {
  const lines = ["PEER CONSENSUS (anonymized blind ranking — all analysts rated each other's reasoning quality):"];
  aggregateRankings.forEach((ar, i) => {
    const tag =
      i === 0 ? "  ← PEER #1 (most credible reasoning)" :
      i === aggregateRankings.length - 1 ? "  ← PEER LAST (weakest reasoning)" : "";
    lines.push(`  ${i + 1}. ${ar.role} — avg rank ${ar.avgRank.toFixed(1)}, #1 votes: ${ar.topVotes}${tag}`);
  });
  lines.push("When signals conflict, weight the most peer-endorsed analysis more heavily.");
  return lines.join("\n");
}

export async function synthesizeVerdict(
  agents: AgentResult[],
  ctx: CouncilContext,
  anthropic: Anthropic,
  aggregateRankings?: AggregateRanking[]
): Promise<Verdict> {
  const weights: Record<string, number> = {
    TECHNICAL: 0.20,
    FUNDAMENTAL: 0.25,
    "ON-CHAIN": 0.25,
    FLOW: 0.25,
    SENTIMENT: 0.20,
    MACRO: 0.20,
    RISK: 0.25,
    FORECAST: 0.15,  // experimental — modest weight until hit-rate validated
  };

  // Apply peer-review weight adjustments: top-ranked +10%, bottom-ranked -5%
  if (aggregateRankings && aggregateRankings.length > 0) {
    const best  = aggregateRankings[0].role;
    const worst = aggregateRankings[aggregateRankings.length - 1].role;
    if (best  in weights) weights[best]  = +(weights[best]  * 1.10).toFixed(3);
    if (worst in weights) weights[worst] = +(weights[worst] * 0.95).toFixed(3);
  }

  const agentSummary = agents
    .map((a) => {
      const w = weights[a.role] ?? 0.25;
      return `## ${a.role} (weight ${(w * 100).toFixed(0)}%, confidence ${a.confidence}%, signal: ${a.signal.toUpperCase()})
Thesis: ${a.thesis}
Key points:
${(Array.isArray(a.keyPoints) ? a.keyPoints : []).map((p) => `- ${p}`).join("\n")}`;
    })
    .join("\n\n");

  const refBlock = buildReferenceBlock(ctx);
  const fundBlock = buildFundamentalsBlock(ctx);
  const analystBlock = buildAnalystSynthBlock(ctx);
  const kronosBlock = buildKronosBlock(ctx);
  const priceDec = ctx.price < 1 ? 4 : 2;
  const cur = currencySymbol(ctx.currency);
  const extraContext = [fundBlock, analystBlock, kronosBlock].filter(Boolean).join("\n\n");
  const peerBlock = aggregateRankings?.length ? buildPeerConsensusBlock(aggregateRankings) : null;

  const systemPrompt = `You are the CHIEF INVESTMENT OFFICER of the Investment Council.
You must synthesize the analyses from 4 specialist agents into a single BUY / HOLD / SELL verdict for ${ctx.ticker}.

Asset class: ${ctx.assetClass.toUpperCase()}
Currency: ${ctx.currency} (all prices and trade levels in ${ctx.currency} — do NOT convert)
Current price: ${cur}${ctx.price.toFixed(priceDec)} (${ctx.changePct >= 0 ? "+" : ""}${ctx.changePct.toFixed(2)}% today)

AGENT REPORTS:
${agentSummary}

WEIGHTING GUIDE:
- TECHNICAL: 25%
- FUNDAMENTAL / ON-CHAIN / FLOW: 30%
- SENTIMENT: 20%
- MACRO / RISK: 25%

VERDICTS:
- BUY: 2+ agents bullish, weighted score > 60
- SELL: 2+ agents bearish, weighted score < 40
- HOLD: mixed signals or insufficient conviction

REFERENCE LEVELS (use these to ground your trade levels — do NOT invent prices):
${refBlock}
${extraContext ? `\n${extraContext}\n\nWeigh fundamentals against price action. If the analyst mean target diverges from your trade levels by more than 20%, address the divergence explicitly in your summary.\n` : ""}${peerBlock ? `\n${peerBlock}\n` : ""}
TRADE LEVEL RULES:
- BUY: entry near current or pullback to MA20/MA50; target = next resistance (90d high, 52W high); stop below recent swing low (10–15% below entry low)
- SELL: entry near current or rally to MA20/MA50; target = next support (90d low, 52W low); stop above recent swing high
- HOLD: entry/target/stop still required, anchored to current price as a neutral range. Additionally MUST set buyTrigger (price you'd flip to BUY, typically below MA50 or 90d low) and sellTrigger (price you'd flip to SELL, typically above 90d high or 52W high).
- All prices in same currency as current price.
- Round to 2 decimals for stocks/ETF/options-underlying. For crypto: use ${priceDec} decimals.
- The rationale field must be ONE sentence referencing specific levels (e.g. "Buy on pullback to MA20 at $145, target 90d high at $158, stop below 50d low.").

PLAIN-ENGLISH OUTPUT RULES (laymanExplanation field):
- The user is NOT a finance professional. Translate everything.
- BANNED in why[] and whatToWatch[]: "MA20", "MA50", "RSI", "MACD", "P/E", "EPS", "ROE", "support", "resistance", "breakout", "oversold", "overbought", ticker symbols, raw percentages, ratios, basis points.
- ALLOWED: "the price has been steadily climbing/falling", "earnings are growing/shrinking", "the company has a lot/little debt", "investors are upbeat/nervous", "competitors are doing better/worse".
- action: starts with a verb (Buy, Sell, Wait, Avoid, Trim, Hold). One short sentence. Match the BUY/HOLD/SELL verdict.
- why: EXACTLY 3 bullets. Each <15 words. Grounded in what the agents actually said — do not invent.
- whenToReconsider: MUST reference a concrete price in ${ctx.currency} that mirrors tradeLevels.buyTrigger (for HOLD/SELL), sellTrigger (for HOLD/BUY), or stopLoss. The user needs ONE clear number to remember.
- whatToWatch: 1–2 short risks in plain English. Mention upcoming catalysts only if known.
- For HOLD: action explains why waiting is better than acting now.
- For BUY: action tells the user to buy and at what kind of price (now vs. on a pullback).
- For SELL: action tells the user to sell or trim, and why now.

Call emit_verdict with your synthesized judgment, trade levels, AND laymanExplanation. Be decisive. No hedging.`;

  try {
    const response = await anthropic.messages.create({
      model: SONNET,
      max_tokens: 1024,
      system: systemPrompt,
      tools: [EMIT_VERDICT_TOOL],
      tool_choice: { type: "any" },
      messages: [
        {
          role: "user",
          content: `Synthesize the Investment Council analysis for ${ctx.ticker} and emit your verdict with trade levels.`,
        },
      ],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (toolUse?.type === "tool_use") {
      const input = toolUse.input as {
        verdict: VerdictType;
        confidence: number;
        summary: string;
        tradeLevels?: {
          entry?: PriceRange;
          target?: PriceRange;
          stopLoss?: number;
          buyTrigger?: number;
          sellTrigger?: number;
          rationale?: string;
        };
        laymanExplanation?: {
          action?: string;
          why?: unknown;
          whenToReconsider?: string;
          whatToWatch?: unknown;
        };
      };

      const verdictType = input.verdict ?? "HOLD";
      const rawLevels: TradeLevels | null =
        input.tradeLevels &&
        input.tradeLevels.entry &&
        input.tradeLevels.target &&
        typeof input.tradeLevels.stopLoss === "number"
          ? {
              entry: input.tradeLevels.entry,
              target: input.tradeLevels.target,
              stopLoss: input.tradeLevels.stopLoss,
              buyTrigger: input.tradeLevels.buyTrigger,
              sellTrigger: input.tradeLevels.sellTrigger,
              rationale: input.tradeLevels.rationale ?? "",
            }
          : null;

      const tradeLevels = validateLevels(verdictType, rawLevels);
      if (rawLevels && !tradeLevels) {
        console.warn(`[council] Invalid trade levels for ${ctx.ticker} (${verdictType}):`, rawLevels);
      }

      const rawLayman = input.laymanExplanation;
      const laymanExplanation: LaymanExplanation | null =
        rawLayman && typeof rawLayman.action === "string" && typeof rawLayman.whenToReconsider === "string"
          ? {
              action: rawLayman.action,
              why: Array.isArray(rawLayman.why)
                ? rawLayman.why.filter((p): p is string => typeof p === "string")
                : [],
              whenToReconsider: rawLayman.whenToReconsider,
              whatToWatch: Array.isArray(rawLayman.whatToWatch)
                ? rawLayman.whatToWatch.filter((p): p is string => typeof p === "string")
                : [],
            }
          : null;

      return {
        verdict: verdictType,
        confidence: Math.max(0, Math.min(100, input.confidence ?? 50)),
        summary: input.summary ?? "",
        agents,
        generatedAt: new Date().toISOString(),
        tradeLevels,
        currency: ctx.currency,
        laymanExplanation,
        aggregateRankings: aggregateRankings ?? undefined,
      };
    }

    return {
      verdict: "HOLD",
      confidence: 50,
      summary: "Synthesis unavailable — mixed signals across agents.",
      agents,
      generatedAt: new Date().toISOString(),
      tradeLevels: null,
      currency: ctx.currency,
      laymanExplanation: null,
      aggregateRankings: aggregateRankings ?? undefined,
    };
  } catch (err) {
    return {
      verdict: "HOLD",
      confidence: 0,
      summary: `Synthesis failed: ${err instanceof Error ? err.message : "unknown error"}`,
      agents,
      generatedAt: new Date().toISOString(),
      tradeLevels: null,
      currency: ctx.currency,
      laymanExplanation: null,
      aggregateRankings: aggregateRankings ?? undefined,
    };
  }
}
