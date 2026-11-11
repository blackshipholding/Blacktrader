// Aktuell gültige gelernte Werte (aus den getrennt gespeicherten Zellen zusammengesetzt).
import { handle } from "@/lib/data/route-helpers";
import { currentParamSet } from "@/lib/trainer/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(req, () => currentParamSet(), 60);
}
