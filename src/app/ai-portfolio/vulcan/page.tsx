import { Panel } from "@/components/ui/Panel";
import { requireUser } from "@/lib/auth";
import { getVulcanDashboardData } from "@/lib/trading/vulcan-dashboard";
import { VulcanLive } from "./VulcanLive";

export const dynamic = "force-dynamic";

export default async function VulcanPage() {
  const user = await requireUser();
  const data = await getVulcanDashboardData(user.id);

  return (
    <Panel title="AI PORTFOLIO · VULCAN EQUITY" meta="PAPER · SECTOR MOMENTUM + RS/VOLUME/STAGE ROTATION">
      <VulcanLive data={data} />
    </Panel>
  );
}
