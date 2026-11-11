"use client";
// Analyse-Karte (Chancen, Watchlist): GENAU EIN aktueller Einstieg pro Wert – Blacktrader rechnet im Hintergrund.
// Zeile 1 Name/Kurs · Zeile 2 Mini-Chart (alte Einstiege grau) · Zeile 3 Einstieg/Stop/Ziel · Grund · Verlauf · max. 2 Buttons.
import { nachkaufState, openPositions } from "@/lib/client/nachkauf";
import { OrderSlip } from "./OrderSlip";
import { displayCurrency } from "@/lib/client/eur";
import { useState } from "react";
import type { AnalysisResult } from "@/lib/analysis/analyze";
import type { BestEntry, HistEntry } from "@/lib/analysis/bestEntry";
import { money } from "@/lib/analysis/persona";
import { haptic } from "@/lib/client/alerts";
import { hasOpenTrade, openPaperTrade } from "@/lib/client/autotrade";
import { avgEntry, effectiveLevels, filledTranches, openLongTermTrade } from "@/lib/client/longterm";
import type { LiveStatus } from "@/lib/client/market";
import type { ScanEntry } from "@/lib/client/scanner";
import { getData, useAppData } from "@/lib/store/store";
import { HORIZON_LABEL, type Candle, type Horizon, type ResolvedAsset } from "@/lib/types";
import { ScenarioBar } from "./ScenarioBar";
import { MiniChart } from "./MiniChart";
import { miniView } from "./miniView";
import { waveCaption } from "./waveText";
import { ConfirmSheet } from "./Sheet";
import { MarketNote } from "./DepotPicker";
import { StatusPill } from "./StatusPill";

const RISK_LIMIT = 15; // % Abstand Einstieg–Stop, ab dem "Hohes Risiko" angezeigt wird

const pctStr = (a: number, b: number) => `${((Math.abs(b - a) / a) * 100).toFixed(1).replace(".", ",")} %`;
const dateStr = (sec: number) => new Date(sec * 1000).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });

/**
 * Signalstärke 0–100 (nur Anzeige): je höher, desto stärker – für Kauf und Short gleich.
 * Kauf = Gesamtscore, Short = 100 − Gesamtscore (ein niedriger Score bedeutet ein starkes Short-Signal).
 */
export function signalStrength(res: AnalysisResult | null | undefined): number | null {
  if (!res || !res.plan || res.decision.level === "neutral") return null;
  return res.plan.direction === "long" ? res.total : 100 - res.total;
}

export const COLOR_LABEL: Record<BestEntry["color"], string> = { blau: "Langfristig", gruen: "Trade", rot: "Short", gelb: "Abwarten" };
const BADGE: Record<BestEntry["color"], string> = { blau: "badge-core", gruen: "badge-trade", rot: "badge-short", gelb: "badge-wait" };
const EDGE: Record<BestEntry["color"], string> = { blau: "edge-core", gruen: "edge-trade", rot: "edge-short", gelb: "edge-wait" };
const PAST_LABEL = { erledigt: "erledigt", ungültig: "ungültig", abgelöst: "abgelöst" } as const;

/** Kerzengröße des Zeitraums */
const intervalFor = (h?: Horizon) => getData().settings.intervals[h ?? "long"];

function viewCandles(e: ScanEntry): { candles: Candle[]; res: AnalysisResult | null; h?: Horizon } {
  const b = e.best;
  if ((b.color === "gruen" || b.color === "rot") && b.horizon) return { candles: e.horizons[b.horizon]?.candles ?? [], res: b.res ?? null, h: b.horizon };
  if (b.color === "blau" && e.ltCandles?.length) return { candles: e.ltCandles, res: e.horizons[e.ltHorizon ?? "long"]?.res ?? null, h: e.ltHorizon ?? "long" };
  const h = (["medium", "long", "short"] as Horizon[]).find((x) => e.horizons[x]);
  return { candles: h ? e.horizons[h]!.candles : e.ltCandles ?? [], res: h ? e.horizons[h]!.res : null, h };
}

