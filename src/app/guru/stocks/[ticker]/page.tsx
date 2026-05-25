import { Panel } from "@/components/ui/Panel";
import { Row, SectionLabel } from "@/components/ui/Row";

export default async function Page({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = await params;
  const t = decodeURIComponent(ticker).toUpperCase();
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <Panel title={`STOCK · ${t}`} meta="STUB · MARKET DATA PHASE 2">
        <Row k="Last" v="$ —" tone="muted" />
        <Row k="Day Change" v="—" tone="muted" />
        <Row k="Volume" v="—" tone="muted" />
        <SectionLabel>FUNDAMENTALS</SectionLabel>
        <Row k="P/E" v="—" tone="muted" />
        <Row k="Market Cap" v="—" tone="muted" />
      </Panel>
      <Panel title="COUNCIL VERDICT" meta="PHASE 3">
        <div className="text-amber text-2xl font-bold tracking-wider">— HOLD —</div>
        <div className="text-muted text-[11px] mt-2">confidence: stub</div>
        <SectionLabel>BULL CASE</SectionLabel>
        <div className="text-text text-[11px]">awaiting council agents</div>
        <SectionLabel>BEAR CASE</SectionLabel>
        <div className="text-text text-[11px]">awaiting council agents</div>
      </Panel>
    </div>
  );
}
