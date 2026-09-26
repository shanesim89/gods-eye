// Claude drafting for the 6-page quarterly report — one call with forced tool
// use. Market pulse, benchmarks, and chart series are all fetched separately
// (market-data.ts) and merged in server-side; the model only ever picks which
// pre-fetched series backs a chart (chart_symbol_key), it never invents numbers.
import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import {
  CENTRAL_BANKS,
  CHART_SYMBOL_KEYS,
  CYCLE_REGIONS,
  QUADRANT_ASSETS,
  type MacroBackdropType,
  type ReportDataV2,
  type ReportFilters,
  type ScrapedSource,
} from "./types";

const MODEL = "claude-sonnet-5";

// Narrative only — yield/frequency come from parseFundDistributions server-side.
const FUND_FIGURES_SCHEMA = {
  type: "object" as const,
  properties: {
    purpose: { type: "string", description: "One sentence, ≤22 words, describing the fund's purpose" },
    income_sources: { type: "array", items: { type: "string" }, description: "2-4 short labels, e.g. 'Government bonds', 'Global REITs'" },
    what_changed: { type: "string", description: "One sentence, ≤26 words, on what changed this quarter — positioning, credit quality, rates, distributions. Only from source material; if nothing specific in sources, describe the fund's steady approach generally." },
  },
  required: ["purpose", "income_sources", "what_changed"],
};

const VALUE_ITEM_SCHEMA = {
  type: "object" as const,
  properties: {
    name: { type: "string" },
    rating: { type: "string", enum: ["attractive", "neutral", "less attractive"] },
    stars: { type: "integer", minimum: 1, maximum: 5 },
    reason: { type: "string", description: "One sentence" },
  },
  required: ["name", "rating", "stars", "reason"],
};

// Page-5 "macro backdrop" — three of the six rotating chart types are
// AI-judged (cycle/growth_inflation/central_bank); the other three are pure
// server-fetched Yahoo data and add nothing to the schema — the model never
// sees or fills them (see market-data.ts + stream/route.ts).
const MACRO_SCHEMA_PROPERTY: Partial<Record<MacroBackdropType, { key: string; schema: object }>> = {
  cycle: {
    key: "cycle_positions",
    schema: {
      type: "array",
      items: {
        type: "object",
        properties: {
          region: { type: "string", enum: CYCLE_REGIONS.map((r) => r.key) },
          phase_pct: { type: "number", description: "0-100: 0-25 Early cycle, 25-50 Mid cycle, 50-75 Late cycle, 75-100 Recession" },
        },
        required: ["region", "phase_pct"],
      },
      description: `Exactly one entry for EACH of: ${CYCLE_REGIONS.map((r) => r.label).join(", ")}. No duplicates, no omissions.`,
    },
  },
  growth_inflation: {
    key: "quadrant_positions",
    schema: {
      type: "array",
      items: {
        type: "object",
        properties: {
          asset: { type: "string", enum: [...QUADRANT_ASSETS] },
          growth: { type: "number", description: "-100..100, current growth-regime placement" },
          inflation: { type: "number", description: "-100..100, current inflation-regime placement" },
        },
        required: ["asset", "growth", "inflation"],
      },
      description: `Exactly one entry for EACH of: ${QUADRANT_ASSETS.join(", ")}. No duplicates, no omissions.`,
    },
  },
  central_bank: {
    key: "central_bank_stances",
    schema: {
      type: "array",
      items: {
        type: "object",
        properties: {
          bank: { type: "string", enum: CENTRAL_BANKS.map((b) => b.key) },
          stance: { type: "string", enum: ["hiking", "holding", "cutting"] },
          note: { type: "string", description: "One short line grounded only in what the sources say this quarter" },
        },
        required: ["bank", "stance", "note"],
      },
      description: `Exactly one entry for EACH of: ${CENTRAL_BANKS.map((b) => b.label).join(", ")}. No duplicates, no omissions.`,
    },
  },
};

