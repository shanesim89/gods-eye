import type { ActivityRow } from "@/lib/ai-portfolio/overview";
import { rel, toneColor } from "./format";

export function ActivityTable({
  rows,
  fallbackNote,
}: {
  rows: ActivityRow[];
  fallbackNote?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="text-dim text-[10px] italic py-2">
        {fallbackNote ?? "No activity in the last 24h."}
      </div>
    );
  }
  return (
    <table className="w-full text-[10px]">
      <tbody>
        {rows.map((r, i) => (
          <tr key={`${r.ts}-${i}`} className="dotted-row align-top">
            <td className="py-1 pr-2 text-dim whitespace-nowrap tabular-nums w-[34px]">{rel(r.ts)}</td>
            <td className={`py-1 pr-2 font-bold whitespace-nowrap ${toneColor[r.tone] ?? "text-muted"}`}>
              {r.label}
            </td>
            <td className="py-1 text-muted leading-snug">{r.detail}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
