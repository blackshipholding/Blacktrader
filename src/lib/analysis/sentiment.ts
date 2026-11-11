// Einfache lexikonbasierte Sentiment-Bewertung für Schlagzeilen (Deutsch + Englisch).
import type { Sentiment } from "../types";

const POSITIVE = [
  "beat", "beats", "surge", "surges", "soar", "soars", "rally", "rallies", "jump", "jumps", "gain", "gains",
  "record", "upgrade", "upgraded", "outperform", "bullish", "strong", "growth", "profit", "profits", "raises",
  "raised", "buyback", "approval", "approved", "partnership", "breakthrough", "rebound", "rise", "rises", "higher",
  "top", "wins", "win", "boost", "boosts", "expands", "launch", "etf inflows", "inflows", "all-time high",
  "steigt", "steigen", "gewinn", "gewinne", "rekord", "hochstufung", "kaufempfehlung", "stark", "starke",
  "wachstum", "übertrifft", "erholung", "plus", "zulegen", "legt zu", "aufwärts", "durchbruch", "rallye",
  "dividendenerhöhung", "anhebung", "kursziel erhöht", "zuwachs", "optimistisch",
];

const NEGATIVE = [
  "miss", "misses", "plunge", "plunges", "crash", "crashes", "fall", "falls", "drop", "drops", "slump",
  "downgrade", "downgraded", "underperform", "bearish", "weak", "loss", "losses", "cut", "cuts", "lawsuit",
  "probe", "investigation", "fraud", "hack", "hacked", "exploit", "ban", "bans", "recall", "warning", "warns",
  "layoffs", "bankruptcy", "default", "sell-off", "selloff", "lower", "fine", "fined", "sec charges", "outflows",
  "fällt", "fallen", "verlust", "verluste", "einbruch", "abstufung", "verkaufsempfehlung", "schwach", "schwache",
  "warnung", "klage", "ermittlungen", "betrug", "minus", "absturz", "rückgang", "kursziel gesenkt", "senkt",
  "insolvenz", "stellenabbau", "abwärts", "pessimistisch", "gewinnwarnung",
];

const NEGATORS = ["not", "no", "nicht", "kein", "keine"];

export function scoreHeadline(text: string): { sentiment: Sentiment; score: number } {
  const t = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ")} `;
  let s = 0;
  const hit = (w: string) => {
    const idx = t.indexOf(` ${w} `);
    if (idx < 0) return 0;
    const before = t.slice(Math.max(0, idx - 12), idx);
    return NEGATORS.some((n) => before.includes(` ${n} `) || before.endsWith(` ${n}`)) ? -1 : 1;
  };
  for (const w of POSITIVE) s += hit(w);
  for (const w of NEGATIVE) s -= hit(w);
  const score = Math.max(-1, Math.min(1, s / 2));
  return { sentiment: score > 0.15 ? "positive" : score < -0.15 ? "negative" : "neutral", score };
}
