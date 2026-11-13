// Welche Kursreihen der Trainer zum Lernen nutzt (je Anlageklasse und Horizont).
// Mehr Werte als im Chancen-Scanner, damit genug Signale (≥ 200) zusammenkommen.
import type { AssetKind, Horizon, Interval } from "../types";

export interface SeriesSpec {
  symbol: string;
  kind: AssetKind;
  horizon: Horizon;
  interval: Interval;
  /** Wie weit zurück (Tage) */
  days: number;
  /** Jede n-te Kerze bewerten (Rechenzeit) */
  step: number;
}

export const CELL_KEYS = (["stock", "crypto", "commodity"] as AssetKind[]).flatMap((k) => (["short", "medium", "long"] as Horizon[]).map((h) => `${k}:${h}` as const));
export type CellKey = (typeof CELL_KEYS)[number];
/** Blacktrader: Aktien und Krypto ohne kurzfristige Signale – diese Bereiche werden nicht mehr trainiert (alte Stände bleiben gespeichert). */
export const ACTIVE_CELL_KEYS: CellKey[] = CELL_KEYS.filter((c) => c !== "stock:short" && c !== "crypto:short");

const STOCKS = [
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "JPM", "V", "MA", "UNH", "HD", "PG", "KO", "PEP", "XOM", "CVX", "JNJ", "MRK", "ABBV",
  "WMT", "COST", "DIS", "NFLX", "ADBE", "CRM", "ORCL", "INTC", "AMD", "CSCO",
  "SAP.DE", "SIE.DE", "ALV.DE", "DTE.DE", "RHM.DE", "MBG.DE", "BAS.DE", "BAYN.DE", "BMW.DE", "VOW3.DE",
];
/** Weitere Coins (Yahoo „XXX-USD“); Binance-Paare gleichen Namens sind dieselben Werte. Wer zu jung ist, fällt wegen zu weniger Kerzen von selbst heraus. */
export const CRYPTO_WIDE = (
  "BTC ETH BNB SOL XRP DOGE ADA TRX AVAX LINK DOT BCH LTC XLM ATOM UNI ETC XMR FIL HBAR APT ARB OP NEAR ICP VET ALGO AAVE MKR GRT SAND MANA AXS THETA EOS XTZ FLOW EGLD CHZ KAVA ZEC DASH NEO IOTA ENJ CRV SNX COMP YFI BAT ZIL 1INCH RUNE INJ SUI SEI TIA STX IMX LDO FTM PEPE SHIB TON"
).split(" ").map((s) => `${s}-USD`);

const CRYPTO = ["BTC", "ETH", "SOL", "XRP", "BNB", "DOGE", "ADA", "TRX", "LTC", "LINK", "AVAX", "DOT", "BCH", "XLM", "ATOM"].map((s) => `${s}-USD`);
const COMMODITIES = ["GC=F", "SI=F", "CL=F", "BZ=F", "NG=F", "HG=F", "PL=F", "PA=F", "ZC=F", "ZW=F"];

/**
 * Breite Lernwerte (Nutzer 13.11.2026, Stufe 1): große US-Aktien (S&P-500-Kern) und große europäische Aktien. Gilt NUR für das
 * Lernen im Browser (sessionUniverse), nicht für Turnier/Härtetest (die bleiben bei ihren festen Listen, damit sie vergleichbar sind).
 * Ein Kürzel, das Yahoo nicht kennt, wird beim Laden einfach übersprungen.
 */
