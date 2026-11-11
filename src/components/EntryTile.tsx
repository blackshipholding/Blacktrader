"use client";
// Kompakte Kachel: Name, Signalart, Abstand zur Zone, Mini-Chart (Elliott-Wellen, Richtung, Zone, alte Einstiege grau),
// Einstieg/Stop/Ziel. Bewusst ohne Texte – Begründung, Wellen-Beschreibung, Risiko-Hinweis und „worauf Blacktrader
// wartet“ stehen in den Details (Antippen), dort auch „übernehmen“.
import { displayCurrency } from "@/lib/client/eur";
import { money } from "@/lib/analysis/persona";
import type { LiveStatus } from "@/lib/client/market";
import { lastPrice, potential, type ScanEntry } from "@/lib/client/scanner";
import type { ResolvedAsset } from "@/lib/types";
import { COLOR_LABEL, signalStrength } from "./AssetCard";
import { MiniChart } from "./MiniChart";
import { miniView } from "./miniView";
import { StatusPill } from "./StatusPill";

const EDGE = { blau: "edge-core", gruen: "edge-trade", rot: "edge-short", gelb: "edge-wait" } as const;
const BADGE = { blau: "badge-core", gruen: "badge-trade", rot: "badge-short", gelb: "badge-wait" } as const;

export function EntryTile({ asset, entry, price, changePct, status, source, chart = false, showChance = false, onOpen }: { asset: ResolvedAsset; entry?: ScanEntry; price?: number; changePct?: number; status?: LiveStatus; source?: string; chart?: boolean; showChance?: boolean; onOpen: () => void }) {
  const b = entry?.best;
  const cur = displayCurrency(asset, asset.currency ?? entry?.asset.currency);
  const p = price ?? (entry ? lastPrice(entry) : undefined);
  const short = b?.color === "rot";
  // Abstand zur Zone: Kauf – Kurs fällt bis zur Oberkante; Short – Kurs steigt bis zur Unterkante
  const dist =
    b?.zoneTop != null && b.zoneBottom != null && p != null
      ? short
        ? p >= b.zoneBottom ? 0 : ((b.zoneBottom - p) / p) * 100
        : p <= b.zoneTop ? 0 : ((p - b.zoneTop) / p) * 100
      : null;
  const blue = b?.color === "blau";
  const strength = b?.color === "gruen" || short ? signalStrength(b?.res) : null;

  // Chart: Kerzen des aktuellen Einstiegs, Wellenzählung, Zone (grün/blau), alte Einstiege grau
  const view = (() => {
    if (!entry || !b) return null;
    // Alle Charts in Tageskerzen; Wellenpunkte aus Wochenkerzen auf die passende Tageskerze gelegt
    if ((b.color === "gruen" || short) && b.horizon) return miniView(entry, b.res?.elliott.best, b.horizon, entry.horizons[b.horizon]?.candles ?? []);
    if (blue) return miniView(entry, undefined, entry.ltHorizon, entry.ltCandles ?? []);
    const h = (["medium", "long", "short"] as const).find((x) => entry.horizons[x]);
    return h ? miniView(entry, entry.horizons[h]!.res.elliott.best, h, entry.horizons[h]!.candles) : null;
  })();
  const lt = view?.longterm ?? null;

  return (
    <button onClick={onOpen} className={`card w-full p-3.5 text-left ${b ? EDGE[b.color] : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[16px] font-semibold text-stone-50">{asset.name}</div>
          <div className="text-[13px] text-stone-400">
            {asset.symbol}
            {p != null ? ` · ${money(p, cur)}` : ""}
            {changePct != null && <span className={changePct >= 0 ? "text-up" : "text-down"}>{` ${changePct >= 0 ? "+" : ""}${changePct.toFixed(2).replace(".", ",")} %`}</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {b ? (
            <span className={BADGE[b.color]}>
              {COLOR_LABEL[b.color]}
              {strength != null ? ` · Stärke ${strength.toFixed(0)}` : ""}
            </span>
          ) : (
            <span className="badge-muted">rechnet …</span>
          )}
          {b && b.color !== "gelb" && dist != null && <span className={dist === 0 ? "text-[13px] text-emerald-300" : "text-[13px] text-amber-300"}>{dist === 0 ? "jetzt in der Zone" : `noch ${dist.toFixed(1).replace(".", ",")} %`}</span>}
          {showChance && entry && potential(entry) && <span className="num text-[13px] text-stone-300">Chance {short ? "−" : "+"}{Math.round(potential(entry)!.chancePct)} % bis zum Ziel</span>}
          {status && !b && <StatusPill status={status} source={source} />}
          {entry?.financeWeak && <span className="text-[13px] font-semibold text-red-300">Finanzen schwach</span>}
        </div>
      </div>

      {chart && view && view.candles.length > 4 && (
        <div className="mt-2">
          <MiniChart candles={view.candles} plan={b?.color === "gruen" || short ? b?.plan : null} best={view.best} longterm={lt} past={(entry?.history.past ?? []).slice(0, 10)} height={84} from={view.from} />
        </div>
      )}

      {b && b.color !== "gelb" ? (
        <div className="num mt-2 grid grid-cols-3 gap-2 text-[14px]">
          <span>
            <span className="label block">Einstieg</span>
            {money(short ? b.zoneBottom! : b.zoneTop!, cur)}
          </span>
          <span className="text-red-300">
            <span className="label block">{blue ? "Ungültig unter" : "Stop"}</span>
            {(blue ? b.invalidation : b.stop)! > 0 ? money((blue ? b.invalidation : b.stop)!, cur) : "keiner"}
          </span>
          <span className="text-emerald-300">
            <span className="label block">Ziel</span>
            {b.targets?.[0] != null ? money(b.targets[0], cur) : "–"}
          </span>
        </div>
      ) : null}
    </button>
  );
}
