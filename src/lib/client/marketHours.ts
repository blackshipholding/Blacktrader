// „Börse geschlossen“ erkennen (Nutzer 12.11.2026): Die App kennt keine Öffnungszeiten, sie erkennt es am Alter des letzten
// Kurses. Ist er älter als 30 Minuten (Krypto handelt immer), gilt die Börse als geschlossen.
export const CLOSED_AFTER_MIN = 30;

export function marketClosed(kind: string, quoteTimeSec: number | undefined | null, nowMs = Date.now()): boolean {
  if (kind === "crypto" || quoteTimeSec == null) return false;
  return nowMs / 1000 - quoteTimeSec > CLOSED_AFTER_MIN * 60;
}
