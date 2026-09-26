import "server-only";
import * as cheerio from "cheerio";

export type ScrapedArticle = {
  source: string;
  url: string;
  title: string;
  content: string;
};

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, {
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; gods-eye-outlook-reader/1.0)" },
    });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

function textOf($: cheerio.CheerioAPI, sel: string, limit = 4000): string {
  return $(sel).first().text().replace(/\s+/g, " ").trim().slice(0, limit);
}

type Source = {
  source: string;
  url: string;
  titleSel: string;
  contentSel: string;
};

const SOURCES: Source[] = [
  {
    source: "AllianzGI",
    url: "https://www.allianzgi.com/en/insights",
    titleSel: "article h1, article h2, main h1",
    contentSel: "article, main",
  },
  {
    source: "Acorn Fund Distribution",
    url: "https://www.acorninternationalfd.com/news-insights/",
    titleSel: "article h1, article h2, main h1",
    contentSel: "article, main",
  },
  {
    source: "Vanguard",
    url: "https://corporate.vanguard.com/content/corporatesite/us/en/corp/what-we-think/investing-insights/perspectives-and-commentary.html",
    titleSel: "h1, h2",
    contentSel: "body",
  },
];

async function scrapeOne(s: Source): Promise<ScrapedArticle | null> {
  const html = await fetchHtml(s.url);
  if (!html) return null;
  try {
    const $ = cheerio.load(html);
    const title = textOf($, s.titleSel, 200) || s.source;
    const content = textOf($, s.contentSel, 6000);
    if (!content || content.length < 200) return null; // likely gated/JS-rendered — skip
    return { source: s.source, url: s.url, title, content };
  } catch {
    return null;
  }
}

/** Best-effort scrape of all 6 sources. Skips any that fail or are gated. */
export async function scrapeAllSources(): Promise<{
  articles: ScrapedArticle[];
  skipped: string[];
}> {
  const results = await Promise.all(SOURCES.map(scrapeOne));
  const articles = results.filter((r): r is ScrapedArticle => r != null);
  const skipped = SOURCES.map((s) => s.source).filter(
    (name) => !articles.some((a) => a.source === name)
  );
  return { articles, skipped };
}
