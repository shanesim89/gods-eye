import { Panel } from "@/components/ui/Panel";
import { requireUser } from "@/lib/auth";
import { getMarketNews, type NewsItem } from "@/lib/finnhub";
import { timeAgo } from "@/lib/format";

export const revalidate = 300;

const CATEGORIES = ["general", "crypto", "forex", "merger"] as const;

function Wire({ items, limit }: { items: NewsItem[]; limit: number }) {
  if (items.length === 0) {
    return <div className="text-dim py-6 text-center text-[11.5px]">No stories on the wire.</div>;
  }
  return (
    <div className="flex flex-col">
      {items.slice(0, limit).map((n) => (
        <a
          key={`${n.url}-${n.datetime}`}
          href={n.url}
          target="_blank"
          rel="noopener noreferrer"
          className="dotted-row py-2 last:border-0 group"
        >
          <div className="text-[12px] leading-snug group-hover:text-cyan transition-colors">
            {n.headline}
          </div>
          <div className="text-dim text-[10px] mt-1 flex gap-2 font-mono">
            <span className="uppercase tracking-[0.5px]">{n.source}</span>
            <span>·</span>
            <span>{timeAgo(new Date(n.datetime * 1000))}</span>
          </div>
        </a>
      ))}
    </div>
  );
}

export default async function MarketNewsPage() {
  await requireUser();

  const [general, crypto, forex, merger] = await Promise.all(
    CATEGORIES.map((c) => getMarketNews(c)),
  );

  const tiles: { title: string; items: NewsItem[] | null; limit: number }[] = [
    { title: "Crypto", items: crypto, limit: 12 },
    { title: "FX & Rates", items: forex, limit: 12 },
    { title: "M&A", items: merger, limit: 12 },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5">
      <div className="lg:col-span-2 lg:row-span-2">
        <Panel title="Market wire" meta={general ? `${general.length} stories` : "unavailable"}>
          <Wire items={general ?? []} limit={30} />
        </Panel>
      </div>
      {tiles.map((t) => (
        <Panel key={t.title} title={t.title} meta={t.items ? `${t.items.length}` : "—"}>
          <Wire items={t.items ?? []} limit={t.limit} />
        </Panel>
      ))}
    </div>
  );
}
