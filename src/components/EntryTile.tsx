"use client";
// Kompakte Kachel: Name, Signalart, Abstand zur Zone, Mini-Chart (Elliott-Wellen, Richtung, Zone, alte Einstiege grau),
// Stimmungs-Balken (alle Farben gleich), Einstieg/Stop/Ziel. KEIN Text in der Kachel (Wunsch des Nutzers) – der Satz,
// Begründung, Wellenzählung und „übernehmen“ stehen in der Detailansicht (Antippen).
import { displayCurrency } from "@/lib/client/eur";
import { money } from "@/lib/analysis/persona";
import type { LiveStatus } from "@/lib/client/market";
import { lastPrice, potential, type ScanEntry } from "@/lib/client/scanner";
import type { TradePlan } from "@/lib/analysis/score";
import type { ReactNode } from "react";
import type { ResolvedAsset } from "@/lib/types";
import { COLOR_LABEL, signalStrength } from "./AssetCard";
import { MiniChart } from "./MiniChart";
import { miniView } from "./miniView";
import { StatusPill } from "./StatusPill";
import { GAUGE_PREFIX, NeutralGauge, scoreOf } from "./NeutralGauge";

const EDGE = { blau: "edge-core", gruen: "edge-trade", rot: "edge-short", gelb: "edge-wait" } as const;
const BADGE = { blau: "badge-core", gruen: "badge-trade", rot: "badge-short", gelb: "badge-wait" } as const;

