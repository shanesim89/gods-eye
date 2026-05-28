import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { currencySymbol } from "@/lib/format";
import type {
  AgentResult,
  CouncilContext,
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
    },
    required: ["verdict", "confidence", "summary", "tradeLevels"],
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

export async function synthesizeVerdict(
  agents: AgentResult[],
  ctx: CouncilContext,
  anthropic: Anthropic
): Promise<Verdict> {
  const weights: Record<string, number> = {
    TECHNICAL: 0.25,
    FUNDAMENTAL: 0.30,
    "ON-CHAIN": 0.30,
    FLOW: 0.30,
    SENTIMENT: 0.20,
    MACRO: 0.25,
    RISK: 0.25,
  };

  const agentSummary = agents
    .map((a) => {
      const w = weights[a.role] ?? 0.25;
      return `## ${a.role} (weight ${(w * 100).toFixed(0)}%, confidence ${a.confidence}%, signal: ${a.signal.toUpperCase()})
Thesis: ${a.thesis}
Key points:
${a.keyPoints.map((p) => `- ${p}`).join("\n")}`;
    })
    .join("\n\n");

  const refBlock = buildReferenceBlock(ctx);
  const priceDec = ctx.price < 1 ? 4 : 2;
  const cur = currencySymbol(ctx.currency);

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

TRADE LEVEL RULES:
- BUY: entry near current or pullback to MA20/MA50; target = next resistance (90d high, 52W high); stop below recent swing low (10–15% below entry low)
- SELL: entry near current or rally to MA20/MA50; target = next support (90d low, 52W low); stop above recent swing high
- HOLD: entry/target/stop still required, anchored to current price as a neutral range. Additionally MUST set buyTrigger (price you'd flip to BUY, typically below MA50 or 90d low) and sellTrigger (price you'd flip to SELL, typically above 90d high or 52W high).
- All prices in same currency as current price.
- Round to 2 decimals for stocks/ETF/options-underlying. For crypto: use ${priceDec} decimals.
- The rationale field must be ONE sentence referencing specific levels (e.g. "Buy on pullback to MA20 at $145, target 90d high at $158, stop below 50d low.").

Call emit_verdict with your synthesized judgment AND trade levels. Be decisive. No hedging.`;

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

      return {
        verdict: verdictType,
        confidence: Math.max(0, Math.min(100, input.confidence ?? 50)),
        summary: input.summary ?? "",
        agents,
        generatedAt: new Date().toISOString(),
        tradeLevels,
        currency: ctx.currency,
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
    };
  }
}
