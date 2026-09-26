import type { ReactNode } from "react";
import { InteriorPage } from "./InteriorPage";
import { StarRating } from "./charts/StarRating";
import styles from "./Page3Value.module.css";

export type Rating = "attractive" | "neutral" | "less attractive";

export type ValueItem = {
  name: string;
  rating: Rating;
  stars: number; // 1-5, finer-grained than the 3-way rating
  reason: string; // one sentence
};

export type Page3Data = {
  regions: ValueItem[]; // 4-5
  sectors: ValueItem[]; // 4-5
  sources: { name: string; url: string | null }[]; // real sources that fed this run's drafting call
};

function pillClass(r: Rating): string {
  if (r === "attractive") return styles.good;
  if (r === "neutral") return styles.mid;
  return styles.low;
}

function pillLabel(r: Rating): string {
  if (r === "attractive") return "Attractive";
  if (r === "neutral") return "Neutral";
  return "Less attractive";
}

function ValueTable({ heading, items }: { heading: string; items: ValueItem[] }) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionLabel}>{heading}</div>
      <table className={styles.tbl}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Attractiveness</th>
            <th>Rating</th>
            <th>Our view</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i}>
              <td className={styles.nameCell}>{it.name}</td>
              <td className={styles.ratingCell}>
                <StarRating rating={it.stars} />
              </td>
              <td className={styles.pillCell}>
                <span className={`${styles.pill} ${pillClass(it.rating)}`}>{pillLabel(it.rating)}</span>
              </td>
              <td>{it.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Page3Value({
  data,
  issueLabel,
  pageNum,
  totalPages,
  sourceLine,
}: {
  data: Page3Data;
  issueLabel: string;
  pageNum: number;
  totalPages: number;
  sourceLine: ReactNode;
}) {
  return (
    <InteriorPage
      eyebrow="House view"
      title="Where We See Value"
      issueLabel={issueLabel}
      pageNum={pageNum}
      totalPages={totalPages}
      sourceLine={sourceLine}
    >
      <ValueTable heading="Countries &amp; regions" items={data.regions} />
      <ValueTable heading="Sectors" items={data.sectors} />
      <p className={styles.footnote}>Sample house view, not a personal recommendation.</p>

      <div className={styles.methodBox}>
        <strong>How we rate:</strong> each view weighs valuation, earnings outlook, broad economic conditions and
        interest-rate sensitivity. Ratings reflect the team&apos;s current thinking and can change as conditions
        evolve — they are not a forecast of future returns.
      </div>
    </InteriorPage>
  );
}
