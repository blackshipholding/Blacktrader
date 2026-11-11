// Markt für „Chancen“: die wichtigsten Börsen und Werte (rund 190) – daraus sucht Blacktrader die 20 mit den
// größten Chancen. Gelernt wird weiter mit den 65 Trainings-Werten; die gelernten Einstellungen gelten je Anlageklasse.
import type { AssetKind, ResolvedAsset } from "../types";

const us = (symbol: string, name: string): ResolvedAsset => ({ kind: "stock", symbol, name, yahooSymbol: symbol, currency: "USD" });
const de = (symbol: string, name: string): ResolvedAsset => ({ kind: "stock", symbol, name, yahooSymbol: symbol, currency: "EUR" });
const at = (symbol: string, name: string): ResolvedAsset => ({ kind: "stock", symbol, name, yahooSymbol: symbol, currency: "EUR", exchange: "Wien" });
const cr = (symbol: string, name: string, coingeckoId: string, yahooSymbol = `${symbol}-USD`): ResolvedAsset => ({ kind: "crypto", symbol, name, binanceSymbol: `${symbol}USDT`, yahooSymbol, coingeckoId, exchange: "Binance", currency: "USDT" });
const co = (symbol: string, name: string): ResolvedAsset => ({ kind: "commodity", symbol, name, yahooSymbol: symbol, currency: "USD", exchange: "Terminmarkt" });

/** S&P 100 – die 100 größten US-Aktien */
const US: ResolvedAsset[] = [
  us("AAPL", "Apple"), us("ABBV", "AbbVie"), us("ABT", "Abbott"), us("ACN", "Accenture"), us("ADBE", "Adobe"), us("AIG", "AIG"), us("AMD", "AMD"),
  us("AMGN", "Amgen"), us("AMT", "American Tower"), us("AMZN", "Amazon"), us("AVGO", "Broadcom"), us("AXP", "American Express"), us("BA", "Boeing"),
  us("BAC", "Bank of America"), us("BNY", "BNY"), us("BKNG", "Booking"), us("BLK", "BlackRock"), us("BMY", "Bristol-Myers Squibb"),
  us("BRK-B", "Berkshire Hathaway"), us("C", "Citigroup"), us("CAT", "Caterpillar"), us("CL", "Colgate-Palmolive"), us("CMCSA", "Comcast"),
  us("COF", "Capital One"), us("COP", "ConocoPhillips"), us("COST", "Costco"), us("CRM", "Salesforce"), us("CSCO", "Cisco"), us("CVS", "CVS Health"),
  us("CVX", "Chevron"), us("DE", "Deere"), us("DHR", "Danaher"), us("DIS", "Disney"), us("DUK", "Duke Energy"), us("EMR", "Emerson"),
  us("F", "Ford"), us("FDX", "FedEx"), us("GD", "General Dynamics"), us("GE", "GE Aerospace"), us("GILD", "Gilead"), us("GM", "General Motors"),
  us("GOOGL", "Alphabet (Google)"), us("GS", "Goldman Sachs"), us("HD", "Home Depot"), us("HON", "Honeywell"), us("IBM", "IBM"), us("INTC", "Intel"),
  us("INTU", "Intuit"), us("ISRG", "Intuitive Surgical"), us("JNJ", "Johnson & Johnson"), us("JPM", "JPMorgan Chase"), us("KO", "Coca-Cola"),
  us("LIN", "Linde"), us("LLY", "Eli Lilly"), us("LMT", "Lockheed Martin"), us("LOW", "Lowe's"), us("MA", "Mastercard"), us("MCD", "McDonald's"),
  us("MDLZ", "Mondelez"), us("MDT", "Medtronic"), us("MET", "MetLife"), us("META", "Meta"), us("MMM", "3M"), us("MO", "Altria"), us("MRK", "Merck & Co."),
  us("MS", "Morgan Stanley"), us("MSFT", "Microsoft"), us("NEE", "NextEra Energy"), us("NFLX", "Netflix"), us("NKE", "Nike"), us("NOW", "ServiceNow"),
  us("NVDA", "Nvidia"), us("ORCL", "Oracle"), us("PEP", "PepsiCo"), us("PFE", "Pfizer"), us("PG", "Procter & Gamble"), us("PLTR", "Palantir"),
  us("PM", "Philip Morris"), us("PYPL", "PayPal"), us("QCOM", "Qualcomm"), us("RTX", "RTX"), us("SBUX", "Starbucks"), us("SCHW", "Charles Schwab"),
  us("SO", "Southern Company"), us("SPG", "Simon Property"), us("T", "AT&T"), us("TGT", "Target"), us("TMO", "Thermo Fisher"), us("TMUS", "T-Mobile US"),
  us("TSLA", "Tesla"), us("TXN", "Texas Instruments"), us("UBER", "Uber"), us("UNH", "UnitedHealth"), us("UNP", "Union Pacific"), us("UPS", "UPS"),
  us("USB", "U.S. Bancorp"), us("V", "Visa"), us("VZ", "Verizon"), us("WFC", "Wells Fargo"), us("WMT", "Walmart"), us("XOM", "ExxonMobil"),
];

