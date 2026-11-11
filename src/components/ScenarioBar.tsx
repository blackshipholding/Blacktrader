// Anzeige: Hauptszenario gegen Alternative (zusammen 100 %). Blacktrader handelt nur das Hauptszenario.
import { scenarioShare } from "@/lib/analysis/scenario";
import type { ElliottResult } from "@/lib/analysis/elliott";

export function ScenarioBar({ elliott }: { elliott: Pick<ElliottResult, "best" | "alternative" | "contested"> | null | undefined }) {
  const s = scenarioShare(elliott);
  if (!s) return null;
  const m = Math.round(s.main * 100);
  const notfall = s.state === "notfall";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[13px]">
        <span className="text-stone-300">Hauptszenario {m} %</span>
        <span className="text-stone-400">Alternative {100 - m} %</span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-white/10" aria-label={`Hauptszenario ${m} Prozent, Alternative ${100 - m} Prozent`}>
        <div className={notfall ? "bg-amber-400" : "bg-emerald-400"} style={{ width: `${m}%` }} />
        <div className="bg-stone-600" style={{ width: `${100 - m}%` }} />
      </div>
      <p className={`text-[13px] ${notfall ? "text-amber-300" : "text-stone-400"}`}>
        {notfall
          ? "Achtung: Die Alternative ist fast gleich stark und zeigt in die Gegenrichtung – erhöhtes Risiko."
          : s.alt > 0 && !s.opposite
            ? "Die Alternative zeigt in dieselbe Richtung – kein Widerspruch. Gehandelt wird das Hauptszenario."
            : "Gehandelt wird nur das Hauptszenario. Wird die Alternative wahrscheinlicher, wird sie zum Hauptszenario."}
      </p>
    </div>
  );
}
