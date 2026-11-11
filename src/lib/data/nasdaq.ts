// Nasdaq (ohne Key): Kennzahlen-Zusammenfassung für US-Aktien als zweite kostenlose Quelle.
import "server-only";
import type { StockFundamentals } from "../types";
import { cached, fetchJson, UpstreamError } from "./http";

const num = (v?: string) => {
  if (!v) return undefined;
  const x = parseFloat(v.replace(/[$,%\s]/g, ""));
  return Number.isFinite(x) ? x : undefined;
};

interface Summary {
  data?: { summaryData?: Record<string, { label?: string; value?: string }> } | null;
  status?: { rCode?: number; bCodeMessage?: { errorMessage?: string }[] };
}

export async function nasdaqFundamentals(symbol: string): Promise<StockFundamentals> {
  return cached(`nq:${symbol}`, 6 * 3600e3, async () => {
    const r = await fetchJson<Summary>(`https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/summary?assetclass=stocks`, {
      headers: { Accept: "application/json, text/plain, */*", Origin: "https://www.nasdaq.com", Referer: "https://www.nasdaq.com/", "Accept-Language": "en-US,en;q=0.9" },
    });
    const d = r.data?.summaryData;
    if (!d) throw new UpstreamError(`Nasdaq: ${r.status?.bCodeMessage?.[0]?.errorMessage ?? "keine Daten"}`, 404);
    const pick = (...keys: string[]) => keys.map((k) => d[k]?.value).find((v) => v && v !== "N/A");
    const yieldPct = num(pick("Yield", "CurrentYield"));
    const cap = num(pick("MarketCap"));
    return {
      kind: "stock",
      pe: num(pick("PERatio")),
      dividendYield: yieldPct != null ? yieldPct / 100 : undefined,
      marketCap: cap,
      source: "Nasdaq",
    };
  });
}
