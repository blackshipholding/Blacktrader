// Blacktrader: EIN aktueller Einstieg pro Wert, berechnet aus den Zeiträumen im Hintergrund.
//   BLAU  – langfristiger Einstieg (Kernposition / Langfrist-Bereich, Logik unverändert aus longterm.ts)
//   GRÜN  – Trade auf steigende Kurse (bestehende Zonen-Analyse, unverändert)
//   ROT   – Short: Trade auf fallende Kurse (bestehende Zonen-Analyse, unverändert)
//   GELB  – momentan kein sauberer Einstieg (mit Hinweis, worauf gewartet wird)
// Regeln aus dem Vergleich auf gesperrten Testdaten (siehe DOKUMENTATION.md):
//   - Aktien und Krypto ohne kurzfristige Signale; Rohstoffe kurzfristig nur bei bullischem Gesamtmarkt
//   - Sektor-Regel: ist der Tech-Markt schwach (NASDAQ 100 unter der 200-Tage-Linie), keine grünen Tech-Trades
//     (rote Shorts bleiben erlaubt)
//   - Shorts (rot) nur, wenn der Gesamtmarkt bärisch ist (S&P 500 unter der 200-Tage-Linie und −5 % in 100 Tagen):
//     im Turnier +19,8 % statt +9,4 % pro Jahr (Shorts immer) bzw. +18,9 % (ohne Shorts)
//   - Rangfolge der Zeiträume je Anlageklasse nach gemessener Zonen-Quote
import type { AssetKind, Candle, Horizon } from "../types";
import type { AnalysisResult } from "./analyze";
import type { LongTermZone } from "./longterm";
import type { TradePlan } from "./score";

export type EntryColor = "blau" | "gruen" | "rot" | "gelb";

export interface MarketContext {
  /** Gesamtmarkt (S&P 500) bullisch: über der 200-Tage-Linie und +5 % in 100 Tagen */
  spBull: boolean | null;
  /** Tech-Markt schwach: NASDAQ 100 unter seiner 200-Tage-Linie */
  techWeak: boolean | null;
  /** Gesamtmarkt (S&P 500) bärisch: unter der 200-Tage-Linie und −5 % in 100 Tagen – nur dann gibt es rote Shorts */
  spBear?: boolean | null;
}

export interface BestEntry {
  color: EntryColor;
  /** Kennung – ändert sich, wenn ein anderer Einstieg aktuell wird */
  key: string;
  horizon?: Horizon;
  plan?: TradePlan | null;
  lt?: LongTermZone | null;
  res?: AnalysisResult | null;
  zoneTop?: number;
  zoneBottom?: number;
  stop?: number;
  targets?: number[];
  invalidation?: number;
  /** Richtung: Kauf (blau/grün) oder Short (rot) */
  dir?: "long" | "short";
  reason: string;
  /** Bei Gelb: worauf gewartet wird */
  waitFor?: string;
}

