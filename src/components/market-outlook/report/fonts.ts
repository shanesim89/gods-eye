// Report-only type system — deliberately NOT the app's terminal mono aesthetic,
// and deliberately NOT a fashion-magazine Didone either. Source Serif 4 is the
// same family of book-serif institutions actually use in quarterly PDFs
// (J.P. Morgan Guide to the Markets, BlackRock, Capital Group all run a
// text-serif headline, not an italic display face). Public Sans is the
// typeface built for official US government publications — reads as
// institutional, not the Inter/Space-Grotesk "safe AI default". JetBrains
// Mono (already global) carries data + labels. Scoped to the report tree via
// CSS variables so it never bleeds into the dark dashboard chrome.
import { Source_Serif_4, Public_Sans } from "next/font/google";

export const reportDisplay = Source_Serif_4({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-report-display",
  display: "swap",
});

export const reportBody = Public_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-report-body",
  display: "swap",
});
