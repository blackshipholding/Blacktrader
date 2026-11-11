import type { AssetKind, ResolvedAsset } from "../types";

const crypto = (symbol: string, name: string, coingeckoId: string): ResolvedAsset => ({
  kind: "crypto",
  symbol,
  name,
  binanceSymbol: `${symbol}USDT`,
  yahooSymbol: `${symbol}-USD`,
  coingeckoId,
  exchange: "Binance",
  currency: "USDT",
});
const stock = (symbol: string, name: string, currency: string): ResolvedAsset => ({ kind: "stock", symbol, name, yahooSymbol: symbol, currency });
/** Rohstoffe über die fortlaufenden Terminkontrakte bei Yahoo Finance (Preise in US-Dollar). */
const commodity = (symbol: string, name: string): ResolvedAsset => ({ kind: "commodity", symbol, name, yahooSymbol: symbol, currency: "USD", exchange: "Terminmarkt" });

/** Feste Werte für den Chancen-Scanner, in drei Gruppen. */
export const SCAN_GROUPS: { kind: AssetKind; title: string; assets: ResolvedAsset[] }[] = [
  {
    kind: "stock",
    title: "Aktien",
    assets: [
      stock("AAPL", "Apple", "USD"),
      stock("MSFT", "Microsoft", "USD"),
      stock("NVDA", "Nvidia", "USD"),
      stock("AMZN", "Amazon", "USD"),
      stock("GOOGL", "Alphabet (Google)", "USD"),
      stock("META", "Meta", "USD"),
      stock("TSLA", "Tesla", "USD"),
      stock("JPM", "JPMorgan Chase", "USD"),
      stock("SAP.DE", "SAP", "EUR"),
      stock("SIE.DE", "Siemens", "EUR"),
      stock("ALV.DE", "Allianz", "EUR"),
      stock("DTE.DE", "Deutsche Telekom", "EUR"),
      stock("RHM.DE", "Rheinmetall", "EUR"),
      stock("MBG.DE", "Mercedes-Benz", "EUR"),
      stock("BAS.DE", "BASF", "EUR"),
    ],
  },
  {
    kind: "crypto",
    title: "Krypto",
    assets: [
      crypto("BTC", "Bitcoin", "bitcoin"),
      crypto("ETH", "Ethereum", "ethereum"),
      crypto("SOL", "Solana", "solana"),
      crypto("XRP", "XRP", "ripple"),
      crypto("BNB", "BNB", "binancecoin"),
      crypto("DOGE", "Dogecoin", "dogecoin"),
      crypto("ADA", "Cardano", "cardano"),
      crypto("TRX", "Tron", "tron"),
    ],
  },
  {
    kind: "commodity",
    title: "Rohstoffe",
    assets: [
      commodity("GC=F", "Gold"),
      commodity("SI=F", "Silber"),
      commodity("CL=F", "Öl (WTI)"),
      commodity("BZ=F", "Öl (Brent)"),
      commodity("NG=F", "Erdgas"),
      commodity("HG=F", "Kupfer"),
      commodity("PL=F", "Platin"),
    ],
  },
];

export const SCAN_PRESETS: ResolvedAsset[] = SCAN_GROUPS.flatMap((g) => g.assets);

/**
 * Alle Werte, mit denen Blacktrader trainiert (wie im Trainer): 40 Aktien, 15 Krypto, 10 Rohstoffe.
 * Daraus zeigt „Chancen“ die mit dem größten Potenzial. Werte nur aus der Watchlist kommen NICHT in die Chancen.
 */
