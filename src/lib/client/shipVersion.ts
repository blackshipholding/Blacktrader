// Versionsnummer von Shipmaster (Nutzer 14.11.2026): Die erste bessere Variante des Trainers heißt 0.3, jede weitere zählt automatisch weiter.
// Gespeichert auf dem Gerät; wird erst nach deinem „Ja“ in der Live-Bilanz erhöht. Die Zahl steht überall dort, wo früher fest „0.2“ stand.
const KEY = "bt-ship-version";
export const BASE_VERSION = "0.2";

export function shipVersion(): string {
  try {
    const v = localStorage.getItem(KEY);
    return v && /^\d+\.\d+$/.test(v) ? v : BASE_VERSION;
  } catch {
    return BASE_VERSION;
  }
}

/** Nächste Nummer: 0.2 → 0.3 → 0.4 … */
export const nextVersion = (v: string): string => {
  const [a, b] = v.split(".").map(Number);
  return `${a || 0}.${(b || 0) + 1}`;
};

export function setShipVersion(v: string) {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* ohne Speicher */
  }
}

export const shipLabel = () => `Shipmaster ${shipVersion()}`;
