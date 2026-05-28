"use client";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

type DataPoint = {
  date: string;
  close: number;
  volume: number;
};

const mono = "JetBrains Mono, Consolas, monospace";

export function PriceChart({ data, currency = "$" }: { data: DataPoint[]; currency?: string }) {
  if (data.length === 0) return <div className="text-muted text-[10px] text-center py-8">no chart data</div>;

  const prices = data.map((d) => d.close);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const pad = (max - min) * 0.05 || 1;
  const maxVol = Math.max(...data.map((d) => d.volume));
  const step = Math.max(1, Math.floor(data.length / 7));
  const firstPrice = prices[0];
  const lastPrice = prices[prices.length - 1];
  const priceDiff = lastPrice - firstPrice;
  const lineColor = priceDiff >= 0 ? "#22c55e" : "#ef4444";

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid
          strokeDasharray="2 6"
          stroke="rgba(255,255,255,0.04)"
          vertical={false}
        />
        <XAxis
          dataKey="date"
          tick={{ fill: "#4b5563", fontSize: 9, fontFamily: mono }}
          tickLine={false}
          axisLine={false}
          interval={step}
        />
        <YAxis
          yAxisId="price"
          domain={[min - pad, max + pad]}
          tick={{ fill: "#4b5563", fontSize: 9, fontFamily: mono }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${currency}${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)}`}
          width={46}
        />
        <YAxis
          yAxisId="volume"
          orientation="right"
          tick={false}
          axisLine={false}
          tickLine={false}
          domain={[0, maxVol * 5]}
          width={0}
        />
        <Tooltip
          contentStyle={{
            background: "#0a0a0a",
            border: "1px solid #1f1f3a",
            fontFamily: mono,
            fontSize: 10,
            padding: "6px 10px",
          }}
          labelStyle={{ color: "#6b7280", marginBottom: 4 }}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={(v: any, name: any) => {
            const num = Number(v);
            if (name === "close")
              return [`${currency}${num.toFixed(2)}`, "CLOSE"];
            if (name === "volume")
              return [
                Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(num),
                "VOL",
              ];
            return [v, name];
          }}
        />
        <Bar
          yAxisId="volume"
          dataKey="volume"
          fill="rgba(245,158,11,0.12)"
          radius={[1, 1, 0, 0]}
        />
        <Area
          yAxisId="price"
          type="monotone"
          dataKey="close"
          stroke={lineColor}
          strokeWidth={1.5}
          fill={`${lineColor}10`}
          dot={false}
          activeDot={{ r: 3, fill: lineColor, strokeWidth: 0 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