export function buildToolV2(macroType: MacroBackdropType): Anthropic.Tool {
  const macro = MACRO_SCHEMA_PROPERTY[macroType];
  return {
  name: "record_report_v2",
  description: "Record the completed 6-page client quarterly market outlook report.",
  input_schema: {
    type: "object",
    properties: {
      quarter_label: { type: "string", description: 'e.g. "Q2 2026"' },
      as_at_label: { type: "string", description: 'e.g. "As at 30 June 2026"' },
      subtitle: { type: "string", description: "Short cover subtitle, e.g. 'Market recap, income updates and opportunities.'" },
      cover_theme: {
        type: "string",
        description:
          "A punchy 2-5 word magazine-cover-style headline capturing the single most economically impactful story of the quarter from the source material (e.g. 'Rates Hold, Markets Climb', 'Tariffs Return, Markets Shrug'). Title case, no ending punctuation, never a specific stock/ticker.",
      },
      page2: {
        type: "object",
        properties: {
          overview: { type: "string", description: "3-4 short sentences, ≤80 words total, summarising the whole quarter's market story" },
          events: {
            type: "array",
            items: {
              type: "object",
              properties: { title: { type: "string" }, body: { type: "string", description: "≤16 words" } },
              required: ["title", "body"],
            },
            description: "Exactly 3 key events: rates, inflation/growth, one major geopolitical/policy/market event",
          },
          takeaway: { type: "string", description: "One sentence, ≤26 words, the main quarter takeaway, professional tone" },
          tldr_sg: {
            type: "string",
            description:
              "The same main takeaway rewritten in one casual sentence, ≤26 words, in light Singaporean English/Singlish flavour (e.g. 'lah', 'lor', 'don't kan cheong', 'steady got growth') — fun and relatable, still compliant (no advice, no promises), still legible to a non-Singaporean reader.",
          },
        },
        required: ["overview", "events", "takeaway", "tldr_sg"],
      },
      page3: {
        type: "object",
        properties: {
          regions: { type: "array", items: VALUE_ITEM_SCHEMA, description: "5-7 regions — MUST include 'Asia ex-Japan' and 'Singapore' alongside others like United States, Europe, Japan, China" },
          sectors: { type: "array", items: VALUE_ITEM_SCHEMA, description: "4-5 sectors" },
        },
        required: ["regions", "sectors"],
      },
      page4: {
        type: "object",
        properties: {
          intro_text: { type: "string", description: "2 sentences, ≤42 words, on why dividend/passive income matters this quarter" },
          pimco: FUND_FIGURES_SCHEMA,
          allianz: FUND_FIGURES_SCHEMA,
          fssa: FUND_FIGURES_SCHEMA,
          greatlink: FUND_FIGURES_SCHEMA,
        },
        required: ["intro_text", "pimco", "allianz", "fssa", "greatlink"],
      },
      page5: {
        type: "object",
        properties: {
          opportunities: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                why_it_matters: { type: "string", description: "One short sentence, ≤18 words" },
                analysis: { type: "string", description: "One sentence, ≤26 words, of supporting detail beyond the headline reason" },
                main_risk: { type: "string", description: "One short sentence, ≤18 words" },
                what_to_watch: { type: "string", description: "One short sentence, ≤18 words" },
                chart_symbol_key: { type: "string", enum: [...CHART_SYMBOL_KEYS], description: "Which pre-fetched real series best illustrates this opportunity" },
              },
              required: ["name", "why_it_matters", "analysis", "main_risk", "what_to_watch", "chart_symbol_key"],
            },
            description: "Exactly 3 opportunities",
          },
          reminders: { type: "array", items: { type: "string" }, description: "Exactly 3 short reminders, e.g. 'Stay invested'" },
          ...(macro ? { [macro.key]: macro.schema } : {}),
        },
        required: macro ? ["opportunities", "reminders", macro.key] : ["opportunities", "reminders"],
      },
      page6: {
        type: "object",
        properties: {
          summary: { type: "string", description: "2 sentences, ≤44 words: clients are rewarded for staying invested and sticking to strategy; opportunity is everywhere for those who look at sectors/themes aligned to their own goals and risk tolerance" },
          watching: { type: "array", items: { type: "string" }, description: "Exactly 3 short items" },
          may_create_opportunity: { type: "array", items: { type: "string" }, description: "Exactly 3 short items" },
          avoid: { type: "array", items: { type: "string" }, description: "Exactly 3 short items" },
          watchlist: {
            type: "array",
            items: {
              type: "object",
              properties: { theme: { type: "string", description: "A sector/theme name, NEVER a specific stock ticker or company name" }, note: { type: "string", description: "≤12 words" } },
              required: ["theme", "note"],
            },
            description: "Exactly 5 sector/theme watchlist items — general themes only, never named securities (compliance)",
          },
          closing_message: {
            type: "string",
            description:
              "Warm closing note, one sentence, ≤22 words. Vary the angle each time you write one — rotate between staying disciplined, tuning out short-term noise, an opportunity mindset, or a long-term focus — rather than reusing the same generic phrasing every quarter.",
          },
        },
        required: ["summary", "watching", "may_create_opportunity", "avoid", "watchlist", "closing_message"],
      },
    },
    required: ["quarter_label", "as_at_label", "subtitle", "cover_theme", "page2", "page3", "page4", "page5", "page6"],
  },
  };
}

export type BrandForPrompt = { firmName: string; adviserName: string; adviserTitle: string };

