import type { ReactNode } from "react";
import { Lightbulb } from "lucide-react";
import { InteriorPage } from "./InteriorPage";
import styles from "./Page4Income.module.css";

export type FundCard = {
  name: string;
  ticker: string;
  purpose: string; // one sentence
  incomeSources: string[]; // e.g. ["Government bonds", "Mortgage-related", ...]
  whatChanged: string;
  yieldPct: number | null; // distribution yield %, scraped server-side
  frequency: string | null; // "Monthly" | "Quarterly" | "Annually"
  verified: boolean; // true = regex matched a real figure in the factsheet scrape
  quarterChangePct: number | null; // 3-month price/NAV return, scraped server-side
  sourceUrl: string; // the exact dealer/factsheet page this fund's figures were scraped from
};

export type Page4Data = {
  introText: string;
  funds: FundCard[]; // exactly 4
};

function QuarterMove({ pct }: { pct: number | null }) {
  if (pct == null) return <span className={styles.moveFlat}>—</span>;
  const up = pct >= 0;
  return (
    <span className={up ? styles.moveUp : styles.moveDown}>
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(2)}%
    </span>
  );
}

function FundColumn({ fund, hideVerifiedBadge, forPdf }: { fund: FundCard; hideVerifiedBadge?: boolean; forPdf?: boolean }) {
  return (
    <div className={styles.fund}>
      <div className={styles.fundHead}>
        <div className={styles.fundName}>{fund.name}</div>
        {fund.frequency && <div className={styles.fundFreq}>{fund.frequency}</div>}
      </div>

      <div className={styles.yieldRow}>
        <div className={styles.yieldValue}>{fund.yieldPct == null ? "—" : `${fund.yieldPct.toFixed(2)}%`}</div>
        <div className={styles.yieldCaption}>
          distribution
          <br />
          yield p.a.
        </div>
        <div className={styles.quarterStat}>
          <QuarterMove pct={fund.quarterChangePct} />
          <div className={styles.quarterCaption}>this quarter</div>
        </div>
        {!hideVerifiedBadge &&
          (fund.verified ? (
            <span className={styles.verified}>✓ VERIFIED</span>
          ) : (
            <span className={styles.unverified}>UNVERIFIED</span>
          ))}
      </div>

      <div className={styles.block}>
        <div className={styles.blockLabel}>What it aims to do</div>
        <div className={styles.blockText}>{fund.purpose}</div>
      </div>

      <div className={styles.block}>
        <div className={styles.blockLabel}>Where the income comes from</div>
        <div className={styles.sources}>
          {fund.incomeSources.map((s, i) => (
            <span className={styles.sourceTag} key={i}>{s}</span>
          ))}
        </div>
      </div>

      <div className={styles.block}>
        <div className={styles.blockLabel}>What changed this quarter</div>
        <div className={styles.blockText}>{fund.whatChanged}</div>
      </div>

      <div className={styles.checkStrip}>
        Yield from the fund factsheet — as at latest published date.{" "}
        <a href={fund.sourceUrl} target="_blank" rel="noopener noreferrer" className={styles.sourceLink}>
          {forPdf ? fund.sourceUrl : "View source ↗"}
        </a>
      </div>
    </div>
  );
}

const FUN_FACT_PRINCIPAL = 10_000;
const FUN_FACT_RATE_PCT = 6;

function FunFact() {
  const annual = Math.round((FUN_FACT_PRINCIPAL * FUN_FACT_RATE_PCT) / 100);
  const monthly = Math.round(annual / 12);
  return (
    <div className={styles.funFactWrap}>
      <div className={styles.funFactBubble}>
        <div className={styles.funFactIcon}>
          <Lightbulb size={16} strokeWidth={2.25} />
        </div>
        <div>
          <div className={styles.funFactTag}>Fun fact</div>
          <div className={styles.funFactText}>
            A <strong>${FUN_FACT_PRINCIPAL.toLocaleString()}</strong> investment yielding{" "}
            <strong>{FUN_FACT_RATE_PCT}% p.a.</strong> could generate about{" "}
            <strong>${annual.toLocaleString()}</strong> a year in distributions — roughly{" "}
            <strong>${monthly.toLocaleString()}</strong> a month.
          </div>
          <div className={styles.funFactCaveat}>Illustrative only, not a projection or guarantee.</div>
        </div>
      </div>
    </div>
  );
}

export function Page4Income({
  data,
  issueLabel,
  pageNum,
  totalPages,
  sourceLine,
  hideVerifiedBadge,
  forPdf,
}: {
  data: Page4Data;
  issueLabel: string;
  pageNum: number;
  totalPages: number;
  sourceLine: ReactNode;
  /** True for the PDF-export render — VERIFIED/UNVERIFIED is an internal QA
   *  signal for the adviser, not something a client should see in the download. */
  hideVerifiedBadge?: boolean;
  /** True for the PDF-export render — per-fund "View source" links spell out
   *  the actual URL instead of the on-screen "View source ↗" label. */
  forPdf?: boolean;
}) {
  return (
    <InteriorPage
      eyebrow="Income &amp; passive income"
      title="Income Distributing Funds"
      issueLabel={issueLabel}
      pageNum={pageNum}
      totalPages={totalPages}
      sourceLine={sourceLine}
    >
      <FunFact />
      <div className={styles.intro}>{data.introText}</div>
      <div className={styles.funds}>
        {data.funds.map((fund, i) => (
          <FundColumn fund={fund} hideVerifiedBadge={hideVerifiedBadge} forPdf={forPdf} key={i} />
        ))}
      </div>
      <div className={styles.knowNote}>
        <strong>What clients should know:</strong> these funds may provide regular distributions, but distributions
        are not guaranteed and the fund value can still rise or fall.
      </div>
    </InteriorPage>
  );
}
