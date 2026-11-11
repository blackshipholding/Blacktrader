import { NextResponse } from "next/server";
import { sendTest } from "@/lib/push/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { endpoint?: string };
  if (!b.endpoint) return NextResponse.json({ ok: false, note: "Kein Abo" }, { status: 400 });
  return NextResponse.json({ ok: true, note: await sendTest(b.endpoint) });
}
