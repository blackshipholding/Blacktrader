import { NextResponse } from "next/server";
import { getVapid } from "@/lib/push/server";
import { storageKind } from "@/lib/trainer/storage";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const v = await getVapid();
    if (!v) return NextResponse.json({ ok: false, note: "Für Push-Nachrichten muss in Vercel ein dauerhafter Speicher (Upstash for Redis) verbunden sein.", storage: storageKind() }, { status: 503 });
    return NextResponse.json({ ok: true, publicKey: v.publicKey, storage: storageKind() });
  } catch (e) {
    return NextResponse.json({ ok: false, note: (e as Error).message }, { status: 500 });
  }
}
