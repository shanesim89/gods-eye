import type { ReactNode } from "react";
import { InteriorPage } from "./InteriorPage";
import { Sparkline } from "./charts/Sparkline";
import { MacroBackdropPanel } from "./MacroBackdropPanel";
import styles from "./Page5Opportunities.module.css";

export type Opportunity = {
  name: string;
  whyItMatters: string;
  analysis: string; // 1-2 sentences of supporting detail beyond the headline reason
  mainRisk: string;
  whatToWatch: string;
  chartLabel: string; // e.g. "AGG total return, past 12 months"
  chartData: number[]; // series backing the sparkline
  chartChangePct: number | null;
};

// Rotating page-5 backdrop panel — one of six chart types picked per
// generation (pickMacroBackdropType in lib/market-outlook/types.ts), same
// shuffle pattern as the cover photo. See MacroBackdropPanel.tsx.
export type CyclePosition = { region: string; code: string; phasePct: number };
export type QuadrantPosition = { asset: string; growth: number; inflation: number };
export type CentralBankStanceItem = { bank: string; label: string; stance: "hiking" | "holding" | "cutting"; note: string };
export type IndexHeatmapEntry = { symbol: string; label: string; changePct: number };
export type YieldCurvePoint = { tenor: string; yieldPct: number };
export type VixGauge = { value: number; level: "low" | "neutral" | "elevated" | "high" };

export type MacroBackdrop =
  | { type: "cycle"; positions: CyclePosition[] }
  | { type: "growth_inflation"; positions: QuadrantPosition[] }
  | { type: "central_bank"; stances: CentralBankStanceItem[] }
  | { type: "index_heatmap"; entries: IndexHeatmapEntry[] }
  | { type: "yield_curve"; points: YieldCurvePoint[] }
  | { type: "vix_gauge"; gauge: VixGauge };

export type Page5Data = {
  opportunities: Opportunity[]; // exactly 3
  reminders: string[]; // exactly 3, e.g. ["Stay invested", "Invest gradually", "Keep diversified"]
  macroBackdrop: MacroBackdrop;
  sources: { name: string; url: string | null }[]; // real sources that fed this run's drafting call
};

export function Page5Opportunities({
  data,
  issueLabel,
  pageNum,
  totalPages,
  sourceLine,
}: {
  data: Page5Data;
  issueLabel: string;
  pageNum: number;
  totalPages: number;
  sourceLine: ReactNode;
}) {
  return (
    <InteriorPage
      eyebrow="Looking for opportunity"
      title="Opportunities Worth Watching"
      issueLabel={issueLabel}
      pageNum={pageNum}
      totalPages={totalPages}
      sourceLine={sourceLine}
    >
      <MacroBackdropPanel data={data.macroBackdrop} />

      <div className={styles.cards}>
        {data.opportunities.map((o, i) => (
          <div className={styles.card} key={i}>
            <div className={styles.num}>0{i + 1}</div>
            <div className={styles.name}>{o.name}</div>

            <div className={styles.chartBlock}>
              <Sparkline
                data={o.chartData}
                width={150}
                height={38}
                color={(o.chartChangePct ?? 0) >= 0 ? "#1f8a4c" : "#c0392b"}
              />
              <div className={styles.chartCaption}>
                <span>{o.chartLabel}</span>
                {o.chartChangePct != null && (
                  <span style={{ color: o.chartChangePct >= 0 ? "#1f8a4c" : "#c0392b", fontWeight: 700 }}>
                    {o.chartChangePct >= 0 ? "+" : ""}{o.chartChangePct.toFixed(1)}%
                  </span>
                )}
              </div>
            </div>

            <div className={styles.field}>
              <div className={styles.fieldLabel}>Why it may matter now</div>
              <div className={styles.fieldText}>{o.whyItMatters}</div>
              <div className={styles.fieldText} style={{ marginTop: 6, color: "#5c6b78" }}>{o.analysis}</div>
            </div>
            <div className={styles.field}>
              <div className={styles.fieldLabel}>Main risk</div>
              <div className={styles.fieldText}>{o.mainRisk}</div>
            </div>
            <div className={styles.field}>
              <div className={styles.fieldLabel}>What to watch</div>
              <div className={styles.fieldText}>{o.whatToWatch}</div>
            </div>
          </div>
        ))}
      </div>

      <div className={styles.reminders}>
        {data.reminders.map((r, i) => (
          <div className={styles.reminder} key={i}>
            <span className={styles.reminderDot} />
            <span className={styles.reminderText}>{r}</span>
          </div>
        ))}
      </div>
    </InteriorPage>
  );
}
