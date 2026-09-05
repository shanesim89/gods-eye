import { Panel } from "@/components/ui/Panel";
import { requireUser } from "@/lib/auth";
import { getUniverseDashboardData } from "@/lib/trading/universe-dashboard";
import { UniverseLive } from "./UniverseLive";

export const dynamic = "force-dynamic";

export default async function UniversePage() {
  await requireUser();
  const data = await getUniverseDashboardData();

  return (
    <Panel title="AI PORTFOLIO · UNIVERSE" meta="PAPER · KRONOS-GATED INTRADAY PULLBACK">
      <UniverseLive initial={data} />
    </Panel>
  );
}
