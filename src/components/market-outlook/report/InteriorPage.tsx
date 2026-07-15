import type { ReactNode } from "react";
import styles from "./InteriorPage.module.css";

export function InteriorPage({
  eyebrow,
  title,
  issueLabel,
  pageNum,
  totalPages,
  sourceLine,
  children,
}: {
  eyebrow: string;
  title: string;
  issueLabel: string;
  pageNum: number;
  totalPages: number;
  sourceLine: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.wordmark}>Market Outlook</div>
        <div className={styles.issue}>{issueLabel}</div>
      </div>

      <div className={styles.titleRow}>
        <div className={styles.eyebrow}>{eyebrow}</div>
        <h2 className={styles.pageTitle}>{title}</h2>
      </div>

      <div className={styles.body}>{children}</div>

      <div className={styles.footer}>
        <div className={styles.sourceLine}>{sourceLine}</div>
        <div className={styles.pageNum}>
          Page {pageNum} of {totalPages}
        </div>
      </div>
    </div>
  );
}
