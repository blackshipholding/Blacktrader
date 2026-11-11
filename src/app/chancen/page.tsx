"use client";
// Chancen: aus dem Markt (S&P 100, DAX 40, ATX, 20 Krypto, 10 Rohstoffe) die 20 Einstiege mit dem größten Potenzial –
// Blau (langfristig), Grün (Trade auf steigende Kurse) oder Rot (Short). Werte nur aus der Watchlist kommen nicht hierher.
// Gelb (kein Einstieg) erscheint nur in der Watchlist.
import { openPositions } from "@/lib/client/nachkauf";
import { ChanceRecord } from "@/components/ChanceRecord";
import { ACCOUNT, canAfford, freeCash, noMoney } from "@/lib/client/account";
import { OVER_BUDGET } from "@/lib/client/orderSlip";
import { useEffect, useMemo, useState } from "react";
import { signalStrength } from "@/components/AssetCard";
import { EntryTile } from "@/components/EntryTile";
import { useAssetSheet } from "@/components/AssetSheet";
import { Legend } from "@/components/Legend";
import { ConfirmSheet } from "@/components/Sheet";
import { haptic } from "@/lib/client/alerts";
import { openPaperTrade } from "@/lib/client/autotrade";
import { isChance, isTopChance, notHeld, potential, runScan, useHeldKeys, useScan, type SignalKind } from "@/lib/client/scanner";
import { MARKET_GROUPS } from "@/lib/client/marketList";
import { getData } from "@/lib/store/store";
import type { AssetKind } from "@/lib/types";

type KindFilter = "all" | SignalKind;
const KIND_FILTERS: { k: KindFilter; label: string; cls: string }[] = [
  { k: "all", label: "Alle", cls: "border-gold/60 text-gold-light" },
  { k: "blau", label: "Blau", cls: "border-sky-400/60 text-sky-300" },
  { k: "gruen", label: "Grün", cls: "border-emerald-400/60 text-emerald-300" },
  { k: "rot", label: "Rot", cls: "border-red-400/60 text-red-300" },
];

/** Nur Einstiege, die die Mindestanforderungen erfüllen – davon höchstens 20 (gern weniger) */
const TOP = 20;