/** Tech-/Wachstumswerte für die Sektor-Regel */
export const TECH_SYMBOLS = new Set(["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "GOOG", "META", "TSLA", "NFLX", "ADBE", "CRM", "ORCL", "INTC", "AMD", "CSCO", "SAP.DE", "AVGO", "QCOM", "PLTR", "SHOP", "TEAM", "MSTR", "ZS", "TTD", "^NDX"]);

/** Rangfolge der Zeiträume je Klasse (gemessene Zonen-Quote, beste zuerst) */
export const HORIZON_RANK: Record<AssetKind, Horizon[]> = {
  stock: ["long", "medium"],
  crypto: ["medium", "long"],
  commodity: ["short", "long", "medium"],
};

/** Welche Zeiträume dürfen ein grünes oder rotes Signal liefern? */
export function allowedHorizons(kind: AssetKind, ctx: MarketContext): Horizon[] {
  return HORIZON_RANK[kind].filter((h) => h !== "short" || (kind === "commodity" && ctx.spBull === true));
}

/** Marktlage aus Tageskerzen (nur Vergangenheit). */
export function marketContext(spx: Candle[] | null | undefined, ndx: Candle[] | null | undefined): MarketContext {
  const sma = (c: Candle[], i: number) => c.slice(i - 199, i + 1).reduce((s, x) => s + x.close, 0) / 200;
  let spBull: boolean | null = null;
  let spBear: boolean | null = null;
  let techWeak: boolean | null = null;
  if (spx && spx.length > 200) {
    const i = spx.length - 1;
    spBull = spx[i].close > sma(spx, i) && spx[i].close / spx[i - 100].close - 1 > 0.05;
    spBear = spx[i].close < sma(spx, i) && spx[i].close / spx[i - 100].close - 1 < -0.05;
  }
  if (ndx && ndx.length > 200) {
    const i = ndx.length - 1;
    techWeak = ndx[i].close < sma(ndx, i);
  }
  return { spBull, techWeak, spBear };
}

const zoneOf = (p: TradePlan) => ({ top: Math.max(p.zoneStart ?? p.entry, p.zoneEnd ?? p.entry), bottom: Math.min(p.zoneStart ?? p.entry, p.zoneEnd ?? p.entry) });

export interface PickInput {
  symbol: string;
  kind: AssetKind;
  views: Partial<Record<Horizon, AnalysisResult | null>>;
  lt?: LongTermZone | null;
  ctx: MarketContext;
  /** Bereits erledigte oder ungültige Einstiege (Kennungen) – werden nicht erneut gezeigt */
  done?: Set<string>;
  fmt?: (n: number) => string;
}

/** Wählt GENAU EINEN aktuellen Einstieg pro Wert. */
export function pickBestEntry(inp: PickInput): BestEntry {
  const fmt = inp.fmt ?? ((n: number) => n.toFixed(2));
  const done = inp.done ?? new Set<string>();
  const lt = inp.lt && inp.lt.status !== "invalidiert" && !done.has(`blau:${inp.lt.key}`) ? inp.lt : null;
  const blue = (): BestEntry => ({
    color: "blau",
    dir: "long",
    key: `blau:${lt!.key}`,
    lt,
    zoneTop: lt!.zoneTop,
    zoneBottom: lt!.zoneBottom,
    invalidation: lt!.invalidation,
    targets: [...lt!.targets],
    reason: `Langfristiger Einstieg in drei Teilen ${fmt(lt!.zoneTop)} – ${fmt(lt!.zoneBottom)}. Ungültig unter ${fmt(lt!.invalidation)}.`,
  });

  const sectorBlocked = inp.kind === "stock" && TECH_SYMBOLS.has(inp.symbol) && inp.ctx.techWeak === true;
  const trades: BestEntry[] = [];
  for (const h of allowedHorizons(inp.kind, inp.ctx)) {
      const r = inp.views[h];
      const p = r?.plan;
      if (!r || !p || r.decision.level === "neutral") continue;
      if (p.direction === "long" && sectorBlocked) continue; // Sektor-Regel nur für grüne Tech-Trades
      if (p.direction === "short" && inp.ctx.spBear !== true) continue; // Shorts nur bei bärischem Gesamtmarkt
      const color = p.direction === "long" ? "gruen" : "rot";
      const z = zoneOf(p);
      const key = `${color}:${h}:${z.top.toPrecision(6)}:${z.bottom.toPrecision(6)}`;
      if (done.has(key)) continue;
      trades.push({
        color,
        dir: p.direction,
        key,
        horizon: h,
        plan: p,
        res: r,
        zoneTop: z.top,
        zoneBottom: z.bottom,
        stop: p.stop,
        targets: p.targets,
        invalidation: p.stop,
        reason: r.commentary.reason || r.commentary.summary,
      });
    }

  if (lt && lt.status === "in-zone") return blue();
  if (trades.length) return trades[0];
  if (lt) return blue();

  // GELB: worauf wartet Blacktrader?
  let waitFor: string;
  const shortSeen = HORIZON_RANK[inp.kind].some((h) => inp.views[h]?.plan?.direction === "short" && inp.views[h]?.decision.level !== "neutral");
  if (sectorBlocked) waitFor = "Der Tech-Markt ist schwach – Blacktrader wartet, bis der NASDAQ 100 wieder über seiner 200-Tage-Linie liegt.";
  else if (shortSeen) waitFor = "Der Chart zeigt fallende Kurse. Shorts (rot) gibt Blacktrader nur, wenn der Gesamtmarkt (S&P 500) bärisch ist – sonst wartet er auf einen Kauf-Einstieg.";
  else {
    const r = HORIZON_RANK[inp.kind].map((h) => inp.views[h]).find((x) => x);
    const b = r?.elliott.best;
    const veto = r?.decision.vetoes?.[0];
    waitFor = b ? `${b.phase}. Blacktrader wartet auf eine saubere Einstiegszone.` : veto ? `${veto} – Blacktrader wartet.` : "Kein sauberes Setup – Blacktrader wartet.";
  }
  return { color: "gelb", key: "gelb", reason: waitFor, waitFor };
}

// ---------------------------------------------------------------------------------------------
// Verlauf: erledigte, ungültige oder abgelöste Einstiege werden grau.

export type PastStatus = "erledigt" | "ungültig" | "abgelöst";

export interface HistEntry {
  key: string;
  color: EntryColor;
  horizon?: Horizon;
  zoneTop?: number;
  zoneBottom?: number;
  stop?: number;
  target?: number;
  invalidation?: number;
  /** seit (Unix-Sekunden) */
  from: number;
  to?: number;
  status?: PastStatus;
  /** Kurs ist schon in die Zone eingetaucht */
  touched?: boolean;
  /** Short (rot): umgekehrte Richtung */
  dir?: "long" | "short";
  /** War vor dem Ergebnis als aktueller Einstieg zu sehen (nicht erst im Nachhinein gefunden) – nur diese zählen für Quoten */
  seen?: boolean;
}

/**
 * Prüft den laufenden Einstieg mit den Kerzen seit seinem Beginn:
 * eingetaucht und oben wieder heraus → erledigt; unter Stop/Invalidierung → ungültig.
 */
export function entryStatus(e: HistEntry, candles: Candle[]): { status: PastStatus | null; touched: boolean; at?: number } {
  if (e.color === "gelb" || e.zoneTop == null || e.zoneBottom == null) return { status: null, touched: false };
  let touched = !!e.touched;
  const limit = e.invalidation ?? e.stop;
  const short = e.dir === "short" || e.color === "rot";
  for (const c of candles) {
    if (c.time <= e.from) continue;
    if (short) {
      // Short: hineingestiegen und unten wieder heraus → erledigt; Schluss über dem Stop → ungültig
      if (limit != null && c.close > limit) return { status: "ungültig", touched, at: c.time };
      if (touched && c.close < e.zoneBottom) return { status: "erledigt", touched, at: c.time };
      if (c.high >= e.zoneBottom) touched = true;
      continue;
    }
    if (limit != null && c.close < limit) return { status: "ungültig", touched, at: c.time };
    if (touched && c.close > e.zoneTop) return { status: "erledigt", touched, at: c.time }; // eingetaucht und oben wieder heraus
    if (c.low <= e.zoneTop) touched = true;
  }
  return { status: null, touched };
}

/**
 * Blauer Langfrist-Bereich, gemessen ab dem Hoch von Welle 1 (nicht erst ab dem ersten Anzeigen):
 * eingetaucht und oben wieder heraus → erledigt; Schlusskurs unter dem Wellenstart → ungültig.
 */
export function longTermOutcome(lt: LongTermZone, candles: Candle[]): { status: PastStatus; at: number; entry: HistEntry } | null {
  const entry: HistEntry = { key: `blau:${lt.key}`, color: "blau", zoneTop: lt.zoneTop, zoneBottom: lt.zoneBottom, invalidation: lt.invalidation, target: lt.targets[0], from: lt.high.time };
  const s = entryStatus(entry, candles);
  return s.status ? { status: s.status, at: s.at ?? entry.from, entry: { ...entry, touched: s.touched } } : null;
}

/** Einen Einstieg als abgeschlossen (grau) eintragen – auch wenn er nie „aktuell“ angezeigt wurde. */
export function closeInHistory(h: { current?: HistEntry; past: HistEntry[] }, e: HistEntry, status: PastStatus, at: number, max = 10): { current?: HistEntry; past: HistEntry[] } {
  if (h.past.some((p) => p.key === e.key && (p.status === "erledigt" || p.status === "ungültig"))) return h;
  const past = trimPast([{ ...e, status, to: at }, ...h.past.filter((p) => p.key !== e.key)], max);
  return { current: h.current?.key === e.key ? undefined : h.current, past };
}

/**
 * Aktualisiert den Verlauf eines Werts: alter Einstieg → grau (mit Datum und Grund), neuer → aktuell.
 * Gibt den neuen Verlauf zurück (höchstens `max` alte Einträge).
 */
export function updateHistory(h: { current?: HistEntry; past: HistEntry[] }, next: BestEntry, now: number, candles: Candle[] = [], max = 10): { current?: HistEntry; past: HistEntry[] } {
  const past = [...h.past];
  let cur = h.current;
  // Läuft der aktuelle Einstieg noch? (erledigt/ungültig → grau)
  if (cur && cur.color !== "gelb") {
    const s = entryStatus(cur, candles);
    cur = { ...cur, touched: s.touched };
    if (s.status) {
      past.unshift({ ...cur, status: s.status, to: s.at ?? now });
      cur = undefined;
    }
  }
  if (!cur || cur.key !== next.key) {
    if (cur && cur.color !== "gelb") past.unshift({ ...cur, status: "abgelöst", to: now });
    cur = {
      key: next.key,
      color: next.color,
      horizon: next.horizon,
      zoneTop: next.zoneTop,
      zoneBottom: next.zoneBottom,
      stop: next.stop,
      target: next.targets?.[0],
      invalidation: next.invalidation,
      dir: next.dir,
      from: now,
      seen: true,
    };
  }
  return { current: cur, past: trimPast(past, max) };
}

/**
 * Höchstens `max` alte Einstiege anzeigen – erledigte/ungültige aber länger merken (bis 3 × max), damit sie nicht nach ein
 * paar „abgelöst“-Wechseln aus dem Verlauf fallen und dann wieder als aktueller Einstieg auftauchen.
 */
function trimPast(past: HistEntry[], max: number): HistEntry[] {
  const out: HistEntry[] = [];
  let n = 0;
  for (const p of past) {
    const done = p.status === "erledigt" || p.status === "ungültig";
    if (n < max) (out.push(p), n++);
    else if (done && out.length < 3 * max) out.push(p);
  }
  return out;
}

/** Kennungen erledigter/ungültiger Einstiege (werden nicht erneut als aktuell gezeigt). */
export const doneKeys = (h: { past: HistEntry[] }) => new Set(h.past.filter((p) => p.status === "erledigt" || p.status === "ungültig").map((p) => p.key));
