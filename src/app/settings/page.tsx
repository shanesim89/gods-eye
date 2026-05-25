import { Panel } from "@/components/ui/Panel";
import { Row } from "@/components/ui/Row";

export default function Page() {
  return (
    <Panel title="SETTINGS" meta="PHASE 1+">
      <Row k="Base Currency" v="USD" />
      <Row k="FX Provider" v="exchangerate.host" />
      <Row k="Market Data" v="Finnhub + CoinGecko" />
      <Row k="News" v="Marketaux" />
      <Row k="LLM" v="Claude Sonnet 4.6" />
    </Panel>
  );
}
