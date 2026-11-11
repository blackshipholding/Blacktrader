// Modul B: Fundamentaldaten & News → Score 0 … 100 (50 = neutral).
import type { CryptoFundamentals, Fundamentals, NewsItem, StockFundamentals } from "../types";

export interface SubScore {
  name: string;
  value: string;
  score: number;
  comment: string;
}

export interface FundamentalResult {
  score: number;
  fundamentalScore: number | null;
  newsScore: number | null;
  items: SubScore[];
  newsCount: number;
  warnings: string[];
}

const lerp = (x: number, x0: number, x1: number, y0: number, y1: number) => {
  const t = Math.max(0, Math.min(1, (x - x0) / (x1 - x0)));
  return y0 + t * (y1 - y0);
};
const pct = (x: number) => `${(x * 100).toFixed(1)} %`;
const num = (x: number, d = 1) => x.toLocaleString("de-DE", { maximumFractionDigits: d });

export function compactNumber(x: number): string {
  const abs = Math.abs(x);
  if (abs >= 1e12) return `${num(x / 1e12, 2)} Bio.`;
  if (abs >= 1e9) return `${num(x / 1e9, 2)} Mrd.`;
  if (abs >= 1e6) return `${num(x / 1e6, 2)} Mio.`;
  return num(x, 0);
}

export function scoreStock(f: StockFundamentals, now = Date.now()): { items: SubScore[]; warnings: string[] } {
  const items: SubScore[] = [];
  const warnings: string[] = [];
  if (f.pe != null) {
    const s = f.pe <= 0 ? 25 : f.pe < 12 ? 80 : f.pe < 20 ? 70 : f.pe < 30 ? 55 : f.pe < 50 ? 40 : 25;
    items.push({ name: "KGV", value: f.pe <= 0 ? "negativ" : num(f.pe), score: s, comment: f.pe <= 0 ? "macht Verlust" : s >= 70 ? "günstig" : s >= 55 ? "fair" : "teuer" });
  }
  if (f.ps != null) {
    const s = f.ps < 1 ? 80 : f.ps < 3 ? 65 : f.ps < 6 ? 50 : f.ps < 10 ? 35 : 25;
    items.push({ name: "KUV", value: num(f.ps, 2), score: s, comment: s >= 65 ? "moderat" : s >= 50 ? "hoch" : "sehr hoch" });
  }
  if (f.pb != null) {
    const s = f.pb <= 0 ? 30 : f.pb < 1 ? 75 : f.pb < 3 ? 65 : f.pb < 6 ? 50 : 35;
    items.push({ name: "KBV", value: num(f.pb, 2), score: s, comment: s >= 65 ? "solide" : "über Firmenwert" });
  }
  if (f.epsGrowth != null) {
    const s = lerp(f.epsGrowth, -0.2, 0.3, 20, 90);
    items.push({ name: "EPS-Wachstum", value: pct(f.epsGrowth), score: s, comment: f.epsGrowth > 0.1 ? "stark" : f.epsGrowth > 0 ? "leicht" : "sinkt" });
  }
  if (f.revenueGrowth != null) {
    const s = lerp(f.revenueGrowth, -0.1, 0.25, 25, 90);
    items.push({ name: "Umsatzwachstum", value: pct(f.revenueGrowth), score: s, comment: f.revenueGrowth > 0.08 ? "stark" : f.revenueGrowth > 0 ? "leicht positiv" : "sinkt" });
  }
  if (f.profitMargin != null) {
    const s = f.profitMargin < 0 ? 25 : lerp(f.profitMargin, 0, 0.25, 45, 85);
    items.push({ name: "Nettomarge", value: pct(f.profitMargin), score: s, comment: f.profitMargin > 0.15 ? "sehr profitabel" : f.profitMargin > 0 ? "profitabel" : "macht Verlust" });
  }
  if (f.debtToEquity != null) {
    const s = f.debtToEquity < 50 ? 80 : f.debtToEquity < 100 ? 65 : f.debtToEquity < 200 ? 45 : 30;
    items.push({ name: "Verschuldung (D/E)", value: `${num(f.debtToEquity / 100, 2)}×`, score: s, comment: s >= 65 ? "wenig Schulden" : "viele Schulden" });
  }
  if (f.freeCashflow != null) {
    const yld = f.marketCap ? f.freeCashflow / f.marketCap : null;
    const s = f.freeCashflow <= 0 ? 30 : yld != null ? lerp(yld, 0, 0.06, 55, 88) : 65;
    items.push({
      name: "Free Cashflow",
      value: `${compactNumber(f.freeCashflow)}${yld != null ? ` (Rendite ${pct(yld)})` : ""}`,
      score: s,
      comment: f.freeCashflow > 0 ? "verdient Geld" : "verliert Geld",
    });
  }
  if (f.dividendYield != null && f.dividendYield > 0) {
    const s = f.dividendYield > 0.08 ? 50 : lerp(f.dividendYield, 0, 0.04, 55, 70);
    items.push({ name: "Dividendenrendite", value: pct(f.dividendYield), score: s, comment: f.dividendYield > 0.08 ? "ungewöhnlich hoch" : "zahlt Dividende" });
  }
  if (f.nextEarnings) {
    const days = (new Date(f.nextEarnings).getTime() - now) / 86400000;
    if (days >= 0 && days <= 7) warnings.push(`Quartalszahlen in ${Math.ceil(days)} Tag(en) – der Kurs kann dann stark springen.`);
  }
  return { items, warnings };
}

