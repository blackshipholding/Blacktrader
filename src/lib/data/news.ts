// Nachrichten der letzten 72 h aus kostenlosen RSS-Quellen (Yahoo Finance, Google News) + optional Finnhub.
import "server-only";
import { XMLParser } from "fast-xml-parser";
import { scoreHeadline } from "../analysis/sentiment";
import type { NewsItem } from "../types";
import { cached, fetchJson, fetchText } from "./http";
import { looksGerman, translateTitles } from "./translate";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" });

interface RssItem {
  title?: string | { "#text"?: string };
  link?: string;
  pubDate?: string;
  source?: string | { "#text"?: string; "@url"?: string };
}

const text = (x: unknown): string => (typeof x === "string" ? x : x && typeof x === "object" && "#text" in x ? String((x as { "#text": unknown })["#text"]) : "");

export function parseRss(xml: string, fallbackSource: string): Omit<NewsItem, "sentiment" | "sentimentScore">[] {
  const doc = parser.parse(xml);
  const items: RssItem[] = [].concat(doc?.rss?.channel?.item ?? []);
  return items
    .map((it) => {
      let title = text(it.title).trim();
      let source = text(it.source) || fallbackSource;
      // Google News hängt " - Quelle" an den Titel
      const m = title.match(/^(.*) - ([^-]{2,60})$/);
      if (m && fallbackSource === "Google News") {
        title = m[1];
        source = text(it.source) || m[2];
      }
      const d = it.pubDate ? new Date(it.pubDate) : null;
      return { title, link: it.link ?? "", source, published: d && !isNaN(+d) ? d.toISOString() : "" };
    })
    .filter((x) => x.title && x.published);
}

async function rss(url: string, source: string) {
  try {
    return parseRss(await fetchText(url, { timeoutMs: 8000 }), source);
  } catch {
    return [];
  }
}

async function finnhubNews(symbol: string, key: string) {
  try {
    const to = new Date();
    const from = new Date(Date.now() - 3 * 86400e3);
    const f = (d: Date) => d.toISOString().slice(0, 10);
    const r = await fetchJson<{ headline: string; url: string; source: string; datetime: number }[]>(
      `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${f(from)}&to=${f(to)}&token=${encodeURIComponent(key)}`,
    );
    return r.slice(0, 20).map((n) => ({ title: n.headline, link: n.url, source: n.source, published: new Date(n.datetime * 1000).toISOString() }));
  } catch {
    return [];
  }
}

export async function getNews(opts: { query: string; yahooSymbol?: string; finnhubKey?: string; finnhubSymbol?: string }): Promise<NewsItem[]> {
  const key = `news-de:${opts.query}:${opts.yahooSymbol ?? ""}:${opts.finnhubKey ? "fh" : ""}`;
  return cached(key, 15 * 60e3, async () => {
    const q = encodeURIComponent(opts.query);
    const lists = await Promise.all([
      opts.yahooSymbol ? rss(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(opts.yahooSymbol)}&region=US&lang=en-US`, "Yahoo Finance") : [],
      rss(`https://news.google.com/rss/search?q=${q}+when:3d&hl=de&gl=DE&ceid=DE:de`, "Google News"),
      rss(`https://news.google.com/rss/search?q=${q}+when:3d&hl=en-US&gl=US&ceid=US:en`, "Google News"),
      opts.finnhubKey && opts.finnhubSymbol ? finnhubNews(opts.finnhubSymbol, opts.finnhubKey) : [],
    ]);
    const cutoff = Date.now() - 72 * 3600e3;
    const seen = new Set<string>();
    const out: NewsItem[] = [];
    for (const n of lists.flat()) {
      const k = n.title.toLowerCase().replace(/\W+/g, "").slice(0, 60);
      if (seen.has(k) || new Date(n.published).getTime() < cutoff) continue;
      seen.add(k);
      // Stimmung immer auf dem Originaltitel bewerten (Analyse unverändert)
      const s = scoreHeadline(n.title);
      out.push({ ...n, sentiment: s.sentiment, sentimentScore: s.score, lang: looksGerman(n.title) ? "de" : "en" });
    }
    // Deutsche Meldungen bevorzugen, englische automatisch übersetzen
    const top = out.sort((a, b) => b.published.localeCompare(a.published)).slice(0, 30);
    const en = top.filter((n) => n.lang === "en");
    if (en.length) {
      const tr = await translateTitles(en.map((n) => n.title)).catch(() => en.map(() => null));
      en.forEach((n, i) => {
        if (tr[i]) {
          n.originalTitle = n.title;
          n.title = tr[i]!;
          n.lang = "de";
          n.translated = true;
        }
      });
    }
    return top;
  });
}
