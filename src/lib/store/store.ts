"use client";
// Lokaler Speicher (localStorage) für Watchlist, Trades und Einstellungen – kein Server, kein Login.
import { clampWeights, validateWeights } from "../analysis/params";
import { useRef, useSyncExternalStore } from "react";
import { DEFAULT_WEIGHTS, type SignalLevel, type Weights } from "../analysis/score";
import { HORIZON_DEFAULT_INTERVAL, type Horizon, type Interval, type ResolvedAsset } from "../types";
import { eurPerUnit } from "../fx";
import { tradeCurrency } from "../client/eur";
import type { Holding, HoldingTx } from "../client/holdings";
import type { ChanceLogEntry } from "../client/chanceLog";
import { allHistories, restoreHistories } from "../client/entries";

export interface WatchItem extends ResolvedAsset {
  id: string;
  addedAt: number;
  /** Eigener Horizont (überschreibt den globalen) */
  horizon?: Horizon;
}

export interface LongTermProposal {
  key: string;
  kind: "ausstieg" | "teilausstieg" | "stop";
  reason: string;
  /** Anteil der noch gehaltenen Position, der verkauft werden soll */
  fraction?: number;
  /** neuer Stop (Währung des Werts) */
  stop?: number;
  /** Kurs beim Vorschlag (Währung des Werts) */
  price: number;
  at: number;
  /** Erinnerung am nächsten Handelstag schon gesendet */
  reminded?: boolean;
}

export interface Trade {
  id: string;
  symbol: string;
  name: string;
  kind: ResolvedAsset["kind"];
  binanceSymbol?: string;
  yahooSymbol?: string;
  direction: "long" | "short";
  horizon: Horizon;
  interval: Interval;
  entry: number;
  stop: number;
  targets: number[];
  openedAt: number;
  reason: string;
  score: number;
  signal: SignalLevel;
  pattern?: string;
  /** pending = wartende Limit-Order in der Zone */
  status: "pending" | "open" | "closed";
  orderType?: "limit" | "market";
  cancelAbove?: number;
  /** Ablauf der wartenden Order (ms) */
  expiresAt?: number;
  /** Nachzieh-Abstand ab Ziel 1 */
  trailDistance?: number;
  /** Nach Ziel 1 bei erkanntem Wellen-5-Ende Gewinn sichern (vom Trainer gelernt) */
  wave5Exit?: boolean;
  /** true, sobald Ziel 1 erreicht ist (Stop läuft mit) */
  trailing?: boolean;
  /** ursprünglicher Stop (für Anzeige) */
  initialStop?: number;
  lastPrice?: number;
  exit?: number;
  closedAt?: number;
  closeReason?: "target" | "stop" | "manual" | "cancelled" | "welle5" | "trendbruch" | "invalidiert" | "zaehlung" | "verkauft";
  /** flatex-Depot (1–4), in dem gekauft wurde */
  depot?: number;
  /** Frühere Stände, bevor der Kauf an flatex angeglichen wurde („Kauf korrigieren“) – der alte Stand bleibt erhalten */
  corrections?: { at: number; tranches: { price: number; filledAt?: number; qty?: number; eur?: number }[]; stakeEur?: number; entry: number }[];
  /** Gemeinsamer Verkauf mehrerer Käufe desselben Werts: bei flatex EINE Order → Verkaufsgebühr nur beim ersten Kauf */
  sellFeeShared?: boolean;
  /** "longterm" = Langfristiger Einstieg (blau); "core" = alte Kernposition (vor dem Update); sonst Zonen-Trade */
  strategy?: "zone" | "core" | "longterm";
  /** Langfrist-Bereich (nur strategy "longterm") */
  /** highTime: Hoch der Welle 1 (Beginn des Bereichs, Unix-Sekunden) – für die Anzeige im Chart */
  lt?: { zoneTop: number; zoneBottom: number; invalidation: number; targets: number[]; key: string; highTime?: number };
  /** Einstieg in Teilen (Langfrist): Preis und Zeitpunkt der Ausführung */
  /** Teil-Orders: Limit (Währung des Werts), Stückzahl und Betrag in € (ab Nov. 2026 gespeichert) */
  tranches?: { price: number; filledAt?: number; qty?: number; eur?: number }[];
  /** Teilausstiege (Anteil der Position, Kurs, Zeitpunkt, Grund) */
  /** noFee: Teil eines gemeinsamen Verkaufs mehrerer Käufe (Gebühr schon beim ersten gezählt) */
  partials?: { fraction: number; price: number; at: number; reason: string; noFee?: boolean }[];
  /** Noch gehaltener Anteil der gekauften Position (1 = alles) */
  remaining?: number;
  /** Letzte Meldung von Blacktrader zu dieser Position (wird nur einmal gesendet) */
  lastActionKey?: string;
  lastActionText?: string;
  /**
   * Vorschlag von Blacktrader zu einer Langfrist-Position (geänderte Zählung), der erst nach Bestätigung gilt –
   * so wie bei flatex: Verkaufen, Stop-Loss setzen oder wartende Orders löschen macht dort nur der Nutzer.
   */
  proposal?: LongTermProposal;
  /** "manual" = vom Nutzer selbst übernommen (nur solche Trades gehören ins Journal) */
  source?: "manual";
  /** Herkunft unklar (vor dem Update angelegt) – Nutzer entscheidet einmalig */
  unverified?: boolean;
  returnPct?: number;
  /** Währung des Werts (für die Umrechnung in Euro) */
  currency?: string;
  /** Wert von 1 Einheit der Währung in Euro beim Kauf bzw. Verkauf */
  fxEntry?: number;
  fxExit?: number;
  /** Order-Zettel: Stückzahl (für 500 €, bis 50 € darüber) */
  shares?: number;
  /** Tatsächlich eingesetzter Betrag in € (Stück × Kurs); ohne Angabe 500 € */
  stakeEur?: number;
  /** Nachkauf (nur bei Blau, 250 €) zu einer bestehenden Position */
  nachkauf?: boolean;
  /** Stop, wie er bei flatex in Euro eingetragen ist (für die Erinnerung bei Wechselkurs-Änderung) */
  brokerStopEur?: number;
  /** Zuletzt gemeldeter Vorschlag für den flatex-Stop (nur einmal melden) */
  brokerStopNotified?: number;
  /** Hochstufung GRÜN → BLAU (Blacktrader): Zeitpunkt und Grund */
  promotedAt?: number;
  promoteReason?: string;
}

