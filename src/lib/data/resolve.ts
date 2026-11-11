// Auflösung einer Eingabe (ISIN, Ticker, Krypto-Symbol) zu handelbaren Datenquellen.
import "server-only";
import { looksLikeIsin, validateIsin } from "../analysis/isin";
import type { ResolvedAsset } from "../types";
import { binanceHasSymbol } from "./binance";
import { coingeckoSearch } from "./coingecko";
import { cached, UpstreamError } from "./http";
import { openFigiByIsin, pickYahooSymbol } from "./openfigi";
import { yahooQuote, yahooSearch, type YahooSearchQuote } from "./yahoo";

const fromYahoo = (q: YahooSearchQuote, isin?: string): ResolvedAsset => {
  if (q.quoteType === "CRYPTOCURRENCY") {
    const base = q.symbol.split("-")[0];
    return { kind: "crypto", symbol: base, name: q.longname ?? q.shortname ?? base, yahooSymbol: q.symbol, binanceSymbol: `${base}USDT`, exchange: "Krypto" };
  }
  if (q.quoteType === "FUTURE") return { kind: "commodity", symbol: q.symbol, name: q.longname ?? q.shortname ?? q.symbol, exchange: q.exchDisp ?? q.exchange, yahooSymbol: q.symbol };
  return { kind: "stock", symbol: q.symbol, name: q.longname ?? q.shortname ?? q.symbol, isin, exchange: q.exchDisp ?? q.exchange, yahooSymbol: q.symbol };
};

