import Link from "next/link";
import { requireUser } from "@/lib/auth";
import CarouselGenerator from "./CarouselGenerator";

export const dynamic = "force-dynamic";

export default async function CarouselStudioPage() {
  await requireUser();

  return (
    <>
      <CarouselGenerator quarterlyReportLink={
        <div className="max-w-[980px] mx-auto">
          <div className="border border-dashed border-cyan/40 rounded-xl p-6 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-[15px] font-semibold text-text m-0 mb-1">Quarterly Report Generator</h2>
              <p className="text-[12.5px] text-muted m-0 max-w-[520px]">
                Separate 6-page branded report — scrapes market outlook sources, pulls live index/yield data, and builds a full quarterly investment update with charts, income and opportunities pages, exportable to PDF.
              </p>
            </div>
            <Link
              href="/carousel/quarterly-report"
              className="shrink-0 px-3.5 py-2 text-[12px] font-semibold uppercase tracking-[0.5px] bg-cyan/10 border border-cyan/40 text-cyan rounded-lg hover:bg-cyan/20"
            >
              Open Generator →
            </Link>
          </div>
        </div>
      } />
    </>
  );
}
