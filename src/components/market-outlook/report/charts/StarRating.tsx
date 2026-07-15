// 1-5 star rating rendered as inline SVG stars (crisp in both screen preview
// and the react-pdf export — no font glyph reliance for ★/☆).
function Star({ filled, size, color }: { filled: boolean; size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "inline-block" }}>
      <path
        d="M12 2.5l2.9 6.3 6.9.7-5.2 4.7 1.5 6.8L12 17.6l-6.1 3.4 1.5-6.8L2.2 9.5l6.9-.7z"
        fill={filled ? color : "none"}
        stroke={color}
        strokeWidth={filled ? 0 : 1.4}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function StarRating({ rating, size = 13, color = "#0e2740" }: { rating: number; size?: number; color?: string }) {
  return (
    <span style={{ display: "inline-flex", gap: 1 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} filled={n <= rating} size={size} color={color} />
      ))}
    </span>
  );
}
