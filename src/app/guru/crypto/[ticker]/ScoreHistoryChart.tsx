"use client";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { ScoreHistoryPoint } from "@/lib/crypto/scanner";

const mono = "JetBrains Mono, Consolas, monospace";

export function ScoreHistoryChart({
  data,
  symbol,
}: {
  data: ScoreHistoryPoint[];
  symbol: string;
}) {
  if (data.length < 2) return null;

  const pts = [...data]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      date: d.date.slice(5),
      moonshot: d.scoreMoonshot,
      scalp: d.scoreScalp,
    }));

  const step = Math.max(1, Math.floor(pts.length / 6));

  return (
    <div className="border border-border bg-grid p-3 mb-3">
      <div className="text-muted text-[10px] mb-2 uppercase tracking-[1px]">
        SCANNER SCORE HISTORY · {symbol} · LAST {data.length} DAYS
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={pts} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
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
            domain={[0, 100]}
            tick={{ fill: "#4b5563", fontSize: 9, fontFamily: mono }}
            tickLine={false}
            axisLine={false}
            width={24}
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
            formatter={(v: unknown, name: unknown) => [
              String(v),
              name === "moonshot" ? "MOONSHOT" : "SCALP",
            ]}
          />
          <Line
            type="monotone"
            dataKey="moonshot"
            name="moonshot"
            stroke="#f59e0b"
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3, fill: "#f59e0b", strokeWidth: 0 }}
          />
          <Line
            type="monotone"
            dataKey="scalp"
            name="scalp"
            stroke="#22c55e"
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3, fill: "#22c55e", strokeWidth: 0 }}
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="flex gap-4 mt-1 text-[9px]">
        <span className="text-amber">◆ MOONSHOT score</span>
        <span className="text-green">⚡ SCALP score</span>
        <span className="text-dim">(0–100 · populated after first cron run)</span>
      </div>
    </div>
  );
}
