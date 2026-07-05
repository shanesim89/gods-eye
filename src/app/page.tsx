import { Panel } from "@/components/ui/Panel";
import { requireUser } from "@/lib/auth";
import { buildHomeState } from "@/lib/ai-portfolio/overview";
import { HomeLive } from "@/components/home/HomeLive";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireUser();
  const initial = await buildHomeState(user.id);

  return (
    <Panel title="COMMAND CENTER" meta="LIVE MONEY + PAPER FLEET · 20s refresh">
      <HomeLive initial={initial} />
    </Panel>
  );
}