async function resolveIsin(isin: string, figiKey?: string): Promise<ResolvedAsset[]> {
  const out: ResolvedAsset[] = [];
  const errors: string[] = [];
  try {
    for (const q of await yahooSearch(isin)) if (q.quoteType !== "CRYPTOCURRENCY") out.push(fromYahoo(q, isin));
  } catch (e) {
    errors.push((e as Error).message);
  }
  if (out.length === 0) {
    try {
      const hits = await openFigiByIsin(isin, figiKey);
      const pick = pickYahooSymbol(isin, hits);
      if (pick) {
        let name = pick.hit.name;
        let exchange: string | undefined = pick.hit.exchCode;
        let currency: string | undefined;
        try {
          const q = await yahooQuote(pick.symbol);
          name = q.meta.name || name;
          exchange = q.meta.exchange ?? exchange;
          currency = q.currency;
        } catch {
          /* Yahoo-Prüfung optional */
        }
        out.push({ kind: "stock", symbol: pick.symbol, name, isin, exchange, currency, yahooSymbol: pick.symbol });
      }
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  if (out.length === 0 && errors.length) throw new UpstreamError(`ISIN konnte nicht aufgelöst werden: ${errors.join(" · ")}`);
  return out;
}

async function resolveSymbol(input: string): Promise<ResolvedAsset[]> {
  const sym = input.toUpperCase().replace(/[^A-Z0-9.\-^=]/g, "");
  const results: ResolvedAsset[] = [];
  const [ys, cg] = await Promise.allSettled([yahooSearch(sym), coingeckoSearch(sym)]);

  // Krypto: exakter Symbol-Treffer bei CoinGecko (nach Marktkapitalisierungsrang)
  if (cg.status === "fulfilled") {
    const exact = cg.value.filter((c) => c.symbol.toUpperCase() === sym).sort((a, b) => (a.market_cap_rank ?? 1e9) - (b.market_cap_rank ?? 1e9));
    const top = exact[0];
    if (top) {
      const pair = `${sym}USDT`;
      const onBinance = await binanceHasSymbol(pair);
      results.push({
        kind: "crypto",
        symbol: sym,
        name: top.name,
        coingeckoId: top.id,
        binanceSymbol: onBinance === false ? undefined : pair,
        yahooSymbol: `${sym}-USD`,
        exchange: onBinance === false ? "Krypto (Yahoo)" : "Binance",
      });
    }
  }
  if (ys.status === "fulfilled") {
    for (const q of ys.value) {
      const r = fromYahoo(q);
      if (results.some((x) => x.kind === r.kind && x.symbol === r.symbol)) continue;
      results.push(r);
    }
  }
  // Kein Treffer, aber Binance kennt das Paar
  if (results.length === 0 && (await binanceHasSymbol(`${sym}USDT`))) {
    results.push({ kind: "crypto", symbol: sym, name: sym, binanceSymbol: `${sym}USDT`, yahooSymbol: `${sym}-USD`, exchange: "Binance" });
  }
  // Exakter Aktien-Ticker zuerst, wenn er existiert und nicht nur ein Krypto-Kürzel ist
  const exactStock = results.findIndex((r) => r.kind === "stock" && r.symbol === sym);
  const crypto = results.findIndex((r) => r.kind === "crypto");
  if (exactStock > -1 && crypto === 0 && ys.status === "fulfilled" && ys.value[0]?.symbol === sym) {
    const [s] = results.splice(exactStock, 1);
    results.unshift(s);
  }
  if (results.length === 0 && ys.status === "rejected" && cg.status === "rejected")
    throw new UpstreamError(`Keine Datenquelle erreichbar (${(ys.reason as Error).message})`);
  return results.slice(0, 8);
}

/** Rohstoffe per Name (deutsch/englisch) → fortlaufender Terminkontrakt bei Yahoo. */
const COMMODITIES: { words: string[]; asset: ResolvedAsset }[] = [
  { words: ["GOLD", "GOLDPREIS", "XAU"], asset: { kind: "commodity", symbol: "GC=F", name: "Gold", yahooSymbol: "GC=F", currency: "USD", exchange: "Terminmarkt" } },
  { words: ["SILBER", "SILVER", "XAG"], asset: { kind: "commodity", symbol: "SI=F", name: "Silber", yahooSymbol: "SI=F", currency: "USD", exchange: "Terminmarkt" } },
  { words: ["ÖL", "OEL", "OIL", "ROHÖL", "ROHOEL", "WTI", "CRUDE"], asset: { kind: "commodity", symbol: "CL=F", name: "Öl (WTI)", yahooSymbol: "CL=F", currency: "USD", exchange: "Terminmarkt" } },
  { words: ["BRENT", "BRENTÖL"], asset: { kind: "commodity", symbol: "BZ=F", name: "Öl (Brent)", yahooSymbol: "BZ=F", currency: "USD", exchange: "Terminmarkt" } },
  { words: ["ERDGAS", "GAS", "NATGAS", "NATURAL GAS"], asset: { kind: "commodity", symbol: "NG=F", name: "Erdgas", yahooSymbol: "NG=F", currency: "USD", exchange: "Terminmarkt" } },
  { words: ["KUPFER", "COPPER"], asset: { kind: "commodity", symbol: "HG=F", name: "Kupfer", yahooSymbol: "HG=F", currency: "USD", exchange: "Terminmarkt" } },
  { words: ["PLATIN", "PLATINUM"], asset: { kind: "commodity", symbol: "PL=F", name: "Platin", yahooSymbol: "PL=F", currency: "USD", exchange: "Terminmarkt" } },
];

export function commodityFor(input: string): ResolvedAsset | undefined {
  const s = input.trim().toUpperCase();
  return COMMODITIES.find((c) => c.words.includes(s) || c.asset.symbol === s)?.asset;
}

export async function resolveInput(raw: string, figiKey?: string): Promise<ResolvedAsset[]> {
  const input = raw.trim();
  if (!input) return [];
  const commodity = commodityFor(input);
  if (commodity) {
    // Rohstoff zuerst, gleichnamige Firmen/Coins nur als Alternativen
    const others = await resolveSymbol(input).catch(() => [] as ResolvedAsset[]);
    return [commodity, ...others.filter((o) => o.symbol !== commodity.symbol)].slice(0, 8);
  }
  if (looksLikeIsin(input)) {
    const check = validateIsin(input);
    if (!check.valid) throw new UpstreamError(check.reason, 400);
    return cached(`res:${check.isin}`, 24 * 3600e3, () => resolveIsin(check.isin, figiKey));
  }
  return cached(`res:${input.toUpperCase()}`, 6 * 3600e3, () => resolveSymbol(input));
}
