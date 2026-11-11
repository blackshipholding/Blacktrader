"use client";
// Mehr → Trainer: Blacktrader lernt (Walk-Forward, Strenge-Regeln unverändert) und tritt danach in einem Turnier
// gegen 9 andere Analysten/Bots an (10 Teilnehmer): 50 Versuche à 5 Jahre, 8.000 € Startkapital, in bullischen,
// neutralen, bärischen und gemischten Szenarien. Alle Werte (Aktien, Krypto, Rohstoffe) werden verwendet.
// Danach: Rangliste und wo sich Blacktrader verbessert hat.
import { useAppData } from "@/lib/store/store";
import { LIVE_CHECK, liveCheck } from "@/lib/client/liveCheck";
import { LIVE_LEARN_MIN } from "@/lib/trainer/session";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { IconInfo } from "@/components/Icons";
import { HORIZON_RANK } from "@/lib/analysis/bestEntry";
import { allHistories } from "@/lib/client/entries";
import { refreshTrainerParams, useTrainerCells } from "@/lib/client/trainerParams";
import { initVersionsSeen, newVersions } from "@/lib/client/versionNotice";
import { loadReports, startTraining, stopTraining, TOKEN_KEY, useTraining } from "@/lib/client/trainingSession";
import { primaryCount, primaryRate, TARGET_HIT_RATE } from "@/lib/trainer/engine";
import { goalProgress, goalReached } from "@/lib/trainer/goal";
import { DURATIONS } from "@/lib/trainer/session";
import { eur0, pct1, reportItems, RULES, SCENARIO_LABEL, SCENARIOS, type TournamentReport } from "@/lib/trainer/tournament";
import { ACTIVE_CELL_KEYS, type CellKey } from "@/lib/trainer/universe";
import { HORIZON_LABEL, KIND_LABEL, type AssetKind, type Horizon } from "@/lib/types";

const pct = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")} %`;
const eur = (x: number) => `${Math.round(x).toLocaleString("de-DE")} €`;
const mins = (ms: number) => {
  const m = Math.max(0, Math.ceil(ms / 60e3));
  return m >= 90 ? `noch ${Math.floor(m / 60)} Std. ${m % 60} Min.` : `noch ${m} Min.`;
};
const cellLabel = (c: string) => {
  const [k, h] = c.split(":") as [AssetKind, Horizon];
  return `${KIND_LABEL[k]} · ${HORIZON_LABEL[h]}`;
};

/** Grüne Bereiche, die Blacktrader im Hintergrund nutzt (Aktien/Krypto ohne kurzfristig) */
const GREEN_CELLS = ACTIVE_CELL_KEYS.filter((c) => {
  const [k, h] = c.split(":") as [AssetKind, Horizon];
  return HORIZON_RANK[k].includes(h);
});

/**
 * Blau: erledigt / (erledigt + ungültig) aus dem Einstiegs-Verlauf aller Werte (Gelb zählt nicht).
 * Nur Einstiege, die vorher als aktuell zu sehen waren – im Nachhinein gefundene, schon aufgegangene Bereiche zählen
 * nicht (gescheiterte findet die Suche nicht mehr, sonst stünde die Quote fälschlich bei 100 %).
 */
function blueRate(): { rate: number | null; n: number } {
  let ok = 0;
  let n = 0;
  try {
    for (const h of Object.values(allHistories()))
      for (const p of h.past) {
        if (p.color !== "blau" || !p.seen || (p.status !== "erledigt" && p.status !== "ungültig")) continue;
        n++;
        if (p.status === "erledigt") ok++;
      }
  } catch {
    /* ohne Speicher */
  }
  return { rate: n ? ok / n : null, n };
}

