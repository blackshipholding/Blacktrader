// Yahoo Finance (inoffiziell, ohne Key). Kurse sind je nach Börse teils verzögert.
import "server-only";
import type { Candle, Interval, Quote, StockFundamentals } from "../types";
import { aggregateCandles } from "./aggregate";
import { cached, fetchJson, fetchRaw, UA, UpstreamError } from "./http";

const BASES = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];

const INTERVAL_MAP: Record<Interval, { interval: string; range: string; aggregate?: number }> = {
  "5m": { interval: "5m", range: "1mo" },
  "15m": { interval: "15m", range: "1mo" },
  "1h": { interval: "60m", range: "1y" },
  "4h": { interval: "60m", range: "2y", aggregate: 4 * 3600 },
  "1d": { interval: "1d", range: "5y" },
  // Wochenkerzen: so viel Historie, wie die Analyse nutzt (600 Kerzen ≈ 11,5 Jahre, wie im Turnier getestet) – 14 Jahre laden
  "1w": { interval: "1wk", range: "days:5110" },
  "1M": { interval: "1mo", range: "max" },
};

interface ChartResponse {
  chart: {
    result?: {
      meta: {
        symbol: string;
        currency?: string;
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        regularMarketTime?: number;
        longName?: string;
        shortName?: string;
        exchangeName?: string;
        fullExchangeName?: string;
        instrumentType?: string;
      };
      timestamp?: number[];
      indicators: { quote: { open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[]; volume: (number | null)[] }[] };
    }[];
    error?: { description?: string } | null;
  };
}

async function chart(symbol: string, interval: string, range: string): Promise<ChartResponse> {
  let lastErr: unknown;
  for (const base of BASES) {
    try {
      // „days:N“ = genauer Zeitraum (bei range=max liefert Yahoo statt Wochen- nur Quartalskerzen)
      const now = Math.floor(Date.now() / 1000);
      const span = range.startsWith("days:") ? `period1=${now - Number(range.slice(5)) * 86400}&period2=${now}` : `range=${range}`;
      const url = `${base}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&${span}&includePrePost=false&events=div%2Csplit`;
      const data = await fetchJson<ChartResponse>(url);
      if (data.chart.error) throw new UpstreamError(`Yahoo: ${data.chart.error.description ?? "Fehler"}`, 404);
      return data;
    } catch (e) {
      lastErr = e;
      if (e instanceof UpstreamError && e.status === 404) throw e;
    }
  }
  throw lastErr;
}

/** Handelswährung je Yahoo-Symbol (aus den Kursdaten gemerkt) */
export const yahooCurrency = new Map<string, string>();

export async function yahooCandles(symbol: string, iv: Interval): Promise<Candle[]> {
  const m = INTERVAL_MAP[iv];
  const ttl = iv === "5m" ? 30e3 : iv === "15m" ? 60e3 : iv === "1h" || iv === "4h" ? 120e3 : iv === "1d" ? 300e3 : 3600e3;
  return cached(`yc:${symbol}:${iv}`, ttl, async () => {
    const data = await chart(symbol, m.interval, m.range);
    const r = data.chart.result?.[0];
    if (!r?.timestamp) throw new UpstreamError("Yahoo: keine Kursdaten", 404);
    if (r.meta?.currency) yahooCurrency.set(symbol, r.meta.currency);
    const q = r.indicators.quote[0];
    const out: Candle[] = [];
    r.timestamp.forEach((t, i) => {
      const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
      if (o == null || h == null || l == null || c == null) return;
      out.push({ time: t, open: o, high: h, low: l, close: c, volume: q.volume[i] ?? 0 });
    });
    const res = m.aggregate ? aggregateCandles(out, m.aggregate) : out;
    // Wochenkerzen: höchstens die letzten 700 zurückgeben (Analyse nutzt 600)
    return iv === "1w" ? res.slice(-700) : res;
  });
}

/** Maximale Historie, die Yahoo je Kerzengröße liefert (Tage). */
export const YAHOO_MAX_DAYS: Record<Interval, number> = { "5m": 59, "15m": 59, "1h": 729, "4h": 729, "1d": 36500, "1w": 36500, "1M": 36500 };