export interface Settings {
  weights: Weights;
  /** "trainer" = gelernte Gewichtung verwenden, "manual" = eigene Regler (gleiche Grenzen) */
  weightsMode: "trainer" | "manual";
  globalHorizon: Horizon;
  intervals: Record<Horizon, Interval>;
  pollSeconds: number;
  notifications: boolean;
  sound: boolean;
  /** Schließen bei erstem oder letztem Kursziel */
  closeAtTarget: "first" | "last";
  /** Expertenansicht: Wellenzählung, Fachbegriffe, Detailwerte */
  expertMode: boolean;
  /** Veraltet: automatisches Papiertrading (entfernt, bleibt aus Kompatibilitätsgründen immer false) */
  autoTrade: boolean;
  /** Vibration bei Alarm und Trade-Übernahme */
  haptics: boolean;
  /** Bei jeder Änderung an Trades/Depot automatisch eine Sicherungsdatei auf dem Gerät speichern */
  autoBackupFile: boolean;
  /** Namen der flatex-Depots (der Nutzer hat mehrere getrennte Depots) */
  depotNames: string[];
  /** Zuletzt gewähltes Depot (1-basiert) – Vorauswahl beim Übernehmen */
  lastDepot: number;
  keys: {
    finnhub: string;
    alphavantage: string;
    openfigi: string;
    llm: string;
    llmProvider: "anthropic" | "openai";
    llmModel: string;
  };
}

export interface AppData {
  version: 1;
  watchlist: WatchItem[];
  trades: Trade[];
  settings: Settings;
  /** Letztes Signal je Wert+Horizont (für Alarme) */
  signals: Record<string, { level: SignalLevel; time: number }>;
  /** Bereits ausgeführte Daten-Migrationen */
  migrations: string[];
  /** Hinweis nach der Migration (einmalig anzeigen) */
  migrationNotice?: { removedAuto: number; unverified: number; backupKey: string; at: number } | null;
  /** Blacktrader-Konto: Zeitpunkte, an denen nach einer Pleite neu gestartet wurde (Millisekunden) */
  accountResets: number[];
  /** Buy & Hold: eigene Käufe (Aktien, ETFs) */
  holdings: Holding[];
  /** Live-Bilanz aller Chancen (ab dem ersten Erscheinen mitgeschrieben) */
  chanceLog: ChanceLogEntry[];
  /** Wochenbericht: Stand beim letzten Lesen (Vergleichsbasis) */
  weekly?: { at: number; equity: number; ziel: number; stop: number; bhValue?: number } | null;
}

