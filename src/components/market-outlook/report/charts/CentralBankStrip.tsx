const STANCE_COLOR: Record<string, string> = { hiking: "#c0392b", holding: "#7c8b98", cutting: "#1f8a4c" };
const STANCE_LABEL: Record<string, string> = { hiking: "Hiking", holding: "Holding", cutting: "Cutting" };

export function CentralBankStrip({
  stances,
}: {
  stances: { bank: string; label: string; stance: "hiking" | "holding" | "cutting"; note: string }[];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {stances.map((s, i) => (
        <div
          key={s.bank}
          style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderTop: i === 0 ? "none" : "1px solid #e4e9ed" }}
        >
          <div style={{ width: 140, fontWeight: 600, fontSize: 12, color: "#0e2740", flexShrink: 0 }}>{s.label}</div>
          <div
            style={{
              fontFamily: "var(--font-jetbrains-mono), monospace",
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: 0.5,
              textTransform: "uppercase",
              color: "#fff",
              background: STANCE_COLOR[s.stance],
              borderRadius: 3,
              padding: "3px 8px",
              flexShrink: 0,
            }}
          >
            {STANCE_LABEL[s.stance]}
          </div>
          <div style={{ fontSize: 10.5, color: "#5c6b78", flex: 1 }}>{s.note}</div>
        </div>
      ))}
    </div>
  );
}
