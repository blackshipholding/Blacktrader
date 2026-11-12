"use client";
// Analyse-Karte (Chancen, Watchlist): GENAU EIN aktueller Einstieg pro Wert – Blacktrader rechnet im Hintergrund.
// Steht nur in der Detailansicht (AssetSheet): Zeile 1 Kürzel/Kurs (Name im Fenstertitel) · Mini-Chart · Einstieg/Stop/Ziel ·
// Balken · Verlauf · max. 2 Buttons. KEIN Text-Kasten mehr (Satz/Begründung/Betrag – Nutzer 11.11.2026, die Beschreibung steht darunter).
import { nachkaufState, openPositions } from "@/lib/client/nachkauf";
import { OrderSlip } from "./OrderSlip";
import { displayCurrency } from "@/lib/client/eur";
import { useState } from "react";
import type { AnalysisResult } from "@/lib/analysis/analyze";
import type { TradePlan } from "@/lib/analysis/score";
import type { BestEntry, HistEntry } from "@/lib/analysis/bestEntry";
import { money } from "@/lib/analysis/persona";
import { haptic } from "@/lib/client/alerts";
import { hasOpenTrade, openPaperTrade } from "@/lib/client/autotrade";
import { avgEntry, effectiveLevels, filledTranches, openLongTermTrade } from "@/lib/client/longterm";
import { useLive, type LiveStatus } from "@/lib/client/market";
import { useEuroNative } from "@/lib/client/euroPrice";
import type { ScanEntry } from "@/lib/client/scanner";
import { getData, useAppData } from "@/lib/store/store";
import { HORIZON_LABEL, type Candle, type Horizon, type ResolvedAsset } from "@/lib/types";
import { MiniChart } from "./MiniChart";
import { miniView } from "./miniView";
import { waveCaption } from "./waveText";
import { ConfirmSheet } from "./Sheet";
import { MarketNote } from "./DepotPicker";
import { StatusPill } from "./StatusPill";
import { ADD } from "@/lib/client/account";
import { GAUGE_PREFIX, NeutralGauge } from "./NeutralGauge";

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
  tipOnly,
  fromDepot,
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
  /** Buy & Hold: nur Tipps von Shipmaster – keine Knöpfe, die ins Blacktrader-Konto übernehmen */
  tipOnly?: boolean;
  /** Aus dem Blacktrader-Depot geöffnet: Farbe folgt dem Kauf (blau bleibt blau, grün bleibt grün – Nutzer 11.11.2026) */
  fromDepot?: boolean;
}) {
  const [confirm, setConfirm] = useState<null | "trade" | "longterm" | "nachkauf">(null);
  const trades = useAppData((d) => d.trades);
  const expert = useAppData((d) => d.settings.expertMode);
  const cur = displayCurrency(asset, asset.currency ?? entry?.asset.currency);
  const b = entry?.best;
  const view: ReturnType<typeof viewCandles> = entry ? viewCandles(entry) : { candles: [], res: null };
  const res = view.res;
  // EIN Live-Kurs (Euro-Börse / Binance EUR, als Originalwährungs-Gegenwert): eigener Kurs → Live-Kurs der App → Euro-Abruf → Analyse
  const liveQ = useLive(asset);
  const euroLive = useEuroNative(asset, cur, price == null && liveQ?.price == null);
  const lastPrice = price ?? liveQ?.price ?? euroLive ?? res?.price ?? entry?.ltCandles?.at(-1)?.close;
  // Farbe folgt dem Kauf (nur aus dem Blacktrader-Depot): blau gekauft → blau, grün gekauft → grün, egal was die Analyse gerade zeigt
  const openMine = trades.filter((t) => t.status !== "closed" && t.symbol === asset.symbol && t.kind === asset.kind);
  const heldBlue = openMine.filter((t) => (t.strategy === "longterm" || t.strategy === "core") && t.lt).sort((x, y) => x.openedAt - y.openedAt).at(-1);
  const heldGreen = openMine.find((t) => t.strategy !== "longterm" && t.strategy !== "core" && t.direction === "long");
  const heldColor = fromDepot && b ? (heldBlue ? "blau" : heldGreen ? "gruen" : null) : null;
  const show = heldColor ?? b?.color;
  const keepBlue = heldColor === "blau" && b?.color !== "blau";
  const keepGreen = heldColor === "gruen" && b?.color !== "gruen";
  const heldPlan: TradePlan | null = keepGreen && heldGreen ? { direction: "long", entry: heldGreen.entry, stop: heldGreen.stop, targets: heldGreen.targets, riskReward: 0, orderType: "market", zoneStart: heldGreen.entry, zoneEnd: heldGreen.entry } : null;
  const plan = keepBlue ? null : heldPlan ?? (b?.color === "gruen" || b?.color === "rot" ? b.plan ?? null : null);
  const isShort = plan?.direction === "short";
  const lt = heldColor === "gruen" ? null : b?.color === "blau" ? b.lt ?? null : null;
  // Gekaufte blaue Zone (neuester Kauf), wenn die Analyse gerade etwas anderes zeigt
  const ownLt = keepBlue && heldBlue?.lt ? heldBlue.lt : null;
  const ltGrid = lt ?? (ownLt ? { zoneTop: ownLt.zoneTop, zoneBottom: ownLt.zoneBottom, invalidation: ownLt.invalidation, targets: ownLt.targets } : null);
  const strength = plan && !heldPlan ? signalStrength(b?.res) : null;
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
  const ltMini = ownLt
    ? { start: { time: 0, price: ownLt.invalidation }, high: { time: ownLt.highTime ?? Math.floor(heldBlue!.openedAt / 1000) - 60 * 86400, price: ownLt.targets[0] }, zoneTop: ownLt.zoneTop, zoneBottom: ownLt.zoneBottom, invalidation: ownLt.invalidation, target: ownLt.targets[0] }
    : heldColor === "gruen"
      ? null
      : mv?.longterm ?? null;
  const wave = mv?.best;


  return (
    <article className={`card space-y-3 p-4 ${show ? EDGE[show] : ""}`}>
      {/* Zeile 1 */}
      <div className="flex items-start justify-between gap-3">
        <button className="min-w-0 text-left" onClick={() => onOpen(openHorizon)}>
          {/* Name steht schon im Fenstertitel der Detailansicht – hier nur das Kürzel (für die Suche bei flatex) */}
          <div className="text-[15px] text-stone-300">{asset.symbol}</div>
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
          {/* Wellenzählung nur in der Expertenansicht (Anfänger: ein Satz weiter unten) */}
          {expert && (lt ? <p className="-mt-1 text-[13px] text-sky-200">Welle 1 fertig – erwartet: Rücksetzer (Welle 2) in den blauen Bereich, danach Welle 3.</p> : waveCaption(wave) && <p className="-mt-1 text-[13px] text-stone-400">{waveCaption(wave)}</p>)}

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
          ) : ltGrid ? (
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-sky-500/10 px-1 py-2">
                <div className="label">Einstieg (3 Teile)</div>
                <div className="num text-[15px] font-semibold text-sky-200">{money(ltGrid.zoneTop, cur)}</div>
                <div className="num text-[13px] text-sky-200/80">bis {money(ltGrid.zoneBottom, cur)}</div>
              </div>
              <div className="rounded-xl bg-white/5 px-1 py-2">
                <div className="label">Ungültig unter</div>
                <div className="num text-[15px] font-semibold text-red-300">{ltGrid.invalidation > 0 ? money(ltGrid.invalidation, cur) : "keiner"}</div>
                <div className="text-[13px] text-stone-400">kein fester Stop</div>
              </div>
              <div className="rounded-xl bg-white/5 px-1 py-2">
                <div className="label">Ziel</div>
                <div className="num text-[15px] font-semibold text-emerald-300">{money(ltGrid.targets[0], cur)}</div>
                {ltGrid.targets[1] != null && <div className="num text-[13px] text-emerald-300/80">dann {money(ltGrid.targets[1], cur)}</div>}
              </div>
            </div>
          ) : null}

          <NeutralGauge score={res?.total ?? entry?.best.res?.total} prefix={GAUGE_PREFIX[show ?? b.color]} />

          {weak && <p className="rounded-xl bg-red-500/15 px-3 py-2 text-[14px] text-red-200">{entry?.financeReason} Kein Einstieg – kann pleitegehen.</p>}

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
              <span className="flex-1" />
            )}
            <span className={BADGE[show ?? b.color]}>{isNachkauf ? "Nachkauf" : COLOR_LABEL[show ?? b.color]}</span>
            {plan && riskPct > RISK_LIMIT && <span className="badge-risk">Hohes Risiko</span>}
          </div>

          {(isNachkauf || myTrade?.promotedAt) && (
            <div className="space-y-1.5 text-[14px]">
              {isNachkauf && <p className="text-sky-200">Nachkauf möglich: neuer blauer Bereich zu deiner Position – {ADD.stake.toLocaleString("de-DE")} € (noch {nk!.left} von {ADD.max}).</p>}
                            {myTrade?.promotedAt && (
                <p className="text-emerald-200">
                  Stop nachgezogen am {new Date(myTrade.promotedAt).toLocaleDateString("de-DE")}: {myTrade.promoteReason}
                </p>
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
        {weak || tipOnly ? null : isShort ? (
          <p className="flex-1 rounded-xl bg-red-500/10 px-3 py-2 text-center text-[14px] text-red-200">Nur Info – Blacktrader handelt keine Shorts</p>
        ) : plan && b?.res && !tradeOpen && !held ? (
          <button className="btn-primary flex-1" onClick={() => setConfirm("trade")}>
            Als Papier-Trade übernehmen
          </button>
        ) : isNachkauf ? (
          <button className="btn-primary flex-1" onClick={() => setConfirm("nachkauf")}>
            Nachkauf übernehmen ({ADD.stake.toLocaleString("de-DE")} €)
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
              <p className="text-[13px] text-stone-400">Einstieg, Stop und Ziele kommen unverändert von Blacktrader.{isShort ? "" : " Bestätigt der Wochenchart den Aufwärtstrend, wird der Stop nachgezogen (der Trade bleibt grün)."}</p>
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
        title={`Nachkauf (${ADD.stake.toLocaleString("de-DE")} €)`}
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
              <p>{asset.name}: Nachkauf zu deiner Position im neuen blauen Bereich – eine Order zu {ADD.stake.toLocaleString("de-DE")} € an der Oberkante ({nk.left} von {ADD.max} Nachkäufen noch möglich).</p>
              <MarketNote price={lastPrice} top={lt.zoneTop} cur={cur} />
              <OrderSlip kind={asset.kind} symbol={asset.symbol} name={asset.name} currency={cur} direction="long" entry={lt.zoneTop} tranches={effectiveLevels([lt.zoneTop], lastPrice ?? 0)} invalidation={lt.invalidation} targets={[...lt.targets]} budget={ADD.stake} />
            </div>
          ) : null
        }
      />
    </article>
  );
}
