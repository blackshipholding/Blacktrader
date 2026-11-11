// Gelb (Abwarten): Stimmungs-Balken. Zeiger in der Mitte = neutral (gelb); wird Blacktraders Gesamtpunktzahl bullisch
// (über 55) wandert er nach rechts und wird grün, bärisch (unter 45) nach links und rot. Wird bei jeder neuen Analyse
// (jede Suche / jedes Öffnen) neu berechnet. Reine Anzeige – kein Einstieg, keine Wahrscheinlichkeit.
export const GAUGE_BULL = 55;
export const GAUGE_BEAR = 45;

export function gaugeTone(score: number): "bull" | "bear" | "neutral" {
  return score > GAUGE_BULL ? "bull" : score < GAUGE_BEAR ? "bear" : "neutral";
}

export function NeutralGauge({ score }: { score: number | null | undefined }) {
  if (score == null || !Number.isFinite(score)) return null;
  const s = Math.max(0, Math.min(100, score));
  const tone = gaugeTone(s);
  const color = tone === "bull" ? "bg-emerald-400" : tone === "bear" ? "bg-red-400" : "bg-amber-400";
  const text = tone === "bull" ? "text-emerald-300" : tone === "bear" ? "text-red-300" : "text-amber-300";
  const label = tone === "bull" ? "Abwarten – wird bullisch" : tone === "bear" ? "Abwarten – wird bärisch" : "Abwarten – neutral";
  const left = Math.min(s, 50);
  const width = Math.abs(s - 50);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[13px]">
        <span className="text-red-300">bärisch</span>
        <span className={`font-semibold ${text}`}>{label}</span>
        <span className="text-emerald-300">bullisch</span>
      </div>
      <div className="relative h-2 rounded-full bg-white/10" role="img" aria-label={label}>
        <div className="absolute inset-y-0 left-1/2 w-px bg-white/30" />
        {width > 0.5 && <div className={`absolute inset-y-0 ${color} opacity-60`} style={{ left: `${left}%`, width: `${width}%` }} />}
        <div className={`absolute -top-1 h-4 w-4 -translate-x-1/2 rounded-full border-2 border-black ${color}`} style={{ left: `${s}%` }} />
      </div>
    </div>
  );
}
