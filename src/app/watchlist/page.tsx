"use client";
// Watchlist: je Wert eine kompakte Kachel mit dem EINEN aktuellen Einstieg von Blacktrader (blau / grün / gelb = abwarten)
// und Mini-Chart. Antippen öffnet alle Details und „Trade übernehmen“.
import { useEffect } from "react";
import { AddAsset } from "@/components/AddAsset";
import { EntryTile } from "@/components/EntryTile";
import { useAssetSheet } from "@/components/AssetSheet";
import { Legend } from "@/components/Legend";
import { instrumentKey, useMarket } from "@/lib/client/market";
import { runScan, useScan } from "@/lib/client/scanner";
import { actions, useAppData } from "@/lib/store/store";

export default function WatchlistPage() {
  const watchlist = useAppData((d) => d.watchlist);
  const { live } = useMarket();
  const scan = useScan();
  const { open, sheet } = useAssetSheet();

  // Neuer Wert in der Watchlist, der noch nicht berechnet ist → gleich neu rechnen
  const missing = !scan.busy && scan.at != null && watchlist.some((w) => !scan.entries.some((e) => e.asset.kind === w.kind && e.asset.symbol === w.symbol));
  useEffect(() => {
    runScan(missing ? 0 : undefined);
  }, [missing]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[22px] text-gold">Watchlist</h1>
        <Legend />
      </div>
      <AddAsset />
      {watchlist.length === 0 && (
        <div className="card p-6 text-center text-[15px] text-stone-300">
          <p className="font-semibold text-stone-100">Noch keine Werte</p>
          <p className="mt-1 text-stone-400">Suche oben nach einem Namen („Apple“), Symbol (BTC, SAP.DE) oder einer ISIN.</p>
        </div>
      )}
      {watchlist.map((w) => {
        const lv = live[instrumentKey(w)];
        const entry = scan.entries.find((e) => e.asset.kind === w.kind && e.asset.symbol === w.symbol);
        return (
          <EntryTile
            key={w.id}
            asset={w}
            entry={entry}
            price={lv?.price}
            changePct={lv?.changePct}
            status={lv?.status}
            source={lv?.source}
            chart
            showChance
            onOpen={() => open(w, entry?.best.horizon ?? entry?.ltHorizon, { withEntry: true, onRemove: () => actions.removeWatch(w.id) })}
          />
        );
      })}
      {sheet}
    </div>
  );
}