/** Buy & Hold: deine Position steckt in derselben Karte (eine Karte pro Kauf statt zwei) */
export interface TilePosition {
  qty: number;
  avg: number;
  value: number | null;
  open: number | null;
  openPct: number | null;
  onOpenPosition: () => void;
  /** Einheit statt „Stück“ (Krypto: Kürzel) */
  unit?: string;
  /** Live-Kurs in Euro je Stück/Einheit – steht oben rechts (Nutzer 12.11.2026: überall derselbe Live-Kurs) */
  livePrice?: number | null;
  /** Wartende Position: Unterzeile (z. B. „noch 0,7 % bis zum Einstieg“); der Titel wird durch den Live-Kurs ersetzt */
  pendingText?: { title: string; sub?: string };
}
const eurT = (x: number, sign = false) => `${sign && x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

export function EntryTile({
  asset, entry, price, changePct, status, source, chart = false, showChance = false, position, onOpen,
  heldColor, plan: planOverride, levels, footer, badgeExtra, gaugePrefix,
}: {
  asset: ResolvedAsset; entry?: ScanEntry; price?: number; changePct?: number; status?: LiveStatus; source?: string; chart?: boolean; showChance?: boolean; position?: TilePosition; onOpen: () => void;
  /** Blacktrader-Depot: Farbe folgt dem Kauf (blau/grün), Plan und Eckwerte kommen aus dem Kauf */
  heldColor?: "blau" | "gruen";
  plan?: TradePlan | null;
  levels?: { entry: string; stop: string; stopLabel?: string; target: string };
  footer?: ReactNode;
  badgeExtra?: ReactNode;
  gaugePrefix?: string;
}) {
  const b = entry?.best;
  const cur = displayCurrency(asset, asset.currency ?? entry?.asset.currency);
  // EIN Live-Kurs: Kurs der Seite (Yahoo/Binance), sonst letzter Kerzen-Schlusskurs
  const p = price ?? (entry ? lastPrice(entry) : undefined);
  const short = b?.color === "rot";
  // Abstand zur Zone: Kauf – Kurs fällt bis zur Oberkante; Short – Kurs steigt bis zur Unterkante
  const dist =
    b?.zoneTop != null && b.zoneBottom != null && p != null
      ? short
        ? p >= b.zoneBottom ? 0 : ((b.zoneBottom - p) / p) * 100
        : p <= b.zoneTop ? 0 : ((p - b.zoneTop) / p) * 100
      : null;
  const ec = heldColor ?? b?.color;
  const blue = ec === "blau";
  const strength = !heldColor && (b?.color === "gruen" || short) ? signalStrength(b?.res) : null;

  // Chart: Kerzen des aktuellen Einstiegs, Wellenzählung, Zone (grün/blau), alte Einstiege grau
  const view = (() => {
    if (entry && heldColor === "blau" && entry.longterm) return miniView(entry, undefined, entry.ltHorizon, entry.ltCandles ?? []);
    if (entry && heldColor === "gruen") {
      const h = (["medium", "long", "short"] as const).find((x) => entry.horizons[x]);
      return h ? miniView(entry, entry.horizons[h]!.res.elliott.best, h, entry.horizons[h]!.candles) : null;
    }
    if (!entry || !b) return null;
    // Alle Charts in Tageskerzen; Wellenpunkte aus Wochenkerzen auf die passende Tageskerze gelegt
    if ((b.color === "gruen" || short) && b.horizon) return miniView(entry, b.res?.elliott.best, b.horizon, entry.horizons[b.horizon]?.candles ?? []);
    if (blue) return miniView(entry, undefined, entry.ltHorizon, entry.ltCandles ?? []);
    const h = (["medium", "long", "short"] as const).find((x) => entry.horizons[x]);
    return h ? miniView(entry, entry.horizons[h]!.res.elliott.best, h, entry.horizons[h]!.candles) : null;
  })();
  const lt = heldColor === "gruen" ? null : view?.longterm ?? null;
  const plan = planOverride !== undefined ? planOverride : heldColor ? null : b?.color === "gruen" || short ? b?.plan : null;

  // Mit Position (Buy & Hold) ist die Karte ein Container: oben deine Position (Antippen → Kauf/Verkauf), darunter die Analyse
  const Root = (position ? "div" : "button") as "button";
  const head = (
    <>
      <div className="min-w-0">
        <div className="truncate text-[16px] font-semibold text-stone-50">{asset.name}</div>
        <div className="text-[13px] text-stone-400">
          {asset.symbol}
          {position ? (position.pendingText ? "" : ` · ${position.qty.toLocaleString("de-DE", { maximumFractionDigits: 4 })} ${position.unit ?? "Stück"} · Ø ${eurT(position.avg)}`) : p != null ? ` · ${money(p, cur)}` : ""}
          {!position && changePct != null && <span className={changePct >= 0 ? "text-up" : "text-down"}>{` ${changePct >= 0 ? "+" : ""}${changePct.toFixed(2).replace(".", ",")} %`}</span>}
        </div>
      </div>
      {position && position.pendingText && (
        <div className="shrink-0 text-right">
          <div className={position.livePrice != null ? "num text-[17px] font-semibold text-stone-50" : "text-[15px] font-semibold text-amber-300"}>{position.livePrice != null ? eurT(position.livePrice) : position.pendingText.title}</div>
          {position.pendingText.sub && <div className="num text-[13px] text-stone-400">{position.pendingText.sub}</div>}
        </div>
      )}
      {position && !position.pendingText && (
        <div className="shrink-0 text-right">
          <div className="num text-[17px] font-semibold text-stone-50">{position.livePrice != null ? eurT(position.livePrice) : position.value != null ? eurT(position.value) : "–"}</div>
          <div className={`num text-[14px] ${position.open == null ? "text-stone-400" : position.open >= 0 ? "text-up" : "text-down"}`}>
            {position.open == null ? "Kurs lädt …" : `${eurT(position.open, true)} (${position.openPct != null ? `${position.openPct >= 0 ? "+" : ""}${position.openPct.toFixed(2).replace(".", ",")} %` : "–"})`}
          </div>
        </div>
      )}
    </>
  );
  const badges = (
        <div className={position ? "flex flex-wrap items-center gap-x-3 gap-y-1" : "flex shrink-0 flex-col items-end gap-1"}>
          {heldColor ? (
            <span className={BADGE[heldColor]}>{heldColor === "blau" ? "Langfristig" : "Trade"}</span>
          ) : b ? (
            <span className={BADGE[b.color]}>
              {COLOR_LABEL[b.color]}
              {strength != null ? ` · Stärke ${strength.toFixed(0)}` : ""}
            </span>
          ) : (
            <span className="badge-muted">rechnet …</span>
          )}
          {badgeExtra}
          {!heldColor && b && b.color !== "gelb" && dist != null && <span className={dist === 0 ? "text-[13px] text-emerald-300" : "text-[13px] text-amber-300"}>{dist === 0 ? "jetzt in der Zone" : `noch ${dist.toFixed(1).replace(".", ",")} %`}</span>}
          {showChance && entry && potential(entry) && <span className="num text-[13px] text-stone-300">Chance {short ? "−" : "+"}{Math.round(potential(entry)!.chancePct)} % bis zum Ziel</span>}
          {status && !b && <StatusPill status={status} source={source} />}
          {entry?.financeWeak && <span className="text-[13px] font-semibold text-red-300">Finanzen schwach</span>}
        </div>
  );
  return (
    <Root onClick={onOpen} className={`card w-full p-3.5 text-left ${position ? "cursor-pointer" : ""} ${ec ? EDGE[ec] : ""}`}>
      <div className="flex items-start justify-between gap-2">
        {position ? (
          <button
            className="flex min-w-0 flex-1 items-start justify-between gap-2 text-left"
            onClick={(e) => {
              e.stopPropagation();
              position.onOpenPosition();
            }}
          >
            {head}
          </button>
        ) : (
          head
        )}
        {!position && badges}
      </div>
      {position && <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">{badges}</div>}

      {chart && view && view.candles.length > 4 && (
        <div className="mt-2">
          <MiniChart candles={view.candles} plan={plan} best={view.best} longterm={lt} past={(entry?.history.past ?? []).slice(0, 10)} height={84} from={view.from} />
        </div>
      )}

      {b && entry && (
        <div className="mt-2">
          <NeutralGauge score={scoreOf(entry)} prefix={gaugePrefix ?? GAUGE_PREFIX[b.color]} />
        </div>
      )}

      {levels ? (
        <div className="num mt-2 grid grid-cols-3 gap-2 text-[14px]">
          <span>
            <span className="label block">Einstieg</span>
            {levels.entry}
          </span>
          <span className="text-red-300">
            <span className="label block">{levels.stopLabel ?? "Stop"}</span>
            {levels.stop}
          </span>
          <span className="text-emerald-300">
            <span className="label block">Ziel</span>
            {levels.target}
          </span>
        </div>
      ) : b && b.color !== "gelb" ? (
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
      {footer && (
        <div className="cursor-default" onClick={(e) => e.stopPropagation()}>
          {footer}
        </div>
      )}
    </Root>
  );
}
