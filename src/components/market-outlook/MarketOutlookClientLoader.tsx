"use client";
import dynamic from "next/dynamic";

const MarketOutlookClient = dynamic(() => import("./MarketOutlookClient"), { ssr: false });

export function MarketOutlookClientLoader() {
  return <MarketOutlookClient />;
}