export const DEFAULT_SETTINGS: Settings = {
  weights: DEFAULT_WEIGHTS,
  weightsMode: "trainer",
  globalHorizon: "medium",
  intervals: { ...HORIZON_DEFAULT_INTERVAL },
  pollSeconds: 30,
  notifications: false,
  sound: true,
  closeAtTarget: "first",
  expertMode: false,
  autoTrade: false,
  haptics: true,
  autoBackupFile: true,
  depotNames: ["Depot 1", "Depot 2", "Depot 3", "Depot 4"],
  lastDepot: 1,
  keys: { finnhub: "", alphavantage: "", openfigi: "", llm: "", llmProvider: "anthropic", llmModel: "" },
};

const DEFAULT_DATA: AppData = { version: 1, watchlist: [], trades: [], settings: DEFAULT_SETTINGS, signals: {}, migrations: [], migrationNotice: null, accountResets: [], holdings: [], chanceLog: [] };
export const BACKUP_PREFIX = "black-ship-trading-analyst:backup:";
const KEY = "black-ship-trading-analyst:v1";

let data: AppData = DEFAULT_DATA;
let loaded = false;
const listeners = new Set<() => void>();

function sanitize(raw: unknown): AppData {
  const d = (raw ?? {}) as Partial<AppData>;
  const s = (d.settings ?? {}) as Partial<Settings>;
  return {
    version: 1,
    watchlist: Array.isArray(d.watchlist) ? d.watchlist.filter((w) => w && w.id && w.symbol) : [],
    // Trades ohne Währung: Währung ableiten. War der Wechselkurs beim Kauf fälschlich 1 (Dollar-Wert als Euro gemerkt),
    // ihn verwerfen – sonst rechnete das Depot einen Währungsverlust ein, den es nie gab.
    trades: Array.isArray(d.trades)
      ? d.trades
          .filter((t) => t && t.id && t.symbol)
          .map((t) => {
            if (t.currency) return t;
            const currency = tradeCurrency(t);
            return currency !== "EUR" && t.fxEntry === 1 ? { ...t, currency, fxEntry: undefined } : { ...t, currency };
          })
      : [],
    signals: d.signals && typeof d.signals === "object" ? d.signals : {},
    migrations: Array.isArray(d.migrations) ? d.migrations : [],
    migrationNotice: d.migrationNotice ?? null,
    accountResets: Array.isArray(d.accountResets) ? d.accountResets.filter((x) => Number.isFinite(x)) : [],
    weekly: d.weekly && typeof d.weekly.at === "number" ? d.weekly : null,
    chanceLog: Array.isArray(d.chanceLog) ? d.chanceLog.filter((x) => x && x.key && x.symbol) : [],
    holdings: Array.isArray(d.holdings) ? d.holdings.filter((h) => h && h.id && h.symbol).map((h) => ({ ...h, txs: Array.isArray(h.txs) ? h.txs.filter((t) => t && t.qty > 0 && t.price > 0) : [] })) : [],
    settings: {
      ...DEFAULT_SETTINGS,
      ...s,
      ...normalizeWeightSettings(s),
      // Kerzen fest wie getestet (Tag mittelfristig, Woche langfristig) – andere Größen (z. B. 1M) ergaben ungeprüfte Einstiege mit absurden Stops
      intervals: { ...DEFAULT_SETTINGS.intervals },
      keys: { ...DEFAULT_SETTINGS.keys, ...(s.keys ?? {}) },
      pollSeconds: Math.min(60, Math.max(15, Number(s.pollSeconds) || DEFAULT_SETTINGS.pollSeconds)),
      autoTrade: false,
      depotNames: Array.from({ length: 4 }, (_, i) => (Array.isArray(s.depotNames) && typeof s.depotNames[i] === "string" && s.depotNames[i].trim() ? s.depotNames[i].trim().slice(0, 24) : `Depot ${i + 1}`)),
      lastDepot: [1, 2, 3, 4].includes(Number(s.lastDepot)) ? Number(s.lastDepot) : 1,
    },
  };
}

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      data = sanitize(JSON.parse(raw));
      migrate(raw);
    }
  } catch {
    data = DEFAULT_DATA;
  }
  window.addEventListener("storage", (e) => {
    if (e.key === KEY && e.newValue) {
      try {
        data = sanitize(JSON.parse(e.newValue));
        listeners.forEach((l) => l());
      } catch {
        /* ignorieren */
      }
    }
  });
}

