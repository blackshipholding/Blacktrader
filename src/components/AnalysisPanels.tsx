"use client";
import { ScenarioBar } from "./ScenarioBar";
import { useState } from "react";
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AnalysisResult } from "@/lib/analysis/analyze";
import type { WaveCount } from "@/lib/analysis/elliott";
import { compactNumber } from "@/lib/analysis/fundamental";
import { fmtPrice, money } from "@/lib/analysis/persona";
import { longTermText, type LongTermZone } from "@/lib/analysis/longterm";
import { longTermScore } from "@/lib/analysis/longtermScore";
import { SIGNAL_LABEL } from "@/lib/analysis/score";
import { api } from "@/lib/client/api";
import { useAppData } from "@/lib/store/store";
import type { Fundamentals, NewsItem } from "@/lib/types";
import { ScoreBar, SignalBadge } from "./ui";

/**
 * Punkte-System passend zum Hauptszenario (Blau hat eigene Punkte: LongTermSignalCard):
 *  Grün = Trading-Kauf (Punkte wie berechnet, über 50 = guter Kauf)
 *  Rot  = Short (Punkte umgedreht: 100 − Wert, über 50 = guter Short)
 *  Gelb = Abwarten (neutral, kein Einstieg, kein Order-Knopf)
 */
export function SignalCard({ a, onTrade, shortAllowed = true, main }: { a: AnalysisResult; onTrade?: () => void; shortAllowed?: boolean; main?: "gruen" | "rot" | "gelb" }) {
  const w = a.weights;
  const sum = w.elliott + w.fundamental + w.volume || 1;
  const expert = useAppData((d) => d.settings.expertMode);
  // Kauf (grün) oder Short (rot); sonst Abwarten – das Hauptszenario von Blacktrader hat Vorrang
  const hasSignal = !!a.plan && a.decision.level !== "neutral";
  const mode = main ?? (hasSignal ? (a.plan!.direction === "long" ? "gruen" : "rot") : "gelb");
  const buy = mode === "gruen" && hasSignal && a.plan!.direction === "long";
  const sell = mode === "rot" && hasSignal && a.plan!.direction === "short";
  const active = buy || sell;
  const inv = (x: number) => (mode === "rot" ? 100 - x : x);
  const pts = Math.round(inv(a.total));
  const verdict =
    mode === "gelb"
      ? a.total > 55 ? "leicht steigend – noch kein Einstieg" : a.total < 45 ? "leicht fallend – noch kein Einstieg" : "neutral – kein klarer Trend"
      : `${pts >= 65 ? "starker" : pts >= 55 ? "solider" : pts >= 45 ? "durchschnittlicher" : "schwacher"} ${mode === "gruen" ? "Trading-Kauf" : "Short"}`;
  const scale = mode === "gruen" ? "über 50 = eher guter Trading-Kauf" : mode === "rot" ? "über 50 = eher guter Short (fallende Kurse)" : "unter 45 eher fallend, über 55 eher steigend";
  return (
    <div className={`panel space-y-3 p-4 ${mode === "gruen" ? "trade-bg" : mode === "rot" ? "sell-bg" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="panel-title">
          Signal{" "}
          {mode === "gruen" ? <span className="trade-tag ml-1 align-middle">Trading-Kauf</span> : mode === "rot" ? <span className="sell-tag ml-1 align-middle">Short</span> : <span className="badge-wait ml-1 align-middle">Abwarten</span>}
        </span>
        <span className={`text-right text-[14px] ${mode === "gruen" ? "text-emerald-300" : mode === "rot" ? "text-red-300" : "text-amber-200"}`}>{verdict}</span>
      </div>
      <div className="flex items-end gap-2">
        <span className="num font-display text-4xl text-gold-light">{pts}</span>
        <span className="pb-1 text-sm text-stone-400">/ 100 {expert ? `Gesamtscore${mode === "rot" ? " (umgedreht für Short)" : ""}` : `Punkte (${scale})`}</span>
      </div>
      <ScoreBar value={inv(a.elliott.score)} label={expert ? `Elliott (${Math.round((w.elliott / sum) * 100)} %)` : mode === "rot" ? "Chartbild (fallend)" : "Chartbild"} />
      <ScoreBar value={inv(a.fundamental.score)} label={expert ? `Fundamental/News (${Math.round((w.fundamental / sum) * 100)} %)` : mode === "rot" ? "Firmenzahlen & Nachrichten (Schwäche)" : "Firmenzahlen & Nachrichten"} />
      <ScoreBar value={inv(a.volume.score)} label={expert ? `Volumen/RSI (${Math.round((w.volume / sum) * 100)} %)` : mode === "rot" ? "Verkaufsdruck" : "Kaufinteresse"} />
      <ScenarioBar elliott={a.elliott} />
      {expert && a.decision.vetoes.length > 0 && (
        <div className="rounded-lg border border-gold/20 bg-black/40 p-2 text-xs text-stone-300">
          Roh-Signal „{SIGNAL_LABEL[a.decision.rawLevel]}“ neutralisiert: {a.decision.vetoes.join("; ")}.
        </div>
      )}
      {sell && !shortAllowed && (
        <p className="rounded-lg bg-amber-500/10 p-2 text-sm text-amber-100">Hinweis: Der Gesamtmarkt (S&P 500) ist gerade nicht bärisch. Blacktrader nimmt Shorts nur in bärischen Märkten als aktuellen Einstieg – dieser Short ist nur zur Information.</p>
      )}
      {mode === "gelb" && <p className="rounded-lg bg-amber-500/10 p-2 text-sm text-amber-100">Blacktrader wartet: Gerade gibt es kein Szenario, das klar genug für einen Einstieg ist.</p>}
      {a.plan && (expert || active) ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          <dt className="text-stone-400">Richtung</dt>
          <dd className={a.plan.direction === "long" ? "text-up" : "text-down"}>{a.plan.direction === "long" ? "Auf steigende Kurse" : "Auf fallende Kurse"}</dd>
          {a.plan.zoneStart != null && (
            <>
              <dt className="text-stone-400">{a.plan.direction === "long" ? "Kaufzone" : "Verkaufszone"}</dt>
              <dd className="num">
                {money(a.plan.zoneStart, a.currency)} – {money(a.plan.zoneEnd!, a.currency)}
              </dd>
            </>
          )}
          <dt className="text-stone-400">Einstieg</dt>
          <dd className="num">
            {money(a.plan.entry, a.currency)} {a.plan.orderType === "limit" ? <span className="text-xs text-amber-300">(wartet, bis der Kurs dort ist)</span> : a.plan.orderType === "market" ? <span className="text-xs text-emerald-300">(jetzt in der Zone)</span> : null}
          </dd>
          <dt className="text-stone-400">{expert ? "Stop-Loss" : "Stop (Verlustgrenze)"}</dt>
          <dd className="num text-down">{a.plan.stop > 0 ? money(a.plan.stop, a.currency) : "kein sinnvoller Stop (Welle zu groß)"}</dd>
          <dt className="text-stone-400">Kursziele</dt>
          <dd className="num text-up">{a.plan.targets.map((x) => money(x, a.currency)).join(" / ")}</dd>
          <dt className="text-stone-400">{expert ? "CRV" : "Chance : Risiko"}</dt>
          <dd className={`num ${a.plan.riskReward >= 1.5 ? "text-up" : "text-down"}`}>{a.plan.riskReward.toFixed(2).replace(".", ",")} : 1</dd>
        </dl>
      ) : (
        <p className="text-sm text-stone-400">Aktuell kein Einstieg geplant.</p>
      )}
      {/* Ohne onTrade (z. B. Kachel mit „übernehmen“ steht schon oben) kein zweiter Knopf */}
      {active ? (
        onTrade && <button className="btn-primary w-full" onClick={onTrade}>
          {a.plan!.orderType === "limit" ? "Order in die Zone legen (Papier-Trade)" : "Als Papier-Trade übernehmen"}
        </button>
      ) : (
        <p className="rounded-lg border border-stone-700 p-2 text-center text-xs text-stone-400">Kein Einstieg – kein Trade möglich.</p>
      )}
    </div>
  );
}

export function Commentary({ a, item }: { a: AnalysisResult; item: { symbol: string; name: string } }) {
  const hasKey = useAppData((d) => !!d.settings.keys.llm);
  const expert = useAppData((d) => d.settings.expertMode);
  const [llm, setLlm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const c = a.commentary;
  const sections: [string, string][] = [
    ["Wellen", c.elliott],
    ["Fundamental", c.fundamental],
    ["Volumen/RSI", c.volume],
    ["Plan", c.plan],
    ["Invalidierung", c.invalidation],
  ];
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const facts = [`Wert: ${item.name} (${item.symbol})`, `Signal: ${SIGNAL_LABEL[a.decision.level]}`, `Kurzfassung: ${c.summary}`, `Grund: ${c.reason}`, ...sections.map(([k, v]) => `${k}: ${v}`), `Fazit: ${c.verdict}`].join("\n");
      setLlm(await api.llm(facts));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel space-y-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="panel-title">Begründung</span>
        {hasKey && (
          <button className="btn text-xs" onClick={run} disabled={busy}>
            {busy ? "formuliert …" : "Mit LLM ausformulieren"}
          </button>
        )}
      </div>
      <p className={`text-lg font-semibold leading-snug ${a.decision.level === "neutral" ? "text-stone-200" : a.plan?.direction === "short" ? "text-red-300" : "text-emerald-300"}`}>{c.summary}</p>
      <p className="text-base leading-relaxed text-stone-100">{c.reason}</p>
      {llm && <div className="whitespace-pre-wrap text-sm leading-relaxed text-stone-300">{llm}</div>}
      {c.risk && <p className="text-sm text-stone-300">{c.risk}</p>}
      {(
      <details className="text-sm" open={expert}>
        <summary className="cursor-pointer text-xs text-gold/80">Details zur Analyse</summary>
        <p className="mt-2 font-display text-sm text-gold-light">{c.headline}</p>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
          {sections.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="pt-0.5 text-[13px] text-gold/80">{k}</dt>
              <dd className="text-stone-300">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs italic text-stone-400">{c.verdict}</p>
      </details>
      )}
      {err && <p className="text-xs text-red-400">{err}</p>}
    </div>
  );
}

function CountBlock({ c, title, currency }: { c: WaveCount; title: string; currency?: string }) {
  return (
    <div className="rounded-lg border border-gold/15 bg-black/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[13px] text-stone-400">{title}</div>
          <div className="font-semibold text-gold-light">{c.patternLabel}</div>
        </div>
        <div className="text-right text-xs text-stone-400">
          <div>Wahrscheinlichkeit <span className="num text-stone-100">{Math.round(c.probability * 100)} %</span></div>
          <div>Fibo-Passung <span className="num text-stone-100">{Math.round(c.fib * 100)} %</span> · Grad {c.degree}</div>
        </div>
      </div>
      <p className="mt-1 text-sm text-stone-300">{c.phase}</p>
      <p className="mt-1 text-xs text-stone-400">Wellen: {c.labels.join(" – ")} · {c.direction === 1 ? "aufwärts" : "abwärts"}{c.extension ? ` · Extension W${c.extension}` : ""}</p>
      <ul className="mt-2 space-y-0.5 text-xs">
        {c.rules.map((r) => (
          <li key={r.name} className={r.passed ? "text-emerald-300" : "text-amber-300"}>
            {r.passed ? "✓" : "!"} {r.name} {r.hard ? "" : "(Richtlinie)"}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap gap-1">
        {c.levels.map((l) => (
          <span key={l.label + l.price} className={`chip ${l.kind === "invalidation" ? "border-wine-light/50 text-red-300" : l.kind === "target" ? "border-gold/40 text-gold-light" : "border-stone-600 text-stone-400"}`}>
            {l.label}: {money(l.price, currency)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function WavePanel({ a }: { a: AnalysisResult }) {
  const { best, alternative, counts } = a.elliott;
  return (
    <div className="panel space-y-3 p-4">
      <div className="flex items-center justify-between">
        <span className="panel-title">Elliott-Wellen</span>
        <span className="text-xs text-stone-400">Score {a.elliott.score} · Konfidenz {Math.round(a.elliott.confidence * 100)} %</span>
      </div>
      {!best && <p className="text-sm text-stone-400">Keine regelkonforme Zählung gefunden.</p>}
      {best && <CountBlock currency={a.currency} c={best} title="Primärzählung" />}
      {alternative && <CountBlock currency={a.currency} c={alternative} title="Alternative" />}
      {a.elliott.contested && <p className="text-xs text-amber-300">Achtung: Primär- und Alternativzählung zeigen in entgegengesetzte Richtungen und sind fast gleichwertig.</p>}
      {counts.length > 2 && (
        <details className="text-xs text-stone-400">
          <summary className="cursor-pointer text-gold/80">Weitere {counts.length - 2} geprüfte Zählungen</summary>
          <table className="mt-2 w-full">
            <tbody>
              {counts.slice(2).map((c) => (
                <tr key={c.id} className="border-t border-gold/10">
                  <td className="py-1">{c.patternLabel}</td>
                  <td>{c.labels.join("-")}</td>
                  <td>{c.degree}</td>
                  <td className={c.bias === 1 ? "text-up" : "text-down"}>{c.bias === 1 ? "↑" : "↓"}</td>
                  <td className="num text-right">{Math.round(c.probability * 100)} %</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

const fmtPct = (x?: number) => (x == null ? "–" : `${(x * 100).toFixed(1).replace(".", ",")} %`);
const fmtNum = (x?: number, d = 2) => (x == null ? "–" : x.toLocaleString("de-DE", { maximumFractionDigits: d }));

const fmtPctF = (x?: number) => (x == null ? null : `${(x * 100).toFixed(1).replace(".", ",")} %`);
const fmtNumF = (x?: number, d = 2) => (x == null ? null : x.toLocaleString("de-DE", { maximumFractionDigits: d }));

/** Fundamentalzahlen: immer echte Werte mit kurzer Einordnung; ohne Daten sichtbarer Grund. */
export function FundamentalsPanel({ a, f, note, kind }: { a: AnalysisResult; f: Fundamentals | null; note?: string; kind?: string }) {
  if (kind === "commodity")
    return (
      <div className="card p-4">
        <div className="panel-title mb-1">Fundamentalzahlen</div>
        <p className="text-[15px] text-stone-400">Rohstoffe haben keine Firmenzahlen – bewertet werden Chartbild, Nachrichten und Kaufinteresse.</p>
      </div>
    );
  const comment = (name: string) => a.fundamental.items.find((i) => i.name === name);
  const rows: [string, string | null, string?][] = !f
    ? []
    : f.kind === "stock"
      ? [
          ["KGV (Preis je Gewinn)", fmtNumF(f.pe), "KGV"],
          ["KUV (Preis je Umsatz)", fmtNumF(f.ps), "KUV"],
          ["KBV (Preis je Buchwert)", fmtNumF(f.pb), "KBV"],
          ["Gewinnwachstum", fmtPctF(f.epsGrowth), "EPS-Wachstum"],
          ["Umsatzwachstum", fmtPctF(f.revenueGrowth), "Umsatzwachstum"],
          ["Gewinnmarge", fmtPctF(f.profitMargin), "Nettomarge"],
          ["Verschuldung (Schulden/Eigenkapital)", f.debtToEquity == null ? null : `${fmtNumF(f.debtToEquity / 100)}×`, "Verschuldung (D/E)"],
          ["Freier Geldzufluss", f.freeCashflow == null ? null : compactNumber(f.freeCashflow), "Free Cashflow"],
          ["Dividendenrendite", fmtPctF(f.dividendYield), "Dividendenrendite"],
          ["Marktkapitalisierung", f.marketCap == null ? null : compactNumber(f.marketCap)],
          ["Nächste Quartalszahlen", f.nextEarnings ? new Date(f.nextEarnings).toLocaleDateString("de-DE") : null],
        ]
      : [
          ["Marktkapitalisierung", f.marketCap == null ? null : `${compactNumber(f.marketCap)} $`, "Marktkapitalisierung"],
          ["Rang", fmtNumF(f.marketCapRank, 0)],
          ["Handelsvolumen 24 h", f.volume24h == null ? null : `${compactNumber(f.volume24h)} $`, "Volumen / Market Cap"],
          ["Coins im Umlauf", f.circulatingSupply == null ? null : compactNumber(f.circulatingSupply), "Angebot im Umlauf"],
          ["Maximale Menge", f.maxSupply == null ? "unbegrenzt" : compactNumber(f.maxSupply)],
          ["Entwickler-Aktivität (Commits 4 Wochen)", fmtNumF(f.devCommits4w, 0), "Entwicklung (Commits 4 W.)"],
          ["Abstand zum Höchststand", f.athChangePct == null ? null : `${fmtNumF(f.athChangePct, 1)} %`],
        ];
  const shown = rows.filter(([, v]) => v != null);
  const s = a.fundamental.fundamentalScore;
  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="panel-title">{f?.kind === "crypto" || kind === "crypto" ? "Kennzahlen" : "Fundamentalzahlen"}</span>
        {s != null && <span className={`text-[13px] ${s >= 58 ? "text-up" : s <= 42 ? "text-down" : "text-stone-400"}`}>{s >= 58 ? "eher gut" : s <= 42 ? "eher schwach" : "durchschnittlich"} ({s})</span>}
      </div>
      {shown.length === 0 ? (
        <p className="rounded-xl bg-white/5 p-3 text-[15px] text-stone-300">
          Keine Daten verfügbar – Grund: {note ?? (f ? "Die Quelle hat keine Kennzahlen zu diesem Wert geliefert." : "Die Datenquelle hat nicht geantwortet.")}
          <span className="mt-1 block text-[13px] text-stone-500">Tipp: Ein kostenloser Finnhub-Schlüssel (Mehr → Einstellungen) liefert Zahlen für US-Aktien zuverlässiger.</span>
        </p>
      ) : (
        <ul className="divide-y divide-white/5">
          {shown.map(([label, value, key]) => {
            const c = key ? comment(key) : undefined;
            return (
              <li key={label} className="flex items-baseline justify-between gap-3 py-2">
                <span className="text-[15px] text-stone-300">{label}</span>
                <span className="text-right">
                  <span className="num text-[16px] font-semibold text-stone-50">{value}</span>
                  {c && <span className={`block text-[13px] ${c.score >= 60 ? "text-up" : c.score < 45 ? "text-down" : "text-stone-400"}`}>{c.comment}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {f && <p className="mt-2 text-[13px] text-stone-500">Quelle: {f.source}</p>}
      {a.fundamental.warnings.map((w) => (
        <p key={w} className="mt-2 text-[14px] text-amber-300">
          {w}
        </p>
      ))}
    </div>
  );
}

export function NewsPanel({ news, score }: { news: NewsItem[]; score: number | null }) {
  return (
    <div className="panel p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="panel-title">Nachrichten (3 Tage)</span>
        <span className="text-xs text-stone-400">Stimmung: {score == null ? "–" : score > 58 ? "positiv" : score < 42 ? "negativ" : "gemischt"}</span>
      </div>
      {news.length === 0 ? (
        <p className="text-sm text-stone-400">Keine aktuellen Meldungen gefunden.</p>
      ) : (
        <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
          {news.slice(0, 15).map((n) => (
            <li key={n.link + n.title} className="flex gap-2 text-sm">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.sentiment === "positive" ? "bg-emerald-400" : n.sentiment === "negative" ? "bg-red-500" : "bg-stone-500"}`} title={n.sentiment} />
              <div className="min-w-0">
                <a href={n.link} target="_blank" rel="noopener noreferrer" className="block min-h-[44px] py-1 text-[15px] text-stone-200 hover:text-gold-light">
                  {n.title}
                </a>
                {n.translated && n.originalTitle && <div className="text-[13px] italic text-stone-500">Original: {n.originalTitle}</div>}
                <div className="text-[13px] text-stone-500">
                  {n.source} · {new Date(n.published).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}
                  {n.translated ? " · übersetzt" : n.lang === "en" ? " · EN" : ""}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function VolumePanel({ a }: { a: AnalysisResult }) {
  const v = a.volume;
  const data = v.profile?.bins.map((b) => ({ price: (b.low + b.high) / 2, share: +(b.share * 100).toFixed(2), hvn: v.profile!.highVolumeZones.some((z) => b.low >= z.low - 1e-9 && b.high <= z.high + 1e-9) })).reverse() ?? [];
  return (
    <div className="panel p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="panel-title">Volumen & RSI</span>
        <span className="text-xs text-stone-400">Score {v.score}</span>
      </div>
      <div className="mb-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-lg bg-black/40 p-2">
          <div className="text-stone-400">RSI(14)</div>
          <div className={`num text-base ${v.rsiState === "überkauft" ? "text-down" : v.rsiState === "überverkauft" ? "text-up" : "text-stone-100"}`}>{v.rsi?.toFixed(1) ?? "–"}</div>
        </div>
        <div className="rounded-lg bg-black/40 p-2">
          <div className="text-stone-400">Rel. Volumen</div>
          <div className="num text-base text-stone-100">{v.relVolume ? `${v.relVolume.toFixed(2).replace(".", ",")}×` : "–"}</div>
        </div>
        <div className="rounded-lg bg-black/40 p-2">
          <div className="text-stone-400">OBV-Trend</div>
          <div className={`text-base ${v.obvTrend > 0 ? "text-up" : v.obvTrend < 0 ? "text-down" : "text-stone-300"}`}>{v.obvTrend > 0 ? "steigend" : v.obvTrend < 0 ? "fallend" : "flach"}</div>
        </div>
      </div>
      <ul className="mb-3 space-y-1 text-sm text-stone-300">
        {v.findings.map((f) => (
          <li key={f}>· {f}</li>
        ))}
      </ul>
      {data.length > 0 && (
        <>
          <div className="mb-1 text-[13px] text-stone-400">Volume Profile (POC {money(v.profile!.poc, a.currency)})</div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ left: 4, right: 8, top: 0, bottom: 0 }} barCategoryGap={1}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="price" width={64} tick={{ fill: "#8f887a", fontSize: 13 }} tickFormatter={(x: number) => money(x, a.currency)} interval={2} />
                <Tooltip cursor={{ fill: "rgba(201,162,74,0.08)" }} contentStyle={{ background: "#0b0b0b", border: "1px solid rgba(201,162,74,0.3)", fontSize: 12 }} formatter={(x) => [`${x} %`, "Volumenanteil"]} labelFormatter={(l) => money(Number(l), a.currency)} />
                <ReferenceLine y={data.reduce((best, d) => (d.share > best.share ? d : best), data[0]).price} stroke="#C9A24A" strokeDasharray="3 3" />
                <Bar dataKey="share" isAnimationActive={false}>
                  {data.map((d) => (
                    <Cell key={d.price} fill={d.hvn ? "#C9A24A" : "rgba(201,162,74,0.35)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}

/** Langfristiger Einstieg (blau): Bereich, Invalidierung, Ziele und ggf. die eigene Position. */
/** Punkte-System für einen blauen Langfrist-Einstieg (statt des grünen Trade-Signals, wenn Blau das Hauptszenario ist). */
export function LongTermSignalCard({ a, zone, currency }: { a: AnalysisResult; zone: LongTermZone | null | undefined; currency?: string }) {
  const expert = useAppData((d) => d.settings.expertMode);
  if (!zone || zone.status === "invalidiert") return null;
  const s = longTermScore(zone, a);
  const fmt = (n: number) => money(n, currency);
  const verdict = s.total >= 65 ? "guter langfristiger Kauf" : s.total >= 55 ? "solider langfristiger Kauf" : s.total >= 45 ? "durchschnittlich" : "schwach";
  return (
    <div className="panel core-bg space-y-3 p-4">
      <div className="flex items-center justify-between">
        <span className="panel-title">
          Signal <span className="badge-core ml-1 align-middle">Langfristiger Kauf</span>
        </span>
        <span className="text-[14px] text-sky-200">{verdict}</span>
      </div>
      <div className="flex items-end gap-2">
        <span className="num font-display text-4xl text-gold-light">{s.total}</span>
        <span className="pb-1 text-sm text-stone-400">/ 100 Punkte (über 50 = eher guter langfristiger Kauf)</span>
      </div>
      <ScoreBar value={s.chart} label={expert ? `Langfrist-Struktur (Chance/Risiko ${s.crv.toFixed(1).replace(".", ",")}, ${zone.context})` : "Chartbild (langfristig)"} />
      <ScoreBar value={s.fundamental} label="Firmenzahlen & Nachrichten" />
      <ScoreBar value={s.volume} label="Kaufinteresse" />
      <ScenarioBar elliott={a.elliott} />
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <dt className="text-stone-400">Richtung</dt>
        <dd className="text-sky-200">Langfristig steigend (Welle 3)</dd>
        <dt className="text-stone-400">Einstiegsbereich</dt>
        <dd className="num">
          {fmt(zone.zoneTop)} – {fmt(zone.zoneBottom)}
        </dd>
        <dt className="text-stone-400">Ungültig unter</dt>
        <dd className="num text-down">
          {zone.invalidation > 0 ? fmt(zone.invalidation) : "keiner"} <span className="text-xs text-stone-400">({zone.invalidation > 0 ? `−${s.riskPct.toFixed(0)} %, ` : ""}kein fester Stop)</span>
        </dd>
        <dt className="text-stone-400">Ziele</dt>
        <dd className="num text-up">
          {fmt(zone.targets[0])} / {fmt(zone.targets[1])}
        </dd>
        <dt className="text-stone-400">Chance : Risiko</dt>
        <dd className={`num ${s.crv >= 1.5 ? "text-up" : "text-down"}`}>{s.crv.toFixed(2).replace(".", ",")} : 1</dd>
      </dl>
    </div>
  );
}

export function LongTermCard({ zone, currency, onTake, position }: { zone: LongTermZone | null | undefined; currency?: string; onTake?: () => void; position?: string | null }) {
  if (!zone || zone.status === "invalidiert") return null;
  const fmt = (n: number) => money(n, currency);
  return (
    <div className="panel core-bg space-y-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="panel-title">
          Langfristiger Einstieg <span className="core-tag ml-1 align-middle">blau</span>
        </span>
        <span className="chip border-sky-500/40 text-sky-300">{zone.status === "in-zone" ? "Bereich erreicht" : "Zulaufend"}</span>
      </div>
      <p className="text-[15px] text-stone-200">{longTermText(zone, fmt)}</p>
      <p className="num text-[14px] text-sky-200">Teile: {zone.tranches.map(fmt).join(" · ")}</p>
      {position && <p className="text-[14px] text-sky-100">{position}</p>}
      <p className="text-[13px] text-stone-500">Kein fester Stop. Teilausstieg oder Stop gibt es nur, wenn sich die Wellenzählung ändert oder das Alternativszenario wahrscheinlicher wird – dann kommt eine Nachricht.</p>
      {onTake && (
        <button className="btn-primary w-full" onClick={onTake}>
          Langfristig übernehmen
        </button>
      )}
    </div>
  );
}
