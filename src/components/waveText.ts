// Verständliche Beschreibung der Wellenzählung (nur Anzeige, Analyse unverändert).
import type { WaveCount } from "@/lib/analysis/elliott";

const dirWord = (d: number) => (d === 1 ? "aufwärts" : "abwärts");
const arrow = (d: number) => (d === 1 ? "↑" : "↓");

/** Erwartete nächste Welle: Bezeichnung + Richtung. */
export function nextWave(c: WaveCount): { label: string; dir: 1 | -1 } {
  if (c.pattern === "impulse" && !c.complete) {
    const n = c.labels.length + 1;
    return { label: String(n), dir: (n % 2 === 1 ? c.direction : -c.direction) as 1 | -1 };
  }
  if (c.pattern === "zigzag" && !c.complete) return { label: "C", dir: c.direction };
  // Abgeschlossener Impuls/Diagonale → Korrektur; abgeschlossene Korrektur → neuer Anstieg bzw. Rückgang
  if (c.pattern === "impulse" || c.pattern.endsWith("diagonal")) return { label: "Korrektur", dir: c.bias };
  return { label: c.bias === 1 ? "neuer Anstieg" : "neuer Rückgang", dir: c.bias };
}

/** Ein Satz: "Blacktrader zählt: Welle 1 abwärts, Welle 2 aufwärts – als Nächstes Welle 3 abwärts erwartet." */
export function waveCaption(c: WaveCount | undefined): string | null {
  if (!c) return null;
  const parts = c.labels.map((l, i) => {
    const d = i % 2 === 0 ? c.direction : -c.direction;
    return `${/^[0-9]$/.test(l) ? "Welle " : ""}${l} ${dirWord(d)}`;
  });
  const nx = nextWave(c);
  const next = /^[0-9A-Z]$/.test(nx.label) ? `Welle ${nx.label} ${dirWord(nx.dir)}` : nx.label.startsWith("neuer") ? nx.label : `${nx.label} ${dirWord(nx.dir)}`;
  return `Blacktrader zählt: ${parts.join(", ")} – als Nächstes ${next} erwartet.`;
}

export { arrow };
