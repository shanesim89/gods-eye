import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { currencySymbol } from "@/lib/format";
import type { AssetClass, AgentResult, Signal, CouncilContext } from "./types";

const HAIKU = "claude-haiku-4-5-20251001";

export function getRoles(assetClass: AssetClass): string[] {
  switch (assetClass) {
    case "stocks": return ["TECHNICAL", "FUNDAMENTAL", "SENTIMENT", "MACRO"];
    case "etf":    return ["TECHNICAL", "FUNDAMENTAL", "SENTIMENT", "MACRO"];
    case "crypto": return ["TECHNICAL", "ON-CHAIN", "SENTIMENT", "MACRO"];
    case "options": return ["TECHNICAL", "FLOW", "SENTIMENT", "RISK"];
  }
}

function buildSystemPrompt(role: string, ctx: CouncilContext): string {
  const cur = currencySymbol(ctx.currency);
  const base = `You are the ${role} ANALYST on the Investment Council.
You are analyzing ${ctx.ticker} (${ctx.assetClass.toUpperCase()}).
Current price: ${cur}${ctx.price.toFixed(2)} ${ctx.currency} (${ctx.changePct >= 0 ? "+" : ""}${ctx.changePct.toFixed(2)}% today).
`;

  const extras: string[] = [];

  if (ctx.profile) {
    extras.push(`Company: ${ctx.profile.name} | ${ctx.profile.exchange} | ${ctx.profile.industry} | Market Cap: $${(ctx.profile.marketCap / 1000).toFixed(1)}B | Country: ${ctx.profile.country}`);
  }

  if (ctx.financials && Object.keys(ctx.financials).length > 0) {
    const fin = ctx.financials;
    const f = (k: string) => fin[k] != null ? String(fin[k]) : "n/a";
    extras.push(`Financials: P/E=${f("peNormalizedAnnual")} | EPS(TTM)=${f("epsTTM")} | Beta=${f("beta")} | ROE=${f("roeTTM")} | Profit Margin=${f("netProfitMarginTTM")} | Debt/Eq=${f("totalDebt_totalEquityQuarterly")} | 52W High=${cur}${f("52WeekHigh")} | 52W Low=${cur}${f("52WeekLow")}`);
  }

  if (ctx.candles) {
    const c = ctx.candles.closes;
    const last = c[c.length - 1];
    const first = c[0];
    const high = Math.max(...c);
    const low = Math.min(...c);
    const trendPct = first > 0 ? ((last - first) / first * 100).toFixed(1) : "n/a";
    extras.push(`90-day price: Start=${cur}${first.toFixed(2)}, Current=${cur}${last.toFixed(2)}, High=${cur}${high.toFixed(2)}, Low=${cur}${low.toFixed(2)}, 90d trend=${trendPct}%`);

    // Simple MA
    if (c.length >= 20) {
      const ma20 = c.slice(-20).reduce((a, b) => a + b, 0) / 20;
      extras.push(`MA20=${cur}${ma20.toFixed(2)} (price ${last > ma20 ? "above" : "below"} MA20)`);
    }
    if (c.length >= 50) {
      const ma50 = c.slice(-50).reduce((a, b) => a + b, 0) / 50;
      extras.push(`MA50=${cur}${ma50.toFixed(2)} (price ${last > ma50 ? "above" : "below"} MA50)`);
    }
  }

  if (ctx.news && ctx.news.length > 0) {
    const headlines = ctx.news
      .slice(0, 6)
      .map((n) => `- ${n.headline} (${n.source})`)
      .join("\n");
    extras.push(`Recent news:\n${headlines}`);
  }

  if (ctx.cryptoMeta) {
    const m = ctx.cryptoMeta;
    extras.push(`Crypto: ${m.name} | MCap=$${(m.marketCap / 1e9).toFixed(2)}B | Vol24h=$${(m.volume24h / 1e9).toFixed(2)}B | 7d=${m.change7d.toFixed(1)}% | 30d=${m.change30d.toFixed(1)}% | ATH change=${m.athChangePct.toFixed(1)}%`);
    if (m.description) extras.push(`About: ${m.description.slice(0, 300)}`);
  }

  if (ctx.optionsMeta) {
    const o = ctx.optionsMeta;
    extras.push(`Option: ${o.optionType} ${o.strike} exp ${o.expiry} on ${o.underlying} (underlying price ${cur}${o.underlyingPrice.toFixed(2)})`);
  }

  if (ctx.lunarcrush) {
    const lc = ctx.lunarcrush;
    const parts: string[] = [];
    if (lc.galaxyScore != null) parts.push(`Galaxy Score=${lc.galaxyScore}/100`);
    if (lc.altRank != null) parts.push(`AltRank=#${lc.altRank}`);
    if (lc.socialVolume != null) parts.push(`Social Volume=${lc.socialVolume.toLocaleString()}`);
    if (lc.sentiment != null) parts.push(`Sentiment=${lc.sentiment}/100`);
    if (parts.length > 0) extras.push(`LunarCrush: ${parts.join(" | ")}`);
  }

  const roleInstructions: Record<string, string> = {
    TECHNICAL: "Focus on price action, trend, moving averages, momentum, support/resistance. Identify whether the chart pattern is constructive or deteriorating.",
    FUNDAMENTAL: "Focus on valuation (P/E, market cap), earnings quality, margins, balance sheet strength, and growth profile. Is the stock cheap or expensive vs peers?",
    SENTIMENT: "Focus on news sentiment, social media data (LunarCrush if available), analyst positioning, and narrative momentum. Is the market bullish or bearish on this name?",
    MACRO: "Focus on macro environment: interest rates, sector rotation, risk-on/off, geopolitical factors, and correlation to major indices. Does the macro backdrop support this position?",
    "ON-CHAIN": "Focus on blockchain fundamentals: network activity, token supply dynamics, circulating vs max supply, volume/market cap ratio, and on-chain adoption signals.",
    FLOW: "Focus on options flow patterns, put/call ratios, implied volatility, open interest, and what the flow implies about institutional positioning.",
    RISK: "Focus on risk factors: time decay (theta), IV rank, liquidity risk, max loss scenario, probability of profit, and whether the risk/reward is favorable.",
  };

  const instruction = roleInstructions[role] ?? `Focus on your area of expertise: ${role}.`;

  return `${base}
DATA:
${extras.join("\n")}

YOUR ROLE: ${instruction}

Analyze the data above from your perspective. Be concise and direct. Call record_thesis with your findings.
Signal: bull (bullish/positive), bear (bearish/negative), or neutral (mixed/uncertain).
Confidence: 0–100 (how confident you are in your signal based on available data).
Thesis: 2–3 sentences maximum summarizing your view.
keyPoints: 3–4 sharp bullet points (no fluff, data-driven).`;
}

