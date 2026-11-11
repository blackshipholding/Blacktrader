// Wechselkurse: alle Beträge werden in Euro angezeigt und gerechnet.
// Die Wellenzählung läuft auf dem Originalkurs der Börse (z. B. Apple in $); umgerechnet wird nur für Anzeige und Ergebnis.
// Kurs = Wert von 1 Einheit der Währung in Euro (z. B. USD 0,89).

const rates: Record<string, number> = { EUR: 1 };
let version = 0;
const listeners = new Set<() => void>();

/** Währungen, die wie US-Dollar gelten */
const USD_LIKE = new Set(["USD", "USDT", "USDC"]);

export function setFxRates(r: Partial<Record<string, number>>) {
  for (const [k, v] of Object.entries(r)) if (v && Number.isFinite(v) && v > 0) rates[k] = v;
  for (const k of USD_LIKE) if (rates.USD) rates[k] = rates.USD;
  version++;
  listeners.forEach((l) => l());
}

/** Wert von 1 Einheit in Euro (null = unbekannt) */
export function eurPerUnit(currency?: string | null): number | null {
  if (!currency || currency === "EUR") return 1;
  // London notiert oft in Pence (GBp/GBX)
  if (currency === "GBp" || currency === "GBX") return rates.GBP != null ? rates.GBP / 100 : null;
  return rates[currency] ?? (USD_LIKE.has(currency) ? rates.USD ?? null : null);
}

/** Betrag in Euro (null = Währung unbekannt oder noch kein Kurs) */
export function toEur(x: number, currency?: string | null): number | null {
  const r = eurPerUnit(currency);
  return r == null ? null : x * r;
}

export const fxVersion = () => version;
export function onFx(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
