// Weitergabe der Buy-&-Hold-Dividenden an die App Blacktime. Nur Datum, Aktie, Betrag – keine Käufe, keine Trades.
// Der Kopplungs-Code (nur du kennst ihn) ist zugleich der Schlüssel: ohne den Code gibt es keine Daten.
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getJson, setJson, storageKind } from "@/lib/trainer/storage";

export const dynamic = "force-dynamic";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const json = (b: unknown, status = 200) => NextResponse.json(b, { status, headers: CORS });

interface Row { name: string; symbol: string; date: string; shares: number; gross: number; net: number; source: "hand" | "auto" }
const keyOf = (code: string) => `share:bh-div:${createHash("sha256").update(code).digest("hex")}`;
const okCode = (c: unknown): c is string => typeof c === "string" && /^[A-Za-z0-9_-]{20,80}$/.test(c);

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: Request) {
  try {
    const b = (await req.json()) as { code?: unknown; rows?: unknown };
    if (!okCode(b.code)) return json({ ok: false, note: "Ungültiger Code" }, 400);
    if (!Array.isArray(b.rows) || b.rows.length > 5000) return json({ ok: false, note: "Ungültige Daten" }, 400);
    const rows: Row[] = [];
    for (const r of b.rows as Partial<Row>[]) {
      if (!r || typeof r.name !== "string" || typeof r.symbol !== "string" || typeof r.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) continue;
      if (!Number.isFinite(r.gross) || !Number.isFinite(r.net)) continue;
      rows.push({ name: r.name.slice(0, 80), symbol: r.symbol.slice(0, 20), date: r.date, shares: Number.isFinite(r.shares) && r.shares! >= 0 ? r.shares! : 0, gross: r.gross!, net: r.net!, source: r.source === "hand" ? "hand" : "auto" });
    }
    await setJson(keyOf(b.code), { at: Date.now(), rows });
    return json({ ok: true, count: rows.length, storage: storageKind() });
  } catch (e) {
    return json({ ok: false, note: (e as Error).message }, 500);
  }
}

export async function GET(req: Request) {
  try {
    const code = new URL(req.url).searchParams.get("code");
    if (!okCode(code)) return json({ ok: false, note: "Ungültiger Code" }, 400);
    const d = await getJson<{ at: number; rows: Row[] }>(keyOf(code));
    if (!d) return json({ ok: false, note: "Noch nichts gesendet" }, 404);
    return json({ ok: true, at: d.at, rows: d.rows });
  } catch (e) {
    return json({ ok: false, note: (e as Error).message }, 500);
  }
}
