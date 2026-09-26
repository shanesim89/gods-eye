import Link from "next/link";
import { requireUser } from "@/lib/auth";
import CarouselGenerator from "./CarouselGenerator";

export const dynamic = "force-dynamic";

export default async function CarouselStudioPage() {
  await requireUser();

  return (
    <>
      <div className="flex justify-end px-3.5 pt-2">
        <Link
          href="/carousel/quarterly-report"
          className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.5px] bg-cyan/10 border border-cyan/40 text-cyan rounded hover:bg-cyan/20"
        >
          Quarterly Report Generator
        </Link>
      </div>
      <CarouselGenerator />
    </>
  );
}
