import { CYCLE_PHASES } from "./cyclePhases";
import { CycleArc } from "./charts/CycleArc";
import { IndexHeatmap } from "./charts/IndexHeatmap";
import { YieldCurve } from "./charts/YieldCurve";
import { GrowthInflationQuadrant } from "./charts/GrowthInflationQuadrant";
import { CentralBankStrip } from "./charts/CentralBankStrip";
import { VixGauge } from "./charts/VixGauge";
import type { MacroBackdrop } from "./Page5Opportunities";
import styles from "./MacroBackdropPanel.module.css";

const PANEL_LABEL: Record<MacroBackdrop["type"], string> = {
  cycle: "Business Cycle Framework — where economies sit today",
  index_heatmap: "Global Index Heatmap — quarter-to-date",
  yield_curve: "US Treasury Yield Curve — quarter-end",
  growth_inflation: "Growth / Inflation Regime",
  central_bank: "Central Bank Stance",
  vix_gauge: "Volatility / Risk Gauge",
};

export function MacroBackdropPanel({ data }: { data: MacroBackdrop }) {
  return (
    <div className={styles.panel}>
      <div className={styles.panelLabel}>{PANEL_LABEL[data.type]}</div>

      {data.type === "cycle" && (
        <>
          <div className={styles.phaseGrid}>
            {CYCLE_PHASES.map((p) => (
              <div className={styles.phaseCol} key={p.key}>
                <div className={styles.phaseTitle}>{p.label}</div>
                <ul className={styles.phaseBullets}>
                  {p.bullets.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <CycleArc positions={data.positions} />
          <div className={styles.legend}>
            <div className={styles.legendBar} />
            <div className={styles.legendLabels}>
              <span>Expansion</span>
              <span>Contraction</span>
            </div>
          </div>
        </>
      )}

      {data.type === "index_heatmap" && <IndexHeatmap entries={data.entries} />}
      {data.type === "yield_curve" && <YieldCurve points={data.points} />}
      {data.type === "central_bank" && <CentralBankStrip stances={data.stances} />}

      {data.type === "growth_inflation" && (
        <div className={styles.centered}>
          <GrowthInflationQuadrant positions={data.positions} />
        </div>
      )}
      {data.type === "vix_gauge" && (
        <div className={styles.centered}>
          <VixGauge value={data.gauge.value} level={data.gauge.level} />
        </div>
      )}
    </div>
  );
}