const MACRO_PROMPT_PARAGRAPH: Partial<Record<MacroBackdropType, string>> = {
  cycle: `BUSINESS CYCLE POSITIONING: For page5.cycle_positions, place each of the seven required regions on a 0-100 continuous business-cycle scale based on what the source material says about that region/economy's growth, inflation and policy trajectory this quarter: 0-25 = Early cycle (recovery, credit/profits reaccelerating), 25-50 = Mid cycle (steady expansion, growth momentum near its peak), 50-75 = Late cycle (still expanding but decelerating, policy tightening), 75-100 = Recession (contraction). This is a schematic, illustrative placement, not a precise indicator — use qualitative judgment, hedge appropriately, and stay consistent with anything else you say about that region elsewhere (e.g. page3 ratings). If the sources say little about a region, place it near 40-50 (neutral mid-cycle) rather than guessing an extreme.`,
  growth_inflation: `GROWTH/INFLATION QUADRANT: For page5.quadrant_positions, place each of the six required assets on a growth axis and an inflation axis (both -100..100) reflecting the macro regime the source material describes this quarter — positive growth/inflation means accelerating, negative means decelerating. Schematic and illustrative, not a precise indicator; hedge appropriately; if sources say little, place the asset near 0 on the unclear axis rather than guessing an extreme.`,
  central_bank: `CENTRAL BANK STANCE: For page5.central_bank_stances, classify each of the four required central banks' current policy stance (hiking, holding, or cutting) plus one short grounding note, based ONLY on what the source material actually says about that bank this quarter. Do not invent a stance if the sources are silent on a bank — default to "holding" with a note flagging that sources didn't cover it, rather than guessing hiking or cutting.`,
};

export function buildSystemPromptV2(filters: ReportFilters, brand: BrandForPrompt, sources: ScrapedSource[], macroType: MacroBackdropType): string {
  const okSources = sources.filter((s) => s.ok && s.markdown);
  const failed = sources.filter((s) => !s.ok).map((s) => s.name);
  const today = new Date().toISOString().slice(0, 10);
  const macroParagraph = MACRO_PROMPT_PARAGRAPH[macroType];

  const sourceBlocks = okSources.map((s) => `<source name="${s.name}" url="${s.url}">\n${s.markdown}\n</source>`).join("\n\n");

  return `You are drafting a quarterly market outlook report on behalf of ${brand.adviserName || "a financial adviser"}${
    brand.firmName ? ` of ${brand.firmName}` : ""
  }, based in Singapore, for their unit trust clients — everyday people with basic investment knowledge, not finance professionals.

Today's date: ${today}. This report covers the quarter just ended.

HARD RULES (compliance — never break these):
- This is an INFORMATION update, not advice. NEVER recommend buying, selling, or holding anything. NEVER name specific stocks, tickers, or individual companies anywhere in the report — the page-6 watchlist is sector/theme names only (e.g. "AI infrastructure", never "NVIDIA").
- No performance promises or predictions stated as fact. Hedge every forward-looking statement.
- Plain English, ~45-75 words per page-section — concise and skimmable, never padded to fill space. If a technical term is unavoidable, explain it in the same sentence.
- Page-4 funds: write ONLY the narrative (purpose, income sources, what changed). Do NOT state any yield, distribution rate, or allocation percentage in the narrative text — those figures are pulled separately from the factsheets and must never be invented by you.
- page3 regions MUST include both "Asia ex-Japan" and "Singapore" as separate rows alongside the other regions you choose.

GROUNDING RULES:
- Use ONLY the source material below for narrative content. Do not invent figures, prices, or events.
- Attribute reasoning to what the sources actually support; if a requested angle isn't covered, speak generally rather than inventing specifics.

${macroParagraph ? `${macroParagraph}\n\n` : ""}${failed.length ? `Sources that were unavailable this run: ${failed.join(", ")}.\n` : ""}
SOURCE MATERIAL:
${sourceBlocks || "(no sources available)"}`;
}

// Which page5 field is required for a given macroType — kept alongside
// MACRO_SCHEMA_PROPERTY so the completeness check below matches the schema.
const MACRO_REQUIRED_FIELD: Partial<Record<MacroBackdropType, keyof ReportDataV2["page5"]>> = {
  cycle: "cycle_positions",
  growth_inflation: "quadrant_positions",
  central_bank: "central_bank_stances",
};

export async function generateReportV2(
  filters: ReportFilters,
  brand: BrandForPrompt,
  sources: ScrapedSource[],
  anthropic: Anthropic,
  macroType: MacroBackdropType
): Promise<ReportDataV2> {
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: "disabled" },
    system: buildSystemPromptV2(filters, brand, sources, macroType),
    tools: [buildToolV2(macroType)],
    tool_choice: { type: "tool", name: "record_report_v2" },
    messages: [{ role: "user", content: "Generate the client quarterly market outlook report now by calling record_report_v2." }],
  });

  const tu = res.content.find((b) => b.type === "tool_use");
  if (!tu || tu.type !== "tool_use") throw new Error("Model did not return a structured report");
  const data = tu.input as ReportDataV2;

  if (!data.page2 || !data.page3 || !data.page4 || !data.page5 || !data.page6) {
    throw new Error("Structured report was incomplete — try again");
  }
  const macroField = MACRO_REQUIRED_FIELD[macroType];
  if (macroField && !data.page5[macroField]) {
    throw new Error("Structured report was incomplete — try again");
  }

  data.page5.macro_type = macroType;
  data.sources_used = sources.filter((s) => s.ok).map((s) => s.name);
  return data;
}