export const UNIVERSE_GROUPS: { kind: AssetKind; title: string; assets: ResolvedAsset[] }[] = [
  {
    kind: "stock",
    title: "Aktien",
    assets: [
      stock("AAPL", "Apple", "USD"),
      stock("MSFT", "Microsoft", "USD"),
      stock("NVDA", "Nvidia", "USD"),
      stock("AMZN", "Amazon", "USD"),
      stock("GOOGL", "Alphabet (Google)", "USD"),
      stock("META", "Meta", "USD"),
      stock("TSLA", "Tesla", "USD"),
      stock("JPM", "JPMorgan Chase", "USD"),
      stock("V", "Visa", "USD"),
      stock("MA", "Mastercard", "USD"),
      stock("UNH", "UnitedHealth", "USD"),
      stock("HD", "Home Depot", "USD"),
      stock("PG", "Procter & Gamble", "USD"),
      stock("KO", "Coca-Cola", "USD"),
      stock("PEP", "PepsiCo", "USD"),
      stock("XOM", "ExxonMobil", "USD"),
      stock("CVX", "Chevron", "USD"),
      stock("JNJ", "Johnson & Johnson", "USD"),
      stock("MRK", "Merck & Co.", "USD"),
      stock("ABBV", "AbbVie", "USD"),
      stock("WMT", "Walmart", "USD"),
      stock("COST", "Costco", "USD"),
      stock("DIS", "Disney", "USD"),
      stock("NFLX", "Netflix", "USD"),
      stock("ADBE", "Adobe", "USD"),
      stock("CRM", "Salesforce", "USD"),
      stock("ORCL", "Oracle", "USD"),
      stock("INTC", "Intel", "USD"),
      stock("AMD", "AMD", "USD"),
      stock("CSCO", "Cisco", "USD"),
      stock("SAP.DE", "SAP", "EUR"),
      stock("SIE.DE", "Siemens", "EUR"),
      stock("ALV.DE", "Allianz", "EUR"),
      stock("DTE.DE", "Deutsche Telekom", "EUR"),
      stock("RHM.DE", "Rheinmetall", "EUR"),
      stock("MBG.DE", "Mercedes-Benz", "EUR"),
      stock("BAS.DE", "BASF", "EUR"),
      stock("BAYN.DE", "Bayer", "EUR"),
      stock("BMW.DE", "BMW", "EUR"),
      stock("VOW3.DE", "Volkswagen", "EUR"),
    ],
  },
  {
    kind: "crypto",
    title: "Krypto",
    assets: [
      crypto("BTC", "Bitcoin", "bitcoin"),
      crypto("ETH", "Ethereum", "ethereum"),
      crypto("SOL", "Solana", "solana"),
      crypto("XRP", "XRP", "ripple"),
      crypto("BNB", "BNB", "binancecoin"),
      crypto("DOGE", "Dogecoin", "dogecoin"),
      crypto("ADA", "Cardano", "cardano"),
      crypto("TRX", "Tron", "tron"),
      crypto("LTC", "Litecoin", "litecoin"),
      crypto("LINK", "Chainlink", "chainlink"),
      crypto("AVAX", "Avalanche", "avalanche-2"),
      crypto("DOT", "Polkadot", "polkadot"),
      crypto("BCH", "Bitcoin Cash", "bitcoin-cash"),
      crypto("XLM", "Stellar", "stellar"),
      crypto("ATOM", "Cosmos", "cosmos"),
    ],
  },
  {
    kind: "commodity",
    title: "Rohstoffe",
    assets: [
      commodity("GC=F", "Gold"),
      commodity("SI=F", "Silber"),
      commodity("CL=F", "Öl (WTI)"),
      commodity("BZ=F", "Öl (Brent)"),
      commodity("NG=F", "Erdgas"),
      commodity("HG=F", "Kupfer"),
      commodity("PL=F", "Platin"),
      commodity("PA=F", "Palladium"),
      commodity("ZC=F", "Mais"),
      commodity("ZW=F", "Weizen"),
    ],
  },
];

export const UNIVERSE_ASSETS: ResolvedAsset[] = UNIVERSE_GROUPS.flatMap((g) => g.assets);
const UNIVERSE_KEYS = new Set(UNIVERSE_ASSETS.map((a) => `${a.kind}:${a.symbol}`));
/** Gehört der Wert zu den Trainings-Werten (und damit in die Chancen)? */
export const inUniverse = (a: { kind: string; symbol: string }) => UNIVERSE_KEYS.has(`${a.kind}:${a.symbol}`);
