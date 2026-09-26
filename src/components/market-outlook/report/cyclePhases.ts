// Static textbook business-cycle phase copy — not AI-generated. Region
// bubble positions (the "cycle" MacroBackdrop's positions) are the only
// AI-driven part of this chart; these four phases are fixed narrative
// framing that doesn't change quarter to quarter.
export const CYCLE_PHASES = [
  { key: "early", label: "Early Cycle", bullets: ["Activity rebounds", "Credit begins to grow", "Profits grow rapidly", "Policy still stimulative"] },
  { key: "mid", label: "Mid Cycle", bullets: ["Growth peaking", "Credit growth strong", "Profit growth peaks", "Policy neutral"] },
  { key: "late", label: "Late Cycle", bullets: ["Growth moderating", "Credit tightens", "Earnings under pressure", "Policy contractionary"] },
  { key: "recession", label: "Recession", bullets: ["Falling activity", "Credit dries up", "Profits decline", "Policy eases"] },
] as const;
