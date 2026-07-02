import { Panel } from "@/components/ui/Panel";
import { ScreenWorkspace } from "./_components/ScreenWorkspace";

export const dynamic = "force-dynamic";

export default function ScreenPage() {
  return (
    <Panel title="TREND SPOTTING" meta="NL THEME → RANKED UNIVERSE">
      <div className="text-[10px] text-dim mb-3 leading-relaxed">
        Describe a theme in plain English. An agent translates it into a
        structured screen over the live universe — the crypto moonshot scanner
        or the stock momentum/dip pipelines — and ranks matches by a weighted
        signal score. Criteria with no data source (insider buying, 13F flow,
        transcripts) are flagged, never silently dropped.
      </div>
      <ScreenWorkspace />
    </Panel>
  );
}