function PastRow({ p, cur }: { p: HistEntry; cur?: string }) {
  return (
    <li className="flex items-start justify-between gap-2 py-1.5 text-[13px] text-stone-400">
      <span className="min-w-0">
        <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-stone-500" />
        {COLOR_LABEL[p.color]}
        {p.horizon ? ` · ${HORIZON_LABEL[p.horizon]}` : ""} · {p.zoneTop != null ? `${money(p.zoneTop, cur)} – ${money(p.zoneBottom!, cur)}` : "–"}
      </span>
      <span className="shrink-0 text-right">
        {dateStr(p.from)}–{p.to ? dateStr(p.to) : "heute"}
        <br />
        <span className={p.status === "erledigt" ? "text-emerald-300/80" : p.status === "ungültig" ? "text-red-300/80" : "text-stone-500"}>{p.status ? PAST_LABEL[p.status] : ""}</span>
      </span>
    </li>
  );
}

export function AssetCard({
  asset,
  entry,
  price,
  changePct,
  status,
  source,
  onOpen,
  onRemove,
  hideOpen,
}: {
  asset: ResolvedAsset;
  /** Ergebnis von Blacktrader (fehlt, solange noch gerechnet wird) */
  entry?: ScanEntry;
  price?: number;
  changePct?: number;
  status?: LiveStatus;
  source?: string;
  onOpen: (h: Horizon) => void;
  onRemove?: () => void;
  /** In der Detailansicht: ohne „Analyse ansehen“ (die Analyse steht darunter) */
  hideOpen?: boolean;
}) {
  const [confirm, setConfirm] = useState<null | "trade" | "longterm" | "nachkauf">(null);
  const [showPast, setShowPast] = useState(false);
  const trades = useAppData((d) => d.trades);
  const expert = useAppData((d) => d.settings.expertMode);
  const cur = displayCurrency(asset, asset.currency ?? entry?.asset.currency);
  const b = entry?.best;
  const view: ReturnType<typeof viewCandles> = entry ? viewCandles(entry) : { candles: [], res: null };
  const res = view.res;
  const lastPrice = price ?? res?.price ?? entry?.ltCandles?.at(-1)?.close;
  const plan = b?.color === "gruen" || b?.color === "rot" ? b.plan ?? null : null;
  const isShort = plan?.direction === "short";
  const lt = b?.color === "blau" ? b.lt ?? null : null;
  const strength = plan ? signalStrength(b?.res) : null;
  const riskPct = plan ? (Math.abs(plan.entry - plan.stop) / plan.entry) * 100 : 0;
  const myLong = trades.find((t) => t.status !== "closed" && (t.strategy === "longterm" || t.strategy === "core") && t.symbol === asset.symbol);
  const myTrade = trades.find((t) => t.status !== "closed" && t.symbol === asset.symbol && t.strategy !== "core");
  const tradeOpen = plan && b?.horizon ? hasOpenTrade(asset.symbol, b.horizon) : false;
  // Nachkauf nur bei Blau: Wert liegt schon im Depot und Blacktrader zeigt einen weiteren blauen Bereich
  const held = openPositions(asset.symbol, trades).length > 0;
  const nk = lt ? nachkaufState(asset.symbol, lt, trades, !!entry?.financeWeak) : null;
  const isNachkauf = !!nk?.allowed;
  // Finanz-Prüfung: hoch verschuldet und Geld verbrennen/Verluste/Umsatzeinbruch → kein Einstieg
  const weak = !!entry?.financeWeak;
  // Ältere eigene Käufe (Zentraldepot, 2. Kauf …) grau; der neueste bleibt der aktuelle Einstieg
  const buys = trades.filter((t) => t.strategy === "longterm" && t.status !== "closed" && t.symbol === asset.symbol && t.lt).sort((a, b) => a.openedAt - b.openedAt);
  const past = (entry?.history.past ?? []).slice(0, 10);
  const pastChart = [...buys.slice(0, -1).map((t) => ({ from: t.lt!.highTime ?? Math.floor(t.openedAt / 1000) - 60 * 86400, zoneTop: t.lt!.zoneTop, zoneBottom: t.lt!.zoneBottom })), ...past];
  const openHorizon: Horizon = b?.horizon ?? entry?.ltHorizon ?? "medium";

  // Alle Charts in Tageskerzen (Wellenpunkte aus Wochenkerzen auf die passende Tageskerze gelegt)
  const mv = entry ? miniView(entry, lt ? undefined : res?.elliott.best, lt ? entry.ltHorizon : b?.horizon ?? view.h, view.candles) : null;
  const ltMini = mv?.longterm ?? null;
  const wave = mv?.best;

  const myLine = (() => {
    if (!myLong) return null;
    if (myLong.strategy === "core") return "Deine frühere Kernposition (vor dem Update) – schließen kannst du sie im Depot.";
    const n = filledTranches(myLong).length;
    const e = avgEntry(myLong);
    const p = lastPrice && n ? ((lastPrice - e) / e) * 100 : null;
    return n
      ? `Deine Langfrist-Position: ${n} von ${myLong.tranches?.length ?? 1} Teilen gekauft, Ø ${money(e, cur)}${p != null ? ` · ${p >= 0 ? "+" : ""}${p.toFixed(1).replace(".", ",")} %` : ""}${myLong.stop ? ` · Stop ${money(myLong.stop, cur)}` : " · kein Stop"}`
      : "Deine Langfrist-Orders warten im Einstiegsbereich.";
  })();

  return (
    <article className={`card space-y-3 p-4 ${b ? EDGE[b.color] : ""}`}>
      {/* Zeile 1 */}
      <div className="flex items-start justify-between gap-3">
        <button className="min-w-0 text-left" onClick={() => onOpen(openHorizon)}>
          <div className="truncate text-[17px] font-semibold text-stone-50">{asset.name}</div>
          <div className="text-[13px] text-stone-400">{asset.symbol}</div>
        </button>
        <div className="text-right">
          <div className="value">{lastPrice != null ? money(lastPrice, cur) : "–"}</div>
          <div className="flex items-center justify-end gap-1.5">
            {changePct != null && <span className={`num text-[14px] ${changePct >= 0 ? "text-up" : "text-down"}`}>{`${changePct >= 0 ? "+" : ""}${changePct.toFixed(2).replace(".", ",")} %`}</span>}
            {status && <StatusPill status={status} source={source} />}
          </div>
        </div>
      </div>

      {!b ? (
        <p className="text-[15px] text-stone-400">Blacktrader rechnet …</p>
      ) : (
        <>
          {/* Zeile 2: Chart mit aktuellem Einstieg, alte Einstiege grau */}
          <MiniChart candles={mv?.candles ?? view.candles} plan={plan} best={wave} longterm={ltMini} past={pastChart} from={mv?.from} />
          {lt ? (
            <p className="-mt-1 text-[13px] text-sky-200">Welle 1 fertig – erwartet: Rücksetzer (Welle 2) in den blauen Bereich, danach Welle 3.</p>
          ) : (
            waveCaption(wave) && <p className="-mt-1 text-[13px] text-stone-400">{waveCaption(wave)}</p>
          )}

          {/* Zeile 3 */}
          {plan ? (
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-white/5 px-1 py-2">
                <div className="label">{plan.orderType === "limit" ? "Einstieg (warten)" : "Einstieg"}</div>
                <div className="num text-[17px] font-semibold text-stone-50">{money(plan.entry, cur)}</div>
                {lastPrice != null && plan.orderType === "limit" && <div className="num text-[13px] text-amber-300">noch {pctStr(lastPrice, plan.entry)}</div>}
              </div>
              <div className="rounded-xl bg-white/5 px-1 py-2">
                <div className="label">Stop</div>
                <div className="num text-[17px] font-semibold text-red-300">{plan.stop > 0 ? money(plan.stop, cur) : "keiner"}</div>
                <div className="num text-[13px] text-red-300/80">{plan.stop > 0 ? `${isShort ? "+" : "−"}${pctStr(plan.entry, plan.stop)}` : "kein sinnvoller Stop"}</div>
              </div>
              <div className="rounded-xl bg-white/5 px-1 py-2">
                <div className="label">Ziel</div>
                <div className="num text-[17px] font-semibold text-emerald-300">{money(plan.targets[0], cur)}</div>
                <div className="num text-[13px] text-emerald-300/80">{isShort ? "−" : "+"}{pctStr(plan.entry, plan.targets[0])}</div>
              </div>
            </div>
          ) : lt ? (
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-sky-500/10 px-1 py-2">
                <div className="label">Einstieg (3 Teile)</div>
                <div className="num text-[15px] font-semibold text-sky-200">{money(lt.zoneTop, cur)}</div>
                <div className="num text-[13px] text-sky-200/80">bis {money(lt.zoneBottom, cur)}</div>
              </div>
              <div className="rounded-xl bg-white/5 px-1 py-2">
                <div className="label">Ungültig unter</div>
                <div className="num text-[15px] font-semibold text-red-300">{lt.invalidation > 0 ? money(lt.invalidation, cur) : "keiner"}</div>
                <div className="text-[13px] text-stone-400">kein fester Stop</div>
              </div>
              <div className="rounded-xl bg-white/5 px-1 py-2">
                <div className="label">Ziel</div>
                <div className="num text-[15px] font-semibold text-emerald-300">{money(lt.targets[0], cur)}</div>
                <div className="num text-[13px] text-emerald-300/80">dann {money(lt.targets[1], cur)}</div>
              </div>
            </div>
          ) : (
            <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-[15px] text-amber-100">{b.waitFor ?? b.reason}</p>
          )}

          {b.color !== "gelb" && <ScenarioBar elliott={res?.elliott} />}

          {weak && <p className="rounded-xl bg-red-500/15 px-3 py-2 text-[14px] text-red-200">{entry?.financeReason} Kein Einstieg – kann pleitegehen.</p>}
          {(b.color === "gruen" || b.color === "rot") && <p className="text-[14px] text-stone-300">{b.reason}</p>}

          {expert && res && (
            <div className="rounded-xl border border-gold/20 bg-black/30 px-3 py-2 text-[13px] text-stone-300">
              {res.elliott.best ? (
                <div className="text-gold-light">
                  {res.elliott.best.patternLabel} · {res.elliott.best.phase} · Wahrscheinlichkeit {Math.round(res.elliott.best.probability * 100)} %
                </div>
              ) : (
                <div className="text-stone-400">Keine regelkonforme Wellenzählung</div>
              )}
              <div className="num mt-0.5">
                Elliott {res.elliott.score} · Fundamental {res.fundamental.score} · Volumen/RSI {res.volume.score} · Gesamt {res.total.toFixed(0)}
                {b.horizon ? ` · berechnet auf ${HORIZON_LABEL[b.horizon]}` : ""}
              </div>
            </div>
          )}

          {/* Zeile 4: Signalart + Stärke (nur grün) */}
          <div className="flex items-center gap-3">
            {plan ? (
              <>
                <span className="label shrink-0">Stärke</span>
                <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/10" aria-label={`Signalstärke ${strength?.toFixed(0) ?? "–"} von 100`}>
                  <div className={`h-full rounded-full ${strength == null ? "bg-stone-600" : strength >= 65 ? "bg-emerald-400" : strength >= 55 ? "bg-gold" : "bg-stone-400"}`} style={{ width: `${Math.max(2, Math.min(100, strength ?? 0))}%` }} />
                </div>
                <span className="num text-[15px] font-semibold text-stone-200">{strength != null ? strength.toFixed(0) : "–"}</span>
              </>
            ) : (
              <span className="flex-1 text-[14px] text-stone-400">{lt ? (lastPrice != null && lastPrice <= lt.zoneTop ? "Kurs im Einstiegsbereich" : "Bereich zulaufend") : "Kein Einstieg"}</span>
            )}
            <span className={BADGE[b.color]}>{isNachkauf ? "Nachkauf" : COLOR_LABEL[b.color]}</span>
            {plan && riskPct > RISK_LIMIT && <span className="badge-risk">Hohes Risiko</span>}
          </div>

          {(myLine || isNachkauf || myTrade?.promotedAt || (plan && riskPct > RISK_LIMIT)) && (
            <div className="space-y-1.5 text-[14px]">
              {isNachkauf && <p className="text-sky-200">Nachkauf möglich: neuer blauer Bereich zu deiner Position – 250 € (noch {nk!.left} von 4).</p>}
              {myLine && <p className="text-sky-200">{myLine}</p>}
              {myTrade?.promotedAt && (
                <p className="text-sky-200">
                  Hochgestuft zu Blau am {new Date(myTrade.promotedAt).toLocaleDateString("de-DE")}: {myTrade.promoteReason}
                </p>
              )}
              {plan && riskPct > RISK_LIMIT && (
                <p className="text-red-300">
                  {plan.stop <= 0
                    ? "Kein sinnvoller Stop möglich (die Welle ist zu groß) – Totalverlust des Einsatzes möglich."
                    : riskPct >= 50
                      ? `Stop ${pctStr(plan.entry, plan.stop)} entfernt – bei flatex kaum sinnvoll umsetzbar, ein Großteil des Einsatzes kann verloren gehen.`
                      : `Stop ${pctStr(plan.entry, plan.stop)} entfernt – nur mit kleiner Positionsgröße.`}
                </p>
              )}
            </div>
          )}

          {/* Verlauf: alte Einstiege (grau) */}
          {past.length > 0 && (
            <div className="rounded-xl bg-white/[0.03] px-3">
              <button className="flex min-h-[44px] w-full items-center justify-between text-[14px] text-stone-300" onClick={() => setShowPast(!showPast)} aria-expanded={showPast}>
                <span>Verlauf ({past.length})</span>
                <span className="text-stone-500">{showPast ? "▲" : "▼"}</span>
              </button>
              {showPast && (
                <ul className="divide-y divide-white/5 pb-2">
                  {past.map((p) => (
                    <PastRow key={`${p.key}-${p.from}`} p={p} cur={cur} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      {/* Max. 2 Buttons */}
      <div className="flex gap-2">
        {!hideOpen && (
          <button className="btn flex-1" onClick={() => onOpen(openHorizon)}>
            Analyse ansehen
          </button>
        )}
        {weak ? null : plan && b?.res && !tradeOpen && !held ? (
          <button className="btn-primary flex-1" onClick={() => setConfirm("trade")}>
            Als Papier-Trade übernehmen
          </button>
        ) : isNachkauf ? (
          <button className="btn-primary flex-1" onClick={() => setConfirm("nachkauf")}>
            Nachkauf übernehmen (250 €)
          </button>
        ) : lt && !held ? (
          <button className="btn-primary flex-1" onClick={() => setConfirm("longterm")}>
            Langfristig übernehmen
          </button>
        ) : onRemove && !hideOpen ? (
          <button className="btn flex-1" onClick={onRemove}>
            Entfernen
          </button>
        ) : null}
      </div>
      {hideOpen && onRemove && (
        <button className="w-full py-1 text-center text-[14px] text-stone-400 underline-offset-4 active:underline" onClick={onRemove}>
          Aus der Watchlist entfernen
        </button>
      )}

      <ConfirmSheet
        open={confirm === "trade"}
        title={isShort ? "Short als Papier-Trade" : "Papier-Trade übernehmen"}
        confirm={plan?.orderType === "limit" ? "Order legen" : "Trade eröffnen"}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (b?.res && openPaperTrade({ ...asset, currency: cur }, b.res)) {
            if (getData().settings.haptics) haptic(30);
          }
        }}
        text={
          plan ? (
            <div className="space-y-2">
              <p>{asset.name}: {isShort ? "Short – Trade auf fallende Kurse." : "Trade auf steigende Kurse."}</p>
              <p className="num">
                Einstieg {money(plan.entry, cur)} · Stop {money(plan.stop, cur)} · Ziel {money(plan.targets[0], cur)}
              </p>
              {plan.orderType === "limit" && <p className="text-amber-300">Wartende Order: Der Trade startet erst, wenn der Kurs {money(plan.entry, cur)} erreicht.</p>}
              <OrderSlip kind={asset.kind} symbol={asset.symbol} name={asset.name} currency={cur} direction={plan.direction} entry={plan.entry} stop={plan.stop} targets={plan.targets} limit={plan.orderType === "limit"} />
              <p className="text-[13px] text-stone-400">Einstieg, Stop und Ziele kommen unverändert von Blacktrader.{isShort ? "" : " Bestätigt der Wochenchart den Aufwärtstrend, wird der Trade zu Blau hochgestuft und der Stop nur nachgezogen."}</p>
            </div>
          ) : null
        }
      />
      <ConfirmSheet
        open={confirm === "longterm"}
        title="Langfristig übernehmen"
        confirm="Orders legen"
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (lt && openLongTermTrade({ ...asset, currency: cur }, lt, entry?.ltHorizon ?? "long", intervalFor(entry?.ltHorizon), lastPrice ?? lt.zoneTop)) {
            if (getData().settings.haptics) haptic(30);
          }
        }}
        text={
          lt ? (
            <div className="space-y-2">
              <p>{asset.name}: Einstieg in drei Teilen bei</p>
              <p className="num text-sky-200">{lt.tranches.map((t) => money(t, cur)).join(" · ")}</p>
              <MarketNote price={lastPrice} top={lt.tranches[0]} cur={cur} />
              <OrderSlip kind={asset.kind} symbol={asset.symbol} name={asset.name} currency={cur} direction="long" entry={lt.zoneTop} tranches={effectiveLevels([...lt.tranches], lastPrice ?? 0)} invalidation={lt.invalidation} targets={[...lt.targets]} />
              <p className="text-stone-400">
                Kein fester Stop. Ungültig, wenn ein Schlusskurs unter {money(lt.invalidation, cur)} liegt. Teilausstieg oder Stop gibt es nur, wenn sich die Wellenzählung ändert – du bekommst dann eine Nachricht von Blacktrader.
              </p>
            </div>
          ) : null
        }
      />
      <ConfirmSheet
        open={confirm === "nachkauf"}
        title="Nachkauf (250 €)"
        confirm="Order legen"
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (lt && openLongTermTrade({ ...asset, currency: cur }, lt, entry?.ltHorizon ?? "long", intervalFor(entry?.ltHorizon), lastPrice ?? lt.zoneTop, { nachkauf: true })) {
            if (getData().settings.haptics) haptic(30);
          }
        }}
        text={
          lt && nk ? (
            <div className="space-y-2">
              <p>{asset.name}: Nachkauf zu deiner Position im neuen blauen Bereich – eine Order zu 250 € an der Oberkante ({nk.left} von 4 Nachkäufen noch möglich).</p>
              <MarketNote price={lastPrice} top={lt.zoneTop} cur={cur} />
              <OrderSlip kind={asset.kind} symbol={asset.symbol} name={asset.name} currency={cur} direction="long" entry={lt.zoneTop} tranches={effectiveLevels([lt.zoneTop], lastPrice ?? 0)} invalidation={lt.invalidation} targets={[...lt.targets]} budget={250} />
            </div>
          ) : null
        }
      />
    </article>
  );
}
