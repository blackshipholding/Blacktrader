import "server-only";

/** Optionaler Schutz für Änderungen (Zurücksetzen, Abschlusstest, manueller Lauf): TRAINER_ADMIN_TOKEN. */
export function adminRequired(): boolean {
  return !!process.env.TRAINER_ADMIN_TOKEN;
}
export function isAdmin(req: Request): boolean {
  const t = process.env.TRAINER_ADMIN_TOKEN;
  if (!t) return true;
  return req.headers.get("x-trainer-token") === t;
}
/** Vercel Cron sendet "Authorization: Bearer <CRON_SECRET>", wenn CRON_SECRET gesetzt ist. */
export function isCron(req: Request): boolean {
  const s = process.env.CRON_SECRET;
  if (!s) return true;
  return req.headers.get("authorization") === `Bearer ${s}`;
}
