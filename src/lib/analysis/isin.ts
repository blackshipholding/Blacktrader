// ISIN-Validierung nach ISO 6166 (Luhn-Prüfziffer über die in Ziffern umgewandelten Zeichen).

export const ISIN_PATTERN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

export type IsinCheck =
  | { valid: true; isin: string }
  | { valid: false; reason: string };

/** Sieht die Eingabe wie eine ISIN aus (12 Zeichen, 2 Buchstaben vorne)? */
export function looksLikeIsin(input: string): boolean {
  const s = input.trim().toUpperCase();
  return s.length === 12 && /^[A-Z]{2}[A-Z0-9]{10}$/.test(s);
}

export function isinCheckDigit(first11: string): number {
  const digits = first11
    .toUpperCase()
    .split("")
    .map((c) => (c >= "A" && c <= "Z" ? String(c.charCodeAt(0) - 55) : c))
    .join("");
  let sum = 0;
  // Von rechts: jede zweite Ziffer (beginnend mit der rechtesten) verdoppeln.
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

export function validateIsin(input: string): IsinCheck {
  const s = input.trim().toUpperCase();
  if (s.length !== 12) return { valid: false, reason: "Eine ISIN hat genau 12 Zeichen." };
  if (!ISIN_PATTERN.test(s))
    return {
      valid: false,
      reason: "Format ungültig: 2 Buchstaben Ländercode, 9 alphanumerische Zeichen, 1 Prüfziffer.",
    };
  const expected = isinCheckDigit(s.slice(0, 11));
  if (expected !== Number(s[11]))
    return { valid: false, reason: `Prüfziffer falsch (erwartet ${expected}, gefunden ${s[11]}).` };
  return { valid: true, isin: s };
}
