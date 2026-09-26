// Curated pool of compliance-safe closing notes for page 6 — shuffled so the
// sample/idle view isn't always the same line. Real generations get their own
// AI-written closing_message (see generate-v2.ts), but this pool also seeds
// that prompt's instruction to vary tone/angle each run.
export const CLOSING_QUOTES: string[] = [
  "New headlines will keep coming — a long-term plan, reviewed regularly, matters more than reacting to any single one.",
  "Markets will always find something to react to. Staying invested and diversified matters more than the headlines.",
  "Short-term noise is part of investing — staying the course tends to reward patience over prediction.",
  "Discipline and diversification tend to matter more than any single headline. Let's keep your plan on track.",
  "Volatility is the price of admission for long-term returns — staying diversified beats trying to call the next move.",
];

export function randomClosingQuote(): string {
  return CLOSING_QUOTES[Math.floor(Math.random() * CLOSING_QUOTES.length)];
}