/** Kerzen für einen Zeitraum der letzten `days` Tage (begrenzt auf YAHOO_MAX_DAYS). */
export async function yahooHistory(symbol: string, iv: Interval, days: number): Promise<{ candles: Candle[]; days: number; dividends: { time: number; amount: number }[] }> {
  const m = INTERVAL_MAP[iv];
  const d = Math.min(days, YAHOO_MAX_DAYS[iv]);
  const now = Math.floor(Date.now() / 1000);
  return cached(`yh:${symbol}:${iv}:${d}`, 10 * 60e3, async () => {
    let data: ChartResponse | null = null;
    let lastErr: unknown;
    for (const base of BASES) {
      try {
        data = await fetchJson<ChartResponse>(
          `${base}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${m.interval}&period1=${now - d * 86400}&period2=${now}&includePrePost=false&events=div`,
          { timeoutMs: 15000 },
        );
        if (data.chart.error) throw new UpstreamError(`Yahoo: ${data.chart.error.description ?? "Fehler"}`, 404);
        break;
      } catch (e) {
        lastErr = e;
        data = null;
      }
    }
    if (!data) throw lastErr;
    const r = data.chart.result?.[0];
    if (!r?.timestamp) throw new UpstreamError("Yahoo: keine Kursdaten", 404);
    const q = r.indicators.quote[0];
    const out: Candle[] = [];
    r.timestamp.forEach((t, i) => {
      const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
      if (o == null || h == null || l == null || c == null) return;
      out.push({ time: t, open: o, high: h, low: l, close: c, volume: q.volume[i] ?? 0 });
    });
    // Dividenden (für Strategien wie „Dogs of the Dow“), je Ausschüttung Datum und Betrag je Aktie
    const ev = (r as unknown as { events?: { dividends?: Record<string, { date: number; amount: number }> } }).events?.dividends ?? {};
    const dividends = Object.values(ev).filter((x) => x && x.date && x.amount > 0).map((x) => ({ time: x.date, amount: x.amount })).sort((a, b) => a.time - b.time);
    return { candles: m.aggregate ? aggregateCandles(out, m.aggregate) : out, days: d, dividends };
  });
}

export interface YahooMeta {
  symbol: string;
  name: string;
  currency?: string;
  exchange?: string;
  instrumentType?: string;
}

export async function yahooQuote(symbol: string): Promise<Quote & { meta: YahooMeta }> {
  return cached(`yq:${symbol}`, 10e3, async () => {
    const data = await chart(symbol, "5m", "1d");
    const r = data.chart.result?.[0];
    if (!r || r.meta.regularMarketPrice == null) throw new UpstreamError("Yahoo: kein Kurs", 404);
    const m = r.meta;
    const prev = m.previousClose ?? m.chartPreviousClose ?? m.regularMarketPrice!;
    const time = m.regularMarketTime ?? Math.floor(Date.now() / 1000);
    return {
      symbol,
      price: m.regularMarketPrice!,
      changePct: prev ? ((m.regularMarketPrice! - prev) / prev) * 100 : 0,
      currency: m.currency,
      time,
      // Yahoo liefert für viele Börsen 15+ Minuten verzögerte Kurse; Krypto ist nahezu Echtzeit.
      delayed: m.instrumentType !== "CRYPTOCURRENCY" || Date.now() / 1000 - time > 120,
      source: "Yahoo Finance",
      meta: {
        symbol: m.symbol,
        name: m.longName ?? m.shortName ?? m.symbol,
        currency: m.currency,
        exchange: m.fullExchangeName ?? m.exchangeName,
        instrumentType: m.instrumentType,
      },
    };
  });
}

export interface YahooSearchQuote {
  symbol: string;
  shortname?: string;
  longname?: string;
  exchange?: string;
  exchDisp?: string;
  quoteType?: string;
}

export async function yahooSearch(q: string): Promise<YahooSearchQuote[]> {
  return cached(`ys:${q.toUpperCase()}`, 3600e3, async () => {
    const data = await fetchJson<{ quotes?: YahooSearchQuote[] }>(
      `${BASES[1]}/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&listsCount=0&enableFuzzyQuery=false`,
    );
    return (data.quotes ?? []).filter((x) => x.symbol && ["EQUITY", "ETF", "CRYPTOCURRENCY", "INDEX", "MUTUALFUND", "FUTURE", "CURRENCY"].includes(x.quoteType ?? ""));
  });
}

// --- Fundamentaldaten über quoteSummary (benötigt Cookie + Crumb)
let crumbCache: { cookie: string; crumb: string; expires: number } | null = null;

function cookiesFrom(r: Response): string {
  const list = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : [r.headers.get("set-cookie") ?? ""];
  return list.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
}

/**
 * Cookie + Crumb für quoteSummary. In der EU leitet Yahoo teils auf eine Zustimmungsseite um –
 * daher mehrere Wege: fc.yahoo.com, dann finance.yahoo.com; Crumb von query2, dann query1.
 */