export const STOCKS_US_WIDE = (
  "A AAL AAP ABBV ABNB ABT ACN ADBE ADI ADM ADP ADSK AEE AEP AES AFL AIG AIZ AJG AKAM ALB ALGN ALL ALLE AMAT AMCR AMD AME AMGN AMP AMT AMZN ANET ANSS AON AOS APA APD APH APTV ARE ATO AVB AVGO AVY AWK AXON AXP AZO " +
  "BA BAC BALL BAX BBWI BBY BDX BEN BF-B BG BIIB BIO BK BKNG BKR BLDR BLK BMY BR BRO BSX BWA BX BXP C CAG CAH CARR CAT CB CBOE CBRE CCI CCL CDNS CDW CE CEG CF CFG CHD CHRW CHTR CI CINF CL CLX CMCSA CME CMG CMI CMS CNC CNP COF COO COP COR COST CPB CPRT CPT CRL CRM CSCO CSGP CSX CTAS CTRA CTSH CTVA CVS CVX CZR " +
  "D DAL DD DE DECK DFS DG DGX DHI DHR DIS DLR DLTR DOV DOW DPZ DRI DTE DUK DVA DVN DXCM EA EBAY ECL ED EFX EG EIX EL ELV EMN EMR ENPH EOG EPAM EQIX EQR EQT ES ESS ETN ETR EVRG EW EXC EXPD EXPE EXR F FANG FAST FCX FDS FDX FE FFIV FI FICO FIS FITB FMC FOX FOXA FRT FSLR FTNT FTV GD GE GEN GILD GIS GL GLW GM GNRC GOOG GOOGL GPC GPN GRMN GS GWW " +
  "HAL HAS HBAN HCA HD HES HIG HII HLT HOLX HON HPE HPQ HRL HSIC HST HSY HUBB HUM HWM IBM ICE IDXX IEX IFF ILMN INCY INTC INTU INVH IP IPG IQV IR IRM ISRG IT ITW IVZ J JBHT JCI JKHY JNJ JNPR JPM K KDP KEY KEYS KHC KIM KLAC KMB KMI KMX KO KR L LDOS LEN LH LHX LIN LKQ LLY LMT LNT LOW LRCX LULU LUV LVS LW LYB LYV " +
  "MA MAA MAR MAS MCD MCHP MCK MCO MDLZ MDT MET META MGM MHK MKC MKTX MLM MMC MMM MNST MO MOH MOS MPC MPWR MRK MRNA MRO MS MSCI MSFT MSI MTB MTCH MTD MU NCLH NDAQ NDSN NEE NEM NFLX NI NKE NOC NOW NRG NSC NTAP NTRS NUE NVDA NVR NWS NWSA NXPI O ODFL OKE OMC ON ORCL ORLY OTIS OXY PANW PARA PAYC PAYX PCAR PCG PEG PEP PFE PFG PG PGR PH PHM PKG PLD PM PNC PNR PNW PODD POOL PPG PPL PRU PSA PSX PTC PWR PYPL " +
  "QCOM QRVO RCL REG REGN RF RJF RL RMD ROK ROL ROP ROST RSG RTX RVTY SBAC SBUX SCHW SHW SJM SLB SMCI SNA SNPS SO SPG SPGI SRE STE STLD STT STX STZ SWK SWKS SYF SYK SYY T TAP TDG TDY TECH TEL TER TFC TFX TGT TJX TMO TMUS TPR TRGP TRMB TROW TRV TSCO TSLA TSN TT TTWO TXN TXT TYL UAL UBER UDR UHS ULTA UNH UNP UPS URI USB V VICI VLO VMC VRSK VRSN VRTX VTR VTRS VZ WAB WAT WBA WBD WDC WEC WELL WFC WM WMB WMT WRB WST WTW WY WYNN XEL XOM XYL YUM ZBH ZBRA ZION ZTS"
).split(" ");

export const STOCKS_EU_WIDE = [
  // Deutschland (Xetra)
  "ADS.DE", "AIR.DE", "ALV.DE", "BAS.DE", "BAYN.DE", "BEI.DE", "BMW.DE", "BNR.DE", "CBK.DE", "CON.DE", "1COV.DE", "DB1.DE", "DBK.DE", "DHL.DE", "DTE.DE", "DTG.DE", "ENR.DE", "EOAN.DE", "FME.DE", "FRE.DE", "HEI.DE", "HEN3.DE", "HNR1.DE", "IFX.DE", "MBG.DE", "MRK.DE", "MTX.DE", "MUV2.DE", "P911.DE", "PAH3.DE", "QIA.DE", "RHM.DE", "RWE.DE", "SAP.DE", "SHL.DE", "SIE.DE", "SRT3.DE", "SY1.DE", "VNA.DE", "VOW3.DE", "ZAL.DE",
  // Frankreich
  "AI.PA", "AIR.PA", "BN.PA", "BNP.PA", "CA.PA", "CAP.PA", "CS.PA", "DG.PA", "DSY.PA", "EL.PA", "EN.PA", "ENGI.PA", "ERF.PA", "GLE.PA", "HO.PA", "KER.PA", "LR.PA", "MC.PA", "ML.PA", "OR.PA", "ORA.PA", "PUB.PA", "RI.PA", "RMS.PA", "SAF.PA", "SAN.PA", "SGO.PA", "STLAP.PA", "SU.PA", "TTE.PA", "VIE.PA", "VIV.PA",
  // Niederlande, Belgien, Spanien, Italien
  "ADYEN.AS", "AD.AS", "ASML.AS", "ASM.AS", "HEIA.AS", "INGA.AS", "KPN.AS", "NN.AS", "PHIA.AS", "PRX.AS", "RAND.AS", "WKL.AS", "ABI.BR", "KBC.BR", "UCB.BR",
  "BBVA.MC", "SAN.MC", "IBE.MC", "ITX.MC", "TEF.MC", "REP.MC", "AMS.MC", "FER.MC",
  "ENEL.MI", "ENI.MI", "ISP.MI", "UCG.MI", "RACE.MI", "G.MI", "STLAM.MI", "PRY.MI", "LDO.MI",
  // Schweiz, Skandinavien
  "NESN.SW", "NOVN.SW", "ROG.SW", "UBSG.SW", "ZURN.SW", "ABBN.SW", "CFR.SW", "LONN.SW", "SREN.SW", "GIVN.SW", "SIKA.SW", "HOLN.SW",
  "NOVO-B.CO", "DSV.CO", "VWS.CO", "MAERSK-B.CO", "ERIC-B.ST", "VOLV-B.ST", "ATCO-A.ST", "SEB-A.ST", "HM-B.ST", "INVE-B.ST", "EQNR.OL", "DNB.OL",
  // Großbritannien
  "AZN.L", "SHEL.L", "HSBA.L", "ULVR.L", "BP.L", "GSK.L", "RIO.L", "DGE.L", "BATS.L", "LSEG.L", "REL.L", "NG.L", "BARC.L", "LLOY.L", "VOD.L", "TSCO.L", "CPG.L", "AAL.L", "GLEN.L", "RR.L", "BA.L", "PRU.L", "STAN.L", "IMB.L",
];

