import type { ReactNode } from "react";
import { InteriorPage } from "./InteriorPage";
import styles from "./Page6Ahead.module.css";
import type { CoverAdviser } from "./CoverPage";

export type Benchmark = {
  label: string; // "S&P 500"
  price: string; // formatted, e.g. "5,432.10" or "4.28%" for a yield
  changePct: number | null;
  url: string | null; // real Yahoo Finance quote link
};

export type WatchlistTheme = {
  theme: string; // sector/theme name — NOT a ticker (compliance: see chat note)
  note: string;
};

export type Page6Data = {
  summary: string; // the "rewarded for staying invested" framing
  watching: string[];
  mayCreateOpportunity: string[];
  avoid: string[];
  benchmarks: Benchmark[];
  watchlist: WatchlistTheme[]; // 5 items
  closingMessage: string;
};

export function Page6Ahead({
  data,
  adviser,
  issueLabel,
  pageNum,
  totalPages,
  sourceLine,
}: {
  data: Page6Data;
  adviser: CoverAdviser;
  issueLabel: string;
  pageNum: number;
  totalPages: number;
  sourceLine: ReactNode;
}) {
  return (
    <InteriorPage
      eyebrow="Closing thoughts"
      title="Looking Ahead"
      issueLabel={issueLabel}
      pageNum={pageNum}
      totalPages={totalPages}
      sourceLine={sourceLine}
    >
      <p className={styles.summary}>{data.summary}</p>

      <div className={styles.benchmarkSection}>
        <div className={styles.sectionLabelSmall}>Benchmark summary, this quarter</div>
        <table className={styles.benchTable}>
          <thead>
            <tr>
              <th>Benchmark</th>
              <th>Level</th>
              <th>Quarter move</th>
            </tr>
          </thead>
          <tbody>
            {data.benchmarks.map((b, i) => (
              <tr key={i}>
                <td className={styles.benchName}>
                  {b.url ? (
                    <a href={b.url} target="_blank" rel="noopener noreferrer" className={styles.benchLink}>
                      {b.label}
                    </a>
                  ) : (
                    b.label
                  )}
                </td>
                <td className={styles.benchPrice}>{b.price}</td>
                <td
                  className={styles.benchChange}
                  style={{ color: b.changePct == null ? "#7c8b98" : b.changePct >= 0 ? "#1f8a4c" : "#c0392b" }}
                >
                  {b.changePct == null ? "—" : `${b.changePct >= 0 ? "+" : ""}${b.changePct.toFixed(1)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.watchlistSection}>
        <div className={styles.sectionLabelSmall}>Sectors &amp; themes worth a look</div>
        <div className={styles.watchGrid}>
          {data.watchlist.map((w, i) => (
            <div className={styles.watchItem} key={i}>
              <div className={styles.watchTheme}>{w.theme}</div>
              <div className={styles.watchNote}>{w.note}</div>
            </div>
          ))}
        </div>
        <div className={styles.watchDisclaimer}>
          Themes shown for general information only — not a recommendation to buy, sell or hold any specific
          security. Speak with {adviser.adviserName || "your adviser"} about what fits your own goals and risk
          tolerance.
        </div>
      </div>

      <div className={styles.sections}>
        <div className={styles.section}>
          <div className={styles.sectionLabel}>What we are watching</div>
          <div className={styles.list}>
            {data.watching.map((t, i) => (
              <div className={styles.item} key={i}>{t}</div>
            ))}
          </div>
        </div>
        <div className={styles.section}>
          <div className={styles.sectionLabel}>What may create opportunities</div>
          <div className={styles.list}>
            {data.mayCreateOpportunity.map((t, i) => (
              <div className={styles.item} key={i}>{t}</div>
            ))}
          </div>
        </div>
        <div className={styles.section}>
          <div className={styles.sectionLabel}>What investors should avoid</div>
          <div className={styles.list}>
            {data.avoid.map((t, i) => (
              <div className={`${styles.item} ${styles.avoid}`} key={i}>{t}</div>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.closing}>
        <div className={styles.closingText}>&ldquo;{data.closingMessage}&rdquo;</div>
      </div>

      <div className={styles.contact}>
        <div>
          <div className={styles.contactWho}>{adviser.adviserName || "Your Adviser"}</div>
          <div className={styles.contactRole}>
            {[adviser.adviserTitle, adviser.firmName].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div className={styles.contactRight}>
          {adviser.phone && <div>{adviser.phone}</div>}
          {adviser.email && <div>{adviser.email}</div>}
          <div className={styles.invite}>Reach out to arrange a review</div>
        </div>
      </div>
    </InteriorPage>
  );
}