async function getCrumb(): Promise<{ cookie: string; crumb: string }> {
  if (crumbCache && crumbCache.expires > Date.now()) return crumbCache;
  const errors: string[] = [];
  for (const cookieUrl of ["https://fc.yahoo.com", "https://finance.yahoo.com/quote/AAPL/", "https://finance.yahoo.com/"]) {
    let cookie = "";
    try {
      cookie = cookiesFrom(await fetchRaw(cookieUrl, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" } }));
    } catch (e) {
      errors.push((e as Error).message);
      continue;
    }
    if (!cookie) {
      errors.push(`kein Cookie von ${new URL(cookieUrl).host}`);
      continue;
    }
    for (const base of [BASES[1], BASES[0]]) {
      try {
        const r2 = await fetchRaw(`${base}/v1/test/getcrumb`, { headers: { Cookie: cookie } });
        const crumb = (await r2.text()).trim();
        if (r2.ok && crumb && !crumb.includes("<") && crumb.length < 40) {
          crumbCache = { cookie, crumb, expires: Date.now() + 30 * 60e3 };
          return crumbCache;
        }
        errors.push(`Crumb HTTP ${r2.status}`);
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
  }
  throw new UpstreamError(`Yahoo-Fundamentaldaten gesperrt (${[...new Set(errors)].slice(0, 3).join(", ")})`);
}

type Raw = { raw?: number } | undefined;
const v = (x: Raw) => (x && typeof x.raw === "number" && Number.isFinite(x.raw) ? x.raw : undefined);

export async function yahooFundamentals(symbol: string): Promise<StockFundamentals> {
  return cached(`yf:${symbol}`, 6 * 3600e3, async () => {
    const { cookie, crumb } = await getCrumb();
    const modules = "summaryDetail,defaultKeyStatistics,financialData,calendarEvents,price";
    const data = await fetchJson<{
      quoteSummary: { result?: Record<string, Record<string, unknown>>[]; error?: unknown };
    }>(`${BASES[1]}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}&crumb=${encodeURIComponent(crumb)}`, {
      headers: { Cookie: cookie },
    });
    const r = data.quoteSummary.result?.[0];
    if (!r) throw new UpstreamError("Yahoo: keine Fundamentaldaten", 404);
    const sd = (r.summaryDetail ?? {}) as Record<string, Raw>;
    const ks = (r.defaultKeyStatistics ?? {}) as Record<string, Raw>;
    const fd = (r.financialData ?? {}) as Record<string, Raw>;
    const ce = (r.calendarEvents ?? {}) as { earnings?: { earningsDate?: { raw?: number }[] } };
    const pr = (r.price ?? {}) as Record<string, Raw> & { currency?: string };
    const earn = ce.earnings?.earningsDate?.[0]?.raw;
    return {
      kind: "stock",
      pe: v(sd.trailingPE) ?? v(sd.forwardPE),
      ps: v(sd.priceToSalesTrailing12Months),
      pb: v(ks.priceToBook),
      epsGrowth: v(fd.earningsGrowth) ?? v(ks.earningsQuarterlyGrowth),
      revenueGrowth: v(fd.revenueGrowth),
      profitMargin: v(fd.profitMargins) ?? v(ks.profitMargins),
      debtToEquity: v(fd.debtToEquity),
      freeCashflow: v(fd.freeCashflow),
      marketCap: v(sd.marketCap) ?? v(pr.marketCap),
      dividendYield: v(sd.dividendYield) ?? v(sd.trailingAnnualDividendYield),
      nextEarnings: earn ? new Date(earn * 1000).toISOString() : undefined,
      currency: pr.currency,
      source: "Yahoo Finance",
    };
  });
}

export interface AnalystAction {
  /** Unix-Sekunden */
  time: number;
  firm: string;
  toGrade: string;
  fromGrade: string;
  /** up, down, main (bestätigt), init (Erstbewertung), reit */
  action: string;
}

/** Hoch-/Herabstufungen von Bank-Analysten (Yahoo, meist ab etwa 2012, vor allem US-Aktien) */
export async function yahooAnalysts(symbol: string): Promise<AnalystAction[]> {
  return cached(`ya:${symbol}`, 12 * 3600e3, async () => {
    const { cookie, crumb } = await getCrumb();
    const data = await fetchJson<{ quoteSummary: { result?: { upgradeDowngradeHistory?: { history?: { epochGradeDate?: number; firm?: string; toGrade?: string; fromGrade?: string; action?: string }[] } }[] } }>(
      `${BASES[1]}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=upgradeDowngradeHistory&crumb=${encodeURIComponent(crumb)}`,
      { headers: { Cookie: cookie } },
    );
    const h = data.quoteSummary.result?.[0]?.upgradeDowngradeHistory?.history ?? [];
    return h
      .filter((x) => x.epochGradeDate && x.firm && x.toGrade)
      .map((x) => ({ time: x.epochGradeDate!, firm: x.firm!, toGrade: x.toGrade!, fromGrade: x.fromGrade ?? "", action: x.action ?? "" }))
      .sort((a, b) => a.time - b.time);
  });
}