function Ranking({ rep }: { rep: TournamentReport }) {
  return (
    <div className="overflow-hidden rounded-xl bg-white/5">
      <div className="grid grid-cols-[2rem_1fr_auto] gap-x-2 px-3 py-1.5 text-[12px] text-stone-500">
        <span>Platz</span>
        <span>Teilnehmer (Ø von {rep.ranking[0]?.runs ?? 50} Versuchen à 5 Jahre)</span>
        <span className="text-right">Ø p. a.</span>
      </div>
      {rep.ranking.map((c) => {
        const me = c.id === "blacktrader";
        const v = rep.opponents?.find((o) => o.id === c.id);
        return (
          <div key={c.id} className={`grid grid-cols-[2rem_1fr_auto] items-center gap-x-2 border-t border-white/5 px-3 py-2 ${me ? "bg-gold/15" : ""}`}>
            <span className={`num text-[17px] font-semibold ${c.rank === 1 ? "text-gold" : "text-stone-300"}`}>{c.rank}.</span>
            <span className="min-w-0">
              <span className={`block truncate text-[15px] ${me ? "font-semibold text-gold-light" : "text-stone-100"}`}>{c.name}</span>
              <span className="num block text-[12px] text-stone-400">
                {Math.round(c.avgTrades)} Trades · Gewinn nach KESt {eur0(c.avgProfit)}
              </span>
              <span className="num block text-[12px] text-stone-500">
                KESt {eur0(c.avgTax)}{c.avgFees != null ? ` · Gebühren ${eur0(c.avgFees)}` : ""} · Treffer {Math.round(c.winRate * 100)} %{c.broke ? ` · ${c.broke}× ausgeschieden` : ""}
              </span>
              {v && (
                <span className="block text-[12px] text-sky-300/80">
                  Variante: {v.label} ({v.origin === "champion" ? "Champion bleibt" : v.origin === "neu" ? `neue Variante, beste von ${v.tried}` : "Startwerte"})
                </span>
              )}
            </span>
            <span className={`num text-right text-[16px] font-semibold ${c.avgPerYear >= 0 ? "text-up" : "text-down"}`}>
              {pct1(c.avgPerYear)}
              <span className="block text-[11px] font-normal text-stone-500">Ø p. a.</span>
            </span>
          </div>
        );
      })}
      {rep.benchmark && (
        <div className="grid grid-cols-[2rem_1fr_auto] items-center gap-x-2 border-t border-dashed border-white/15 px-3 py-2">
          <span className="text-[15px] text-stone-500">–</span>
          <span className="min-w-0">
            <span className="block truncate text-[15px] text-stone-300">{rep.benchmark.name}</span>
            <span className="block text-[12px] text-stone-500">nur zum Vergleich – handelt nicht mit, alles kaufen und 5 Jahre liegen lassen</span>
          </span>
          <span className={`num text-right text-[16px] font-semibold ${rep.benchmark.avgPerYear >= 0 ? "text-up" : "text-down"}`}>
            {pct1(rep.benchmark.avgPerYear)}
            <span className="block text-[11px] font-normal text-stone-500">Ø p. a.</span>
          </span>
        </div>
      )}
    </div>
  );
}

function ScenarioTable({ rep }: { rep: TournamentReport }) {
  const bt = rep.ranking.find((c) => c.id === "blacktrader");
  if (!bt) return null;
  return (
    <div className="rounded-xl bg-white/5 px-3 py-1.5 text-[14px]">
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 py-1 text-[12px] text-stone-500">
        <span>Szenario</span>
        <span className="text-right">Versuche</span>
        <span className="text-right">Ø p. a.</span>
        <span className="text-right">Platz</span>
      </div>
      {SCENARIOS.filter((s) => bt.byScenario[s]).map((s) => (
        <div key={s} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 border-t border-white/5 py-1.5">
          <span className="text-stone-300">{SCENARIO_LABEL[s]}</span>
          <span className="num text-right text-stone-400">{bt.byScenario[s]!.n}</span>
          <span className={`num text-right ${bt.byScenario[s]!.avgPerYear >= 0 ? "text-up" : "text-down"}`}>{pct1(bt.byScenario[s]!.avgPerYear)}</span>
          <span className="num text-right text-stone-300">{bt.rankByScenario[s]}.</span>
        </div>
      ))}
    </div>
  );
}

