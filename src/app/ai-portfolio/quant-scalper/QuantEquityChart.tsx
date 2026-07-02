"use client";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

const mono = "JetBrains Mono, Consolas, monospace";

export type EquityPoint = { date: string; equity: number };

export function QuantEquityChart({ data }: { data: EquityPoint[] }) {
  if (data.length < 2)
    return (
      <div className="text-dim text-[10px] italic py-8 text-center">
        Equity curve populates after the paper bot runs daily — awaiting data.
      </div>
    );

  const eq = data.map((d) => d.equity);
  const min = Math.min(...eq);
  const max = Math.max(...eq);
  const pad = (max - min) * 0.08 || 1;
  const step = Math.max(1, Math.floor(data.length / 6));
  const up = eq[eq.length - 1] >= eq[0];
  const color = up ? "#22c55e" : "#ef4444";

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="2 6" stroke="rgba(255,255,255,0.04)" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fill: "#4b5563", fontSize: 9, fontFamily: mono }}
          tickLine={false}
          axisLine={false}
          interval={step}
        />
        <YAxis
          domain={[min - pad, max + pad]}
          tick={{ fill: "#4b5563", fontSize: 9, fontFamily: mono }}
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={(v: number) => `$${(v / 1000).toFixed(1)}k`}
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
          formatter={(v: unknown) => [`$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`, "EQUITY"]}
        />
        <Area
          type="monotone"
          dataKey="equity"
          stroke={color}
          strokeWidth={1.5}
          fill={`${color}10`}
          dot={false}
          activeDot={{ r: 3, fill: color, strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
