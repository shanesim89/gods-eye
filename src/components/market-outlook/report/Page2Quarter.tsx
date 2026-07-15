import type { ReactNode } from "react";
import { InteriorPage } from "./InteriorPage";
import styles from "./Page2Quarter.module.css";
import type { MarketPulseArea } from "@/lib/market-outlook/market-data";

export type QuarterEvent = {
  title: string;
  body: string; // <= 25 words
};

export type Page2Data = {
  overview: string; // 3-5 sentence summary of the whole quarter
  events: QuarterEvent[]; // exactly 3
  pulse: MarketPulseArea[]; // exactly 4
  takeaway: string; // <= 35 words
  tldrSg: string; // <= 35 words, casual Singaporean/Singlish-flavoured version
  sources: { name: string; url: string | null }[]; // real sources that fed this run's drafting call
};

function pulseClass(outcome: MarketPulseArea["outcome"]): string {
  switch (outcome) {
    case "Positive": return styles.positive;
    case "Negative": return styles.negative;
    case "Mixed": return styles.mixed;
    default: return styles.stable;
  }
}

function changeClass(pct: number | null): string {
  if (pct == null) return styles.flat;
  if (pct > 0.15) return styles.up;
  if (pct < -0.15) return styles.down;
  return styles.flat;
}

function PulseBar({ pct }: { pct: number | null }) {
  const clamped = Math.max(-10, Math.min(10, pct ?? 0));
  const widthPct = (Math.abs(clamped) / 10) * 50;
  const isNeg = clamped < 0;
  return (
    <div className={styles.barTrack}>
      <div
        className={styles.barFill}
        style={{
          left: isNeg ? `${50 - widthPct}%` : "50%",
          width: `${widthPct}%`,
          background: isNeg ? "#c0392b" : "#1f8a4c",
        }}
      />
    </div>
  );
}

export function Page2Quarter({
  data,
  issueLabel,
  pageNum,
  totalPages,
  sourceLine,
}: {
  data: Page2Data;
  issueLabel: string;
  pageNum: number;
  totalPages: number;
  sourceLine: ReactNode;
}) {
  return (
    <InteriorPage
      eyebrow="At a glance"
      title="The Quarter in 60 Seconds"
      issueLabel={issueLabel}
      pageNum={pageNum}
      totalPages={totalPages}
      sourceLine={sourceLine}
    >
      <p className={styles.overview}>{data.overview}</p>

      <div className={styles.events}>
        {data.events.map((e, i) => (
          <div className={styles.event} key={i}>
            <div className={styles.eventNum}>0{i + 1}</div>
            <div className={styles.eventTitle}>{e.title}</div>
            <div className={styles.eventBody}>{e.body}</div>
          </div>
        ))}
      </div>

      <div className={styles.pulseSection}>
        <div className={styles.sectionLabel}>Market pulse</div>
        <div className={styles.pulseGrid}>
          {data.pulse.map((p, i) => (
            <div className={styles.pulseCell} key={i}>
              <div className={styles.pulseLabel}>{p.label}</div>
              <div className={styles.pulseRow}>
                <span className={`${styles.pulseChange} ${changeClass(p.changePct)}`}>
                  {p.changePct == null ? "—" : `${p.changePct >= 0 ? "+" : ""}${p.changePct.toFixed(1)}%`}
                </span>
              </div>
              <span className={`${styles.pulseTag} ${pulseClass(p.outcome)}`}>{p.outcome}</span>
              <PulseBar pct={p.changePct} />
            </div>
          ))}
        </div>
      </div>

      <div className={styles.bottomRow}>
        <div className={styles.takeaway}>
          <div className={styles.takeawayLabel}>Main takeaway</div>
          <div className={styles.takeawayText}>&ldquo;{data.takeaway}&rdquo;</div>
        </div>
        <div className={styles.tldr}>
          <div className={styles.tldrLabel}>TL;DR — Singaporean edition</div>
          <div className={styles.tldrText}>{data.tldrSg}</div>
        </div>
      </div>
    </InteriorPage>
  );
}
