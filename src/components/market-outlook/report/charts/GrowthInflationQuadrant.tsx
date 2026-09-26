// 2x2 growth/inflation regime quadrant — plain divs for the four quadrant
// tints (no SVG, no gradients), asset dots positioned by growth/inflation.
export function GrowthInflationQuadrant({
  positions,
  size = 260,
}: {
  positions: { asset: string; growth: number; inflation: number }[];
  size?: number;
}) {
  const toXY = (growth: number, inflation: number) => {
    const x = ((growth + 100) / 200) * size;
    const y = size - ((inflation + 100) / 200) * size;
    return { x, y };
  };

  return (
    <div style={{ position: "relative", width: size, height: size, border: "1px solid #dde3e8" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: "50%", height: "50%", background: "#eef4f3" }} />
      <div style={{ position: "absolute", left: "50%", top: 0, width: "50%", height: "50%", background: "#0e2740" }} />
      <div style={{ position: "absolute", left: 0, top: "50%", width: "50%", height: "50%", background: "#f7f8f7" }} />
      <div style={{ position: "absolute", left: "50%", top: "50%", width: "50%", height: "50%", background: "#eceff1" }} />
      <div style={{ position: "absolute", left: "50%", top: 0, width: 1, height: "100%", background: "#fbfbf9" }} />
      <div style={{ position: "absolute", left: 0, top: "50%", width: "100%", height: 1, background: "#fbfbf9" }} />
      {positions.map((p) => {
        const { x, y } = toXY(p.growth, p.inflation);
        const onDarkQuadrant = p.growth >= 0 && p.inflation >= 0;
        return (
          <div key={p.asset} style={{ position: "absolute", left: x, top: y, transform: "translate(-50%, -50%)", textAlign: "center" }}>
            <div style={{ width: 8, height: 8, borderRadius: 999, background: onDarkQuadrant ? "#fff" : "#0e2740", margin: "0 auto 3px" }} />
            <div
              style={{
                fontFamily: "var(--font-jetbrains-mono), monospace",
                fontSize: 8.5,
                fontWeight: 700,
                color: onDarkQuadrant ? "#fff" : "#142030",
                whiteSpace: "nowrap",
              }}
            >
              {p.asset}
            </div>
          </div>
        );
      })}
    </div>
  );
}
