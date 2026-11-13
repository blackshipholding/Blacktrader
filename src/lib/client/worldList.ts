// Welt-Suche für die Live-Bilanz (Nutzer 13.11.2026): zusätzliche Werte NUR zum Messen – sie erscheinen NICHT in der Chancen-Liste.
// Industrieländer: große Werte je Land; Schwellenländer in Asien: die größten je Land; dazu 40 Coins und 20 Rohstoffe.
// Die Listen stammen aus dem Gedächtnis; ein Kürzel, das Yahoo nicht kennt, wird einfach übersprungen.
import type { ResolvedAsset } from "../types";
import { COMMODITIES_WIDE, CRYPTO_WIDE, STOCKS_ASIA_WIDE, STOCKS_EU_WIDE, STOCKS_US_WIDE } from "../trainer/universe";
import { MARKET_ASSETS } from "./marketList";

const L = (s: string) => s.split(/\s+/).filter(Boolean);

/** Kanada, Finnland, Irland, Portugal, Neuseeland, Israel (Ergänzung zu den Listen des Trainers) */
const CANADA = L("RY.TO TD.TO ENB.TO SHOP.TO CNQ.TO BN.TO CP.TO CNR.TO BMO.TO BNS.TO CM.TO TRP.TO SU.TO ATD.TO MFC.TO CVE.TO WCN.TO NTR.TO IMO.TO ABX.TO AEM.TO FNV.TO WPM.TO SLF.TO TECK-B.TO GIB-A.TO CSU.TO QSR.TO FTS.TO POW.TO");
const FINLAND = L("NOKIA.HE NESTE.HE FORTUM.HE KNEBV.HE SAMPO.HE UPM.HE STERV.HE WRT1V.HE ELISA.HE ORNBV.HE KESKOB.HE TIETO.HE");
const IRELAND_PORTUGAL = L("RYA.IR KRZ.IR KYG.IR EDP.LS GALP.LS JMT.LS EDPR.LS BCP.LS NOS.LS SON.LS");
const NEW_ZEALAND = L("FPH.NZ AIA.NZ MEL.NZ SPK.NZ FBU.NZ AIR.NZ MFT.NZ CEN.NZ ATM.NZ IFT.NZ");
const ISRAEL = L("TEVA.TA NICE.TA ICL.TA LUMI.TA POLI.TA ESLT.TA DSCT.TA MZTF.TA AZRG.TA NVMI.TA");

/** Schwellenländer in Asien (kein Industrieland): China, Indien (Ergänzung), Indonesien, Thailand, Malaysia, Philippinen, Saudi-Arabien, Türkei */
const CHINA = L(
  "600519.SS 601318.SS 600036.SS 601398.SS 601288.SS 600900.SS 601857.SS 600276.SS 601166.SS 600030.SS 601012.SS 600887.SS 601088.SS 600309.SS 601899.SS 000858.SZ 000333.SZ 002594.SZ 300750.SZ 000651.SZ 002415.SZ 000001.SZ 300059.SZ 002714.SZ 000002.SZ " +
    "1810.HK 2331.HK 1024.HK 9961.HK 0762.HK 0688.HK 1109.HK 2899.HK 0291.HK 1093.HK",
);
const INDIA_MORE = L("BAJAJFINSV.NS HCLTECH.NS TECHM.NS JSWSTEEL.NS TATASTEEL.NS COALINDIA.NS ADANIENT.NS ADANIPORTS.NS DRREDDY.NS CIPLA.NS DIVISLAB.NS EICHERMOT.NS HEROMOTOCO.NS GRASIM.NS BPCL.NS INDUSINDBK.NS SBILIFE.NS HDFCLIFE.NS APOLLOHOSP.NS BRITANNIA.NS TATACONSUM.NS HINDALCO.NS UPL.NS SHREECEM.NS");
const INDONESIA = L("BBCA.JK BBRI.JK BMRI.JK BBNI.JK TLKM.JK ASII.JK UNVR.JK ICBP.JK GOTO.JK ADRO.JK AMMN.JK BYAN.JK CPIN.JK INDF.JK KLBF.JK PGAS.JK SMGR.JK ANTM.JK MDKA.JK TPIA.JK");
const THAILAND = L("PTT.BK CPALL.BK AOT.BK ADVANC.BK SCC.BK GULF.BK PTTEP.BK KBANK.BK SCB.BK BDMS.BK CPN.BK DELTA.BK INTUCH.BK BBL.BK TRUE.BK MINT.BK CRC.BK OR.BK EA.BK GPSC.BK");
const MALAYSIA = L("1155.KL 1023.KL 1295.KL 5347.KL 6033.KL 5225.KL 4863.KL 3182.KL 5183.KL 1082.KL 6888.KL 5819.KL 1961.KL 4707.KL 1066.KL");
const PHILIPPINES = L("SM.PS BDO.PS ALI.PS AC.PS TEL.PS JFC.PS BPI.PS MER.PS ICT.PS SMPH.PS URC.PS AEV.PS");
const SAUDI = L("2222.SR 1120.SR 2010.SR 7010.SR 1180.SR 1150.SR 2380.SR 1211.SR 2082.SR 1050.SR 5110.SR 4013.SR 2280.SR 4002.SR 1010.SR");
const TURKEY = L("THYAO.IS GARAN.IS AKBNK.IS ISCTR.IS BIMAS.IS ASELS.IS KCHOL.IS SAHOL.IS EREGL.IS TUPRS.IS FROTO.IS TCELL.IS SISE.IS YKBNK.IS PGSUS.IS TOASO.IS");

