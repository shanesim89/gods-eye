// Business-cycle arc — two joined cubic Béziers split exactly at the
// Late→Recession boundary (t=0.75), both pinned to the baseline there, so the
// green→red color switch lands exactly on the phase divider by construction
// and each bubble's Y comes from the same formula that draws the line (no
// sampling mismatch). No SVG gradients/text — see html2canvas notes in the
// sibling chart files.
import type { CSSProperties } from "react";

type Pt = readonly [number, number];

function bezierPoint(t: number, p0: Pt, p1: Pt, p2: Pt, p3: Pt): Pt {
  const mt = 1 - t;
  const x = mt ** 3 * p0[0] + 3 * mt ** 2 * t * p1[0] + 3 * mt * t ** 2 * p2[0] + t ** 3 * p3[0];
  const y = mt ** 3 * p0[1] + 3 * mt ** 2 * t * p1[1] + 3 * mt * t ** 2 * p2[1] + t ** 3 * p3[1];
  return [x, y];
}

function bezierPath(p0: Pt, p1: Pt, p2: Pt, p3: Pt): string {
  return `M${p0[0].toFixed(1)},${p0[1].toFixed(1)} C${p1[0].toFixed(1)},${p1[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)} ${p3[0].toFixed(1)},${p3[1].toFixed(1)}`;
}

// Same 4 stops as the panel's Expansion→Contraction legend bar, so a bubble's
// color always matches the phase column it visually sits under.
function phaseColor(phasePct: number): string {
  if (phasePct < 25) return "#1f8a4c"; // Early
  if (phasePct < 50) return "#159a94"; // Mid
  if (phasePct < 75) return "#d9a441"; // Late
  return "#c0392b"; // Recession
}

const LABEL_W = 92; // must match the label span's fixed width below
const LABEL_GAP = 4; // minimum horizontal gap between neighboring labels
const LANE_H = 13; // vertical pitch between stacked label lanes

// Greedily assigns each x position to the lowest lane where its label
// footprint (x - LABEL_W/2 .. x + LABEL_W/2) doesn't collide with a label
// already placed in that lane. Keeps clustered bubbles (common when several
// regions land at a similar cycle phase) from producing overlapping text.
function assignLanes(xs: { x: number; index: number }[]): number[] {
  const sorted = [...xs].sort((a, b) => a.x - b.x);
  const laneRightEdge: number[] = []; // rightmost label edge used per lane
  const lanes = new Array<number>(xs.length);
  for (const { x, index } of sorted) {
    const left = x - LABEL_W / 2;
    let lane = laneRightEdge.findIndex((edge) => left >= edge + LABEL_GAP);
    if (lane === -1) lane = laneRightEdge.length;
    laneRightEdge[lane] = x + LABEL_W / 2;
    lanes[index] = lane;
  }
  return lanes;
}

export function CycleArc({
  positions,
  width = 686,
  height = 120,
}: {
  positions: { region: string; code: string; phasePct: number }[];
  width?: number;
  height?: number;
}) {
  const baselineY = height * 0.62;
  const ampUp = height * 0.52;
  const ampDown = height * 0.28;
  const splitX = width * 0.75;

  const seg1: [Pt, Pt, Pt, Pt] = [
    [0, baselineY],
    [splitX / 3, baselineY - ampUp],
    [(splitX / 3) * 2, baselineY - ampUp * 0.45],
    [splitX, baselineY],
  ];
  const seg2: [Pt, Pt, Pt, Pt] = [
    [splitX, baselineY],
    [splitX + (width - splitX) / 3, baselineY + ampDown * 0.6],
    [splitX + ((width - splitX) * 2) / 3, baselineY + ampDown],
    [width, baselineY + ampDown * 0.85],
  ];

  function pointForPhasePct(phasePct: number): Pt {
    const t = Math.min(100, Math.max(0, phasePct)) / 100;
    return t <= 0.75 ? bezierPoint(t / 0.75, ...seg1) : bezierPoint((t - 0.75) / 0.25, ...seg2);
  }

  const dividerXs = [width * 0.25, width * 0.5, width * 0.75];
  const bubbleRadius = (i: number) => 8 + (i % 3);

  const points = positions.map((p, i) => {
    const [x, y] = pointForPhasePct(p.phasePct);
    return { x, y, r: bubbleRadius(i) };
  });
  const lanes = assignLanes(points.map((pt, index) => ({ x: pt.x, index })));
  const maxLane = lanes.length ? Math.max(...lanes) : 0;
  // All labels share one baseline (below the lowest bubble) then stack into
  // lanes from there — keeps the label block a clean, level band rather than
  // following each bubble's own y, and a short connector ties each label
  // back to its bubble so the offset stays legible.
  const baseY = points.length ? Math.max(...points.map((pt) => pt.y + pt.r + 5)) : height + 5;
  const labelAreaHeight = (maxLane + 1) * LANE_H + 4;

  return (
    <div style={{ position: "relative", width, height: baseY + labelAreaHeight }}>
      <svg
        width={width}
        height={baseY + labelAreaHeight}
        viewBox={`0 0 ${width} ${baseY + labelAreaHeight}`}
        style={{ display: "block" }}
      >
        <line x1={0} y1={baselineY} x2={width} y2={baselineY} stroke="#c7cfd6" strokeWidth={1} />
        {dividerXs.map((x, i) => (
          <line key={i} x1={x} y1={0} x2={x} y2={height} stroke="#dde3e8" strokeWidth={1} />
        ))}
        <path d={bezierPath(...seg1)} fill="none" stroke="#1f8a4c" strokeWidth={2.4} strokeLinecap="round" />
        <path d={bezierPath(...seg2)} fill="none" stroke="#c0392b" strokeWidth={2.4} strokeLinecap="round" />
        {positions.map((p, i) => {
          const { x, y, r } = points[i];
          const labelTop = baseY + lanes[i] * LANE_H;
          return (
            <g key={p.region}>
              {lanes[i] > 0 && (
                <line x1={x} y1={y + r + 2} x2={x} y2={labelTop} stroke="#c7cfd6" strokeWidth={1} strokeDasharray="1.5 1.5" />
              )}
              <circle cx={x} cy={y} r={r} fill={phaseColor(p.phasePct)} stroke="#fbfbf9" strokeWidth={1.5} />
            </g>
          );
        })}
      </svg>
      {positions.map((p, i) => {
        const { x } = points[i];
        const style: CSSProperties = {
          position: "absolute",
          left: x,
          top: baseY + lanes[i] * LANE_H,
          transform: "translateX(-50%)",
          width: LABEL_W,
          textAlign: "center",
          fontFamily: "var(--font-jetbrains-mono), monospace",
          fontSize: 7.5,
          fontWeight: 700,
          lineHeight: 1.15,
          color: "#0e2740",
          pointerEvents: "none",
        };
        return (
          <span key={p.region} style={style} title={p.region}>
            {p.region}
          </span>
        );
      })}
    </div>
  );
}
