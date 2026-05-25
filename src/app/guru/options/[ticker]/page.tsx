import { Panel } from "@/components/ui/Panel";

export default async function Page({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = await params;
  return (
    <Panel title={`OPTIONS · ${decodeURIComponent(ticker).toUpperCase()}`} meta="STUB">
      <div className="text-muted text-[11px]">Options council Phase 3.</div>
    </Panel>
  );
}