export type WorldRegion = "USA" | "Europa" | "Kanada" | "Asien-Pazifik" | "Naher Osten" | "Schwellenländer Asien" | "Krypto" | "Rohstoffe";
export const WORLD_REGIONS: WorldRegion[] = ["USA", "Europa", "Kanada", "Asien-Pazifik", "Naher Osten", "Schwellenländer Asien", "Krypto", "Rohstoffe"];

const SUFFIX: [RegExp, WorldRegion][] = [
  [/\.(DE|PA|AS|MC|MI|SW|L|BR|CO|ST|OL|HE|VI|IR|LS)$/, "Europa"],
  [/\.TO$/, "Kanada"],
  [/\.(T|HK|AX|KS|TW|SI|NZ)$/, "Asien-Pazifik"],
  [/\.TA$/, "Naher Osten"],
  [/\.(SS|SZ|NS|JK|BK|KL|PS|SR|IS)$/, "Schwellenländer Asien"],
];
/** Hongkong-Werte, die zu China zählen, bleiben bei „Asien-Pazifik“ – nur die eigens aufgeführten chinesischen .HK-Werte gelten als Schwellenland */
const CHINA_HK = new Set(CHINA.filter((s) => s.endsWith(".HK")));

export function regionOf(a: { kind: string; symbol: string }): WorldRegion {
  if (a.kind === "crypto") return "Krypto";
  if (a.kind === "commodity") return "Rohstoffe";
  if (CHINA_HK.has(a.symbol)) return "Schwellenländer Asien";
  for (const [re, r] of SUFFIX) if (re.test(a.symbol)) return r;
  return "USA";
}

const stock = (symbol: string): ResolvedAsset => ({ kind: "stock", symbol, name: symbol, yahooSymbol: symbol });
const crypto = (s: string): ResolvedAsset => ({ kind: "crypto", symbol: s.replace(/-USD$/, ""), name: s.replace(/-USD$/, ""), yahooSymbol: s, binanceSymbol: `${s.replace(/-USD$/, "")}USDT`, exchange: "Binance", currency: "USDT" });
const commodity = (symbol: string): ResolvedAsset => ({ kind: "commodity", symbol, name: symbol, yahooSymbol: symbol, currency: "USD", exchange: "Terminmarkt" });

/** Alle Werte der Welt-Suche (ohne die ~200 der normalen Chancen-Suche), Reihenfolge fest */
export function worldAssets(): ResolvedAsset[] {
  const have = new Set(MARKET_ASSETS.map((a) => `${a.kind}:${a.symbol}`));
  const stocks = [...new Set([...STOCKS_US_WIDE, ...STOCKS_EU_WIDE, ...STOCKS_ASIA_WIDE, ...CANADA, ...FINLAND, ...IRELAND_PORTUGAL, ...NEW_ZEALAND, ...ISRAEL, ...CHINA, ...INDIA_MORE, ...INDONESIA, ...THAILAND, ...MALAYSIA, ...PHILIPPINES, ...SAUDI, ...TURKEY])];
  const coins = CRYPTO_WIDE.filter((s) => !have.has(`crypto:${s.replace(/-USD$/, "")}`)).slice(0, 40);
  const raw = COMMODITIES_WIDE.filter((s) => !have.has(`commodity:${s}`)).slice(0, 20);
  return [...stocks.filter((s) => !have.has(`stock:${s}`)).map(stock), ...coins.map(crypto), ...raw.map(commodity)];
}