/**
 * v2: Journal enthält nur noch selbst übernommene Trades.
 * Vorher vollständiges Backup; automatisch erzeugte Kernpositions-Einträge entfernen;
 * Trades mit unklarer Herkunft markieren (Nutzer entscheidet im Journal).
 */
function migrate(rawBefore: string) {
  const backedUp = migrateV2(rawBefore);
  migrateV3(rawBefore, backedUp);
}

/**
 * v3 (Blacktrader-Update): ein Einstieg pro Wert, keine Zeitraum-Umschalter mehr.
 * Daten bleiben unverändert (offene Trades behalten ihren Zeitraum als Info-Label) – vorher JSON-Backup.
 */
function migrateV3(rawBefore: string, alreadyBackedUp: boolean) {
  if (data.migrations.includes("v3-blacktrader")) return;
  try {
    // Ein Backup des Rohstands genügt (bei gleichzeitiger v2-Migration existiert es schon)
    if (!alreadyBackedUp) window.localStorage.setItem(`${BACKUP_PREFIX}${new Date().toISOString()}-vor-blacktrader`, rawBefore);
  } catch {
    /* Speicher voll: Daten werden ohnehin nicht verändert */
  }
  data = { ...data, migrations: [...data.migrations, "v3-blacktrader"] };
  persist();
}

function migrateV2(rawBefore: string): boolean {
  if (data.migrations.includes("v2-manual-journal")) return false;
  const backupKey = `${BACKUP_PREFIX}${new Date().toISOString()}`;
  try {
    window.localStorage.setItem(backupKey, rawBefore);
  } catch {
    /* Speicher voll: Migration trotzdem, Hinweis zeigt fehlendes Backup */
  }
  const auto = data.trades.filter((t) => t.strategy === "core" && t.source !== "manual");
  const rest = data.trades.filter((t) => !(t.strategy === "core" && t.source !== "manual"));
  const unverified = rest.filter((t) => t.source !== "manual");
  data = {
    ...data,
    trades: rest.map((t) => (t.source === "manual" ? t : { ...t, unverified: true })),
    settings: { ...data.settings, autoTrade: false },
    migrations: [...data.migrations, "v2-manual-journal"],
    migrationNotice: auto.length || unverified.length ? { removedAuto: auto.length, unverified: unverified.length, backupKey, at: Date.now() } : null,
  };
  persist();
  return true;
}

