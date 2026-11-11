"use client";
import { useState } from "react";
import { useScan, type ScanEntry } from "@/lib/client/scanner";
import type { Horizon, ResolvedAsset } from "@/lib/types";
import { AssetCard } from "./AssetCard";
import { AssetDetailView } from "./AssetDetail";
import { Sheet } from "./Sheet";

type Target = { asset: ResolvedAsset & { id?: string }; horizon?: Horizon; withEntry?: boolean; onRemove?: () => void } | null;

/** Einstieg von Blacktrader für einen Wert (aus der laufenden Suche) */
function useEntry(asset?: ResolvedAsset): ScanEntry | undefined {
  const scan = useScan();
  return asset ? scan.entries.find((e) => e.asset.kind === asset.kind && e.asset.symbol === asset.symbol) : undefined;
}

function Body({ target, close }: { target: NonNullable<Target>; close: () => void }) {
  const entry = useEntry(target.asset);
  return (
    <div className="space-y-4">
      {target.withEntry && (
        <AssetCard
          asset={target.asset}
          entry={entry}
          hideOpen
          onOpen={() => {}}
          onRemove={
            target.onRemove
              ? () => {
                  target.onRemove!();
                  close();
                }
              : undefined
          }
        />
      )}
      <AssetDetailView key={`${target.asset.kind}:${target.asset.symbol}:${target.horizon}`} asset={target.asset} initialHorizon={target.horizon} hideTake={!!target.withEntry} />
    </div>
  );
}

/** Detailansicht als Bottom-Sheet. `withEntry`: oben der aktuelle Einstieg von Blacktrader mit „übernehmen“. */
export function useAssetSheet() {
  const [target, setTarget] = useState<Target>(null);
  const sheet = (
    <Sheet open={!!target} onClose={() => setTarget(null)} title={target?.asset.name}>
      {target && <Body target={target} close={() => setTarget(null)} />}
    </Sheet>
  );
  return {
    open: (asset: ResolvedAsset & { id?: string }, horizon?: Horizon, o: { withEntry?: boolean; onRemove?: () => void } = {}) => setTarget({ asset, horizon, ...o }),
    sheet,
  };
}
