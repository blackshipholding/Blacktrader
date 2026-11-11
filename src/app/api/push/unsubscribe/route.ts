import { NextResponse } from "next/server";
import { removeSubscription } from "@/lib/push/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { endpoint?: string };
  if (!b.endpoint) return NextResponse.json({ ok: false }, { status: 400 });
  await removeSubscription(b.endpoint);
  return NextResponse.json({ ok: true });
}