export function listBackups(): { key: string; date: string }[] {
  const out: { key: string; date: string }[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)!;
      if (k.startsWith(BACKUP_PREFIX)) out.push({ key: k, date: k.slice(BACKUP_PREFIX.length) });
    }
  } catch {
    /* nicht verfügbar */
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export function readBackup(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function persist() {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* Speicher voll oder gesperrt */
  }
}

export function getData(): AppData {
  load();
  return data;
}

export function update(fn: (d: AppData) => AppData) {
  load();
  data = fn(data);
  persist();
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  load();
  listeners.add(l);
  return () => listeners.delete(l);
}
/** Änderungen am Datenstand beobachten (z. B. automatische Sicherung) */
export const subscribeData = subscribe;

/** Selektor-Hook. Das Ergebnis wird je Datenstand gecacht, damit abgeleitete Arrays stabil bleiben. */
export function useAppData<T>(selector: (d: AppData) => T): T {
  const memo = useRef<{ src: AppData; value: T } | null>(null);
  const select = (src: AppData) => {
    if (memo.current && memo.current.src === src) return memo.current.value;
    const value = selector(src);
    memo.current = { src, value };
    return value;
  };
  return useSyncExternalStore(
    subscribe,
    () => select(getData()),
    () => select(DEFAULT_DATA),
  );
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// --- Aktionen
export const actions = {
  addWatch(asset: ResolvedAsset) {
    update((d) => {
      if (d.watchlist.some((w) => w.kind === asset.kind && w.symbol === asset.symbol)) return d;
      return { ...d, watchlist: [...d.watchlist, { ...asset, id: uid(), addedAt: Date.now() }] };
    });
  },
  removeWatch(id: string) {
    update((d) => ({ ...d, watchlist: d.watchlist.filter((w) => w.id !== id) }));
  },
  setItemHorizon(id: string, horizon: Horizon | undefined) {
    update((d) => ({ ...d, watchlist: d.watchlist.map((w) => (w.id === id ? { ...w, horizon } : w)) }));
  },
  setSettings(patch: Partial<Settings>) {
    update((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  },
  setKeys(patch: Partial<Settings["keys"]>) {
    update((d) => ({ ...d, settings: { ...d.settings, keys: { ...d.settings.keys, ...patch } } }));
  },
  /** Nur für selbst übernommene Trades (source = manual). */
  addTrade(t: Omit<Trade, "id" | "status"> & { status?: Trade["status"] }) {
    // Wechselkurs beim Kauf merken – Ergebnisse werden in Euro gerechnet
    // Ohne Angabe: Währung aus Symbol und Art ableiten (sonst würde ein Dollar-Wert mit Kurs 1 als Euro gemerkt)
    const currency = t.currency ?? tradeCurrency(t);
    const fxEntry = t.fxEntry ?? eurPerUnit(currency) ?? undefined;
    // Im Depot → aus der Watchlist nehmen (Wunsch des Nutzers); Kurse und Meldungen laufen über den Trade weiter
    update((d) => ({ ...d, watchlist: d.watchlist.filter((w) => !(w.kind === t.kind && w.symbol === t.symbol)), trades: [...d.trades, { ...t, depot: t.depot ?? d.settings.lastDepot ?? 1, currency, fxEntry, id: uid(), status: t.status ?? "open", source: "manual" }] }));
  },
  /** Werte, die offen im Depot liegen, aus der Watchlist nehmen (einmalig für ältere Daten) */
  pruneWatchHeld() {
    update((d) => {
      const held = new Set(d.trades.filter((t) => t.status !== "closed").map((t) => `${t.kind}:${t.symbol}`));
      const watchlist = d.watchlist.filter((w) => !held.has(`${w.kind}:${w.symbol}`));
      return watchlist.length === d.watchlist.length ? d : { ...d, watchlist };
    });
  },
  /** Einmalige Umstellung als erledigt merken */
  addMigration(key: string) {
    update((d) => (d.migrations.includes(key) ? d : { ...d, migrations: [...d.migrations, key] }));
  },
  updateTrade(id: string, patch: Partial<Trade>) {
    update((d) => ({ ...d, trades: d.trades.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  },
  /** Entscheidung zu Trades mit unklarer Herkunft */
  resolveUnverified(keep: boolean) {
    update((d) => ({
      ...d,
      trades: keep ? d.trades.map((t) => (t.unverified ? { ...t, unverified: false, source: "manual" as const } : t)) : d.trades.filter((t) => !t.unverified),
      migrationNotice: d.migrationNotice ? { ...d.migrationNotice, unverified: 0 } : null,
    }));
  },
  dismissMigrationNotice() {
    update((d) => ({ ...d, migrationNotice: null }));
  },
  restoreBackup(key: string) {
    const raw = readBackup(key);
    if (!raw) throw new Error("Backup nicht gefunden");
    const parsed = sanitize(JSON.parse(raw));
    // Wiederhergestellt: Trades gelten als selbst übernommen, Migration nicht erneut ausführen
    update(() => ({ ...parsed, trades: parsed.trades.map((t) => ({ ...t, source: "manual" as const, unverified: false })), migrations: [...new Set([...parsed.migrations, "v2-manual-journal", "v3-blacktrader"])], migrationNotice: null }));
  },
  setWeekly(w: AppData["weekly"]) {
    update((d) => ({ ...d, weekly: w }));
  },
  setChanceLog(log: ChanceLogEntry[]) {
    update((d) => ({ ...d, chanceLog: log }));
  },
  /** Blacktrader-Konto nach einer Pleite mit 8.000 € neu starten (alte Trades bleiben als frühere Runde) */
  resetAccount() {
    update((d) => ({ ...d, accountResets: [...d.accountResets, Date.now()] }));
  },
  addHolding(h: Omit<Holding, "id" | "txs">, tx: Omit<HoldingTx, "id">) {
    update((d) => {
      const found = d.holdings.find((x) => x.kind === h.kind && x.symbol === h.symbol);
      const t = { ...tx, id: uid() };
      return found
        ? { ...d, holdings: d.holdings.map((x) => (x === found ? { ...x, txs: [...x.txs, t] } : x)) }
        : { ...d, holdings: [...d.holdings, { ...h, id: uid(), txs: [t] }] };
    });
  },
  addHoldingTx(id: string, tx: Omit<HoldingTx, "id">) {
    update((d) => ({ ...d, holdings: d.holdings.map((x) => (x.id === id ? { ...x, txs: [...x.txs, { ...tx, id: uid() }] } : x)) }));
  },
  removeHoldingTx(id: string, txId: string) {
    update((d) => ({ ...d, holdings: d.holdings.map((x) => (x.id === id ? { ...x, txs: x.txs.filter((t) => t.id !== txId) } : x)).filter((x) => x.txs.length > 0) }));
  },
  setHoldingTrend(id: string, trend: 1 | -1 | 0) {
    update((d) => ({ ...d, holdings: d.holdings.map((x) => (x.id === id ? { ...x, trend } : x)) }));
  },
  /** Blacktrader-Depot leeren: alle Trades weg, Konto startet wieder mit 8.000 € (Gelerntes bleibt – liegt woanders) */
  clearTrades() {
    update((d) => ({ ...d, trades: [], accountResets: [] }));
  },
  /** Buy & Hold leeren */
  clearHoldings() {
    update((d) => ({ ...d, holdings: [] }));
  },
  removeHolding(id: string) {
    update((d) => ({ ...d, holdings: d.holdings.filter((x) => x.id !== id) }));
  },
  removeTrade(id: string) {
    update((d) => ({ ...d, trades: d.trades.filter((t) => t.id !== id) }));
  },
  setSignal(key: string, level: SignalLevel) {
    update((d) => ({ ...d, signals: { ...d.signals, [key]: { level, time: Date.now() } } }));
  },
  exportJson(includeKeys = false): string {
    const d = getData();
    const out = includeKeys ? d : { ...d, settings: { ...d.settings, keys: { ...DEFAULT_SETTINGS.keys, llmProvider: d.settings.keys.llmProvider } } };
    // Auch den Einstiegs-Verlauf (alte/graue Einstiege) mitsichern
    return JSON.stringify({ app: "black-ship-trading-analyst", exportedAt: new Date().toISOString(), ...out, entryHistory: allHistories() }, null, 2);
  },
  importJson(json: string, keepKeys = true) {
    const raw = JSON.parse(json);
    const parsed = sanitize(raw);
    if (raw && typeof raw.entryHistory === "object" && raw.entryHistory) restoreHistories(raw.entryHistory);
    update((d) => ({ ...parsed, settings: keepKeys && !parsed.settings.keys.llm && !parsed.settings.keys.finnhub ? { ...parsed.settings, keys: d.settings.keys } : parsed.settings }));
  },
  reset() {
    update(() => DEFAULT_DATA);
  },
};

/** Gewichtung immer in den festen Grenzen (Elliott ≥ 60 %, andere ≥ 10 %, Summe 100 %). Alte eigene Werte bleiben als "manuell". */
function normalizeWeightSettings(s: Partial<Settings>): Pick<Settings, "weights" | "weightsMode"> {
  const w = { ...DEFAULT_SETTINGS.weights, ...(s.weights ?? {}) };
  const custom = w.elliott !== DEFAULT_WEIGHTS.elliott || w.fundamental !== DEFAULT_WEIGHTS.fundamental || w.volume !== DEFAULT_WEIGHTS.volume;
  const mode = s.weightsMode ?? (custom ? "manual" : "trainer");
  const sum = w.elliott + w.fundamental + w.volume || 100;
  const scaled = { elliott: (w.elliott / sum) * 100, fundamental: (w.fundamental / sum) * 100, volume: (w.volume / sum) * 100 };
  return { weightsMode: mode, weights: validateWeights(w).length ? clampWeights(scaled, "elliott") : w };
}