/** Kerzengröße und Zeitraum je Horizont (Yahoo liefert Stundenkerzen nur für ca. 2 Jahre). */
export const HORIZON_SETUP: Record<Horizon, { interval: Interval; days: number; step: number }> = {
  short: { interval: "1h", days: 729, step: 2 },
  medium: { interval: "1d", days: 5 * 365, step: 1 },
  long: { interval: "1w", days: 15 * 365, step: 1 },
};

export function universe(cell: CellKey): SeriesSpec[] {
  const [kind, horizon] = cell.split(":") as [AssetKind, Horizon];
  const list = kind === "stock" ? STOCKS : kind === "crypto" ? CRYPTO : COMMODITIES;
  // Stundenkerzen: bei Aktien weniger Werte (Rechenzeit), Krypto handelt rund um die Uhr
  const symbols = horizon === "short" && kind === "stock" ? list.slice(0, 25) : list;
  const s = HORIZON_SETUP[horizon];
  return symbols.map((symbol) => ({ symbol, kind, horizon, interval: s.interval, days: s.days, step: s.step }));
}

/** Große Indizes (als Aktien-Klasse gelernt) */
export const INDICES = ["^GSPC", "^NDX", "^DJI", "^RUT", "^GDAXI", "^STOXX50E", "^FTSE", "^FCHI", "^N225", "^HSI"];

/**
 * Lernwerte für das Browser-Training: alles aus `universe` + Indizes + zusätzliche Werte
 * (Chancen und Watchlist). Krypto über Yahoo (XXX-USD), damit eine Abfrage mehrere Jahre liefert.
 */
export function sessionUniverse(cell: CellKey, extra: { symbol: string; kind: AssetKind; yahooSymbol?: string }[] = []): SeriesSpec[] {
  const [kind, horizon] = cell.split(":") as [AssetKind, Horizon];
  const base = universe(cell);
  const s = HORIZON_SETUP[horizon];
  const syms = new Set(base.map((b) => b.symbol));
  const add: string[] = [];
  if (kind === "stock") add.push(...INDICES);
  // Breite Lernwerte (Mittel-/Langfrist): viele Aktien USA + Europa, viele Coins – mehr Zonen für die Mindestzahl (B2)
  if (kind === "stock" && horizon !== "short") add.push(...STOCKS_US_WIDE, ...STOCKS_EU_WIDE);
  if (kind === "crypto" && horizon !== "short") add.push(...CRYPTO_WIDE);
  if (kind === "stock" && horizon === "short") add.push(...STOCKS.slice(25));
  for (const e of extra) if (e.kind === kind) add.push(e.yahooSymbol ?? (kind === "crypto" ? `${e.symbol}-USD` : e.symbol));
  const out = [...base];
  for (const symbol of add) if (!syms.has(symbol)) (syms.add(symbol), out.push({ symbol, kind, horizon, interval: s.interval, days: s.days, step: s.step }));
  return out;
}
