export function BigNum({
  currency,
  value,
  delta,
  deltaTone = "green",
}: {
  currency: string;
  value: string;
  delta?: string;
  deltaTone?: "green" | "red";
}) {
  return (
    <div>
      <div className="text-[36px] font-bold text-text tracking-wide leading-none">
        <span className="text-muted text-base mr-1.5">{currency}</span>
        {value}
      </div>
      {delta && (
        <div
          className={`text-xs mt-1 ${
            deltaTone === "green" ? "text-green" : "text-red"
          }`}
        >
          {delta}
        </div>
      )}
    </div>
  );
}
