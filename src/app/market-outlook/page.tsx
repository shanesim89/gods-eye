import { requireUser } from "@/lib/auth";
import { MarketOutlookClientLoader } from "@/components/market-outlook/MarketOutlookClientLoader";

export const dynamic = "force-dynamic";

export default async function MarketOutlookPage() {
  await requireUser();
  return <MarketOutlookClientLoader />;
}
