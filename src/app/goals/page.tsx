import { Panel } from "@/components/ui/Panel";

export default function Page() {
  return (
    <Panel title="GOALS · NET WORTH TARGETS" meta="ROADMAP">
      <div className="space-y-3 text-[11px]">
        <div className="border border-border bg-grid p-3">
          <div className="text-amber font-bold tracking-[1px] mb-1">▸ ROADMAP</div>
          <div className="text-muted">
            FIRE number, monthly runway, and time-to-goal projections are scheduled
            for the next release. For now, track holdings under{" "}
            <a href="/money-map/assets" className="text-cyan hover:underline">MONEY MAP → ASSETS</a>
            {" "}and income under{" "}
            <a href="/money-map/income" className="text-cyan hover:underline">INCOME</a>.
          </div>
        </div>
        <div className="border border-border bg-grid p-3">
          <div className="text-cyan font-bold tracking-[1px] mb-1">▸ PLANNED METRICS</div>
          <ul className="text-muted list-disc pl-4 space-y-1">
            <li>FIRE number = 25× annual expenses</li>
            <li>Runway months = liquid_assets ÷ monthly_burn</li>
            <li>Time-to-FIRE = solve from current net worth + savings rate + return assumption</li>
            <li>Drawdown stress test (−30% equities scenario)</li>
          </ul>
        </div>
      </div>
    </Panel>
  );
}
