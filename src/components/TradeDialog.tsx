"use client";
// Bestätigung eines Papier-Trades. Einstieg, Stop und Ziele kommen unverändert aus der Analyse –
// sie können nicht angepasst werden, und ohne Signal gibt es keinen Trade.
import { OrderSlip } from "./OrderSlip";
import { useState } from "react";
import type { AnalysisResult } from "@/lib/analysis/analyze";
import { money } from "@/lib/analysis/persona";
import { hasOpenTrade, openPaperTrade } from "@/lib/client/autotrade";
import type { WatchItem } from "@/lib/store/store";
import { HORIZON_LABEL } from "@/lib/types";

export function TradeDialog({ item, analysis, onClose }: { item: WatchItem; analysis: AnalysisResult; onClose: () => void }) {
  const plan = analysis.plan;
  const c = analysis.commentary;
  const [err, setErr] = useState<string | null>(null);
  const allowed = !!plan && analysis.decision.level !== "neutral";

  const save = () => {
    if (!allowed) return;
    if (hasOpenTrade(item.symbol, analysis.horizon)) return setErr("Für diesen Wert und Zeitraum läuft bereits ein Trade.");
    if (openPaperTrade(item, analysis)) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 sm:items-center" onClick={onClose}>
      <div className="panel max-h-[90dvh] w-full max-w-md overflow-y-auto p-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-lg text-gold">Papier-Trade übernehmen</h2>
        <p className="mb-3 text-xs text-stone-400">
          {item.name} ({item.symbol}) · {HORIZON_LABEL[analysis.horizon]} ({analysis.interval})
        </p>
        {!allowed || !plan ? (
          <p className="rounded-lg border border-gold/20 bg-black/40 p-3 text-sm text-stone-200">
            <b>Kein Einstieg.</b> {c.reason}
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-stone-400">Richtung</dt>
              <dd className={plan.direction === "long" ? "text-up" : "text-down"}>{plan.direction === "long" ? "Auf steigende Kurse" : "Auf fallende Kurse"}</dd>
              {plan.zoneStart != null && (
                <>
                  <dt className="text-stone-400">{plan.direction === "long" ? "Kaufzone" : "Verkaufszone"}</dt>
                  <dd className="num">
                    {money(plan.zoneStart, item.currency)} – {money(plan.zoneEnd!, item.currency)}
                  </dd>
                </>
              )}
              <dt className="text-stone-400">Einstieg</dt>
              <dd className="num">{money(plan.entry, item.currency)}</dd>
              <dt className="text-stone-400">Stop (Verlustgrenze)</dt>
              <dd className="num text-down">{money(plan.stop, item.currency)}</dd>
              <dt className="text-stone-400">Kursziele</dt>
              <dd className="num text-up">{plan.targets.map((x) => money(x, item.currency)).join(" / ")}</dd>
              <dt className="text-stone-400">Chance : Risiko</dt>
              <dd className="num">{plan.riskReward.toFixed(2).replace(".", ",")} : 1</dd>
            </dl>
            <p className="mt-3 text-sm text-stone-200">{c.reason}</p>
            {c.risk && <p className="mt-1 text-xs text-stone-400">{c.risk}</p>}
            {plan.orderType === "limit" && (
              <p className="mt-2 rounded-lg border border-amber-500/40 bg-amber-900/20 p-2 text-xs text-amber-100">
                Wartende Order: Der Trade startet erst, wenn der Kurs {money(plan.entry, item.currency)} erreicht. Läuft der Kurs vorher über {money(plan.cancelAbove ?? plan.entry, item.currency)} oder passiert 60 Kerzen lang nichts, verfällt sie.
              </p>
            )}
            <div className="mt-3">
              <OrderSlip kind={item.kind} symbol={item.symbol} name={item.name} currency={item.currency ?? analysis.currency} direction={plan.direction} entry={plan.entry} stop={plan.stop} targets={plan.targets} limit={plan.orderType === "limit"} />
            </div>
            <p className="mt-3 text-[13px] text-stone-500">Einstieg, Stop und Ziele sind von Blacktrader festgelegt und werden unverändert übernommen.</p>
          </>
        )}
        {err && <p className="mt-2 text-sm text-red-400">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            {allowed ? "Abbrechen" : "Schließen"}
          </button>
          {allowed && (
            <button className="btn-primary" onClick={save}>
              {plan?.orderType === "limit" ? "Order legen" : "Trade eröffnen"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