export default function ChancenPage() {
  const scan = useScan();
  const [kind, setKind] = useState<KindFilter>("all");
  const [group, setGroup] = useState<AssetKind | "all">("all");
  const [confirmAll, setConfirmAll] = useState(false);
  const { open, sheet } = useAssetSheet();
  // Was schon im Depot liegt, erscheint hier nicht mehr (die Live-Bilanz zählt es im Hintergrund weiter)
  const held = useHeldKeys();

  useEffect(() => {
    runScan();
  }, []);

  const list = useMemo(
    () =>
      scan.entries
        .filter((e) => isChance(e) && isTopChance(e) && notHeld(held)(e) && (group === "all" || e.asset.kind === group) && (kind === "all" || e.best.color === kind))
        .map((e) => ({ e, p: potential(e) }))
        .filter((x) => x.p != null)
        .sort((a, b) => b.p!.score - a.p!.score)
        .slice(0, TOP)
        .map((x) => x.e),
    [scan.entries, kind, group, held],
  );
  const counts = useMemo(() => {
    const c: Record<KindFilter, number> = { all: 0, blau: 0, gruen: 0, rot: 0 };
    for (const e of scan.entries) {
      if (!isChance(e) || !isTopChance(e) || !notHeld(held)(e) || (group !== "all" && e.asset.kind !== group)) continue;
      if (e.best.color === "gelb") continue;
      c.all++;
      c[e.best.color]++;
    }
    return c;
  }, [scan.entries, group, held]);

  const tradable = list.filter((e) => (e.best.color === "gruen" || e.best.color === "rot") && e.best.res).map((e) => ({ asset: e.asset, res: e.best.res! }));

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-[22px] text-gold">Chancen</h1>
        </div>
        <Legend />
      </div>

      <ChanceRecord />

      <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none]">
        {KIND_FILTERS.map((f) => (
          <button key={f.k} onClick={() => setKind(f.k)} className={`chip shrink-0 ${kind === f.k ? `${f.cls} bg-white/10 font-semibold` : "border-white/10 text-stone-400"}`}>
            {f.label} {scan.at ? `(${Math.min(TOP, counts[f.k])})` : ""}
          </button>
        ))}
      </div>
      <div className="seg w-full">
        {[{ k: "all" as const, t: "Alle" }, ...MARKET_GROUPS.map((g) => ({ k: g.kind, t: g.title }))].map((g) => (
          <button key={g.k} aria-pressed={group === g.k} onClick={() => setGroup(g.k)} className="flex-1">
            {g.t}
          </button>
        ))}
      </div>

      {scan.busy && (
        <div className="card p-3">
          <div className="mb-1.5 flex justify-between text-[14px] text-stone-300">
            <span>Blacktrader sucht Chancen …</span>
            <span className="num">{Math.round(scan.progress * 100)} %</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-gold transition-all" style={{ width: `${scan.progress * 100}%` }} />
          </div>
        </div>
      )}

      {!scan.busy && scan.at && list.length === 0 && (
        <div className="card p-5 text-center text-[15px] text-stone-300">Gerade keine passenden Einstiege. Lieber kein Trade als ein schwacher – Blacktrader sucht bei jedem Öffnen neu.</div>
      )}

      {list.map((e) => (
        <EntryTile key={`${e.asset.kind}:${e.asset.symbol}`} asset={e.asset} entry={e} chart showChance onOpen={() => open(e.asset, e.best.horizon ?? e.ltHorizon, { withEntry: true })} />
      ))}

      <div className="flex gap-2">
        <button className="btn flex-1" onClick={() => runScan(0)} disabled={scan.busy}>
          Neu suchen
        </button>
        {tradable.length > 0 && kind !== "blau" && (
          <button className="btn flex-1" onClick={() => setConfirmAll(true)}>
            Alle als Papier-Trades
          </button>
        )}
      </div>
      {scan.at && !scan.busy && (
        <p className="text-[13px] text-stone-500">
          Letzte Suche {new Date(scan.at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} · {scan.checked} Prüfungen{scan.failed ? ` · ${scan.failed} ohne Daten` : ""}
          {scan.ctx.spBull != null && ` · Gesamtmarkt ${scan.ctx.spBull ? "bullisch" : "nicht bullisch"}`}
          {scan.ctx.techWeak && " · Tech-Markt schwach: keine grünen Tech-Trades"}
        </p>
      )}

      <ConfirmSheet
        open={confirmAll}
        title="Alle als Papier-Trades übernehmen?"
        confirm={`${tradable.length} übernehmen`}
        onClose={() => setConfirmAll(false)}
        onConfirm={() => {
          let n = 0;
          // Nur so viele, wie das Geld reicht (500 € + Gebühr je Trade) – dann einmal Bescheid geben
          for (const t of tradable) {
            const d = getData();
            if (!canAfford(d.trades, d.accountResets, ACCOUNT.stake + OVER_BUDGET)) {
              noMoney(freeCash(d.trades, d.accountResets));
              break;
            }
            if (openPositions(t.asset.symbol).length) continue; // schon im Depot – kein zweiter Trade
            if (openPaperTrade(t.asset, t.res)) n++;
          }
          if (n && getData().settings.haptics) haptic(30);
        }}
        text={
          <p>
            Es werden bis zu {tradable.length} Papier-Trades ins Depot übernommen – so viele, wie das Geld im Konto reicht (bereits laufende werden übersprungen). Einstieg, Stop und Ziele kommen unverändert von Blacktrader.
          </p>
        }
      />
      {sheet}
    </div>
  );
}
