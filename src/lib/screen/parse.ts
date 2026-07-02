import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { SCHEMA, UNAVAILABLE, validKeys, type AssetClass } from "./schema";

/**
 * Natural-language theme → structured screen spec, via one Anthropic call.
 * The model is given the exact field schema and the list of unavailable
 * concepts, and must return strict JSON. Output is validated against the
 * schema before use — any unknown field is dropped (and noted), so the screen
 * can only ever filter on fields we actually have.
 */

export type Op = ">" | ">=" | "<" | "<=" | "==" | "contains";

export type Predicate = {
  field: string;
  op: Op;
  value: number | string | boolean;
};

export type RankTerm = { field: string; weight: number; direction: "asc" | "desc" };

export type ScreenSpec = {
  assetClass: AssetClass;
  filters: Predicate[];
  rank: RankTerm[];
  rationale: string;
  /** Sub-criteria the user asked for that we have no data for. */
  unmet: string[];
};

function schemaPrompt(assetClass: AssetClass): string {
  const lines = SCHEMA[assetClass].map(
    (f) =>
      `- ${f.key} (${f.type}${f.values ? `: ${f.values.join("|")}` : ""}) — ${f.desc}`
  );
  return lines.join("\n");
}

const SYS = `You translate an investor's natural-language theme into a structured stock/crypto screen.
Return ONLY valid JSON matching this TypeScript type, no prose, no markdown fence:
{
  "filters": { "field": string, "op": ">"|">="|"<"|"<="|"=="|"contains", "value": number|string|boolean }[],
  "rank": { "field": string, "weight": number (0-1), "direction": "asc"|"desc" }[],
  "rationale": string (one sentence, how you read the theme),
  "unmet": string[] (criteria the user implied that map to UNAVAILABLE data)
}
Rules:
- Use ONLY fields from the provided schema. Never invent a field.
- "contains" is for enum/array fields (bucket, riskTier, tag).
- If the theme implies a concept in the UNAVAILABLE list, add a short human phrase to "unmet" and DO NOT create a filter for it.
- Keep filters tight but not empty; pick 1-4 rank terms that best express the theme. Weights should sum to ~1.`;

export async function parseTheme(
  theme: string,
  assetClass: AssetClass
): Promise<ScreenSpec> {
  const user = `THEME: "${theme}"
ASSET CLASS: ${assetClass}

AVAILABLE FIELDS:
${schemaPrompt(assetClass)}

UNAVAILABLE CONCEPTS (route to "unmet", never filter):
${UNAVAILABLE.map((u) => `- ${u}`).join("\n")}`;

  const client = new Anthropic();
  const res = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 700,
    system: SYS,
    messages: [{ role: "user", content: user }],
  });

  const text = res.content[0]?.type === "text" ? res.content[0].text : "{}";
  return validate(text, assetClass);
}

/** Parse + validate model output against the schema. Tolerant of fences. */
export function validate(raw: string, assetClass: AssetClass): ScreenSpec {
  const valid = validKeys(assetClass);
  let parsed: Record<string, unknown> = {};
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = {};
  }

  const rawFilters = Array.isArray(parsed.filters) ? parsed.filters : [];
  const filters: Predicate[] = [];
  const dropped: string[] = [];
  for (const f of rawFilters as Predicate[]) {
    if (f && typeof f.field === "string" && valid.has(f.field) && f.op != null && f.value != null) {
      filters.push({ field: f.field, op: f.op, value: f.value });
    } else if (f && typeof f.field === "string") {
      dropped.push(f.field);
    }
  }

  const rawRank = Array.isArray(parsed.rank) ? parsed.rank : [];
  const rank: RankTerm[] = [];
  for (const r of rawRank as RankTerm[]) {
    if (r && typeof r.field === "string" && valid.has(r.field)) {
      rank.push({
        field: r.field,
        weight: typeof r.weight === "number" ? r.weight : 0.5,
        direction: r.direction === "asc" ? "asc" : "desc",
      });
    }
  }

  const unmet = Array.isArray(parsed.unmet)
    ? (parsed.unmet as unknown[]).filter((u): u is string => typeof u === "string")
    : [];
  if (dropped.length > 0) {
    unmet.push(`unsupported field(s) ignored: ${[...new Set(dropped)].join(", ")}`);
  }

  return {
    assetClass,
    filters,
    rank,
    rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
    unmet,
  };
}
