"use client";
// Messung der neuen Variante in der Live-Bilanz (Nutzer 14.11.2026). Läuft nach jeder normalen Suche, mit DENSELBEN Kerzen und demselben
// Suchsystem wie die Chancen (technische Analyse → Top 40 mit Firmenzahlen/Nachrichten → Finanz-Prüfung → Chancen-Regeln → Top 20),
// aber mit den Einstellungen des Kandidaten. Es wird nichts gehandelt und die Chancen-Liste bleibt unverändert.
import { analyze } from "../analysis/analyze";
import { financeCheck } from "../analysis/finance";
import { findLongTermZone } from "../analysis/longterm";
import { pickBestEntry, type MarketContext } from "../analysis/bestEntry";
import { resolveParams } from "../analysis/params";
import { money } from "../analysis/persona";
import type { Candle, Horizon, ResolvedAsset } from "../types";
import { api } from "./api";
import { notify } from "./alerts";
import { updateChanceLog, type ChanceCandidate } from "./chanceLog";
import { inMarket } from "./marketList";
import { isChance, isTopChance, potential, type ScanEntry } from "./scanner";
import { assetKey } from "./entries";
import { trainerParamSet } from "./trainerParams";
import { doneCount, getTrial, markNotified, overlayParams, TRIAL_TARGET } from "./trialState";
import { getData } from "../store/store";

export interface ScanItem {
  asset: ResolvedAsset;
  full: Partial<Record<Horizon, Candle[]>>;
}

async function pool<T>(items: T[], limit: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => { while (i < items.length) await fn(items[i++]); }));
}

/** Nach jeder normalen Suche aufrufen: misst die Chancen des Kandidaten und trägt sie in die (zurückgesetzte) Live-Bilanz ein */
export async function afterScan(items: ScanItem[], ctx: MarketContext): Promise<void> {
  const trial = getTrial();
  if (!trial) return;
  const { settings } = getData();
  const set = overlayParams(trainerParamSet().params);
  const P = (kind: ResolvedAsset["kind"], h: Horizon) => resolveParams(set, kind, h);
  const entries: ScanEntry[] = [];
  const fullOf = new Map<string, Partial<Record<Horizon, Candle[]>>>();
  for (const it of items) {
    if (!inMarket(it.asset)) continue;
    const a = it.asset;
    const horizons: ScanEntry["horizons"] = {};
    for (const h of ["short", "medium", "long"] as Horizon[]) {
      const c = it.full[h];
      if (!c || c.length < 30) continue;
      const p = P(a.kind, h);
      const res = analyze({ symbol: a.symbol, name: a.name, candles: c, horizon: h, interval: settings.intervals[h], weights: p.weights, kind: a.kind, currency: a.currency, params: p });
      if (res) horizons[h] = { res, candles: c.slice(-150) };
    }
    const wk = it.full.long;
    const z = wk && wk.length >= 150 ? findLongTermZone(wk) : null;
    const lt = z && z.status !== "invalidiert" ? z : null;
    const best = pickBestEntry({ symbol: a.symbol, kind: a.kind, views: Object.fromEntries(Object.entries(horizons).map(([h, v]) => [h, v?.res ?? null])), lt, ctx, done: new Set(), fmt: (n) => money(n, a.currency) });
    entries.push({ asset: a, horizons, longterm: lt, ltHorizon: "long", ltCandles: lt && wk ? wk.slice(-150) : undefined, best, history: { past: [] }, daily: it.full.medium } as unknown as ScanEntry);
    fullOf.set(assetKey(a), it.full);
  }
  // 2. Schritt: die 40 aussichtsreichsten Werte mit Firmenzahlen und Nachrichten vollständig bewerten
  const ranked = entries
    .map((e) => ({ e, p: potential(e) }))
    .filter((x) => x.p != null)
    .sort((a, b) => b.p!.score - a.p!.score)
    .slice(0, 40)
    .map((x) => x.e);
  const finance = new Map<string, boolean>();
  await pool(ranked, 6, async (e) => {
    const a = e.asset;
    const [fr, nr] = await Promise.allSettled([Promise.resolve().then(() => api.fundamentals(a)), Promise.resolve().then(() => api.news(a))]);
    const fundamentals = fr.status === "fulfilled" ? fr.value.fundamentals : null;
    const news = nr.status === "fulfilled" ? nr.value.news : [];
    for (const h of ["short", "medium", "long"] as Horizon[]) {
      const v = e.horizons[h];
      const c = fullOf.get(assetKey(a))?.[h];
      if (!v || !c || v.res.decision.level === "neutral") continue;
      const p = P(a.kind, h);
      const r = analyze({ symbol: a.symbol, name: a.name, candles: c, horizon: h, interval: settings.intervals[h], weights: p.weights, kind: a.kind, currency: a.currency, params: p, fundamentals, news });
      if (r) e.horizons[h] = { res: r, candles: c.slice(-150) };
    }
    e.best = pickBestEntry({ symbol: a.symbol, kind: a.kind, views: Object.fromEntries(Object.entries(e.horizons).map(([h, v]) => [h, v?.res ?? null])), lt: e.longterm, ctx, done: new Set(), fmt: (n) => money(n, a.currency) });
    if (a.kind === "stock") finance.set(assetKey(a), financeCheck(fundamentals).weak);
  });
  for (const e of entries) if (finance.get(assetKey(e.asset))) e.financeWeak = true;
  // Chancen wie in der Liste: höchstens 20, nach Potenzial
  const top = entries
    .filter((e) => isChance(e) && isTopChance(e))
    .map((e) => ({ e, p: potential(e) }))
    .filter((x) => x.p != null)
    .sort((a, b) => b.p!.score - a.p!.score)
    .slice(0, 20)
    .map((x) => x.e);
  const inTop = new Set(top.map((e) => assetKey(e.asset)));
  const cands: ChanceCandidate[] = [];
  for (const e of entries) {
    const b = e.best;
    if (b.color === "gelb" || b.color === "rot" || b.zoneTop == null || b.zoneBottom == null) continue;
    const blue = b.color === "blau";
    const candles = blue ? e.ltCandles ?? [] : b.horizon ? e.horizons[b.horizon]?.candles ?? [] : [];
    const stop = blue ? b.invalidation : b.stop;
    const target = b.targets?.[0];
    if (stop == null || target == null) continue;
    cands.push({ key: `${assetKey(e.asset)}|${b.key}${inTop.has(assetKey(e.asset)) ? "" : "|nur-pruefen"}`, symbol: e.asset.symbol, name: e.asset.name, kind: e.asset.kind, color: b.color, dir: "long", zoneTop: b.zoneTop, zoneBottom: b.zoneBottom, stop, target, candles });
  }
  updateChanceLog(cands.filter((c) => !c.key.endsWith("|nur-pruefen")), undefined, cands);
  // 100 Ergebnisse erreicht → einmal melden (die Frage stellt die Live-Bilanz)
  const t = getTrial();
  if (t && !t.notified && doneCount(getData().chanceLog) >= TRIAL_TARGET) {
    markNotified();
    void notify("Neue Variante: 100 Ergebnisse", "Die neue Variante hat 100 Ergebnisse in der Live-Bilanz. Bitte dort entscheiden: übernehmen?", { sound: settings.sound, notifications: settings.notifications, kind: "info" });
  }
}
