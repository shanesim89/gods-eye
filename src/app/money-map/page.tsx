import { Panel } from "@/components/ui/Panel";
import { Row, SectionLabel } from "@/components/ui/Row";
import { BigNum } from "@/components/ui/BigNum";

export default function MoneyMapPage() {
  return (
    <div className="grid grid-cols-2 gap-3 h-[calc(100vh-120px)]">
      <Panel title="NET WORTH" meta="STUB · NO DATA YET">
        <BigNum
          currency="USD"
          value="0"
          delta="▲ 0% — connect DB to populate"
        />
        <SectionLabel>BREAKDOWN</SectionLabel>
        <Row k="Cash & Equiv" v="$ —" tone="muted" />
        <Row k="Equities" v="$ —" tone="muted" />
        <Row k="Crypto" v="$ —" tone="muted" />
        <Row k="ETF / Unit Trust" v="$ —" tone="muted" />
        <Row k="Liabilities" v="$ —" tone="muted" />
      </Panel>

      <Panel title="CASH FLOW · MAY 2026" meta="STUB">
        <Row k="Monthly Inflow" v="+ $ —" tone="muted" />
        <Row k="Monthly Outflow" v="- $ —" tone="muted" />
        <Row k="Net Free Cash" v="$ —" tone="muted" />
        <SectionLabel>SANKEY (Phase 1)</SectionLabel>
        <div className="text-muted text-[11px] py-4 text-center border border-dim border-dashed mt-2">
          d3-sankey flow viz here
        </div>
      </Panel>

      <Panel title="COMMITMENTS" meta="STUB">
        <Row k="Subscriptions" v="$ —" tone="muted" />
        <Row k="Fixed Exp" v="$ —" tone="muted" />
        <Row k="DCA Invest" v="$ —" tone="muted" />
        <Row k="Loan Pmt" v="$ —" tone="muted" />
        <SectionLabel>TOP SUBSCRIPTIONS</SectionLabel>
        <div className="text-muted text-[11px] py-4 text-center">no data — add via /money-map/subscriptions</div>
      </Panel>

      <Panel title="INCOME PULSE" meta="STUB">
        <BigNum currency="YTD" value="0" />
        <SectionLabel>NEXT INFLOWS</SectionLabel>
        <div className="text-muted text-[11px] py-4 text-center">no income sources configured</div>
      </Panel>
    </div>
  );
}
