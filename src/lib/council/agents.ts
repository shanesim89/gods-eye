import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { currencySymbol } from "@/lib/format";
import type { AssetClass, AgentResult, Signal, CouncilContext, PeerRanking, AggregateRanking } from "./types";

const HAIKU = "claude-haiku-4-5-20251001";

export function getRoles(assetClass: AssetClass): string[] {
  switch (assetClass) {
    case "stocks":  return ["TECHNICAL", "FUNDAMENTAL", "SENTIMENT", "MACRO", "FORECAST"];
    case "etf":     return ["TECHNICAL", "FUNDAMENTAL", "SENTIMENT", "MACRO", "FORECAST"];
    case "crypto":  return ["TECHNICAL", "ON-CHAIN", "SENTIMENT", "MACRO", "FORECAST"];
    case "options": return ["TECHNICAL", "FLOW", "SENTIMENT", "RISK"]; // no FORECAST for options
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
    const fNum = (k: string, dec = 2) => {
      const v = fin[k];
      return v != null && Number.isFinite(v) ? Number(v).toFixed(dec) : "n/a";
    };
    const fPct = (k: string) => {
      const v = fin[k];
      return v != null && Number.isFinite(v) ? `${Number(v).toFixed(1)}%` : "n/a";
    };
    const fMoney = (k: string) => {
      const v = fin[k];
      if (v == null || !Number.isFinite(v)) return "n/a";
      const n = Number(v);
      if (Math.abs(n) >= 1e12) return `${cur}${(n / 1e12).toFixed(2)}T`;
      if (Math.abs(n) >= 1e9)  return `${cur}${(n / 1e9).toFixed(2)}B`;
      if (Math.abs(n) >= 1e6)  return `${cur}${(n / 1e6).toFixed(2)}M`;
      return `${cur}${n.toFixed(0)}`;
    };
    // Valuation block
    extras.push(
      `Valuation: P/E(TTM)=${fNum("peNormalizedAnnual", 1)} | P/E(Fwd)=${fNum("peForward", 1)} | EPS(TTM)=${cur}${fNum("epsTTM")} | EPS(Fwd)=${cur}${fNum("epsForward")} | PEG=${fNum("pegRatio", 2)} | P/B=${fNum("priceToBook", 2)} | P/S=${fNum("priceToSales", 2)} | EV/EBITDA=${fNum("evToEbitda", 1)} | EV/Rev=${fNum("evToRevenue", 2)}`
    );
    // Profitability block
    extras.push(
      `Profitability: Gross Mgn=${fPct("grossMarginTTM")} | Profit Mgn=${fPct("netProfitMarginTTM")} | Oper Mgn=${fPct("operatingMarginTTM")} | EBITDA Mgn=${fPct("ebitdaMarginTTM")} | ROE=${fPct("roeTTM")} | ROA=${fPct("roaTTM")} | D/E=${fNum("totalDebt_totalEquityQuarterly")} | Quick=${fNum("quickRatio", 2)} | Beta=${fNum("beta", 2)}`
    );
    // Growth + ownership block
    extras.push(
      `Growth: Rev Growth YoY=${fPct("revenueGrowthYoYPct")} | EPS Growth YoY=${fPct("earningsGrowthYoYPct")} | Short Ratio=${fNum("shortRatio", 1)}d | Insider=${fPct("heldByInsidersPct")} | Institutional=${fPct("heldByInstitutionsPct")}`
    );
    // 52-week range
    extras.push(`52W High=${cur}${fNum("52WeekHigh")} | 52W Low=${cur}${fNum("52WeekLow")} | Div Yield=${fPct("dividendYieldIndicatedAnnual")}`);
  }

  // Next earnings date (high relevance for SENTIMENT/MACRO agents)
  if (ctx.nextEarningsDate) {
    const daysUntil = Math.round((new Date(ctx.nextEarningsDate).getTime() - Date.now()) / 86400000);
    const urgency = daysUntil <= 7 ? " ← IMMINENT" : daysUntil <= 30 ? " ← upcoming" : "";
    extras.push(`Next earnings: ${ctx.nextEarningsDate} (${daysUntil > 0 ? `in ${daysUntil} days` : `${Math.abs(daysUntil)} days ago`})${urgency}`);
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

  if (ctx.kronos) {
    const k = ctx.kronos;
    const sign = k.priceDeltaPct >= 0 ? "+" : "";
    const uncertainty = k.sampleStd > 0
      ? `Uncertainty (sample std-dev): ${k.sampleStd.toFixed(2)}% — ${
          k.sampleStd < 1 ? "high model conviction" :
          k.sampleStd < 3 ? "moderate conviction" : "low conviction / noisy signal"
        }`
      : "";
    const barCloses = k.bars.length
      ? `Bar-by-bar predicted closes: [${k.bars.map((b) => b.close.toFixed(2)).join(", ")}]`
      : "";
    extras.push(
      `Kronos AI forecast (next ${k.bars.length || "N"} bars):\n` +
      `Direction: ${k.direction.toUpperCase()}\n` +
      `Predicted price change: ${sign}${k.priceDeltaPct.toFixed(2)}%\n` +
      (uncertainty ? `${uncertainty}\n` : "") +
      (barCloses ? `${barCloses}\n` : "")
    );
  } else if (role === "FORECAST") {
    extras.push("Kronos forecast: UNAVAILABLE (model endpoint not reachable or timed out)");
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
    FORECAST: "You are the QUANTITATIVE FORECAST ANALYST. Your sole input is the Kronos foundation-model prediction above. Report: (1) direction and magnitude of the predicted move, (2) whether model conviction is high or low based on sample std-dev, (3) whether this forecast agrees or disagrees with the recent price trend. If the Kronos forecast is UNAVAILABLE, emit signal=neutral, confidence=0, thesis='Kronos model unavailable — no quantitative forecast this session.', keyPoints=['Forecast model endpoint timed out or not configured'].",
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

// ─── Peer-review (Stage 2) ───────────────────────────────────────────────────

const SUBMIT_PEER_RANKING_TOOL: Anthropic.Tool = {
  name: "submit_peer_ranking",
  description: "Submit your anonymous ranking of all 5 analyst reports by reasoning quality.",
  input_schema: {
    type: "object" as const,
    properties: {
      rankedLabels: {
        type: "array" as const,
        items: { type: "string" as const },
        minItems: 5,
        maxItems: 5,
        description: "The 5 analyst labels (e.g. 'Analyst A') ordered best reasoning (rank 1) to weakest (rank 5).",
      },
      reasoning: {
        type: "object" as const,
        description: "One-sentence reason per analyst label (keys = 'Analyst A' … 'Analyst E').",
        additionalProperties: { type: "string" as const },
      },
    },
    required: ["rankedLabels", "reasoning"],
  },
};

const ANALYST_LABELS = ["Analyst A", "Analyst B", "Analyst C", "Analyst D", "Analyst E"];

export function computeAggregateRankings(
  peerRankings: PeerRanking[],
  allRoles: string[]
): AggregateRanking[] {
  const rankSums: Record<string, number> = {};
  const rankCounts: Record<string, number> = {};
  const topVotes: Record<string, number> = {};

  for (const role of allRoles) {
    rankSums[role] = 0;
    rankCounts[role] = 0;
    topVotes[role] = 0;
  }

  for (const pr of peerRankings) {
    pr.rankedOrder.forEach((role, idx) => {
      if (!(role in rankSums)) return; // skip unknown roles
      rankSums[role] += idx + 1; // 1-indexed
      rankCounts[role] += 1;
      if (idx === 0) topVotes[role] += 1;
    });
  }

  return allRoles
    .map((role) => ({
      role,
      avgRank: rankCounts[role] > 0 ? rankSums[role] / rankCounts[role] : 3.0,
      topVotes: topVotes[role],
    }))
    .sort((a, b) => a.avgRank - b.avgRank);
}

export async function runPeerReview(
  agentResults: AgentResult[],
  anthropic: Anthropic
): Promise<{ peerRankings: PeerRanking[]; aggregateRankings: AggregateRanking[] }> {
  const roles = agentResults.map((a) => a.role);

  // One shared shuffle — all reviewers see the same label-to-role mapping
  const shuffled = [...roles].sort(() => Math.random() - 0.5);
  const labelToRole: Record<string, string> = {};
  const roleToLabel: Record<string, string> = {};
  shuffled.forEach((role, i) => {
    labelToRole[ANALYST_LABELS[i]] = role;
    roleToLabel[role] = ANALYST_LABELS[i];
  });

  // Build the anonymous thesis block (same for every reviewer)
  const thesisBlock = shuffled
    .map((role, i) => {
      const agent = agentResults.find((a) => a.role === role)!;
      const pts = (Array.isArray(agent.keyPoints) ? agent.keyPoints : []).slice(0, 3).join("; ");
      return `${ANALYST_LABELS[i]}:\nThesis: ${agent.thesis}\nKey points: ${pts}`;
    })
    .join("\n\n");

  const systemPrompt = `You are a senior investment analyst conducting a blind peer review.
You are evaluating the QUALITY OF REASONING in 5 anonymous analyst reports.
Do NOT rank based on whether you agree with the signal — judge reasoning clarity, data usage, and logical coherence only.

${thesisBlock}

Rank all 5 analysts from best (rank 1) to weakest (rank 5) reasoning quality.
Call submit_peer_ranking with rankedLabels (ordered list, best first) and a one-sentence reasoning for each analyst.`;

  const peerRankings = await Promise.all(
    agentResults.map(async (reviewer): Promise<PeerRanking> => {
      try {
        const response = await anthropic.messages.create({
          model: HAIKU,
          max_tokens: 384,
          system: systemPrompt,
          tools: [SUBMIT_PEER_RANKING_TOOL],
          tool_choice: { type: "any" },
          messages: [
            {
              role: "user",
              content: `You are the ${reviewer.role} analyst. Rank all 5 analyses by reasoning quality and call submit_peer_ranking.`,
            },
          ],
        });

        const toolUse = response.content.find((b) => b.type === "tool_use");
        if (toolUse?.type === "tool_use") {
          const input = toolUse.input as {
            rankedLabels?: string[];
            reasoning?: Record<string, string>;
          };
          const rawLabels = Array.isArray(input.rankedLabels) ? input.rankedLabels : [];
          // De-anonymize: convert labels back to roles
          const rankedOrder = rawLabels
            .filter((lbl) => lbl in labelToRole)
            .map((lbl) => labelToRole[lbl]);
          // Fill any missing roles at the end (neutral fallback)
          for (const role of roles) {
            if (!rankedOrder.includes(role)) rankedOrder.push(role);
          }
          // Re-key reasoning from labels to roles
          const reasoning: Record<string, string> = {};
          for (const [lbl, reason] of Object.entries(input.reasoning ?? {})) {
            if (lbl in labelToRole) reasoning[labelToRole[lbl]] = reason;
          }
          return { reviewerRole: reviewer.role, rankedOrder, reasoning };
        }

        // Fallback: neutral order
        return { reviewerRole: reviewer.role, rankedOrder: [...roles], reasoning: {} };
      } catch {
        return { reviewerRole: reviewer.role, rankedOrder: [...roles], reasoning: {} };
      }
    })
  );

  return {
    peerRankings,
    aggregateRankings: computeAggregateRankings(peerRankings, roles),
  };
}

// ─── Stage-1 agent ───────────────────────────────────────────────────────────

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
        keyPoints: Array.isArray(input.keyPoints) ? input.keyPoints.filter((p): p is string => typeof p === "string") : [],
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
