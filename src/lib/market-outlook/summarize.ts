import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { ScrapedArticle } from "./scrape";

const SONNET = "claude-sonnet-4-6";

export type OutlookSection = { heading: string; body: string };

export type OutlookStat = { label: string; value: string };

export type OutlookDigest = {
  overview: string;
  keyStats: OutlookStat[];
  articleSections: OutlookSection[];
  whatsappText: string;
};

const EMIT_DIGEST_TOOL: Anthropic.Tool = {
  name: "emit_digest",
  description: "Emit the consolidated market outlook digest.",
  input_schema: {
    type: "object" as const,
    properties: {
      overview: {
        type: "string" as const,
        description: "3-5 sentence consolidated overview of the current market outlook across all sources.",
      },
      keyStats: {
        type: "array" as const,
        description: "3-6 concrete numeric facts pulled verbatim from the sources (e.g. rate levels, index targets, growth forecasts), each a short label and value. Only include facts actually stated in the source text — never invent numbers.",
        items: {
          type: "object" as const,
          properties: {
            label: { type: "string" as const },
            value: { type: "string" as const },
          },
          required: ["label", "value"],
        },
      },
      articleSections: {
        type: "array" as const,
        description: "Sections for a 3-page branded article, each with a heading and body citing sources inline by name.",
        items: {
          type: "object" as const,
          properties: {
            heading: { type: "string" as const },
            body: { type: "string" as const },
          },
          required: ["heading", "body"],
        },
      },
      whatsappText: {
        type: "string" as const,
        description: "Short (under 600 chars) WhatsApp-ready client market update message, plain text, no markdown.",
      },
    },
    required: ["overview", "keyStats", "articleSections", "whatsappText"],
  },
};

export async function summarizeOutlook(
  articles: ScrapedArticle[],
  anthropic: Anthropic
): Promise<OutlookDigest> {
  const sourceBlock = articles
    .map((a) => `## ${a.source}\n${a.title}\n${a.content}`)
    .join("\n\n");

  const system = `You are a markets analyst producing a consolidated outlook digest from ${articles.length} asset-manager sources.
Cite each source by name inline in articleSections when using its view.
Call emit_digest with the result. Be concise and factual, no invented data.`;

  try {
    const response = await anthropic.messages.create({
      model: SONNET,
      max_tokens: 4096,
      system,
      tools: [EMIT_DIGEST_TOOL],
      tool_choice: { type: "any" },
      messages: [
        {
          role: "user",
          content: `Sources:\n\n${sourceBlock}\n\nProduce the consolidated market outlook digest.`,
        },
      ],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (toolUse?.type === "tool_use") {
      const input = toolUse.input as Partial<OutlookDigest>;
      return {
        overview: input.overview ?? "",
        keyStats: Array.isArray(input.keyStats) ? input.keyStats : [],
        articleSections: Array.isArray(input.articleSections) ? input.articleSections : [],
        whatsappText: input.whatsappText ?? "",
      };
    }
  } catch (err) {
    return {
      overview: `Summary unavailable: ${err instanceof Error ? err.message : "unknown error"}`,
      keyStats: [],
      articleSections: [],
      whatsappText: "",
    };
  }

  return { overview: "Summary unavailable — no response.", keyStats: [], articleSections: [], whatsappText: "" };
}
