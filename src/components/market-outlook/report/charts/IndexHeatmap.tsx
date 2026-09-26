// Diverging bar rows for regional index quarter-to-date moves — plain HTML/CSS,
// no SVG needed at all (avoids any html2canvas gradient/mask risk entirely).
export function IndexHeatmap({
  entries,
  width = 686,
  rowHeight = 26,
}: {
  entries: { symbol: string; label: string; changePct: number }[];
  width?: number;
  rowHeight?: number;
}) {
  const maxAbs = Math.max(1, ...entries.map((e) => Math.abs(e.changePct)));
  const midX = width * 0.42;
  const barTrackWidth = width - midX - 60;
  const scale = barTrackWidth / maxAbs;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, width }}>
      {entries.map((e) => {
        const barW = Math.max(2, Math.abs(e.changePct) * scale);
        const pos = e.changePct >= 0;
        return (
          <div key={e.symbol} style={{ display: "flex", alignItems: "center", height: rowHeight, fontSize: 11 }}>
            <div style={{ width: midX - 8, textAlign: "right", paddingRight: 8, color: "#142030", fontWeight: 600 }}>{e.label}</div>
            <div style={{ position: "relative", width: barTrackWidth, height: 10 }}>
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  height: 10,
                  width: barW,
                  left: pos ? 0 : undefined,
                  right: pos ? undefined : 0,
                  background: pos ? "#1f8a4c" : "#c0392b",
                  borderRadius: 2,
                }}
              />
            </div>
            <div
              style={{
                width: 55,
                textAlign: "right",
                fontFamily: "var(--font-jetbrains-mono), monospace",
                fontSize: 10.5,
                fontWeight: 700,
                color: pos ? "#1f8a4c" : "#c0392b",
              }}
            >
              {pos ? "+" : ""}
              {e.changePct.toFixed(1)}%
            </div>
          </div>
        );
      })}
    </div>
  );
}
