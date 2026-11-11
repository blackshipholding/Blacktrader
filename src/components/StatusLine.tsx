"use client";
// Ein Satz je Wert, überall gleich aufgebaut (Wunsch des Nutzers): Was Blacktrader gerade sieht und was als Nächstes
// kommen könnte – ohne Wellennummern (die stehen nur in der Expertenansicht). Farbe passend zum Signal.
import type { BestEntry } from "@/lib/analysis/bestEntry";
import type { WaveCount } from "@/lib/analysis/elliott";
import { money } from "@/lib/analysis/persona";
import type { ScanEntry } from "@/lib/client/scanner";
import { nextPhrase } from "./waveText";

export type StatusTone = "gelb" | "gruen" | "rot" | "blau" | "warn" | "info";

const BOX: Record<StatusTone, string> = {
  gelb: "bg-amber-500/10 text-amber-100",
  gruen: "bg-emerald-500/10 text-emerald-100",
  rot: "bg-red-500/10 text-red-100",
  blau: "bg-sky-500/10 text-sky-100",
  warn: "bg-red-500/15 text-red-200",
  info: "bg-white/5 text-stone-200",
};
const TITLE: Record<StatusTone, string> = {
  gelb: "text-amber-300",
  gruen: "text-emerald-300",
  rot: "text-red-300",
  blau: "text-sky-300",
  warn: "text-red-300",
  info: "text-gold-light",
};

export interface Status {
  tone: StatusTone;
  title: string;
  text?: string | null;
}

/** Wellenzählung, die zum aktuellen Einstieg gehört (sonst die beste vorhandene) */
export function waveOf(e: ScanEntry | undefined): WaveCount | undefined {
  if (!e) return undefined;
  return e.best.res?.elliott.best ?? e.horizons.long?.res.elliott.best ?? e.horizons.medium?.res.elliott.best ?? undefined;
}

export const expectText = (c: WaveCount | undefined, could = false) => {
  const p = nextPhrase(c);
  return p ? (could ? `Als Nächstes könnte ${p} kommen.` : `Als Nächstes wird ${p} erwartet.`) : null;
};

/** Satz für den aktuellen Einstieg eines Werts */
export function entryStatus(b: BestEntry, wave: WaveCount | undefined, cur?: string): Status {
  // Kauf: von oben nach unten (Oberkante zuerst), Short: von unten nach oben
  const zone = (top?: number, bottom?: number) => {
    if (top == null || bottom == null) return null;
    const hi = Math.max(top, bottom), lo = Math.min(top, bottom);
    return b.color === "rot" ? `${money(lo, cur)} bis ${money(hi, cur)}` : `${money(hi, cur)} bis ${money(lo, cur)}`;
  };
  if (b.color === "gelb") return { tone: "gelb", title: "Noch keine Handelsmöglichkeit gefunden.", text: expectText(wave, true) };
  if (b.color === "blau") {
    const z = zone(b.zoneTop, b.zoneBottom);
    return { tone: "blau", title: "Langfristiger Einstieg gefunden.", text: `${z ? `Bereich ${z} – ` : ""}erwartet: Rücksetzer in den Bereich, danach ein Anstieg.` };
  }
  const z = zone(b.zoneTop, b.zoneBottom);
  const nx = expectText(wave);
  return {
    tone: b.color,
    title: `Handelsmöglichkeit gefunden: ${b.color === "gruen" ? "Kauf" : "Short"}.`,
    text: [z ? `Einstieg ${z}` : null, nx ? nx.replace(/^Als/, z ? "als" : "Als") : null].filter(Boolean).join(" – ") || null,
  };
}

export function StatusLine({ s, compact = false, children }: { s: Status; compact?: boolean; children?: React.ReactNode }) {
  return (
    <div className={`rounded-xl ${compact ? "px-2.5 py-1.5 text-[13px]" : "px-3 py-2 text-[15px]"} ${BOX[s.tone]}`}>
      <span className={`font-semibold ${TITLE[s.tone]}`}>{s.title}</span>
      {s.text ? ` ${s.text}` : ""}
      {children}
    </div>
  );
}
