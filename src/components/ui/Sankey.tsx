"use client";
import { useMemo } from "react";
import { sankey, sankeyLinkHorizontal, sankeyLeft } from "d3-sankey";

export type SankeyData = {
  nodes: { name: string; color?: string }[];
  links: { source: number; target: number; value: number }[];
};

export function Sankey({
  data,
  height = 200,
}: {
  data: SankeyData;
  height?: number;
}) {
  const { nodes, links } = useMemo(() => {
    if (data.links.length === 0 || data.nodes.length === 0) {
      return { nodes: [], links: [] };
    }
    const width = 600;
    const layout = sankey<
      { name: string; color?: string },
      { source: number; target: number; value: number }
    >()
      .nodeWidth(10)
      .nodePadding(8)
      .nodeAlign(sankeyLeft)
      .extent([
        [1, 1],
        [width - 1, height - 1],
      ]);
    return layout({
      nodes: data.nodes.map((d) => ({ ...d })),
      links: data.links.map((d) => ({ ...d })),
    });
  }, [data, height]);

  if (links.length === 0) {
    return (
      <div className="text-muted text-[11px] py-4 text-center border border-dim border-dashed">
        no flow data — add income + expenses to populate
      </div>
    );
  }

  return (
    <svg viewBox={`0 0 600 ${height}`} preserveAspectRatio="xMidYMid meet" className="w-full h-auto">
      <g fill="none">
        {links.map((l, i) => {
          const path = sankeyLinkHorizontal()(
            l as unknown as Parameters<ReturnType<typeof sankeyLinkHorizontal>>[0]
          );
          const target = l.target as unknown as { color?: string };
          return (
            <path
              key={i}
              d={path ?? undefined}
              stroke={target?.color ?? "#6b6b6b"}
              strokeOpacity={0.4}
              strokeWidth={Math.max(1, l.width ?? 1)}
            />
          );
        })}
      </g>
      <g>
        {nodes.map((n, i) => (
          <g key={i}>
            <rect
              x={n.x0}
              y={n.y0}
              width={(n.x1 ?? 0) - (n.x0 ?? 0)}
              height={(n.y1 ?? 0) - (n.y0 ?? 0)}
              fill={n.color ?? "#ffb000"}
            />
            <text
              x={(n.x0 ?? 0) < 300 ? (n.x1 ?? 0) + 4 : (n.x0 ?? 0) - 4}
              y={((n.y0 ?? 0) + (n.y1 ?? 0)) / 2}
              dy="0.35em"
              textAnchor={(n.x0 ?? 0) < 300 ? "start" : "end"}
              fontSize={9}
              fill="#d4d4d4"
              fontFamily="var(--font-jetbrains-mono), monospace"
            >
              {n.name}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}