export default function TrainerPage() {
  const cells = useTrainerCells();
  const t = useTraining();
  const [dur, setDur] = useState(DURATIONS[0].ms);
  const [token, setToken] = useState("");
  const [hasToken, setHasToken] = useState(true);
  const [adminRequired, setAdminRequired] = useState(false);
  const [info, setInfo] = useState(false);
  const [older, setOlder] = useState(false);
  const [blue, setBlue] = useState<{ rate: number | null; n: number }>({ rate: null, n: 0 });

  useEffect(() => {
    void refreshTrainerParams(true);
    void loadReports();
    setBlue(blueRate());
    try {
      setHasToken(!!localStorage.getItem(TOKEN_KEY));
    } catch {
      /* ohne Speicher */
    }
    fetch("/api/trainer", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setAdminRequired(!!j.adminRequired))
      .catch(() => {});
  }, []);

  // Grün: Zonen-Quote aller grünen Bereiche (gewichtet nach Anzahl Zonen), alle Anlageklassen zusammen
  const green = useMemo(() => {
    let w = 0;
    let n = 0;
    for (const c of GREEN_CELLS) {
      const m = cells[c as CellKey]?.current;
      if (!m) continue;
      w += primaryRate(m) * primaryCount(m);
      n += primaryCount(m);
    }
    return { rate: n ? w / n : null, n };
  }, [cells]);
  const overall = useMemo(() => {
    const n = green.n + blue.n;
    return n ? ((green.rate ?? 0) * green.n + (blue.rate ?? 0) * blue.n) / n : null;
  }, [green, blue]);
  const target = TARGET_HIT_RATE;
  const reached = overall != null && goalReached(overall, target);

  const st = t.session;
  const running = t.running;
  const inTournament = !!st?.tournament && !st.tournament.done;
  const trainProgress = st ? (st.cfg.durationMs ? Math.min(100, (st.elapsedMs / st.cfg.durationMs) * 100) : 100) : 0;
  const progress = st?.tournament ? Math.round((st.tournament.progress ?? 0) * 100) : trainProgress;
  const learning = !!st?.tournament?.text.includes("lernt");
  const curCell = st && running && (learning || !st.tournament) && st.cellIdx < st.cfg.cells.length ? st.cfg.cells[st.cellIdx] : null;
  const saves = st ? t.messages[st.cfg.id] ?? [] : [];
  const latest = t.reports[0] ?? null;
  const items = latest ? reportItems(latest, t.reports[1] ?? null) : [];

  const start = (ms: number) => {
    if (token) {
      try {
        localStorage.setItem(TOKEN_KEY, token);
        setHasToken(true);
      } catch {
        /* egal */
      }
    }
    void startTraining(ms, ms ? [...ACTIVE_CELL_KEYS] : []);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[22px] text-gold">Trainer</h1>
        <Link href="/mehr" className="text-[15px] text-stone-400">
          Zurück
        </Link>
      </div>

      <LiveControl />

      <section className="card space-y-3 p-4">
        <div className="text-center">
          <div className="text-[14px] text-stone-400">Ziel Zonen-Quote · alle Werte</div>
          <div className="num text-[40px] font-semibold leading-tight text-gold">{Math.round(target * 100)} %</div>
          <div className={`num text-[19px] ${reached ? "text-up" : "text-stone-100"}`}>Aktuell {overall != null ? pct(overall) : "–"}</div>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-white/10">
          <div className={`h-full rounded-full transition-all ${reached ? "bg-emerald-500" : "bg-gold"}`} style={{ width: `${goalProgress(overall, target)}%` }} />
        </div>
        <div className="rounded-xl bg-white/5 px-3 py-1 text-[15px]">
          <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 py-1.5">
            <span className="flex items-center gap-2 text-stone-300">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              Grün · Trade
              <button aria-label="Was bedeuten die Quoten?" className="flex h-7 w-7 items-center justify-center text-stone-400" onClick={() => setInfo((v) => !v)}>
                <IconInfo className="h-4 w-4" />
              </button>
            </span>
            <span className="num text-right text-stone-100">{green.rate != null ? pct(green.rate) : "–"}</span>
          </div>
          <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 border-t border-white/5 py-1.5">
            <span className="flex items-center gap-2 text-stone-300">
              <span className="h-2.5 w-2.5 rounded-full bg-sky-400" />
              Blau · Langfristig
            </span>
            <span className="num text-right text-stone-100">{blue.rate != null ? `${pct(blue.rate)} (${blue.n})` : "noch keine"}</span>
          </div>
          {info && (
            <p className="border-t border-white/5 py-1.5 text-[13px] text-stone-400">
              Zonen-Quote wie HKCM: Kurs taucht in die Zone ein, dreht vor der Unterkante und läuft oben heraus. Grün = gemessen auf gesperrten Testdaten aller Werte. Blau = deine langfristigen Einstiege im Verlauf (erledigt gegen ungültig). Gelb zählt nicht.
            </p>
          )}
        </div>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-[17px] text-gold-light">Training</h2>
        {!running ? (
          <>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {DURATIONS.map((d) => (
                <button key={d.ms} className={`btn min-h-[44px] px-2 ${dur === d.ms ? "btn-primary" : ""}`} onClick={() => setDur(d.ms)}>
                  {d.label}
                </button>
              ))}
            </div>
            {adminRequired && !hasToken && <input className="input" type="password" placeholder="Zugangscode" value={token} onChange={(e) => setToken(e.target.value)} />}
            <button className="btn btn-primary min-h-[48px] w-full" onClick={() => start(dur)}>
              Turnier starten (lernt dabei {DURATIONS.find((d) => d.ms === dur)?.label})
            </button>
            <button className="w-full py-1 text-center text-[14px] text-stone-400 underline-offset-4 active:underline" onClick={() => start(0)}>
              Nur Turnier ohne Lernen (ca. 3–8 Min.)
            </button>
          </>
        ) : (
          <button className="btn btn-danger min-h-[48px] w-full" onClick={stopTraining}>
            Stopp
          </button>
        )}
        {st && (running || progress > 0) && (
          <div className="space-y-1">
            {curCell && (
              <p className="text-[14px] text-stone-300">
                Lernt gerade: <span className="text-stone-100">{cellLabel(curCell)}</span>
              </p>
            )}
            {inTournament && <p className="text-[14px] text-stone-300">Turnier: {st.tournament!.text}</p>}
            <div className="h-3 w-full overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gold transition-all" style={{ width: `${progress}%` }} />
            </div>
            <div className="flex justify-between text-[14px] text-stone-300">
              <span className="num">{progress.toFixed(0)} %</span>
              <span>{running ? (learning ? `Lernzeit ${mins(st.cfg.durationMs - st.elapsedMs)}` : inTournament ? "Turnier läuft" : mins(st.cfg.durationMs - st.elapsedMs)) : st.status === "stopped" ? "gestoppt" : "fertig"}</span>
            </div>
            {st.tournament?.failed && <p className="text-[14px] text-amber-300">{st.tournament.failed}</p>}
          </div>
        )}
        {st && saves.length > 0 && (
          <div className="space-y-1">
            {saves.map((m, i) => (
              <p key={i} className={`text-[15px] ${m.startsWith("Gespeichert") ? "text-up" : "text-amber-300"}`}>
                {m}
              </p>
            ))}
          </div>
        )}
      </section>

      {latest && (
        <section className="card space-y-3 p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-[17px] text-gold-light">Auswertung</h2>
            <span className="text-[13px] text-stone-500">{new Date(latest.at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}</span>
          </div>
          <ul className="divide-y divide-white/5 overflow-hidden rounded-xl bg-white/5">
            {items.map((it, i) => (
              <li key={i} className="px-3 py-2">
                <span className="block text-[12px] uppercase tracking-wide text-stone-500">{it.label}</span>
                <span className={`num block text-[15px] font-semibold ${it.tone === "good" ? "text-up" : it.tone === "warn" ? "text-amber-300" : it.tone === "bad" ? "text-down" : "text-stone-100"}`}>{it.value}</span>
                {it.text && <span className="block text-[13px] text-stone-400">{it.text}</span>}
              </li>
            ))}
          </ul>
          <Ranking rep={latest} />
          <h3 className="pt-1 text-[15px] text-stone-300">Blacktrader je Szenario</h3>
          <ScenarioTable rep={latest} />
          {!!latest.improvedCells?.length && (
            <div className="text-[14px]">
              <h3 className="pb-1 text-[15px] text-stone-300">Im Training verbessert</h3>
              {latest.improvedCells.map((c) => (
                <p key={c.cell} className="text-stone-300">
                  {cellLabel(c.cell)}: <span className="num">{c.old != null ? pct(c.old) : "–"}</span> → <span className="num text-up">{c.neu != null ? pct(c.neu) : "–"}</span>
                </p>
              ))}
            </div>
          )}
          {latest.note && <p className="text-[12px] text-stone-500">{latest.note} Durchschnitt der Versuche. Ergebnisse aus der Vergangenheit sind keine Garantie.</p>}
          {t.reports.length > 1 && (
            <div>
              <button className="flex min-h-[44px] w-full items-center justify-between text-[14px] text-stone-300" onClick={() => setOlder(!older)} aria-expanded={older}>
                <span>Frühere Auswertungen ({t.reports.length - 1})</span>
                <span className="text-stone-500">{older ? "▲" : "▼"}</span>
              </button>
              {older && (
                <ul className="divide-y divide-white/5 text-[14px]">
                  {t.reports.slice(1).map((r) => {
                    const b = r.ranking.find((c) => c.id === "blacktrader");
                    return (
                      <li key={r.at} className="flex justify-between py-1.5 text-stone-400">
                        <span>{new Date(r.at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}</span>
                        <span className="num">{b ? `Platz ${b.rank} · Ø ${pct1(b.avgPerYear)} p. a.` : "–"}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </section>
      )}

      <button className="w-full py-2 text-center text-[14px] text-stone-400 underline-offset-4 active:underline" onClick={() => void exportResults({ cells, reports: t.reports })}>
        Ergebnisse exportieren (JSON)
      </button>
    </div>
  );
}

/** Server-Export plus die Stände auf diesem Gerät als eine Datei herunterladen. */
async function exportResults(local: unknown) {
  let server: unknown = null;
  try {
    const r = await fetch("/api/trainer/export", { cache: "no-store" });
    if (r.ok) server = await r.json();
  } catch {
    /* nur lokal */
  }
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), server, thisDevice: local }, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `blacktrader-trainer-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Live-Bilanz als Kontrolle (Stufe 1, ab 100 Ergebnissen) und als Prüfstein beim Lernen (Stufe 2, ab 500) */
function LiveControl() {
  const log = useAppData((d) => d.chanceLog);
  const chk = liveCheck(log);
  const cells = useTrainerCells();
  const [fresh, setFresh] = useState<ReturnType<typeof newVersions>>([]);
  // Regelwerk C2: neue Lern-Versionen melden (erst wenn die Bereiche geladen sind)
  useEffect(() => {
    if (!Object.keys(cells).length) return;
    initVersionsSeen();
    setFresh(newVersions());
  }, [cells]);
  const pc = (x: number | null) => (x == null ? "–" : `${Math.round(x * 100)} %`);
  return (
    <section className={`card space-y-1 p-4 text-[14px] ${chk.warn ? "edge-short" : ""}`}>
      <div className="text-[15px] font-medium text-gold-light">Live-Kontrolle</div>
      <p className={chk.warn ? "text-red-200" : "text-stone-300"}>
        {chk.all.verdict === "zu-wenig"
          ? `Vergleich mit dem Test ab ${LIVE_CHECK.minAll} Ergebnissen (bisher ${chk.all.n}).`
          : chk.warn
            ? `⚠️ Live schlechter als erwartet: ${pc(chk.all.rate)} statt ca. ${pc(chk.all.expected)} (${chk.all.n} Ergebnisse) – Regeln prüfen.`
            : `Live ${pc(chk.all.rate)} bei ${chk.all.n} Ergebnissen – im erwarteten Bereich (Test ca. ${pc(chk.all.expected)}).`}
      </p>
      {chk.warn && (
        <Link href="/regelwerk" className="block text-[14px] text-gold underline-offset-4 active:underline">
          Rückweg-Vorschlag im Regelwerk ansehen
        </Link>
      )}
      {fresh.length > 0 && (
        <Link href="/regelwerk" className="block text-[14px] text-sky-300 underline-offset-4 active:underline">
          Neue Version: {fresh.map((v) => `${cellLabel(v.cell)} V${v.version}`).join(", ")} – im Regelwerk ansehen
        </Link>
      )}
      <p className="text-stone-400">
        Live-Prüfung beim Lernen: {chk.all.n >= LIVE_LEARN_MIN ? "aktiv – ein neuer Stand muss auch im Live-Zeitraum bestehen." : `wartet auf ${LIVE_LEARN_MIN} Ergebnisse (bisher ${chk.all.n}).`}
      </p>
    </section>
  );
}
