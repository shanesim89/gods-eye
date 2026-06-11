// Standalone boundary test of buy-zone logic (mirrors src/lib/trading/buy-zone.ts).
function computeDipDepth(entry, currentPrice) {
  if (!entry || !(currentPrice > 0)) return null;
  const span = entry.high - entry.low;
  if (!(span > 0)) return null;
  return ((entry.high - currentPrice) / span) * 100;
}
function evaluateBuyZone(verdict, currentPrice, minConfidence) {
  if (!verdict) return { isBuyZone: false, dipDepthPct: null };
  const levels = verdict.tradeLevels;
  const dipDepthPct = computeDipDepth(levels?.entry, currentPrice);
  if (verdict.verdict !== "BUY") return { isBuyZone: false, dipDepthPct };
  if (verdict.confidence < minConfidence) return { isBuyZone: false, dipDepthPct };
  if (!levels?.entry || !(currentPrice > 0)) return { isBuyZone: false, dipDepthPct };
  if (currentPrice > levels.entry.high) return { isBuyZone: false, dipDepthPct };
  return { isBuyZone: true, dipDepthPct };
}
function orderAmountUsd(isBuyZone, dca, boost) {
  return isBuyZone ? { amount: boost, boosted: true } : { amount: dca, boosted: false };
}

const V = (verdict, confidence, entry) => ({ verdict, confidence, tradeLevels: { entry } });
const entry = { low: 100, high: 120 };
let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  got=${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

// dip depth boundaries
check("dip @ entry.high = 0%", computeDipDepth(entry, 120), 0);
check("dip mid = 50%", computeDipDepth(entry, 110), 50);
check("dip @ entry.low = 100%", computeDipDepth(entry, 100), 100);
check("dip below low > 100%", computeDipDepth(entry, 90), 150);

// buy-zone gating
check("BUY + price in zone = buyzone", evaluateBuyZone(V("BUY", 80, entry), 110, 65).isBuyZone, true);
check("BUY @ exactly entry.high = buyzone", evaluateBuyZone(V("BUY", 80, entry), 120, 65).isBuyZone, true);
check("BUY above entry.high = NOT", evaluateBuyZone(V("BUY", 80, entry), 121, 65).isBuyZone, false);
check("BUY low conf = NOT", evaluateBuyZone(V("BUY", 60, entry), 110, 65).isBuyZone, false);
check("HOLD = NOT", evaluateBuyZone(V("HOLD", 90, entry), 110, 65).isBuyZone, false);
check("SELL = NOT", evaluateBuyZone(V("SELL", 90, entry), 110, 65).isBuyZone, false);
check("null verdict = NOT", evaluateBuyZone(null, 110, 65).isBuyZone, false);

// amount selection
check("buyzone → boost $250", orderAmountUsd(true, 150, 250), { amount: 250, boosted: true });
check("no buyzone → dca $150", orderAmountUsd(false, 150, 250), { amount: 150, boosted: false });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
