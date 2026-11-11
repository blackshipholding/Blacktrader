"use client";
// EchoChart: Hätte Blacktrader früher richtig gelegen? Einfach gehalten – eine große Zahl, ein Bild, Details zum Aufklappen.
import { useMemo, useState } from "react";
import { ZoneHistoryChart } from "@/components/ZoneHistoryChart";
import { runEcho, summarize, type EchoKind, type EchoZone } from "@/lib/analysis/echoZones";
import { fmtPrice } from "@/lib/analysis/persona";
import { INTERVAL_SECONDS, LOOKBACKS, loadHistory, planHistory, YAHOO_MAX_DAYS } from "@/lib/client/history";
import { SCAN_GROUPS } from "@/lib/client/presets";
import { learnedParams } from "@/lib/client/trainerParams";
import { useAppData } from "@/lib/store/store";
import { ACCOUNT, simulateAccount, type SimTrade } from "@/lib/client/account";
import { blueTrade, greenRedTrade, makeTechWeakAt, suppressedBy, type ActiveIntervals } from "@/lib/analysis/tradeRules";
import { regimeIndex } from "@/lib/trainer/tournament";
import { type AssetKind, type Candle, type ResolvedAsset } from "@/lib/types";

const fmtDate = (t: number) => new Date(t * 1000).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
const pct = (x: number) => `${Math.round(x * 100)} %`;
const eurFmt = (x: number) => `${x.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const KIND_TEXT: Record<EchoKind, string> = { trade: "Kauf", short: "Short", core: "Langfristig" };
const KIND_CLS: Record<EchoKind, string> = { trade: "text-emerald-300", short: "text-red-300", core: "text-sky-300" };
const GROUP_KEYS: Record<string, AssetKind> = { "gruppe:stock": "stock", "gruppe:crypto": "crypto", "gruppe:commodity": "commodity" };

interface AssetResult {
  asset: ResolvedAsset;
  zones: EchoZone[];
  candles: Candle[];
  tradeHit: number | null;
  tradeReturn: number | null;
  trades: number;
  /** Trades für die Kontorechnung (8.000 €, 500 € je Trade) */
  sim: SimTrade[];
  error?: string;
}

export default function EchoChartPage() {
  const watchlist = useAppData((d) => d.watchlist);
  const [key, setKey] = useState<string>("");
  const [days, setDays] = useState(365);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ label: string; p: number } | null>(null);
  const [results, setResults] = useState<AssetResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Wie in den Chancen: Tages- und Wochenkerzen laufen im Hintergrund – geprüft wird, ob der Zeitraum mit Tageskerzen geht
  const interval = "1d" as const;

  const options = useMemo(() => {
    const groups: { title: string; assets: ResolvedAsset[] }[] = [];
    if (watchlist.length) groups.push({ title: "Meine Watchlist", assets: watchlist });
    for (const g of SCAN_GROUPS) groups.push({ title: g.title, assets: g.assets });
    return groups;
  }, [watchlist]);
  const all = options.flatMap((g) => g.assets);
  const groupKind = GROUP_KEYS[key];
  const targets: ResolvedAsset[] = groupKind ? SCAN_GROUPS.find((g) => g.kind === groupKind)!.assets : [all.find((a) => `${a.kind}:${a.symbol}` === key) ?? all[0]].filter(Boolean);
  const label = groupKind ? `Alle ${SCAN_GROUPS.find((g) => g.kind === groupKind)!.title}` : targets[0]?.name ?? "";
  const plan = targets[0] ? planHistory(targets[0], interval, days) : null;

  const reset = () => {
    setResults(null);
    setError(null);
  };

  const run = async () => {
    if (!targets.length || !plan?.ok) return;
    setBusy(true);
    reset();
    const out: AssetResult[] = [];
    // Marktlage für die Regeln (Shorts nur im Bärenmarkt, Sektor-Regel): S&P 500 und NASDAQ 100, Tageskerzen
    setProgress({ label: "Marktlage laden (S&P 500, NASDAQ 100)", p: 0 });
    const ctxDays = days + 420;
    const idx = async (sym: string) => {
      try {
        const pl = planHistory({ kind: "stock", yahooSymbol: sym }, "1d", ctxDays);
        return pl.ok ? await loadHistory(pl, "1d", ctxDays) : null;
      } catch {
        return null;
      }
    };
    const [spx, ndx] = await Promise.all([idx("^GSPC"), idx("^NDX")]);
    const regimeAt = spx && spx.length > 250 ? regimeIndex(spx) : () => null;
    const techWeakAt = makeTechWeakAt(ndx);
    for (const [i, a] of targets.entries()) {
      const step = (p: number, what: string) => setProgress({ label: targets.length > 1 ? `${a.name} (${i + 1} von ${targets.length}) – ${what}` : what, p: (i + p) / targets.length });
      try {
        // Wie in den Chancen: Tages- und Wochenkerzen im Hintergrund, pro Wert immer nur ein Signal (das wichtigste).
        // Vorlauf automatisch dazuladen: Blacktrader braucht ca. 200 Kerzen, um die Wellen zu zählen.
        const periodStart = Date.now() / 1000 - days * 86400;
        const loadSeries = async (iv: "1d" | "1w", share: [number, number]) => {
          let loadDays = days + Math.ceil((220 * INTERVAL_SECONDS[iv]) / 86400);
          let pl = planHistory(a, iv, loadDays);
          if (!pl.ok && YAHOO_MAX_DAYS[iv] < loadDays) {
            loadDays = Math.max(days, YAHOO_MAX_DAYS[iv]);
            pl = planHistory(a, iv, loadDays);
          }
          if (!pl.ok) return null;
          return loadHistory(pl, iv, loadDays, (p) => step(share[0] + p * (share[1] - share[0]), "Kurse laden"));
        };
        step(0, "Kurse laden");
        const [dc, wc] = await Promise.all([loadSeries("1d", [0, 0.15]), loadSeries("1w", [0.15, 0.3])]);
        if ((!dc || dc.length < 200) && (!wc || wc.length < 200))
          throw new Error(`Zu kurze Kursgeschichte: ${a.name} hat zu wenige Kerzen – Blacktrader braucht etwa 200, um die Wellen zu zählen. Tipp: einen kürzeren Zeitraum wählen.`);
        const rd = dc && dc.length >= 200 ? await runEcho(dc, { kind: a.kind, horizon: "medium", interval: "1d", params: learnedParams(a.kind, "medium") }, (p) => step(0.3 + p * 0.4, "Blacktrader spielt die Vergangenheit durch (Tageskerzen)")) : null;
        const rw = wc && wc.length >= 200 ? await runEcho(wc, { kind: a.kind, horizon: "long", interval: "1w", params: learnedParams(a.kind, "long") }, (p) => step(0.7 + p * 0.3, "Blacktrader spielt die Vergangenheit durch (Wochenkerzen)")) : null;
        // Aktive Signale je Quelle (für „ein Signal wie in den Chancen“)
        const active: ActiveIntervals = {
          blau: (rw?.ltTrades ?? []).map((x) => [x.entryTime, x.exitTime]),
          "1d": (rd?.zones ?? []).filter((z) => z.kind !== "core").map((z) => [z.t, z.at]),
          "1w": (rw?.zones ?? []).filter((z) => z.kind !== "core").map((z) => [z.t, z.at]),
        };
        // Gleiche Regeln wie Chancen und Turnier: Grün/Rot (Sektor-Regel, Short nur im Bärenmarkt, Chance ≥ 15 %,
        // obere Hälfte nach Potenzial) und Blau (Blau-Regel)
        const ctx = { symbol: a.symbol, techWeakAt, regimeAt };
        const gr = ([["1d", rd], ["1w", rw]] as const).flatMap(([src, r]) =>
          (r?.trades.trades ?? []).filter((x) => x.entryTime >= periodStart && !suppressedBy(a.kind, src, x.entryTime, active) && greenRedTrade(x, ctx)),
        );
        const bl = (rw?.ltTrades ?? []).filter((x) => x.entryTime >= periodStart && x.result !== "offen" && blueTrade(x).ok);
        const t = [...gr.map((x) => ({ entryTime: x.entryTime, exitTime: x.exitTime, returnPct: x.returnPct, blue: false })), ...bl.map((x) => ({ entryTime: x.entryTime, exitTime: x.exitTime, returnPct: x.returnPct, blue: true }))];
        const zones = [...(rd?.zones ?? []).filter((z) => z.kind !== "core"), ...(rw?.zones ?? [])].filter((z) => z.t >= periodStart).sort((x, y) => x.t - y.t);
        const chartCandles = (dc && dc.length >= 200 ? dc : wc!).filter((c) => c.time >= periodStart);
        out.push({
          asset: a,
          zones,
          candles: chartCandles,
          trades: t.length,
          tradeHit: t.length ? t.filter((x) => x.returnPct > 0).length / t.length : null,
          tradeReturn: t.length ? (t.reduce((e, x) => e * (1 + x.returnPct / 100), 1) - 1) * 100 : null,
          sim: t.map((x) => ({ sym: a.symbol, entry: x.entryTime * 1000, exit: x.exitTime * 1000, r: x.returnPct, blue: x.blue })),
        });
      } catch (e) {
        out.push({ asset: a, zones: [], candles: [], trades: 0, tradeHit: null, tradeReturn: null, sim: [], error: (e as Error).message });
      }
    }
    setResults(out);
    setProgress(null);
    setBusy(false);
    if (out.every((r) => r.error)) setError(out[0]?.error ?? "Keine Daten");
    // Ergebnis still für den Trainer aufbewahren
    const zs = out.flatMap((r) => r.zones.map((z) => ({ symbol: r.asset.symbol, ...z })));
    void fetch("/api/trainer/echo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label, horizon: "tag+woche", interval, days, summary: summarize(zs), zones: zs }) }).catch(() => {});
  };

  const allZones = results?.flatMap((r) => r.zones) ?? [];
  const sum = summarize(allZones);
  const single = results && results.length === 1 ? results[0] : null;
  const tradesAll = results?.reduce((s, r) => s + r.trades, 0) ?? 0;
  const tradeHit = results && tradesAll ? results.reduce((s, r) => s + (r.tradeHit ?? 0) * r.trades, 0) / tradesAll : null;
  // Konto wie im Depot: 8.000 € Start, 500 € je Trade, Gebühren und KESt – Ergebnis netto
  const acc = results && tradesAll ? simulateAccount(results.flatMap((r) => r.sim)) : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] text-gold">EchoChart</h1>
        <p className="text-[15px] text-stone-300">Hätte Blacktrader früher richtig gelegen? Wähle einen Wert oder eine ganze Gruppe.</p>
      </div>

      <section className="card space-y-3 p-4">
        <select
          className="input"
          value={key || (all[0] ? `${all[0].kind}:${all[0].symbol}` : "")}
          onChange={(e) => {
            setKey(e.target.value);
            reset();
          }}
        >
          <optgroup label="Ganze Gruppe">
            {SCAN_GROUPS.map((g) => (
              <option key={g.kind} value={`gruppe:${g.kind}`}>
                Alle {g.title} ({g.assets.length})
              </option>
            ))}
          </optgroup>
          {options.map((g) => (
            <optgroup key={g.title} label={g.title}>
              {g.assets.map((a) => (
                <option key={`${g.title}-${a.kind}:${a.symbol}`} value={`${a.kind}:${a.symbol}`}>
                  {a.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <div>
          <div className="label mb-1">Wie weit zurück?</div>
          <div className="flex flex-wrap gap-1.5">
            {LOOKBACKS.map((l) => {
              const ok = targets[0] ? planHistory(targets[0], interval, l.days).ok : false;
              return (
                <button
                  key={l.days}
                  disabled={!ok}
                  onClick={() => {
                    setDays(l.days);
                    reset();
                  }}
                  className={`chip ${l.days === days ? "border-gold bg-gold/20 text-gold-light" : ok ? "border-stone-700 text-stone-300" : "border-stone-800 text-stone-600"}`}
                >
                  {l.label}
                </button>
              );
            })}
          </div>
        </div>
        {plan && !plan.ok && <p className="text-[14px] text-amber-300">{plan.reason}</p>}
        <button className="btn-primary min-h-[48px] w-full" disabled={busy || !plan?.ok} onClick={run}>
          {busy ? "Läuft …" : "Prüfen"}
        </button>
        {progress && (
          <div className="space-y-1">
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gold transition-all" style={{ width: `${Math.round(progress.p * 100)}%` }} />
            </div>
            <p className="text-[13px] text-stone-400">{progress.label}</p>
          </div>
        )}
      </section>

      {error && <p className="text-[15px] text-red-300">{error}</p>}

      {results && !error && (
        <section className="card space-y-3 p-4">
          <div className="text-center">
            <div className="text-[14px] text-stone-400">
              {label} · Tag, Woche und Blau (ein Signal wie in den Chancen)
            </div>
            <div className={`num text-[44px] font-semibold leading-tight ${sum.rate != null && sum.rate >= 0.7 ? "text-up" : "text-gold"}`}>{sum.rate != null ? pct(sum.rate) : "–"}</div>
            <p className="text-[15px] text-stone-200">{sum.zones ? `Von ${sum.zones} Zonen haben ${sum.held} gehalten.` : "In diesem Zeitraum gab es keine Zone."}</p>
          </div>
          {sum.zones > 0 && (
            <div className="grid grid-cols-3 gap-2 text-center text-[13px]">
              {(["trade", "short", "core"] as EchoKind[]).map((k) => (
                <div key={k} className="rounded-xl bg-white/5 px-1 py-2">
                  <div className={KIND_CLS[k]}>{KIND_TEXT[k]}</div>
                  <div className="num text-stone-200">{sum.byKind[k].zones ? `${sum.byKind[k].held} / ${sum.byKind[k].zones}` : "–"}</div>
                </div>
              ))}
            </div>
          )}
          {single && single.candles.length > 0 && <ZoneHistoryChart candles={single.candles} zones={single.zones} />}
          {tradeHit != null && (
            <p className="text-center text-[13px] text-stone-400">
              Trades nach allen Regeln (Grün, Rot, Blau): {pct(tradeHit)} im Gewinn{single?.tradeReturn != null ? ` · Ergebnis ${single.tradeReturn >= 0 ? "+" : ""}${single.tradeReturn.toFixed(1).replace(".", ",")} %` : ""}
            </p>
          )}

          {!acc && (
            <p className="rounded-xl border border-gold/30 bg-black/30 p-3 text-center text-[14px] text-stone-300">
              Nach den Regeln (wie in den Chancen) gab es hier keinen Trade – das Konto wäre bei {ACCOUNT.start.toLocaleString("de-DE")} € geblieben.
            </p>
          )}
          {acc && (
            <div className="rounded-xl border border-gold/30 bg-black/30 p-3 text-center">
              <div className="text-[14px] text-stone-300">Mit {ACCOUNT.start.toLocaleString("de-DE")} € und {ACCOUNT.stake} € je Trade (netto)</div>
              <div className={`num text-[30px] font-semibold leading-tight ${acc.profit >= 0 ? "text-up" : "text-down"}`}>
                {acc.profitPct >= 0 ? "+" : ""}
                {acc.profitPct.toFixed(1).replace(".", ",")} %
              </div>
              <div className="num text-[16px] text-stone-100">
                {eurFmt(acc.start)} → <b>{eurFmt(acc.end)}</b> ({acc.profit >= 0 ? "+" : "−"}
                {eurFmt(Math.abs(acc.profit))})
              </div>
              <div className="num mt-1 text-[13px] text-stone-400">
                {acc.taken} Trades · Gebühren {eurFmt(acc.fees)} · KESt {eurFmt(acc.tax)}
                {acc.skipped ? ` · ${acc.skipped} ausgelassen (kein Geld frei oder Wert schon im Depot)` : ""}
                {acc.broke ? " · Konto war leer" : ""}
              </div>
            </div>
          )}

          {!single && (
            <ul className="divide-y divide-white/5 text-[14px]">
              {[...results]
                .sort((a, b) => (summarize(b.zones).rate ?? -1) - (summarize(a.zones).rate ?? -1))
                .map((r) => {
                  const s = summarize(r.zones);
                  return (
                    <li key={r.asset.symbol} className="flex items-center justify-between gap-2 py-2">
                      <span className="text-stone-200">{r.asset.name}</span>
                      <span className="num text-stone-400">{r.error ? (r.error.startsWith("Zu kurze") ? "zu kurze Kursgeschichte" : "keine Daten") : s.zones ? `${s.held}/${s.zones} · ${pct(s.rate!)}` : "keine Zone"}</span>
                    </li>
                  );
                })}
            </ul>
          )}

          {allZones.length > 0 && (
            <details className="text-[14px]">
              <summary className="cursor-pointer text-gold-light">Alle Zonen anzeigen</summary>
              <ul className="mt-2 divide-y divide-white/5">
                {[...(single ? single.zones.map((z) => ({ z, name: "" })) : results.flatMap((r) => r.zones.map((z) => ({ z, name: r.asset.name }))))]
                  .sort((a, b) => b.z.t - a.z.t)
                  .slice(0, 150)
                  .map(({ z, name }, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 py-1.5">
                      <span className="min-w-0">
                        <span className="text-stone-400">{fmtDate(z.t)}</span> <span className={KIND_CLS[z.kind]}>{KIND_TEXT[z.kind]}</span>
                        {name && <span className="text-stone-400"> · {name}</span>}
                        <span className="num block text-[13px] text-stone-500">
                          {fmtPrice(z.top)} – {fmtPrice(z.bottom)}
                        </span>
                      </span>
                      <span className={`shrink-0 font-semibold ${z.ok ? "text-up" : "text-down"}`}>{z.ok ? "✓ gehalten" : "✗ gescheitert"}</span>
                    </li>
                  ))}
              </ul>
            </details>
          )}

          <details className="text-[13px] text-stone-400">
            <summary className="cursor-pointer">Wie wird gezählt?</summary>
            <p className="mt-1">
              Trades und Konto nach denselben Regeln wie Chancen und Turnier: Shorts nur bei bärischem Gesamtmarkt, Sektor-Regel für Tech-Werte, Chance bis zum Ziel mindestens 15 %, nur die obere Hälfte nach Potenzial, Blau mit Blau-Regel. Die Zonen-Quote oben zählt dagegen alle Zonen (Qualität der Zonen).{" "}
              Konto: {ACCOUNT.start.toLocaleString("de-DE")} € Start, {ACCOUNT.stake} € je Trade (nur wenn genug Geld frei ist, je Wert eine Position), 7,90 € Gebühr je Order, 27,5 % KESt sofort auf Gewinne mit Verlustausgleich im selben Jahr – alles netto. Wechselkurs-Schwankungen sind hier nicht eingerechnet.{" "}
              Wie bei HKCM: Eine Zone hat gehalten, wenn der Kurs hineinläuft, vor der Unterkante dreht und oben wieder herausläuft (bei Short umgekehrt). Fällt er vorher unter die Unterkante, ist sie gescheitert. Zonen, die der Kurs nie erreicht hat, zählen nicht. Blacktrader kennt dabei immer nur die Kurse bis zum jeweiligen Tag. Gute Ergebnisse von früher sind keine Garantie für die Zukunft.
            </p>
          </details>
        </section>
      )}
    </div>
  );
}
