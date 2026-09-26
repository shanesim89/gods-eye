import styles from "./CoverPage.module.css";

export type CoverAdviser = {
  firmName: string;
  adviserName: string;
  adviserTitle: string;
  phone: string;
  email: string;
  logoDataUrl: string | null;
  /** Adviser photo, background already removed (PNG w/ alpha) — overlaid large on the cover. */
  photoDataUrl: string | null;
  /** Zoom (80-160%) for the portrait overlay. */
  photoPosY?: number;
  photoScale?: number;
  /** Portrait overlay opacity (30-100), default 78 — how strongly it blends into the cover photo. */
  photoOpacity?: number;
};

export type CoverProps = {
  /** Small kicker wordmark above the masthead — constant every quarter. */
  kicker?: string;
  /** Big cover headline — a punchy theme capturing the quarter's key economic story. */
  masthead?: string;
  /** e.g. "Quarterly Investment Update" */
  issueKind?: string;
  /** e.g. "Q2 2026" */
  quarterLabel: string;
  /** e.g. "As at 30 June 2026" */
  asAtLabel: string;
  subtitle: string;
  /** Public path or data URI of the cover photo. */
  photoSrc: string;
  /** Photo caption, e.g. "Marina Bay, Singapore". Doubles as an eyebrow. */
  photoLocation: string;
  photoCredit?: string;
  adviser: CoverAdviser;
  disclaimer: string;
};

function monogramLetter(name: string): string {
  const t = name.trim();
  return t ? t[0].toUpperCase() : "M";
}

export function CoverPage(props: CoverProps) {
  const {
    kicker = "Market Outlook",
    masthead = "Market Outlook",
    issueKind = "Quarterly Investment Update",
    quarterLabel,
    asAtLabel,
    subtitle,
    photoSrc,
    photoLocation,
    photoCredit = "Unsplash",
    adviser,
    disclaimer,
  } = props;

  // Masthead split into two lines for a stacked, magazine lockup.
  const words = masthead.split(" ");
  const line1 = words.length > 1 ? words.slice(0, -1).join(" ") : masthead;
  const line2 = words.length > 1 ? words[words.length - 1] : "";

  const hasPortrait = Boolean(adviser.photoDataUrl);

  return (
    <div className={styles.page}>
      {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size report asset, no layout benefit from next/image and must also work in html2canvas/PDF paths */}
      <img className={styles.photo} src={photoSrc} alt={photoLocation} />
      <div className={styles.scrim} />

      {hasPortrait && (
        // eslint-disable-next-line @next/next/no-img-element -- user-uploaded cutout, must render in html2canvas/PDF paths
        <img
          className={styles.portraitImg}
          src={adviser.photoDataUrl!}
          alt=""
          style={{
            transform: `scale(${(adviser.photoScale ?? 100) / 100})`,
            opacity: (adviser.photoOpacity ?? 78) / 100,
          }}
        />
      )}

      <div className={styles.frame}>
        <div className={styles.top}>
          <div className={styles.firm}>{adviser.firmName || "Wealth Advisory"}</div>
          {adviser.logoDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- user-uploaded logo data URI
            <img className={styles.logoImg} src={adviser.logoDataUrl} alt="" />
          ) : (
            <div className={styles.monogram}>{monogramLetter(adviser.firmName || adviser.adviserName || "M")}</div>
          )}
        </div>
        <div className={styles.hair} />

        <div className={styles.spacer} />

        <div className={styles.location}>{kicker}</div>

        <h1 className={`${styles.masthead} ${hasPortrait ? styles.textNarrow : ""}`}>
          {line1}
          {line2 && (
            <>
              <br />
              {line2}
            </>
          )}
        </h1>

        <div className={styles.issue}>
          <span className={styles.issueRule} />
          <span className={styles.issueText}>
            {issueKind} · {quarterLabel}
          </span>
        </div>

        <p className={styles.subtitle}>{subtitle}</p>

        <div className={`${styles.adviser} ${hasPortrait ? styles.textNarrow : ""}`}>
          <div>
            <div className={styles.prepLabel}>Prepared by</div>
            <div className={styles.who}>{adviser.adviserName || "Your Adviser"}</div>
            <div className={styles.role}>
              {[adviser.adviserTitle, adviser.firmName].filter(Boolean).join(" · ")}
            </div>
          </div>
          <div className={styles.contact}>
            {adviser.phone && <div>{adviser.phone}</div>}
            {adviser.email && <div>{adviser.email}</div>}
            <div>{asAtLabel}</div>
          </div>
        </div>

        <div className={`${styles.foot} ${hasPortrait ? styles.textNarrow : ""}`}>
          <div className={styles.disclaimer}>{disclaimer}</div>
          <div className={styles.credit}>
            {photoLocation} — {photoCredit}
          </div>
        </div>
      </div>
    </div>
  );
}
