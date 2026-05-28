import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { AgentResult, CouncilContext, Verdict, VerdictType } from "./types";

const SONNET = "claude-sonnet-4-6";

const EMIT_VERDICT_TOOL: Anthropic.Tool = {
  name: "emit_verdict",
  description: "Emit the synthesized Investment Council verdict.",
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
    },
    required: ["verdict", "confidence", "summary"],
  },
};

export async function synthesizeVerdict(
  agents: AgentResult[],
  ctx: CouncilContext,
  anthropic: Anthropic
): Promise<Verdict> {
  // Weighted scoring: TECHNICAL 25%, FUNDAMENTAL/ON-CHAIN/FLOW 30%, SENTIMENT 20%, MACRO/RISK 25%
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

  const systemPrompt = `You are the CHIEF INVESTMENT OFFICER of the Investment Council.
You must synthesize the analyses from 4 specialist agents into a single BUY / HOLD / SELL verdict for ${ctx.ticker}.

Asset class: ${ctx.assetClass.toUpperCase()}
Current price: $${ctx.price.toFixed(2)} (${ctx.changePct >= 0 ? "+" : ""}${ctx.changePct.toFixed(2)}% today)

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

Call emit_verdict with your synthesized judgment. Be decisive. No hedging. Consider dissenting views briefly but commit to a verdict.`;

  try {
    const response = await anthropic.messages.create({
      model: SONNET,
      max_tokens: 512,
      system: systemPrompt,
      tools: [EMIT_VERDICT_TOOL],
      tool_choice: { type: "any" },
      messages: [
        {
          role: "user",
          content: `Synthesize the Investment Council analysis for ${ctx.ticker} and emit your verdict.`,
        },
      ],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (toolUse?.type === "tool_use") {
      const input = toolUse.input as {
        verdict: VerdictType;
        confidence: number;
        summary: string;
      };
      return {
        verdict: input.verdict ?? "HOLD",
        confidence: Math.max(0, Math.min(100, input.confidence ?? 50)),
        summary: input.summary ?? "",
        agents,
        generatedAt: new Date().toISOString(),
      };
    }

    // Fallback
    return {
      verdict: "HOLD",
      confidence: 50,
      summary: "Synthesis unavailable — mixed signals across agents.",
      agents,
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      verdict: "HOLD",
      confidence: 0,
      summary: `Synthesis failed: ${err instanceof Error ? err.message : "unknown error"}`,
      agents,
      generatedAt: new Date().toISOString(),
    };
  }
}
