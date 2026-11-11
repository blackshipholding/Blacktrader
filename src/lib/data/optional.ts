// Optionale Quellen mit eigenem (kostenlosem) API-Key des Nutzers: Finnhub, Alpha Vantage.
import "server-only";
import type { StockFundamentals } from "../types";
import { cached, fetchJson } from "./http";

const n = (x: unknown) => {
  const v = typeof x === "string" ? parseFloat(x) : typeof x === "number" ? x : NaN;
  return Number.isFinite(v) ? v : undefined;
};

export async function finnhubFundamentals(symbol: string, key: string): Promise<StockFundamentals> {
  return cached(`fhf:${symbol}`, 6 * 3600e3, async () => {
    const r = await fetchJson<{ metric?: Record<string, number> }>(
      `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${encodeURIComponent(key)}`,
    );
    const m = r.metric ?? {};
    const pct = (x: unknown) => (n(x) != null ? n(x)! / 100 : undefined);
    let nextEarnings: string | undefined;
    try {
      const from = new Date().toISOString().slice(0, 10);
      const to = new Date(Date.now() + 120 * 86400e3).toISOString().slice(0, 10);
      const e = await fetchJson<{ earningsCalendar?: { date: string }[] }>(
        `https://finnhub.io/api/v1/calendar/earnings?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${encodeURIComponent(key)}`,
      );
      nextEarnings = e.earningsCalendar?.map((x) => x.date).sort()[0];
    } catch {
      /* optional */
    }
    return {
      kind: "stock",
      pe: n(m.peTTM) ?? n(m.peBasicExclExtraTTM),
      ps: n(m.psTTM),
      pb: n(m.pbAnnual) ?? n(m.pbQuarterly),
      epsGrowth: pct(m.epsGrowthTTMYoy),
      revenueGrowth: pct(m.revenueGrowthTTMYoy),
      profitMargin: pct(m.netProfitMarginTTM),
      debtToEquity: n(m["totalDebt/totalEquityAnnual"]) != null ? n(m["totalDebt/totalEquityAnnual"])! * 100 : undefined,
      marketCap: n(m.marketCapitalization) != null ? n(m.marketCapitalization)! * 1e6 : undefined,
      dividendYield: pct(m.currentDividendYieldTTM),
      nextEarnings,
      source: "Finnhub",
    };
  });
}

export async function alphaVantageFundamentals(symbol: string, key: string): Promise<StockFundamentals> {
  return cached(`avf:${symbol}`, 12 * 3600e3, async () => {
    const r = await fetchJson<Record<string, string>>(
      `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`,
    );
    if (!r.Symbol) throw new Error(r.Note ?? r.Information ?? "Alpha Vantage: keine Daten");
    return {
      kind: "stock",
      pe: n(r.PERatio),
      ps: n(r.PriceToSalesRatioTTM),
      pb: n(r.PriceToBookRatio),
      epsGrowth: n(r.QuarterlyEarningsGrowthYOY),
      revenueGrowth: n(r.QuarterlyRevenueGrowthYOY),
      profitMargin: n(r.ProfitMargin),
      marketCap: n(r.MarketCapitalization),
      dividendYield: n(r.DividendYield),
      currency: r.Currency,
      source: "Alpha Vantage",
    };
  });
}

/** Ergänzt fehlende Felder von `a` mit Werten aus `b`. */
export function mergeFundamentals(a: StockFundamentals | null, b: StockFundamentals | null): StockFundamentals | null {
  if (!a) return b;
  if (!b) return a;
  const out = { ...a } as StockFundamentals;
  for (const [k, v] of Object.entries(b)) if ((out as unknown as Record<string, unknown>)[k] == null && v != null) (out as unknown as Record<string, unknown>)[k] = v;
  out.source = `${a.source} + ${b.source}`;
  return out;
}
