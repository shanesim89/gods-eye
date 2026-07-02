import type { OptionsAnalysis } from "@/lib/options/analytics";

const f = (v: number, d = 2) =>
  v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const usd = (v: number, d = 2) => `$${f(v, d)}`;
const pct = (v: number, d = 1) => `${f(v, d)}%`;

function Tile({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "green" | "red" | "amber" | "cyan";
}) {
  const toneClass =
    tone === "green" ? "text-green" : tone === "red" ? "text-red" : tone === "amber" ? "text-amber" : tone === "cyan" ? "text-cyan" : "text-text";
  return (
    <div className="border border-border bg-grid px-2.5 py-2">
      <div className="text-dim text-[9px] uppercase tracking-[1px]">{label}</div>
      <div className={`text-[14px] font-bold tabular-nums ${toneClass}`}>{value}</div>
      {sub && <div className="text-dim text-[9px] mt-0.5">{sub}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="text-muted text-[10px] uppercase tracking-[1.5px] mb-1.5">{title}</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{children}</div>
    </div>
  );
}

export function ContractSummary({ a }: { a: OptionsAnalysis }) {
  const s = a.selected;
  if (!s) return <div className="text-dim text-[11px] italic py-4">No contract selected.</div>;

  const ivHv = a.chainStats.ivVsHv;
  const em = a.chainStats.expectedMove;
  const ivTone = ivHv.flag === "rich" ? "red" : ivHv.flag === "cheap" ? "green" : "amber";
  const edgeTone = s.edgePct > 3 ? "green" : s.edgePct < -3 ? "red" : "default";

  return (
    <div>
      <Section title="Pricing">
        <Tile label="Spot" value={usd(a.spot)} sub={a.underlying} tone="cyan" />
        <Tile label="Premium (mid)" value={usd(s.premium)} sub={`${usd(s.intrinsic)} intr + ${usd(s.extrinsic)} extr`} />
        <Tile label="Fair Value (BS)" value={usd(s.fairValue)} tone={edgeTone} sub={`edge ${s.edgePct >= 0 ? "+" : ""}${f(s.edgePct, 1)}%`} />
        <Tile label="Breakeven" value={usd(s.breakeven)} tone="amber" sub={`${s.type === "C" ? "K + prem" : "K − prem"}`} />
      </Section>

      <Section title="Probability & Risk/Reward">
        <Tile label="Prob ITM" value={pct(s.probITM)} sub="risk-neutral N(d₂)" />
        <Tile label="Prob of Profit" value={pct(s.pop)} tone={s.pop >= 50 ? "green" : "red"} sub="long hold to expiry" />
        <Tile label="Max Loss" value={usd(s.maxLoss, 0)} tone="red" sub="debit paid" />
        <Tile
          label="Max Gain"
          value={s.maxGain == null ? "Unlimited" : usd(s.maxGain, 0)}
          tone="green"
          sub={s.riskReward != null ? `R:R ${f(s.riskReward, 2)}` : "uncapped"}
        />
      </Section>

      <Section title="Greeks">
        <Tile label="Delta" value={f(s.greeks.delta, 3)} sub={`${s.greeksSource === "native" ? "exchange" : "Black-Scholes"}`} />
        <Tile label="Gamma" value={f(s.greeks.gamma, 4)} />
        <Tile label="Theta / day" value={usd(s.greeks.theta)} tone="red" />
        <Tile label="Vega / 1%" value={usd(s.greeks.vega)} />
      </Section>

      <Section title="Volatility & Flow">
        <Tile label="Contract IV" value={pct(s.iv * 100)} />
        <Tile label="IV vs HV" value={`${f(ivHv.ratio, 2)}×`} tone={ivTone} sub={`${ivHv.flag} · HV ${pct(a.hv * 100, 0)}`} />
        <Tile label="IV %ile (proxy)" value={pct(ivHv.proxyPctile, 0)} sub="vs realized-vol band" />
        <Tile label="ATM IV" value={pct(a.chainStats.atmIV * 100)} />
        <Tile label="Expected Move" value={`±${usd(em.oneSigma, 0)}`} sub={`±${f(em.pct, 1)}% (1σ)`} tone="cyan" />
        <Tile label="Straddle Move" value={em.straddle == null ? "—" : `±${usd(em.straddle, 0)}`} sub="market-implied" />
        <Tile label="Put/Call (OI)" value={f(a.chainStats.putCall.oi, 2)} tone={a.chainStats.putCall.oi > 1 ? "red" : "green"} sub="> 1 = put-heavy" />
        <Tile label="Max Pain" value={usd(a.chainStats.maxPain, 0)} tone="amber" sub="expiry magnet" />
      </Section>

      <Section title="Liquidity">
        <Tile label="Open Interest" value={s.openInterest.toLocaleString("en-US")} />
        <Tile label="Volume" value={s.volume.toLocaleString("en-US")} />
        <Tile label="Bid/Ask Spread" value={pct(s.spreadPct)} tone={s.spreadPct > 10 ? "red" : s.spreadPct > 5 ? "amber" : "green"} sub="of mid" />
        <Tile label="DTE" value={`${a.dte}d`} sub={a.expiryISO} />
      </Section>
    </div>
  );
}