/** DAX (Covestro wurde übernommen und ist nicht mehr gelistet) */
const DE: ResolvedAsset[] = [
  de("ADS.DE", "Adidas"), de("AIR.DE", "Airbus"), de("ALV.DE", "Allianz"), de("BAS.DE", "BASF"), de("BAYN.DE", "Bayer"), de("BEI.DE", "Beiersdorf"),
  de("BMW.DE", "BMW"), de("BNR.DE", "Brenntag"), de("CBK.DE", "Commerzbank"), de("CON.DE", "Continental"),   de("DTG.DE", "Daimler Truck"), de("DBK.DE", "Deutsche Bank"), de("DB1.DE", "Deutsche Börse"), de("DHL.DE", "DHL Group"), de("DTE.DE", "Deutsche Telekom"),
  de("EOAN.DE", "E.ON"), de("FRE.DE", "Fresenius"), de("FME.DE", "Fresenius Medical Care"), de("HNR1.DE", "Hannover Rück"), de("HEI.DE", "Heidelberg Materials"),
  de("HEN3.DE", "Henkel"), de("IFX.DE", "Infineon"), de("MBG.DE", "Mercedes-Benz"), de("MRK.DE", "Merck KGaA"), de("MTX.DE", "MTU Aero Engines"),
  de("MUV2.DE", "Munich Re"), de("P911.DE", "Porsche AG"), de("PAH3.DE", "Porsche SE"), de("QIA.DE", "Qiagen"), de("RHM.DE", "Rheinmetall"),
  de("RWE.DE", "RWE"), de("SAP.DE", "SAP"), de("SRT3.DE", "Sartorius"), de("SIE.DE", "Siemens"), de("ENR.DE", "Siemens Energy"),
  de("SHL.DE", "Siemens Healthineers"), de("SY1.DE", "Symrise"), de("VOW3.DE", "Volkswagen"), de("VNA.DE", "Vonovia"), de("ZAL.DE", "Zalando"),
];

/** ATX – Wiener Börse */
const AT: ResolvedAsset[] = [
  at("EBS.VI", "Erste Group"), at("OMV.VI", "OMV"), at("VER.VI", "Verbund"), at("VOE.VI", "voestalpine"), at("ANDR.VI", "Andritz"),
  at("RBI.VI", "Raiffeisen Bank International"), at("WIE.VI", "Wienerberger"), at("POST.VI", "Österreichische Post"), at("BG.VI", "BAWAG"),
  at("TKA.VI", "Telekom Austria"), at("UQA.VI", "Uniqa"), at("VIG.VI", "Vienna Insurance Group"), at("CAI.VI", "CA Immo"), at("LNZ.VI", "Lenzing"),
  at("SBO.VI", "Schoeller-Bleckmann"), at("DOC.VI", "DO & CO"), at("EVN.VI", "EVN"), at("ATS.VI", "AT&S"), at("PAL.VI", "Palfinger"), at("STR.VI", "Strabag"),
];

/** Die 20 größten Kryptowährungen (ohne Stablecoins) */
const CRYPTO: ResolvedAsset[] = [
  cr("BTC", "Bitcoin", "bitcoin"), cr("ETH", "Ethereum", "ethereum"), cr("SOL", "Solana", "solana"), cr("XRP", "XRP", "ripple"),
  cr("BNB", "BNB", "binancecoin"), cr("DOGE", "Dogecoin", "dogecoin"), cr("ADA", "Cardano", "cardano"), cr("TRX", "Tron", "tron"),
  cr("LTC", "Litecoin", "litecoin"), cr("LINK", "Chainlink", "chainlink"), cr("AVAX", "Avalanche", "avalanche-2"), cr("DOT", "Polkadot", "polkadot"),
  cr("BCH", "Bitcoin Cash", "bitcoin-cash"), cr("XLM", "Stellar", "stellar"), cr("ATOM", "Cosmos", "cosmos"), cr("SHIB", "Shiba Inu", "shiba-inu"),
  cr("TON", "Toncoin", "the-open-network"), cr("NEAR", "NEAR", "near"), cr("UNI", "Uniswap", "uniswap", "UNI7083-USD"), cr("APT", "Aptos", "aptos", "APT21794-USD"),
];

/** Rohstoffe (Terminkontrakte) */
const COMMODITIES: ResolvedAsset[] = [
  co("GC=F", "Gold"), co("SI=F", "Silber"), co("CL=F", "Öl (WTI)"), co("BZ=F", "Öl (Brent)"), co("NG=F", "Erdgas"), co("HG=F", "Kupfer"),
  co("PL=F", "Platin"), co("PA=F", "Palladium"), co("ZC=F", "Mais"), co("ZW=F", "Weizen"),
];

export const MARKET_GROUPS: { kind: AssetKind; title: string; assets: ResolvedAsset[] }[] = [
  { kind: "stock", title: "Aktien", assets: [...US, ...DE, ...AT] },
  { kind: "crypto", title: "Krypto", assets: CRYPTO },
  { kind: "commodity", title: "Rohstoffe", assets: COMMODITIES },
];

export const MARKET_ASSETS: ResolvedAsset[] = MARKET_GROUPS.flatMap((g) => g.assets);
const KEYS = new Set(MARKET_ASSETS.map((a) => `${a.kind}:${a.symbol}`));
/** Gehört der Wert zum Markt der Chancen? (reine Watchlist-Werte nicht) */
export const inMarket = (a: { kind: string; symbol: string }) => KEYS.has(`${a.kind}:${a.symbol}`);
