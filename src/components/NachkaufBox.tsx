"use client";
// Depot: „Nachkauf möglich“ (blau) – liegt der Wert im Depot und Blacktrader zeigt einen weiteren BLAUEN Einstieg,
// darf mit 250 € nachgekauft werden (höchstens 4 ×). Bei Grün/Rot gibt es keinen Nachkauf.
import { useState } from "react";
import { ConfirmSheet } from "./Sheet";
import { OrderSlip } from "./OrderSlip";
import { MarketNote } from "./DepotPicker";
import { money } from "@/lib/analysis/persona";
import { displayCurrency } from "@/lib/client/eur";
import { effectiveLevels, openLongTermTrade } from "@/lib/client/longterm";
import { nachkaufState } from "@/lib/client/nachkauf";
import type { ScanEntry } from "@/lib/client/scanner";
import { getData, useAppData } from "@/lib/store/store";

export function NachkaufBox({ entry }: { entry: ScanEntry | undefined }) {
  const trades = useAppData((d) => d.trades);
  const [open, setOpen] = useState(false);
  const lt = entry?.best.color === "blau" ? entry.best.lt ?? null : null;
  if (!entry || !lt) return null;
  const nk = nachkaufState(entry.asset.symbol, lt, trades, !!entry.financeWeak);
  if (!nk.allowed) return null;
  const a = entry.asset;
  const cur = displayCurrency(a, a.currency);
  return (
    <div className="mt-2 rounded-xl border border-sky-400/40 bg-sky-500/10 p-3 text-[14px]" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between gap-2">
        <span className="badge-core">Nachkauf möglich</span>
        <span className="text-[13px] text-sky-200">noch {nk.left} von 4</span>
      </div>
      <p className="mt-1.5 text-sky-100">
        Neuer blauer Bereich {money(lt.zoneTop, cur)} – {money(lt.zoneBottom, cur)} · ungültig unter {money(lt.invalidation, cur)}
      </p>
      <button className="btn-primary mt-2 w-full" onClick={() => setOpen(true)}>
        Nachkauf übernehmen (250 €)
      </button>
      <ConfirmSheet
        open={open}
        title="Nachkauf (250 €)"
        confirm="Order legen"
        onClose={() => setOpen(false)}
        onConfirm={() => {
          const price = entry.ltCandles?.at(-1)?.close ?? lt.zoneTop;
          openLongTermTrade(a, lt, entry.ltHorizon ?? "long", getData().settings.intervals[entry.ltHorizon ?? "long"], price, { nachkauf: true });
        }}
        text={
          <div className="space-y-3">
            <MarketNote price={entry.ltCandles?.at(-1)?.close} top={lt.zoneTop} cur={cur} />
            <OrderSlip kind={a.kind} symbol={a.symbol} name={a.name} currency={cur} direction="long" entry={lt.zoneTop} tranches={effectiveLevels([lt.zoneTop], entry.ltCandles?.at(-1)?.close ?? 0)} invalidation={lt.invalidation} targets={[...lt.targets]} budget={250} />
          </div>
        }
      />
    </div>
  );
}
