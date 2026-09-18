import { Panel } from "@/components/ui/Panel";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function CarouselStudioPage() {
  await requireUser();

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
      <div className="sm:col-span-3">
        <Panel title="Carousel Studio" meta="reserved">
          <div className="py-7 text-center">
            <div className="text-[15px] font-semibold">Not wired yet</div>
            <div className="text-dim text-[11.5px] mt-1 max-w-[46ch] mx-auto">
              Slot held for the slide-builder merge. Nothing here reads live data.
            </div>
          </div>
        </Panel>
      </div>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="border border-dashed border-border rounded-xl min-h-[76px] grid place-items-center text-dim text-[11px]"
        >
          + slide
        </div>
      ))}
    </div>
  );
}
