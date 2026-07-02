import { Panel } from "@/components/ui/Panel";
import { requireUser } from "@/lib/auth";
import { getCryptoDashboardData } from "@/lib/trading/crypto-dashboard";
import { CryptoLive } from "./CryptoLive";

export const dynamic = "force-dynamic";

export default async function CryptoDashboard() {
  const user = await requireUser();
  const data = await getCryptoDashboardData(user.id);

  return (
    <Panel title="AI PORTFOLIO · CRYPTO" meta="DCA + COUNCIL BUY-ZONE">
      <CryptoLive initial={data} />
    </Panel>
  );
}
