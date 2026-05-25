import Link from "next/link";
import { Panel } from "@/components/ui/Panel";

const CLASSES = [
  { slug: "stocks", label: "STOCKS", example: "AAPL" },
  { slug: "etf", label: "ETF / UNIT TRUST", example: "VOO" },
  { slug: "crypto", label: "CRYPTO", example: "BTC" },
  { slug: "options", label: "OPTIONS", example: "SPY-250620C500" },
];

export default function GuruPage() {
  return (
    <Panel title="INVESTMENT GURU" meta="PICK ASSET CLASS · ENTER TICKER">
      <div className="grid grid-cols-2 gap-3 mt-2">
        {CLASSES.map((c) => (
          <Link
            key={c.slug}
            href={`/guru/${c.slug}/${c.example}`}
            className="border border-border bg-grid p-4 hover:border-amber transition-colors"
          >
            <div className="text-amber text-[11px] tracking-[1.5px]">
              ▸ {c.label}
            </div>
            <div className="text-muted text-[10px] mt-2">
              example query: <span className="text-cyan">{c.example}</span>
            </div>
          </Link>
        ))}
      </div>
      <div className="text-muted text-[10px] mt-6">
        ticker search bar Phase 2. council verdict Phase 3.
      </div>
    </Panel>
  );
}