const RECORD_THESIS_TOOL: Anthropic.Tool = {
  name: "record_thesis",
  description: "Record your investment thesis after completing your analysis.",
  input_schema: {
    type: "object" as const,
    properties: {
      signal: {
        type: "string" as const,
        enum: ["bull", "bear", "neutral"],
        description: "Overall signal direction",
      },
      confidence: {
        type: "integer" as const,
        description: "Confidence level 0–100",
      },
      thesis: {
        type: "string" as const,
        description: "2–3 sentence thesis summary",
      },
      keyPoints: {
        type: "array" as const,
        items: { type: "string" as const },
        description: "3–4 key data-driven bullet points",
      },
    },
    required: ["signal", "confidence", "thesis", "keyPoints"],
  },
};

export async function runAgent(
  role: string,
  ctx: CouncilContext,
  anthropic: Anthropic
): Promise<AgentResult> {
  const systemPrompt = buildSystemPrompt(role, ctx);

  try {
    const response = await anthropic.messages.create({
      model: HAIKU,
      max_tokens: 512,
      system: systemPrompt,
      tools: [RECORD_THESIS_TOOL],
      tool_choice: { type: "any" },
      messages: [
        {
          role: "user",
          content: `Analyze ${ctx.ticker} from your ${role} perspective and call record_thesis with your findings.`,
        },
      ],
    });

    // Extract tool use block
    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (toolUse?.type === "tool_use") {
      const input = toolUse.input as {
        signal: Signal;
        confidence: number;
        thesis: string;
        keyPoints: string[];
      };
      return {
        role,
        signal: input.signal ?? "neutral",
        confidence: Math.max(0, Math.min(100, input.confidence ?? 50)),
        thesis: input.thesis ?? "",
        keyPoints: input.keyPoints ?? [],
      };
    }

    // Fallback: extract from text if tool not called
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join(" ");

    return {
      role,
      signal: "neutral",
      confidence: 50,
      thesis: text.slice(0, 300) || "Analysis unavailable.",
      keyPoints: [],
    };
  } catch (err) {
    return {
      role,
      signal: "neutral",
      confidence: 0,
      thesis: `Analysis failed: ${err instanceof Error ? err.message : "unknown error"}`,
      keyPoints: [],
    };
  }
}
