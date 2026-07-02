import { Panel } from "@/components/ui/Panel";
import { requireUser } from "@/lib/auth";
import { getOptionsDashboardData } from "@/lib/trading/options-dashboard";
import { OptionsLive } from "./OptionsLive";

export const dynamic = "force-dynamic";

export default async function OptionsPage() {
  const user = await requireUser();
  const data = await getOptionsDashboardData(user.id);

  return (
    <Panel title="AI PORTFOLIO · OPTIONS" meta="PAPER · THE WHEEL + COUNCIL LONG PLAYS">
      <OptionsLive initial={data} />
    </Panel>
  );
}