export function scoreCrypto(f: CryptoFundamentals): { items: SubScore[]; warnings: string[] } {
  const items: SubScore[] = [];
  const warnings: string[] = [];
  if (f.marketCapRank != null || f.marketCap != null) {
    const r = f.marketCapRank ?? 999;
    const s = r <= 10 ? 75 : r <= 50 ? 65 : r <= 200 ? 50 : 35;
    items.push({ name: "Marktkapitalisierung", value: `${f.marketCap ? compactNumber(f.marketCap) : "–"}${f.marketCapRank ? ` (Rang ${f.marketCapRank})` : ""}`, score: s, comment: s >= 65 ? "groß und etabliert" : "kleiner Wert – höheres Risiko" });
  }
  if (f.volume24h != null && f.marketCap) {
    const r = f.volume24h / f.marketCap;
    const s = r < 0.01 ? 40 : r <= 0.3 ? 65 : r <= 0.6 ? 50 : 40;
    items.push({ name: "Volumen / Market Cap", value: pct(r), score: s, comment: r < 0.01 ? "wenig gehandelt" : r <= 0.3 ? "gut gehandelt" : "sehr spekulativ" });
  }
  if (f.circulatingSupply != null) {
    if (f.maxSupply) {
      const r = f.circulatingSupply / f.maxSupply;
      const s = r > 0.8 ? 75 : r > 0.5 ? 60 : 40;
      items.push({ name: "Angebot im Umlauf", value: pct(r), score: s, comment: r > 0.8 ? "kaum neue Coins" : "viele neue Coins kommen noch" });
    } else {
      items.push({ name: "Angebot im Umlauf", value: compactNumber(f.circulatingSupply), score: 50, comment: "unbegrenzte Menge" });
    }
  }
  if (f.devCommits4w != null) {
    const s = f.devCommits4w > 50 ? 75 : f.devCommits4w > 10 ? 60 : f.devCommits4w > 0 ? 50 : 40;
    items.push({ name: "Entwicklung (Commits 4 W.)", value: num(f.devCommits4w, 0), score: s, comment: s >= 60 ? "aktiv entwickelt" : "wenig Aktivität" });
  }
  if (f.athChangePct != null && f.athChangePct < -85) warnings.push("Mehr als 85 % unter dem Höchststand.");
  return { items, warnings };
}

/** Gewichtetes Nachrichten-Sentiment (jüngere Meldungen zählen stärker). */
export function newsSentimentScore(news: NewsItem[], now = Date.now(), halfLifeHours = 36): number | null {
  const recent = news.filter((n) => now - new Date(n.published).getTime() <= 72 * 3600 * 1000);
  if (recent.length === 0) return null;
  let w = 0;
  let s = 0;
  for (const n of recent) {
    const ageH = Math.max(0, (now - new Date(n.published).getTime()) / 3600000);
    const weight = Math.exp(-ageH / halfLifeHours);
    w += weight;
    s += weight * n.sentimentScore;
  }
  return Math.round(50 + 45 * (s / (w || 1)));
}

export function analyzeFundamentals(f: Fundamentals | null, news: NewsItem[], now = Date.now(), o: { fundamentalWeights?: Record<string, number>; newsShare?: number; newsHalfLifeHours?: number } = {}): FundamentalResult {
  const { items, warnings } = f ? (f.kind === "stock" ? scoreStock(f, now) : scoreCrypto(f)) : { items: [], warnings: [] };
  // Gewichte einzelner Kennzahlen innerhalb der 20 % (Standard: alle gleich)
  const w = (name: string) => o.fundamentalWeights?.[name] ?? 1;
  const wSum = items.reduce((a, b) => a + w(b.name), 0);
  const fundamentalScore = items.length && wSum > 0 ? Math.round(items.reduce((a, b) => a + b.score * w(b.name), 0) / wSum) : null;
  const newsScore = newsSentimentScore(news, now, o.newsHalfLifeHours ?? 36);
  const parts: [number, number][] = [];
  const newsShare = o.newsShare ?? 0.4;
  if (fundamentalScore != null) parts.push([fundamentalScore, 1 - newsShare]);
  if (newsScore != null) parts.push([newsScore, newsShare]);
  const score = parts.length ? Math.round(parts.reduce((a, [v, w]) => a + v * w, 0) / parts.reduce((a, [, w]) => a + w, 0)) : 50;
  const newsCount = news.filter((n) => now - new Date(n.published).getTime() <= 72 * 3600 * 1000).length;
  return { score, fundamentalScore, newsScore, items, newsCount, warnings };
}
